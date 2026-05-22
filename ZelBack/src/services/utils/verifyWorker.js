const { parentPort } = require('worker_threads');
const bitcoinMessage = require('bitcoinjs-message');
const { pubKeyToAddr } = require('./fluxCryptoUtils');

const BTC_PUBKEY_HASH = '00';

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
    } catch {
      results[i] = false;
    }
  }
  parentPort.postMessage(results);
});
