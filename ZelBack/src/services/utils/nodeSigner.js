const fluxNetworkHelper = require('../fluxNetworkHelper');
const verificationHelper = require('../verificationHelper');
const log = require('../../lib/log');

/**
 * This node's identity, ready to sign - or nothing, when it has none to hand.
 *
 * The one place that asks whether this node can speak as itself. It used to be
 * asked at every call site or, more often, not asked at all: the key accessors
 * answered a failure with a value, so `pubKey` could be an Error object that is
 * truthy, is not a string, and becomes `{}` the moment it is stringified. Nine
 * callers took the public key and two of them checked it. A message carrying
 * `"pubKey":{}` is not refused by this node - it is refused by every node that
 * receives it, which is a long way from where the key went missing.
 *
 * Answers rather than throws, because the callers are spread across paths with
 * very different tolerances - one of them must never throw at all - and a
 * primitive is in no position to know which it is being used from.
 *
 * The signature can still fail on its own after this succeeds, so `sign`
 * answers null and its callers say so; a key that exists is not the same as a
 * signing operation that worked.
 *
 * @param {string} [privatekey] - an explicit key, otherwise the daemon config's
 * @returns {Promise<{pubKey: string, sign: (message: string) => string|null}|null>}
 */
async function nodeSigner(privatekey) {
  const pubKey = await fluxNetworkHelper.getFluxNodePublicKey(privatekey);
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey(privatekey);

  if (!pubKey || typeof pubKey !== 'string' || !privKey || typeof privKey !== 'string') {
    log.warn('nodeSigner - this node cannot sign as itself; its key is unavailable');
    return null;
  }

  return {
    pubKey,
    sign: (message) => {
      const signature = verificationHelper.signMessage(message, privKey);
      return typeof signature === 'string' && signature ? signature : null;
    },
  };
}

module.exports = { nodeSigner };
