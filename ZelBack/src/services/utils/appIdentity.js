const signatureVerifier = require('../signatureVerifier');
const { APP_NAME_REGEX, MAX_APP_NAME_LENGTH } = require('./appConstants');

/**
 * Whether an app name and owner are well formed: a name as a spec allows it,
 * and an owner that can sign (a Flux ID or an Ethereum address).
 * @param {*} name App name.
 * @param {*} owner App owner.
 * @returns {boolean}
 */
function isValidAppNameAndOwner(name, owner) {
  return typeof name === 'string'
    && name.length <= MAX_APP_NAME_LENGTH
    && APP_NAME_REGEX.test(name)
    && signatureVerifier.isValidSigningIdentity(owner);
}

/**
 * Throws unless the app name and owner are well formed.
 * @param {*} name App name.
 * @param {*} owner App owner.
 */
function verifyAppNameAndOwner(name, owner) {
  if (!isValidAppNameAndOwner(name, owner)) {
    throw new Error('Invalid app name or owner');
  }
}

module.exports = {
  isValidAppNameAndOwner,
  verifyAppNameAndOwner,
};
