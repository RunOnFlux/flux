const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const fluxEventBus = require('../utils/fluxEventBus');
const { AsyncGate } = require('../utils/asyncGate');

// When this node took each app it holds: one record per app, keyed by name.
//
// The record follows the app's data on this node. It is written when a hard
// install creates the app's volume, and deleted when a removal deletes the
// volume; a soft redeploy keeps the volume and leaves the record as it is. So a
// hard redeploy, which starts from an empty volume, starts a new record.
//
// The announcer reads runningSince from here and nowhere else, because the
// network's copy of this node's own location rows lapses in normal running -
// expiry, eviction, sigterm - while the app goes on running.
//
// A record outlives its app when a soft redeploy removes the app and its reinstall
// does not happen, which leaves the volume on disk and the record with it, when
// the app is removed while the backfill below is writing, or when the removal
// cannot delete it. Boot removes records of apps not installed. Only an installed app's record is read, and the app returns
// only through a hard install, which overwrites it.
//
// Kept apart from the app's specification in appsInformation: a spec update
// deletes and re-inserts that, and this record must outlive it.

const appsLocalDatabase = config.database.appslocal.database;
const { appsPlacements } = config.database.appslocal.collections;
const { appsLocations } = config.database.appsglobal.collections;

// Open once every app installed at start has a record.
const backfilledGate = new AsyncGate();

function localDatabase() {
  return dbHelper.databaseConnection().db(appsLocalDatabase);
}

/**
 * One record per app name.
 * @returns {Promise<void>}
 */
async function prepareCollection() {
  await dbHelper.ensureIndexes(localDatabase().collection(appsPlacements), [
    { key: { name: 1 }, unique: true, name: 'name_unique', recover: dbHelper.dedupeByKey },
  ]);
}

/**
 * Record that this node took an app now, over any record it had of the app: a
 * hard install has just created the app's volume.
 * @param {string} name App name.
 * @returns {Promise<void>}
 */
async function recordPlacement(name) {
  const placedAt = new Date();
  await dbHelper.updateOneInDatabase(
    localDatabase(),
    appsPlacements,
    { name },
    { $set: { name, placedAt } },
    { upsert: true },
  );
  fluxEventBus.publish('app:placementRecorded', { name, placedAt: placedAt.toISOString(), source: 'install' });
}

/**
 * When this node took each named app, for the apps it has a record of.
 * @param {Array<string>} names App names.
 * @returns {Promise<Map<string, Date>>} placedAt by name.
 */
async function placementsOf(names) {
  const records = await dbHelper.findInDatabase(
    localDatabase(),
    appsPlacements,
    { name: { $in: names } },
    { projection: { _id: 0, name: 1, placedAt: 1 } },
  );
  return new Map(records.map(({ name, placedAt }) => [name, placedAt]));
}

/**
 * Forget an app whose volume this node has deleted.
 * @param {string} name App name.
 * @returns {Promise<void>}
 */
async function removePlacement(name) {
  const result = await dbHelper.removeDocumentsFromCollection(localDatabase(), appsPlacements, { name });
  if (result?.deletedCount) fluxEventBus.publish('app:placementRemoved', { name });
}

/**
 * Remove the records of apps not installed here.
 * @param {Array<string>} installedNames Names of the apps installed here.
 * @returns {Promise<number>} How many were removed.
 */
async function removeStrayPlacements(installedNames) {
  const removal = await dbHelper.removeDocumentsFromCollection(localDatabase(), appsPlacements, { name: { $nin: installedNames } });
  const removed = removal?.deletedCount ?? 0;
  if (removed) log.info(`appPlacements - removed ${removed} record(s) of apps not installed here`);
  fluxEventBus.publish('app:placementsTidied', { removed });
  return removed;
}

/**
 * Give each installed app without a record one. It is dated at the runningSince
 * this node's own location row holds, so the app keeps the place among its
 * instances the network already gives it, and dated now when there is no row. A
 * record that exists is left as it is. Opens waitForBackfill.
 * @param {Array<string>} installedNames Names of the apps installed here.
 * @param {string} localSocketAddr This node's address, which its rows are filed under.
 * @returns {Promise<{created: number, fromLocationRows: number}>} What was written.
 */
async function backfillPlacements(installedNames, localSocketAddr) {
  const recorded = await placementsOf(installedNames);
  const missing = installedNames.filter((name) => !recorded.has(name));

  const ownRows = missing.length
    ? await dbHelper.findInDatabase(
      dbHelper.databaseConnection().db(config.database.appsglobal.database),
      appsLocations,
      { ip: localSocketAddr, name: { $in: missing } },
      { projection: { _id: 0, name: 1, runningSince: 1 } },
    )
    : [];
  const rowSince = new Map(ownRows.filter((row) => row.runningSince).map((row) => [row.name, new Date(row.runningSince)]));
  const now = new Date();
  // eslint-disable-next-line no-restricted-syntax
  for (const name of missing) {
    const placedAt = rowSince.get(name) ?? now;
    // eslint-disable-next-line no-await-in-loop
    const result = await dbHelper.updateOneInDatabase(
      localDatabase(),
      appsPlacements,
      { name },
      { $setOnInsert: { name, placedAt } },
      { upsert: true },
    );
    if (result?.upsertedCount) {
      fluxEventBus.publish('app:placementRecorded', { name, placedAt: placedAt.toISOString(), source: rowSince.has(name) ? 'locationRow' : 'now' });
    }
  }

  if (missing.length) {
    log.info(`appPlacements - recorded ${missing.length} placement(s), ${rowSince.size} from this node's location rows`);
  }
  fluxEventBus.publish('app:placementsBackfilled', { created: missing.length, fromLocationRows: rowSince.size });
  backfilledGate.open();
  return { created: missing.length, fromLocationRows: rowSince.size };
}

/**
 * Resolves once every app installed at start has a record.
 * @returns {Promise<void>}
 */
function waitForBackfill() {
  return backfilledGate.wait();
}

module.exports = {
  prepareCollection,
  recordPlacement,
  placementsOf,
  removePlacement,
  removeStrayPlacements,
  backfillPlacements,
  waitForBackfill,
};
