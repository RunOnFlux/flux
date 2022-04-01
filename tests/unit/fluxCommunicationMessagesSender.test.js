/* eslint-disable no-underscore-dangle */
const chai = require('chai');
const sinon = require('sinon');
const WebSocket = require('ws');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const daemonService = require('../../ZelBack/src/services/daemonService');
const { outgoingConnections } = require('../../ZelBack/src/services/utils/outgoingConnections');
const { incomingConnections } = require('../../ZelBack/src/services/utils/incomingConnections');
const { outgoingPeers } = require('../../ZelBack/src/services/utils/outgoingPeers');
const { incomingPeers } = require('../../ZelBack/src/services/utils/incomingPeers');

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

    it('should return serialised empty message without signature when no public key is provided', async () => {
      const privateKey = '';
      const data = '';

      const signedData = await fluxCommunicationMessagesSender.serialiseAndSignFluxBroadcast(data, privateKey);

      expect(signedData).to.be.a('string');
      expect(JSON.parse(signedData).signature).to.be.empty;
      expect(JSON.parse(signedData).version).to.eql(1);
      expect(JSON.parse(signedData).data).to.eql(data);
      expect(JSON.parse(signedData).pubKey).to.eql({});
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

    it('Should throw error if private key is invalid', async () => {
      const privateKey = 'asdf';
      const message = 'testing1234';

      expect(async () => { await fluxCommunicationMessagesSender.getFluxMessageSignature(message, privateKey); }).to.throw;
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
});
