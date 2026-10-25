const config = require('config');
const dbHelper = require('../dbHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const appPlacements = require('../appManagement/appPlacements');
const { localAppsInformation } = require('../utils/appConstants');
const { untilSucceeds } = require('../utils/untilSucceeds');

/**
 * Gives each app installed here without a placement record one, from this node's
 * own location rows, once this node knows the address they are filed under. Run
 * again until it succeeds.
 * @returns {Promise<void>}
 */
async function backfillPlacements() {
  await untilSucceeds('Backfilling placement records', async () => {
    const localSocketAddr = await fluxNetworkHelper.waitForLocalSocketAddress();
    const installed = await dbHelper.findInDatabase(
      dbHelper.databaseConnection().db(config.database.appslocal.database),
      localAppsInformation,
      {},
      { projection: { _id: 0, name: 1 } },
    );
    await appPlacements.backfillPlacements(installed.map((app) => app.name), localSocketAddr);
  });
}

module.exports = { backfillPlacements };
