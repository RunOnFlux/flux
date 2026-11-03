/**
 * Holds this node back from NEW placements without declaring it unfit for the
 * apps it already runs. DOS is the other thing: isNodeDos() makes the spawner
 * refuse installs AND makes nodeStatusMonitor and appStartupManager remove every
 * app on the box. A node that must stop growing but keep its customer volumes
 * needs only the first. The spawner is the only consumer.
 *
 * Each feature that holds placement holds it under its own owner, with a reason.
 * The node is held while any owner holds it, and an owner releases only its own
 * hold, so a feature clearing its condition never releases the node from a
 * condition it knows nothing about.
 */

const log = require('../lib/log');
const fluxEventBus = require('./utils/fluxEventBus');

// Who may hold this node back from placement. An owner is an IDENTITY, not a
// message: the reason is what an operator reads, and the owner is what a release
// is checked against. A feature that holds placement adds a value here; an
// unknown owner is refused rather than accepted as a new one.
const PlacementHoldOwner = Object.freeze({
  RESIDENTIAL_DOS: 'residentialDos',
  DATABASE_SUSPECT: 'databaseSuspect',
  HOST_STALL: 'hostStall',
});

/** owner -> reason */
const placementHolds = new Map();

/**
 * Hold this node back from new placements. Idempotent per owner.
 * @param {string} owner A PlacementHoldOwner value. An unknown one throws: it is
 * a caller that was never given an identity, and accepting it would create an
 * owner nothing can ever release.
 * @param {string} reason Logged and reported.
 */
function setPlacementHold(owner, reason) {
  if (!Object.values(PlacementHoldOwner).includes(owner)) {
    throw new Error(`setPlacementHold: unknown owner ${owner}`);
  }
  if (placementHolds.get(owner) === reason) return;
  placementHolds.set(owner, reason);
  log.info(`Placement hold set by ${owner}: ${reason}`);
  fluxEventBus.publish('placementHold:set', { owner, reason });
}

/**
 * Release one owner's hold. Any other owner's hold stands.
 * @param {string} owner A PlacementHoldOwner value.
 */
function clearPlacementHold(owner) {
  const reason = placementHolds.get(owner);
  if (reason === undefined) return;
  placementHolds.delete(owner);
  log.info(`Placement hold cleared by ${owner} (was: ${reason})`);
  fluxEventBus.publish('placementHold:cleared', { owner, reason });
}

/**
 * @returns {string|null} Every standing hold's reason, or null when the node is
 * not held. Every one: naming only one of two would send an operator to lift a
 * condition that does not release the node.
 */
function getPlacementHold() {
  if (!placementHolds.size) return null;
  return [...placementHolds.values()].join('; ');
}

/**
 * @returns {boolean} True when this node must not take on new apps.
 */
function isPlacementHeld() {
  return placementHolds.size > 0;
}

module.exports = {
  PlacementHoldOwner,
  setPlacementHold,
  clearPlacementHold,
  getPlacementHold,
  isPlacementHeld,
};
