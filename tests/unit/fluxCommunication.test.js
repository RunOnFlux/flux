/* eslint-disable no-underscore-dangle */
const sinon = require('sinon');
const WebSocket = require('ws');
const { expect } = require('chai');
const LRU = require('lru-cache');
const log = require('../../ZelBack/src/lib/log');
const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const appsService = require('../../ZelBack/src/services/appsService');
const generalService = require('../../ZelBack/src/services/generalService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
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
      sinon.stub(appsService, 'storeAppTemporaryMessage').returns(true);
      const fromIp = '127.0.0.5';
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
      wsOutgoing._socket = {
        remoteAddress: '127.8.8.1',
        end: sinon.fake(() => true),
      };
      outgoingConnections.push(wsOutgoing);

      const wsIncoming = await connectWs(wsuri2);
      wsIncoming._socket = {
        remoteAddress: '::ffff:127.8.8.1',
        end: sinon.fake(() => true),
      };
      incomingConnections.push(wsIncoming);

      const messageString = JSON.stringify(message);
      const wsListOut = outgoingConnections.filter((client) => client._socket.remoteAddress !== fromIp);
      const wsListIn = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIp);

      await fluxCommunication.handleAppMessages(message, fromIp);

      sinon.assert.calledOnceWithExactly(sendToAllPeersSpy, messageString, wsListOut);
      sinon.assert.calledOnceWithExactly(sendToAllIncomingConnectionsSpy, messageString, wsListIn);
    }).timeout(10000);

    it('should not send broadcast if signature is invalid', async () => {
      const fromIp = '127.0.0.5';
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

      await fluxCommunication.handleAppMessages(message, fromIp);

      sinon.assert.notCalled(sendToAllPeersSpy);
      sinon.assert.notCalled(sendToAllIncomingConnectionsSpy);
    });

    it('should not send broadcast if app data is invalid', async () => {
      const fromIp = '127.0.0.5';
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

      await fluxCommunication.handleAppMessages(message, fromIp);

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
      const fromIp = '127.0.0.5';
      const type = 'fluxappregister';
      const name = 'myApp';
      const version = 1;
      const timestamp = new Date().getTime();
      const broadcastedAt = new Date().getTime();
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
      wsOutgoing._socket = { remoteAddress: '127.8.8.1' };
      outgoingConnections.push(wsOutgoing);

      const wsIncoming = await connectWs(wsuri2);
      wsIncoming._socket = { remoteAddress: '::ffff:127.8.8.1' };
      incomingConnections.push(wsIncoming);

      const messageString = JSON.stringify(message);
      const wsListOut = outgoingConnections.filter((client) => client._socket.remoteAddress !== fromIp);
      const wsListIn = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIp);

      await fluxCommunication.handleAppRunningMessage(message, fromIp);

      sinon.assert.calledOnceWithExactly(sendToAllPeersSpy, messageString, wsListOut);
      sinon.assert.calledOnceWithExactly(sendToAllIncomingConnectionsSpy, messageString, wsListIn);
    }).timeout(10000);

    it('should not send broadcast if message is older than 3900 seconds', async () => {
      const fromIp = '127.0.0.5';
      const type = 'fluxappregister';
      const name = 'myApp';
      const version = 1;
      const timestamp = 1592988806887;
      const broadcastedAt = new Date().getTime() - (80 * 60 * 1000);
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
      wsOutgoing._socket = {
        remoteAddress: '127.8.8.1',
        end: sinon.fake(() => true),
      };
      outgoingConnections.push(wsOutgoing);

      const wsIncoming = await connectWs(wsuri2);
      wsIncoming._socket = {
        remoteAddress: '::ffff:127.8.8.1',
        end: sinon.fake(() => true),
      };
      incomingConnections.push(wsIncoming);

      await fluxCommunication.handleAppRunningMessage(message, fromIp);

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
      const wsOutgoing1 = await connectWs(wsuri);
      wsOutgoing1._socket = { remoteAddress: '127.8.8.1', end: sinon.fake(() => true) };
      outgoingConnections.push(wsOutgoing1);
      const wsOutgoing2 = await connectWs(wsuri2);
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
        lastPingTime: null,
        latency: null,
      };
      const peer2 = {
        ip: '192.168.0.0', // can represent just one ip address, multiport
        lastPingTime: new Date().getTime(),
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
        lastPingTime: null,
        latency: null,
      };
      const peer2 = {
        ip: '192.168.0.0',
        lastPingTime: new Date().getTime(),
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
      const wsOutgoing1 = await connectWs(wsuri);
      wsOutgoing1._socket = { remoteAddress: '127.0.3.1' };
      wsOutgoing1.close = () => true;
      outgoingConnections.push(wsOutgoing1);
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Outgoing connection to 127.0.3.1 closed',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
        },
      };
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();

      const result = await fluxCommunication.removePeer(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    }).timeout(5000);

    it('should close the connection with ip given in query if it exists', async () => {
      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const wsOutgoing1 = await connectWs(wsuri);
      wsOutgoing1._socket = { remoteAddress: '127.0.3.1' };
      wsOutgoing1.close = () => true;
      outgoingConnections.push(wsOutgoing1);
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Outgoing connection to 127.0.3.1 closed',
        },
      };
      const req = {
        params: {
          test: 'test',
        },
        query: {
          ip: '127.0.3.1',
        },
      };
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();

      const result = await fluxCommunication.removePeer(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });

    it('should issue a warning if a connection does not exist', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'Connection to 127.0.3.1 does not exists.',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
        },
      };
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();

      const result = await fluxCommunication.removePeer(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });

    it('should issue an error message if ip is not provided', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'No IP address specified.',
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
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();

      const result = await fluxCommunication.removePeer(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.neverCalledWith(verificationHelperStub);
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
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();

      const result = await fluxCommunication.removePeer(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });
  });

  describe('removeIncomingPeer tests', () => {
    let verificationHelperStub;

    beforeEach(() => {
      incomingConnections.length = 0;
      incomingPeers.length = 0;

      const peer1 = {
        ip: '127.0.3.1',
        lastPingTime: null,
        latency: null,
      };
      const peer2 = {
        ip: '192.168.0.0',
        lastPingTime: new Date().getTime(),
        latency: 50,
      };
      incomingPeers.push(peer1);
      incomingPeers.push(peer2);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should close the connection with ip given in params if it exists', async () => {
      const wsuri1 = 'wss://api.runonflux.io/ws/flux/';
      const wsIncoming1 = await connectWs(wsuri1);
      wsIncoming1._socket = { remoteAddress: '127.0.3.1' };
      wsIncoming1.close = () => true;
      incomingConnections.push(wsIncoming1);
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Incoming connection to 127.0.3.1 closed',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
        },
      };
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();
      const expressWsList = { clients: [wsIncoming1] };

      const result = await fluxCommunication.removeIncomingPeer(req, res, expressWsList);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    }).timeout(5000);

    it('should close the connection with ip given in query if it exists', async () => {
      const wsuri1 = 'wss://api.runonflux.io/ws/flux/';
      const wsIncoming1 = await connectWs(wsuri1);
      wsIncoming1._socket = { remoteAddress: '127.0.3.1' };
      wsIncoming1.close = () => true;
      incomingConnections.push(wsIncoming1);
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Incoming connection to 127.0.3.1 closed',
        },
      };
      const req = {
        params: {
          test: 'test',
        },
        query: {
          ip: '127.0.3.1',
        },
      };
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();
      const expressWsList = { clients: [wsIncoming1] };

      const result = await fluxCommunication.removeIncomingPeer(req, res, expressWsList);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    }).timeout(5000);

    it('should issue a warning if a connection does not exist', async () => {
      const wsuri1 = 'wss://api.runonflux.io/ws/flux/';
      const wsIncoming1 = await connectWs(wsuri1);
      wsIncoming1._socket = { remoteAddress: '128.1.3.4' };
      wsIncoming1.close = () => true;
      incomingConnections.push(wsIncoming1);
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'Connection from 127.0.3.1 does not exists.',
        },
      };
      const req = {
        params: {
          ip: '127.0.3.1',
        },
      };
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();
      const expressWsList = { clients: [wsIncoming1] };

      const result = await fluxCommunication.removeIncomingPeer(req, res, expressWsList);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });

    it('should issue an error message if ip is not provided', async () => {
      verificationHelperStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      const expectedResult = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'No IP address specified.',
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
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();

      const result = await fluxCommunication.removeIncomingPeer(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.neverCalledWith(verificationHelperStub);
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
      const generateResponse = () => {
        const res = { test: 'testing' };
        res.status = sinon.stub().returns(res);
        res.json = sinon.fake((param) => param);
        return res;
      };
      const res = generateResponse();

      const result = await fluxCommunication.removeIncomingPeer(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verificationHelperStub, 'adminandfluxteam', req);
    });
  });

  describe('initiateAndHandleConnection tests', () => {
    let wsserver;
    let logSpy;
    let lruRateLimitStub;
    let ensureObjectSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'info');
      lruRateLimitStub = sinon.stub(fluxNetworkHelper, 'lruRateLimit');
      ensureObjectSpy = sinon.spy(serviceHelper, 'ensureObject');
      outgoingConnections.length = 0;
      outgoingPeers.length = 0;
    });

    afterEach(() => {
      sinon.restore();
      wsserver.close();
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
      wsserver = new WebSocket.Server({ host: '127.0.0.2', port: '16127' });

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
        wss.on('connection', () => {
          wss.close();
          resolve();
        });
        // eslint-disable-next-line no-param-reassign
        wss.onerror = (err) => {
          reject(err);
        };
      });
      const ip = '127.0.0.2';
      wsserver = new WebSocket.Server({ host: '127.0.0.2', port: '16127' });

      await fluxCommunication.initiateAndHandleConnection(ip);

      await waitForWsConnected(wsserver);
      // slight delay to let onopen to be triggered
      await serviceHelper.delay(100);

      expect(outgoingConnections).to.have.length(0);
      expect(outgoingPeers).to.have.length(0);
      sinon.assert.calledWith(logSpy, 'Connection to 127.0.0.2 closed with code 1006');
      sinon.assert.calledWith(logSpy, 'Connection 127.0.0.2 removed from outgoingPeers');
    });

    it('should not react to the message if rate limit is exceeded', async () => {
      const waitForWsConnected = (wss) => new Promise((resolve, reject) => {
        wss.on('connection', (ws) => {
          ws.send('message');
          resolve();
        });
        // eslint-disable-next-line no-param-reassign
        wss.onerror = (err) => {
          reject(err);
        };
      });
      const ip = '127.0.0.2';
      wsserver = new WebSocket.Server({ host: '127.0.0.2', port: '16127' });
      lruRateLimitStub.returns(false);

      await fluxCommunication.initiateAndHandleConnection(ip);

      await waitForWsConnected(wsserver);
      // slight delay to let onopen to be triggered
      await serviceHelper.delay(100);

      sinon.assert.notCalled(ensureObjectSpy);
    });

    it('should close the connection if peer is added to blockedList', async () => {
      const message = JSON.stringify({
        pubKey: '1234asd',
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
      wsserver = new WebSocket.Server({ host: '127.0.0.2', port: '16127' });
      lruRateLimitStub.returns(true);
      sinon.stub(LRU.prototype, 'has').returns(true);
      const websocketCloseSpy = sinon.spy(WebSocket.prototype, 'close');

      await fluxCommunication.initiateAndHandleConnection(ip);

      await waitForWsConnected(wsserver);
      // slight delay to let onopen to be triggered
      await serviceHelper.delay(100);

      sinon.assert.calledOnceWithExactly(ensureObjectSpy, message);
      sinon.assert.calledWithExactly(websocketCloseSpy, 1000, 'blocked list');
      sinon.assert.calledWith(logSpy, 'Closing outgoing connection, peer is on blockedList');
      sinon.assert.calledWith(logSpy, 'Connection to 127.0.0.2 closed with code 1000');
      sinon.assert.calledWith(logSpy, 'Connection 127.0.0.2 removed from outgoingPeers');
    });

    const appRequestCommands = ['fluxapprequest'];
    // eslint-disable-next-line no-restricted-syntax
    for (const command of appRequestCommands) {
      // eslint-disable-next-line no-loop-func
      it(`should handle the ${command} message properly`, async () => {
        const message = JSON.stringify({
          timestamp: new Date().getTime(),
          pubKey: '1234asd',
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
        wsserver = new WebSocket.Server({ host: '127.0.0.2', port: '16127' });
        lruRateLimitStub.returns(true);
        sinon.stub(LRU.prototype, 'has').returns(false);
        const verifyOriginalFluxBroadcastStub = sinon.stub(fluxCommunicationUtils, 'verifyOriginalFluxBroadcast').returns(true);
        const respondWithAppMessageStub = sinon.stub(fluxCommunicationMessagesSender, 'respondWithAppMessage').returns(true);

        await fluxCommunication.initiateAndHandleConnection(ip);

        await waitForWsConnected(wsserver);
        // slight delay to let onopen to be triggered
        await serviceHelper.delay(100);

        sinon.assert.calledOnceWithExactly(verifyOriginalFluxBroadcastStub, JSON.parse(message), undefined, sinon.match.number);
        sinon.assert.calledWith(respondWithAppMessageStub, JSON.parse(message));
      });
    }

    const registerUpdateAppList = ['zelappregister', 'zelappupdate', 'fluxappregister', 'fluxappupdate'];
    // eslint-disable-next-line no-restricted-syntax
    for (const command of registerUpdateAppList) {
      // eslint-disable-next-line no-loop-func
      it(`should handle the ${command} message properly`, async () => {
        const message = JSON.stringify({
          timestamp: new Date().getTime(),
          pubKey: '1234asd',
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
        wsserver = new WebSocket.Server({ host: '127.0.0.2', port: '16127' });
        lruRateLimitStub.returns(true);
        sinon.stub(LRU.prototype, 'has').returns(false);
        const verifyOriginalFluxBroadcastStub = sinon.stub(fluxCommunicationUtils, 'verifyOriginalFluxBroadcast').returns(true);
        const storeAppTemporaryMessageStub = sinon.stub(appsService, 'storeAppTemporaryMessage').returns(false);

        await fluxCommunication.initiateAndHandleConnection(ip);

        await waitForWsConnected(wsserver);
        // slight delay to let onopen to be triggered
        await serviceHelper.delay(100);

        sinon.assert.calledOnceWithExactly(verifyOriginalFluxBroadcastStub, JSON.parse(message), undefined, sinon.match.number);
        sinon.assert.calledOnceWithExactly(storeAppTemporaryMessageStub, JSON.parse(message).data, true);
      });
    }

    const appRunningMessageList = ['fluxapprunning'];
    // eslint-disable-next-line no-restricted-syntax
    for (const command of appRunningMessageList) {
      // eslint-disable-next-line no-loop-func
      it(`should handle the ${command} message properly`, async () => {
        const message = JSON.stringify({
          timestamp: new Date().getTime(),
          pubKey: '1234asd',
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
        wsserver = new WebSocket.Server({ host: '127.0.0.2', port: '16127' });
        lruRateLimitStub.returns(true);
        sinon.stub(LRU.prototype, 'has').returns(false);
        const verifyOriginalFluxBroadcastStub = sinon.stub(fluxCommunicationUtils, 'verifyOriginalFluxBroadcast').returns(true);
        const storeAppRunningMessageStub = sinon.stub(appsService, 'storeAppRunningMessage').returns(false);

        await fluxCommunication.initiateAndHandleConnection(ip);

        await waitForWsConnected(wsserver);
        // slight delay to let onopen to be triggered
        await serviceHelper.delay(100);

        sinon.assert.calledOnceWithExactly(verifyOriginalFluxBroadcastStub, JSON.parse(message), undefined, sinon.match.number);
        sinon.assert.calledOnceWithExactly(storeAppRunningMessageStub, JSON.parse(message).data);
      });
    }
  });

  describe('addPeer tests', () => {
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

    it('should return an error message if ip is undefined', async () => {
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test2: 'test2',
        },
      };
      const res = generateResponse();
      const expectedMessage = {
        status: 'error',
        data: {
          code: undefined,
          message: 'No IP address specified.',
          name: undefined,
        },
      };

      const result = await fluxCommunication.addPeer(req, res);

      expect(result).to.eql(expectedMessage);
    });

    it('should return an error message if ip is null', async () => {
      const req = {
        params: {
          ip: null,
        },
        query: {
          ip: null,
        },
      };
      const res = generateResponse();
      const expectedMessage = {
        status: 'error',
        data: {
          code: undefined,
          message: 'No IP address specified.',
          name: undefined,
        },
      };

      const result = await fluxCommunication.addPeer(req, res);

      expect(result).to.eql(expectedMessage);
    });

    it('should return error message if peer is already added', async () => {
      const ip = '123.4.1.1';
      const req = {
        params: {
          ip,
        },
      };
      const res = generateResponse();
      const expectedMessage = {
        status: 'error',
        data: {
          code: undefined,
          message: `Already connected to ${ip}`,
          name: undefined,
        },
      };
      outgoingConnections.push({ _socket: { remoteAddress: ip } });

      const result = await fluxCommunication.addPeer(req, res);

      expect(result).to.eql(expectedMessage);
    });

    it('should return error message if user is unauthorized', async () => {
      const ip = '123.4.1.1';
      const req = {
        params: {
          ip,
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
      const verificationStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);

      const result = await fluxCommunication.addPeer(req, res);

      expect(result).to.eql(expectedMessage);
      sinon.assert.calledOnceWithExactly(verificationStub, 'adminandfluxteam', req);
    });

    it('should return success message if connection can be initiated', async () => {
      const ip = '123.4.1.1';
      const req = {
        params: {
          ip,
        },
      };
      const res = generateResponse();
      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          message: 'Outgoing connection to 123.4.1.1 initiated',
          name: undefined,
        },
      };
      const verificationStub = sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);

      const result = await fluxCommunication.addPeer(req, res);

      expect(result).to.eql(expectedMessage);
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
        {
          ip: '44.192.51.12:16127',
        },
        {
          ip: '44.192.51.13:16127',
        },
        {
          ip: '44.192.51.14:16127',
        },
        {
          ip: '44.192.51.15:16127',
        },
        {
          ip: '44.192.51.16:16127',
        },
        {
          ip: '44.192.51.17:16127',
        },
        {
          ip: '44.192.51.18:16127',
        },
        {
          ip: '44.192.51.19:16127',
        },
        {
          ip: '44.192.51.20:16127',
        },
        {
          ip: '44.192.51.11:16127',
        },
      ];
      sinon.stub(fluxNetworkHelper, 'getMyFluxIPandPort').returns('44.192.51.11:16127');
      fluxNetworkHelper.setMyFluxIp('44.192.51.11');
      sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').returns(fluxNodeList);
      sinon.stub(serviceHelper, 'delay').resolves(() => new Promise((resolve) => setTimeout(resolve, 50)));
      const infoSpy = sinon.spy(log, 'info');
      daemonServiceStub.returns({
        data: {
          synced: true,
        },
      });

      await fluxCommunication.fluxDiscovery();

      sinon.assert.calledWith(infoSpy, 'Current number of outgoing connections:0');
      sinon.assert.calledWith(infoSpy, 'Current number of incoming connections:0');
      // eslint-disable-next-line no-restricted-syntax
      for (const node of fluxNodeList) {
        if (node.ip !== '44.192.51.11:16127') {
          sinon.assert.calledWith(infoSpy, `Adding Flux peer: ${node.ip}`);
        }
      }
    });
  });
});
