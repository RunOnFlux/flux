/**
 * While FluxOS's own version is on trial, no app is installed or removed, so restoring its data
 * never leaves a container, volume or mount the restored data does not know, nor data for one
 * that is gone. Running apps keep running, and starts, stops and restarts go on.
 *
 * The updater creates TRIAL_FILE before it stops FluxOS for the snapshot and removes it when the
 * trial ends. FluxOS reads the file, so a restart of the updater leaves the freeze in place, and
 * /run is emptied by a reboot, after which the boot reconcile decides the trial.
 */

const fs = require('node:fs');
const path = require('node:path');

const log = require('../../lib/log');
const { socketPath } = require('./apiSocket');

const TRIAL_FILE = '/run/flux-update/fluxos-trial';

/**
 * Resolves once no FluxOS trial is open. Off the socket there is none.
 * @param {{file?: string}} [options]
 * @returns {Promise<void>}
 */
async function settled({ file = TRIAL_FILE } = {}) {
  if (!socketPath() || !fs.existsSync(file)) return;
  log.info('An app install or removal waits for the end of the FluxOS trial');
  await new Promise((resolve) => {
    const watcher = fs.watch(path.dirname(file), () => {
      if (fs.existsSync(file)) return;
      watcher.close();
      resolve();
    });
    if (!fs.existsSync(file)) {
      watcher.close();
      resolve();
    }
  });
}

module.exports = { settled };
