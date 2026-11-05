const crypto = require('crypto');
const log = require('../../lib/log');
const syncthingService = require('../syncthingService');
const peerIdentityService = require('../peerIdentityService');
const { socketAddressesMatch } = require('../utils/socketAddressUtils');
const syncthingFolderWrites = require('./syncthingFolderWrites');
const { signedPeerRequest } = require('./peerFolderLiveness');

// A standby whose store of its primary's index lacks a delete the primary published.
//
// It keeps what was deleted, and nothing tells it otherwise: syncthing resumes an index
// from the highest sequence a device has seen, so a record it never stored is not sent
// again, by any reconnect or restart. Its copy holds what no peer does, so it can never
// show a peer holds it, and a copy leaving is refused for good. Syncthing purges a delete
// after 180 days, and the repair goes with it.
//
// The repair is the primary leaving the folder's device list and coming back. Syncthing
// drops what it holds of that device's index and is sent all of it again, and only a
// strictly newer record then replaces anything here. This node's own records are
// untouched, which is why the repair is not /rest/system/reset: that rewrites a record's
// history as this node's own, and the revert of a local change then deletes what may be
// the only copy.
//
// What is checked here is whether a folder restart is owed. Nothing here is what keeps
// data safe: syncthing's version rule does that.

// More than this is not one lost batch.
const MAX_STRANDED_ITEMS = 100;
const ASK_TIMEOUT_MS = 20 * 1000;

const StrandedCode = Object.freeze({
  // the daemon keeps a dropped device's sequence, so the device would send deltas only
  // and the index stays empty
  UNSUPPORTED_RELEASE: 'UNSUPPORTED_RELEASE',
  NOT_A_STANDBY: 'NOT_A_STANDBY',
  STILL_SYNCING: 'STILL_SYNCING',
  PRIMARY_NOT_CONNECTED: 'PRIMARY_NOT_CONNECTED',
  NOTHING_STRANDED: 'NOTHING_STRANDED',
  TOO_MANY_ITEMS: 'TOO_MANY_ITEMS',
  // the list has to stand across two passes: anything moving is a sync, not a loss
  FIRST_SIGHTING: 'FIRST_SIGHTING',
  PRIMARY_UNPROVEN: 'PRIMARY_UNPROVEN',
  NOT_A_LOST_DELETE: 'NOT_A_LOST_DELETE',
  REFETCH_FAILED: 'REFETCH_FAILED',
  REFETCHED: 'REFETCHED',
});

// folder id -> the fingerprint of what the last pass found stranded
const sightings = new Map();

function counters(version) {
  return new Map((Array.isArray(version) ? version : []).map((entry) => {
    const separator = entry.lastIndexOf(':');
    return [entry.slice(0, separator), Number(entry.slice(separator + 1))];
  }));
}

/**
 * Whether one version vector strictly dominates another.
 * @param {string[]} newer syncthing's `id:counter` entries
 * @param {string[]} older
 * @returns {boolean}
 */
function strictlyDominates(newer, older) {
  const a = counters(newer);
  const b = counters(older);
  const ids = new Set([...a.keys(), ...b.keys()]);
  let greater = false;
  // eslint-disable-next-line no-restricted-syntax
  for (const id of ids) {
    const left = a.get(id) ?? 0;
    const right = b.get(id) ?? 0;
    if (left < right) return false;
    if (left > right) greater = true;
  }
  return greater;
}

function fingerprint(names) {
  return crypto.createHash('sha256').update(JSON.stringify([...names].sort())).digest('hex');
}

async function neededByPeer(folderId, deviceId) {
  const answer = await syncthingService.getDbRemoteNeed(folderId, deviceId, 1, MAX_STRANDED_ITEMS + 1);
  return ['files', 'progress', 'queued', 'rest'].flatMap((list) => answer?.[list] ?? []).map((item) => item.name);
}

/**
 * Whether the primary has published a delete strictly newer than this node's record of
 * every item.
 * @param {string} folderId
 * @param {string} primary The primary's socket address.
 * @param {string[]} names
 * @returns {Promise<string>} A StrandedCode.
 */
async function everyItemIsALostDelete(folderId, primary, names) {
  const asked = await peerIdentityService.askSigned(
    primary,
    '/apps/folderrecords',
    peerIdentityService.AnswerPurpose.FOLDER_RECORDS,
    async (challenge) => (await signedPeerRequest(primary, challenge, { folder: folderId, items: names })) ?? {},
    { timeout: ASK_TIMEOUT_MS },
  );
  if (asked.verdict !== peerIdentityService.IdentityVerdict.VERIFIED || asked.answer?.folder !== folderId) {
    return StrandedCode.PRIMARY_UNPROVEN;
  }
  const records = asked.answer.records ?? {};
  const local = await Promise.all(names.map((name) => syncthingService.getDbFile(folderId, name)));
  const everyOne = names.every((name, index) => {
    const theirs = records[name];
    const ours = local[index]?.local;
    return theirs?.deleted === true && ours && !ours.deleted && strictlyDominates(theirs.version, ours.version);
  });
  return everyOne ? StrandedCode.REFETCHED : StrandedCode.NOT_A_LOST_DELETE;
}

/**
 * On a pass that found no peer holding a leaving standby's copy: hears the primary's
 * index again if a delete has been lost.
 * @param {string} folderId
 * @param {string} primary The socket address of the node running the component.
 * @returns {Promise<{code: string}>} `code` is a StrandedCode.
 */
async function repairIfStranded(folderId, primary) {
  const answer = (code) => {
    if (code !== StrandedCode.FIRST_SIGHTING) sightings.delete(folderId);
    return { code };
  };

  if (!(await syncthingService.refetchesDroppedDevices())) return answer(StrandedCode.UNSUPPORTED_RELEASE);

  const folder = await syncthingFolderWrites.folderConfig(folderId);
  if (folder?.type !== 'receiveonly') return answer(StrandedCode.NOT_A_STANDBY);

  const status = await syncthingService.getDbStatus(folderId);
  if (status?.state !== 'idle' || status.needTotalItems !== 0) return answer(StrandedCode.STILL_SYNCING);

  const devices = (await syncthingService.getConfigDevices()) ?? [];
  const device = devices.find(({ name }) => socketAddressesMatch(name, primary));
  const shared = device && folder.devices.some(({ deviceID }) => deviceID === device.deviceID);
  const remote = shared
    ? await syncthingService.getDbCompletion({ folder: folderId, device: device.deviceID })
    : null;
  if (remote?.remoteState !== 'valid') return answer(StrandedCode.PRIMARY_NOT_CONNECTED);

  const names = await neededByPeer(folderId, device.deviceID);
  if (!names.length) return answer(StrandedCode.NOTHING_STRANDED);
  if (names.length > MAX_STRANDED_ITEMS) return answer(StrandedCode.TOO_MANY_ITEMS);

  const seen = fingerprint(names);
  if (sightings.get(folderId) !== seen) {
    sightings.set(folderId, seen);
    return answer(StrandedCode.FIRST_SIGHTING);
  }

  const verdict = await everyItemIsALostDelete(folderId, primary, names);
  if (verdict !== StrandedCode.REFETCHED) return answer(verdict);

  log.warn(`strandedIndex - ${folderId}: ${names.length} delete(s) of ${primary} never arrived; hearing its index again`);
  const refetched = await syncthingFolderWrites.refetchDeviceIndex(folderId, device.deviceID);
  return answer(refetched ? StrandedCode.REFETCHED : StrandedCode.REFETCH_FAILED);
}

module.exports = {
  MAX_STRANDED_ITEMS,
  StrandedCode,
  repairIfStranded,
  strictlyDominates,
};
