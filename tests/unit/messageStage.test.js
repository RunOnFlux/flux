const { expect } = require('chai');
const config = require('config');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const { MessageStage } = require('../../ZelBack/src/services/appMessaging/messageStage');
const { requireMongo } = require('./dbTestHelper');

const { appsMessagesStaging } = config.database.appsglobal.collections;

const record = (hash, height) => ({
  hash, txid: `tx-${hash}`, height, value: 100,
});
// A peer's copy: it carries the peer's own height for the hash.
const sent = (hash, height) => ({
  type: 'fluxappregister', hash, height, txid: `peer-${hash}`, appSpecifications: { name: hash },
});

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
    await stage?.discard();
    stage = null;
  });

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
