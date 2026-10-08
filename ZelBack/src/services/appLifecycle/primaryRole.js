const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');
const appReconciler = require('../appMonitoring/appReconciler');
const syncthingFolderWrites = require('../appMonitoring/syncthingFolderWrites');
const changes = require('./primaryRoleChanges');
const globalState = require('../utils/globalState');
const { PeerComponent } = require('../appMonitoring/peerComponent');

// A single-writer (g:) component's primary role on this node, and the only writer
// of its syncthing folder's type.
//
// Whether this node IS the primary is the reconciler's desired state 'running';
// this holds only a change of role in progress, and orders the two things a change
// is made of - the folder, which syncthing owns, and the container, which the
// reconciler owns. Becoming primary, the folder sends before the container is
// asked to run. Standing down, the container stops before the folder stops
// sending, and the folder is not scanned: what syncthing had not yet scanned is
// discarded.
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
//   another node elected                      | receiveonly, no scan, last | stopped      | standDown
//   primary runs here, folder receives        | sendreceive                | -            | holdAsPrimary
//   not primary here, folder sends            | receiveonly, scanned       | -            | holdAsStandby
//   not primary here, folder sends, paused    | by who runs it elsewhere   | -            | holdAsStandby
//   unsafe mount / restore left partial data  | receiveonly, first, no scan| stopped      | demoteForSafety
//
// "Scanned" means syncthing confirmed the scan finished; a folder whose scan
// does not finish keeps sending, and the next election pass tries again.
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
  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.MASTERSLAVE_BEFORE_RUN, identifier);
  // A stand-down given while this waited for the reconciler's slot is read in
  // it, so the container is never asked to run.
  if (!(await appReconciler.setRunningUnlessOperatorStopped(identifier, 'masterSlave primary', { unless: () => change.standDown }))) {
    if (change.standDown) {
      await syncthingFolderWrites.changeSyncthingFolderType(appId, 'receiveonly');
      return { to: Role.STANDBY, reason: 'stood down before it ran' };
    }
    // An operator stop given while the folder was turning keeps the component
    // down: it stays held by the lock, its folder sending, until the election
    // decides an operator start.
    return { to: Role.STANDBY, reason: 'its operator stopped it' };
  }
  return Role.PRIMARY;
}

// A stand-down ends an error: FDM names another node that has decided it holds
// the component while this one runs it, so both have been writing it, or are
// about to - a network split, or two nodes starting it at once. The elected
// node's copy is kept. This node's folder receives as soon as its container has
// stopped, unscanned, so what syncthing had not yet scanned is discarded rather
// than sent over the elected copy, and from then on one folder sends. A change it had already
// scanned is in its index, which receiving does not withdraw: it reaches the
// elected copy when the two reconnect.
async function stopThenReceive(identifier, appId) {
  await appReconciler.setControllerDesiredAndWait(identifier, 'stopped', 'masterSlave standby');
  // Docker unreachable and a state it cannot read both answer running: false, and
  // neither is a stopped container.
  const actual = await appReconciler.dockerActual(identifier);
  if (!actual.reachable || actual.indeterminate || actual.running) {
    log.warn(`primaryRole - ${identifier} is not confirmed stopped; its folder keeps sending until it is`);
    return { to: Role.PRIMARY, reason: 'the container is not confirmed stopped' };
  }
  if (!(await syncthingFolderWrites.changeSyncthingFolderType(appId, 'receiveonly'))) {
    return { to: Role.STANDBY, reason: 'the folder still sends: it was not changed' };
  }
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
  const change = begin(identifier, appId, Role.PROMOTING, Role.STANDBY, (promoting) => sendThenRun(identifier, appId, promoting));
  // A stand-down given once the container was asked to run is carried out the
  // moment the promotion ends, so one given at any point of it is honoured.
  change.done.then(() => {
    if (change.standDown && isPrimary(identifier)) standDown(identifier, appId, { running: true });
  });
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
 * Whether a backup or restore holds the app a component belongs to. Its folder
 * is paused for the operation, which alone may unpause it.
 * @param {string} identifier `<component>_<app>`, or the app name alone
 * @returns {boolean}
 */
function heldByOperation(identifier) {
  const appName = identifier.slice(identifier.lastIndexOf('_') + 1);
  return globalState.backupInProgress.includes(appName) || globalState.restoreInProgress.includes(appName);
}

/**
 * Keeps the folder of a component this node is not the primary of receiving.
 * A folder found sending is scanned first, so what was written here goes out
 * as this node's own version and the next primary pulls it.
 *
 * A folder found sending and paused is a primary returning from a stop, whose
 * syncthing came back paused: nothing written here since has gone out. It comes
 * back paused after a planned shutdown, which pauses every folder, and wherever
 * syncthing starts with `--paused`: FluxOS starts it so on a legacy node, and the
 * ArcaneOS unit from the release that passes it. An ArcaneOS syncthing started
 * without it after a crash sends before FluxOS runs, and what it sent is not
 * this decision's to discard. What the other holders are doing with the
 * component decides whether it may:
 *
 *   another holder runs it     | discarded: receives, unpaused, in one write,
 *                              | unscanned; the standby revert removes what
 *                              | syncthing had not yet scanned
 *   no other holder runs it    | kept: unpaused, and resumes as primary
 *   one cannot be ruled out,   | stays paused for a later pass
 *   or the caller cannot ask   |
 *
 * What syncthing scanned before the stop is in its index, which receiving does
 * not withdraw: it reaches the other holders once the folder is unpaused.
 *
 * A folder a backup or restore holds stays paused.
 * @param {string} identifier `<component>_<app>`
 * @param {string} appId Syncthing folder id
 * @param {object} [opts]
 * @param {() => Promise<string>} [opts.othersHold] The PeerComponent state of the
 *   other holders.
 * @returns {Promise<boolean>} False when a change of role is in progress or this
 *   node is the primary, so nothing was written, or when the folder stays paused
 *   or still sends.
 */
async function holdAsStandby(identifier, appId, { othersHold } = {}) {
  if (changes.get(identifier) || isPrimary(identifier)) return false;
  const folder = await syncthingFolderWrites.folderConfig(appId);
  if (folder?.paused && folder.type === 'sendreceive') {
    const others = othersHold ? await othersHold() : PeerComponent.UNKNOWN;
    if (others === PeerComponent.UNKNOWN || heldByOperation(identifier)
      || changes.get(identifier) || isPrimary(identifier)) {
      fluxEventBus.count('primaryRole:returned', identifier, 'heldPaused');
      return false;
    }
    if (others === PeerComponent.RUNNING) {
      log.warn(`primaryRole - ${identifier} returned as primary while another holder runs it; its unscanned changes are discarded`);
      const discarded = await syncthingFolderWrites.changeSyncthingFolderType(appId, 'receiveonly', { unpause: true });
      if (discarded) fluxEventBus.publish('primaryRole:returned', { identifier, outcome: 'discarded' });
      return discarded;
    }
    // It is the component's writer, and no other holder has taken over: it goes
    // on as the primary. Its folder never stops sending, so a peer asking meanwhile
    // reads it holding the component.
    log.info(`primaryRole - ${identifier} returned as primary and no other holder runs it; it resumes as primary`);
    const unpaused = await syncthingFolderWrites.patchFolder(appId, { paused: false });
    if (unpaused?.status !== 'success') return false;
    fluxEventBus.publish('primaryRole:returned', { identifier, outcome: 'kept' });
    return promote(identifier, appId);
  }
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
