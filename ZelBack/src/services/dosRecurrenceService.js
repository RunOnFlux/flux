const config = require('config');
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const nodeDosState = require('./nodeDosState');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxEventBus = require('./utils/fluxEventBus');
const {
  blockWindowRule, inWindow, judgeHold, untilText,
} = require('./utils/blockWindowHolds');

// A node that keeps failing is held out longer each time, so it stops taking
// apps on between failures only to drop them again.
//
// Each time the node enters DOS on a failure, the chain height is recorded.
// Counted over the last WINDOW_BLOCKS:
//   - a 1st or 2nd episode: once the node is back in service it takes no new
//     apps for QUARANTINE_BLOCKS;
//   - the 3rd: the node is held out of service for SHORT_HOLD_BLOCKS, then takes
//     no new apps for HELD_QUARANTINE_BLOCKS;
//   - the 4th and later: held out for LONG_HOLD_BLOCKS, then the same.
//
// A failure is the node not doing what a node must: its ports not answering, its
// router refusing it, its host stalled, its peers dropping. A DOS a policy sets
// on purpose (residential, tampering, a version floor, a second machine on the
// collateral, a misconfigured fluxd, the IP change limit) is not one: it ends
// when its condition does, and repeating it says nothing about the node failing.
//
// The lengths are config.dosRecurrence's, in blocks (utils/blockWindowHolds).
const WINDOW_BLOCKS = config.dosRecurrence.windowBlocks;
const QUARANTINE_BLOCKS = config.dosRecurrence.quarantineBlocks;
const HELD_QUARANTINE_BLOCKS = config.dosRecurrence.heldQuarantineBlocks;
const SHORT_HOLD_EPISODES = 3;
const SHORT_HOLD_BLOCKS = config.dosRecurrence.shortHoldBlocks;
const LONG_HOLD_EPISODES = 4;
const LONG_HOLD_BLOCKS = config.dosRecurrence.longHoldBlocks;

const RECORD_ID = 'dosRecurrence';
const DUPLICATE_KEY = 11000;
const OWNER = nodeDosState.StickyDosOwner.DOS_RECURRENCE;
const PLACEMENT_OWNER = fluxNetworkHelper.PlacementHoldOwner.DOS_RECURRENCE;
const FAILURE_OWNERS = [
  nodeDosState.StickyDosOwner.UPNP_ROUTER,
  nodeDosState.StickyDosOwner.HOST_STALL,
  nodeDosState.StickyDosOwner.PEER_SET_STABILITY,
];

// The record as last stored: the heights of the episodes in the window, each hold
// as `{ fromHeight, blocks }`, and whether the node is out of service on an episode
// it counted, so its return to service starts the quarantine across a restart.
let record = null;
// The last chain height this service has judged the holds at, once whatever
// that height changed is saved; 0 until it has judged one.
let judgedHeight = 0;
// The height the pass running now judges at.
let judgingHeight = 0;
let stopListening = [];
let lastPass = Promise.resolve();

function collection() {
  const db = dbHelper.databaseConnection();
  return db.db(config.database.local.database).collection(config.database.local.collections.dosRecurrence);
}

function emptyRecord() {
  return {
    episodeHeights: [], dosHold: null, placementHold: null, lastEpisodeHeld: false, awaitingExit: false,
  };
}

/**
 * @returns {boolean} Whether the node is out of service on a failure, among
 * whatever else holds it out.
 */
function outOnFailure() {
  if (FAILURE_OWNERS.some((owner) => nodeDosState.isStickyDosHeldBy(owner))) return true;
  return nodeDosState.isScoreDos() && !fluxNetworkHelper.isPolicyDosMessage(nodeDosState.getRawDosMessage());
}

/** Holds the node as the record says, and releases what it no longer holds. */
function holdBy(state) {
  const { dosHold, placementHold, episodeHeights } = state;
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

async function load() {
  const stored = await collection().findOne({ _id: RECORD_ID }, { projection: { _id: 0 } });
  // A record written before awaitingExit was kept holds the node out exactly
  // while an episode it counted is open.
  const awaitingExit = stored?.awaitingExit ?? Boolean(stored?.dosHold);
  return { ...emptyRecord(), ...stored, awaitingExit };
}

/**
 * Stores the record while it is still the one read. Each store counts its
 * `revision` up, and a record with no revision yet is stored only while none
 * has been stored.
 * @param {object} before The record as read.
 * @param {object} after The record to store.
 * @returns {Promise<boolean>} False when the stored record changed since it was read.
 */
async function save(before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return true;
  const revision = before.revision ?? 0;
  const stored = { ...after, revision: revision + 1 };
  try {
    const { matchedCount, upsertedCount } = await collection().updateOne(
      { _id: RECORD_ID, revision: before.revision ?? { $exists: false } },
      { $set: stored },
      { upsert: true },
    );
    if (!matchedCount && !upsertedCount) return false;
  } catch (error) {
    if (error.code === DUPLICATE_KEY) return false;
    throw error;
  }
  fluxEventBus.publish('dosRecurrence:changed', { ...stored });
  return true;
}

function judge(state, height) {
  judgingHeight = height;
  return {
    ...state,
    episodeHeights: inWindow(state.episodeHeights, height, WINDOW_BLOCKS),
    dosHold: judgeHold(state.dosHold, height),
    placementHold: judgeHold(state.placementHold, height),
  };
}

const rule = blockWindowRule({
  load,
  save,
  judge,
  apply: (state) => {
    record = state;
    holdBy(state);
    if (judgingHeight) judgedHeight = judgingHeight;
  },
});

/**
 * Runs a pass of the rule, kept for settled().
 * @param {function(object, number): object} [change]
 * @returns {Promise<object|undefined>}
 */
function pass(change) {
  lastPass = rule.pass(change).catch((error) => { log.error(`dosRecurrence - ${error.message}`); });
  return lastPass;
}

/**
 * The node entered DOS on a failure: one more episode.
 * @returns {Promise<object|undefined>}
 */
function onEntered() {
  return pass((state, height) => {
    const episodeHeights = inWindow([...state.episodeHeights, height || null], height, WINDOW_BLOCKS);
    const count = episodeHeights.length;
    let blocks = 0;
    if (count >= LONG_HOLD_EPISODES) blocks = LONG_HOLD_BLOCKS;
    else if (count >= SHORT_HOLD_EPISODES) blocks = SHORT_HOLD_BLOCKS;
    if (blocks) {
      log.error(`dosRecurrence - ${count} DOS episodes in 24 hours: out of service for ${blocks} blocks`);
    } else {
      log.warn(`dosRecurrence - DOS episode ${count} in 24 hours`);
    }
    return {
      ...state,
      episodeHeights,
      lastEpisodeHeld: blocks > 0,
      awaitingExit: true,
      placementHold: null,
      dosHold: blocks ? { fromHeight: height || null, blocks } : state.dosHold,
    };
  });
}

/**
 * The node is back in service: after an episode it counted, it takes no new apps
 * for the quarantine.
 * @returns {Promise<object|undefined>}
 */
function onCleared() {
  return pass((state, height) => (state.awaitingExit ? {
    ...state,
    awaitingExit: false,
    placementHold: {
      fromHeight: height || null,
      blocks: state.lastEpisodeHeld ? HELD_QUARANTINE_BLOCKS : QUARANTINE_BLOCKS,
    },
  } : state));
}

fluxEventBus.snapshot('dosRecurrence', () => ({ judgedHeight, record }));

/**
 * Restores the record and the holds it states, then follows the node's DOS
 * state and the chain. A DOS standing before this starts is not counted: it
 * cannot be told apart from one this node was already in before a restart.
 * A counted episode still awaiting its exit, on a node not in DOS when this
 * starts, takes its exit here and its quarantine starts. This runs before the
 * node's checks do, so a failure that persists across the restart is counted
 * again as a new episode once a check takes the node out.
 * @returns {Promise<void>}
 */
async function start() {
  record = await load();
  // Before listening: the restored hold takes the node out of service, and
  // that is not an episode. Every later hold is set while the node is already
  // out of service, so it is never one either.
  holdBy(record);
  stopListening = [
    nodeDosState.onNodeDos(() => {
      if (outOnFailure()) onEntered();
    }),
    nodeDosState.onNodeDosCleared(() => { onCleared(); }),
    rule.watch((error) => log.error(`dosRecurrence - ${error.message}`)),
  ];
  if (record.awaitingExit && !nodeDosState.isNodeDos()) await onCleared();
}

/**
 * @returns {Promise<void>} Resolves once every pass started so far is saved.
 */
async function settled() {
  await lastPass;
  await rule.pass();
}

/**
 * Stops following, and waits for the passes already started.
 * @returns {Promise<void>}
 */
async function stop() {
  stopListening.forEach((stopOne) => stopOne());
  stopListening = [];
  await settled();
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
