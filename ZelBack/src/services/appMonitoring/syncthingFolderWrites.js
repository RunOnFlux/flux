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

// How long the scan before a type change may take. Syncthing answers a scan
// once it is done; one that has not finished by then leaves the type unchanged.
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
function putFolders(folders) {
  const untyped = folders.filter((folder) => !folder.type).map((folder) => folder.id);
  if (untyped.length) {
    return Promise.reject(new Error(`folder config without a type would be written as syncthing's default: ${untyped.join(', ')}`));
  }
  return exclusive(folders.map((folder) => folder.id), async () => {
    const response = await syncthingService.adjustConfigFolders('put', folders);
    if (response.status === 'success') folders.forEach((folder) => recordType(folder.id, folder.type));
    return response;
  });
}

/**
 * Changes the given fields of an existing folder; syncthing keeps the rest.
 * @param {string} folderId
 * @param {object} fields
 * @returns {Promise<object>} syncthing's response - 404 for a folder it does not know
 */
function patchFolder(folderId, fields) {
  return exclusive([folderId], () => patchNow(folderId, fields));
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
  return exclusive([folderId], async () => {
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
        return true;
      }
      if (settleMs > 0 && updateResponse.data?.httpStatus === null) {
        log.warn(`Syncthing did not answer the change of folder ${folderId} to ${folderType} mode, waiting up to ${settleMs}ms for it to apply`);
        if (await folderTypeSettles(folderPath, folderType, settleMs)) {
          log.info(`Syncthing folder ${folderId} is in ${folderType} mode`);
          recordType(folderId, folderType);
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
};
