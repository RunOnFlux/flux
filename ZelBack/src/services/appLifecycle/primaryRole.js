const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');
const syncthingService = require('../syncthingService');
const appReconciler = require('../appMonitoring/appReconciler');
const { changeSyncthingFolderType, FOLDER_TYPE_SETTLE_MS } = require('../appMonitoring/syncthingFolderType');
const changes = require('./primaryRoleChanges');

// A change of a single-writer (g:) component's primary role on this node.
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
  const sending = await changeSyncthingFolderType(appId, 'sendreceive', { settleMs: FOLDER_TYPE_SETTLE_MS });
  if (!sending) {
    log.error(`primaryRole - the folder of ${identifier} could not be made to send; not starting it`);
    return { to: Role.STANDBY, reason: 'the folder did not send' };
  }
  if (change.standDown) {
    await changeSyncthingFolderType(appId, 'receiveonly');
    return { to: Role.STANDBY, reason: 'stood down before it ran' };
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
  try {
    await syncthingService.scanFolder(appId);
  } catch (error) {
    log.warn(`primaryRole - scan of ${appId} before it stops sending failed: ${error.message}`);
  }
  await changeSyncthingFolderType(appId, 'receiveonly');
  return Role.STANDBY;
}

function begin(identifier, state, from, work) {
  const change = { state, standDown: false };
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
  begin(identifier, Role.PROMOTING, Role.STANDBY, (change) => sendThenRun(identifier, appId, change));
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
  begin(identifier, Role.DEMOTING, Role.PRIMARY, () => stopThenReceive(identifier, appId));
  return true;
}

module.exports = {
  Role,
  promote,
  standDown,
  inTransition,
  whenSettled,
};
