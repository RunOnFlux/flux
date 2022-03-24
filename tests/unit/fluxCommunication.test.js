/* eslint-disable no-underscore-dangle */
const chai = require('chai');
const sinon = require('sinon');
const WebSocket = require('ws');

const { expect } = chai;

const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const daemonService = require('../../ZelBack/src/services/daemonService');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const { outgoingConnections } = require('../../ZelBack/src/services/utils/outgoingConnections');
const { incomingConnections } = require('../../ZelBack/src/services/utils/incomingConnections');

const fluxList = require('./data/listfluxnodes.json');

describe('fluxCommunication tests', () => {
  describe('getFluxNodePublicKey tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('Should properly return publicKey if private key is provided', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const expectedPublicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const publicKey = await fluxCommunication.getFluxNodePublicKey(privateKey);

      expect(publicKey).to.be.equal(expectedPublicKey);
    });

    it('Should properly return signature if private key is taken from config', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const expectedPublicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
      const daemonStub = sinon.stub(daemonService, 'getConfigValue').resolves(mockedPrivKey);

      const publicKey = await fluxCommunication.getFluxNodePublicKey();

      expect(publicKey).to.be.equal(expectedPublicKey);
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });

    it('Should throw error if private key is invalid', async () => {
      const privateKey = 'asdf';

      expect(async () => { await fluxCommunication.getFluxNodePublicKey(privateKey); }).to.throw;
    });
  });

  describe('verifyFluxBroadcast tests', () => {
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const badPubKey = '074eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const data = {
      app: 'testapp',
      data: 'test',
    };
    const message = JSON.stringify(data);

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if broadcast is verifiable, flux node list provided', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return true if broadcast is verifiable, flux node list from deterministicFluxList', async () => {
      const deterministicZelnodeListResponse = {
        status: 'success',
        data: [
          {
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
            txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
            outidx: '0',
            ip: '47.199.51.61:16137',
            network: '',
            added_height: 1076533,
            confirmed_height: 1076535,
            last_confirmed_height: 1079888,
            last_paid_height: 1077653,
            tier: 'CUMULUS',
            payment_address: 't1Z6mWoCrFC2g3iTCFdFkYdTfwtG84E3y2o',
            pubkey: '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab',
            activesince: '1647197272',
            lastpaid: '1647333786',
            amount: '1000.00',
            rank: 0,
          },
        ],
      };
      sinon.stub(daemonService, 'viewDeterministicZelNodeList').resolves(deterministicZelnodeListResponse);
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return false if public key is invalid', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey: badPubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if version is not 1', async () => {
      const timeStamp = Date.now();
      const version = 2;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if the message has timestamp greater than 120s in the future', async () => {
      const timeStamp = Date.now() + 240000;
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if the signature is invalid', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature: 'test12341234567',
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });
  });

  describe('verifyOriginalFluxBroadcast tests', () => {
    // Function extends the verifyFluxBroadcast function, only adding time verification.
    // Message can't be older than 5 minutes.
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const data = {
      app: 'testapp',
      data: 'test',
    };
    const message = JSON.stringify(data);

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if broadcast is verifiable, flux node list provided, no current timestamp provided', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyOriginalFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return false if the message has been sent more than 5 minutes ago, no current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyOriginalFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return true if broadcast is verifiable, flux node list provided, current timestamp provided', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };
      const providedTimestamp = Date.now() + 100;

      const isValid = await fluxCommunication.verifyOriginalFluxBroadcast(dataToSend, fluxList, providedTimestamp);

      expect(isValid).to.equal(true);
    });

    it('should return false if the message has been sent more than 5 minutes ago, current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };
      const providedTimestamp = Date.now() + 100;

      const isValid = await fluxCommunication.verifyOriginalFluxBroadcast(dataToSend, fluxList, providedTimestamp);

      expect(isValid).to.equal(false);
    });
  });

  describe('verifyTimestampInFluxBroadcast tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should return true if message timestamp is now, no current timestamp provided', async () => {
      const timeStamp = Date.now();
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunication.verifyTimestampInFluxBroadcast(data);

      expect(isValid).to.equal(true);
    });

    it('should return true if message timestamp is now, timestamp provided', async () => {
      const timeStamp = Date.now();
      const providedTimestamp = Date.now() + 100;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunication.verifyTimestampInFluxBroadcast(data, providedTimestamp);

      expect(isValid).to.equal(true);
    });

    it('should return false if message timestamp is more than 5 minutes ago, current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const providedTimestamp = Date.now() + 100;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunication.verifyTimestampInFluxBroadcast(data, providedTimestamp);

      expect(isValid).to.equal(false);
    });

    it('should return false if message timestamp is more than 5 minutes ago, no current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunication.verifyTimestampInFluxBroadcast(data);

      expect(isValid).to.equal(false);
    });
  });

  describe.only('handleAppMessages tests', () => {
    const privateKey = 'KxA2iy4aVuVKXsK8pBnJGM9vNm4z6PLNRTzsPuSFBw6vWL5StbqD';
    const ownerAddress = '13ienDRfUwFEgfZxm5dk4drTQsmj5hDGwL';
    let sendToAllPeersSpy;
    let sendToAllIncomingConnectionsSpy;
    let stub;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      stub = sinon.stub(generalService, 'checkWhitelistedZelID').resolves(true);
      sendToAllPeersSpy = sinon.spy(fluxCommunicationMessagesSender, 'sendToAllPeers');
      sendToAllIncomingConnectionsSpy = sinon.spy(fluxCommunicationMessagesSender, 'sendToAllIncomingConnections');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should broadcast the app message if a proper data is given', async () => {
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
      const outgoingWebsocket = new WebSocket(wsuri);
      outgoingWebsocket._socket = { remoteAddress: '127.8.8.1' };
      outgoingConnections.push(outgoingWebsocket);
      const incomingWebocket = new WebSocket(wsuri);
      incomingWebocket._socket = { remoteAddress: '::ffff:127.8.8.1' };
      incomingConnections.push(incomingWebocket);
      const messageString = JSON.stringify(message);
      const wsListOut = outgoingConnections.filter((client) => client._socket.remoteAddress !== fromIp);
      const wsListIn = incomingConnections.filter((client) => client._socket.remoteAddress.replace('::ffff:', '') !== fromIp);

      await fluxCommunication.handleAppMessages(message, fromIp);

      sinon.assert.calledOnceWithExactly(stub, ownerAddress);
      sinon.assert.calledOnceWithExactly(sendToAllPeersSpy, messageString, wsListOut);
      sinon.assert.calledOnceWithExactly(sendToAllIncomingConnectionsSpy, messageString, wsListIn);
    }).timeout(5000);

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
    }).timeout(5000);

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
    }).timeout(5000);
  });
});
