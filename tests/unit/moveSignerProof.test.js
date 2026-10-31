const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxnodeAddressRecord = require('../../ZelBack/src/services/fluxnodeAddressRecord');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const verifyPool = require('../../ZelBack/src/services/utils/verifyPool');
const { peerManager } = require('../../ZelBack/src/services/utils/peerState');
const { MongoNetworkTimeoutError } = require('mongodb');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');
const { requireMongo } = require('./dbTestHelper');

const { VerifyResult } = fluxCommunicationUtils;

// A move heard after its confirmation was mined finds its node listed at the
// new address only. It is accepted when the chain moved that node - its
// collateral - from the address the move left to the one it names.
describe('the proof a move\'s signer spoke for the address it left', () => {
  before(requireMongo);

  const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
  const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
  const OLD = '203.0.113.170:16127';
  const NEW = '203.0.113.171:16127';
  const ELSEWHERE = '203.0.113.180:16127';
  const COLLATERAL = { txhash: 'aa'.repeat(32), outidx: '0' };
  const OTHER_COLLATERAL = { txhash: 'bb'.repeat(32), outidx: '1' };
  const MINUTE = 60 * 1000;
  let records;
  let events;
  let locations;
  let listedAt;
  // each test's blocks sit above every block recorded before it
  let height = 6_000_000;

  const signed = async (data) => {
    const timestamp = Date.now();
    const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(1 + JSON.stringify(data) + timestamp, privKey);
    return {
      version: 1, pubKey, timestamp, data, signature,
    };
  };
  const move = (oldIP = OLD, newIP = NEW, { broadcastedAt = Date.now() } = {}) => signed({
    type: 'fluxipchanged', version: 1, oldIP, newIP, broadcastedAt,
  });
  // a block confirming the node with `collateral` at `ip`, recorded as the explorer does
  const confirmed = async (ip, collateral = COLLATERAL) => {
    height += 5;
    await fluxnodeAddressRecord.recordBlock({
      height,
      confirmations: 1,
      tx: [{
        version: 5, type: 'Confirming a fluxnode', txhash: collateral.txhash, outidx: collateral.outidx, ip,
      }],
    });
    return height;
  };
  // the node list showing the signer's node at `ip`, last confirmed at `at`
  const listed = (ip, at, collateral = COLLATERAL) => listedAt.withArgs(ip).resolves({
    ip, pubkey: pubKey, txhash: collateral.txhash, outidx: collateral.outidx, last_confirmed_height: at,
  });

  beforeEach(async () => {
    await dbHelper.initiateDB();
    const database = dbHelper.databaseConnection().db(config.database.daemon.database);
    records = database.collection(config.database.daemon.collections.fluxnodeAddresses);
    const appsGlobal = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    events = appsGlobal.collection(config.database.appsglobal.collections.appStateEvents);
    locations = appsGlobal.collection(config.database.appsglobal.collections.appsLocations);
    // dropped, so the heights it has recorded go with it
    await fluxnodeAddressRecord.drop(database);
    await events.deleteMany({ ip: { $in: [OLD, NEW, ELSEWHERE] } });
    await locations.deleteMany({ ip: { $in: [OLD, NEW, ELSEWHERE] } });
    height += 1000;
    listedAt = sinon.stub(networkStateService, 'getFluxnodeBySocketAddress').resolves(null);
  });

  afterEach(async () => {
    sinon.restore();
    await records.deleteMany({});
    await events.deleteMany({ ip: { $in: [OLD, NEW, ELSEWHERE] } });
    await locations.deleteMany({ ip: { $in: [OLD, NEW, ELSEWHERE] } });
  });

  describe('a move arriving by gossip, with its node listed at the new address only', () => {
    it('is accepted when the chain moved its node from the address it left', async () => {
      await confirmed(OLD);
      listed(NEW, await confirmed(NEW));

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.OK);
    });

    it('is dropped when the chain has its node at the new address and never at the one it left', async () => {
      listed(NEW, await confirmed(NEW));

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.NODE_NOT_FOUND);
    });

    it('is dropped when the chain moved its node from another address', async () => {
      await confirmed(ELSEWHERE);
      listed(NEW, await confirmed(NEW));

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.NODE_NOT_FOUND);
    });

    // One key serves an owner's whole fleet: the move speaks for the node listed
    // at the new address, and only that node's own change proves it.
    it('is dropped when the chain moved another node of the same key from the address it left', async () => {
      await confirmed(OLD, OTHER_COLLATERAL);
      await confirmed(NEW, OTHER_COLLATERAL);
      listed(NEW, await confirmed(NEW));

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.NODE_NOT_FOUND);
    });

    it('is accepted when the address it left was evicted before the move arrived', async () => {
      await confirmed(OLD);
      listed(NEW, await confirmed(NEW));
      await messageStore.applyEviction(OLD, Date.now());

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move(OLD, NEW, { broadcastedAt: Date.now() - MINUTE }))).to.equal(VerifyResult.OK);
    });

    it('is accepted for each move of a node that left an address, came back and left again', async () => {
      const AWAY = '203.0.113.170:16137';
      const LAST = '203.0.113.170:16147';
      await confirmed(OLD);
      await confirmed(AWAY);
      await confirmed(OLD);
      listed(LAST, await confirmed(LAST));

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move(OLD, LAST))).to.equal(VerifyResult.OK);
    });

    it('is accepted for a move of the port alone', async () => {
      const portMoved = '203.0.113.170:16157';
      await confirmed(OLD);
      listed(portMoved, await confirmed(portMoved));

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move(OLD, portMoved))).to.equal(VerifyResult.OK);
    });

    it('reads a node confirmed at the default port by its bare ip', async () => {
      await confirmed('203.0.113.170');
      listed(NEW, await confirmed('203.0.113.171'));

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.OK);
    });

    // The node list is fluxd's current one and can hold a block the explorer has
    // not processed yet.
    it('waits for the explorer to record the block that confirmed its node at the new address', async () => {
      await confirmed(OLD);
      const movedIn = height + 5;
      listed(NEW, movedIn);

      const verdict = fluxCommunicationUtils.verifyFluxBroadcast(await move());
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(await confirmed(NEW), 'fixture: the block the list holds').to.equal(movedIn);

      expect(await verdict).to.equal(VerifyResult.OK);
    });

    it('is unreadable, not dropped, while the explorer has not recorded the block that confirmed its node there', async () => {
      await confirmed(OLD);
      listed(NEW, height + 5);
      sinon.stub(fluxnodeAddressRecord, 'whenRecorded').resolves(false);

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.UNREADABLE);
    });

    it('waits for the explorer once for a batch of moves, not once for each', async () => {
      await confirmed(OLD);
      listed(NEW, height + 5);
      let waiting = 0;
      let mostWaiting = 0;
      sinon.stub(fluxnodeAddressRecord, 'whenRecorded').callsFake(async () => {
        waiting += 1;
        mostWaiting = Math.max(mostWaiting, waiting);
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        waiting -= 1;
        return false;
      });

      const verdicts = await fluxCommunicationUtils.verifyBroadcasts([await move(), await move(), await move()]);

      expect(verdicts.map((verdict) => verdict.result)).to.deep.equal([VerifyResult.UNREADABLE, VerifyResult.UNREADABLE, VerifyResult.UNREADABLE]);
      expect(mostWaiting, 'the moves waited one after another').to.equal(3);
    });

    it('is unreadable, not dropped, when the record cannot be read', async () => {
      await confirmed(OLD);
      listed(NEW, await confirmed(NEW));
      sinon.stub(fluxnodeAddressRecord, 'movedBetween').rejects(new MongoNetworkTimeoutError('timed out'));

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.UNREADABLE);
    });

    // A forged signature is refused before the proof reads the record, so it
    // counts against the peer that sent it rather than being dropped as unproven.
    it('is refused as a bad signature, without reading the record, when its signature is forged', async () => {
      listed(NEW, await confirmed(NEW));
      const forged = { ...(await move()), signature: (await move(OLD, '203.0.113.172:16127')).signature };
      const reads = sinon.spy(fluxnodeAddressRecord, 'movedBetween');

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(forged)).to.equal(VerifyResult.BAD_SIGNATURE);
      sinon.assert.notCalled(reads);
    });

    it('is refused as a bad signature, without reading the record, when the signature checker given rejects it', async () => {
      await confirmed(OLD);
      listed(NEW, await confirmed(NEW));
      const reads = sinon.spy(fluxnodeAddressRecord, 'movedBetween');

      const [verdict] = await fluxCommunicationUtils.verifyBroadcasts([await move()], { verifySignatures: (items) => items.map(() => false) });

      expect(verdict.result).to.equal(VerifyResult.BAD_SIGNATURE);
      sinon.assert.notCalled(reads);
    });

    it('is proved once the signature checker given accepts it', async () => {
      await confirmed(OLD);
      listed(NEW, await confirmed(NEW));

      const [verdict] = await fluxCommunicationUtils.verifyBroadcasts([await move()], { verifySignatures: (items) => items.map(() => true) });

      expect(verdict.result).to.equal(VerifyResult.OK);
    });
  });

  it('needs no proof for a move whose node is still listed at the address it left', async () => {
    listedAt.withArgs(OLD).resolves({ ip: OLD, pubkey: pubKey });
    const reads = sinon.spy(fluxnodeAddressRecord, 'movedBetween');

    expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.OK);
    sinon.assert.notCalled(reads);
  });

  describe('a move arriving by app state sync, with its node listed at the new address only', () => {
    const PEER_SOCKET = { key: '10.0.0.9:16127', connectionId: 7 };
    const appName = 'proofsyncapp';

    beforeEach(() => {
      sinon.stub(peerManager, 'isSyncResponseWanted').returns(true);
      sinon.stub(verifyPool, 'verify').callsFake(async (items) => items.map(() => true));
    });

    const apprunningAt = (ip, key, broadcastedAt) => ({
      type: 'apprunning',
      ip,
      dedupKey: 'v2',
      broadcastedAt: new Date(broadcastedAt).toISOString(),
      data: {
        type: 'fluxapprunning',
        version: 2,
        apps: [{ name: appName, hash: `hash-${appName}`, runningSince: new Date(broadcastedAt).toISOString() }],
        ip,
        broadcastedAt,
        osUptime: 1000,
        staticIp: false,
      },
      envelope: {
        version: 1, timestamp: broadcastedAt, pubKey: key, signature: 'SIG',
      },
    });
    const movedAt = (broadcastedAt) => ({
      type: 'ipchanged',
      ip: OLD,
      dedupKey: 'ipchanged',
      broadcastedAt: new Date(broadcastedAt).toISOString(),
      data: {
        type: 'fluxipchanged', version: 1, oldIP: OLD, newIP: NEW, broadcastedAt,
      },
      envelope: {
        version: 1, timestamp: broadcastedAt, pubKey, signature: 'SIG',
      },
    });
    const sync = (messages) => fluxCommunication.handleAppRunningSyncResponse({
      data: { type: 'fluxapprunningsync', messages, done: true },
    }, PEER_SOCKET);
    const rowsAt = async () => (await registryManager.appLocation(appName)).map((row) => row.ip);

    // heard by gossip while the address it left was listed
    const heardWhileListed = async () => {
      listedAt.withArgs(OLD).resolves({ ip: OLD, pubkey: pubKey });
      await sync([apprunningAt(OLD, pubKey, Date.now() - 10 * MINUTE)]);
      listedAt.withArgs(OLD).resolves(null);
    };

    it('carries the rows of a node the chain moved from the address it left', async () => {
      await heardWhileListed();
      await confirmed(OLD);
      listed(NEW, await confirmed(NEW));
      expect(await rowsAt(), 'rows before the move').to.deep.equal([OLD]);

      await sync([movedAt(Date.now() - 2 * MINUTE)]);

      expect(await rowsAt()).to.deep.equal([NEW]);
      expect(await events.countDocuments({ ip: OLD, type: 'ipchanged' })).to.equal(1);
    });

    it('holds the move of a node whose address it left was evicted before the move arrived', async () => {
      await heardWhileListed();
      await confirmed(OLD);
      listed(NEW, await confirmed(NEW));
      await messageStore.applyEviction(OLD, Date.now());
      expect(await rowsAt(), 'fixture: the eviction took the rows').to.deep.equal([]);

      await sync([movedAt(Date.now() - 2 * MINUTE)]);

      expect(await events.countDocuments({ ip: OLD, type: 'ipchanged' })).to.equal(1);
    });

    it('drops the move, leaving the rows, when the chain did not move the node from the address it left', async () => {
      await heardWhileListed();
      listed(NEW, await confirmed(NEW));

      await sync([movedAt(Date.now() - 2 * MINUTE)]);

      expect(await rowsAt()).to.deep.equal([OLD]);
      expect(await events.countDocuments({ ip: OLD, type: 'ipchanged' })).to.equal(0);
    });

    it('does not credit a response carrying a move whose proof cannot be read', async () => {
      await confirmed(OLD);
      listed(NEW, await confirmed(NEW));
      const completed = sinon.spy();
      appSyncEvents.on(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, completed);
      try {
        await sync([]);
        sinon.assert.calledOnce(completed);

        sinon.stub(fluxnodeAddressRecord, 'movedBetween').rejects(new MongoNetworkTimeoutError('timed out'));
        await sync([movedAt(Date.now() - 2 * MINUTE)]);

        sinon.assert.calledOnce(completed);
      } finally {
        appSyncEvents.off(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, completed);
      }
    });

    it('holds no rows to carry from a response sent once nothing is listed at the address the node left', async () => {
      await sync([apprunningAt(OLD, pubKey, Date.now() - 10 * MINUTE), movedAt(Date.now() - 2 * MINUTE)]);

      expect(await rowsAt()).to.deep.equal([]);
      expect(await events.countDocuments({ ip: OLD })).to.equal(0);
    });
  });
});
