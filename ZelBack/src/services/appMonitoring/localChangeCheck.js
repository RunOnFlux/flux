const log = require('../../lib/log');
const syncthingService = require('../syncthingService');
const fluxEventBus = require('../utils/fluxEventBus');

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
// the folder as syncthing described it when the check was asked for: this node's
// sequence, each other device's sequence, and the devices the folder is shared with.
// A local write moves the first, another device's index the second, and a device
// leaving the folder - the moment a change held elsewhere becomes the only copy -
// changes the third. The pass acts on an answer only while the folder still carries
// its stamp.

// syncthing's FlagLocalReceiveOnly: an item this node changed in a receive-only folder.
const RECEIVE_ONLY_CHANGE_FLAG = 8;
const LOCAL_CHANGE_PAGE_SIZE = 1000;
// How many items are asked about at once.
const FILE_REQUESTS_AT_ONCE = 8;

// Checks asked for and not started: { folderId, entry, stamp, isCurrent }.
const waiting = [];
let running = null;

/**
 * The folder as syncthing describes it, in the form an answer is stamped with.
 * @param {object} status The folder's db/status: `sequence` and `remoteSequence`.
 * @param {Array<{deviceID: string}>} devices The devices the folder is shared with.
 * @returns {string}
 */
function stampOf(status, devices) {
  const remote = Object.entries(status?.remoteSequence ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const shared = devices.map((device) => device.deviceID).sort();
  return JSON.stringify({ sequence: status?.sequence ?? null, remote, shared });
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
 * @param {string} folderId
 * @returns {Promise<{onlyCopy: string|false, madeHere: boolean}|null>} null when the
 *   changes could not be read
 */
async function examineLocalChanges(folderId) {
  try {
    const deviceId = await syncthingService.getDeviceId();
    if (!deviceId) return null;
    const ownCounter = `${deviceId.substring(0, 7)}:`;
    let madeHere = false;
    for (let page = 1; ; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const batch = (await syncthingService.getDbLocalChanged(folderId, page, LOCAL_CHANGE_PAGE_SIZE))?.files;
      if (!Array.isArray(batch)) return page > 1 ? { onlyCopy: false, madeHere } : null;
      const fromElsewhere = [];
      batch.forEach((item) => {
        if ((item?.version ?? []).some((counter) => !counter.startsWith(ownCounter))) fromElsewhere.push(item.name);
        else madeHere = true;
      });
      // eslint-disable-next-line no-await-in-loop
      const found = await firstHeldOnlyHere(folderId, fromElsewhere);
      if (found !== undefined) return { onlyCopy: found, madeHere };
      if (batch.length < LOCAL_CHANGE_PAGE_SIZE) return { onlyCopy: false, madeHere };
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

async function runWaitingChecks() {
  while (waiting.length) {
    running = waiting.shift();
    // eslint-disable-next-line no-await-in-loop
    await runCheck(running);
  }
  running = null;
}

/**
 * Asks for a folder's local changes to be checked against the folder as `stamp`
 * describes it. A check already asked for the folder is replaced; one running for the
 * same folder, entry and stamp is left to finish.
 * @param {string} folderId
 * @param {object} entry The folder's entry in receiveOnlySyncthingAppsCache; the answer
 *   is left on it as `localChangeCheck`.
 * @param {string} stamp stampOf the folder now.
 * @param {Function} isCurrent Whether `entry` is still the folder's entry.
 */
function request(folderId, entry, stamp, isCurrent) {
  if (running?.folderId === folderId && running.entry === entry && running.stamp === stamp) return;
  const check = { folderId, entry, stamp, isCurrent };
  const index = waiting.findIndex((queued) => queued.folderId === folderId);
  if (index >= 0) waiting[index] = check;
  else waiting.push(check);
  if (!running) runWaitingChecks();
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
  examineLocalChanges,
  request,
  stampOf,
};
