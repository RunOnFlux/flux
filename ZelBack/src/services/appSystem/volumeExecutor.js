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

/** Suffix of the file recording where a displaced entry belongs. */
const MARKER_SUFFIX = '.dest';

/**
 * The identifier flux-op derives both names from - the staging directory's, and
 * the swap directory's after it strips the staging prefix. A randomUUID, so the
 * shape is exact.
 *
 * Names are matched against this rather than by prefix alone because the sweep
 * DELETES what it matches, in a directory the app owner can write to. Nothing
 * reserves these prefixes at creation time, so a folder called
 * `.flux-op-backups` is a name a user can legitimately choose - and would lose
 * on the next restart if a prefix test were the whole rule.
 */
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isStagingName = (name) => name.startsWith(STAGING_PREFIX)
  && OPERATION_ID.test(name.slice(STAGING_PREFIX.length));

const isSwapName = (name) => name.startsWith(SWAP_PREFIX)
  && OPERATION_ID.test(name.slice(SWAP_PREFIX.length));

const isSwapMarkerName = (name) => name.endsWith(MARKER_SUFFIX)
  && isSwapName(name.slice(0, -MARKER_SUFFIX.length));

/**
 * The host path a marker records, or null when it does not name one inside this
 * volume.
 *
 * The marker is written by flux-op, from inside the container, so it holds a
 * path in the CONTAINER's namespace - `/work/<relative>`, the only form any
 * operand ever takes. Reading it as a host path is what turned a file the app
 * owner can write into an argument to a root `mv`: an absolute path in there
 * would be followed to wherever it pointed.
 *
 * Nothing about the contents is trusted. The recorded path must sit under
 * WORK_ROOT, and the host path derived from it must still sit under the mount
 * after normalisation - so neither an absolute path nor a `..` inside one can
 * name anything the operation was not entitled to touch.
 *
 * @param {string} mount
 * @param {string} contents - raw marker file contents
 * @returns {string|null} absolute host path, or null if it names nothing valid
 */
function resolveMarkerDestination(mount, contents) {
  if (typeof contents !== 'string') return null;
  const recorded = contents.trim();
  if (!recorded) return null;

  // posix.relative normalises first, so `/work/../etc/shadow` and `/etc/shadow`
  // both come back starting with '..' and are refused here rather than deeper.
  const relative = path.posix.relative(WORK_ROOT, recorded);
  if (!relative || relative.startsWith('..') || path.posix.isAbsolute(relative)) return null;

  const resolved = path.resolve(mount, relative);
  const within = path.relative(mount, resolved);
  if (!within || within.startsWith('..') || path.isAbsolute(within)) return null;
  return resolved;
}

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

  // Marked `busy` so the HTTP layer answers 503 with a Retry-After rather than
  // a generic failure: a caller turned away before any work started should
  // learn that immediately, not by registering an operation and polling to
  // discover it was refused.
  const busy = (message) => {
    const error = new Error(message);
    error.kind = 'busy';
    error.retryAfterMs = 5000;
    return error;
  };

  if (appLock.activeCount >= maxConcurrentPerApp) {
    throw busy(`Another file operation is already running for ${identifier}`);
  }
  if (nodeLock.activeCount >= maxConcurrentPerNode) {
    throw busy('This node is running its maximum number of file operations; try again shortly');
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
 * Throw `busy` if this app or the node has no free slot, WITHOUT taking one.
 *
 * Lets a caller refuse before it registers an operation, so the common case is
 * a clean 503 rather than a job that exists only to report that it never began.
 * The real limit is still enforced by acquireSlot; losing the race between the
 * two just means the refusal is recorded against a job instead of a response.
 *
 * @param {VolumeSession} session
 */
function assertCapacity(session) {
  const release = acquireSlot(session.identifier);
  release();
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
 * Run one file operation on an app's volume.
 *
 * @param {VolumeSession} session
 * @param {Array<string|VolumePath>} argv - operands must be VolumePath; a
 *   string operand is refused, which is what makes the session's checks
 *   unskippable rather than merely conventional
 * @param {object} [options]
 * @param {function(string): void} [options.onProgress] - called with each
 *   status line. The caller decides where it goes; for the HTTP endpoints that
 *   is jobRegistry.progress, so a client polls for the whole list rather than
 *   holding a connection open to receive it.
 * @param {function(): boolean} [options.isCanceled] - polled while the
 *   operation runs; when it returns true the container is killed. Cancellation
 *   is cooperative, so status stays Running until the work actually stops.
 * @param {string} [options.status] - the line reported while it runs
 * @param {{staging: VolumePath, destination: VolumePath}} [options.publish] -
 *   run the command into `staging` and move the result to `destination` only if
 *   it succeeds. Wrapping this here rather than leaving it to the caller is what
 *   stops an endpoint writing to a destination directly and losing the
 *   guarantee that a failure changes nothing.
 * @param {boolean} [options.mkdirStaging] - create the staging directory first,
 *   for commands like `tar -C` that need it to exist. A file copy must NOT ask
 *   for it: cp -T refuses to overwrite a directory with a non-directory.
 * @param {number} [options.maxBytes] - ceiling on what the command may leave in
 *   staging. Enforced on the RESULT rather than on what the input claims about
 *   itself, because an archive's declared sizes are written by whoever built it.
 * @param {boolean} [options.noLinks] - refuse a result containing symlinks or
 *   hard links.
 * @returns {Promise<void>} resolves when the operation succeeded
 */
async function run(session, argv, options = {}) {
  const {
    onProgress = null, isCanceled = null, status = 'Working...',
    publish = null, mkdirStaging = false, maxBytes = 0, noLinks = false,
  } = options;

  if (!(session instanceof VolumeSession)) {
    throw new Error('run requires a VolumeSession');
  }

  const toParam = (arg) => {
    if (arg instanceof VolumePath) return arg.containerPath;
    if (typeof arg !== 'string') throw new Error('Command arguments must be strings or VolumePath');
    // A string that looks like a host path never belongs in argv: operands are
    // expressed relative to the container's view of the volume, and a caller
    // passing an absolute path has bypassed the session.
    if (path.isAbsolute(arg) && !arg.startsWith(`${WORK_ROOT}/`) && arg !== WORK_ROOT) {
      throw new Error(`Refusing an absolute path operand outside ${WORK_ROOT}: ${arg}`);
    }
    return arg;
  };

  let params = argv.map(toParam);

  if (publish) {
    if (!(publish.staging instanceof VolumePath) || !(publish.destination instanceof VolumePath)) {
      throw new Error('publish requires VolumePath staging and destination');
    }
    params = [
      'flux-op',
      ...(mkdirStaging ? ['--mkdir'] : []),
      ...(maxBytes > 0 ? ['--max-bytes', String(Math.floor(maxBytes))] : []),
      ...(noLinks ? ['--no-links'] : []),
      toParam(publish.staging),
      toParam(publish.destination),
      '--',
      ...params,
    ];
  }

  const release = acquireSlot(session.identifier);
  let container = null;
  let ticker = null;

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

    await container.start();

    if (onProgress) onProgress(status);

    // One timer serves both jobs: report that the operation is still alive, and
    // notice a cancellation. A cancel only sets a flag - the work is not
    // interrupted where it stands - so something has to look, and this is
    // already looking.
    if (onProgress || isCanceled) {
      ticker = setInterval(() => {
        if (isCanceled && isCanceled()) {
          log.info(`volumeExecutor - cancel requested, stopping ${session.identifier} operation`);
          container.kill().catch(() => {});
          return;
        }
        if (onProgress) onProgress(status);
      }, settings().progressIntervalMs);
    }

    const result = await exited;
    if (result.StatusCode !== 0) {
      throw new Error(`File operation failed with exit code ${result.StatusCode}`);
    }
  } finally {
    if (ticker) clearInterval(ticker);
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
 * A marker whose contents do not name a path inside this volume is left exactly
 * where it is, loudly. It cannot be placed, and it is the one case where the
 * entry beside it might still be somebody's only copy - so the safe direction
 * is to keep it and say so, not to tidy it away.
 *
 * Everything here runs on names this function matched itself, in a directory
 * the app owner can also write to, so both the names and the marker contents
 * are treated as input rather than as state this module left behind.
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

  const present = new Set(entries);

  // eslint-disable-next-line no-restricted-syntax
  for (const entry of entries) {
    try {
      if (isStagingName(entry)) {
        // eslint-disable-next-line no-await-in-loop
        await remove(entry);
      } else if (isSwapName(entry)) {
        const marker = `${entry}${MARKER_SUFFIX}`;
        // Only an absent marker means the crash landed before it was written.
        // Any other read failure is rethrown to the handler below, which leaves
        // the entry alone: deleting somebody's displaced data because a file
        // could not be read this once is the outcome this whole function exists
        // to prevent.
        // eslint-disable-next-line no-await-in-loop
        const contents = await fsPromises.readFile(path.join(mount, marker), 'utf8')
          .catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });

        if (contents === null) {
          // No marker: the destination was never touched, so this entry is a
          // duplicate of data the caller still has.
          // eslint-disable-next-line no-await-in-loop
          await remove(entry);
          // eslint-disable-next-line no-continue
          continue;
        }

        const destination = resolveMarkerDestination(mount, contents);
        if (!destination) {
          log.error(`volumeExecutor - ${marker} in ${mount} does not name a path inside the volume; leaving ${entry} in place`);
          // eslint-disable-next-line no-continue
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const destinationExists = await fsPromises.lstat(destination).then(() => true).catch(() => false);

        if (destinationExists) {
          // The publish completed and only its cleanup was interrupted.
          // eslint-disable-next-line no-await-in-loop
          await remove(entry);
          // eslint-disable-next-line no-await-in-loop
          await remove(marker);
        } else {
          // eslint-disable-next-line no-await-in-loop
          const result = await serviceHelper.runCommand('mv', {
            runAsRoot: true, params: ['-T', path.join(mount, entry), destination],
          });
          if (result.error) throw result.error;
          restored.push(destination);
          // eslint-disable-next-line no-await-in-loop
          await remove(marker);
        }
      } else if (isSwapMarkerName(entry) && !present.has(entry.slice(0, -MARKER_SUFFIX.length))) {
        // A marker whose entry never arrived - the crash landed between writing
        // it and the rename that uses it. Nothing was displaced, so there is
        // nothing to place, and without this it stays in the volume root
        // forever, one per interruption, visible in the file browser.
        // eslint-disable-next-line no-await-in-loop
        await remove(entry);
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
  assertCapacity,
  reapOrphanedContainers,
  sweepStagingDirectories,
  acquireSlot,
  EXECUTOR_LABELS,
  SWAP_PREFIX,
};
