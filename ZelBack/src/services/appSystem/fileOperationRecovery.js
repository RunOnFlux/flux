const deviceHelper = require('../deviceHelper');
const log = require('../../lib/log');
const { appsFolder } = require('../utils/appConstants');
const executor = require('./volumeExecutor');
const { sessionForMountedVolume } = require('./volumeSession');

/**
 * Reclaim what a FluxOS restart left behind from in-flight file operations.
 *
 * An operation's container is detached from the process that started it, so a
 * restart leaves it running with nobody waiting for its exit code, and its
 * staging directory sitting on the volume. Neither is visible at a destination
 * path: a publish is one atomic exchange, so a destination always holds
 * something complete and nothing the user can see is left inconsistent. This is
 * about not accumulating debris.
 *
 * Runs at startup, after app volumes are mounted - but the API is already
 * answering by then, so an operation of THIS process can be in flight when it
 * runs. It removes only what no live operation owns: the executor records each
 * running operation's container and staging directory, and reap and sweep skip
 * those, so anything they reclaim belonged to a PREVIOUS process. Safe to run
 * more than once for the same reason, which matters because a startup that throws
 * is retried.
 *
 * @returns {Promise<{containers: number, removed: number}>}
 */
async function recoverInterruptedFileOperations() {
  const containers = await executor.reapOrphanedContainers();

  let mounts = [];
  try {
    mounts = await deviceHelper.listMountedFilesystems();
  } catch (error) {
    log.error(`fileOperationRecovery - could not read the mount table: ${error.message}`);
    return { containers, removed: 0 };
  }

  // Only mounted app volumes. A staging directory can only exist on one, and
  // reading an unmounted mountpoint would walk the bare host directory
  // underneath it instead.
  const volumes = mounts.filter((mount) => mount.target.startsWith(appsFolder));

  let removed = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const volume of volumes) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await executor.sweepStagingDirectories(sessionForMountedVolume(volume));
      removed += result.removed.length;
    } catch (error) {
      // One unreadable volume must not strand the debris on every other app.
      log.error(`fileOperationRecovery - could not sweep ${volume.target}: ${error.message}`);
    }
  }

  if (containers || removed) {
    log.info(`fileOperationRecovery - reaped ${containers} container(s), removed ${removed} artefact(s)`);
  }
  return { containers, removed };
}

module.exports = { recoverInterruptedFileOperations };
