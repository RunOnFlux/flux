/* eslint-disable no-underscore-dangle */
const sinon = require('sinon');
const WebSocket = require('ws');

const { expect } = require('chai');
const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const { outgoingConnections } = require('../../ZelBack/src/services/utils/outgoingConnections');
const { outgoingPeers } = require('../../ZelBack/src/services/utils/outgoingPeers');
const { incomingPeers } = require('../../ZelBack/src/services/utils/incomingPeers');
const { incomingConnections } = require('../../ZelBack/src/services/utils/incomingConnections');

const connectWs = (address) => new Promise(((resolve, reject) => {
  const server = new WebSocket(address);
  server.onopen = () => {
    resolve(server);
  };
  server.onerror = (err) => {
    reject(err);
  };
}));

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

    it.only('should broadcast the app message if a proper data is given', async () => {
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
      wsOutgoing._socket = { remoteAddress: '127.8.8.1' };
      outgoingConnections.push(wsOutgoing);

      const wsIncoming = await connectWs(wsuri2);
      wsIncoming._socket = { remoteAddress: '::ffff:127.8.8.1' };
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
      const timestamp = 1592988806887;
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
      wsOutgoing._socket = { remoteAddress: '127.8.8.1' };
      outgoingConnections.push(wsOutgoing);

      const wsIncoming = await connectWs(wsuri2);
      wsIncoming._socket = { remoteAddress: '::ffff:127.8.8.1' };
      incomingConnections.push(wsIncoming);

      await fluxCommunication.handleAppRunningMessage(message, fromIp);

      sinon.assert.notCalled(sendToAllPeersSpy);
      sinon.assert.notCalled(sendToAllIncomingConnectionsSpy);
    }).timeout(5000);
  });

  describe('connectedPeeers tests', () => {
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

    it('should return connected peers\'s ips', async () => {
      const wsuri = 'wss://api.runonflux.io/ws/flux/';
      const wsuri2 = 'wss://api.runonflux.io/ws/flux2/';
      const wsOutgoing1 = await connectWs(wsuri);
      wsOutgoing1._socket = { remoteAddress: '127.8.8.1' };
      outgoingConnections.push(wsOutgoing1);
      const wsOutgoing2 = await connectWs(wsuri2);
      wsOutgoing2._socket = { remoteAddress: '127.8.8.2' };
      outgoingConnections.push(wsOutgoing2);
      const expectedResult = { status: 'success', data: ['127.8.8.1', '127.8.8.2'] };

      const res = generateResponse();

      await fluxCommunication.connectedPeers(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });

    it('should empty list if no peers are connected', async () => {
      const res = generateResponse();
      const expectedResult = { status: 'success', data: [] };

      await fluxCommunication.connectedPeers(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
    });
  });

  describe('connectedPeeersInfo tests', () => {
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
    });

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

  describe('isCommunicationEstablished tests', () => {
    const minNumberOfIncoming = 2;
    const minNumberOfOutgoing = 5;
    const dummyPeer = {
      ip: '192.168.0.0',
      lastPingTime: new Date().getTime(),
      latency: 50,
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };
    const populatePeers = (numberOfincomingPeers, numberOfOutgoingPeers) => {
      outgoingPeers.length = 0;
      incomingPeers.length = 0;
      for (let i = 0; i < numberOfincomingPeers; i += 1) {
        incomingPeers.push(dummyPeer);
      }
      for (let i = 0; i < numberOfOutgoingPeers; i += 1) {
        outgoingPeers.push(dummyPeer);
      }
    };
    const expectedSuccesssResponse = {
      status: 'success',
      data: {
        code: undefined,
        name: undefined,
        message: 'Communication to Flux network is properly established',
      },
    };
    const expectedErrorResponse = {
      status: 'error',
      data: {
        code: undefined,
        name: undefined,
        message: 'Not enough connections established to Flux network',
      },
    };

    afterEach(() => {
      outgoingPeers.length = 0;
      incomingPeers.length = 0;
      sinon.restore();
    });

    it('should return a positive respone if communication is established properly', () => {
      const res = generateResponse();
      populatePeers(minNumberOfIncoming, minNumberOfOutgoing);

      fluxCommunication.isCommunicationEstablished(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccesssResponse);
    });

    it('should return a negative respone if there are not enough incoming peers', () => {
      const res = generateResponse();
      populatePeers(minNumberOfIncoming - 1, minNumberOfOutgoing);

      fluxCommunication.isCommunicationEstablished(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorResponse);
    });

    it('should return a negative respone if there are not enough outgoing peers', () => {
      const res = generateResponse();
      populatePeers(minNumberOfIncoming, minNumberOfOutgoing - 1);

      fluxCommunication.isCommunicationEstablished(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorResponse);
    });

    it('should return a negative respone if there are not enough incoming or outgoing peers', () => {
      const res = generateResponse();
      populatePeers(minNumberOfIncoming - 1, minNumberOfOutgoing - 1);

      fluxCommunication.isCommunicationEstablished(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorResponse);
    });
  });

  describe.skip('initiateAndHandleConnection tests', () => {
    it('should initiate connection', async () => {
      fluxCommunication.initiateAndHandleConnection();
    });
  });
});
