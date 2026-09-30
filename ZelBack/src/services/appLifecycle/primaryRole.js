const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');
const appReconciler = require('../appMonitoring/appReconciler');
const syncthingFolderWrites = require('../appMonitoring/syncthingFolderWrites');
const changes = require('./primaryRoleChanges');

// A single-writer (g:) component's primary role on this node, and the only writer
// of its syncthing folder's type.
//
// Whether this node IS the primary is the reconciler's desired state 'running';
// this holds only a change of role in progress, and orders the two things a change
// is made of - the folder, which syncthing owns, and the container, which the
// reconciler owns. Becoming primary, the folder sends before the container is
// asked to run. Standing down, the container stops before the folder stops
// sending, and the folder is scanned first so what the primary wrote goes out as
// its own version.
//
// One change per component at a time. A request to become primary while one is in
// progress, or while this node already is, is refused, so an election pass that
// runs again before the last one's promotion has finished decides nothing new.
//
// The type of a g: folder, by situation. Nothing else sets it: the syncthing
// monitor creates the folder with CREATED_FOLDER_TYPE and never sends a type for
// it again. An r: or s: folder's type is the monitor's; only a safety demotion
// is common to every folder.
//
//   situation                                 | folder                     | container    | action
//   ------------------------------------------+----------------------------+--------------+----------------
//   folder created on this node               | receiveonly                | -            | (monitor)
//   elected primary                           | sendreceive, first         | then running | promote
//   another node elected                      | receiveonly, scanned, last | stopped      | standDown
//   primary runs here, folder receives        | sendreceive                | -            | holdAsPrimary
//   not primary here, folder sends            | receiveonly, scanned       | -            | holdAsStandby
//   unsafe mount / restore left partial data  | receiveonly, first, no scan| stopped      | demoteForSafety
//
// A change of role in progress holds the folder: holdAsPrimary and holdAsStandby
// do nothing during one, and demoteForSafety abandons a promotion before its
// folder sends.

const CREATED_FOLDER_TYPE = 'receiveonly';

const Role = Object.freeze({
  STANDBY: 'standby',
  PROMOTING: 'promoting',
  PRIMARY: 'primary',
  DEMOTING: 'demoting',
});

function isPrimary(identifier) {
  return appReconciler.committedIdentifiers().includes(identifier);
}

function announce(identifier, from, to, reason) {
  fluxEventBus.publish('primaryRole:changed', {
    identifier, from, to, ...(reason ? { reason } : {}),
  });
}

/**
 * The change of role in progress for a component, or null.
 * @param {string} identifier `<component>_<app>`
 * @returns {string|null} Role.PROMOTING, Role.DEMOTING or null
 */
function inTransition(identifier) {
  return changes.get(identifier)?.state ?? null;
}

/**
 * Resolves once the change of role in progress for a component has ended.
 * @param {string} identifier `<component>_<app>`
 * @returns {Promise<void>}
 */
function whenSettled(identifier) {
  return changes.get(identifier)?.done ?? Promise.resolve();
}

async function sendThenRun(identifier, appId, change) {
  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.MASTERSLAVE_BEFORE_START, identifier);
  if (change.standDown) return Role.STANDBY;
  const sending = await syncthingFolderWrites.changeSyncthingFolderType(appId, 'sendreceive', {
    settleMs: syncthingFolderWrites.FOLDER_TYPE_SETTLE_MS,
    abandonIf: () => change.standDown,
  });
  if (change.standDown) {
    await syncthingFolderWrites.changeSyncthingFolderType(appId, 'receiveonly');
    return { to: Role.STANDBY, reason: 'stood down before it ran' };
  }
  if (!sending) {
    log.error(`primaryRole - the folder of ${identifier} could not be made to send; not starting it`);
    return { to: Role.STANDBY, reason: 'the folder did not send' };
  }
  appReconciler.setControllerDesired(identifier, 'running', 'masterSlave primary');
  return Role.PRIMARY;
}

async function stopThenReceive(identifier, appId) {
  await appReconciler.setControllerDesiredAndWait(identifier, 'stopped', 'masterSlave standby');
  // Docker unreachable and a state it cannot read both answer running: false, and
  // neither is a stopped container.
  const actual = await appReconciler.dockerActual(identifier);
  if (!actual.reachable || actual.indeterminate || actual.running) {
    log.warn(`primaryRole - ${identifier} is not confirmed stopped; its folder keeps sending until it is`);
    return { to: Role.PRIMARY, reason: 'the container is not confirmed stopped' };
  }
  await syncthingFolderWrites.changeSyncthingFolderType(appId, 'receiveonly', { scanFirst: true });
  return Role.STANDBY;
}

function begin(identifier, appId, state, from, work) {
  const change = { state, appId, standDown: false };
  changes.set(identifier, change);
  announce(identifier, from, state);
  change.done = work(change)
    .then((outcome) => {
      const { to, reason } = typeof outcome === 'string' ? { to: outcome } : outcome;
      announce(identifier, state, to, reason);
    })
    .catch((error) => {
      log.error(`primaryRole - ${state} ${identifier} failed: ${error.message}`);
      announce(identifier, state, from, error.message);
    })
    .finally(() => changes.end(identifier, change));
  return change;
}

/**
 * Become the primary of a component: make its folder send, then ask the
 * reconciler to run it. Returns at once; the change runs in the background.
 * @param {string} identifier `<component>_<app>`
 * @param {string} appId Syncthing folder id
 * @returns {boolean} False when a change of role is in progress or this node is
 *   already the primary, so nothing was begun.
 */
function promote(identifier, appId) {
  if (changes.get(identifier) || isPrimary(identifier)) return false;
  fluxEventBus.publish('masterSlave:started', { identifier });
  fluxEventBus.count('masterSlave:decision', identifier, 'started');
  begin(identifier, appId, Role.PROMOTING, Role.STANDBY, (change) => sendThenRun(identifier, appId, change));
  return true;
}

/**
 * Stand down as the primary of a component: stop it, then make its folder
 * receive. A promotion in progress is abandoned before it asks for the container.
 * Returns at once; the change runs in the background.
 * @param {string} identifier `<component>_<app>`
 * @param {string} appId Syncthing folder id
 * @param {object} [opts]
 * @param {boolean} [opts.running] Whether the component's container runs here.
 * @returns {boolean} False when there is nothing to stand down from.
 */
function standDown(identifier, appId, { running = false } = {}) {
  const change = changes.get(identifier);
  if (change?.state === Role.PROMOTING) {
    change.standDown = true;
    return true;
  }
  if (change) return false;
  if (!running && !isPrimary(identifier)) return false;
  begin(identifier, appId, Role.DEMOTING, Role.PRIMARY, () => stopThenReceive(identifier, appId));
  return true;
}

/**
 * Keeps the folder of the primary running here sending.
 * @param {string} identifier `<component>_<app>`
 * @param {string} appId Syncthing folder id
 * @returns {Promise<boolean>} False when a change of role is in progress, so
 *   nothing was written.
 */
async function holdAsPrimary(identifier, appId) {
  if (changes.get(identifier)) return false;
  return syncthingFolderWrites.changeSyncthingFolderType(appId, 'sendreceive');
}

/**
 * Keeps the folder of a component this node is not the primary of receiving.
 * A folder found sending is scanned first, so what was written here goes out
 * as this node's own version and the next primary pulls it.
 * @param {string} identifier `<component>_<app>`
 * @param {string} appId Syncthing folder id
 * @returns {Promise<boolean>} False when a change of role is in progress or this
 *   node is the primary, so nothing was written.
 */
async function holdAsStandby(identifier, appId) {
  if (changes.get(identifier) || isPrimary(identifier)) return false;
  return syncthingFolderWrites.changeSyncthingFolderType(appId, 'receiveonly', { scanFirst: true });
}

/**
 * Stops a folder sending at once, unscanned: its data is not a copy the other
 * holders should be given. A promotion of its component in progress is
 * abandoned, and its folder does not send. Any folder, g: or r:; the caller
 * holds the container.
 * @param {string} appId Syncthing folder id
 * @returns {Promise<object>} syncthing's response - 404 for a folder it does not know
 */
function demoteForSafety(appId) {
  const promotion = changes.byFolder(appId);
  if (promotion?.state === Role.PROMOTING) promotion.standDown = true;
  return syncthingFolderWrites.patchFolder(appId, { type: 'receiveonly' });
}

module.exports = {
  CREATED_FOLDER_TYPE,
  Role,
  promote,
  standDown,
  holdAsPrimary,
  holdAsStandby,
  demoteForSafety,
  inTransition,
  whenSettled,
};
