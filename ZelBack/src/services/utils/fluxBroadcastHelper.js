const serviceHelper = require('../serviceHelper');
const { nodeSigner } = require('./nodeSigner');

/**
 * A signature over a message, as this node - or null when it cannot sign.
 *
 * @param {string} message
 * @param {string} [privatekey] - an explicit key, otherwise the daemon config's
 * @returns {Promise<string|null>}
 */
async function getFluxMessageSignature(message, privatekey) {
  const signer = await nodeSigner(privatekey);
  return signer ? signer.sign(message) : null;
}

/**
 * A broadcast, serialised and signed as this node - or null when it cannot sign.
 *
 * Null rather than a message carrying null where the key and signature go.
 * Every peer refuses such a message without a word, so sending it costs each
 * of them a signature check for nothing and tells this node nothing the
 * signer's own warning did not. A caller handed null sends nothing.
 *
 * @param {object|string} dataToBroadcast
 * @param {string} [privatekey] - an explicit key, otherwise the daemon config's
 * @returns {Promise<string|null>} the message to put on the wire
 */
async function serialiseAndSignFluxBroadcast(dataToBroadcast, privatekey) {
  const signer = await nodeSigner(privatekey);
  if (!signer) return null;

  const version = 1;
  const timestamp = Date.now();
  const message = serviceHelper.ensureString(dataToBroadcast);
  const signature = signer.sign(version + message + timestamp);
  if (!signature) return null;

  return JSON.stringify({
    version,
    timestamp,
    pubKey: signer.pubKey,
    signature,
    data: dataToBroadcast,
  });
}

module.exports = {
  serialiseAndSignFluxBroadcast,
  getFluxMessageSignature,
};
