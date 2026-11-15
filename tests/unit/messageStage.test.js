const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const { Collection } = require('mongodb');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const { MessageStage } = require('../../ZelBack/src/services/appMessaging/messageStage');
const { requireMongo, releaseMongo } = require('./dbTestHelper');

const { appsMessagesStaging } = config.database.appsglobal.collections;

const record = (hash, height) => ({
  hash, txid: `tx-${hash}`, height, value: 100,
});
// A peer's copy: it carries the peer's own height for the hash.
const sent = (hash, height) => ({
  type: 'fluxappregister', hash, height, txid: `peer-${hash}`, appSpecifications: { name: hash },
});

// `levels` objects or arrays, one inside the next.
function nested(levels, kind) {
  let value = 'x';
  for (let i = 0; i < levels; i += 1) value = kind === 'arrays' ? [value] : { inner: value };
  return value;
}

async function collect(iterable) {
  const items = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const item of iterable) items.push(item);
  return items;
}

describe('MessageStage tests', () => {
  let collection;
  let stage;

  before(async function () {
    await requireMongo.call(this);
    collection = dbHelper.databaseConnection().db(config.database.appsglobal.database).collection(appsMessagesStaging);
  });

  afterEach(async () => {
    sinon.restore();
    await stage?.discard();
    stage = null;
  });

  after(releaseMongo);

  it('takes a message only when its hash is missing and not staged yet', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 10)], ['b', record('b', 20)]]));

    await stage.add(sent('a', 10));
    await stage.add(sent('a', 10));
    await stage.add(sent('held', 15));
    await stage.add({ type: 'fluxappregister' });
    await stage.add(null);
    await stage.flush();

    expect(stage.size).to.equal(1);
    expect(await collection.countDocuments()).to.equal(1);
    expect(stage.unstagedHeights()).to.deep.equal([20]);
  });

  it('keeps a message exactly as the peer sent it, ordered by this node\'s record of its height', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 30)], ['b', record('b', 10)], ['c', record('c', 20)]]));

    // the peer's heights run the other way round
    await stage.add(sent('a', 1));
    await stage.add(sent('b', 3));
    await stage.add(sent('c', 2));

    const [batch] = await collect(stage.batches(10));
    expect(batch).to.deep.equal([sent('b', 3), sent('c', 2), sent('a', 1)]);
  });

  it('batches in height order, never splitting one block\'s messages', async () => {
    const heights = [1, 1, 2, 3, 3, 3, 4, 5, 5, 6];
    const missing = new Map(heights.map((height, i) => [`h${i}`, record(`h${i}`, height)]));
    stage = await MessageStage.open(missing);
    // eslint-disable-next-line no-restricted-syntax
    for (const [hash, entry] of missing) {
      // eslint-disable-next-line no-await-in-loop
      await stage.add(sent(hash, entry.height));
    }

    const batches = await collect(stage.batches(4));

    const heightOf = (message) => missing.get(message.hash).height;
    expect(batches.map((batch) => batch.map(heightOf))).to.deep.equal([[1, 1, 2, 3, 3, 3], [4, 5, 5, 6]]);
  });

  it('writes in pieces, and batches what was added since the last piece', async () => {
    const missing = new Map(Array(2500).fill(null).map((_, i) => [`p${i}`, record(`p${i}`, i)]));
    stage = await MessageStage.open(missing);
    // eslint-disable-next-line no-restricted-syntax
    for (const hash of missing.keys()) {
      // eslint-disable-next-line no-await-in-loop
      await stage.add(sent(hash, 0));
    }

    expect(await collection.countDocuments()).to.equal(2000);
    const batched = (await collect(stage.batches(500))).flat();
    expect(batched).to.have.lengthOf(2500);
    expect(stage.unstagedHeights()).to.deep.equal([]);
  });

  it('does not take a message the database cannot store, and stores the rest of its piece', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 10)], ['b', record('b', 20)], ['c', record('c', 30)]]));
    const unstorable = JSON.parse('{"type":"fluxappregister","hash":"b","bad\\u0000key":1}');

    expect(await stage.add(sent('a', 10))).to.equal(true);
    expect(await stage.add(unstorable), 'a field name holding a null character').to.equal(false);
    expect(await stage.add(sent('c', 30))).to.equal(true);
    await stage.flush();

    expect(stage.size).to.equal(2);
    expect((await collection.find({}, { projection: { _id: 0, hash: 1 } }).toArray()).map((doc) => doc.hash).sort()).to.deep.equal(['a', 'c']);
    expect(stage.unstagedHeights(), 'left for the next peer').to.deep.equal([20]);
  });

  it('does not take a message over the largest a node takes from a peer', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 10)], ['b', record('b', 20)]]));
    const oversized = { ...sent('b', 20), pad: 'x'.repeat(config.fluxapps.gossipMessageMaxBytes) };

    expect(await stage.add(oversized)).to.equal(false);
    expect(await stage.add(sent('a', 10))).to.equal(true);
    await stage.flush();

    expect(stage.size).to.equal(1);
    expect(stage.unstagedHeights()).to.deep.equal([20]);
  });

  ['objects', 'arrays'].forEach((kind) => {
    [190, 250].forEach((levels) => {
      it(`does not take a message nesting ${levels} ${kind}, and stores the rest of its piece`, async () => {
        stage = await MessageStage.open(new Map([['a', record('a', 10)], ['b', record('b', 20)], ['c', record('c', 30)]]));

        expect(await stage.add(sent('a', 10))).to.equal(true);
        expect(await stage.add({ ...sent('b', 20), deep: nested(levels, kind) })).to.equal(false);
        expect(await stage.add(sent('c', 30))).to.equal(true);
        await stage.flush();

        expect((await collection.find({}, { projection: { _id: 0, hash: 1 } }).toArray()).map((doc) => doc.hash).sort()).to.deep.equal(['a', 'c']);
        expect(stage.unstagedHeights(), 'left for the next peer').to.deep.equal([20]);
      });
    });

    it(`takes a message nesting ${kind} to the deepest it allows`, async () => {
      stage = await MessageStage.open(new Map([['a', record('a', 10)]]));

      // the message is the first level
      expect(await stage.add({ ...sent('a', 10), deep: nested(31, kind) })).to.equal(true);
      await stage.flush();

      expect(stage.size).to.equal(1);
      expect(await collection.countDocuments()).to.equal(1);
    });
  });

  it('stages what a write that failed stored, and asks the database what that is', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 10)], ['b', record('b', 20)]]));
    // a write that lands, and whose answer is lost: a socket timeout
    const write = Collection.prototype.insertMany;
    sinon.stub(Collection.prototype, 'insertMany').callsFake(async function landsThenTimesOut(...args) {
      await write.apply(this, args);
      throw new Error('connection timed out');
    });
    await stage.add(sent('a', 10));
    await stage.add(sent('b', 20));

    await stage.flush();

    expect(stage.size).to.equal(2);
    expect(stage.unstagedHeights()).to.deep.equal([]);
  });

  it('stages nothing of a piece whose write failed without storing it, and rejects', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 10)], ['b', record('b', 20)]]));
    // a piece the database refuses whole, naming no document, as it does one nested too deep
    const write = Collection.prototype.insertMany;
    sinon.stub(Collection.prototype, 'insertMany').callsFake(function refusedWhole(documents, options) {
      return write.call(this, documents.map((document) => ({ ...document, deep: nested(250, 'objects') })), options);
    });
    await stage.add(sent('a', 10));
    await stage.add(sent('b', 20));

    const error = await stage.flush().catch((caught) => caught);

    expect(error).to.be.instanceOf(Error);
    expect(error.writeErrors ?? [], 'no document is named').to.deep.equal([]);
    expect(await collection.countDocuments()).to.equal(0);
    expect(stage.size).to.equal(0);
    expect(stage.unstagedHeights(), 'every hash is asked for again').to.deep.equal([10, 20]);
  });

  it('stages nothing of a piece whose write failed when the database cannot say what it holds, and rejects', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 10)]]));
    const write = Collection.prototype.insertMany;
    sinon.stub(Collection.prototype, 'insertMany').callsFake(async function landsThenTimesOut(...args) {
      await write.apply(this, args);
      throw new Error('connection timed out');
    });
    sinon.stub(Collection.prototype, 'find').throws(new Error('connection timed out'));
    await stage.add(sent('a', 10));

    const error = await stage.flush().catch((caught) => caught);

    expect(error).to.be.instanceOf(Error);
    expect(stage.size).to.equal(0);
    expect(stage.unstagedHeights()).to.deep.equal([10]);
  });

  it('counts a hash staged only once the database stored its message, and rejects a piece it refused', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 10)], ['b', record('b', -1)], ['c', record('c', 30)]]));
    // a database that refuses one document of the piece
    await dbHelper.databaseConnection().db(config.database.appsglobal.database).command({
      collMod: appsMessagesStaging, validator: { height: { $gte: 0 } }, validationAction: 'error',
    });
    await stage.add(sent('a', 10));
    await stage.add(sent('b', -1));
    await stage.add(sent('c', 30));

    const error = await stage.flush().catch((caught) => caught);

    expect(error, 'the piece was refused').to.be.instanceOf(Error);
    expect(stage.size).to.equal(2);
    expect(stage.unstagedHeights(), 'the refused hash is asked for again').to.deep.equal([-1]);
  });

  it('counts a hash the database already holds as staged', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 10)], ['b', record('b', 20)]]));
    // what a piece whose write failed part way had already written
    await collection.insertOne({ hash: 'a', height: 10, message: sent('a', 10) });

    await stage.add(sent('a', 10));
    await stage.add(sent('b', 20));
    await stage.flush();

    expect(stage.size).to.equal(2);
    expect(await collection.countDocuments()).to.equal(2);
    expect(stage.unstagedHeights()).to.deep.equal([]);
  });

  it('opens empty, whatever an earlier stage left', async () => {
    const earlier = await MessageStage.open(new Map([['old', record('old', 1)]]));
    await earlier.add(sent('old', 1));
    await earlier.flush();

    stage = await MessageStage.open(new Map([['new', record('new', 2)]]));

    expect(await collection.countDocuments()).to.equal(0);
    expect(await collect(stage.batches(10))).to.deep.equal([]);
  });

  it('is gone once discarded', async () => {
    stage = await MessageStage.open(new Map([['a', record('a', 1)]]));
    await stage.add(sent('a', 1));
    await stage.flush();

    await stage.discard();
    await stage.discard();

    const names = (await dbHelper.databaseConnection().db(config.database.appsglobal.database).listCollections().toArray()).map((c) => c.name);
    expect(names).to.not.include(appsMessagesStaging);
  });
});
