const log = require('../lib/log');
const fluxEventBus = require('./utils/fluxEventBus');

// This node's DOS state: whether it is fit to serve the network. Every check that
// can take the node out of service writes here, and every reader asks here.
//
// Three parts make the state a reader sees:
//   - the shared score, with its message, that the fluxbench, collision, IP
//     detection and apps port checks write;
//   - the availability check's own points - asks no peer answered as reachable,
//     and time spent reachable with too few peer connections - added to the
//     score, so a check that resets the score leaves them standing;
//   - sticky holds, each with an owner, which stand at the DOS limit whatever
//     the score says until their owner releases them.
//
// Every write goes through this module, so the moment the node enters or leaves
// DOS is seen here, once, and told to the onNodeDos / onNodeDosCleared listeners.

let dosState = 0;
let dosMessage = null;
let unreachablePoints = 0;
let shortfallPoints = 0;

// Who may take this node out of service until it releases it. An owner is an
// IDENTITY, not a message: the reason is what an operator reads, and the owner
// is what a release is checked against. Adding a feature that DOSes the node
// means adding a value here, which is the point - an unknown owner is refused
// rather than accepted as a new one.
const StickyDosOwner = Object.freeze({
  RESIDENTIAL_DOS: 'residentialDos',
  APP_TAMPERING: 'appTampering',
  PEER_SET_STABILITY: 'peerSetStability',
  NODEJS_FLOOR: 'nodejsFloor',
  DOCKER_FLOOR: 'dockerFloor',
  MONGODB_FLOOR: 'mongodbFloor',
  CGROUP_FLOOR: 'cgroupFloor',
  INSIGHT_EXPLORER: 'insightExplorer',
  HOST_STALL: 'hostStall',
  IP_CHANGES: 'ipChanges',
  UPNP_ROUTER: 'upnpRouter',
});

// owner -> reason, rather than one slot. A single slot cannot express two
// owners: a second verdict either overwrites the first, stranding an owner that
// can no longer recognise - and so never release - its own DOS, or is dropped,
// and the node returns to service on the first owner's release for a condition
// that never lifted. The node is out of service while any owner holds it.
const stickyDosHolds = new Map();

// A hold is a verdict rather than a score: an owner holds the node out of
// service or it does not, and this is the value the enforcing readers test.
const STICKY_DOS_STATE = 100;
const DOS_LIMIT = 100;

const stickyHeldListeners = new Set();
const enteredListeners = new Set();
const clearedListeners = new Set();
let wasNodeDos = false;

/**
 * Calls each listener with `args`. A listener that throws is logged and the
 * rest are still called: a feature reacting to the node's state must not stop
 * the write that changed it, nor another feature's reaction.
 * @param {Set<Function>} listeners
 * @param {string} what Named in the log line.
 * @param {...*} args
 */
function notify(listeners, what, ...args) {
  [...listeners].forEach((listener) => {
    try {
      listener(...args);
    } catch (error) {
      log.error(`nodeDosState - ${what} listener failed: ${error.message}`);
    }
  });
}

/**
 * The DOS state a reader sees. A held node reports the sticky verdict; an
 * unheld one reports the score with the availability check's points.
 * @returns {number}
 */
function effectiveDosState() {
  if (stickyDosHolds.size) return STICKY_DOS_STATE;
  const availabilityPoints = unreachablePoints + shortfallPoints;
  return availabilityPoints ? dosState + availabilityPoints : dosState;
}

/**
 * @returns {boolean} Whether the node is out of service.
 */
function isNodeDos() {
  return effectiveDosState() >= DOS_LIMIT;
}

/**
 * @returns {string|null} Why the node is out of service, or null when no owner
 * holds it. Every reason, not an arbitrary one: naming one of two would send an
 * operator to lift a condition that would not return the node to service.
 */
function getStickyDosMessage() {
  if (!stickyDosHolds.size) return null;
  return [...stickyDosHolds.values()].join('; ');
}

/**
 * @returns {string|null} Every sticky reason while any owner holds the node,
 * the score's message otherwise.
 */
function getDosMessage() {
  return getStickyDosMessage() || dosMessage;
}

/**
 * @returns {string|null} The score's message, whatever the sticky holds say.
 */
function getRawDosMessage() {
  return dosMessage;
}

/**
 * @returns {{dosState: number, dosMessage: string|null}} What /flux/dosstate
 * and the node's eligibility report.
 */
function getDosData() {
  return { dosState: effectiveDosState(), dosMessage: getDosMessage() };
}

/**
 * Runs after every write: publishes the state a reader now sees, and tells the
 * listeners when the write took the node into DOS or out of it.
 */
function changed() {
  fluxEventBus.publish('dos:changed', getDosData());
  const nowNodeDos = isNodeDos();
  if (nowNodeDos === wasNodeDos) return;
  wasNodeDos = nowNodeDos;
  if (nowNodeDos) notify(enteredListeners, 'entered', getDosMessage());
  else notify(clearedListeners, 'cleared');
}

/**
 * Calls `listener` with the reason each time the node enters DOS. Not called
 * again while it stays there; called again once it has left and re-enters.
 * @param {function(string|null): void} listener
 * @returns {function(): void} Stops the calls.
 */
function onNodeDos(listener) {
  enteredListeners.add(listener);
  return () => { enteredListeners.delete(listener); };
}

/**
 * Calls `listener` each time the node leaves DOS.
 * @param {function(): void} listener
 * @returns {function(): void} Stops the calls.
 */
function onNodeDosCleared(listener) {
  clearedListeners.add(listener);
  return () => { clearedListeners.delete(listener); };
}

/**
 * @returns {number} The shared score, without the availability points or the
 * sticky holds.
 */
function getDosStateValue() {
  return dosState;
}

/**
 * @param {number} value The shared score.
 */
function setDosStateValue(value) {
  dosState = value;
  changed();
}

/**
 * @param {number} delta Added to the shared score.
 */
function addDosState(delta) {
  dosState += delta;
  changed();
}

/**
 * @param {string|null} message The score's message.
 */
function setDosMessage(message) {
  dosMessage = message;
  changed();
}

/**
 * Sets the shared score and its message as one write, so a listener sees both.
 * @param {number} value
 * @param {string|null} message
 */
function setDos(value, message) {
  dosState = value;
  dosMessage = message;
  changed();
}

/**
 * @param {number} points Added to what the availability check counts against
 * reaching this node.
 */
function addUnreachablePoints(points) {
  unreachablePoints += points;
  changed();
}

/**
 * @param {number} points Added to what the availability check counts for too
 * few peer connections.
 */
function addShortfallPoints(points) {
  shortfallPoints += points;
  changed();
}

/**
 * @returns {number} What the availability check counts for too few peer
 * connections.
 */
function getShortfallPoints() {
  return shortfallPoints;
}

/** Ends what the availability check counts against reaching this node. */
function clearUnreachablePoints() {
  unreachablePoints = 0;
  changed();
}

/** Ends what the availability check counts for too few peer connections. */
function clearShortfallPoints() {
  shortfallPoints = 0;
  changed();
}

/**
 * Take this node out of service for as long as one owner says so. Idempotent
 * per owner.
 * @param {string} owner A StickyDosOwner value. An unknown one throws: it is a
 * caller that was never given an identity, and accepting it would create a DOS
 * nothing can ever release.
 * @param {string} reason What an operator reads, and what is reported.
 */
function setStickyDos(owner, reason) {
  if (!Object.values(StickyDosOwner).includes(owner)) {
    throw new Error(`setStickyDos: unknown owner ${owner}`);
  }
  if (stickyDosHolds.get(owner) === reason) return;
  const newlyHeld = !stickyDosHolds.has(owner);
  stickyDosHolds.set(owner, reason);
  log.error(`Sticky DOS set by ${owner}: ${reason}`);
  changed();
  if (newlyHeld) notify(stickyHeldListeners, 'sticky held', owner, reason);
}

/**
 * Call `listener` each time an owner newly holds this node out of service, and
 * at once for every owner that already does.
 * @param {function(string, string): void} listener Called with the owner and
 *   its reason.
 * @returns {function(): void} Stops the calls.
 */
function onStickyDos(listener) {
  stickyHeldListeners.add(listener);
  [...stickyDosHolds].forEach(([owner, reason]) => listener(owner, reason));
  return () => { stickyHeldListeners.delete(listener); };
}

/**
 * Release one owner's verdict. Every other owner's stands, and the node stays
 * out of service until all of them have released - so a feature clearing its
 * own condition can never speak for one it knows nothing about.
 * @param {string} owner A StickyDosOwner value.
 */
function clearStickyDos(owner) {
  const reason = stickyDosHolds.get(owner);
  if (reason === undefined) return;
  stickyDosHolds.delete(owner);
  log.info(`Sticky DOS cleared by ${owner} (was: ${reason})`);
  changed();
}

/**
 * @param {string} owner A StickyDosOwner value.
 * @returns {boolean} True while that owner holds this node out of service.
 */
function isStickyDosHeldBy(owner) {
  return stickyDosHolds.has(owner);
}

module.exports = {
  StickyDosOwner,
  addDosState,
  addShortfallPoints,
  addUnreachablePoints,
  clearShortfallPoints,
  clearStickyDos,
  clearUnreachablePoints,
  effectiveDosState,
  getDosData,
  getDosMessage,
  getDosStateValue,
  getRawDosMessage,
  getShortfallPoints,
  getStickyDosMessage,
  isNodeDos,
  isStickyDosHeldBy,
  onNodeDos,
  onNodeDosCleared,
  onStickyDos,
  setDos,
  setDosMessage,
  setDosStateValue,
  setStickyDos,
};
