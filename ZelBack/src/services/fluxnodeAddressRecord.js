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
// A change proves a move for CONFIRMATION_EXPIRY_BLOCKS after it was made:
// 640 × 30 s = 19,200 s, longer than any move it proves is applied for
// (RUNNING_EXPIRY_MS, 7,500 s in production). Recording a change drops the
// node's changes older than that; fluxd allows a change every 5 blocks, so a
// node holds at most 128.

const RECORD_COLLECTION = config.database.daemon.collections.fluxnodeAddresses;
// Where a rebuild records its blocks before it replaces the record in one step.
const REBUILD_COLLECTION = `${RECORD_COLLECTION}_rebuild`;

const daemonDatabase = () => dbHelper.databaseConnection().db(config.database.daemon.database);
const collection = () => daemonDatabase().collection(RECORD_COLLECTION);

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
 * The address each fluxnode start and confirmation in a block confirms its node
 * at, by collateral.
 * @param {{tx?: object[]}} block A verbose block.
 * @returns {Map<string, string>}
 */
function confirmationsIn(block) {
  const confirmed = new Map();
  (block.tx ?? []).forEach((tx) => {
    if (tx.version >= 5 && tx.txhash && tx.ip) confirmed.set(collateralOf(tx.txhash, tx.outidx), normalizeSocketAddress(tx.ip));
  });
  return confirmed;
}

/**
 * A node's record once a block at `height` confirms it at `ip`.
 * @param {{ip: string, height: number, firstHeight: number, changes: object[]}|undefined} before
 *   Its record before the block, undefined when it has none.
 * @param {string} ip
 * @param {number} height
 * @returns {{ip: string, height: number, firstHeight: number, changes: object[]}}
 */
function confirmedAt(before, ip, height) {
  if (!before) return { ip, height, firstHeight: height, changes: [] };
  if (before.ip === ip) return { ...before, height };
  return {
    ...before,
    ip,
    height,
    changes: [
      ...before.changes.filter((change) => change.height > height - CONFIRMATION_EXPIRY_BLOCKS),
      { from: before.ip, to: ip, height },
    ],
  };
}

/**
 * The lowest last confirmation a record keeps after a block at `height`: a node
 * that has not confirmed since has left the node list.
 * @param {number} height
 * @returns {number}
 */
function keptFrom(height) {
  return height - CONFIRMATION_EXPIRY_BLOCKS;
}

/**
 * Writes the fluxnode starts and confirmations of a block within RECORD_BLOCKS
 * of the tip to `records`.
 * @param {{height: number, confirmations: number, tx?: object[]}} block A verbose block.
 * @param {import('mongodb').Collection} records
 * @returns {Promise<boolean>} Whether the block is within RECORD_BLOCKS of the tip.
 */
async function writeBlock(block, records) {
  if (block.confirmations > RECORD_BLOCKS) return false;
  const confirmed = confirmationsIn(block);
  if (confirmed.size) {
    const held = new Map((await records.find({ _id: { $in: [...confirmed.keys()] } }).toArray())
      .map(({ _id, ...record }) => [_id, record]));
    await records.bulkWrite([...confirmed].map(([_id, ip]) => ({
      replaceOne: { filter: { _id }, replacement: confirmedAt(held.get(_id), ip, block.height), upsert: true },
    })), { ordered: true });
  }
  await records.deleteMany({ height: { $lt: keptFrom(block.height) } });
  return true;
}

/**
 * Records the fluxnode starts and confirmations of a block the explorer
 * processes, from RECORD_BLOCKS below the tip. A block deeper than that is
 * skipped, and a record holding blocks from before it is dropped, so the record
 * starts again at the first block it can hold: kept, it would log each node's
 * first confirmation after the skipped blocks as a change of address made
 * there. Rejects when the record cannot be written; the explorer then
 * processes the block again.
 * @param {{height: number, confirmations: number, tx?: object[]}} block A verbose block.
 * @returns {Promise<void>}
 */
async function recordBlock(block) {
  if (await writeBlock(block, collection())) noteRecorded(block.height);
  else if (recordedHeight > 0) await drop(dbHelper.onMaintenanceClient(daemonDatabase()));
}

/**
 * Whether the chain moved the node with `collateral` from `from` to `to`
 * within the CONFIRMATION_EXPIRY_BLOCKS below the highest block recorded.
 * @param {string} collateral From collateralOf.
 * @param {string} from Socket address.
 * @param {string} to Socket address.
 * @returns {Promise<boolean>} Rejects when the record cannot be read.
 */
async function movedBetween(collateral, from, to) {
  const change = {
    from: normalizeSocketAddress(from),
    to: normalizeSocketAddress(to),
    height: { $gt: recordedHeight - CONFIRMATION_EXPIRY_BLOCKS },
  };
  const record = await collection().findOne(
    { _id: collateral, changes: { $elemMatch: change } },
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
  const records = database.collection(RECORD_COLLECTION);
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
  await dbHelper.dropCollection(database, RECORD_COLLECTION).catch((error) => {
    if (error.message !== 'ns not found') throw error;
  });
  recordedHeight = 0;
}

/**
 * Marks a built record as holding every block up to the explorer's scanned
 * height when the explorer starts: each block it processes is recorded before
 * its scanned height moves past it.
 * @param {number} scannedHeight
 */
function resumeAt(scannedHeight) {
  noteRecorded(scannedHeight);
}

/**
 * Whether the record holds anything: built by a rebuild, or recorded block by
 * block, oldest first, by an explorer that passed the blocks it covers. Every
 * listed node confirms within the blocks it covers, so a record that holds
 * nothing has not been built.
 * @returns {Promise<boolean>}
 */
async function isBuilt() {
  return (await collection().countDocuments({}, { limit: 1 })) > 0;
}

/**
 * Builds the record from the RECORD_BLOCKS blocks up to `height`, oldest first,
 * for an explorer already within them when it first keeps the record. Without
 * them it proves no move by a node that last confirmed before. The blocks are
 * applied in memory by the rule the explorer's blocks are written by, written
 * aside in one insert and swapped in in one step, so a reader never sees a
 * record part built, and a rebuild that stops part way leaves the record as it
 * was for the next to build again.
 * @param {number} height The explorer's scanned height.
 * @param {function(number): Promise<object>} fetchBlock A verbose block at a height.
 * @param {import('mongodb').Db} database The daemon database, on the maintenance client.
 * @returns {Promise<void>}
 */
async function rebuild(height, fetchBlock, database) {
  const built = new Map();
  for (let blockHeight = Math.max(height - RECORD_BLOCKS + 1, 1); blockHeight <= height; blockHeight += 1) {
    // eslint-disable-next-line no-await-in-loop
    const block = await fetchBlock(blockHeight);
    if (block.confirmations <= RECORD_BLOCKS) {
      confirmationsIn(block).forEach((ip, collateral) => built.set(collateral, confirmedAt(built.get(collateral), ip, block.height)));
      built.forEach((record, collateral) => {
        if (record.height < keptFrom(block.height)) built.delete(collateral);
      });
    }
  }
  await dbHelper.dropCollection(database, REBUILD_COLLECTION).catch((error) => {
    if (error.message !== 'ns not found') throw error;
  });
  await database.createCollection(REBUILD_COLLECTION);
  const staging = database.collection(REBUILD_COLLECTION);
  if (built.size) await staging.insertMany([...built].map(([_id, record]) => ({ _id, ...record })));
  // eslint-disable-next-line no-use-before-define
  await ensureIndexes(database, REBUILD_COLLECTION);
  await staging.rename(RECORD_COLLECTION, { dropTarget: true });
  noteRecorded(height);
}

/**
 * Asserts the record's indexes.
 * @param {import('mongodb').Db} database The daemon database, on the maintenance client.
 * @param {string} [name] The collection: the record unless given.
 * @returns {Promise<void>}
 */
async function ensureIndexes(database, name = RECORD_COLLECTION) {
  await dbHelper.ensureIndexes(database.collection(name), [
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
  isBuilt,
  resumeAt,
  rebuild,
  ensureIndexes,

  // exported for testing
  writeBlock,
};
