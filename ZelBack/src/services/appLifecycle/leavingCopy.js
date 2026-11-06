const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const fluxEventBus = require('../utils/fluxEventBus');
const syncthingService = require('../syncthingService');
const appReconciler = require('../appMonitoring/appReconciler');

// A copy of an r: or s: component leaving this node, in one attempt on one give-up
// pass: stop it, scan once, wait for a peer to hold what the scan found.
//
// A copy that is running can write after any check, and syncthing's index does not
// show what was written last: the watcher batches changes for ten seconds, and the
// save an application makes on SIGTERM lands during the stop. So nothing short of a
// stopped container and a finished scan shows what a removal would delete.
//
// The copy is stopped only on a pass that may remove it, and for no longer than
// WAIT_MS: it stays listed while it is stopped, so the spawner replaces nothing.
//
// The marks are in memory on purpose. A FluxOS restart forgets an attempt, and the
// monitor starts the copy again.

const WAIT_MS = config.syncthing.leavingCopyWaitMs ?? 5 * 60 * 1000;
const POLL_MS = config.syncthing.leavingCopyPollMs ?? 2 * 1000;

const AttemptCode = Object.freeze({
  PROVEN: 'PROVEN',
  NOT_STOPPED: 'COPY_NOT_STOPPED',
  SCAN_FAILED: 'COPY_SCAN_FAILED',
  NOT_HELD: 'COPY_NOT_HELD',
  RESTARTED: 'COPY_RESTARTED',
});

// folder ids under an attempt
const leaving = new Set();
// folder id -> identifier of a component the attempt stopped
const stoppedHere = new Map();

/**
 * Whether a copy is under an attempt, so nothing may start it. Read after the last
 * await before a start: the mark goes up before the stop.
 * @param {string} folderId
 * @returns {boolean}
 */
function isLeaving(folderId) {
  return leaving.has(folderId);
}

function refused(code, reason) {
  return { proven: false, code, reason };
}

/**
 * Stops these components, scans their folders and waits for each to be held elsewhere.
 * The marks stay up whatever this answers: the caller ends the attempt with
 * giveBack or removed.
 * @param {Array<{identifier: string, folderId: string}>} components
 * @param {(component: object) => Promise<boolean>} isHeldElsewhere The removal's own
 *   proof for one component.
 * @returns {Promise<{proven: boolean, code: string, reason: string}>}
 */
async function stopAndProve(components, isHeldElsewhere) {
  const deadline = Date.now() + WAIT_MS;
  components.forEach(({ folderId }) => leaving.add(folderId));

  // docker's record of the last stop: a start after the scan moves it, and the scan
  // then says nothing about what that run wrote.
  const lastStop = new Map();
  // eslint-disable-next-line no-restricted-syntax
  for (const { identifier, folderId } of components) {
    // eslint-disable-next-line no-await-in-loop
    const before = await appReconciler.dockerActual(identifier);
    if (before.running) {
      stoppedHere.set(folderId, identifier);
      // eslint-disable-next-line no-await-in-loop
      await appReconciler.setControllerDesiredAndWait(identifier, 'stopped', 'stopping a copy to hand it back');
    }
    // eslint-disable-next-line no-await-in-loop
    const actual = await appReconciler.dockerActual(identifier);
    if (!actual.reachable || actual.indeterminate || actual.running) {
      return refused(AttemptCode.NOT_STOPPED, `${identifier} is not confirmed stopped`);
    }
    lastStop.set(identifier, actual.finishedAt);
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const { folderId } of components) {
    // eslint-disable-next-line no-await-in-loop
    await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.LEAVING_COPY_BEFORE_SCAN, folderId);
    try {
      // eslint-disable-next-line no-await-in-loop
      await syncthingService.scanFolder(folderId, { timeoutMs: Math.max(1, deadline - Date.now()) });
    } catch (error) {
      return refused(AttemptCode.SCAN_FAILED, `the scan of ${folderId} did not finish: ${error.message}`);
    }
  }

  let pending = components;
  while (pending.length) {
    // eslint-disable-next-line no-await-in-loop
    const held = await Promise.all(pending.map((component) => isHeldElsewhere(component)));
    pending = pending.filter((_component, index) => !held[index]);
    if (!pending.length) break;
    if (Date.now() >= deadline) {
      return refused(AttemptCode.NOT_HELD, `no peer held ${pending.map(({ folderId }) => folderId).join(', ')} within ${WAIT_MS} ms`);
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(POLL_MS);
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const { identifier } of components) {
    // eslint-disable-next-line no-await-in-loop
    const actual = await appReconciler.dockerActual(identifier);
    if (!actual.reachable || actual.indeterminate || actual.running || actual.finishedAt !== lastStop.get(identifier)) {
      return refused(AttemptCode.RESTARTED, `${identifier} ran again after its scan`);
    }
  }
  return { proven: true, code: AttemptCode.PROVEN, reason: 'stopped, scanned and held elsewhere' };
}

function clear(components) {
  components.forEach(({ folderId }) => {
    leaving.delete(folderId);
    stoppedHere.delete(folderId);
  });
}

/**
 * Ends an attempt that removed nothing: the copy serves again.
 * @param {Array<{identifier: string, folderId: string}>} components
 * @returns {void}
 */
function giveBack(components) {
  const restart = components
    .map(({ folderId }) => stoppedHere.get(folderId))
    .filter(Boolean);
  clear(components);
  restart.forEach((identifier) => {
    log.warn(`${identifier} was stopped to be handed back and was not; starting it again`);
    appReconciler.setControllerDesired(identifier, 'running', 'the copy stays');
  });
}

/**
 * Ends an attempt whose copy was removed.
 * @param {Array<{identifier: string, folderId: string}>} components
 * @returns {void}
 */
function removed(components) {
  clear(components);
}

module.exports = {
  AttemptCode,
  WAIT_MS,
  giveBack,
  isLeaving,
  removed,
  stopAndProve,
};
