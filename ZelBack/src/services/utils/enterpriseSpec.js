/**
 * Throws unless an enterprise (v8+) specification carries its compose and
 * contacts only inside `enterprise`: both absent or empty. Takes a
 * specification as received; a decrypted one holds both.
 * @param {object} appSpec - Application specification as received
 */
function verifyEnterpriseCarriesNoPlainSpec(appSpec) {
  if (!appSpec || !(appSpec.version >= 8 && appSpec.enterprise)) return;
  const isEmpty = (value) => value === undefined || value === null
    || (Array.isArray(value) && value.length === 0);
  if (!isEmpty(appSpec.compose) || !isEmpty(appSpec.contacts)) {
    throw new Error('An enterprise app carries its compose and contacts encrypted in enterprise, and nothing in plain');
  }
}

module.exports = {
  verifyEnterpriseCarriesNoPlainSpec,
};
