const config = require('config');
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const nodeDosState = require('./nodeDosState');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');

// A node that keeps going out of service is held out longer each time, so it
// stops taking apps on between failures only to drop them again.
//
// Each time the node enters DOS for a reason other than this service's own, the
// chain height is recorded. Counted over the last WINDOW_BLOCKS:
//   - a 1st or 2nd episode: once the node is back in service it takes no new
//     apps for QUARANTINE_BLOCKS;
//   - the 3rd: the node is held out of service for SHORT_HOLD_BLOCKS, then takes
//     no new apps for HELD_QUARANTINE_BLOCKS;
//   - the 4th and later: held out for LONG_HOLD_BLOCKS, then the same.
//
// Counted in blocks, every window is the chain's: neither a restart nor the
// node's clock moves it. 120 blocks is one hour of 30 s blocks.
const WINDOW_BLOCKS = 2880;
const QUARANTINE_BLOCKS = 120;
const HELD_QUARANTINE_BLOCKS = 720;
const SHORT_HOLD_EPISODES = 3;
const SHORT_HOLD_BLOCKS = 720;
const LONG_HOLD_EPISODES = 4;
const LONG_HOLD_BLOCKS = 2880;

const RECORD_ID = 'dosRecurrence';
const OWNER = nodeDosState.StickyDosOwner.DOS_RECURRENCE;
const PLACEMENT_OWNER = fluxNetworkHelper.PlacementHoldOwner.DOS_RECURRENCE;

// The record as last read or written: the heights of the episodes in the
// window, and each hold as `{ fromHeight, blocks }`. A height recorded as null
// was taken while this node knew no chain height and is fixed at the first one
// it learns.
let record = null;
// Writes to the record run one after another, in the order the events came.
let writing = Promise.resolve();
let stopListening = [];

function collection() {
  const db = dbHelper.databaseConnection();
  return db.db(config.database.local.database).collection(config.database.local.collections.dosRecurrence);
}

function emptyRecord() {
  return {
    episodeHeights: [], dosHold: null, placementHold: null, lastEpisodeHeld: false,
  };
}

/**
 * @param {Array<number|null>} heights
 * @param {number} height The chain's height now; 0 when unknown.
 * @returns {Array<number|null>} The heights inside the window. A null height
 * is taken as `height`, and is kept as null while no height is known.
 */
function inWindow(heights, height) {
  if (!height) return heights;
  return heights.map((at) => at ?? height).filter((at) => height - at < WINDOW_BLOCKS);
}

/**
 * @param {{fromHeight: number|null, blocks: number}|null} hold
 * @param {number} height
 * @returns {boolean} Whether the hold has run its course at `height`. A hold
 * stands while no height is known, or none was when it started.
 */
function holdEnded(hold, height) {
  return Boolean(hold) && hold.fromHeight !== null && height > 0 && height - hold.fromHeight >= hold.blocks;
}

/**
 * @param {{fromHeight: number|null, blocks: number}} hold
 * @returns {string}
 */
function untilText(hold) {
  return hold.fromHeight === null ? 'a chain height is known' : `block ${hold.fromHeight + hold.blocks}`;
}

/** Holds the node as the record says, and releases what it no longer holds. */
function apply() {
  const { dosHold, placementHold, episodeHeights } = record;
  if (dosHold) {
    nodeDosState.setStickyDos(OWNER, `Out of service until ${untilText(dosHold)}: ${episodeHeights.length} DOS episodes in 24 hours`);
  } else {
    nodeDosState.clearStickyDos(OWNER);
  }
  if (placementHold) {
    fluxNetworkHelper.setPlacementHold(PLACEMENT_OWNER, `No new apps until ${untilText(placementHold)}: ${episodeHeights.length} DOS episodes in 24 hours`);
  } else {
    fluxNetworkHelper.clearPlacementHold(PLACEMENT_OWNER);
  }
}

async function save() {
  await collection().updateOne({ _id: RECORD_ID }, { $set: record }, { upsert: true });
}

/**
 * Runs `change` on the record after every change before it, then saves the
 * record and holds the node as it says.
 * @param {function(number): void} change Called with the chain height.
 * @returns {Promise<void>}
 */
function update(change) {
  writing = writing.then(async () => {
    change(fluxNetworkHelper.chainHeight());
    apply();
    await save();
  }).catch((error) => log.error(`dosRecurrence - ${error.message}`));
  return writing;
}

/**
 * The node entered DOS: one more episode.
 * @returns {Promise<void>}
 */
function onEntered() {
  return update((height) => {
    record.episodeHeights = inWindow([...record.episodeHeights, height || null], height);
    const count = record.episodeHeights.length;
    let blocks = 0;
    if (count >= LONG_HOLD_EPISODES) blocks = LONG_HOLD_BLOCKS;
    else if (count >= SHORT_HOLD_EPISODES) blocks = SHORT_HOLD_BLOCKS;
    record.lastEpisodeHeld = blocks > 0;
    record.placementHold = null;
    if (blocks) {
      record.dosHold = { fromHeight: height || null, blocks };
      log.error(`dosRecurrence - ${count} DOS episodes in 24 hours: out of service for ${blocks} blocks`);
    } else {
      log.warn(`dosRecurrence - DOS episode ${count} in 24 hours`);
    }
  });
}

/**
 * The node is back in service: it takes no new apps for the quarantine.
 * @returns {Promise<void>}
 */
function onCleared() {
  return update((height) => {
    record.placementHold = {
      fromHeight: height || null,
      blocks: record.lastEpisodeHeld ? HELD_QUARANTINE_BLOCKS : QUARANTINE_BLOCKS,
    };
  });
}

/**
 * A new chain height: fixes the heights taken while none was known, and ends
 * the holds that have run their course.
 * @returns {Promise<void>|undefined}
 */
function onHeight() {
  const height = fluxNetworkHelper.chainHeight();
  if (!height) return undefined;
  const { dosHold, placementHold, episodeHeights } = record;
  const unfixed = episodeHeights.includes(null) || dosHold?.fromHeight === null || placementHold?.fromHeight === null;
  if (!unfixed && !holdEnded(dosHold, height) && !holdEnded(placementHold, height)) return undefined;
  return update((now) => {
    record.episodeHeights = inWindow(record.episodeHeights, now);
    ['dosHold', 'placementHold'].forEach((key) => {
      if (record[key]?.fromHeight === null) record[key] = { ...record[key], fromHeight: now };
      if (holdEnded(record[key], now)) record[key] = null;
    });
  });
}

/**
 * Restores the record and the holds it states, then follows the node's DOS
 * state and the chain. A DOS standing before this starts is not counted: it
 * cannot be told apart from one this node was already in before a restart.
 * @returns {Promise<void>}
 */
async function start() {
  const stored = await collection().findOne({ _id: RECORD_ID }, { projection: { _id: 0 } });
  record = { ...emptyRecord(), ...stored };
  // Before listening: the restored hold takes the node out of service, and
  // that is not an episode. Every later hold is set while the node is already
  // out of service, so it is never one either.
  apply();
  stopListening = [
    nodeDosState.onNodeDos(() => { onEntered(); }),
    nodeDosState.onNodeDosCleared(() => { onCleared(); }),
    daemonServiceMiscRpcs.onDaemonHeight(() => onHeight()),
  ];
}

/**
 * @returns {Promise<void>} Resolves once every write started so far is saved.
 */
function settled() {
  return writing;
}

/**
 * Stops following, and waits for the writes already started.
 * @returns {Promise<void>}
 */
async function stop() {
  stopListening.forEach((stopOne) => stopOne());
  stopListening = [];
  await writing;
}

module.exports = {
  HELD_QUARANTINE_BLOCKS,
  LONG_HOLD_BLOCKS,
  QUARANTINE_BLOCKS,
  SHORT_HOLD_BLOCKS,
  WINDOW_BLOCKS,
  settled,
  start,
  stop,
};
