const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const verifyPool = require('../../ZelBack/src/services/utils/verifyPool');
const { peerManager } = require('../../ZelBack/src/services/utils/peerState');
const { requireMongo } = require('./dbTestHelper');

const { VerifyResult } = fluxCommunicationUtils;

// A move heard after its confirmation was mined finds its node listed at the
// new address only. It is accepted when the key listed there is the one that
// last sent apprunning from the address it left.
describe('the proof a move\'s signer spoke for the address it left', () => {
  before(requireMongo);

  const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
  const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
  const OLD = '203.0.113.170:16127';
  const NEW = '203.0.113.171:16127';
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  let events;
  let locations;
  let listedAt;

  const signed = async (data) => {
    const timestamp = Date.now();
    const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(1 + JSON.stringify(data) + timestamp, privKey);
    return {
      version: 1, pubKey, timestamp, data, signature,
    };
  };
  const move = (oldIP = OLD, newIP = NEW) => signed({
    type: 'fluxipchanged', version: 1, oldIP, newIP, broadcastedAt: Date.now(),
  });
  // apprunning stored for `ip`, signed by `key`, sent `ago` ms before now
  const ranAt = (ip, key, { ago = 10 * MINUTE, apps = [{ name: 'proofapp' }], dedupKey = 'v2' } = {}) => events.insertOne({
    ip,
    type: 'apprunning',
    dedupKey,
    broadcastedAt: new Date(Date.now() - ago),
    expireAt: new Date(Date.now() - ago + HOUR),
    data: {
      type: 'fluxapprunning', version: 2, ip, apps, broadcastedAt: Date.now() - ago,
    },
    envelope: {
      version: 1, timestamp: Date.now() - ago, pubKey: key, signature: 'SIG',
    },
  });

  beforeEach(async () => {
    await dbHelper.initiateDB();
    const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    events = database.collection(config.database.appsglobal.collections.appStateEvents);
    locations = database.collection(config.database.appsglobal.collections.appsLocations);
    await events.deleteMany({ ip: { $in: [OLD, NEW] } });
    await locations.deleteMany({ ip: { $in: [OLD, NEW] } });
    listedAt = sinon.stub(networkStateService, 'getFluxnodeBySocketAddress').resolves(null);
  });

  afterEach(async () => {
    sinon.restore();
    await events.deleteMany({ ip: { $in: [OLD, NEW] } });
    await locations.deleteMany({ ip: { $in: [OLD, NEW] } });
  });

  describe('a move arriving by gossip, with its node listed at the new address only', () => {
    beforeEach(() => {
      listedAt.withArgs(NEW).resolves({ ip: NEW, pubkey: pubKey });
    });

    it('is accepted when its signer last sent apprunning from the address it left', async () => {
      await ranAt(OLD, pubKey);

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.OK);
    });

    it('is refused when another node last sent apprunning from the address it left', async () => {
      await ranAt(OLD, 'theothernodeskey');

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.PUBKEY_MISMATCH);
    });

    it('is dropped, as nothing shows who left, when no apprunning is stored for the address it left', async () => {
      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.NODE_NOT_FOUND);
    });

    it('is dropped when the only apprunning stored for the address it left has expired', async () => {
      await ranAt(OLD, pubKey, { ago: 2 * HOUR });

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.NODE_NOT_FOUND);
    });

    it('is accepted from a node that stopped all its apps there, whose last apprunning names none', async () => {
      await ranAt(OLD, pubKey, { apps: [] });

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.OK);
    });

    it('is judged by the newest apprunning from an address another node held before', async () => {
      await ranAt(OLD, 'theformerholderskey', { ago: 40 * MINUTE, dedupKey: 'v1:proofapp' });
      await ranAt(OLD, pubKey, { ago: 5 * MINUTE });

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.OK);
    });

    it('is refused from a node that held the address before another sent apprunning from it', async () => {
      await ranAt(OLD, pubKey, { ago: 40 * MINUTE, dedupKey: 'v1:proofapp' });
      await ranAt(OLD, 'thelaterholderskey', { ago: 5 * MINUTE });

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.PUBKEY_MISMATCH);
    });

    it('is accepted for a move of the port alone', async () => {
      const portMoved = '203.0.113.170:16157';
      listedAt.withArgs(portMoved).resolves({ ip: portMoved, pubkey: pubKey });
      await ranAt(OLD, pubKey);

      expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move(OLD, portMoved))).to.equal(VerifyResult.OK);
    });
  });

  it('needs no proof for a move whose node is still listed at the address it left', async () => {
    listedAt.withArgs(OLD).resolves({ ip: OLD, pubkey: pubKey });

    expect(await fluxCommunicationUtils.verifyFluxBroadcast(await move())).to.equal(VerifyResult.OK);
  });

  describe('a move arriving by app state sync, with its node listed at the new address only', () => {
    const PEER_SOCKET = { key: '10.0.0.9:16127', connectionId: 7 };
    const appName = 'proofsyncapp';

    beforeEach(() => {
      listedAt.withArgs(NEW).resolves({ ip: NEW, pubkey: pubKey });
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

    // heard by gossip while the address it left was listed: the rows and the
    // apprunning event that proves who sent them
    const heardWhileListed = async (key) => {
      listedAt.withArgs(OLD).resolves({ ip: OLD, pubkey: key });
      await sync([apprunningAt(OLD, key, Date.now() - 10 * MINUTE)]);
      listedAt.withArgs(OLD).resolves(null);
    };

    it('carries the rows of a node whose apprunning from the address it left was signed by the move\'s signer', async () => {
      await heardWhileListed(pubKey);
      expect(await rowsAt(), 'rows before the move').to.deep.equal([OLD]);

      await sync([movedAt(Date.now() - 2 * MINUTE)]);

      expect(await rowsAt()).to.deep.equal([NEW]);
      expect(await events.countDocuments({ ip: OLD, type: 'ipchanged' })).to.equal(1);
    });

    it('drops the move, leaving the rows, when another node signed the apprunning from the address it left', async () => {
      await heardWhileListed('theothernodeskey');

      await sync([movedAt(Date.now() - 2 * MINUTE)]);

      expect(await rowsAt()).to.deep.equal([OLD]);
      expect(await events.countDocuments({ ip: OLD, type: 'ipchanged' })).to.equal(0);
    });

    it('holds no rows to carry from a response sent once nothing is listed at the address the node left', async () => {
      await sync([apprunningAt(OLD, pubKey, Date.now() - 10 * MINUTE), movedAt(Date.now() - 2 * MINUTE)]);

      expect(await rowsAt()).to.deep.equal([]);
      expect(await events.countDocuments({ ip: OLD })).to.equal(0);
    });
  });
});
