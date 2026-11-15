const log = require('../../lib/log');

/**
 * Blanks `compose` and `contacts` on every installed enterprise app row that holds
 * them. An enterprise row keeps only its encrypted `enterprise` specification;
 * every reader that needs the components decrypts them from it. Every other field
 * of the row is left as it is.
 * @param {import('mongodb').Collection} apps The installed apps collection.
 * @returns {Promise<number>} The rows blanked.
 */
async function blankStoredEnterpriseSecrets(apps) {
  const result = await apps.updateMany(
    {
      version: { $gte: 8 },
      enterprise: { $type: 'string', $ne: '' },
      $or: [{ 'compose.0': { $exists: true } }, { 'contacts.0': { $exists: true } }],
    },
    { $set: { compose: [], contacts: [] } },
  );
  if (result.modifiedCount) log.warn(`Blanked the components and contacts of ${result.modifiedCount} installed enterprise apps`);
  return result.modifiedCount;
}

module.exports = { blankStoredEnterpriseSecrets };
