/* eslint-disable no-underscore-dangle */
const sinon = require('sinon');
const WebSocket = require('ws');
const { expect } = require('chai');
const log = require('../../ZelBack/src/lib/log');
const { FluxTTLCache } = require('../../ZelBack/src/services/utils/cacheManager');
const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const generalService = require('../../ZelBack/src/services/generalService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const {
  outgoingConnections, outgoingPeers, incomingPeers, incomingConnections,
} = require('../../ZelBack/src/services/utils/establishedConnections');

const connectWs = (address) => new Promise((resolve, reject) => {
  const server = new WebSocket(address);
  server.onopen = () => {
    resolve(server);
  };
  server.onerror = (err) => {
    reject(err);
  };
});

describe('fluxCommunication tests', () => {
  describe('handleAppMessages tests', () => {
    const privateKey = 'KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD';
    const ownerAddress = '13ienDRfUwFEgfZxm5dk4drTQsmj5hDGwL';
    let sendToAllPeersSpy;
    let sendToAllIncomingConnectionsSpy;

    beforeEach(async () => {
      outgoingConnections.length = 0;
      incomingConnections.length = 0;
      await dbHelper.initiateDB();
      sendToAllPeersSpy = sinon.stub(fluxCommunicationMessagesSender, 'sendToAllPeers').resolves(true);
      sendToAllIncomingConnectionsSpy = sinon.stub(fluxCommunicationMessagesSender, 'sendToAllIncomingConnections').resolves(true);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast the app message if a proper data is given', async () => {
      sinon.stub(messageStore, 'storeAppTemporaryMessage').returns(true);
      const fromIp = '127.0.0.5';
      const port = 16127;
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

      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const wsuri2 = 'wss://api.runonflux.io/ws/flux2/';

      const wsOutgoing = await connectWs(wsuri);
      wsOutgoing.port = port;
      wsOutgoing.ip = '127.8.8.1';
      wsOutgoing._socket = {
        remoteAddress: '127.8.8.1',
        end: sinon.fake(() => true),
      };
      outgoingConnections.push(wsOutgoing);

      const wsIncoming = await connectWs(wsuri2);
      wsIncoming.port = port;
      wsIncoming.ip = '127.8.8.1';
      wsIncoming._socket = {
        remoteAddress: '::ffff:127.8.8.1',
        end: sinon.fake(() => true),
      };
      incomingConnections.push(wsIncoming);

      const messageString = JSON.stringify(message);
      const wsListOut = [];
      outgoingConnections.forEach((client) => {
        if (client._socket.remoteAddress === fromIp && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsListOut.push(client);
        }
      });
      const wsListIn = [];
      incomingConnections.forEach((client) => {
        if (client._socket.remoteAddress.replace('::ffff:', '') === fromIp && client.port === port) {
          // do not broadcast to this peer
        } else {
          wsListIn.push(client);
        }
      });

      await fluxCommunication.handleAppMessages(message, fromIp, port);

      sinon.assert.calledOnceWithExactly(sendToAllPeersSpy, messageString, wsListOut);
      sinon.assert.calledOnceWithExactly(sendToAllIncomingConnectionsSpy, messageString, wsListIn);
    }).timeout(10000);

    it('should not send broadcast if signature is invalid', async () => {
      const fromIp = '127.0.0.5';
      const port = 16127;
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

      sinon.assert.notCalled(sendToAllPeersSpy);
      sinon.assert.notCalled(sendToAllIncomingConnectionsSpy);
    });

    it('should not send broadcast if app data is invalid', async () => {
      const fromIp = '127.0.0.5';
      const port = 16127;
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

      sinon.assert.notCalled(sendToAllPeersSpy);
      sinon.assert.notCalled(sendToAllIncomingConnectionsSpy);
    });
  });

  describe('handleAppRunningMessage tests', () => {
    let sendToAllPeersSpy;
    let sendToAllIncomingConnectionsSpy;

    beforeEach(async () => {
      outgoingConnections.length = 0;
      incomingConnections.length = 0;
      await dbHelper.initiateDB();
      sendToAllPeersSpy = sinon.stub(fluxCommunicationMessagesSender, 'sendToAllPeers').resolves(true);
      sendToAllIncomingConnectionsSpy = sinon.stub(fluxCommunicationMessagesSender, 'sendToAllIncomingConnections').resolves(true);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast the app message if a proper data is given', async () => {
      sinon.stub(messageStore, 'storeAppRunningMessage').returns(true);
      const fromIp = '127.0.0.5';
      const port = 16127;
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

      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const wsuri2 = 'wss://api.runonflux.io/ws/flux2/';

      const wsOutgoing = await connectWs(wsuri);
      wsOutgoing.port = port;
      wsOutgoing.ip = '127.8.8.1';
      wsOutgoing._socket = { remoteAddress: '127.8.8.1' };
      outgoingConnections.push(wsOutgoing);

      const wsIncoming = await connectWs(wsuri2);
      wsIncoming.port = port;
      wsIncoming.ip = '127.8.8.1';
      wsIncoming._socket = { remoteAddress: '::ffff:127.8.8.1' };
      incomingConnections.push(wsIncoming);

      const messageString = JSON.stringify(message);
      const wsListOut = outgoingConnections.filter((client) => client._socket.remoteAddress !== fromIp);
      const wsListIn = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIp);

      await fluxCommunication.handleAppRunningMessage(message, fromIp, port);

      sinon.assert.calledOnceWithExactly(sendToAllPeersSpy, messageString, wsListOut);
      sinon.assert.calledOnceWithExactly(sendToAllIncomingConnectionsSpy, messageString, wsListIn);
    }).timeout(10000);

    it('should not send broadcast if message is older than 3900 seconds', async () => {
      const fromIp = '127.0.0.5';
      const port = 16127;
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

      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const wsuri2 = 'wss://api.runonflux.io/ws/flux2/';

      const wsOutgoing = await connectWs(wsuri);
      wsOutgoing.port = port;
      wsOutgoing.ip = '127.8.8.1';
      wsOutgoing._socket = {
        remoteAddress: '127.8.8.1',
        end: sinon.fake(() => true),
      };
      outgoingConnections.push(wsOutgoing);

      const wsIncoming = await connectWs(wsuri2);
      wsIncoming.port = port;
      wsIncoming.ip = '127.8.8.1';
      wsIncoming._socket = {
        remoteAddress: '::ffff:127.8.8.1',
        end: sinon.fake(() => true),
      };
      incomingConnections.push(wsIncoming);

      await fluxCommunication.handleAppRunningMessage(message, fromIp, port);

      sinon.assert.notCalled(sendToAllPeersSpy);
      sinon.assert.notCalled(sendToAllIncomingConnectionsSpy);
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
      outgoingConnections.length = 0;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return connected peers\' ips', async () => {
      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const wsuri2 = 'wss://api.runonflux.io/ws/flux2/';
      const port = 16127;
      const wsOutgoing1 = await connectWs(wsuri);
      wsOutgoing1.port = port;
      wsOutgoing1.ip = '127.8.8.1';
      wsOutgoing1._socket = { remoteAddress: '127.8.8.1', end: sinon.fake(() => true) };
      outgoingConnections.push(wsOutgoing1);
      const wsOutgoing2 = await connectWs(wsuri2);
      wsOutgoing2.port = port;
      wsOutgoing2.ip = '127.8.8.2';
      wsOutgoing2._socket = { remoteAddress: '127.8.8.2', end: sinon.fake(() => true) };
      outgoingConnections.push(wsOutgoing2);
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
      outgoingPeers.length = 0;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return connected connected websockets', async () => {
      const peer1 = {
        ip: '127.0.3.1', // can represent just one ip address, multiport
        port: 16127,
        lastPingTime: null,
        latency: null,
      };
      const peer2 = {
        ip: '192.168.0.0', // can represent just one ip address, multiport
        port: 16127,
        lastPingTime: Date.now(),
        latency: 50,
      };
      outgoingPeers.push(peer1);
      outgoingPeers.push(peer2);
      const expectedResult = {
        status: 'success',
        data: [
          peer1,
          peer2,
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

    beforeEach(() => {
      outgoingConnections.length = 0;
      outgoingPeers.length = 0;

      const peer1 = {
        ip: '127.0.3.1',
        port: 16127,
        lastPingTime: null,
        latency: null,
      };
      const peer2 = {
        ip: '192.168.0.0',
        port: 16137,
        lastPingTime: Date.now(),
        latency: 50,
      };
      outgoingPeers.push(peer1);
      outgoingPeers.push(peer2);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should close the connection with ip given in params if it exists', async () => {
      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const port = 16127;
      const wsOutgoing1 = await connectWs(wsuri);
      wsOutgoing1.port = port;
      wsOutgoing1.ip = '127.0.3.1';
      wsOutgoing1._socket = { remoteAddress: '127.0.3.1' };
      wsOutgoing1.close = () => true;
      outgoingConnections.push(wsOutgoing1);
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    }).timeout(5000);

    it('should close the connection with ip given in query if it exists', async () => {
      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const port = 16127;
      const wsOutgoing1 = await connectWs(wsuri);
      wsOutgoing1.port = port;
      wsOutgoing1.ip = '127.0.3.1';
      wsOutgoing1._socket = { remoteAddress: '127.0.3.1' };
      wsOutgoing1.close = () => true;
      outgoingConnections.push(wsOutgoing1);
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });

    it('should issue a warning if a connection does not exist', async () => {
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
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
      incomingConnections.length = 0;
      incomingPeers.length = 0;

      const peer1 = {
        ip: '127.0.3.1',
        port: 16127,
        lastPingTime: null,
        latency: null,
      };
      const peer2 = {
        ip: '192.168.0.0',
        port: 16127,
        lastPingTime: Date.now(),
        latency: 50,
      };

      incomingPeers.push(peer1);
      incomingPeers.push(peer2);

      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const port = 16127;

      const wsIncoming1 = await connectWs(wsuri);
      wsIncoming1.port = port;
      wsIncoming1.ip = '127.0.3.1';
      wsIncoming1._socket = { remoteAddress: '127.0.3.1' };
      wsIncoming1.close = () => true;

      const wsIncoming2 = await connectWs(wsuri);
      wsIncoming2.port = port;
      wsIncoming2.ip = '192.168.0.0';
      wsIncoming2._socket = { remoteAddress: '192.168.0.0' };
      wsIncoming2.close = () => true;

      incomingConnections.push(wsIncoming1);
      incomingConnections.push(wsIncoming2);
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
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
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });
  });

  describe('initiateAndHandleConnection tests', () => {
    let wsserver;
    let logSpy;
    let lruRateLimitStub;
    let daemonServiceMiscRpcsStub;
    let ensureObjectSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'info');
      lruRateLimitStub = sinon.stub(fluxNetworkHelper, 'lruRateLimit');
      ensureObjectSpy = sinon.spy(serviceHelper, 'ensureObject');
      outgoingConnections.length = 0;
      outgoingPeers.length = 0;
      daemonServiceMiscRpcsStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').returns('44.192.51.11:16127');
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
      // slight delay to let onopen to be triggered
      await serviceHelper.delay(100);

      expect(outgoingConnections).to.have.length(1);
      expect(outgoingPeers).to.have.length(1);
      expect(outgoingPeers[0].ip).to.equal(ip);
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
          if (outgoingConnections.length === 0 && outgoingPeers.length === 0) {
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

      expect(outgoingConnections).to.have.length(0);
      expect(outgoingPeers).to.have.length(0);
      sinon.assert.calledWith(logSpy, 'Outgoing connection to 127.0.0.2:16127 closed with code 1005');
      sinon.assert.calledWith(logSpy, 'Connection 127.0.0.2:16127 removed from outgoingConnections');
      sinon.assert.calledWith(logSpy, 'Connection 127.0.0.2:16127 removed from outgoingPeers');
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
      // slight delay to let onopen to be triggered
      await serviceHelper.delay(100);

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
      // slight delay to let onopen to be triggered
      await serviceHelper.delay(100);

      sinon.assert.calledWithExactly(ensureObjectSpy, message);
      sinon.assert.calledWithExactly(websocketCloseSpy, 4006, 'blocked list');
      sinon.assert.calledWith(logSpy, 'Closing outgoing connection, peer is on blockedList');
      sinon.assert.calledWith(logSpy, 'Outgoing connection to 127.0.0.2:16127 closed with code 4006');
      sinon.assert.calledWith(logSpy, 'Connection 127.0.0.2:16127 removed from outgoingPeers');
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
        const verifyFluxBroadcastStub = sinon.stub(fluxCommunicationUtils, 'verifyFluxBroadcast').returns(true);
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
        // slight delay to let onopen to be triggered
        await serviceHelper.delay(100);

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
        const verifyFluxBroadcast = sinon.stub(fluxCommunicationUtils, 'verifyFluxBroadcast').returns(true);
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
        // slight delay to let onopen to be triggered
        await serviceHelper.delay(100);

        sinon.assert.calledOnceWithExactly(verifyFluxBroadcast, JSON.parse(message), undefined, sinon.match.number);
        sinon.assert.calledOnceWithExactly(storeAppTemporaryMessageStub, JSON.parse(message).data, true);
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
        const verifyFluxBroadcast = sinon.stub(fluxCommunicationUtils, 'verifyFluxBroadcast').returns(true);
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
        // slight delay to let onopen to be triggered
        await serviceHelper.delay(100);

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
      outgoingConnections.length = 0;
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
      const port = 16127;

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

      const socket = {
        _socket: { remoteAddress: ip },
        port: 16127,
        ip,
      };

      outgoingConnections.push(socket);

      const res = generateResponse();

      await fluxCommunication.addPeer(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });

    it('should return error message if user is unauthorized', async () => {
      const ip = '123.4.1.1';
      const port = 16127;
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
      const port = 16127;
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
      sinon.assert.calledOnceWithExactly(verificationStub, 'adminandfluxteam', req);
    });
  });

  describe('fluxDiscovery tests', () => {
    let logSpy;
    let daemonServiceStub;
    beforeEach(() => {
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
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').returns(null);
      daemonServiceStub.returns({
        data: {
          synced: true,
        },
      });

      await fluxCommunication.fluxDiscovery();

      sinon.assert.calledOnceWithExactly(logSpy, 'Flux IP not detected. Flux discovery is awaiting.');
    });

    it('should return warning if ip is not on the flux node list', async () => {
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').returns('127.1.1.1');
      sinon.stub(fluxCommunicationUtils, 'getFluxnodeFromFluxList').returns(null);

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

      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').returns('44.192.51.11');
      fluxNetworkHelper.setMyFluxIp('44.192.51.11');
      sinon.stub(fluxCommunicationUtils, 'getFluxnodeFromFluxList').returns('44.192.51.11');
      sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').returns(fluxNodeList);

      // Mock delay to return immediately
      sinon.stub(serviceHelper, 'delay').resolves();

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
});
