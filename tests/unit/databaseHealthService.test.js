const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const { EventEmitter } = require('events');
const { MongoClient } = require('mongodb');
const log = require('../../ZelBack/src/lib/log');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const databaseHealthService = require('../../ZelBack/src/services/databaseHealthService');
const { requireMongo } = require('./dbTestHelper');

const { suspectWindowMs } = config.database;
const MINUTE = 60 * 1000;

describe('databaseHealthService tests', () => {
  let clock;
  let client;

  const created = (id) => client.emit('connectionCreated', { connectionId: id });
  const closed = (id, reason = 'error') => client.emit('connectionClosed', { connectionId: id, reason });
  const checkOutFailed = (reason = 'timeout') => client.emit('connectionCheckOutFailed', { reason });
  const timeOut = (n) => { for (let i = 0; i < n; i += 1) closed(100 + i); };
  const held = () => fluxNetworkHelper.isPlacementHeld();

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'hrtime'] });
    client = new EventEmitter();
    databaseHealthService.watch(client, 'main');
  });

  afterEach(() => {
    databaseHealthService.stop();
    clock.restore();
    sinon.restore();
  });

  it('holds the node back from new placements on the fourth round trip that runs out', () => {
    timeOut(3);
    expect(held()).to.equal(false);

    timeOut(1);

    expect(held()).to.equal(true);
    expect(databaseHealthService.isSuspect()).to.equal(true);
    expect(fluxNetworkHelper.getPlacementHold()).to.include('Database calls are timing out');
  });

  it('counts a wait for a pooled connection that ran out, and no other checkout failure', () => {
    checkOutFailed('poolClosed');
    checkOutFailed('connectionError');
    timeOut(3);
    expect(held()).to.equal(false);

    checkOutFailed('timeout');

    expect(held()).to.equal(true);
  });

  it('does not count a connection closed for any reason but an error', () => {
    ['stale', 'idle', 'poolClosed'].forEach((reason) => closed(1, reason));
    timeOut(3);
    expect(held()).to.equal(false);

    closed(200);

    expect(held()).to.equal(true);
  });

  it('does not count the connections a cleared pool closes, and counts those created after it', () => {
    [1, 2, 3, 4, 5].forEach(created);
    client.emit('connectionPoolCleared', {});
    [1, 2, 3, 4, 5].forEach((id) => closed(id));
    expect(held()).to.equal(false);

    [6, 7, 8, 9].forEach(created);
    [6, 7, 8].forEach((id) => closed(id));
    expect(held()).to.equal(false);
    closed(9);

    expect(held()).to.equal(true);
  });

  it('counts only the round trips inside the window', () => {
    timeOut(3);
    clock.tick(suspectWindowMs);

    timeOut(1);

    expect(held()).to.equal(false);
  });

  it('releases the hold a window after the last round trip that ran out, and each one moves it', () => {
    timeOut(4);
    clock.tick(suspectWindowMs - MINUTE);
    timeOut(1);
    clock.tick(suspectWindowMs - MINUTE);
    expect(held()).to.equal(true);

    clock.tick(MINUTE);

    expect(held()).to.equal(false);
    expect(databaseHealthService.isSuspect()).to.equal(false);
  });

  it('counts afresh after a release', () => {
    timeOut(4);
    clock.tick(suspectWindowMs);
    expect(held()).to.equal(false);

    timeOut(3);

    expect(held()).to.equal(false);
  });

  it('counts the round trips of every client it watches together', () => {
    const maintenance = new EventEmitter();
    databaseHealthService.watch(maintenance, 'maintenance');
    timeOut(2);
    maintenance.emit('connectionClosed', { connectionId: 1, reason: 'error' });
    expect(held()).to.equal(false);

    maintenance.emit('connectionClosed', { connectionId: 2, reason: 'error' });

    expect(held()).to.equal(true);
  });

  describe('against the driver', () => {
    // real: the client the node watches, whose round trips run out at 100ms;
    // setUp: a client with no such limit, for what the test does around the reads
    let real;
    let setUp;

    before(requireMongo);

    beforeEach(async () => {
      clock.restore();
      databaseHealthService.stop();
      setUp = new MongoClient(`mongodb://${config.database.url}:${config.database.port}`);
      await setUp.connect();
      real = new MongoClient(`mongodb://${config.database.url}:${config.database.port}`, { socketTimeoutMS: 100 });
      await real.connect();
      databaseHealthService.watch(real, 'probe');
    });

    afterEach(async () => {
      await real.close();
      await setUp.close();
    });

    it('counts one stuck read as two round trips, so two stuck reads hold the node', async function stuckReads() {
      this.timeout(10000);
      const ranOut = sinon.spy(log, 'warn');
      const prepared = setUp.db(config.database.local.database).collection('databasehealthprobe');
      await prepared.insertOne({ probe: 1 });
      const collection = real.db(config.database.local.database).collection('databasehealthprobe');
      const stuckRead = () => collection.findOne({ $where: 'sleep(400) || true' }).catch((error) => error);

      const first = await stuckRead();
      // the canary: the read did run out, and the driver retried it once
      expect(first.name).to.equal('MongoNetworkTimeoutError');
      expect(ranOut.getCalls().filter((call) => /round trip ran out/.test(call.args[0]))).to.have.length(2);
      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(false);

      await stuckRead();

      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(true);
      // waits for the server's own sleeps, which hold the collection, to end
      await prepared.drop();
    });
  });
});
