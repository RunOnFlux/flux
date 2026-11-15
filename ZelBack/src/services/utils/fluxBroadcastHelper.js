const serviceHelper = require('../serviceHelper');
const { nodeSigner } = require('./nodeSigner');
const { validPath } = require('./networkPath');

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

/**
 * What signs a broadcast. A frame's other fields are its sender's alone, so nothing
 * a node keeps or passes on carries them.
 * @param {object} frame
 * @returns {{version: number, timestamp: number, pubKey: string, signature: string}}
 */
function envelopeOf({
  version, timestamp, pubKey, signature,
}) {
  return {
    version, timestamp, pubKey, signature,
  };
}

/**
 * A broadcast as a node holds and passes it on: what is signed, and the path it took.
 * @param {object} frame
 * @returns {object}
 */
function signedBroadcast(frame) {
  return { ...envelopeOf(frame), data: frame.data, networkPath: validPath(frame.networkPath) };
}

module.exports = {
  envelopeOf,
  signedBroadcast,
  serialiseAndSignFluxBroadcast,
  getFluxMessageSignature,
};
