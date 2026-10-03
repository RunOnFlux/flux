const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const syncthingService = require('../syncthingService');
const globalState = require('../utils/globalState');
const fluxEventBus = require('../utils/fluxEventBus');
const { appsFolder } = require('../utils/appConstants');
const { OWNED_FOLDER_SETTINGS } = require('./syncthingMonitorHelpers');

// Every write FluxOS makes to an app folder's syncthing config goes through this
// module, one at a time per folder.
//
// Syncthing does not apply a folder write atomically. A PATCH reads the folder
// when the request arrives and queues the whole folder, with the fields sent
// applied over it, for writing; each queued change waits for the one before it
// to take effect, and a type change restarts the folder. A second write that
// arrives while the first is queued carries the folder as it was and writes it
// back, undoing the first even when the two sent different fields. A PUT fills
// every field it does not send from syncthing's default folder, not from the
// folder's current config - the default type is sendreceive.
//
// So a folder has at most one write in flight from FluxOS, and the write that
// completes is the one that lands. A write syncthing did not answer may still be
// queued inside it, and can land after the next one here.

// How long a primary start waits for a type change syncthing did not answer to
// show in its config. Syncthing applies a type change by restarting the folder;
// the start claim keeps peers off the component for the whole wait.
const FOLDER_TYPE_SETTLE_MS = 60 * 1000;
const FOLDER_TYPE_POLL_MS = 1000;

// How long a scan this module asks for may take. Syncthing answers a scan once
// it is done; a scan before a type change that has not finished by then leaves
// the type unchanged.
const FOLDER_SCAN_TIMEOUT_MS = 10 * 60 * 1000;

// folder id -> the promise that settles when the last write queued for it ends
const lastWrite = new Map();

// folder id -> { seq, type } of the last type syncthing accepted for it here
const recordedTypes = new Map();
let recordSeq = 0;

/**
 * Runs `write` once every write already queued for any of `folderIds` has ended,
 * and holds those folders until it ends. The place in the queue is taken on the
 * call, before anything is awaited.
 * @template T
 * @param {string[]} folderIds
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 */
async function exclusive(folderIds, write) {
  const before = folderIds.map((id) => lastWrite.get(id));
  let end;
  const ended = new Promise((resolve) => { end = resolve; });
  folderIds.forEach((id) => lastWrite.set(id, ended));
  try {
    await Promise.all(before);
    return await write();
  } finally {
    end();
    folderIds.forEach((id) => {
      if (lastWrite.get(id) === ended) lastWrite.delete(id);
    });
  }
}

/**
 * Records a type syncthing accepted for a folder: the set of writable folders
 * peers are told about, and the event a folder turning writable publishes.
 * @param {string} folderId
 * @param {string} type
 */
function recordType(folderId, type) {
  recordSeq += 1;
  recordedTypes.set(folderId, { seq: recordSeq, type });
  const writable = globalState.promotedFolderIds;
  if (type === 'sendreceive') {
    if (!writable?.has(folderId)) fluxEventBus.publish('syncthing:folderWritable', { folder: folderId });
    writable?.add(folderId);
    // What a folder holds that the cluster's index does not is a receive-only
    // question, and promotion answers it: everything this node holds is now
    // published. Dropped rather than zeroed - absent is what a peer reads as
    // "not a receive-only holder".
    globalState.folderHoldings?.delete(folderId);
    // A folder that sends has been seeded; peers read that from the folder itself.
    globalState.seedMarks.delete(folderId);
  } else {
    writable?.delete(folderId);
  }
}

/**
 * Replaces the set of writable folders peers are told about with what a monitor
 * pass observed, and publishes the event for each folder it adds. A pass can read
 * a folder's new type after syncthing applied it and before its writer recorded
 * it, so the folder turns writable here and its writer then finds it already
 * held. The first set after a start publishes nothing: a folder found sending
 * then did not turn writable.
 * @param {Set<string>} writable
 */
function publishWritable(writable) {
  const previous = globalState.promotedFolderIds;
  if (previous) {
    writable.forEach((folderId) => {
      if (!previous.has(folderId)) fluxEventBus.publish('syncthing:folderWritable', { folder: folderId });
    });
  }
  globalState.promotedFolderIds = writable;
}

// RESTART COVER - why a write to a sending folder is followed by two full scans.
//
// Syncthing restarts a folder whenever its config changes: a type change, a
// device added or removed, an unpause. The restarted folder finds changes two
// ways, and syncthing's own guarantee rests on the second:
//   - its watcher (inotify), which reports a change seconds after it happens;
//   - full scans, which find everything on disk. Syncthing treats the watcher as
//     best-effort and the scans as the guarantee: a full scan that starts once
//     the watcher is running covers everything written before it, and the
//     watcher covers everything after.
// On a restart syncthing starts the watcher in the background and runs its first
// full scan straight away, without waiting for the watcher. When that scan
// finishes first, a file written in between is seen by neither, and nothing
// finds it until the next periodic rescan - rescanIntervalS, fifteen minutes
// here (syncthingMonitorConstants). On a primary that is a write the standbys do
// not receive for up to fifteen minutes, and lose if the primary dies within
// them.
//
// Every config write goes through this module, so every restart is known here,
// and the scan that restores the guarantee is made here, in two steps:
//   1. A full scan. Syncthing runs a scan request inside the restarted folder's
//      own loop, and the folder starts its watcher before it enters that loop,
//      so this scan answering proves the restarted folder is running and its
//      watcher has been starting for at least one full scan. On its own it can
//      still run before the watcher is up, exactly as the folder's first scan can.
//   2. A second full scan, requested once the first has answered. It starts
//      after the watcher has had that scan's time to come up, so it finds every
//      file written since the restart, and the watcher reports every write after
//      it starts.
// What is left is a watcher that takes longer to come up than a full scan of the
// same folder takes to run - both walk the same tree - and that case the
// periodic rescan still covers.
//
// Nothing waits for the scans. They write no config, so the next write to the
// folder - a safety demotion included - waits only for the write before it. And
// the guarantee does not depend on what the app does meanwhile: a file written
// before the second scan starts is found by it, and one written after is the
// watcher's. So a write returns once syncthing has it, and an app restarts on its
// folder at once.
//
// One cover runs per folder. A restart while one runs is covered by one more,
// after it: each scans the whole folder. A later write that restarts the folder
// cuts a scan short, which is logged and counted as unfinished, and is covered
// by the cover that follows. A receiving folder is not covered - nothing written
// there leaves this node - nor is a paused one, which syncthing does not scan.
//
// A scan that fails or does not finish is logged and counted, and the write still
// stands: a primary that could not start its app is worse than a gap the
// periodic rescan closes. A folder whose volume has gone is not scanned at all,
// and the cover ends there.
async function coverRestart(folderId) {
  for (const step of ['first', 'second']) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await syncthingService.scanFolder(folderId, { timeoutMs: FOLDER_SCAN_TIMEOUT_MS });
    } catch (error) {
      if (error.code === 'VOLUME_NOT_MOUNTED') {
        log.warn(`the ${step} scan covering the restart of ${folderId} was not asked for: its volume is not mounted`);
        fluxEventBus.count('syncthing:restartCover', folderId, 'volumeNotMounted');
        return;
      }
      log.warn(`the ${step} scan covering the restart of ${folderId} did not finish: ${error.message}; a file written as it restarted reaches peers at the next periodic rescan`);
      fluxEventBus.count('syncthing:restartCover', folderId, 'unfinished');
      return;
    }
  }
  fluxEventBus.count('syncthing:restartCover', folderId, 'covered');
}

// folder id -> { again, done } for the cover running on it
const covers = new Map();

async function coverUntilQuiet(folderId, cover) {
  try {
    do {
      // eslint-disable-next-line no-param-reassign
      cover.again = false;
      // eslint-disable-next-line no-await-in-loop
      await coverRestart(folderId);
    } while (cover.again);
  } finally {
    covers.delete(folderId);
  }
}

/**
 * Covers a folder's restart in the background: starts a cover, or has the one
 * running on the folder followed by one more.
 * @param {string} folderId
 * @returns {void}
 */
function coverInBackground(folderId) {
  const running = covers.get(folderId);
  if (running) {
    running.again = true;
    return;
  }
  const cover = { again: false };
  covers.set(folderId, cover);
  cover.done = coverUntilQuiet(folderId, cover).catch((error) => {
    log.error(`covering the restart of ${folderId} failed: ${error.message}`);
  });
}

/**
 * Resolves once no cover runs on the folder.
 * @param {string} folderId
 * @returns {Promise<void>}
 */
function whenCovered(folderId) {
  return covers.get(folderId)?.done ?? Promise.resolve();
}

// Whether a write that syncthing accepted leaves the folder sending and running,
// so its restart needs covering. A write that pauses the folder stops it.
function leavesSending(folderId, fields) {
  if (fields.paused === true) return false;
  return Boolean(globalState.promotedFolderIds?.has(folderId));
}

async function patchNow(folderId, fields) {
  const response = await syncthingService.adjustConfigFolders('patch', fields, folderId);
  if (response.status === 'success' && fields.type) recordType(folderId, fields.type);
  return response;
}

/**
 * Creates or replaces whole folders. Every field a folder leaves out takes
 * syncthing's default, so each carries its type.
 * @param {object[]} folders Complete folder configs
 * @returns {Promise<object>} syncthing's response
 */
async function putFolders(folders) {
  const untyped = folders.filter((folder) => !folder.type).map((folder) => folder.id);
  if (untyped.length) {
    return Promise.reject(new Error(`folder config without a type would be written as syncthing's default: ${untyped.join(', ')}`));
  }
  const response = await exclusive(folders.map((folder) => folder.id), async () => {
    const put = await syncthingService.adjustConfigFolders('put', folders);
    if (put.status === 'success') folders.forEach((folder) => recordType(folder.id, folder.type));
    return put;
  });
  if (response.status === 'success') {
    folders.filter((folder) => leavesSending(folder.id, folder)).forEach((folder) => coverInBackground(folder.id));
  }
  return response;
}

/**
 * Changes the given fields of an existing folder; syncthing keeps the rest.
 * @param {string} folderId
 * @param {object} fields
 * @returns {Promise<object>} syncthing's response - 404 for a folder it does not know
 */
async function patchFolder(folderId, fields) {
  const response = await exclusive([folderId], () => patchNow(folderId, fields));
  if (response.status === 'success' && leavesSending(folderId, fields)) coverInBackground(folderId);
  return response;
}

/**
 * @param {string} folderId
 * @returns {Promise<object>} syncthing's response
 */
function deleteFolder(folderId) {
  return exclusive([folderId], async () => {
    const response = await syncthingService.adjustConfigFolders('delete', undefined, folderId);
    if (response.status === 'success') {
      globalState.promotedFolderIds?.delete(folderId);
      recordedTypes.delete(folderId);
    }
    return response;
  });
}

/**
 * A mark to take before reading syncthing's folder config.
 * @returns {number}
 */
function mark() {
  return recordSeq;
}

/**
 * The types written here since `since`, which a folder config read after the
 * mark may not show yet.
 * @param {number} since A mark()
 * @returns {Array<[string, string]>} [folderId, type] pairs
 */
function typesRecordedSince(since) {
  return [...recordedTypes]
    .filter(([, recorded]) => recorded.seq > since)
    .map(([folderId, recorded]) => [folderId, recorded.type]);
}

/**
 * Whether a folder's configured type becomes `folderType` within `settleMs`.
 * @param {string} folderPath
 * @param {string} folderType
 * @param {number} settleMs
 * @returns {Promise<boolean>}
 */
async function folderTypeSettles(folderPath, folderType, settleMs) {
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(FOLDER_TYPE_POLL_MS);
    // eslint-disable-next-line no-await-in-loop
    const folders = await syncthingService.getConfigFolders().catch(() => null);
    if (folders?.find((f) => f.path === folderPath)?.type === folderType) return true;
  }
  return false;
}

/**
 * Scans a folder whose type is about to change, and answers whether syncthing
 * confirmed the scan finished. The folder is not held while it scans: a scan
 * writes no config.
 * @param {string} folderId
 * @param {string} folderType The type it is about to change to
 * @returns {Promise<boolean>} True when the folder is already that type, or the
 *   scan finished.
 */
async function scannedBeforeChange(folderId, folderType) {
  try {
    const folderPath = `${appsFolder}${folderId}`;
    const folder = (await syncthingService.getConfigFolders()).find((f) => f.path === folderPath);
    if (!folder || folder.type === folderType) return true;
    await syncthingService.scanFolder(folderId, { timeoutMs: FOLDER_SCAN_TIMEOUT_MS });
    return true;
  } catch (error) {
    // Nothing on a volume that is not mounted is this node's to announce, and a
    // folder over it is safest receiving.
    if (error.code === 'VOLUME_NOT_MOUNTED' && folderType === 'receiveonly') {
      log.warn(`${folderId} becomes receiveonly unscanned: its volume is not mounted`);
      return true;
    }
    log.warn(`scan of ${folderId} before it becomes ${folderType} did not finish: ${error.message}; its type is unchanged`);
    return false;
  }
}

/**
 * Changes a folder's type, reading it first and writing only when it differs.
 *
 * A write syncthing did not answer is not a refusal: it may still apply. With
 * `settleMs`, such a write succeeds if the folder shows the type within that
 * time, and the folder is held for that time. A write syncthing answered with an
 * error fails at once.
 * @param {string} folderId - Syncthing folder ID (e.g., appId)
 * @param {string} folderType - 'receiveonly' or 'sendreceive'
 * @param {object} [options]
 * @param {number} [options.settleMs]
 * @param {boolean} [options.scanFirst] Scan the folder before a change, so what
 *   this node wrote is announced as its own version before the folder receives.
 *   A scan syncthing does not confirm finished leaves the type unchanged.
 * @param {() => boolean} [options.abandonIf] Asked once the folder is held; true
 *   writes nothing and fails the change.
 * @returns {Promise<boolean>} - true if the folder has the type
 */
async function changeSyncthingFolderType(folderId, folderType, { settleMs = 0, scanFirst = false, abandonIf = () => false } = {}) {
  if (scanFirst && !(await scannedBeforeChange(folderId, folderType))) return false;
  let covered = false;
  const changed = await exclusive([folderId], async () => {
    try {
      if (abandonIf()) return false;
      const folders = await syncthingService.getConfigFolders();

      // Syncthing syncs the entire appId folder (includes all subdirectories)
      const folderPath = `${appsFolder}${folderId}`;
      const folder = folders.find((f) => f.path === folderPath);

      if (!folder) {
        log.error(`Syncthing folder not found for path: ${folderPath}`);
        return false;
      }

      // The election asserts a folder's type on every pass, so an unchanged
      // folder is the common case and says nothing worth logging.
      if (folder.type === folderType) {
        return true;
      }

      log.info(`Changing syncthing folder ${folderId} to ${folderType} mode`);

      const patchData = { type: folderType, ...OWNED_FOLDER_SETTINGS };
      const updateResponse = await patchNow(folder.id, patchData);

      if (updateResponse.status === 'success') {
        log.info(`Successfully changed syncthing folder ${folderId} to ${folderType} mode`);
        covered = leavesSending(folderId, patchData);
        return true;
      }
      if (settleMs > 0 && updateResponse.data?.httpStatus === null) {
        log.warn(`Syncthing did not answer the change of folder ${folderId} to ${folderType} mode, waiting up to ${settleMs}ms for it to apply`);
        if (await folderTypeSettles(folderPath, folderType, settleMs)) {
          log.info(`Syncthing folder ${folderId} is in ${folderType} mode`);
          recordType(folderId, folderType);
          covered = leavesSending(folderId, patchData);
          return true;
        }
      }
      log.error(`Failed to change syncthing folder type: ${JSON.stringify(updateResponse)}`);
      return false;
    } catch (error) {
      log.error(`Error changing syncthing folder type for ${folderId}: ${error.message}`);
      return false;
    }
  });
  if (covered) coverInBackground(folderId);
  return changed;
}

module.exports = {
  FOLDER_TYPE_SETTLE_MS,
  changeSyncthingFolderType,
  putFolders,
  patchFolder,
  deleteFolder,
  mark,
  publishWritable,
  typesRecordedSince,
  whenCovered,
};
