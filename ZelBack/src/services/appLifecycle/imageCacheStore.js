const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');

// Durable record of an enterprise owner's pinned docker images (the image cache).
// One doc per (fluxId, repotag): an enterprise app owner allowed on this node has
// asked it to pre-pull and PIN the image so a later app install/redeploy is a local
// layer-cache hit. The doc is the durable "pin" that the uninstall retention gate
// consults (do not delete an image still pinned here) and that the per-fluxId 20GB
// quota + node-wide cap are accounted against.
//
// Credentials are NEVER stored here (repoauth is decrypted in memory for the pull
// and discarded) — the doc carries only repotag/digest/size/state/timestamps, the
// same no-cleartext-secret invariant the teardown store holds.
//
// Failure contract: writes/deletes are best-effort (log + return boolean, never
// throw) — they sit under paths that complete on their own. Reads return `null` on
// a DB error (distinct from an empty array / missing doc) so each caller can apply
// the correct safe default: accounting/admission FAILS CLOSED on null (refuse the
// download), the retention gate FAILS SAFE on null (keep the image).

const appsLocalDatabase = config.database.appslocal.database;
const { cachedImages } = config.database.appslocal.collections;

function collection() {
  const db = dbHelper.databaseConnection();
  return db.db(appsLocalDatabase);
}

/**
 * Upsert one cache record, keyed by (fluxId, repotag).
 * @param {object} record - { fluxId, repotag, ...fields }
 * @returns {Promise<boolean>} true if written, false on a DB failure
 */
async function upsertImage(record) {
  try {
    const database = collection();
    await dbHelper.updateOneInDatabase(
      database,
      cachedImages,
      { fluxId: record.fluxId, repotag: record.repotag },
      { $set: record },
      { upsert: true },
    );
    return true;
  } catch (err) {
    log.error(`imageCacheStore - failed to upsert ${record && record.fluxId}/${record && record.repotag}: ${err.message}`);
    return false;
  }
}

/**
 * Patch fields on an existing record (state transitions, reconciled sizes, error).
 * @param {string} fluxId
 * @param {string} repotag
 * @param {object} patch - fields to $set
 * @returns {Promise<boolean>} true if applied, false on a DB failure
 */
async function patchImage(fluxId, repotag, patch) {
  try {
    const database = collection();
    await dbHelper.updateOneInDatabase(database, cachedImages, { fluxId, repotag }, { $set: patch }, { upsert: false });
    return true;
  } catch (err) {
    log.error(`imageCacheStore - failed to patch ${fluxId}/${repotag}: ${err.message}`);
    return false;
  }
}

/**
 * One owner's record for a repotag.
 * @returns {Promise<object|null>} the doc, or null if missing OR on a DB error
 */
async function getImage(fluxId, repotag) {
  try {
    const database = collection();
    return await dbHelper.findOneInDatabase(database, cachedImages, { fluxId, repotag }, { projection: { _id: 0 } });
  } catch (err) {
    log.error(`imageCacheStore - failed to get ${fluxId}/${repotag}: ${err.message}`);
    return null;
  }
}

/**
 * Every record owned by one fluxId (per-owner listing + quota accounting).
 * @returns {Promise<Array<object>|null>} records, or null on a DB error (callers
 * that account against the quota MUST treat null as fail-closed).
 */
async function listImagesForFluxId(fluxId) {
  try {
    const database = collection();
    return await dbHelper.findInDatabase(database, cachedImages, { fluxId }, { projection: { _id: 0 } });
  } catch (err) {
    log.error(`imageCacheStore - failed to list for ${fluxId}: ${err.message}`);
    return null;
  }
}

/**
 * Every cache record on this node (node-wide cap accounting + GC).
 * @returns {Promise<Array<object>|null>} records, or null on a DB error.
 */
async function listAllImages() {
  try {
    const database = collection();
    return await dbHelper.findInDatabase(database, cachedImages, {}, { projection: { _id: 0 } });
  } catch (err) {
    log.error(`imageCacheStore - failed to list all: ${err.message}`);
    return null;
  }
}

/**
 * Records pinning a given repotag, across ALL owners — the retention gate's lookup
 * ("is this image still pinned by anyone?").
 * @returns {Promise<Array<object>|null>} records, or null on a DB error (the gate
 * MUST treat null as fail-safe = retain the image).
 */
async function findPinsForRepotag(repotag) {
  try {
    const database = collection();
    return await dbHelper.findInDatabase(database, cachedImages, { repotag }, { projection: { _id: 0, fluxId: 1, state: 1 } });
  } catch (err) {
    log.error(`imageCacheStore - failed to find pins for ${repotag}: ${err.message}`);
    return null;
  }
}

/**
 * Drop one owner's record for a repotag (DELETE endpoint / unpin).
 * @returns {Promise<boolean>} true if removed, false on a DB failure
 */
async function removeImage(fluxId, repotag) {
  try {
    const database = collection();
    await dbHelper.removeDocumentsFromCollection(database, cachedImages, { fluxId, repotag });
    return true;
  } catch (err) {
    log.error(`imageCacheStore - failed to remove ${fluxId}/${repotag}: ${err.message}`);
    return false;
  }
}

/**
 * Drop every record for one fluxId (owner removed from this node's allowed list).
 * @returns {Promise<boolean>} true if removed, false on a DB failure
 */
async function removeAllForFluxId(fluxId) {
  try {
    const database = collection();
    await dbHelper.removeDocumentsFromCollection(database, cachedImages, { fluxId });
    return true;
  } catch (err) {
    log.error(`imageCacheStore - failed to remove all for ${fluxId}: ${err.message}`);
    return false;
  }
}

/**
 * Unique index on (fluxId, repotag) — one record per owner per image — plus a
 * lookup index on repotag for the cross-owner retention-gate query. Called at boot
 * beside the other prepares.
 */
async function prepareCollection() {
  try {
    const database = collection();
    await database.collection(cachedImages).createIndex({ fluxId: 1, repotag: 1 }, { unique: true, name: 'fluxId_repotag_unique' });
    await database.collection(cachedImages).createIndex({ repotag: 1 }, { name: 'repotag_lookup' });
  } catch (err) {
    log.error(`imageCacheStore - failed to prepare collection: ${err.message}`);
  }
}

module.exports = {
  upsertImage,
  patchImage,
  getImage,
  listImagesForFluxId,
  listAllImages,
  findPinsForRepotag,
  removeImage,
  removeAllForFluxId,
  prepareCollection,
};
