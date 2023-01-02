process.env.NODE_CONFIG_DIR = `${process.cwd()}/ZelBack/config/`;
import chai from 'chai';
import WebSocket from 'ws';
import communication from '../../ZelBack/src/services/fluxCommunicationMessagesSender.js';

const { expect } = chai;

describe('getFluxMessageSignature', () => {
  it.skip('establishes websocket connection and sends correct data', async () => {
    const data = 'Hello Flux testsuite!';
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const messageToSend = await communication.serialiseAndSignFluxBroadcast(data, privKey);
    console.log(messageToSend);
    const wsuri = 'wss://api.runonflux.io/ws/flux/'; // locally running 127.0.0.1
    const websocket = new WebSocket(wsuri);

    websocket.on('open', (msg) => {
      console.log(msg);
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
