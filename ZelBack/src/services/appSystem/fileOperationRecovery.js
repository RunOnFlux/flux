const fs = require('fs').promises;
const deviceHelper = require('../deviceHelper');
const log = require('../../lib/log');
const { appsFolder } = require('../utils/appConstants');
const executor = require('./volumeExecutor');

/**
 * Reclaim what a FluxOS restart left behind from in-flight file operations.
 *
 * An operation's container is detached from the process that started it, so a
 * restart leaves it running with nobody waiting for its exit code, and its
 * staging directory sitting on the volume. Neither is visible at a destination
 * path - publishing is the last thing flux-op does - so nothing the user can
 * see is inconsistent; this is about not accumulating debris, and about the one
 * case that IS user-visible: a publish interrupted between its two renames,
 * where the destination is empty and the previous data is parked under
 * .flux-old-*.
 *
 * Runs once at startup, after app volumes are mounted. There is no in-flight
 * operation to race at that point: the executor's slots live in memory and are
 * empty on a fresh process, and any container from the previous one is removed
 * here before anything else can start.
 *
 * @returns {Promise<{containers: number, removed: number, restored: number}>}
 */
async function recoverInterruptedFileOperations() {
  const containers = await executor.reapOrphanedContainers();

  let mounts = [];
  try {
    mounts = await deviceHelper.listMountedFilesystems();
  } catch (error) {
    log.error(`fileOperationRecovery - could not read the mount table: ${error.message}`);
    return { containers, removed: 0, restored: 0 };
  }

  // Only mounted app volumes. A staging directory can only exist on one, and
  // reading an unmounted mountpoint would walk the bare host directory
  // underneath it instead.
  const volumes = mounts.filter((mount) => mount.target.startsWith(appsFolder));

  let removed = 0;
  let restored = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const volume of volumes) {
    // eslint-disable-next-line no-await-in-loop
    const result = await executor.sweepStagingDirectories(volume.target, fs);
    removed += result.removed.length;
    restored += result.restored.length;
  }

  if (containers || removed || restored) {
    log.info(`fileOperationRecovery - reaped ${containers} container(s), removed ${removed} artefact(s), restored ${restored} destination(s)`);
  }
  return { containers, removed, restored };
}

module.exports = { recoverInterruptedFileOperations };
