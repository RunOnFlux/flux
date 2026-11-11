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
// The reconciler holds each copy stopped from before the stop until the caller ends
// the attempt (holdLeavingCopy). The hold is in memory on purpose: a FluxOS restart
// forgets an attempt, and the copy runs again.

const WAIT_MS = config.syncthing.leavingCopyWaitMs ?? 5 * 60 * 1000;
const POLL_MS = config.syncthing.leavingCopyPollMs ?? 2 * 1000;

const AttemptCode = Object.freeze({
  PROVEN: 'PROVEN',
  NOT_STOPPED: 'COPY_NOT_STOPPED',
  SCAN_FAILED: 'COPY_SCAN_FAILED',
  NOT_HELD: 'COPY_NOT_HELD',
  RESTARTED: 'COPY_RESTARTED',
});

function refused(code, reason) {
  return { proven: false, code, reason };
}

/**
 * Stops these components, scans their folders and waits for each to be held elsewhere.
 * The holds stay up whatever this answers: the caller ends the attempt with
 * giveBack or removed.
 * @param {Array<{identifier: string, folderId: string}>} components
 * @param {(component: object) => Promise<boolean>} isHeldElsewhere The removal's own
 *   proof for one component.
 * @returns {Promise<{proven: boolean, code: string, reason: string}>}
 */
async function stopAndProve(components, isHeldElsewhere) {
  const deadline = Date.now() + WAIT_MS;

  // docker's record of the last stop: a start after the scan moves it, and the scan
  // then says nothing about what that run wrote.
  const lastStop = new Map();
  // eslint-disable-next-line no-restricted-syntax
  for (const { identifier } of components) {
    // eslint-disable-next-line no-await-in-loop
    await appReconciler.holdLeavingCopy(identifier);
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

/**
 * Ends an attempt that removed nothing: the holds go, and the copy runs as it would
 * have without the attempt.
 * @param {Array<{identifier: string, folderId: string}>} components
 * @returns {void}
 */
function giveBack(components) {
  components.forEach(({ identifier }) => {
    log.warn(`${identifier} was held to be handed back and was not; releasing it`);
    appReconciler.releaseLeavingCopy(identifier);
  });
}

/**
 * Ends an attempt whose copy was removed.
 * @param {Array<{identifier: string, folderId: string}>} components
 * @returns {void}
 */
function removed(components) {
  components.forEach(({ identifier }) => appReconciler.releaseLeavingCopy(identifier));
}

module.exports = {
  AttemptCode,
  WAIT_MS,
  giveBack,
  removed,
  stopAndProve,
};
