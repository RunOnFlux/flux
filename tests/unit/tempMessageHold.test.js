const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const proxyquire = require('proxyquire');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const globalState = require('../../ZelBack/src/services/utils/globalState');
const { requireMongo } = require('./dbTestHelper');
const { MongoNetworkTimeoutError } = require('mongodb');

const until = async (condition) => {
  for (let i = 0; i < 400; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await condition()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error('condition never held');
};

describe('tempMessageHold', () => {
  const message = (hash, extra = {}) => ({ hash, type: 'fluxappregister', ...extra });
  const frameOf = (data, signature = 's', networkPath = []) => ({
    version: 1, timestamp: 1, pubKey: 'key', signature, data, networkPath,
  });
  let store;
  let hold;
  let rows;
  let relay;

  const loadHold = () => proxyquire('../../ZelBack/src/services/appMessaging/tempMessageHold', {
    './messageStore': { storeAppTemporaryMessage: (...args) => store(...args) },
  });

  before(async () => {
    await requireMongo();
    hold = loadHold();
  });

  beforeEach(async () => {
    await dbHelper.initiateDB();
    const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    rows = database.collection(config.database.appsglobal.collections.appsHeldMessages);
    await rows.deleteMany({});
    await rows.createIndex({ key: 1 }, { unique: true });
    globalState.dbReady = false;
    store = sinon.stub().resolves(true);
    relay = sinon.stub();
    await hold.start(relay);
  });

  afterEach(() => {
    globalState.dbReady = false;
    sinon.restore();
  });

  it('checks nothing before the registry is ready', async () => {
    await hold.hold([{ message: message('a') }]);
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    sinon.assert.notCalled(store);
    expect(await rows.countDocuments({})).to.equal(1);
  });

  it('checks what it holds once the registry is ready, and removes it', async () => {
    await hold.hold([{ message: message('a') }, { message: message('b') }]);
    globalState.dbReady = true;
    await until(async () => await rows.countDocuments({}) === 0);
    expect(store.args.map(([m]) => m.hash).sort()).to.deep.equal(['a', 'b']);
  });

  it('keeps one row for every copy, so six peers sending one batch cost one check', async () => {
    const batch = ['a', 'b', 'c'].map((h) => ({ message: message(h) }));
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => hold.hold(batch)));
    expect(await rows.countDocuments({})).to.equal(3);
    globalState.dbReady = true;
    await until(async () => await rows.countDocuments({}) === 0);
    sinon.assert.callCount(store, 3);
  });

  it('a forged copy arriving first does not stand in the way of the genuine one', async () => {
    await hold.hold([{ message: message('a', { signature: 'forged' }) }, { message: message('a', { signature: 'real' }) }]);
    expect(await rows.countDocuments({})).to.equal(2);
  });

  it('checks a message by the route it arrived on, with its frame', async () => {
    const frame = frameOf(message('a'));
    await hold.hold([{ message: frame.data, authenticated: true, relay: { message: frame, from: 'p' } }]);
    globalState.dbReady = true;
    await until(() => store.called);
    expect(store.firstCall.args[1]).to.deep.include({ furtherVerification: true, authenticated: true, frame });
  });

  it('hands over the frame around the message it checks, as a live frame carries it', async () => {
    const frame = frameOf(message('a'));
    await hold.hold([{ message: frame.data, relay: { message: frame, from: 'p' } }]);
    globalState.dbReady = true;
    await until(() => store.called);
    expect(store.firstCall.args[1].frame.data).to.equal(store.firstCall.args[0]);
  });

  it('gives the message back in the text it was signed over', async () => {
    const data = message('a', { zeta: 1, alpha: { yankee: [2, { beta: 3 }], bravo: null }, epoch: 1793960000000 });
    const frame = frameOf(JSON.parse(JSON.stringify(data)));
    await hold.hold([{ message: frame.data, relay: { message: frame, from: 'p' } }]);
    globalState.dbReady = true;
    await until(() => store.called);
    expect(JSON.stringify(store.firstCall.args[1].frame.data)).to.equal(JSON.stringify(data));
  });

  it('holds the message once', async () => {
    const frame = frameOf(message('a'));
    await hold.hold([{ message: frame.data, relay: { message: frame, from: 'p' } }]);
    const row = await rows.findOne({});
    expect(row.envelope).to.deep.equal({
      version: 1, timestamp: 1, pubKey: 'key', signature: 's',
    });
    expect(row).to.not.have.property('relay');
  });

  it('keeps nothing of a frame but what is signed and its path', async () => {
    const hop = [5, `${'a'.repeat(87)}=`];
    const frame = { ...frameOf(message('a'), 's', [hop]), padding: 'x'.repeat(1000) };
    await hold.hold([{ message: frame.data, relay: { message: frame, from: 'p' } }]);
    globalState.dbReady = true;
    await until(() => relay.called);
    const passedOn = relay.firstCall.args[0].message;
    expect(passedOn).to.not.have.property('padding');
    expect(passedOn.networkPath).to.deep.equal([hop]);
  });

  it('keeps no path that is not one', async () => {
    const frame = frameOf(message('a'), 's', [['not a hop']]);
    await hold.hold([{ message: frame.data, relay: { message: frame, from: 'p' } }]);
    expect((await rows.findOne({})).networkPath).to.deep.equal([]);
  });

  it('keeps the authenticated copy of a message an unauthenticated link sent first', async () => {
    const first = { message: frameOf(message('a'), 'first'), from: 'a' };
    const second = { message: frameOf(message('a'), 'second'), from: 'b' };
    await hold.hold([{ message: message('a'), authenticated: false, relay: first }]);
    await hold.hold([{ message: message('a'), authenticated: true, relay: second }]);
    expect(await rows.countDocuments({})).to.equal(1);
    const row = await rows.findOne({});
    expect(row.authenticated).to.equal(true);
    expect(row.envelope.signature).to.equal('second');
    expect(row.from).to.equal('b');
  });

  it('keeps what relays a message when an authenticated sync answer holds it too', async () => {
    const gossip = { message: frameOf(message('a'), 'gossip'), from: 'a' };
    await hold.hold([{ message: message('a'), authenticated: false, relay: gossip }]);
    await hold.hold([{ message: message('a'), authenticated: true }]);
    const row = await rows.findOne({});
    expect(row.authenticated).to.equal(true);
    expect(row.envelope.signature).to.equal('gossip');
    expect(row.from).to.equal('a');
  });

  it('does not lose the route of an authenticated copy to a later unauthenticated one', async () => {
    await hold.hold([{ message: message('a'), authenticated: true }]);
    await hold.hold([{ message: message('a'), authenticated: false }]);
    expect((await rows.findOne({})).authenticated).to.equal(true);
  });

  it('survives a restart of the module', async () => {
    await hold.hold([{ message: message('a') }]);
    const restarted = loadHold();
    await restarted.start(relay);
    expect(restarted.isEmpty()).to.equal(false);
    globalState.dbReady = true;
    await until(() => store.called);
  });

  it('is empty on a start with nothing held', () => {
    expect(hold.isEmpty()).to.equal(true);
  });

  it('relays only what passed its checks and came with something to relay', async () => {
    store.withArgs(sinon.match({ hash: 'refused' })).rejects(new Error('Flux App already registered'));
    await hold.hold([
      { message: message('good'), relay: { message: frameOf(message('good')), from: 'p' } },
      { message: message('fromsync') },
      { message: message('refused'), relay: { message: frameOf(message('refused')), from: 'p' } },
    ]);
    globalState.dbReady = true;
    await until(async () => await rows.countDocuments({}) === 0);
    sinon.assert.calledWith(relay, { message: frameOf(message('good')), from: 'p' }, true);
    sinon.assert.calledWith(relay, { message: frameOf(message('refused')), from: 'p' }, sinon.match.instanceOf(Error));
    sinon.assert.calledTwice(relay);
  });

  it('relays nothing the store did not take as new', async () => {
    store.resolves(false);
    await hold.hold([{ message: message('known'), relay: { message: frameOf(message('known')), from: 'p' } }]);
    globalState.dbReady = true;
    await until(async () => await rows.countDocuments({}) === 0);
    sinon.assert.calledOnceWithExactly(relay, { message: frameOf(message('known')), from: 'p' }, false);
  });

  it('stops while the registry is rebuilt, and carries on when it opens', async () => {
    globalState.dbReady = true;
    store.callsFake(async () => { globalState.dbReady = false; return true; });
    await hold.hold([1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ message: message(`m${i}`) })));
    await until(() => store.callCount >= 1);
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    const whileClosed = store.callCount;
    expect(await rows.countDocuments({}), 'the drain ran on past the registry closing').to.be.above(0);
    store.resolves(true);
    store.callsFake(async () => true);
    globalState.dbReady = true;
    await until(async () => await rows.countDocuments({}) === 0);
    expect(store.callCount).to.be.above(whileClosed - 1);
  });

  it('resolves drained for what was held by then, whatever arrives after', async () => {
    let release;
    const stalled = new Promise((resolve) => { release = resolve; });
    store.callsFake(({ hash }) => (hash === 'last' ? stalled : Promise.resolve(true)));
    await hold.hold([{ message: message('first') }]);
    const waited = hold.drained();
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    await hold.hold(['a', 'b', 'c', 'd', 'last'].map((h) => ({ message: message(h) })));
    globalState.dbReady = true;
    await waited;
    expect(await rows.countDocuments({ 'message.hash': 'last' })).to.equal(1);
    release(true);
    await until(async () => await rows.countDocuments({}) === 0);
  });

  it('resolves drained with nothing held, registry or not', async () => {
    await hold.drained();
  });

  it('skips what is not a message', async () => {
    expect(await hold.hold([{ message: null }, { message: 'x' }, { message: {} }])).to.equal(0);
  });

  it('says a paid message with none stored cannot wait', async () => {
    const database = dbHelper.databaseConnection().db(config.database.daemon.database);
    const hashes = config.database.daemon.collections.appsHashes;
    await database.collection(hashes).deleteMany({ hash: { $in: ['paid', 'stored'] } });
    await database.collection(hashes).insertMany([{ hash: 'paid', message: false }, { hash: 'stored', message: true }]);
    expect(await hold.isPaidAndMissing('paid')).to.equal(true);
    expect(await hold.isPaidAndMissing('stored')).to.equal(false);
    expect(await hold.isPaidAndMissing('unpaid')).to.equal(false);
    await database.collection(hashes).deleteMany({ hash: { $in: ['paid', 'stored'] } });
  });

  // Last: its retry timer outlives the test.
  it('keeps a row the database could not check, and removes one that failed its checks', async () => {
    store.withArgs(sinon.match({ hash: 'down' })).rejects(new MongoNetworkTimeoutError('timed out'));
    store.withArgs(sinon.match({ hash: 'bad' })).rejects(new Error('Invalid'));
    await hold.hold([{ message: message('down') }, { message: message('bad') }]);
    globalState.dbReady = true;
    await until(async () => await rows.countDocuments({}) === 1);
    expect((await rows.findOne({})).message.hash).to.equal('down');
  });
});
