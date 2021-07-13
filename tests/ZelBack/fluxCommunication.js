process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
const communication = require('../../ZelBack/src/services/fluxCommunication');
const fluxList = require('./data/listfluxnodes.json')
const chai = require('chai');
const expect = chai.expect;
const qs = require('qs');
const WebSocket = require('ws');

describe('getFluxMessageSignature', () => {
  it('correctly signs Flux message', async () => {
    const message = 'abc';
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const signature = await communication.getFluxMessageSignature(message, privKey);
    expect(signature).to.be.a('string');
    const signature2 = await communication.getFluxMessageSignature(message, 'abc');
    expect(signature2).to.be.an('error');
  });

  it('correctly verifies Flux broadcast', async () => {
    const timeStamp = Date.now();
    const version = 1;
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const badPubKey = '074eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const data = {
      app: 'testapp',
      data: 'test'
    }
    const message = JSON.stringify(data);
    const messageToSign = version + message + timeStamp;
    const signature = await communication.getFluxMessageSignature(messageToSign, privKey);
    console.log(signature);
    const dataToSend = {
      version,
      pubKey,
      timestamp: timeStamp,
      data,
      signature
    }
    const validRequest = await communication.verifyOriginalFluxBroadcast(dataToSend, fluxList);
    expect(validRequest).to.equal(true);
    const dataToSend2 = {
      version,
      pubKey,
      timestamp: timeStamp - 500000,
      data,
      signature
    }
    const invalidRequest = await communication.verifyOriginalFluxBroadcast(dataToSend2, fluxList);
    expect(invalidRequest).to.equal(false);
    const dataToSend3 = {
      version,
      pubKey: badPubKey,
      timestamp: timeStamp,
      data,
      signature
    }
    const invalidRequest2 = await communication.verifyOriginalFluxBroadcast(dataToSend3, fluxList);
    expect(invalidRequest2).to.equal(false);
    const dataToSend4 = {
      version,
      pubKey,
      timestamp: timeStamp,
      data,
      signature: 'abc'
    }
    const invalidRequest3 = await communication.verifyOriginalFluxBroadcast(dataToSend4, fluxList);
    expect(invalidRequest3).to.equal(false);
  }).timeout(5000);

  it('establishes websocket connection and sends correct data', async () => {
    const data = 'Hello Flux testsuite!';
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const messageToSend = await communication.serialiseAndSignFluxBroadcast(data, privKey);
    console.log(messageToSend);
    const wsuri = `ws://62.171.163.150:16127/ws/flux/`; // locally running 127.0.0.1
    const websocket = new WebSocket(wsuri);

    websocket.on('open', (msg) => {
      websocket.send(messageToSend);
    });
    websocket.on('message', (msg) => {
      console.log(msg);
      const msgFlux = msg[0];
      expect(msgFlux).to.equal('{'); // ws is open, we can receive any message
      websocket.close(1000);
    });
  });
});