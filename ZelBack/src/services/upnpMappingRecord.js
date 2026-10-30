const config = require('config');
const dbHelper = require('./dbHelper');
const log = require('../lib/log');

// Every UPnP mapping this node has asked its router for and not seen removed, one
// document per `port/protocol`, in the node's local database. upnpRouter's client
// writes one before it sends the router an add, and deletes it once the router has
// removed the mapping or answered that it holds none of this node's on that port.
// A FluxOS that stops between a map and its removal finds the mapping here at its
// next start. A node maps its own ports at boot before it connects to the
// database: a write made before then waits in memory (unwritten) until the local
// database is prepared (writeWaiting), or a call finds it connected first.
//
// One more document, COMPLETE_ID, says the record covers every mapping this node
// holds on its router: written once a listing of the router's table has removed
// what this node mapped before the record existed. Without it, the start's cleanup
// lists the table as well.

const COMPLETE_ID = 'complete';

// Writes made before the database was connected, by key: the document to write,
// or null for a record ended.
const unwritten = new Map();

function collection() {
  const db = dbHelper.databaseConnection();
  return db ? db.db(config.database.local.database).collection(config.database.local.collections.upnpMappings) : null;
}

const keyOf = (port, protocol) => `${port}/${String(protocol).toUpperCase()}`;

/**
 * Writes what waited for the database, oldest first.
 * @param {object} records the collection
 * @returns {Promise<void>}
 */
async function writeUnwritten(records) {
  // eslint-disable-next-line no-restricted-syntax
  for (const [key, document] of unwritten) {
    if (document) {
      // eslint-disable-next-line no-await-in-loop
      await records.updateOne({ _id: key }, { $set: document }, { upsert: true });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await records.deleteOne({ _id: key });
    }
    unwritten.delete(key);
  }
}

/**
 * Writes the record's writes made before the database was connected. A write
 * that fails is logged and waits for the next call that finds the database
 * connected.
 * @returns {Promise<void>}
 */
async function writeWaiting() {
  try {
    const records = collection();
    if (records) await writeUnwritten(records);
  } catch (error) {
    log.error(`upnpMappingRecord - records made before the database was connected not written: ${error.message}`);
  }
}

/**
 * Records a mapping about to be asked for. A write that fails is logged and the
 * map goes ahead: the port matters more than its record.
 * @param {number} port
 * @param {string} protocol
 * @param {string} description
 * @returns {Promise<void>}
 */
async function mapping(port, protocol, description) {
  const key = keyOf(port, protocol);
  const document = {
    port, protocol: String(protocol).toUpperCase(), description, at: new Date(),
  };
  try {
    const records = collection();
    if (!records) {
      unwritten.set(key, document);
      return;
    }
    await writeUnwritten(records);
    await records.updateOne({ _id: key }, { $set: document }, { upsert: true });
  } catch (error) {
    log.error(`upnpMappingRecord - ${keyOf(port, protocol)} not recorded: ${error.message}`);
  }
}

/**
 * Ends a mapping's record.
 * @param {number} port
 * @param {string} protocol
 * @returns {Promise<void>}
 */
async function removed(port, protocol) {
  const key = keyOf(port, protocol);
  try {
    const records = collection();
    if (!records) {
      unwritten.set(key, null);
      return;
    }
    await writeUnwritten(records);
    await records.deleteOne({ _id: key });
  } catch (error) {
    log.error(`upnpMappingRecord - ${keyOf(port, protocol)} not cleared: ${error.message}`);
  }
}

/**
 * Every recorded mapping.
 * @returns {Promise<Array<{port: number, protocol: string, description: string, at: Date}>>}
 */
async function all() {
  const records = collection();
  if (!records) return [...unwritten.values()].filter(Boolean);
  await writeUnwritten(records);
  return records.find({ _id: { $ne: COMPLETE_ID } }, { projection: { _id: 0 } }).toArray();
}

/**
 * Whether the record covers every mapping this node holds on its router.
 * @returns {Promise<boolean>}
 */
async function complete() {
  const records = collection();
  if (!records) return false;
  return Boolean(await records.findOne({ _id: COMPLETE_ID }));
}

/**
 * Says the record covers every mapping this node holds on its router.
 * @returns {Promise<void>}
 */
async function markComplete() {
  const records = collection();
  if (!records) return;
  await records.updateOne({ _id: COMPLETE_ID }, { $set: { at: new Date() } }, { upsert: true });
}

module.exports = {
  unwritten,
  writeWaiting,
  mapping,
  removed,
  all,
  complete,
  markComplete,
};
