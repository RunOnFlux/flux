const crypto = require('crypto');

/**
 * A specification hash for a fixture app: 64 hex characters, as a real one is,
 * and a different one for each name.
 * @param {string} name
 * @returns {string}
 */
function specHash(name) {
  return crypto.createHash('sha256').update(String(name)).digest('hex');
}

module.exports = { specHash };
