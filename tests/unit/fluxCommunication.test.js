/* eslint-disable no-underscore-dangle */
const sinon = require('sinon');
const WebSocket = require('ws');

const fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const generalService = require('../../ZelBack/src/services/generalService');
const { outgoingConnections } = require('../../ZelBack/src/services/utils/outgoingConnections');
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
      await dbHelper.initiateDB();
      sendToAllPeersSpy = sinon.stub(fluxCommunicationMessagesSender, 'sendToAllPeers').resolves(true);
      sendToAllIncomingConnectionsSpy = sinon.stub(fluxCommunicationMessagesSender, 'sendToAllIncomingConnections').resolves(true);
    });

    afterEach(() => {
      outgoingConnections.length = 0;
      incomingConnections.length = 0;
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
      await dbHelper.initiateDB();
      sendToAllPeersSpy = sinon.stub(fluxCommunicationMessagesSender, 'sendToAllPeers').resolves(true);
      sendToAllIncomingConnectionsSpy = sinon.stub(fluxCommunicationMessagesSender, 'sendToAllIncomingConnections').resolves(true);
    });

    afterEach(() => {
      outgoingConnections.length = 0;
      incomingConnections.length = 0;
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
    }).timeout(5000);

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
});
