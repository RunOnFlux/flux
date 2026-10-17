/**
 * Hold this node back from new placements while its database is timing out
 * FluxOS's calls.
 *
 * WHAT COUNTS. A round trip that ran out: a pooled connection closed by its own
 * socket timeout, or a wait for a pooled connection that ran out. Both are read
 * from the clients' pool events, which the driver emits for every call whatever
 * code made it. A read is retried once, so one stuck read is two round trips.
 *
 * WHAT DOES NOT. A connection closed because the server went away. The driver
 * clears the pool first, and every connection created before the clear then
 * closes with the same reason as a timeout. Connection ids only increase, so
 * the newest id at the last clear separates the two.
 *
 * The hold stops new installs and nothing else. Heavy load also makes calls
 * time out, so the apps the node already runs are left alone.
 */

const config = require('config');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');

const OWNER = fluxNetworkHelper.PlacementHoldOwner.DATABASE_SUSPECT;
const SUSPECT_ROUND_TRIPS = config.database.suspectRoundTrips;
const SUSPECT_WINDOW_MS = config.database.suspectWindowMs;

/**
 * When each recent round trip ran out, newest last, never more than
 * SUSPECT_ROUND_TRIPS of them: the only question asked of it is whether that
 * many fall inside the window.
 * @type {number[]}
 */
let timedOut = [];
/** Set while the hold stands; it releases the hold when it fires. */
let releaseTimer = null;

function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/** Every round trip it counted is a full window old by now, so none is left to count. */
function release() {
  releaseTimer = null;
  fluxNetworkHelper.clearPlacementHold(OWNER);
}

/**
 * Count one round trip that ran out. The hold is set when SUSPECT_ROUND_TRIPS
 * fall within SUSPECT_WINDOW_MS, and released SUSPECT_WINDOW_MS after the last.
 * @param {string} what Which client, and how it ran out.
 */
function recordTimeout(what) {
  const now = monotonicMs();
  timedOut = [...timedOut, now].filter((at) => now - at < SUSPECT_WINDOW_MS).slice(-SUSPECT_ROUND_TRIPS);
  log.warn(`databaseHealth - a database round trip ran out (${what})`);
  const held = releaseTimer !== null;
  if (!held && timedOut.length < SUSPECT_ROUND_TRIPS) return;
  if (!held) {
    fluxNetworkHelper.setPlacementHold(
      OWNER,
      `Database calls are timing out: ${SUSPECT_ROUND_TRIPS} round trips ran out within ${SUSPECT_WINDOW_MS / 60000} minutes`,
    );
  }
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(release, SUSPECT_WINDOW_MS);
}

/** The pool events of one client, and which of its closes were timeouts. */
class PoolTimeouts {
  /**
   * @param {string} name Names the client in the log.
   */
  constructor(name) {
    this.name = name;
    this.newestCreated = 0;
    this.newestBeforeClear = 0;
  }

  onCreated(event) {
    this.newestCreated = Math.max(this.newestCreated, event.connectionId);
  }

  onCleared() {
    this.newestBeforeClear = this.newestCreated;
  }

  onClosed(event) {
    if (event.reason !== 'error' || event.connectionId <= this.newestBeforeClear) return;
    recordTimeout(`${this.name} client, connection ${event.connectionId} timed out`);
  }

  onCheckOutFailed(event) {
    if (event.reason !== 'timeout') return;
    recordTimeout(`${this.name} client, no pooled connection within the timeout`);
  }
}

/**
 * Count the round trips that run out on this client.
 * @param {import('mongodb').MongoClient|null} client
 * @param {string} name Names the client in the log.
 */
function watch(client, name) {
  if (!client) return;
  const pool = new PoolTimeouts(name);
  client.on('connectionCreated', pool.onCreated.bind(pool));
  client.on('connectionPoolCleared', pool.onCleared.bind(pool));
  client.on('connectionClosed', pool.onClosed.bind(pool));
  client.on('connectionCheckOutFailed', pool.onCheckOutFailed.bind(pool));
}

/**
 * @returns {boolean} True while the database holds the node back.
 */
function isSuspect() {
  return releaseTimer !== null;
}

/** Forget every count and release the hold. */
function stop() {
  clearTimeout(releaseTimer);
  timedOut = [];
  release();
}

module.exports = {
  watch,
  isSuspect,
  stop,
};
