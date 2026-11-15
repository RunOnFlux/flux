const { verifyAppNameAndOwner } = require('./appIdentity');
const { MAX_ENTERPRISE_LENGTH } = require('./appConstants');

const isEmpty = (value) => value === undefined || value === null
  || (Array.isArray(value) && value.length === 0);

/**
 * Throws unless an enterprise (v8+) specification carries its compose and
 * contacts only inside `enterprise`: both absent or empty in plain. Takes a
 * specification as received; a decrypted one holds both.
 * @param {object} appSpec - Application specification as received
 * @returns {void}
 * @throws {Error} If an enterprise specification carries compose or contacts in plain
 */
function verifyEnterpriseCarriesNoPlainSpec(appSpec) {
  if (!appSpec || !(appSpec.version >= 8 && appSpec.enterprise)) return;
  if (!isEmpty(appSpec.compose) || !isEmpty(appSpec.contacts)) {
    throw new Error('An enterprise app carries its compose and contacts encrypted in enterprise, and nothing in plain');
  }
}

/**
 * Throws unless an enterprise (v8+) specification has the encrypted form a
 * client sends: a well formed name and owner, an `enterprise` string no longer
 * than MAX_ENTERPRISE_LENGTH, and no compose or contacts in plain. Checked
 * wherever a message enters the network, on the specification as received and
 * before decrypting, so a node that cannot decrypt applies it too. A
 * specification that is not enterprise passes.
 * @param {object} appSpec - Application specification as received
 * @returns {void}
 * @throws {Error} If the encrypted form is not one a client sends
 */
function verifyEncryptedSpec(appSpec) {
  if (!appSpec || !(appSpec.version >= 8 && appSpec.enterprise)) return;
  verifyAppNameAndOwner(appSpec.name, appSpec.owner);
  if (typeof appSpec.enterprise !== 'string' || appSpec.enterprise.length > MAX_ENTERPRISE_LENGTH) {
    throw new Error(`Enterprise specification is too long. Maximum of ${MAX_ENTERPRISE_LENGTH} characters is allowed`);
  }
  verifyEnterpriseCarriesNoPlainSpec(appSpec);
}

module.exports = {
  verifyEncryptedSpec,
  verifyEnterpriseCarriesNoPlainSpec,
};
