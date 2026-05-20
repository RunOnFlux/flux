const { parentPort } = require('worker_threads');
const bitcoinMessage = require('bitcoinjs-message');
const { pubKeyToAddr } = require('./fluxCryptoUtils');

const BTC_PUBKEY_HASH = '00';

let errorsSampled = 0;
parentPort.on('message', (batch) => {
  const results = new Array(batch.length);
  for (let i = 0; i < batch.length; i++) {
    const { messageToVerify, pubKey, signature } = batch[i];
    try {
      let address = pubKey;
      if (pubKey.length > 36) {
        address = pubKeyToAddr(pubKey, BTC_PUBKEY_HASH);
      }
      results[i] = bitcoinMessage.verify(messageToVerify, address, signature);
      if (!results[i] && errorsSampled < 3) {
        errorsSampled += 1;
        // eslint-disable-next-line no-console
        console.error(`Worker verify FALSE [${i}]: pubKey=${pubKey?.slice(0, 20)}..., msgLen=${messageToVerify?.length}, sig=${signature?.slice(0, 20)}...`);
      }
    } catch (e) {
      results[i] = false;
      if (errorsSampled < 3) {
        errorsSampled += 1;
        // eslint-disable-next-line no-console
        console.error(`Worker verify THROW [${i}]: ${e.message}, pubKey=${pubKey?.slice(0, 20)}..., msgLen=${messageToVerify?.length}`);
      }
    }
  }
  parentPort.postMessage(results);
});
