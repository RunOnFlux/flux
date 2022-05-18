/* eslint-disable no-underscore-dangle */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const WebSocket = require('ws');
const LRU = require('lru-cache');
const { PassThrough } = require('stream');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const daemonService = require('../../ZelBack/src/services/daemonService');
const appsService = require('../../ZelBack/src/services/appsService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const {
  outgoingConnections, outgoingPeers, incomingPeers, incomingConnections,
} = require('../../ZelBack/src/services/utils/establishedConnections');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('fluxCommunicationMessagesSender tests', () => {
  describe('sendToAllPeers tests', () => {
    let closeConnectionStub;
    const addPeerToListOfPeers = (ip) => {
      const peer = {
        ip,
        lastPingTime: 'test',
        latency: 50,
      };
      outgoingPeers.push(peer);
      return peer;
    };

    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      outgoingConnections.push(ws);
      return ws;
    };

    beforeEach(() => {
      closeConnectionStub = sinon.stub(fluxNetworkHelper, 'closeConnection');
      outgoingConnections.length = 0;
      outgoingPeers.length = 0;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should properly send a message to all outgoing connections if they exist', async () => {
      const data = {
        test: 'testing1234',
      };
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const webSocket1 = generateWebsocket(wsIp, WebSocket.OPEN);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);

      await fluxCommunicationMessagesSender.sendToAllPeers(data);

      sinon.assert.calledOnceWithExactly(webSocket1.send, data);
      sinon.assert.calledOnceWithExactly(webSocket2.send, data);
    });

    it('should properly send a message to all outgoing connections if provided in the call', async () => {
      const data = {
        test: 'testing1234',
      };
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const webSocket1 = generateWebsocket(wsIp, WebSocket.OPEN);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);
      outgoingConnections.length = 0;

      await fluxCommunicationMessagesSender.sendToAllPeers(data, [webSocket1, webSocket2]);

      sinon.assert.calledOnceWithExactly(webSocket1.send, data);
      sinon.assert.calledOnceWithExactly(webSocket2.send, data);
    });

    it('should still send a message to other peers if a websocket is closed', async () => {
      const data = {
        test: 'testing1234',
      };
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const webSocket1 = generateWebsocket(wsIp, WebSocket.CLOSED);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);
      outgoingConnections.length = 0;

      await fluxCommunicationMessagesSender.sendToAllPeers(data, [webSocket1, webSocket2]);

      sinon.assert.notCalled(webSocket1.send);
      sinon.assert.calledOnceWithExactly(webSocket2.send, data);
    });

    it('should still send a message to other peers if a websocket throws error', async () => {
      const generateFaultyWebsocket = (ip, readyState) => {
        const ws = {};
        ws.readyState = readyState;
        ws.ping = sinon.stub().returns('pong');
        ws.send = sinon.stub().throws();
        ws._socket = {
          remoteAddress: ip,
        };
        outgoingConnections.push(ws);
        return ws;
      };
      const data = {
        test: 'testing1234',
      };
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const webSocket1 = generateFaultyWebsocket(wsIp, WebSocket.OPEN);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);
      const peer1 = addPeerToListOfPeers(wsIp);
      const peer2 = addPeerToListOfPeers(wsIp2);

      await fluxCommunicationMessagesSender.sendToAllPeers(data, [webSocket1, webSocket2]);

      sinon.assert.threw(webSocket1.send);
      sinon.assert.calledOnceWithExactly(webSocket2.send, data);
      sinon.assert.calledOnceWithExactly(closeConnectionStub, '127.0.0.1');
      expect(outgoingPeers).to.contain(peer2);
      expect(outgoingPeers).to.not.contain(peer1);
      expect(outgoingConnections).to.contain(webSocket2);
      expect(outgoingConnections).to.not.contain(webSocket1);
    });

    it('should send a ping message to all peers if no data is given', async () => {
      const pingMessage = 'flux';
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const peer1 = addPeerToListOfPeers(wsIp);
      const peer2 = addPeerToListOfPeers(wsIp2);
      const webSocket1 = generateWebsocket(wsIp, WebSocket.OPEN);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);

      await fluxCommunicationMessagesSender.sendToAllPeers();

      sinon.assert.calledOnceWithExactly(webSocket1.ping, pingMessage);
      sinon.assert.calledOnceWithExactly(webSocket2.ping, pingMessage);
      expect(peer1.lastPingTime).to.be.a('number');
      expect(peer2.lastPingTime).to.be.a('number');
    });
  });

  describe('sendToAllIncomingConnections tests', () => {
    let closeConnectionStub;
    const addPeerToListOfPeers = (ip) => {
      const peer = {
        ip,
        latency: 50,
      };
      incomingPeers.push(peer);
      return peer;
    };

    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      incomingConnections.push(ws);
      return ws;
    };

    beforeEach(() => {
      closeConnectionStub = sinon.stub(fluxNetworkHelper, 'closeIncomingConnection');
      incomingConnections.length = 0;
      incomingPeers.length = 0;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should properly send a message to all outgoing connections if they exist', async () => {
      const data = {
        test: 'testing1234',
      };
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const webSocket1 = generateWebsocket(wsIp, WebSocket.OPEN);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);

      await fluxCommunicationMessagesSender.sendToAllIncomingConnections(data);

      sinon.assert.calledOnceWithExactly(webSocket1.send, data);
      sinon.assert.calledOnceWithExactly(webSocket2.send, data);
    });

    it('should properly send a message to all outgoing connections if provided in the call', async () => {
      const data = {
        test: 'testing1234',
      };
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const webSocket1 = generateWebsocket(wsIp, WebSocket.OPEN);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);
      incomingConnections.length = 0;

      await fluxCommunicationMessagesSender.sendToAllIncomingConnections(data, [webSocket1, webSocket2]);

      sinon.assert.calledOnceWithExactly(webSocket1.send, data);
      sinon.assert.calledOnceWithExactly(webSocket2.send, data);
    });

    it('should still send a message to other peers if a websocket is closed', async () => {
      const data = {
        test: 'testing1234',
      };
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const webSocket1 = generateWebsocket(wsIp, WebSocket.CLOSED);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);
      incomingConnections.length = 0;

      await fluxCommunicationMessagesSender.sendToAllIncomingConnections(data, [webSocket1, webSocket2]);

      sinon.assert.notCalled(webSocket1.send);
      sinon.assert.calledOnceWithExactly(webSocket2.send, data);
    });

    it('should still send a message to other peers if a websocket throws error', async () => {
      const generateFaultyWebsocket = (ip, readyState) => {
        const ws = {};
        ws.readyState = readyState;
        ws.ping = sinon.stub().returns('pong');
        ws.send = sinon.stub().throws();
        ws._socket = {
          remoteAddress: ip,
        };
        incomingConnections.push(ws);
        return ws;
      };
      const data = {
        test: 'testing1234',
      };
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      const webSocket1 = generateFaultyWebsocket(wsIp, WebSocket.OPEN);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);
      const peer1 = addPeerToListOfPeers(wsIp);
      const peer2 = addPeerToListOfPeers(wsIp2);

      await fluxCommunicationMessagesSender.sendToAllIncomingConnections(data, [webSocket1, webSocket2]);

      sinon.assert.threw(webSocket1.send);
      sinon.assert.calledOnceWithExactly(webSocket2.send, data);
      sinon.assert.calledOnceWithExactly(closeConnectionStub, '127.0.0.1', [], webSocket1);
      expect(incomingPeers).to.contain(peer2);
      expect(incomingPeers).to.not.contain(peer1);
      expect(incomingConnections).to.contain(webSocket2);
      expect(incomingConnections).to.not.contain(webSocket1);
    });

    it('should send a ping message to all peers if no data is given', async () => {
      const pingMessage = 'flux';
      closeConnectionStub.returns('closed!');
      const wsIp = '127.0.0.1';
      const wsIp2 = '127.0.0.2';
      addPeerToListOfPeers(wsIp);
      addPeerToListOfPeers(wsIp2);
      const webSocket1 = generateWebsocket(wsIp, WebSocket.OPEN);
      const webSocket2 = generateWebsocket(wsIp2, WebSocket.OPEN);

      await fluxCommunicationMessagesSender.sendToAllIncomingConnections();

      sinon.assert.calledOnceWithExactly(webSocket1.ping, pingMessage);
      sinon.assert.calledOnceWithExactly(webSocket2.ping, pingMessage);
    });
  });

  describe('serialiseAndSignFluxBroadcast tests', () => {
    it('should return serialised and signed message', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const data = {
        title: 'message',
        message: 'This is testing!',
      };
      const expectedPubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.a('string');
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).pubKey).to.eql(expectedPubKey);
      expect(JSON.parse(signedData).data).to.eql(data);
    });

    it('should return serialised and signed empty message', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const data = '';
      const expectedPubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.a('string');
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).pubKey).to.eql(expectedPubKey);
      expect(JSON.parse(signedData).data).to.eql(data);
    });

    it('should fall back to zelnode private key config if empty', async () => {
      const privateKey = '';
      const data = '';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.a('string');
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).data).to.eql(data);
      expect(JSON.parse(signedData).pubKey).to.eql('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
    });
  });

  describe('getFluxMessageSignature tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('Should properly return signature if private key is provided', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const message = 'testing1234';

      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(message, privateKey);

      expect(signature).to.be.a('string');
    });

    it('Should properly return signature if private key is taken from config', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const message = 'testing1234';
      const daemonStub = sinon.stub(daemonService, 'getConfigValue').resolves(mockedPrivKey);

      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(message);

      expect(signature).to.be.a('string');
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });

    it('Should return an error if private key is invalid', async () => {
      const privateKey = 'asdf';
      const message = 'testing1234';

      const result = await fluxCommunicationMessagesSender.getFluxMessageSignature(message, privateKey);

      expect(result).to.be.an('Error');
    });
  });

  describe('sendMessageToWS tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = () => {
      const ws = {};
      ws.send = sinon.stub().returns('okay');
      return ws;
    };
    beforeEach(() => {
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should send a message to the given websocket if keys are accessible through config', async () => {
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const data = {
        title: 'message',
        message: 'This is testing!',
      };
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.sendMessageToWS(data, websocket);

      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
    });

    it('should send an empty message to the given websocket if keys are accessible through config', async () => {
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const data = { };
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.sendMessageToWS(data, websocket);

      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
    });
  });

  describe('respondWithAppMessage tests', () => {
    const generateWebsocket = () => {
      const ws = {};
      ws.send = sinon.stub().returns('okay');
      return ws;
    };
    let message;

    beforeEach(async () => {
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').returns('KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD');
      const privateKey = 'KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD';
      const ownerAddress = '13ienDRfUwFEgfZxm5dk4drTQsmj5hDGwL';
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
      message = {
        type,
        version,
        appSpecifications,
        timestamp,
        signature,
        hash,
      };
    });
    afterEach(() => {
      sinon.restore();
    });

    it('should respond with app message that exists in permanent storage but is not located in cache', async () => {
      const callMessage = {
        data: {
          hash: 'test1',
        },
      };
      const checkAppMessageExistenceStub = sinon.stub(appsService, 'checkAppMessageExistence').returns(message);
      const myMessageCacheGetStub = sinon.stub(LRU.prototype, 'get').returns(undefined);
      const myMessageCacheSetStub = sinon.stub(LRU.prototype, 'set').returns(undefined);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);

      sinon.assert.calledOnceWithExactly(myMessageCacheSetStub, JSON.stringify(callMessage), message);
      sinon.assert.calledOnceWithExactly(checkAppMessageExistenceStub, callMessage.data.hash);
      sinon.assert.calledOnceWithExactly(myMessageCacheGetStub, JSON.stringify(callMessage));
    });

    it('should respond with app message that exists in temp storage but is not located in cache or perm storage', async () => {
      const callMessage = {
        data: {
          hash: 'test1',
        },
      };
      const checkAppMessageExistenceStub = sinon.stub(appsService, 'checkAppMessageExistence').returns(undefined);
      const checkAppTemporaryMessageExistenceStub = sinon.stub(appsService, 'checkAppTemporaryMessageExistence').returns(message);
      const myMessageCacheGetStub = sinon.stub(LRU.prototype, 'get').returns(undefined);
      const myMessageCacheSetStub = sinon.stub(LRU.prototype, 'set').returns(undefined);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);

      sinon.assert.calledOnceWithExactly(myMessageCacheSetStub, JSON.stringify(callMessage), message);
      sinon.assert.calledOnceWithExactly(checkAppMessageExistenceStub, callMessage.data.hash);
      sinon.assert.calledOnceWithExactly(checkAppTemporaryMessageExistenceStub, callMessage.data.hash);
      sinon.assert.calledOnceWithExactly(myMessageCacheGetStub, JSON.stringify(callMessage));
    });

    it('should do nothing if the message does not exist', async () => {
      const callMessage = {
        data: {
          hash: 'test1',
        },
      };
      const checkAppMessageExistenceStub = sinon.stub(appsService, 'checkAppMessageExistence').returns(undefined);
      const checkAppTemporaryMessageExistenceStub = sinon.stub(appsService, 'checkAppTemporaryMessageExistence').returns(undefined);
      const myMessageCacheGetStub = sinon.stub(LRU.prototype, 'get').returns(undefined);
      const myMessageCacheSetStub = sinon.stub(LRU.prototype, 'set').returns(undefined);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);

      sinon.assert.notCalled(myMessageCacheSetStub);
      sinon.assert.calledOnceWithExactly(checkAppMessageExistenceStub, callMessage.data.hash);
      sinon.assert.calledOnceWithExactly(checkAppTemporaryMessageExistenceStub, callMessage.data.hash);
      sinon.assert.calledOnceWithExactly(myMessageCacheGetStub, JSON.stringify(callMessage));
    });

    it('should respond with app message that is located in cache', async () => {
      const callMessage = {
        data: {
          hash: 'test1',
        },
      };
      const checkAppMessageExistenceSpy = sinon.spy(appsService, 'checkAppMessageExistence');
      const myMessageCacheGetStub = sinon.stub(LRU.prototype, 'get').returns(message);
      const myMessageCacheSetStub = sinon.stub(LRU.prototype, 'set').returns(undefined);
      const websocket = generateWebsocket();

      await fluxCommunicationMessagesSender.respondWithAppMessage(callMessage, websocket);

      sinon.assert.notCalled(myMessageCacheSetStub);
      sinon.assert.notCalled(checkAppMessageExistenceSpy);
      sinon.assert.calledOnceWithExactly(myMessageCacheGetStub, JSON.stringify(callMessage));
    });
  });

  describe('broadcastMessageToOutgoing tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      outgoingConnections.push(ws);
      return ws;
    };
    beforeEach(() => {
      outgoingConnections.length = 0;
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should send a message to the given websocket if keys are accessible through config', async () => {
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const data = {
        title: 'message',
        message: 'This is testing!',
      };
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(data);

      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });
  });

  describe('broadcastMessageToIncoming tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      incomingConnections.push(ws);
      return ws;
    };
    beforeEach(() => {
      incomingConnections.length = 0;
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should send a message to the given websocket if keys are accessible through config', async () => {
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const data = {
        title: 'message',
        message: 'This is testing!',
      };
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);

      await fluxCommunicationMessagesSender.broadcastMessageToIncoming(data);

      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });
  });

  describe('broadcastMessageToOutgoingFromUser tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      outgoingConnections.push(ws);
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      outgoingConnections.length = 0;
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });

    it('should not broadcast message if no data is passed', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          test: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });
  });

  describe('broadcastMessageToIncomingFromUser tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      incomingConnections.push(ws);
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      incomingConnections.length = 0;
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });

    it('should not broadcast message if no data is passed', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          test: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });
  });

  describe('broadcastMessageFromUser tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateIncomingWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      incomingConnections.push(ws);
      return ws;
    };
    const generateOutgoingWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      outgoingConnections.push(ws);
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      incomingConnections.length = 0;
      outgoingConnections.length = 0;
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/version/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/version/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should not broadcast message if no data is passed', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          test: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });
  });

  describe('broadcastMessageToOutgoingFromUserPost tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      outgoingConnections.push(ws);
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      outgoingConnections.length = 0;
      sinon.stub(fluxNetworkHelper, 'closeConnection').returns(true);
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);

      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });

    it('should not broadcast message if the data is empty', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');

      const mockStream = new PassThrough();
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });
  });

  describe('broadcastMessageToIncomingFromUserPost tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      incomingConnections.push(ws);
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      incomingConnections.length = 0;
      sinon.stub(fluxNetworkHelper, 'closeConnection').returns(true);
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);

      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocket.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });

    it('should not broadcast message if the data is empty', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');

      const mockStream = new PassThrough();
      mockStream.end();
      const res = generateResponse();
      const websocket = generateWebsocket('127.0.0.1', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocket.send);
    });
  });

  describe('broadcastMessageFromUserPost tests', () => {
    let fluxNetworkHelperPublicKeyStub;
    let fluxNetworkHelperPrivateKeyStub;
    const generateIncomingWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      incomingConnections.push(ws);
      return ws;
    };
    const generateOutgoingWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      outgoingConnections.push(ws);
      return ws;
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      incomingConnections.length = 0;
      sinon.stub(fluxNetworkHelper, 'closeConnection').returns(true);
      fluxNetworkHelperPublicKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey');
      fluxNetworkHelperPrivateKeyStub = sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast message if data is given in the req params and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/version/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/version/gm));
    });

    it('should broadcast message if data is given in the req query and user is authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', WebSocket.OPEN);
      const expectedSuccessMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Message successfully broadcasted to Flux network',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccessMessage);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/version/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/This is testing!/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/message/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/title/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/pubKey/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/version/gm));
    });

    it('should not broadcast message if user is not authorized', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(false);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
      const req = {
        params: {
          test: {
            test: 'message',
          },
        },
        query: {
          data: {
            title: 'message',
            message: 'This is testing!',
          },
        },
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should not broadcast message if the data is empty', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').returns(true);
      fluxNetworkHelperPublicKeyStub.returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      fluxNetworkHelperPrivateKeyStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');

      const mockStream = new PassThrough();
      mockStream.end();
      const res = generateResponse();
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.2', WebSocket.OPEN);
      const expectedErrorMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message to broadcast attached.',
        },
      };

      await fluxCommunicationMessagesSender.broadcastMessageFromUserPost(mockStream, res);

      // because of await in loop, that's the only way we can wait for spies to be called
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorMessage);
      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });
  });

  describe('broadcastTemporaryAppMessage tests', () => {
    const generateOutgoingWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      outgoingConnections.push(ws);
      return ws;
    };
    const generateIncomingWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.send = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      incomingConnections.push(ws);
      return ws;
    };

    beforeEach(() => {
      outgoingConnections.length = 0;
      incomingConnections.length = 0;
      sinon.stub(fluxNetworkHelper, 'getFluxNodePublicKey').returns('0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab');
      sinon.stub(fluxNetworkHelper, 'getFluxNodePrivateKey').returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should send a message to incoming and outgoing connections when app message is properly formatted', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'zelnodeapp',
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: '12346789asdfghj',
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', WebSocket.OPEN);

      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);

      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/type/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/zelnodeapp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/appSpecifications/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/specs/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/specs 2/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/some specs/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/some specs 2/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/hash/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/12346789asdfghj/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketIn.send, sinon.match(/signature12345/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match.string);
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/type/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/zelnodeapp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/appSpecifications/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/specs/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/specs 2/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/some specs/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/some specs 2/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/hash/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/12346789asdfghj/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/timestamp/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature/gm));
      sinon.assert.calledOnceWithExactly(websocketOut.send, sinon.match(/signature12345/gm));
    });

    it('should throw an error if the message is not an object', async () => {
      const temporaryAppMessage = 'test';
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.type is not a string', async () => {
      const temporaryAppMessage = {
        type: 1,
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: '12346789asdfghj',
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.version is not a number', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'zelnodeapp',
        version: '3',
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: '12346789asdfghj',
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.appSpecifications is not an object', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'zelnodeapp',
        version: 3,
        appSpecifications: 'test',
        hash: '12346789asdfghj',
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.hash is not a string', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'zelnodeapp',
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: 2,
        timestamp: 168732333,
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.timestamp is not a number', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'zelnodeapp',
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: 'testestest',
        timestamp: '168732333',
        signature: 'signature12345',
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });

    it('should throw an error if the message.singature is not a string', async () => {
      const temporaryAppMessage = { // specification of temp message, these are not verified in this function
        type: 'zelnodeapp',
        version: 3,
        appSpecifications: {
          specs: 'some specs',
          specs2: 'some specs 2',
        },
        hash: 2,
        timestamp: 168732333,
        signature: 2,
      };
      const websocketIn = generateIncomingWebsocket('127.0.0.1', WebSocket.OPEN);
      const websocketOut = generateOutgoingWebsocket('127.0.0.3', WebSocket.OPEN);

      await expect(fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage)).to.eventually.be.rejectedWith('Invalid Flux App message for storing');

      sinon.assert.notCalled(websocketIn.send);
      sinon.assert.notCalled(websocketOut.send);
    });
  });
});
