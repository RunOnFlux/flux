const globalState = require('../utils/globalState');
const mountParser = require('../utils/mountParser');
const dockerService = require('../dockerService');

// What this node tells its peers about each receive-only folder of an installed app,
// for a cold-start seed: which holder starts the app from what it holds.
//
// Every such folder has exactly one entry from its install to its removal, so a
// missing entry means only that the folder is not installed here. A peer about to
// seed waits on a folder this node has not looked at, ranks one it has measured,
// leaves out one this node cannot seed, and reads every other as no claim.
//
// Written where each fact becomes known: the install and a volume recreate, the
// monitor pass, a promotion, the removal. Nothing else removes an entry.

const FolderState = Object.freeze({
  // Installed, and no monitor pass has reached it since.
  NOT_LOOKED_AT: 'notLookedAt',
  // { bytes, newestModified } of what this node holds that the cluster's index does not.
  MEASURED: 'measured',
  // Looked at, with nothing to rank: its holdings could not be read, it has sent
  // everything it held, or it is a ready standby.
  NO_CLAIM: 'noClaim',
  // Held out of the monitor pass because its volume is not safe to act on or its app's
  // specification cannot be read, with its volume image still on the node: what it
  // holds is unknown.
  HELD_OUT: 'heldOut',
  // Held out of the monitor pass because its volume image is gone: nothing of it is
  // on the node.
  VOLUME_GONE: 'volumeGone',
});

// What a peer is sent for a folder this node has looked at and cannot claim
// anything of. Any value that is not a rankable claim reads as no claim.
const NO_CLAIM_ANSWER = Object.freeze({ unreadable: true });

/**
 * The folder ids of an app's components that sync receive-only (g: and r:).
 * @param {object} appSpec Installed app specification, decrypted.
 * @returns {string[]}
 */
function receiveOnlyFolderIds(appSpec) {
  const components = appSpec.version <= 3
    ? [{ identifier: appSpec.name, containerData: appSpec.containerData }]
    : (appSpec.compose || []).map((component) => ({ identifier: `${component.name}_${appSpec.name}`, containerData: component.containerData }));
  return components
    .filter(({ containerData }) => ['g', 'r'].includes(mountParser.getComponentSyncMode(containerData)))
    .map(({ identifier }) => dockerService.getAppIdentifier(identifier));
}

/**
 * Records the receive-only folders of an installed app that have no entry as not
 * looked at. A folder that already has one keeps it: its volume is the one it
 * describes.
 * @param {object} appSpec Installed app specification, decrypted.
 */
function installed(appSpec) {
  receiveOnlyFolderIds(appSpec)
    .filter((folderId) => !globalState.folderStates.has(folderId))
    .forEach((folderId) => globalState.folderStates.set(folderId, { state: FolderState.NOT_LOOKED_AT }));
}

/**
 * Records a folder whose volume has been replaced by an empty one as not looked at.
 * @param {string} folderId
 */
function recreated(folderId) {
  globalState.folderStates.set(folderId, { state: FolderState.NOT_LOOKED_AT });
}

/**
 * Removes a folder whose volume has been deleted.
 * @param {string} folderId
 */
function removed(folderId) {
  globalState.folderStates.delete(folderId);
}

/**
 * Records what a monitor pass measured of a folder.
 * @param {string} folderId
 * @param {{bytes: number, newestModified: number}|null} holdings null when they could not be read.
 */
function measured(folderId, holdings) {
  globalState.folderStates.set(folderId, holdings
    ? { state: FolderState.MEASURED, bytes: holdings.bytes, newestModified: holdings.newestModified }
    : { state: FolderState.NO_CLAIM });
}

/**
 * Records a folder the monitor pass held out because its volume is not safe to act on.
 * @param {string} folderId
 */
function heldOut(folderId) {
  globalState.folderStates.set(folderId, { state: FolderState.HELD_OUT });
}

/**
 * Records a folder the monitor pass held out because its volume image is gone.
 * @param {string} folderId
 */
function volumeGone(folderId) {
  globalState.folderStates.set(folderId, { state: FolderState.VOLUME_GONE });
}

function heldOutUnlessGone(folderId) {
  if (globalState.folderStates.get(folderId)?.state === FolderState.VOLUME_GONE) return;
  heldOut(folderId);
}

/**
 * Records a folder the monitor pass found not mounted without asking why. One whose
 * volume image is known to be gone stays so; any other is held out.
 * @param {string} folderId
 */
function notMounted(folderId) {
  heldOutUnlessGone(folderId);
}

/**
 * Records a folder of an app whose specification this node cannot read, which the
 * monitor pass does not reach. One whose volume image is known to be gone stays so;
 * any other is held out.
 * @param {string} folderId
 */
function specUnreadable(folderId) {
  heldOutUnlessGone(folderId);
}

/**
 * Records a folder that has turned writable: everything this node held of it is
 * published, so it has nothing left to claim.
 * @param {string} folderId
 */
function sending(folderId) {
  globalState.folderStates.set(folderId, { state: FolderState.NO_CLAIM });
}

/**
 * Records a folder the monitor pass found a ready standby. A measurement it holds
 * stands; any other state becomes no claim, because a ready standby is not measured.
 * @param {string} folderId
 */
function settled(folderId) {
  if (globalState.folderStates.get(folderId)?.state === FolderState.MEASURED) return;
  globalState.folderStates.set(folderId, { state: FolderState.NO_CLAIM });
}

/**
 * What this node claims of a folder, as a peer reads it: a rankable claim, the no-claim
 * answer, or undefined for a folder it has not looked at or does not hold.
 * @param {string} folderId
 * @returns {{bytes: number, newestModified: number}|object|undefined}
 */
function claimOf(folderId) {
  const entry = globalState.folderStates.get(folderId);
  if (!entry || entry.state === FolderState.NOT_LOOKED_AT) return undefined;
  if (entry.state === FolderState.MEASURED) return { bytes: entry.bytes, newestModified: entry.newestModified };
  return NO_CLAIM_ANSWER;
}

/**
 * The receive-only part of the promoted-folders answer. A writable folder is in
 * none of its lists: a peer reads it from the folders this node sends. Every other
 * folder is in exactly one.
 * @param {Set<string>} writable The folders this node holds writable.
 * @returns {{holding: object, notLookedAt: string[], heldOut: string[], volumeGone: string[]}}
 */
function answer(writable) {
  const holding = {};
  const notLookedAt = [];
  const heldOutIds = [];
  const volumeGoneIds = [];
  globalState.folderStates.forEach((entry, folderId) => {
    if (writable.has(folderId)) return;
    if (entry.state === FolderState.NOT_LOOKED_AT) notLookedAt.push(folderId);
    else if (entry.state === FolderState.HELD_OUT) heldOutIds.push(folderId);
    else if (entry.state === FolderState.VOLUME_GONE) volumeGoneIds.push(folderId);
    else holding[folderId] = claimOf(folderId);
  });
  return {
    holding, notLookedAt, heldOut: heldOutIds, volumeGone: volumeGoneIds,
  };
}

module.exports = {
  FolderState,
  NO_CLAIM_ANSWER,
  answer,
  claimOf,
  heldOut,
  installed,
  measured,
  notMounted,
  receiveOnlyFolderIds,
  recreated,
  removed,
  sending,
  settled,
  specUnreadable,
  volumeGone,
};
