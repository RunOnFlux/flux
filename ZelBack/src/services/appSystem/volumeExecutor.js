const config = require('config');
const path = require('node:path');
const dockerService = require('../dockerService');
const deviceHelper = require('../deviceHelper');
const serviceHelper = require('../serviceHelper');
const log = require('../../lib/log');
const { AsyncLock } = require('../utils/asyncLock');
const { appsFolder } = require('../utils/appConstants');
const {
  VolumePath, VolumeSession, WORK_ROOT, STAGING_PREFIX,
} = require('./volumeSession');

const settings = () => config.fluxapps.volumeOperations;

/** Prefix of the directory an interrupted publish leaves the previous data under. */
const SWAP_PREFIX = '.flux-old-';

/**
 * Labels every executor container carries.
 *
 * `role` is what keeps these out of the app sweeps: forceAppRemovals derives an
 * app name from a container name and hands it to removeAppLocally, so a
 * container it does not recognise produces a plausible-looking wrong name. The
 * label answers the question directly instead.
 */
const EXECUTOR_LABELS = { 'runonflux.role': 'fileop' };

// One slot per concurrent operation. Refusing rather than queueing is
// deliberate: a queued request holds its connection open behind someone else's
// long copy until an intermediate proxy kills it, which reads to the user as a
// failure with no explanation.
const nodeLock = new AsyncLock(Number.MAX_SAFE_INTEGER);
const appLocks = new Map();

function lockForApp(identifier) {
  if (!appLocks.has(identifier)) appLocks.set(identifier, new AsyncLock(Number.MAX_SAFE_INTEGER));
  return appLocks.get(identifier);
}

/**
 * Take a slot for this app, or throw.
 *
 * The read of activeCount and the register() that follows are not separated by
 * an await, so nothing can interleave between them. It reads like a
 * check-then-act race and is not one - do not "fix" it by adding a lock.
 *
 * @param {string} identifier
 * @returns {function(): void} release
 */
function acquireSlot(identifier) {
  const { maxConcurrentPerApp, maxConcurrentPerNode } = settings();
  const appLock = lockForApp(identifier);

  if (appLock.activeCount >= maxConcurrentPerApp) {
    throw new Error(`Another file operation is already running for ${identifier}`);
  }
  if (nodeLock.activeCount >= maxConcurrentPerNode) {
    throw new Error('This node is running its maximum number of file operations; try again shortly');
  }

  appLock.register();
  nodeLock.register();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    appLock.disable();
    nodeLock.disable();
    if (!appLock.activeCount) appLocks.delete(identifier);
  };
}

/**
 * Confirm the session's mount is a filesystem the kernel currently reports.
 *
 * FluxOS holds the docker socket, so whatever decides a bind source decides
 * host access - a wrong path here is not a containment bug, it is a host
 * compromise. The mount was already SELECTED from the mount table when the
 * session was opened; this re-reads it immediately before the bind so a volume
 * unmounted in between cannot be bound as a plain host directory, which is what
 * would happen if the mountpoint were bound while empty.
 *
 * @param {VolumeSession} session
 */
async function assertMountIsLive(session) {
  if (!session.mount.startsWith(appsFolder)) {
    throw new Error('Application volume is not under the apps folder');
  }
  const mounts = await deviceHelper.listMountedFilesystems();
  if (!mounts.some((mount) => mount.target === session.mount)) {
    throw new Error('Application volume is no longer mounted');
  }
}

/**
 * The container an operation runs in.
 *
 * Containment comes from the container having nowhere to escape TO, rather than
 * from a sequence of path checks being correct:
 *
 *   the app's volume and nothing else   a path that escapes it lands nowhere
 *   ReadonlyRootfs                      writes outside the volume fail
 *   NetworkMode none                    a hostile archive cannot phone home
 *   no-new-privileges                   a setuid file cannot escalate
 *   CapDrop ALL + three                 see below
 *   pids and memory limits              bound a runaway archive
 *   AutoRemove                          no stopped container for a prune to find
 *
 * Three capabilities are added back out of docker's default fourteen. cp -a
 * cannot restore ownership without CAP_CHOWN and does not fail when it can't -
 * it exits 0 having written root-owned files, and an app running as a non-root
 * user then silently loses access to its own data. FOWNER and DAC_OVERRIDE are
 * needed to read and re-stamp files the container does not own. Everything else
 * stays dropped, including MKNOD, so an archive cannot create device nodes.
 */
function containerOptions(session, argv) {
  const {
    image, memoryBytes, pidsLimit,
  } = settings();

  return {
    Image: image,
    Cmd: argv,
    WorkingDir: WORK_ROOT,
    Labels: { ...EXECUTOR_LABELS, 'runonflux.app': session.identifier },
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      Binds: [`${session.mount}:${WORK_ROOT}`],
      ReadonlyRootfs: true,
      NetworkMode: 'none',
      AutoRemove: true,
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'],
      SecurityOpt: ['no-new-privileges'],
      Memory: memoryBytes,
      PidsLimit: pidsLimit,
      // Docker's default seccomp and apparmor profiles apply because nothing
      // here disables them. Never pass seccomp=unconfined - it is the change
      // that gets made to "fix" a mystery permissions error and it removes the
      // syscall filter for every operation.
    },
  };
}

/**
 * Write one newline-delimited JSON chunk to a streaming response.
 *
 * The convention elsewhere in FluxOS concatenates bare JSON.stringify output
 * with no separator, so clients have to brace-count. A newline costs one byte
 * and makes the stream splittable.
 *
 * flush matters: without it compression middleware buffers the chunks and the
 * client sees nothing until the end, which defeats the point - writing bytes is
 * what stops an intermediate proxy killing a long operation.
 */
function writeChunk(res, chunk) {
  if (!res) return;
  try {
    res.write(`${serviceHelper.ensureString(chunk)}\n`);
    if (res.flush) res.flush();
  } catch (error) {
    log.warn(`volumeExecutor - could not write progress: ${error.message}`);
  }
}

/**
 * Run one file operation on an app's volume.
 *
 * @param {VolumeSession} session
 * @param {Array<string|VolumePath>} argv - operands must be VolumePath; a
 *   string operand is refused, which is what makes the session's checks
 *   unskippable rather than merely conventional
 * @param {{res?: object, req?: object, status?: string}} [options]
 * @returns {Promise<void>} resolves when the operation succeeded
 */
async function run(session, argv, options = {}) {
  const { res = null, req = null, status = 'Working...' } = options;

  if (!(session instanceof VolumeSession)) {
    throw new Error('run requires a VolumeSession');
  }

  const params = argv.map((arg) => {
    if (arg instanceof VolumePath) return arg.containerPath;
    if (typeof arg !== 'string') throw new Error('Command arguments must be strings or VolumePath');
    // A string that looks like a host path never belongs in argv: operands are
    // expressed relative to the container's view of the volume, and a caller
    // passing an absolute path has bypassed the session.
    if (path.isAbsolute(arg) && !arg.startsWith(`${WORK_ROOT}/`) && arg !== WORK_ROOT) {
      throw new Error(`Refusing an absolute path operand outside ${WORK_ROOT}: ${arg}`);
    }
    return arg;
  });

  const release = acquireSlot(session.identifier);
  let container = null;
  let ticker = null;
  let onClose = null;

  try {
    await assertMountIsLive(session);

    container = await dockerService.createContainer(containerOptions(session, params));

    // Opened BEFORE start, and on next-exit rather than the default. The
    // default condition is "not-running", which a created container already
    // satisfies - so a naive wait-before-start returns 0 immediately. Asking
    // after start instead would race: a fast command can finish and be reaped
    // by AutoRemove before the request arrives, and the exit status is then
    // unknowable.
    const exited = container.wait({ condition: 'next-exit' });

    if (req && typeof req.on === 'function') {
      onClose = () => {
        log.info(`volumeExecutor - client disconnected, stopping ${session.identifier} operation`);
        container.kill().catch(() => {});
      };
      req.on('close', onClose);
    }

    await container.start();

    if (res) {
      writeChunk(res, { status });
      ticker = setInterval(() => writeChunk(res, { status }), settings().progressIntervalMs);
    }

    const result = await exited;
    if (result.StatusCode !== 0) {
      throw new Error(`File operation failed with exit code ${result.StatusCode}`);
    }
  } finally {
    if (ticker) clearInterval(ticker);
    if (onClose && req && typeof req.removeListener === 'function') req.removeListener('close', onClose);
    release();
  }
}

/**
 * Remove executor containers left running by a FluxOS restart.
 *
 * A container is detached from the process that started it, so a restart leaves
 * one running with nobody waiting for its result. Its staging directory is
 * reclaimed separately by sweepStagingDirectories; nothing it wrote is visible
 * at a destination path, because publishing is the last thing flux-op does.
 *
 * Selection is by LABEL. This is the ownership-scoped removal that replaced the
 * blanket container prune: it removes what FluxOS knows it started, rather than
 * everything docker currently considers unused.
 *
 * @returns {Promise<number>} how many were removed
 */
async function reapOrphanedContainers() {
  let containers;
  try {
    containers = await dockerService.dockerListContainers(true);
  } catch (error) {
    log.error(`volumeExecutor - could not list containers to reap: ${error.message}`);
    return 0;
  }

  const orphans = (containers || []).filter(
    (container) => container.Labels && container.Labels['runonflux.role'] === 'fileop',
  );

  let removed = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const orphan of orphans) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await dockerService.appDockerForceRemove(orphan.Id, false);
      removed += 1;
    } catch (error) {
      log.warn(`volumeExecutor - could not remove orphaned container ${orphan.Id}: ${error.message}`);
    }
  }
  if (removed) log.info(`volumeExecutor - reaped ${removed} orphaned file-operation container(s)`);
  return removed;
}

/**
 * Reclaim - and where necessary restore - what an interrupted operation left on
 * a volume.
 *
 * flux-op leaves exactly three kinds of entry, and the rules follow from what
 * each one means:
 *
 *   .flux-op-<id>                     the work never completed. Nothing was
 *                                     published, nobody is waiting for it -
 *                                     delete.
 *
 *   .flux-old-<id> + .dest marker,    a crash landed between the two renames of
 *   destination MISSING               a publish. This is the caller's previous
 *                                     data and its own path is empty - rename
 *                                     it back. Deleting here would destroy the
 *                                     only copy.
 *
 *   .flux-old-<id> + .dest marker,    the publish completed and only the
 *   destination PRESENT               cleanup was interrupted - delete.
 *
 * Restoring is possible only because flux-op writes the marker BEFORE moving
 * the old entry aside; the name alone says nothing about where the data came
 * from.
 *
 * A .flux-old-<id> with no marker cannot be placed, and can only arise from a
 * crash between writing the marker and the rename that uses it - in which case
 * the destination was never touched and the entry is a duplicate. Deleted.
 *
 * NOTE: this reads and writes the volume from the FluxOS process. When FluxOS
 * is demoted to an unprivileged system user it moves into a container, like
 * everything else here that touches app data.
 *
 * @param {string} mount
 * @param {object} fsPromises - injected so the rules can be tested without a disk
 * @returns {Promise<{removed: string[], restored: string[]}>}
 */
async function sweepStagingDirectories(mount, fsPromises) {
  const entries = await fsPromises.readdir(mount).catch((error) => {
    log.warn(`volumeExecutor - could not read ${mount} to sweep: ${error.message}`);
    return null;
  });
  if (!entries) return { removed: [], restored: [] };

  const removed = [];
  const restored = [];

  const remove = async (name) => {
    const result = await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-rf', path.join(mount, name)] });
    if (result.error) throw result.error;
    removed.push(name);
  };

  // eslint-disable-next-line no-restricted-syntax
  for (const entry of entries) {
    try {
      if (entry.startsWith(STAGING_PREFIX)) {
        // eslint-disable-next-line no-await-in-loop
        await remove(entry);
      } else if (entry.startsWith(SWAP_PREFIX) && !entry.endsWith('.dest')) {
        const marker = `${entry}.dest`;
        // eslint-disable-next-line no-await-in-loop
        const destination = await fsPromises.readFile(path.join(mount, marker), 'utf8')
          .then((contents) => contents.trim())
          .catch(() => null);

        // eslint-disable-next-line no-await-in-loop
        const destinationExists = destination
          // eslint-disable-next-line no-await-in-loop
          ? await fsPromises.lstat(destination).then(() => true).catch(() => false)
          : true;

        if (destination && !destinationExists) {
          // eslint-disable-next-line no-await-in-loop
          const result = await serviceHelper.runCommand('mv', {
            runAsRoot: true, params: ['-T', path.join(mount, entry), destination],
          });
          if (result.error) throw result.error;
          restored.push(destination);
          // eslint-disable-next-line no-await-in-loop
          await remove(marker);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await remove(entry);
          // eslint-disable-next-line no-await-in-loop
          if (destination) await remove(marker);
        }
      }
    } catch (error) {
      log.warn(`volumeExecutor - could not sweep ${entry} in ${mount}: ${error.message}`);
    }
  }

  if (restored.length) {
    log.info(`volumeExecutor - restored ${restored.length} destination(s) interrupted mid-publish in ${mount}`);
  }
  if (removed.length) {
    log.info(`volumeExecutor - swept ${removed.length} interrupted operation artefact(s) from ${mount}`);
  }
  return { removed, restored };
}

module.exports = {
  run,
  reapOrphanedContainers,
  sweepStagingDirectories,
  acquireSlot,
  EXECUTOR_LABELS,
  SWAP_PREFIX,
};
