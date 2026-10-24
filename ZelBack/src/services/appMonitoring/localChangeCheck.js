const crypto = require('crypto');
const log = require('../../lib/log');
const syncthingService = require('../syncthingService');
const messageHelper = require('../messageHelper');
const fluxEventBus = require('../utils/fluxEventBus');
const syncthingFolderWrites = require('./syncthingFolderWrites');

// Whether a receive-only folder's local changes include the only copy of data another
// device wrote, decided off the monitor pass.
//
// The answer takes a request per change to another device's data, and an app decides
// how many of those there are: a standby that rewrote its copy of a large folder has
// one for every file. Asked inside the pass, that is paid by every app on the node.
// Here a check runs on its own, one folder at a time per node, and the pass reads the
// answer it left.
//
// AN ANSWER HOLDS FOR THE FOLDER IT WAS ASKED ABOUT, AND NO OTHER. It is stamped with
// the folder as syncthing described it when the check was asked for: the counts of
// this node's changes to it, and the devices it is shared with. A change on this node
// moves the first, and a device leaving the folder - the moment a change held
// elsewhere becomes the only copy - changes the second. What this node pulls moves
// neither, so an answer stands while the primary keeps writing. The pass acts on an
// answer only while the folder still carries its stamp.
//
// A REVERT IS OF THE CHANGES CHECKED, AND NO OTHERS, ON THE FOLDER CHECKED. Counts can
// stay the same while the changes do not, so the pass does not revert itself: it asks
// for a revert here, in the same queue as the checks. The revert reads the folder's
// changes again and goes ahead only while they are exactly the ones the check
// examined, and the folder still carries the check's stamp. The stamp is read and the
// revert sent while the folder's config is held against every write
// (syncthingFolderWrites), so no device leaves the folder between the two; a write
// that arrives once syncthing has the revert waits inside syncthing for its work.

// syncthing's FlagLocalReceiveOnly: an item this node changed in a receive-only folder.
const RECEIVE_ONLY_CHANGE_FLAG = 8;
const LOCAL_CHANGE_PAGE_SIZE = 1000;
// How many items are asked about at once.
const FILE_REQUESTS_AT_ONCE = 8;

// The counts syncthing keeps of a folder's receive-only changes, which make its stamp.
const CHANGE_COUNTS = Object.freeze([
  'receiveOnlyChangedFiles', 'receiveOnlyChangedDirectories', 'receiveOnlyChangedSymlinks',
  'receiveOnlyChangedDeletes', 'receiveOnlyChangedBytes',
]);

// Jobs asked for and not started, at most one per folder: a check
// { kind: 'check', folderId, entry, stamp, isCurrent } or a revert
// { kind: 'revert', folderId, entry, answer, isCurrent, files, directories }.
const waiting = [];
let running = null;

/**
 * The folder as syncthing describes it, in the form an answer is stamped with.
 * @param {object} status The folder's db/status: its counts of receive-only changes,
 *   each absent one read as none.
 * @param {Array<{deviceID: string}>} devices The devices the folder is shared with.
 * @returns {string}
 */
function stampOf(status, devices) {
  const changes = CHANGE_COUNTS.map((count) => status?.[count] ?? 0);
  const shared = devices.map((device) => device.deviceID).sort();
  return JSON.stringify({ changes, shared });
}

/**
 * Adds one listed change to a fingerprint of the folder's changes: its name, its
 * history and whether it is a deletion.
 * @param {crypto.Hash} hash
 * @param {object} item An entry of db/localchanged.
 */
function addToFingerprint(hash, item) {
  hash.update(`${item?.name}\0${(item?.version ?? []).join(',')}\0${item?.deleted ? 1 : 0}\n`);
}

/**
 * A fingerprint of every local change of a folder, as syncthing lists them now.
 * @param {string} folderId
 * @returns {Promise<string|null>} null when the changes could not be read
 */
async function changesFingerprint(folderId) {
  try {
    const hash = crypto.createHash('sha256');
    for (let page = 1; ; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const batch = (await syncthingService.getDbLocalChanged(folderId, page, LOCAL_CHANGE_PAGE_SIZE))?.files;
      if (!Array.isArray(batch)) return page > 1 ? hash.digest('hex') : null;
      batch.forEach((item) => addToFingerprint(hash, item));
      if (batch.length < LOCAL_CHANGE_PAGE_SIZE) return hash.digest('hex');
    }
  } catch (error) {
    log.warn(`localChangeCheck - ${folderId}: ${error.message}`);
    return null;
  }
}

/**
 * The first of the named items whose cluster version is this node's own change: no
 * other device holds a valid version of it.
 * @param {string} folderId
 * @param {string[]} names
 * @returns {Promise<string|undefined>}
 */
async function firstHeldOnlyHere(folderId, names) {
  for (let start = 0; start < names.length; start += FILE_REQUESTS_AT_ONCE) {
    const batch = names.slice(start, start + FILE_REQUESTS_AT_ONCE);
    // eslint-disable-next-line no-await-in-loop
    const answers = await Promise.all(batch.map((name) => syncthingService.getDbFile(folderId, name)));
    // eslint-disable-next-line no-bitwise
    const index = answers.findIndex((answer) => ((answer?.global?.localFlags ?? 0) & RECEIVE_ONLY_CHANGE_FLAG) !== 0);
    if (index >= 0) return batch[index];
  }
  return undefined;
}

/**
 * What a receive-only folder's local changes are, for whether they may be reverted:
 *  - `onlyCopy`: a change that is the only copy of data from another device. Its
 *    history names another device, so the data came from elsewhere, and no other
 *    device holds a valid version of it. syncthing reverts such an item by deleting
 *    it, and a directory that is not empty cannot be deleted, so that revert fails on
 *    every pass. The first one found ends the check.
 *  - `madeHere`: whether any change's history is this node's alone. Such a change was
 *    made on this node, as a standby or earlier as the primary, and no other device's
 *    history says otherwise. It is not asked about: whether it may be reverted turns
 *    on whether another holder runs the app, not on what other devices hold.
 *  - `changes`: a fingerprint of every change examined, when there is no only copy;
 *    a revert goes ahead only while the folder's changes still have it.
 * @param {string} folderId
 * @returns {Promise<{onlyCopy: string|false, madeHere: boolean, changes?: string}|null>}
 *   null when the changes could not be read
 */
async function examineLocalChanges(folderId) {
  try {
    const deviceId = await syncthingService.getDeviceId();
    if (!deviceId) return null;
    const ownCounter = `${deviceId.substring(0, 7)}:`;
    const hash = crypto.createHash('sha256');
    let madeHere = false;
    for (let page = 1; ; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const batch = (await syncthingService.getDbLocalChanged(folderId, page, LOCAL_CHANGE_PAGE_SIZE))?.files;
      if (!Array.isArray(batch)) return page > 1 ? { onlyCopy: false, madeHere, changes: hash.digest('hex') } : null;
      const fromElsewhere = [];
      batch.forEach((item) => {
        addToFingerprint(hash, item);
        if ((item?.version ?? []).some((counter) => !counter.startsWith(ownCounter))) fromElsewhere.push(item.name);
        else madeHere = true;
      });
      // eslint-disable-next-line no-await-in-loop
      const found = await firstHeldOnlyHere(folderId, fromElsewhere);
      if (found !== undefined) return { onlyCopy: found, madeHere };
      if (batch.length < LOCAL_CHANGE_PAGE_SIZE) return { onlyCopy: false, madeHere, changes: hash.digest('hex') };
    }
  } catch (error) {
    log.warn(`localChangeCheck - ${folderId}: ${error.message}`);
    return null;
  }
}

/**
 * Runs one check and leaves its answer on the folder's entry, unless the entry has been
 * replaced since it was asked for: the folder it describes is gone.
 * @param {{folderId: string, entry: object, stamp: string, isCurrent: Function}} check
 */
async function runCheck(check) {
  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.SYNCTHING_BEFORE_LOCAL_CHANGE_CHECK, check.folderId);
  const found = await examineLocalChanges(check.folderId);
  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.SYNCTHING_BEFORE_LOCAL_CHANGE_ANSWER, check.folderId);
  if (found === null || !check.isCurrent()) return;
  // eslint-disable-next-line no-param-reassign
  check.entry.localChangeCheck = { stamp: check.stamp, ...found };
  fluxEventBus.publish('syncthing:localChangesChecked', { folder: check.folderId, onlyCopy: Boolean(found.onlyCopy), madeHere: found.madeHere });
}

/**
 * The folder as syncthing describes it now, in the form an answer is stamped with.
 * @param {string} folderId
 * @returns {Promise<string|null>} null when it could not be read
 */
async function currentStamp(folderId) {
  try {
    const [status, folder] = await Promise.all([syncthingService.getDbStatus(folderId), syncthingService.getConfigFolders(folderId)]);
    return Array.isArray(folder?.devices) ? stampOf(status, folder.devices) : null;
  } catch (error) {
    log.warn(`localChangeCheck - ${folderId}: ${error.message}`);
    return null;
  }
}

/**
 * Reverts a folder's local changes if they are exactly the ones its answer examined,
 * the folder still carries the answer's stamp, and the entry has not been replaced.
 * Otherwise the answer is dropped, so the pass asks for the folder to be checked
 * again; a folder that could not be read keeps it.
 * @param {{folderId: string, entry: object, answer: object, isCurrent: Function, files: number, directories: number}} job
 */
async function runRevert(job) {
  const { folderId, entry, answer } = job;
  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.SYNCTHING_BEFORE_LOCAL_CHANGE_REVERT, folderId);
  const now = await changesFingerprint(folderId);
  if (now === null || !job.isCurrent() || entry.localChangeCheck !== answer) return;
  if (now !== answer.changes) {
    // eslint-disable-next-line no-param-reassign
    delete entry.localChangeCheck;
    log.info(`localChangeCheck - ${folderId}: its local changes are not the ones checked; checking them again before any revert`);
    return;
  }
  await syncthingFolderWrites.exclusive([folderId], async () => {
    const stamp = await currentStamp(folderId);
    if (stamp === null || !job.isCurrent() || entry.localChangeCheck !== answer) return;
    if (stamp !== answer.stamp) {
      // eslint-disable-next-line no-param-reassign
      delete entry.localChangeCheck;
      log.info(`localChangeCheck - ${folderId}: the folder is not the one checked; checking it again before any revert`);
      return;
    }
    await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.SYNCTHING_BEFORE_LOCAL_CHANGE_REVERT_SENT, folderId);
    log.warn(`localChangeCheck - ${folderId} is synced but the receive-only folder has local changes (${job.files} files, ${job.directories} directories); reverting to the cluster's version`);
    try {
      // dataOrThrow: dbRevert answers in-band; without it a failed revert reads as reverted
      messageHelper.dataOrThrow(await syncthingService.dbRevert(folderId));
      // eslint-disable-next-line no-param-reassign
      delete entry.localChangeCheck;
      fluxEventBus.publish('syncthing:localChangesReverted', { folder: folderId, files: job.files, directories: job.directories });
    } catch (error) {
      log.error(`localChangeCheck - revert of local changes for ${folderId} failed: ${error.message}`);
    }
  });
}

async function runWaitingJobs() {
  while (waiting.length) {
    running = waiting.shift();
    // eslint-disable-next-line no-await-in-loop
    await (running.kind === 'revert' ? runRevert(running) : runCheck(running));
  }
  running = null;
}

// The waiting job for `job`'s folder becomes `job`.
function enqueue(job) {
  const index = waiting.findIndex((queued) => queued.folderId === job.folderId);
  if (index >= 0) waiting[index] = job;
  else waiting.push(job);
  if (!running) runWaitingJobs();
}

/**
 * Asks for a folder's local changes to be checked against the folder as `stamp`
 * describes it. A job already asked for the folder is replaced; a check running for
 * the same folder, entry and stamp is left to finish.
 * @param {string} folderId
 * @param {object} entry The folder's entry in receiveOnlySyncthingAppsCache; the answer
 *   is left on it as `localChangeCheck`.
 * @param {string} stamp stampOf the folder now.
 * @param {Function} isCurrent Whether `entry` is still the folder's entry.
 */
function request(folderId, entry, stamp, isCurrent) {
  if (running?.kind === 'check' && running.folderId === folderId && running.entry === entry && running.stamp === stamp) return;
  enqueue({
    kind: 'check', folderId, entry, stamp, isCurrent,
  });
}

/**
 * Asks for a folder's local changes to be reverted, if they are still the ones
 * `answer` examined. A job already asked for the folder is replaced; a revert running
 * for the same answer is left to finish.
 * @param {string} folderId
 * @param {object} entry The folder's entry in receiveOnlySyncthingAppsCache.
 * @param {object} answer The answer the revert rests on, left on `entry`.
 * @param {Function} isCurrent Whether `entry` is still the folder's entry.
 * @param {{files: number, directories: number}} changed What the folder's status counts.
 */
function revert(folderId, entry, answer, isCurrent, { files, directories }) {
  if (running?.kind === 'revert' && running.folderId === folderId && running.answer === answer) return;
  enqueue({
    kind: 'revert', folderId, entry, answer, isCurrent, files, directories,
  });
}

/**
 * The answer left for a folder's entry, if it was made against the folder as it is now.
 * @param {object} entry The folder's entry in receiveOnlySyncthingAppsCache.
 * @param {string} stamp stampOf the folder now.
 * @returns {{onlyCopy: string|false, madeHere: boolean}|null}
 */
function answerFor(entry, stamp) {
  const answer = entry?.localChangeCheck;
  return answer && answer.stamp === stamp ? answer : null;
}

module.exports = {
  answerFor,
  changesFingerprint,
  examineLocalChanges,
  request,
  revert,
  stampOf,
};
