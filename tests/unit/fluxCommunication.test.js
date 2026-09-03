/* eslint-disable no-underscore-dangle */
const sinon = require('sinon');
const WebSocket = require('ws');
const { expect } = require('chai');
const log = require('../../ZelBack/src/lib/log');
const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const { FluxTTLCache } = require('../../ZelBack/src/services/utils/cacheManager');
const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const { requireMongo } = require('./dbTestHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const nodeConfirmationService = require('../../ZelBack/src/services/nodeConfirmationService');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const generalService = require('../../ZelBack/src/services/generalService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const { peerManager } = require('../../ZelBack/src/services/utils/peerState');
const { PEER_SOURCE } = require('../../ZelBack/src/services/utils/FluxPeerSocket');
const rateLimit = require('../../ZelBack/src/services/utils/rateLimit');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('../../ZelBack/src/services/utils/appSyncEvents');

let localWsServer;
let localWsUrl;

const connectWs = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(localWsUrl);
  ws.onopen = () => {
    resolve(ws);
  };
  ws.onerror = (err) => {
    reject(err);
  };
});

/**
 * Poll until predicate returns true, or timeout.
 * @param {Function} predicate - returns truthy when condition is met
 * @param {number} [timeout=3000]
 * @param {number} [interval=10]
 */
function waitFor(predicate, timeout = 3000, interval = 10) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('waitFor timed out'));
      return setTimeout(check, interval);
    };
    check();
  });
}

describe('fluxCommunication tests', () => {
  before((done) => {
    localWsServer = new WebSocket.Server({ port: 0 }, () => {
      const { port } = localWsServer.address();
      localWsUrl = `ws://127.0.0.1:${port}`;
      done();
    });
  });

  after((done) => {
    // Force-close any lingering client connections (tests override ws.close with a no-op)
    localWsServer.clients.forEach((client) => client.terminate());
    localWsServer.close(done);
  });

  describe('initializeDiscovery tests', () => {
    // Being confirmed is not the same as being ready to peer. Every message an
    // inbound peer sends is checked against the node list, so a peer admitted
    // before the list arrives is refused however legitimate it is. Measured at
    // 1391ms on a live node holding 6091 nodes - short, but it is the whole of
    // the window the node was turning real peers away in.
    let onConfirmationChange;
    let onReady;
    let allowConnections;
    let disconnectAll;

    beforeEach(() => {
      onConfirmationChange = sinon.stub(nodeConfirmationService, 'onConfirmationChange');
      onReady = sinon.stub(networkStateService, 'onReady');
      allowConnections = sinon.stub(peerManager, 'allowConnections');
      disconnectAll = sinon.stub(peerManager, 'disconnectAll');
      sinon.stub(log, 'info');
    });

    afterEach(() => {
      sinon.restore();
    });

    // Runs initializeDiscovery and hands back the confirmation callback it
    // registered, which is the only way into this code.
    function confirmationHandler() {
      fluxCommunication.initializeDiscovery();

      expect(onConfirmationChange.calledOnce).to.equal(true);

      return onConfirmationChange.firstCall.args[0];
    }

    it('does not accept peers on confirmation alone', () => {
      const confirmed = confirmationHandler();

      confirmed(true);

      expect(onReady.calledOnce).to.equal(true);
      expect(allowConnections.called).to.equal(false);
    });

    it('accepts peers once the node list has arrived', () => {
      sinon.stub(nodeConfirmationService, 'isConfirmed').returns(true);

      const confirmed = confirmationHandler();

      confirmed(true);
      onReady.firstCall.args[0]();

      expect(allowConnections.calledOnce).to.equal(true);
    });

    it('does not re-open after confirmation is lost while waiting for the list', () => {
      // onReady fires whenever the list lands, which can be after a
      // disconnectAll. Without the re-check this hands the door straight back.
      const isConfirmed = sinon.stub(nodeConfirmationService, 'isConfirmed');
      const confirmed = confirmationHandler();

      confirmed(true);

      isConfirmed.returns(false);
      confirmed(false);

      onReady.firstCall.args[0]();

      expect(disconnectAll.calledOnce).to.equal(true);
      expect(allowConnections.called).to.equal(false);
    });

    it('disconnects every peer when confirmation is lost, without consulting the list', () => {
      const confirmed = confirmationHandler();

      confirmed(false);

      expect(disconnectAll.calledOnce).to.equal(true);
      expect(onReady.called).to.equal(false);
      expect(allowConnections.called).to.equal(false);
    });
  });

  describe('handleAppMessages tests', () => {
    const privateKey = 'KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD';
    const ownerAddress = '13ienDRfUwFEgfZxm5dk4drTQsmj5hDGwL';
    let relaySpy;

    before(requireMongo);

    beforeEach(async () => {
      peerManager.reset();
      await dbHelper.initiateDB();
      relaySpy = sinon.stub(fluxCommunicationMessagesSender, 'relay').resolves(true);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast the app message if a proper data is given', async () => {
      sinon.stub(messageStore, 'storeAppTemporaryMessage').returns(true);
      const fromIp = '127.0.0.5';
      const port = '16127';
      const appSpecifications = {
        name: 'website',
        commands: [
          '--chain',
          'kusama',
        ],
        containerData: '/chaindata',
        cpu: 0.8,
        description: 'This is my test app',
        domains: [
          'testing.runonflux.io',
          'testing.runonflux.io',
          'testing.runonflux.io',
        ],
        enviromentParameters: [],
        hdd: 20,
        owner: ownerAddress,
        ram: 1800,
        repotag: 'yurinnick/folding-at-home:latest',
        tiered: false,
        containerPorts: [
          '30333',
          '9933',
          '9944',
        ],
        ports: [
          '31113',
          '31112',
          '31111',
        ],
        version: 2,
      };
      const type = 'fluxappregister';
      const version = 1;
      const timestamp = 1592988806887;
      const messageToSign = type + version + JSON.stringify(appSpecifications) + timestamp;
      const signature = verificationHelper.signMessage(messageToSign, privateKey);
      const messageToHash = type + version + JSON.stringify(appSpecifications) + timestamp + signature;
      const hash = await generalService.messageHash(messageToHash);
      const message = {
        data:
        {
          type,
          version,
          appSpecifications,
          timestamp,
          signature,
          hash,
        },
      };

      const wsOutgoing = await connectWs();
      wsOutgoing.ip = '127.8.8.1';
      wsOutgoing.port = port;
      wsOutgoing._socket = {
        remoteAddress: '127.8.8.1',
        end: sinon.fake(() => true),
      };
      wsOutgoing.on = sinon.stub();
      peerManager.add(wsOutgoing, wsOutgoing.ip, port, { source: PEER_SOURCE.RANDOM });

      const wsIncoming = await connectWs();
      wsIncoming.ip = '127.8.8.1';
      wsIncoming.port = port;
      wsIncoming._socket = {
        remoteAddress: '::ffff:127.8.8.1',
        end: sinon.fake(() => true),
      };
      wsIncoming.on = sinon.stub();
      peerManager.add(wsIncoming, wsIncoming.ip, port, { source: PEER_SOURCE.INBOUND });

      const messageString = JSON.stringify(message);

      await fluxCommunication.handleAppMessages(message, fromIp, port);

      sinon.assert.calledOnceWithExactly(relaySpy, messageString, `${fromIp}:${port}`);
    }).timeout(10000);

    it('should not send broadcast if signature is invalid', async () => {
      const fromIp = '127.0.0.5';
      const port = '16127';
      const appSpecifications = {
        name: 'website',
        commands: [
          '--chain',
          'kusama',
        ],
        containerData: '/chaindata',
        cpu: 0.8,
        description: 'This is my test app',
        domains: [
          'testing.runonflux.io',
          'testing.runonflux.io',
          'testing.runonflux.io',
        ],
        enviromentParameters: [],
        hdd: 20,
        owner: ownerAddress,
        ram: 1800,
        repotag: 'yurinnick/folding-at-home:latest',
        tiered: false,
        containerPorts: [
          '30333',
          '9933',
          '9944',
        ],
        ports: [
          '31113',
          '31112',
          '31111',
        ],
        version: 2,
      };
      const type = 'fluxappregister';
      const version = 1;
      const timestamp = 1592988806887;
      const signature = 'testing1234invalidsignature';
      const messageToHash = type + version + JSON.stringify(appSpecifications) + timestamp + signature;
      const hash = await generalService.messageHash(messageToHash);
      const message = {
        data:
        {
          type,
          version,
          appSpecifications,
          timestamp,
          signature,
          hash,
        },
      };

      await fluxCommunication.handleAppMessages(message, fromIp, port);

      sinon.assert.notCalled(relaySpy);
    });

    it('should not send broadcast if app data is invalid', async () => {
      const fromIp = '127.0.0.5';
      const port = '16127';
      const appSpecifications = {
        name: 'website',
        randomProperty: 'testing1',
      };
      const type = 'fluxappregister';
      const version = 1;
      const timestamp = 1592988806887;
      const messageToSign = type + version + JSON.stringify(appSpecifications) + timestamp;
      const signature = verificationHelper.signMessage(messageToSign, privateKey);
      const messageToHash = type + version + JSON.stringify(appSpecifications) + timestamp + signature;
      const hash = await generalService.messageHash(messageToHash);
      const message = {
        data:
        {
          type,
          version,
          appSpecifications,
          timestamp,
          signature,
          hash,
        },
      };

      await fluxCommunication.handleAppMessages(message, fromIp, port);

      sinon.assert.notCalled(relaySpy);
    });
  });

  describe('handleAppRunningMessage tests', () => {
    let relaySpy;

    before(requireMongo);

    beforeEach(async () => {
      peerManager.reset();
      await dbHelper.initiateDB();
      relaySpy = sinon.stub(fluxCommunicationMessagesSender, 'relay').resolves(true);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast the app message if a proper data is given', async () => {
      sinon.stub(messageStore, 'storeAppRunningMessage').resolves({ stored: true, rebroadcast: true });
      sinon.stub(messageStore, 'storeAppStateEvent');
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 0 } });
      const fromIp = '127.0.0.5';
      const port = '16127';
      const type = 'fluxappregister';
      const name = 'myApp';
      const version = 1;
      const timestamp = Date.now();
      const broadcastedAt = Date.now();
      const messageToHash = type + version + name + timestamp;
      const hash = await generalService.messageHash(messageToHash);
      const message = {
        data:
        {
          type,
          name,
          broadcastedAt,
          version,
          hash,
          ip: fromIp,
        },
        timestamp,
      };

      const messageString = JSON.stringify(message);

      await fluxCommunication.handleAppRunningMessage(message, fromIp, port);

      sinon.assert.calledOnceWithExactly(relaySpy, messageString, `${fromIp}:${port}`);
    }).timeout(10000);

    it('should not send broadcast if message is older than 3900 seconds', async () => {
      const fromIp = '127.0.0.5';
      const port = '16127';
      const type = 'fluxappregister';
      const name = 'myApp';
      const version = 1;
      const timestamp = 1592988806887;
      const broadcastedAt = Date.now() - (80 * 60 * 1000);
      const messageToHash = type + version + name + timestamp;
      const hash = await generalService.messageHash(messageToHash);
      const message = {
        data:
        {
          type,
          name,
          broadcastedAt,
          version,
          timestamp,
          hash,
          ip: fromIp,
        },
      };

      const wsOutgoing = await connectWs();
      wsOutgoing.ip = '127.8.8.1';
      wsOutgoing.port = port;
      wsOutgoing._socket = {
        remoteAddress: '127.8.8.1',
        end: sinon.fake(() => true),
      };
      wsOutgoing.on = sinon.stub();
      peerManager.add(wsOutgoing, wsOutgoing.ip, port, { source: PEER_SOURCE.RANDOM });

      const wsIncoming = await connectWs();
      wsIncoming.ip = '127.8.8.1';
      wsIncoming.port = port;
      wsIncoming._socket = {
        remoteAddress: '::ffff:127.8.8.1',
        end: sinon.fake(() => true),
      };
      wsIncoming.on = sinon.stub();
      peerManager.add(wsIncoming, wsIncoming.ip, port, { source: PEER_SOURCE.INBOUND });

      await fluxCommunication.handleAppRunningMessage(message, fromIp, port);

      sinon.assert.notCalled(relaySpy);
    }).timeout(5000);
  });


  describe('connectedPeers tests', () => {
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      peerManager.reset();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return connected peers\' ips', async () => {
      const port = '16127';
      const wsOutgoing1 = await connectWs();
      wsOutgoing1.ip = '127.8.8.1';
      wsOutgoing1.port = port;
      wsOutgoing1._socket = { remoteAddress: '127.8.8.1', end: sinon.fake(() => true) };
      wsOutgoing1.on = sinon.stub();
      peerManager.add(wsOutgoing1, wsOutgoing1.ip, port, { source: PEER_SOURCE.RANDOM });

      const wsOutgoing2 = await connectWs();
      wsOutgoing2.ip = '127.8.8.2';
      wsOutgoing2.port = port;
      wsOutgoing2._socket = { remoteAddress: '127.8.8.2', end: sinon.fake(() => true) };
      wsOutgoing2.on = sinon.stub();
      peerManager.add(wsOutgoing2, wsOutgoing2.ip, port, { source: PEER_SOURCE.RANDOM });

      const expectedResult = { status: 'success', data: ['127.8.8.1', '127.8.8.2'] };

      const res = generateResponse();

      await fluxCommunication.connectedPeers(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    }).timeout(5000);

    it('should empty list if no peers are connected', async () => {
      const res = generateResponse();
      const expectedResult = { status: 'success', data: [] };

      await fluxCommunication.connectedPeers(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });
  });

  describe('connectedPeersInfo tests', () => {
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      peerManager.reset();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return connected connected websockets', async () => {
      // peerManager.add creates FluxPeerSocket objects whose toPeerInfo() returns
      // { ip, port, latency: null, lastPingTime: null } for outbound peers
      const ws1 = await connectWs();
      ws1.ip = '127.0.3.1';
      ws1.port = '16127';
      ws1.on = sinon.stub();
      peerManager.add(ws1, '127.0.3.1', '16127', { source: PEER_SOURCE.RANDOM });

      const ws2 = await connectWs();
      ws2.ip = '192.168.0.0';
      ws2.port = '16127';
      ws2.on = sinon.stub();
      peerManager.add(ws2, '192.168.0.0', '16127', { source: PEER_SOURCE.RANDOM });

      const expectedResult = {
        status: 'success',
        data: [
          {
            ip: '127.0.3.1',
            port: '16127',
            latency: null,
            lastPingTime: null,
          },
          {
            ip: '192.168.0.0',
            port: '16127',
            latency: null,
            lastPingTime: null,
          },
        ],
      };

      const res = generateResponse();

      await fluxCommunication.connectedPeersInfo(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });

    it('should empty list if no peers are connected', async () => {
      const res = generateResponse();
      const expectedResult = { status: 'success', data: [] };

      await fluxCommunication.connectedPeersInfo(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });
  });

  describe('removePeer tests', () => {
    let verificationHelperStub;

    beforeEach(async () => {
      peerManager.reset();

      // Add two outbound peers via peerManager
      const ws1 = await connectWs();
      ws1.ip = '127.0.3.1';
      ws1.port = '16127';
      ws1.close = () => true;
      ws1.on = sinon.stub();
      peerManager.add(ws1, '127.0.3.1', '16127', { source: PEER_SOURCE.RANDOM });

      const ws2 = await connectWs();
      ws2.ip = '192.168.0.0';
      ws2.port = '16137';
      ws2.close = () => true;
      ws2.on = sinon.stub();
      peerManager.add(ws2, '192.168.0.0', '16137', { source: PEER_SOURCE.RANDOM });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should close the connection with ip given in params if it exists', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Outgoing connection to 127.0.3.1:16127 closed',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
          port: 16127,
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removePeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    }).timeout(5000);

    it('should close the connection with ip given in query if it exists', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Outgoing connection to 127.0.3.1:16127 closed',
        },
      };
      const req = {
        params: {
          test: 'test',
        },
        query: {
          ip: '127.0.3.1',
          port: 16127,
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removePeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });

    it('should issue a warning if a connection does not exist', async () => {
      // Clear peers so none exist
      peerManager.reset();
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'Connection to 127.0.3.1:16127 does not exists.',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
          port: 16127,
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removePeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });

    it('should issue an error message if ip is not provided', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Unparsable `ip` parameter',
        },
      };
      const req = {
        params: {
          test: 'test1',
        },
        query: {
          test2: 'test3',
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removePeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });

    it('should issue an error message if user is unauthorized', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      const expectedResult = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
          port: 16127,
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removePeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });
  });

  describe('removeIncomingPeer tests', () => {
    let verificationHelperStub;

    beforeEach(async () => {
      peerManager.reset();

      const port = '16127';

      const wsIncoming1 = await connectWs();
      wsIncoming1.ip = '127.0.3.1';
      wsIncoming1.port = port;
      wsIncoming1.close = () => true;
      wsIncoming1.on = sinon.stub();
      peerManager.add(wsIncoming1, '127.0.3.1', port, { source: PEER_SOURCE.INBOUND });

      const wsIncoming2 = await connectWs();
      wsIncoming2.ip = '192.168.0.0';
      wsIncoming2.port = port;
      wsIncoming2.close = () => true;
      wsIncoming2.on = sinon.stub();
      peerManager.add(wsIncoming2, '192.168.0.0', port, { source: PEER_SOURCE.INBOUND });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should close the connection with ip given in params if it exists', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Incoming connection to 127.0.3.1:16127 closed',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
          port: 16127,
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removeIncomingPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    }).timeout(5000);

    it('should close the connection with ip given in query if it exists', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Incoming connection to 127.0.3.1:16127 closed',
        },
      };
      const req = {
        params: {
          test: 'test',
        },
        query: {
          ip: '127.0.3.1',
          port: 16127,
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removeIncomingPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    }).timeout(5000);

    it('should issue a warning if a connection does not exist', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'Connection from 127.0.4.1:16127 does not exists.',
        },
      };
      const req = {
        params: {
          ip: '127.0.4.1',
          port: 16127,
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removeIncomingPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });

    it('should issue an error message if ip is not provided', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Unparsable `ip` parameter',
        },
      };
      const req = {
        params: {
          test: 'test1',
        },
        query: {
          test2: 'test3',
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removeIncomingPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });

    it('should issue an error message if user is unauthorized', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      const expectedResult = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
        },
      };

      const generateResponse = () => ({
        status: sinon.stub(),
        json: sinon.stub(),
      });

      const res = generateResponse();

      await fluxCommunication.removeIncomingPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });
  });

  describe('initiateAndHandleConnection refuses this node itself', () => {
    beforeEach(() => {
      peerManager.reset();
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').returns('44.192.51.11:16127');
    });

    afterEach(() => {
      sinon.restore();
      peerManager.reset();
    });

    // Every outbound dial arrives here - manual, deterministic, reconnect and
    // random - and only one of those callers filtered its own address before
    // calling. The reconnect queue in particular re-dials whatever it holds
    // without asking whose address it is. A self-connection is not just a wasted
    // socket: it takes a peer slot, is offered back as a peer to gossip and to
    // sync from, and answers every question with what this node already knows.
    it('refuses to connect to this node\'s own address', async () => {
      peerManager.reset();

      await fluxCommunication.initiateAndHandleConnection('44.192.51.11:16127');

      expect(peerManager.outboundCount).to.equal(0);
      expect(peerManager.isPending('44.192.51.11:16127'), 'left itself marked pending').to.equal(false);
    });

    it('still connects to a different node at the same port', async () => {
      peerManager.reset();

      await fluxCommunication.initiateAndHandleConnection('44.192.51.12:16127').catch(() => {});

      expect(peerManager.has('44.192.51.11:16127')).to.equal(false);
    });

  });

  // Where the dial gets that address from. Asking benchmark is an uncached RPC
  // and this runs on every attempt - discovery's deterministic loop, the
  // reconnect queue, the random draw, the manual add and /flux/addpeer - so it
  // asks the peer manager, which is told every refresh by the one place the node
  // learns what it is, and already answers this same question for the sync draw.
  describe('initiateAndHandleConnection asks the owner for this node\'s address', () => {
    let fetched;

    beforeEach(() => {
      peerManager.reset();
      peerManager.setOwnSocketAddress(null);
      fetched = sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').resolves('44.192.51.11:16127');
    });

    afterEach(() => {
      sinon.restore();
      peerManager.reset();
      peerManager.setOwnSocketAddress(null);
    });

    it('does not ask benchmark once the node has been told its own address', async () => {
      peerManager.setOwnSocketAddress('44.192.51.11:16127');

      await fluxCommunication.initiateAndHandleConnection('44.192.51.11:16127');

      sinon.assert.notCalled(fetched);
      expect(peerManager.outboundCount, 'dialled itself').to.equal(0);
    });

    // The value the owner holds is the one that decides, so a dial refuses
    // itself on it - not on whatever benchmark would have said.
    it('refuses this node on the address the owner holds', async () => {
      peerManager.setOwnSocketAddress('44.192.51.99:16127');

      await fluxCommunication.initiateAndHandleConnection('44.192.51.99:16127');

      sinon.assert.notCalled(fetched);
      expect(peerManager.isPending('44.192.51.99:16127'), 'left itself marked pending').to.equal(false);
    });

    // A dial can arrive before the first refresh has happened. Asking once then
    // is right; asking every time is what this replaces.
    it('asks once when the node has not been told yet', async () => {
      await fluxCommunication.initiateAndHandleConnection('44.192.51.11:16127');

      sinon.assert.calledOnce(fetched);
      expect(peerManager.outboundCount).to.equal(0);
    });
  });

  describe('initiateAndHandleConnection tests', () => {
    before(function () { if (process.platform !== 'linux') this.skip(); });

    let wsserver;
    let logSpy;
    let lruRateLimitStub;
    let daemonServiceMiscRpcsStub;
    let ensureObjectSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'info');
      lruRateLimitStub = sinon.stub(rateLimit, 'lruRateLimit').returns(true);
      ensureObjectSpy = sinon.spy(serviceHelper, 'ensureObject');
      peerManager.reset();
      daemonServiceMiscRpcsStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').returns('44.192.51.11:16127');
    });

    afterEach(() => {
      sinon.restore();
      if (wsserver && typeof wsserver.close === 'function') {
        wsserver.close();
      }
    });

    it('Should add server to outgoing connections after connection have been established', async () => {
      const waitForWsConnected = (wss) => new Promise((resolve, reject) => {
        wss.on('connection', () => {
          resolve();
        });
        // eslint-disable-next-line no-param-reassign
        wss.onerror = (err) => {
          reject(err);
        };
      });
      const ip = '127.0.0.2';
      wsserver = new WebSocket.Server({ host: '127.0.0.2', port: 16127 });
      daemonServiceMiscRpcsStub.returns({
        data:
        {
          synced: false,
          height: 0,
        },
      });
      await fluxCommunication.initiateAndHandleConnection(ip);

      await waitForWsConnected(wsserver);
      await waitFor(() => peerManager.outboundCount === 1);

      const peer = peerManager.get(`${ip}:16127`);
      expect(peer).to.not.be.undefined;
      expect(peer.ip).to.equal(ip);
    });

    it('should remove peer if server has closed', async () => {
      const waitForWsConnected = (wss) => new Promise((resolve, reject) => {
        wss.on('connection', (ws) => {
          // Close the websocket connection from server side
          setTimeout(() => {
            ws.close();
            wss.close();
          }, 100);
          resolve();
        });
        // eslint-disable-next-line no-param-reassign
        wss.onerror = (err) => {
          reject(err);
        };
      });
      const ip = '127.0.0.2';
      wsserver = new WebSocket.Server({ host: '127.0.0.2', port: 16127 });
      daemonServiceMiscRpcsStub.returns({
        data:
        {
          synced: false,
          height: 0,
        },
      });

      await fluxCommunication.initiateAndHandleConnection(ip);

      await waitForWsConnected(wsserver);

      // Wait for the close event to be processed
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (peerManager.outboundCount === 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        // Timeout after 3 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 3000);
      });

      expect(peerManager.outboundCount).to.equal(0);
      sinon.assert.calledWith(logSpy, 'Outgoing connection to 127.0.0.2:16127 closed with code 1005');
      sinon.assert.calledWith(logSpy, 'Connection 127.0.0.2:16127 removed from peerManager (outbound, code: 1005)');
    }).timeout(5000);

    it('should not react to the message if rate limit is exceeded', async () => {
      const message = JSON.stringify({
        timestamp: Date.now(),
        pubKey: '1234asd',
        data: {
          type: 'fluxapprunning',
        },
      });
      const waitForWsConnected = (wss) => new Promise((resolve, reject) => {
        wss.on('connection', (ws) => {
          ws.send(message);
          resolve();
        });
        // eslint-disable-next-line no-param-reassign
        wss.onerror = (err) => {
          reject(err);
        };
      });
      const ip = '127.0.0.2';
      wsserver = new WebSocket.Server({ host: '127.0.0.2', port: 16127 });
      daemonServiceMiscRpcsStub.returns({
        data:
        {
          synced: false,
          height: 0,
        },
      });
      lruRateLimitStub.returns(false);
      const checkObjectSpy = sinon.spy(fluxCommunicationUtils, 'verifyOriginalFluxBroadcast');
      await fluxCommunication.initiateAndHandleConnection(ip);

      await waitForWsConnected(wsserver);
      await waitFor(() => peerManager.outboundCount === 1);

      sinon.assert.notCalled(checkObjectSpy);
    });

    it('should close the connection if peer is added to blockedList', async () => {
      const message = JSON.stringify({
        timestamp: Date.now(),
        pubKey: '1234asd',
        signature: 'blabla',
        version: 1,
        data: {
          type: 'fluxapprunning',
        },
      });
      const waitForWsConnected = (wss) => new Promise((resolve, reject) => {
        wss.on('connection', (ws) => {
          ws.send(message);
          resolve();
        });
        // eslint-disable-next-line no-param-reassign
        wss.onerror = (err) => {
          reject(err);
        };
      });
      const ip = '127.0.0.2';
      wsserver = new WebSocket.Server({ host: '127.0.0.2', port: 16127 });
      daemonServiceMiscRpcsStub.returns({
        data:
        {
          synced: false,
          height: 0,
        },
      });
      lruRateLimitStub.returns(true);
      const hasCacheStub = sinon.stub(FluxTTLCache.prototype, 'has');
      hasCacheStub.withArgs('1234asd').returns(true);
      const websocketCloseSpy = sinon.spy(WebSocket.prototype, 'close');

      await fluxCommunication.initiateAndHandleConnection(ip);

      await waitForWsConnected(wsserver);
      // Wait for the full close cycle: close() → onclose → remove()
      await waitFor(() => logSpy.calledWith('Connection 127.0.0.2:16127 removed from peerManager (outbound, code: 4006)'));

      sinon.assert.calledWithExactly(ensureObjectSpy, message);
      sinon.assert.calledWithExactly(websocketCloseSpy, 4006, 'blocked list');
      sinon.assert.calledWith(logSpy, 'Closing outbound connection, peer is on blockedList');
      sinon.assert.calledWith(logSpy, 'Outgoing connection to 127.0.0.2:16127 closed with code 4006');
      sinon.assert.calledWith(logSpy, 'Connection 127.0.0.2:16127 removed from peerManager (outbound, code: 4006)');
    });

    const appRequestCommands = ['fluxapprequest'];
    // eslint-disable-next-line no-restricted-syntax
    for (const command of appRequestCommands) {
      // eslint-disable-next-line no-loop-func
      it(`should handle the ${command} message properly`, async () => {
        const message = JSON.stringify({
          timestamp: Date.now(),
          pubKey: '1234asd',
          signature: 'blabla',
          version: 1,
          data: {
            type: `${command}`,
          },
        });
        const waitForWsConnected = (wss) => new Promise((resolve, reject) => {
          wss.on('connection', (ws) => {
            ws.send(message);
            resolve();
          });
          // eslint-disable-next-line no-param-reassign
          wss.onerror = (err) => {
            reject(err);
          };
        });
        const ip = '127.0.0.2';
        wsserver = new WebSocket.Server({ host: '127.0.0.2', port: 16127 });
        lruRateLimitStub.returns(true);
        sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
        const verifyFluxBroadcastStub = sinon.stub(fluxCommunicationUtils, 'verifyFluxBroadcast').returns(fluxCommunicationUtils.VerifyResult.OK);
        sinon.stub(fluxCommunicationUtils, 'verifyTimestampInFluxBroadcast').returns(true);
        const respondWithAppMessageStub = sinon.stub(fluxCommunicationMessagesSender, 'respondWithAppMessage').returns(true);
        daemonServiceMiscRpcsStub.returns({
          data:
          {
            synced: false,
            height: 0,
          },
        });
        await fluxCommunication.initiateAndHandleConnection(ip);

        await waitForWsConnected(wsserver);
        await waitFor(() => respondWithAppMessageStub.called);

        sinon.assert.calledOnceWithExactly(verifyFluxBroadcastStub, JSON.parse(message), undefined, sinon.match.number);
        sinon.assert.calledWith(respondWithAppMessageStub, JSON.parse(message));
      });
    }

    const registerUpdateAppList = ['zelappregister', 'zelappupdate', 'fluxappregister', 'fluxappupdate'];
    // eslint-disable-next-line no-restricted-syntax
    for (const command of registerUpdateAppList) {
      // eslint-disable-next-line no-loop-func
      it(`should handle the ${command} message properly`, async () => {
        const message = JSON.stringify({
          timestamp: Date.now(),
          pubKey: '1234asd',
          signature: 'blabla',
          version: 1,
          data: {
            type: `${command}`,
          },
        });
        const waitForWsConnected = (wss) => new Promise((resolve, reject) => {
          wss.on('connection', (ws) => {
            ws.send(message);
            resolve();
          });
          // eslint-disable-next-line no-param-reassign
          wss.onerror = (err) => {
            reject(err);
          };
        });
        const ip = '127.0.0.2';
        wsserver = new WebSocket.Server({ host: '127.0.0.2', port: 16127 });
        lruRateLimitStub.returns(true);
        sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
        const verifyFluxBroadcast = sinon.stub(fluxCommunicationUtils, 'verifyFluxBroadcast').returns(fluxCommunicationUtils.VerifyResult.OK);
        sinon.stub(fluxCommunicationUtils, 'verifyTimestampInFluxBroadcast').returns(true);
        const storeAppTemporaryMessageStub = sinon.stub(messageStore, 'storeAppTemporaryMessage').returns(false);
        daemonServiceMiscRpcsStub.returns({
          data:
          {
            synced: false,
            height: 0,
          },
        });
        await fluxCommunication.initiateAndHandleConnection(ip);

        await waitForWsConnected(wsserver);
        await waitFor(() => storeAppTemporaryMessageStub.called);

        sinon.assert.calledOnceWithExactly(verifyFluxBroadcast, JSON.parse(message), undefined, sinon.match.number);
        sinon.assert.calledOnceWithExactly(storeAppTemporaryMessageStub, JSON.parse(message).data);
      });
    }

    const appRunningMessageList = ['fluxapprunning'];
    // eslint-disable-next-line no-restricted-syntax
    for (const command of appRunningMessageList) {
      // eslint-disable-next-line no-loop-func
      it(`should handle the ${command} message properly`, async () => {
        const message = JSON.stringify({
          timestamp: Date.now(),
          pubKey: '1234asd',
          signature: 'blabla',
          version: 1,
          data: {
            type: `${command}`,
          },
        });
        const waitForWsConnected = (wss) => new Promise((resolve, reject) => {
          wss.on('connection', (ws) => {
            ws.send(message);
            resolve();
          });
          // eslint-disable-next-line no-param-reassign
          wss.onerror = (err) => {
            reject(err);
          };
        });
        const ip = '127.0.0.2';
        wsserver = new WebSocket.Server({ host: '127.0.0.2', port: 16127 });
        lruRateLimitStub.returns(true);
        sinon.stub(FluxTTLCache.prototype, 'has').returns(false);
        const verifyFluxBroadcast = sinon.stub(fluxCommunicationUtils, 'verifyFluxBroadcast').returns(fluxCommunicationUtils.VerifyResult.OK);
        sinon.stub(fluxCommunicationUtils, 'verifyTimestampInFluxBroadcast').returns(true);
        const storeAppRunningMessageStub = sinon.stub(messageStore, 'storeAppRunningMessage').returns(false);
        daemonServiceMiscRpcsStub.returns({
          data:
          {
            synced: false,
            height: 0,
          },
        });
        await fluxCommunication.initiateAndHandleConnection(ip);

        await waitForWsConnected(wsserver);
        await waitFor(() => storeAppRunningMessageStub.called);

        sinon.assert.calledOnceWithExactly(verifyFluxBroadcast, JSON.parse(message), undefined, sinon.match.number);
        sinon.assert.calledOnceWithExactly(storeAppRunningMessageStub, JSON.parse(message).data);
      });
    }
  });

  describe('addPeer tests', () => {
    const generateResponse = () => ({
      status: sinon.stub(),
      json: sinon.stub(),
    });

    beforeEach(() => {
      peerManager.reset();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return an error message if ip is undefined', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);

      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };

      const res = generateResponse();

      const expectedResult = {
        status: 'error',
        data: {
          code: undefined,
          message: 'Unparsable `ip` parameter',
          name: undefined,
        },
      };

      await fluxCommunication.addPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });

    it('should return an error message if ip is null', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);

      const req = {
        params: {
          ip: null,
        },
        query: {
          ip: null,
        },
      };

      const res = generateResponse();

      const expectedResult = {
        status: 'error',
        data: {
          code: undefined,
          message: 'Unparsable `ip` parameter',
          name: undefined,
        },
      };

      await fluxCommunication.addPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });

    it('should return error message if peer is already added', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);

      const ip = '123.4.1.1';
      const port = '16127';

      const req = {
        params: {
          ip,
          port,
        },
      };

      const expectedResult = {
        status: 'error',
        data: {
          code: undefined,
          message: `Already connected to ${ip}:${port}`,
          name: undefined,
        },
      };

      // Add the peer via peerManager so addPeer sees it as already connected
      const socket = await connectWs();
      socket.ip = ip;
      socket.port = port;
      socket.on = sinon.stub();
      peerManager.add(socket, ip, port, { source: PEER_SOURCE.RANDOM });

      const res = generateResponse();

      await fluxCommunication.addPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });

    it('should return error message if user is unauthorized', async () => {
      const ip = '123.4.1.1';
      const port = '16127';
      const req = {
        params: {
          ip,
          port,
        },
      };

      const res = generateResponse();

      const expectedMessage = {
        status: 'error',
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);

      await fluxCommunication.addPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedMessage);
    });

    it('should return success message if connection can be initiated', async () => {
      const ip = '123.4.1.1';
      const port = '16127';
      const req = {
        params: {
          ip,
          port,
        },
      };

      const res = generateResponse();

      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          message: 'Outgoing connection to 123.4.1.1:16127 initiated',
          name: undefined,
        },
      };

      const verificationStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);

      await fluxCommunication.addPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedMessage);
      sinon.assert.calledOnceWithExactly(verificationStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });
  });

  describe('fluxDiscovery tests', () => {
    let logSpy;
    let daemonServiceStub;
    beforeEach(() => {
      // Discovery reschedules itself on both its success and failure paths, by
      // design. Left real, that timer outlives this file and keeps dialling
      // peers against restored stubs for the rest of the run.
      sinon.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
      logSpy = sinon.spy(log, 'warn');
      daemonServiceStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should send warning if deamon is not synced', async () => {
      daemonServiceStub.returns({
        data: {
          synced: false,
        },
      });
      await fluxCommunication.fluxDiscovery();

      sinon.assert.calledOnceWithExactly(logSpy, 'Daemon not yet synced. Flux discovery is awaiting.');
    });

    it('should return warning if ip cannot be detected', async () => {
      sinon.stub(nodeConfirmationService, 'isConfirmed').returns(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').returns(null);
      daemonServiceStub.returns({
        data: {
          synced: true,
        },
      });

      await fluxCommunication.fluxDiscovery();

      sinon.assert.calledOnceWithExactly(logSpy, 'Flux IP not detected. Flux discovery is awaiting.');
    });

    it('should return warning if node is not confirmed', async () => {
      sinon.stub(nodeConfirmationService, 'isConfirmed').returns(false);
      daemonServiceStub.returns({
        data: {
          synced: true,
        },
      });

      await fluxCommunication.fluxDiscovery();

      sinon.assert.calledOnceWithExactly(logSpy, 'Node not confirmed. Flux discovery is awaiting.');
    });

    it('should start connecting nodes if everything is set up properly', async () => {
      const fluxNodeList = [
        '44.192.51.10',
        '44.192.51.12',
        '44.192.51.13:16137',
        '44.192.51.14:16147',
        '44.192.51.15:16157',
        '44.192.51.16:16167',
        '44.192.51.17:16177',
        '44.192.51.18:16187',
        '44.192.51.19:16197',
        '44.192.51.11',
      ];

      sinon.stub(nodeConfirmationService, 'isConfirmed').returns(true);
      sinon.stub(fluxNetworkHelper, 'getLocalSocketAddress').returns('44.192.51.11');
      fluxNetworkHelper.setLocalSocketAddress('44.192.51.11');
      sinon.stub(fluxCommunicationUtils, 'getFluxnodeFromFluxList').returns('44.192.51.11');
      sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').returns(fluxNodeList);

      // Mock delay to return immediately
      sinon.stub(serviceHelper, 'delay').resolves();

      // everything being set up properly now includes knowing the network
      sinon.stub(networkStateService, 'isReady').returns(true);

      // Mock different addresses to avoid infinite loop
      const addresses = ['1.2.3.4:16137', '1.2.3.5:16137', '1.2.3.6:16137'];
      let addressIndex = 0;
      sinon.stub(networkStateService, 'getRandomSocketAddress').callsFake(() => {
        const address = addresses[addressIndex % addresses.length];
        addressIndex += 1;
        return Promise.resolve(address);
      });

      // Stub initiateAndHandleConnection to prevent actual connections
      // eslint-disable-next-line no-unused-vars
      const initiateStub = sinon.stub(fluxCommunication, 'initiateAndHandleConnection').resolves();

      const infoSpy = sinon.spy(log, 'info');

      daemonServiceStub.returns({
        data: {
          synced: true,
        },
      });

      const axiosGetResponse = {
        data: {
          status: 'success',
          data: {
            message: 'all is good!',
          },
        },
      };
      sinon.stub(serviceHelper, 'axiosGet').resolves(axiosGetResponse);

      // Start fluxDiscovery and wait for it to make connection attempts
      // eslint-disable-next-line no-unused-vars
      const discoveryPromise = fluxCommunication.fluxDiscovery();

      // Wait for the discovery logic to execute and make at least one connection attempt
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify the expected log calls were made
      sinon.assert.calledWith(infoSpy, 'Searching for my node on sortedNodeList');
      sinon.assert.calledWith(infoSpy, 'My node was found on index: 9 of 10 nodes');

      // Verify that connection process started by checking for peer addition logs
      const addPeerCalls = infoSpy.getCalls().filter((call) => call.args[0] && call.args[0].includes('Adding random Flux peer'));

      // The test passes if we see peer addition logs (which happen right before connections)
      expect(addPeerCalls.length).to.be.at.least(1);
    }).timeout(5000);
  });

  describe('handleNodeSigtermMessage tests', () => {
    let relaySpy;
    let findInDatabaseStub;
    let updateInDatabaseStub;
    let logInfoSpy;

    before(requireMongo);

    beforeEach(async () => {
      peerManager.reset();
      await dbHelper.initiateDB();
      relaySpy = sinon.stub(fluxCommunicationMessagesSender, 'relay').resolves(true);
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 1000000 } });

      // Mock database operations
      const mockDb = {
        db: sinon.stub().returns({
          collection: sinon.stub(),
        }),
      };
      sinon.stub(dbHelper, 'databaseConnection').returns(mockDb);
      findInDatabaseStub = sinon.stub(dbHelper, 'findInDatabase');
      updateInDatabaseStub = sinon.stub(dbHelper, 'updateInDatabase').resolves();
      sinon.stub(messageStore, 'storeAppStateEvent');
      sinon.stub(registryManager, 'appLocationFromEvents').resolves([]);

      logInfoSpy = sinon.spy(log, 'info');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should process sigterm message and rebroadcast when apps exist for the node', async () => {
      const fromIp = '127.0.0.5';
      const port = '16127';
      const broadcastedAt = Date.now();
      const message = {
        data: {
          type: 'fluxnodesigterm',
          ip: '192.168.1.100:16127',
          broadcastedAt,
          version: 1,
        },
        timestamp: broadcastedAt,
      };

      registryManager.appLocationFromEvents.resolves([{ name: 'app1', ip: '192.168.1.100:16127' }, { name: 'app2', ip: '192.168.1.100:16127' }]);

      const wsOutgoing = await connectWs();
      wsOutgoing.ip = '127.8.8.1';
      wsOutgoing.port = port;
      wsOutgoing._socket = { remoteAddress: '127.8.8.1' };
      wsOutgoing.on = sinon.stub();
      peerManager.add(wsOutgoing, wsOutgoing.ip, port, { source: PEER_SOURCE.RANDOM });

      await fluxCommunication.handleNodeSigtermMessage(message, fromIp, port);

      sinon.assert.calledWith(logInfoSpy, sinon.match(/Received SIGTERM notification from node/));
      sinon.assert.calledWith(logInfoSpy, sinon.match(/Found 2 apps for node/));
      sinon.assert.calledOnce(updateInDatabaseStub);
      sinon.assert.calledOnce(relaySpy);
    }).timeout(10000);

    it('should not rebroadcast when no apps exist for the node', async () => {
      const fromIp = '127.0.0.5';
      const port = '16127';
      const broadcastedAt = Date.now();
      const message = {
        data: {
          type: 'fluxnodesigterm',
          ip: '192.168.1.100:16127',
          broadcastedAt,
          version: 1,
        },
        timestamp: broadcastedAt,
      };

      // appLocationFromEvents defaults to [] (no apps for this IP)

      await fluxCommunication.handleNodeSigtermMessage(message, fromIp, port);

      sinon.assert.calledWith(logInfoSpy, sinon.match(/No apps found for node.*event log view/));
      sinon.assert.notCalled(updateInDatabaseStub);
      sinon.assert.notCalled(relaySpy);
    });

    it('should not rebroadcast when message timestamp is too old', async () => {
      const fromIp = '127.0.0.5';
      const port = '16127';
      const broadcastedAt = Date.now() - (5 * 60 * 1000); // 5 minutes ago (exceeds 4 minute limit)
      const message = {
        data: {
          type: 'fluxnodesigterm',
          ip: '192.168.1.100:16127',
          broadcastedAt,
          version: 1,
        },
        timestamp: broadcastedAt,
      };

      await fluxCommunication.handleNodeSigtermMessage(message, fromIp, port);

      // Should not proceed to database lookup
      sinon.assert.notCalled(findInDatabaseStub);
      sinon.assert.notCalled(relaySpy);
    });

    it('should exclude sender from rebroadcast list', async () => {
      const fromIp = '127.0.0.5';
      const port = '16127';
      const broadcastedAt = Date.now();
      const message = {
        data: {
          type: 'fluxnodesigterm',
          ip: '192.168.1.100:16127',
          broadcastedAt,
          version: 1,
        },
        timestamp: broadcastedAt,
      };

      registryManager.appLocationFromEvents.resolves([{ name: 'app1', ip: '192.168.1.100:16127' }]);

      // Add sender connection
      const wsSender = await connectWs();
      wsSender.ip = fromIp;
      wsSender.port = port;
      wsSender._socket = { remoteAddress: fromIp };
      wsSender.on = sinon.stub();
      peerManager.add(wsSender, fromIp, port, { source: PEER_SOURCE.RANDOM });

      // Add another connection
      const wsOther = await connectWs();
      wsOther.ip = '127.8.8.1';
      wsOther.port = port;
      wsOther._socket = { remoteAddress: '127.8.8.1' };
      wsOther.on = sinon.stub();
      peerManager.add(wsOther, wsOther.ip, port, { source: PEER_SOURCE.RANDOM });

      await fluxCommunication.handleNodeSigtermMessage(message, fromIp, port);

      // Verify that relay was called with the sender's key as the excludeKey
      sinon.assert.calledOnce(relaySpy);
      const excludeKey = relaySpy.getCall(0).args[1];
      expect(excludeKey).to.equal(`${fromIp}:${port}`);
    }).timeout(10000);

    it('should handle null apps result gracefully', async () => {
      const fromIp = '127.0.0.5';
      const port = '16127';
      const broadcastedAt = Date.now();
      const message = {
        data: {
          type: 'fluxnodesigterm',
          ip: '192.168.1.100:16127',
          broadcastedAt,
          version: 1,
        },
        timestamp: broadcastedAt,
      };

      registryManager.appLocationFromEvents.resolves(null);

      await fluxCommunication.handleNodeSigtermMessage(message, fromIp, port);

      sinon.assert.calledWith(logInfoSpy, sinon.match(/No apps found for node.*event log view/));
      sinon.assert.notCalled(relaySpy);
    });
  });

  // Completion is counted per peer, so a completion that does not say which
  // peer it came from cannot be counted at all. These handlers have had the key
  // in scope all along - they log it, and publish it on sync:chunkVerified two
  // lines earlier - and this is what makes them hand it on.
  describe('a sync response says which peer completed it, and whether it declined', () => {
    const PEER = '198.51.100.7:16127';
    let completions;
    let refusals;
    let progress;
    let handler;
    let refusedHandler;
    let progressHandler;

    beforeEach(() => {
      completions = [];
      refusals = [];
      progress = [];
      handler = (syncType, peerKey) => completions.push({ syncType, peerKey });
      refusedHandler = (syncType, peerKey) => refusals.push({ syncType, peerKey });
      progressHandler = (syncType, peerKey) => progress.push({ syncType, peerKey });
      appSyncEvents.on(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, handler);
      appSyncEvents.on(SYNC_EVENTS.EPHEMERAL_SYNC_REFUSED, refusedHandler);
      appSyncEvents.on(SYNC_EVENTS.EPHEMERAL_SYNC_PROGRESS, progressHandler);
      peerManager.markSyncRequested(PEER);
      // An empty final batch is the whole path here: processInSlices does
      // nothing, and apprunning's pruning is the only step that needs a store.
      sinon.stub(messageStore, 'pruneAppRunningLocations').resolves();
      sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({ collection: () => ({}) }) });
    });

    afterEach(() => {
      appSyncEvents.removeListener(SYNC_EVENTS.EPHEMERAL_SYNC_COMPLETE, handler);
      appSyncEvents.removeListener(SYNC_EVENTS.EPHEMERAL_SYNC_REFUSED, refusedHandler);
      appSyncEvents.removeListener(SYNC_EVENTS.EPHEMERAL_SYNC_PROGRESS, progressHandler);
      peerManager.clearSyncRequested();
      sinon.restore();
    });

    const cases = [
      ['apprunning', 'fluxapprunningsync', 'handleAppRunningSyncResponse'],
      ['appinstalling', 'fluxappinstallingsync', 'handleAppInstallingSyncResponse'],
      ['apperrors', 'fluxappinstallingerrorssync', 'handleAppInstallingErrorsSyncResponse'],
    ];

    cases.forEach(([syncType, wireType, fn]) => {
      it(`names the peer on the ${syncType} completion`, async () => {
        await fluxCommunication[fn]({ data: { type: wireType, messages: [], done: true } }, PEER);

        expect(completions).to.deep.equal([{ syncType, peerKey: PEER }]);
      });

      it(`says nothing until the ${syncType} response is done`, async () => {
        await fluxCommunication[fn]({ data: { type: wireType, messages: [], done: false } }, PEER);

        expect(completions).to.deep.equal([]);
      });

      // Declining is an answer, and it is not a completion. Counting it was the
      // defect: three booting peers could tell a node the network was empty.
      it(`reports a declined ${syncType} response as a refusal, not a completion`, async () => {
        await fluxCommunication[fn]({ data: { type: wireType, messages: [], done: true, refused: true } }, PEER);

        expect(refusals).to.deep.equal([{ syncType, peerKey: PEER }]);
        expect(completions, 'a refusal was counted as a completed survey').to.deep.equal([]);
      });

      // A network with nothing running answers with an empty list, and that IS
      // a survey. If it read as a refusal such a fleet would never sync.
      it(`counts an empty ${syncType} response as a completion`, async () => {
        await fluxCommunication[fn]({ data: { type: wireType, messages: [], done: true } }, PEER);

        expect(completions).to.deep.equal([{ syncType, peerKey: PEER }]);
        expect(refusals).to.deep.equal([]);
      });

      // The asker's slot clock has nothing else to read. A completion only
      // arrives at the end, so without this a peer part-way through a large
      // answer is indistinguishable from one that has said nothing at all.
      it(`reports every ${syncType} batch as progress, not only the last`, async () => {
        await fluxCommunication[fn]({ data: { type: wireType, messages: [], done: false } }, PEER);
        await fluxCommunication[fn]({ data: { type: wireType, messages: [], done: false } }, PEER);
        await fluxCommunication[fn]({ data: { type: wireType, messages: [], done: true } }, PEER);

        expect(progress).to.deep.equal([
          { syncType, peerKey: PEER }, { syncType, peerKey: PEER }, { syncType, peerKey: PEER },
        ]);
        expect(completions, 'a mid-answer batch was counted as a completion').to.deep.equal([{ syncType, peerKey: PEER }]);
      });

      it(`reports no ${syncType} progress for a refusal`, async () => {
        await fluxCommunication[fn]({ data: { type: wireType, messages: [], done: true, refused: true } }, PEER);

        expect(progress, 'a refusal kept its slot alive as though it were working').to.deep.equal([]);
      });
    });
  });
});
