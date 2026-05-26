const fluxNetworkHelper = require('../fluxNetworkHelper');
const verificationHelper = require('../verificationHelper');
const serviceHelper = require('../serviceHelper');

async function getFluxMessageSignature(message, privatekey) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey(privatekey);
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

async function serialiseAndSignFluxBroadcast(dataToBroadcast, privatekey) {
  const version = 1;
  const timestamp = Date.now();
  const pubKey = await fluxNetworkHelper.getFluxNodePublicKey(privatekey);
  const message = serviceHelper.ensureString(dataToBroadcast);
  const messageToSign = version + message + timestamp;
  const signature = await getFluxMessageSignature(messageToSign, privatekey);
  const dataObj = {
    version,
    timestamp,
    pubKey,
    signature,
    data: dataToBroadcast,
  };
  return JSON.stringify(dataObj);
}

module.exports = {
  serialiseAndSignFluxBroadcast,
  getFluxMessageSignature,
};
