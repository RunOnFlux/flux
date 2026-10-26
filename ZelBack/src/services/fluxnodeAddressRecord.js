// The address each fluxnode last confirmed at, and the changes of address the
// chain made, read from the blocks the explorer processes. Every fluxnode start
// and confirmation names the node's collateral and the ip it confirms at, so
// this is the chain's own account of where each node has been - what proves a
// move a node broadcasts once the node list shows it only at its new address.

const config = require('config');
const dbHelper = require('./dbHelper');
const { RUNNING_EXPIRY_MS } = require('./utils/appConstants');
const { normalizeSocketAddress } = require('./utils/socketAddressUtils');

// fluxd's FLUXNODE_CONFIRM_UPDATE_EXPIRATION_HEIGHT_V4: a node that does not
// confirm within this many blocks leaves the node list, so every listed node's
// address is in the last this-many blocks.
const CONFIRMATION_EXPIRY_BLOCKS = 640;
// A chain fact since the PON fork.
const BLOCK_MS = 30_000;
// A move is applied for IP_CHANGED_VALIDITY_MS (= RUNNING_EXPIRY_MS) after it
// is made, and the confirmation before the change can be up to
// CONFIRMATION_EXPIRY_BLOCKS older, so a record built from this many blocks
// below the tip proves every move still applied.
const RECORD_BLOCKS = CONFIRMATION_EXPIRY_BLOCKS + Math.ceil(RUNNING_EXPIRY_MS / BLOCK_MS);
// A change is dropped CONFIRMATION_EXPIRY_BLOCKS after it was made:
// 640 × 30 s = 19,200 s, longer than any move it proves is applied for
// (RUNNING_EXPIRY_MS, 7,500 s in production). fluxd allows a change every
// 5 blocks, so a node holds at most 128.

const collection = () => dbHelper.databaseConnection()
  .db(config.database.daemon.database)
  .collection(config.database.daemon.collections.fluxnodeAddresses);

let recordedHeight = 0;
const waiters = new Set();

/**
 * A node's collateral as the record keys it.
 * @param {string} txhash
 * @param {string|number} outidx
 * @returns {string}
 */
function collateralOf(txhash, outidx) {
  return `${txhash}:${Number(outidx)}`;
}

function noteRecorded(height) {
  recordedHeight = Math.max(recordedHeight, height);
  waiters.forEach((waiter) => {
    if (waiter.height <= recordedHeight) waiter.resolve(true);
  });
}

/**
 * Resolves true once the record holds every block up to `height`, false after
 * `timeoutMs` without it.
 * @param {number} height
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function whenRecorded(height, timeoutMs) {
  if (recordedHeight >= height) return Promise.resolve(true);
  return new Promise((resolve) => {
    const waiter = { height };
    const timer = setTimeout(() => waiter.resolve(false), timeoutMs);
    waiter.resolve = (reached) => {
      clearTimeout(timer);
      waiters.delete(waiter);
      resolve(reached);
    };
    waiters.add(waiter);
  });
}

/**
 * Records the fluxnode starts and confirmations of a block the explorer
 * processes, from RECORD_BLOCKS below the tip. Rejects when the record cannot
 * be written; the explorer then processes the block again.
 * @param {{height: number, confirmations: number, tx?: object[]}} block A verbose block.
 * @returns {Promise<void>}
 */
async function recordBlock(block) {
  if (block.confirmations > RECORD_BLOCKS) return;
  const confirmed = new Map();
  (block.tx ?? []).forEach((tx) => {
    if (tx.version >= 5 && tx.txhash && tx.ip) confirmed.set(collateralOf(tx.txhash, tx.outidx), normalizeSocketAddress(tx.ip));
  });
  const records = collection();
  if (confirmed.size) {
    const held = new Map((await records.find({ _id: { $in: [...confirmed.keys()] } }, { projection: { ip: 1 } }).toArray())
      .map((record) => [record._id, record.ip]));
    const writes = [...confirmed].map(([_id, ip]) => {
      const before = held.get(_id);
      if (before === undefined) {
        return {
          updateOne: {
            filter: { _id },
            update: { $set: { ip, height: block.height }, $setOnInsert: { firstHeight: block.height, changes: [] } },
            upsert: true,
          },
        };
      }
      if (before === ip) return { updateOne: { filter: { _id }, update: { $set: { height: block.height } } } };
      return {
        updateOne: {
          filter: { _id },
          update: [{
            $set: {
              ip,
              height: block.height,
              changes: {
                $concatArrays: [
                  { $filter: { input: '$changes', cond: { $gt: ['$$this.height', block.height - CONFIRMATION_EXPIRY_BLOCKS] } } },
                  [{ from: before, to: ip, height: block.height }],
                ],
              },
            },
          }],
        },
      };
    });
    await records.bulkWrite(writes, { ordered: true });
  }
  await records.deleteMany({ height: { $lt: block.height - CONFIRMATION_EXPIRY_BLOCKS } });
  noteRecorded(block.height);
}

/**
 * Whether the chain moved the node with `collateral` from `from` to `to`.
 * @param {string} collateral From collateralOf.
 * @param {string} from Socket address.
 * @param {string} to Socket address.
 * @returns {Promise<boolean>} Rejects when the record cannot be read.
 */
async function movedBetween(collateral, from, to) {
  const record = await collection().findOne(
    { _id: collateral, changes: { $elemMatch: { from: normalizeSocketAddress(from), to: normalizeSocketAddress(to) } } },
    { projection: { _id: 1 } },
  );
  return record !== null;
}

/**
 * Returns the record to the chain at `height`, after a reorg: a node first
 * confirmed above it is dropped, and one whose address changed above it is back
 * at the address it held before.
 * @param {number} height
 * @param {import('mongodb').Db} database The daemon database, on the maintenance client.
 * @returns {Promise<void>}
 */
async function restoreToHeight(height, database) {
  const records = database.collection(config.database.daemon.collections.fluxnodeAddresses);
  await records.deleteMany({ firstHeight: { $gt: height } });
  const changed = await records.find({ 'changes.height': { $gt: height } }, { projection: { changes: 1 } }).toArray();
  if (changed.length) {
    await records.bulkWrite(changed.map(({ _id, changes }) => {
      const undone = changes.filter((change) => change.height > height);
      return {
        updateOne: {
          filter: { _id },
          update: { $set: { ip: undone[0].from, changes: changes.filter((change) => change.height <= height) } },
        },
      };
    }), { ordered: true });
  }
  await records.updateMany({ height: { $gt: height } }, { $set: { height } });
  recordedHeight = Math.min(recordedHeight, height);
}

/**
 * Drops the record, for a scan of the chain from its start; it rebuilds from
 * RECORD_BLOCKS below the tip.
 * @param {import('mongodb').Db} database The daemon database, on the maintenance client.
 * @returns {Promise<void>}
 */
async function drop(database) {
  await dbHelper.dropCollection(database, config.database.daemon.collections.fluxnodeAddresses).catch((error) => {
    if (error.message !== 'ns not found') throw error;
  });
  recordedHeight = 0;
}

/**
 * Asserts the record's indexes.
 * @param {import('mongodb').Db} database The daemon database, on the maintenance client.
 * @returns {Promise<void>}
 */
async function ensureIndexes(database) {
  await dbHelper.ensureIndexes(database.collection(config.database.daemon.collections.fluxnodeAddresses), [
    { key: { height: 1 }, name: 'records by the block of their last confirmation' },
    { key: { firstHeight: 1 }, name: 'records by the block of their first confirmation' },
    { key: { 'changes.height': 1 }, name: 'records by the blocks of their changes' },
  ]);
}

module.exports = {
  RECORD_BLOCKS,
  collateralOf,
  recordBlock,
  whenRecorded,
  movedBetween,
  restoreToHeight,
  drop,
  ensureIndexes,
};
