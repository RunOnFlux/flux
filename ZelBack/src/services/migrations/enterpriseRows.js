const config = require('config');

const log = require('../../lib/log');
const dbHelper = require('../dbHelper');

/**
 * Blanks `compose` and `contacts` on every installed enterprise app row that holds
 * them. An enterprise row keeps only its encrypted `enterprise` specification;
 * every reader that needs the components decrypts them from it. Every other field
 * of the row is left as it is.
 * @returns {Promise<number>} The rows blanked.
 */
async function blankStoredEnterpriseSecrets() {
  const db = dbHelper.databaseConnection();
  const result = await dbHelper.updateInDatabase(
    db.db(config.database.appslocal.database),
    config.database.appslocal.collections.appsInformation,
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
