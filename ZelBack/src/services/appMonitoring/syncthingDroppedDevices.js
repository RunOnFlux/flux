const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');

// Each device this node took out of an app folder and has not added back, one
// document per folder and device, in the node's local database. Before v2.1.2
// syncthing keeps the index sequence it reached for a device dropped from a folder,
// so a device added back to that folder needs a reconnect
// (syncthingFolderWrites.reconnectAddedDevices); a device added to a folder for the
// first time does not. Syncthing keeps that sequence across a FluxOS restart, and
// so does this record.
//
// Every call is made inside the folder's write lock, so each ends within
// RECORD_LIMIT_MS; one that does not fails as any failed call does.

const RECORD_LIMIT_MS = 5 * 1000;
const limit = { timeoutMS: RECORD_LIMIT_MS };

function collection() {
  const db = dbHelper.databaseConnection();
  if (!db) throw new Error('the local database is not connected');
  return db.db(config.database.local.database).collection(config.database.local.collections.syncthingDroppedDevices);
}

const keyOf = (folder, device) => `${folder}|${device}`;

/**
 * Records devices about to be taken out of folders. A write that fails is logged
 * and the folder write goes ahead.
 * @param {Array<{folder: string, device: string}>} pairs
 * @returns {Promise<void>}
 */
async function dropped(pairs) {
  if (!pairs.length) return;
  try {
    const records = collection();
    await Promise.all(pairs.map(({ folder, device }) => records.updateOne(
      { _id: keyOf(folder, device) },
      { $set: { folder, device, at: new Date() } },
      { upsert: true, ...limit },
    )));
  } catch (error) {
    log.error(`syncthingDroppedDevices - ${pairs.map(({ folder, device }) => keyOf(folder, device)).join(', ')} not recorded: ${error.message}`);
  }
}

/**
 * Of the devices a write added to existing folders, those this node had taken out
 * of them. A record that cannot be read answers every device it was asked about:
 * a reconnect it did not need costs a moment, a missed one stalls the folder.
 * @param {Map<string, string[]>} added device id -> folder ids
 * @returns {Promise<Map<string, string[]>>} device id -> folder ids
 */
async function addedBack(added) {
  if (!added.size) return new Map();
  const keys = [...added].flatMap(([device, folders]) => folders.map((folder) => keyOf(folder, device)));
  let recorded;
  try {
    recorded = new Set((await collection().find({ _id: { $in: keys } }, { projection: { _id: 1 }, ...limit }).toArray()).map(({ _id }) => _id));
  } catch (error) {
    log.error(`syncthingDroppedDevices - cannot read which devices were taken out of their folders, so each one added is treated as added back: ${error.message}`);
    return added;
  }
  const back = new Map();
  added.forEach((folders, device) => {
    const returning = folders.filter((folder) => recorded.has(keyOf(folder, device)));
    if (returning.length) back.set(device, returning);
  });
  return back;
}

/**
 * Ends the records of devices added back to their folders.
 * @param {Map<string, string[]>} back device id -> folder ids
 * @returns {Promise<void>}
 */
async function cleared(back) {
  if (!back.size) return;
  const keys = [...back].flatMap(([device, folders]) => folders.map((folder) => keyOf(folder, device)));
  try {
    await collection().deleteMany({ _id: { $in: keys } }, limit);
  } catch (error) {
    log.error(`syncthingDroppedDevices - ${keys.join(', ')} not cleared: ${error.message}`);
  }
}

/**
 * Ends every record of a folder syncthing no longer holds.
 * @param {string} folder
 * @returns {Promise<void>}
 */
async function folderRemoved(folder) {
  try {
    await collection().deleteMany({ folder }, limit);
  } catch (error) {
    log.error(`syncthingDroppedDevices - records of folder ${folder} not cleared: ${error.message}`);
  }
}

module.exports = {
  RECORD_LIMIT_MS,
  addedBack,
  cleared,
  dropped,
  folderRemoved,
};
