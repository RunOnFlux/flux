// Syncthing Folder State Machine - Manages folder sync transitions
const fs = require('node:fs');
const path = require('node:path');
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const appReconciler = require('./appReconciler');
const appUninstaller = require('../appLifecycle/appUninstaller');
const messageHelper = require('../messageHelper');
const syncthingService = require('../syncthingService');
const serviceHelper = require('../serviceHelper');
const { appsFolder } = require('../utils/appConstants');
const appTamperingDetectionService = require('../appTamperingDetectionService');
const { socketAddressesMatch, extractIp } = require('../utils/socketAddressUtils');
const fluxEventBus = require('../utils/fluxEventBus');
const { silenceVerdict, SilenceVerdict } = require('./peerFolderLiveness');
const {
  LEADER_CONFIRM_COUNT,
  SYNC_COMPLETE_PERCENTAGE,
  OPERATION_DELAY_MS,
  STALL_NUDGE_AFTER_MS,
  STALL_NUDGE_MAX_INTERVAL_MS,
  STALL_REMOVE_MIN_WINDOW_MS,
  STALL_REMOVE_MIN_NUDGES,
  ACTIVE_FOLDER_STATES,
} = require('./syncthingMonitorConstants');

const { isPathMounted } = require('../utils/volumeService');

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

// Per-folder mount-safety observation log gate: a persistent condition writes
// one line when first seen (re-logged at most every OBSERVATION_RELOG_MS while
// it lasts) and one recovery line when it clears - never a line per monitor
// pass. Process-lifetime state, bounded by the folder ids ever observed; it
// only dedupes log lines, so a stale entry for a removed app costs nothing.
// appId -> { observation, lastLoggedMs }
const mountSafetyObservations = new Map();
const OBSERVATION_RELOG_MS = 5 * 60 * 1000;

/**
 * Logs a mount-safety observation only when it changes for the folder (with a
 * periodic re-log while a non-ok observation persists) and logs recovery when
 * the folder returns to ok.
 * @param {string} appId - App/folder identifier
 * @param {string} observation - Stable key for the observed condition ('ok' when healthy)
 * @param {Function} [logFn] - Log method for the observation line (unused for 'ok')
 * @param {string} [message] - The observation line
 */
function noteSafetyObservation(appId, observation, logFn, message) {
  const now = monotonicMs();
  const previous = mountSafetyObservations.get(appId);
  if (previous && previous.observation === observation) {
    if (observation !== 'ok' && now - previous.lastLoggedMs >= OBSERVATION_RELOG_MS) {
      previous.lastLoggedMs = now;
      logFn(message);
    }
    return;
  }
  mountSafetyObservations.set(appId, { observation, lastLoggedMs: now });
  if (observation === 'ok') {
    if (previous && previous.observation !== 'ok') {
      log.info(`verifyFolderMountSafety - ${appId} recovered (was: ${previous.observation})`);
    }
    return;
  }
  logFn(message);
}

/**
 * Counts regular files under a directory (recursive, early exit at `limit`),
 * optionally skipping file names and directory subtrees. Pure fs - no child
 * process, no shell, and immune to the output-buffer truncation a
 * `find | wc` pipeline hits on huge trees (where a truncated listing could
 * make a safety guard misread a populated folder as empty).
 * @param {string} dirPath - Directory to scan
 * @param {number} limit - Stop counting once this many entries are found
 * @param {{excludeNames?: string[], excludeDirs?: string[], countDirs?: boolean}} options -
 *   Skips, and whether a (non-excluded) directory counts as content in its own
 *   right rather than only as a subtree to descend into.
 * @returns {Promise<number>} Number of entries found (capped at limit)
 */
async function countFilesUpTo(dirPath, limit, { excludeNames = [], excludeDirs = [], countDirs = false } = {}) {
  let count = 0;
  const pending = [dirPath];
  while (pending.length > 0 && count < limit) {
    const current = pending.pop();
    let entries;
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (error) {
      // unreadable/missing directory - skip it, like find does
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (excludeDirs.includes(entry.name)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        // A synced folder can legitimately hold nothing but empty directories:
        // syncthing indexes each directory entry (so globalBytes > 0) while the
        // tree contains no regular file. When asked, count the directory itself
        // as content so an all-directory folder is not misread as empty - the
        // real 2026-07-04 phantom_index_empty_disk false positive.
        if (countDirs) {
          count += 1;
          if (count >= limit) break;
        }
        pending.push(path.join(current, entry.name));
      } else if (entry.isFile() && !excludeNames.includes(entry.name)) {
        count += 1;
        if (count >= limit) break;
      }
    }
  }
  return count;
}

/**
 * Check if a directory has actual content (not just an empty mount point)
 * @param {string} dirPath - Directory path to check
 * @returns {Promise<{hasContent: boolean, fileCount: number}>} Content status
 */
async function checkDirectoryHasContent(dirPath) {
  const fileCount = await countFilesUpTo(dirPath, 100);
  return {
    hasContent: fileCount > 0,
    fileCount,
  };
}

/**
 * Like checkDirectoryHasContent, but counts entries inside the folder's SYNC
 * SCOPE - the same scope the syncthing index describes (globalBytes). Two
 * kinds of on-disk entry are NOT synced payload and are skipped so they cannot
 * mask a genuinely empty dataset: housekeeping that FluxOS/syncthing recreate
 * on any fresh or wiped volume (`.stignore`, the `.stfolder` marker), and the
 * `/backup` subtree `.stignore` tells syncthing to ignore. Everything else
 * counts - crucially INCLUDING directories, because the index counts each
 * directory entry too: a folder whose synced payload is only (empty)
 * directories has globalBytes > 0 with zero regular files, and a files-only
 * walk misread that as a phantom index over an empty disk (the 2026-07-04
 * false positive that stopped healthy, fully-synced apps and held them down).
 * A truly wiped disk keeps only the skipped housekeeping, so it still reads
 * empty and the phantom guard still fires.
 * @param {string} dirPath - Directory path to check
 * @returns {Promise<{hasContent: boolean, fileCount: number}>} Content status
 */
async function checkDirectoryHasSyncScopedContent(dirPath) {
  const fileCount = await countFilesUpTo(dirPath, 100, {
    excludeNames: ['.stignore'],
    excludeDirs: ['backup', '.stfolder'],
    countDirs: true,
  });
  return {
    hasContent: fileCount > 0,
    fileCount,
  };
}

/**
 * Verify that a Syncthing folder's mount is properly initialized
 * This is CRITICAL to prevent data loss when mounts are not ready after reboot
 * @param {string} appId - App ID (e.g., fluxwp_myapp)
 * @param {string} folderPath - Syncthing folder path
 * @returns {Promise<{isSafe: boolean, reason: string, isMounted: boolean, hasContent: boolean}>}
 */
async function verifyFolderMountSafety(appId, folderPath) {
  const result = {
    isSafe: true,
    reason: 'ok',
    isMounted: false,
    hasContent: false,
    fileCount: 0,
  };

  try {
    // Check 1: Does the base app directory exist?
    const baseDir = `${appsFolder}${appId}`;
    const baseDirExists = await fs.promises.stat(baseDir).then((stats) => stats.isDirectory()).catch(() => false);

    if (!baseDirExists) {
      result.isSafe = false;
      result.reason = 'base_directory_missing';
      noteSafetyObservation(appId, result.reason, log.warn, `verifyFolderMountSafety - ${appId} base directory does not exist: ${baseDir}`);
      await appTamperingDetectionService.recordEvent(appId, 'mount_vanished', `Base directory missing: ${baseDir}`);
      return result;
    }

    // Check 2: Is the base directory a mount point? (for loop-mounted volumes)
    result.isMounted = await isPathMounted(baseDir);

    // Check 3: Does the folder have actual content?
    const contentCheck = await checkDirectoryHasContent(folderPath);
    result.hasContent = contentCheck.hasContent;
    result.fileCount = contentCheck.fileCount;

    // An unmounted app dir is NEVER safe to sync, whatever it contains.
    // Content on the bare dir means writes already leaked onto the host
    // filesystem (e.g. a sync pull while the volume was unmounted) - letting
    // content buy a pass here is exactly how a stale sendreceive folder kept
    // broadcasting deletions to the healthy master (observed live 2026-07-01).
    if (!result.isMounted) {
      result.isSafe = false;
      result.reason = result.hasContent ? 'unmounted_with_content' : 'empty_unmounted_directory';
      noteSafetyObservation(appId, result.reason, log.error, `verifyFolderMountSafety - CRITICAL: ${appId} directory is not a mountpoint (${result.fileCount} file(s) present)! Missing loop mount.`);
      if (result.hasContent) {
        await appTamperingDetectionService.recordEvent(appId, 'mount_vanished', `App dir not mounted but holds ${result.fileCount} file(s) - data leaked onto the host filesystem`);
      }
      return result;
    }

    // Mounted but empty is legitimate (a folder the app never writes to, a
    // fresh volume awaiting its first sync) - note it once, allow it, and let
    // the sync machinery decide what emptiness means for this folder
    if (!result.hasContent) {
      noteSafetyObservation(appId, 'mounted_empty', log.warn, `verifyFolderMountSafety - ${appId} is mounted but has no content (0 files). Potential data loss risk.`);
    } else {
      noteSafetyObservation(appId, 'ok');
    }

    return result;
  } catch (error) {
    log.error(`verifyFolderMountSafety - Error checking ${appId}: ${error.message}`);
    result.isSafe = false;
    result.reason = 'check_failed';
    return result;
  }
}

/**
 * Full safety check for a folder that is (or is about to be) sendreceive.
 * On top of the mount check, detects a stale ("phantom") index over an empty
 * volume: the folder's global index claims data while the disk holds none.
 * In sendreceive, syncthing treats those missing files as local deletions and
 * broadcasts them, gutting the healthy peers (the deletion-propagation
 * failure mode observed live 2026-07-01). A legitimately empty folder
 * (globalBytes 0, e.g. a cold-start seed) does not trip this.
 * @param {string} appId - App ID (also the syncthing folder id)
 * @param {string} folderPath - Syncthing folder path
 * @returns {Promise<{isSafe: boolean, reason: string, isMounted: boolean, hasContent: boolean}>}
 */
async function verifySendReceiveFolderSafety(appId, folderPath) {
  const result = await verifyFolderMountSafety(appId, folderPath);
  if (!result.isSafe) return result;

  const syncStatus = await getFolderSyncCompletion(appId);
  if (!syncStatus || syncStatus.globalBytes === 0) return result;

  const dataCheck = await checkDirectoryHasSyncScopedContent(folderPath);
  if (!dataCheck.hasContent) {
    result.isSafe = false;
    result.reason = 'phantom_index_empty_disk';
    log.error(`verifySendReceiveFolderSafety - CRITICAL: ${appId} index claims ${syncStatus.globalBytes} bytes but the disk holds no synced files - stale index over an empty volume; sendreceive would broadcast deletions.`);
  }
  return result;
}

/**
 * Fix permissions on all mount directories for containers
 * Critical for synced data that may have wrong ownership
 * Fixes permissions on appdata and all additional mount points
 * @param {string} appId - App ID
 * @returns {Promise<void>}
 */
async function fixAppdataPermissions(appId) {
  try {
    // Fix permissions on entire app directory to cover appdata and all additional mounts
    // (appdata, logs, config, file mounts, etc.)
    const appPath = `${appsFolder}${appId}`;

    // Recursively set 777 permissions to allow any container user to write
    // This ensures containers running as any UID/GID can access their data
    // Covers both appdata (primary mount) and all additional mounts at the same level
    const chmod = await serviceHelper.runCommand('chmod', { runAsRoot: true, params: ['-R', '777', appPath] });
    if (chmod.error) throw chmod.error;
    log.info(`fixAppdataPermissions - Fixed permissions on ${appPath} (includes appdata and all mount points)`);
  } catch (error) {
    log.warn(`fixAppdataPermissions - Could not fix permissions for ${appId}: ${error.message}`);
    // Continue anyway - container might still work
  }
}

/**
 * Reads a folder's sync completion, and says which of the two ways it failed.
 *
 * "Syncthing says there is no such folder" is a finding about the data. "Syncthing
 * did not answer" is a finding about syncthing, and the caller that refuses a
 * backup must not report the second as the first - telling an operator their
 * instance has never synced, when what happened is that a daemon was restarting,
 * is a false statement about their data at the moment they are trying to protect
 * it.
 *
 * Only an HTTP status proves syncthing replied at all, and performRequest keeps
 * it in the error message, so that is what separates the two. Anything that is
 * not a plain 404 - a transport failure, a 500, an unreadable api key - is
 * unknown rather than absent, because none of them are the folder telling us
 * anything.
 *
 * @param {string} folderId - The Syncthing folder ID
 * @returns {Promise<{status: Object|null, reason: 'ok'|'absent'|'unknown'}>}
 */
async function probeFolderSyncCompletion(folderId) {
  try {
    const {
      globalBytes = 0, inSyncBytes = 0, state, receiveOnlyChangedFiles = 0,
    } = await syncthingService.getDbStatus(folderId);

    const syncPercentage = globalBytes > 0 ? (inSyncBytes / globalBytes) * 100 : 100;

    const status = {
      syncPercentage,
      globalBytes,
      inSyncBytes,
      state,
      // local additions/modifications in a receiveonly folder; invisible to the
      // completion metrics above (they only count cluster data)
      receiveOnlyChangedFiles,
      // An EMPTY global index (globalBytes 0) means "unknown / not yet synced",
      // never "done": a node holding the only copy before its peers reconnect
      // reads globalBytes 0, and syncPercentage defaults to 100 there (vacuous).
      // Gating on globalBytes > 0 stops the promotion gate from reverting (which
      // would delete the only copy) or promoting unverified data against an empty
      // global; such a folder falls through to the wait branch instead. The
      // leader/cold-start path (the legitimate empty-folder seed) is exempt and
      // handled separately above.
      isSynced: globalBytes > 0 && syncPercentage === SYNC_COMPLETE_PERCENTAGE,
    };

    return { status, reason: 'ok' };
  } catch (error) {
    // A 404 is syncthing answering that it holds no such folder. Anything else -
    // transport, a refused key, a malformed reply - leaves the folder's state
    // unknown, which is a different claim and must never read as absence.
    if (error.httpStatus === 404) {
      log.warn(`No syncthing folder ${folderId}`);
      return { status: null, reason: 'absent' };
    }
    log.warn(`Could not read sync status for folder ${folderId}: ${error.message}`);
    return { status: null, reason: 'unknown' };
  }
}

/**
 * The folder's sync status, or null when it cannot be read for any reason.
 *
 * Callers that only need "do I have a usable reading" keep this contract: both
 * failures are equally unusable to them, and both must be treated conservatively.
 * Callers that report the failure to a person want probeFolderSyncCompletion.
 *
 * @param {string} folderId - The Syncthing folder ID
 * @returns {Promise<Object|null>} Sync status object or null if unavailable
 */
async function getFolderSyncCompletion(folderId) {
  const { status } = await probeFolderSyncCompletion(folderId);
  return status;
}


/**
 * Determines if this node should be the designated leader for starting an app first.
 * Uses deterministic leader election to prevent race conditions.
 *
 * @param {Array<Object>} allPeersList - List of ALL peers including the current node
 * @param {string} localSocketAddr - The current node's IP address
 * @returns {boolean} True if this node is the designated leader
 */
// Lowest IP among the holders - the deterministic pick every node computes
// identically. Identity only: it says nothing about whether that node still exists.
function lowestIpHolder(allPeersList) {
  const sorted = [...(allPeersList || [])].sort((a, b) => {
    if (a.ip < b.ip) return -1;
    if (a.ip > b.ip) return 1;
    return 0;
  });
  return sorted[0]?.ip ?? null;
}

function isDesignatedLeader(allPeersList, localSocketAddr, deferToRunningPeers = true) {
  if (!allPeersList || allPeersList.length === 0) {
    return false; // Be conservative - wait for peers to broadcast
  }

  // Defer to a peer that is ALREADY running rather than seed - UNLESS this is a safe
  // cold start (deferToRunningPeers=false: no peer serves the data AND this node holds
  // none of its own). runningSince is broadcast on PLACEMENT, not liveness, so on a fresh
  // multi-node deploy every holder carries it before anyone has started; deferring on
  // runningSince alone would make every node defer to every other and NOBODY would seed
  // (the cold-start standoff - the app never starts). On a true cold start we fall through
  // to the deterministic election below and let exactly one node (lowest IP) seed.
  const runningPeers = allPeersList.filter((peer) => peer.runningSince && !socketAddressesMatch(peer.ip, localSocketAddr));
  if (deferToRunningPeers && runningPeers.length > 0) {
    return false; // defer - a real source is serving, or we hold data to protect
  }

  // Special case: single peer deployment
  if (allPeersList.length === 1 && socketAddressesMatch(allPeersList[0].ip, localSocketAddr)) {
    return true;
  }

  // Deterministic leader election by IP only. IP is globally consistent - every node
  // sees every peer's IP identically - and clock-free, so all nodes independently agree
  // on the same lowest-IP seed. broadcastedAt is NOT a safe key here: it is the latest
  // re-broadcast time and propagates with per-node delay, so on a fresh cluster each
  // node can momentarily order the timestamps differently and every node elects itself
  // (split-brain). The lowest IP is the single, agreed cold-start seed.
  const leader = lowestIpHolder(allPeersList);
  const isLeader = socketAddressesMatch(leader, localSocketAddr);

  return isLeader && allPeersList.some((peer) => socketAddressesMatch(peer.ip, localSocketAddr));
}

/**
 * Whether this node can show that a holder is gone, rather than merely silent to
 * it. Same question the promotion check asks, one step earlier: the election picks
 * by identity and has no liveness in it, so a holder that dies keeps being elected
 * by everyone else and they defer to it until its location broadcast expires -
 * 125 minutes, with the app down throughout.
 *
 * Answered from this node's own connectivity, which is the only half it can know:
 * a node still trading pings with the fleet is watching one holder fall over, a
 * node whose peers have all gone quiet is the one that fell over and must keep
 * deferring - the holder is very likely still serving on the other side of the
 * split.
 *
 * "Gone" means silent, and only silent. A holder that answers - even to say it
 * cannot answer this question - is alive, and dropping a live holder out of the
 * election is the one thing this must never do: every survivor would then pick the
 * next IP and promote alongside a holder that is still writing.
 *
 * And silence alone is still not enough: gone requires evidence. The verdict
 * needs this node's own syncthing to have been asked about the holder's device
 * and answered that it is not connected. A device this node cannot ask about
 * proves nothing, and a proof of nothing keeps the holder.
 *
 * @param {string} appId
 * @param {string} holderIp
 * @returns {Promise<boolean>}
 */
async function holderIsGone(appId, holderIp, liveness) {
  const answer = await liveness.read(holderIp);
  if (answer.reachable) return false;

  const verdict = await silenceVerdict(appId, holderIp, liveness);
  if (verdict === SilenceVerdict.CONNECTION_ALIVE) {
    log.info(`holderIsGone - ${extractIp(holderIp)}'s API is silent, but this node's syncthing still holds a live connection to it for ${appId}; it is restarting, not gone`);
    fluxEventBus.publish('syncthing:holderRetained', { folder: appId, holder: holderIp, reason: 'connectionAlive' });
    return false;
  }
  if (verdict === SilenceVerdict.NO_EVIDENCE) {
    log.info(`holderIsGone - ${extractIp(holderIp)} is unreachable, but this node cannot ask its own syncthing about it for ${appId}; gone requires evidence, keeping it`);
    fluxEventBus.publish('syncthing:holderRetained', { folder: appId, holder: holderIp, reason: 'noEvidence' });
    return false;
  }
  if (verdict === SilenceVerdict.LOCALLY_ISOLATED) {
    const { responding, total } = liveness.localConnectivity();
    log.info(`holderIsGone - ${extractIp(holderIp)} is unreachable, but only ${responding} of this node's ${total} peers are answering; treating this node as the isolated one`);
    return false;
  }
  return true;
}

/**
 * The holder list with the elected leader removed when this node can show it is
 * gone. One holder per pass: if the next-lowest is also gone, the following pass
 * drops that one too, so a run of failures converges without a loop here. Every
 * survivor drops the same holder and then picks the same lowest IP of what is
 * left, so they agree without coordinating, and the promotion check still catches
 * any second node that acts on it.
 *
 * @param {string} appId
 * @param {Array<Object>} allPeersList
 * @param {string} localSocketAddr
 * @param {Object} liveness This pass's peer view
 * @returns {Promise<Array<Object>>}
 */
async function holderListExcludingDead(appId, allPeersList, localSocketAddr, liveness) {
  const leader = lowestIpHolder(allPeersList);
  if (!leader || socketAddressesMatch(leader, localSocketAddr)) return allPeersList;
  if (!await holderIsGone(appId, leader, liveness)) return allPeersList;
  log.warn(`holderListExcludingDead - elected holder ${leader} is gone and this node's own connectivity is healthy; re-electing without it`);
  fluxEventBus.publish('syncthing:holderExcluded', { folder: appId, holder: leader });
  return allPeersList.filter((peer) => !socketAddressesMatch(peer.ip, leader));
}

/**
 * The first peer found already holding a writable copy of this folder, or null.
 *
 * Two answers block, for different reasons, and the difference is the whole point
 * of asking:
 *
 *   UNREACHABLE blocks only while this node cannot show that the silence is the
 *   peer's and not its own. "That peer is dead" and "I have been cut off" look
 *   identical from the failed request, and they need opposite answers: the first
 *   means promote, the second means do not. The node cannot prove a peer is alive
 *   without agreement, but it can answer whether IT is - a node still exchanging
 *   pings with the rest of the fleet is watching one node fall over, while a node
 *   whose peers have all gone quiet is the one that fell over. Once that is
 *   established the peer is treated as gone, because a dead node must never strand
 *   an app with no writable copy anywhere.
 *
 *   UNREADY does block, with no bound and none needed. The peer is alive and
 *   saying it cannot answer yet, which is a live node that may already be holding.
 *   It resolves itself: the peer finishes its first monitor pass and answers, or
 *   it stops responding and becomes the unreachable case above. A peer that stays
 *   alive and permanently unreadable is the one case that waits indefinitely, and
 *   waiting is right there - promoting because we gave up is exactly the second
 *   writer this exists to prevent, and a stalled app is visible where diverged
 *   data is not.
 *
 *   UNANSWERABLE does NOT block, and must not. A peer that predates this endpoint
 *   is alive and cannot be asked, ever - it will not finish a pass and start
 *   answering, so the unbounded wait UNREADY earns by resolving itself is not
 *   earned here. Blocking on it would hold promotion open until somebody upgrades
 *   that node: on a cold start every other holder defers to the same lowest IP, so
 *   one un-upgraded peer would stop the app starting anywhere. This check simply
 *   cannot cover a peer that cannot answer, and the honest reading of that is that
 *   the folder gets the behaviour it had before this check existed - decided by the
 *   election alone - rather than a guess dressed as a guarantee. Peers that CAN
 *   answer are still checked, so the cover grows as the fleet upgrades and is
 *   complete once it has.
 *
 * It narrows the window rather than closing it: two nodes that both ask before
 * either promotes still both promote. Closing that needs the consensus-grounded
 * election the residual-limitation note above describes.
 *
 * @param {string} appId Folder id
 * @param {Array} peers App location entries
 * @param {string} localSocketAddr This node's socket address
 * @param {Object} liveness This pass's peer view
 * @returns {Promise<{ip: string, reason: string}|null>} The blocking peer, or null
 */
async function findPeerBlockingPromotion(appId, peers, localSocketAddr, liveness) {
  const others = (peers || []).filter((peer) => peer?.ip && !socketAddressesMatch(peer.ip, localSocketAddr));
  if (!others.length) return null;

  const answers = await Promise.all(others.map(
    async (peer) => ({ ip: peer.ip, ...await liveness.read(peer.ip) }),
  ));

  const holder = answers.find((answer) => answer.reachable && answer.ready && answer.folders.includes(appId));
  if (holder) return { ip: holder.ip, reason: 'already holds the writable copy' };
  const unready = answers.find((answer) => answer.reachable && answer.answerable && !answer.ready);
  if (unready) return { ip: unready.ip, reason: 'has not determined its folder state yet' };

  // Recorded, not blocked - see UNANSWERABLE above. Worth a line of its own so a
  // promotion made without full cover is visible as that, and so the remedy reads
  // as "upgrade that node" rather than "debug its monitor".
  const unanswerable = answers.find((answer) => answer.reachable && !answer.answerable);
  if (unanswerable) {
    log.info(`findPeerBlockingPromotion - ${appId}: ${extractIp(unanswerable.ip)} is alive but cannot be asked which folders it holds; promoting on the election alone, as this node would have before this check existed`);
  }

  const unreachable = answers.find((answer) => !answer.reachable);
  if (unreachable) {
    // Whose silence is it? A node still trading pings with the fleet is watching a
    // peer die; a node whose own peers have gone quiet is the one that is cut off,
    // and must not promote over a holder that is very likely still running on the
    // other side of the split.
    const { connected, responding, total } = liveness.localConnectivity();
    if (!connected) {
      return {
        ip: unreachable.ip,
        reason: `is unreachable, and only ${responding} of this node's ${total} peers are answering - it cannot tell that peer apart from its own isolation`,
      };
    }
  }
  return null;
}

/**
 * Handle first run scenario for an app/component
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function handleFirstRun(params) {
  const {
    appId,
    syncFolder,
    syncthingFolder,
    receiveOnlySyncthingAppsCache,
  } = params;

  if (!syncFolder) {
    // No sync folder exists - clean install. Declare the stop + local appdata clear
    // to the reconciler (the sole container/data actuator) so the wipe runs inside
    // its per-key single-flight and a start can never race it (the S1 data-loss
    // window the old imperative stop+rm-rf left open).
    log.info(`handleFirstRun - First run, no sync folder - requesting stop + clean of ${appId}`);
    syncthingFolder.type = 'receiveonly';
    const cache = { numberOfExecutions: 1 };

    // Set cache BEFORE requesting the reset to prevent re-processing as "new"
    receiveOnlySyncthingAppsCache.set(appId, cache);

    appReconciler.requestStopAndClearData(appId, 'syncthing first-run clean install');

    return { syncthingFolder, cache };
  }

  // Sync folder exists - check container status
  log.info('handleFirstRun - First run, sync folder exists - checking container status');
  let containerRunning = false;

  try {
    const containerInspect = await dockerService.dockerContainerInspect(appId);
    containerRunning = containerInspect.State.Running;
    log.info(`handleFirstRun - ${appId} running status: ${containerRunning}`);
  } catch (error) {
    log.warn(`handleFirstRun - Could not inspect ${appId}: ${error.message}`);
  }

  if (containerRunning) {
    // App is running - this means FluxOS restart, not computer restart
    // Skip processing - keep existing state
    log.info(`handleFirstRun - ${appId} is running, FluxOS restart detected, keeping existing state`);
    const cache = { restarted: true };
    return { syncthingFolder, cache };
  }

  // Container is stopped - computer was restarted
  // Set to receiveonly mode to wait for sync before starting
  log.info(`handleFirstRun - ${appId} is stopped, computer restart detected, setting to receiveonly mode`);
  syncthingFolder.type = 'receiveonly';
  const cache = {
    restarted: false,
    numberOfExecutions: 1,
  };

  return { syncthingFolder, cache };
}

/**
 * Handle skipped app on second encounter
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function handleSkippedAppSecondEncounter(params) {
  const {
    appId,
    syncthingFolder,
    receiveOnlySyncthingAppsCache,
  } = params;

  log.info(`handleSkippedAppSecondEncounter - ${appId} was skipped on first encounter, now processing as new app`);
  syncthingFolder.type = 'receiveonly';
  const cache = { numberOfExecutions: 1 };

  // Set cache BEFORE requesting the reset to prevent re-processing as "new"
  receiveOnlySyncthingAppsCache.set(appId, cache);

  // stop + local appdata clear is declared to the reconciler (the sole actuator)
  appReconciler.requestStopAndClearData(appId, 'syncthing skipped-app second encounter');

  return { syncthingFolder, cache };
}

/**
 * Check if any remote peers have this folder in sendreceive mode and fully synced
 * @param {string} folderId - Syncthing folder ID
 * @returns {Promise<boolean>} True if at least one peer has folder in sendreceive and synced
 */
async function checkIfPeersAreSynced(folderId) {
  try {
    // Get all Syncthing folders
    const config = await syncthingService.getConfig();

    const folder = config.folders?.find((f) => f.id === folderId);
    if (!folder) {
      return false;
    }

    // Check if folder exists in sendreceive on at least one device
    if (folder.type === 'sendreceive') {
      // We ourselves are in sendreceive, peers must be synced
      return true;
    }

    return Boolean(await findSyncedPeer(folderId));
  } catch (error) {
    log.error(`checkIfPeersAreSynced - Error checking peers for ${folderId}: ${error.message}`);
    return false;
  }
}

/**
 * The first connected peer that demonstrably holds everything in this folder.
 *
 * Unlike checkIfPeersAreSynced this never answers from our OWN folder mode: a
 * caller about to delete its local copy needs a peer that holds the data, and
 * "we are sendreceive" says nothing about where else the data lives.
 * @param {string} folderId - Syncthing folder ID
 * @returns {Promise<{deviceID: string, globalBytes: number}|null>} The peer, or
 *   null when no peer can be shown to hold this folder.
 */
async function findSyncedPeer(folderId) {
  try {
    const configResponse = await syncthingService.getConfig({}, null);
    if (!configResponse || configResponse.status !== 'success') {
      return null;
    }

    const folder = configResponse.data.folders?.find((f) => f.id === folderId);
    if (!folder) {
      return null;
    }

    const { devices = [] } = folder;
    if (devices.length === 0) {
      return null;
    }

    // Every folder's device list BEGINS with this node's own device - see
    // syncthingMonitorHelpers, `const devices = [{ deviceID: myDeviceId }]` -
    // and this walk had no self-exclusion, so it asked /rest/db/completion
    // about the local device first. Our own copy trivially reports completion
    // 100 with globalBytes > 0.
    //
    // What separates "a peer holds it" from "I hold it" today is only that
    // syncthing does not report remoteState 'valid' for the local device: an
    // incidental property of a field read defensively below, with a default,
    // rather than an intention. Every other device walk in this codebase
    // excludes local explicitly. If that assumption were ever wrong,
    // canSafelyRemoveApp would return safe for a single-copy stateful app on
    // the strength of the copy it is about to delete.
    const localDeviceId = await syncthingService.getDeviceId().catch(() => null);

    // Get device completion status for each remote device
    // eslint-disable-next-line no-restricted-syntax
    for (const device of devices) {
      // A device id this node could not establish excludes nothing, which is
      // the safe direction: the completion checks below still have to pass.
      if (localDeviceId && device.deviceID === localDeviceId) {
        // eslint-disable-next-line no-continue
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const { completion = 0, globalBytes = 0, remoteState = 'unknown' } = await syncthingService.getDbCompletion({
          folder: folderId,
          device: device.deviceID,
        });
        // A peer is a safe source only if it is CONNECTED (remoteState 'valid'),
        // reports 100%, AND actually holds data:
        // - db/completion is computed from the peer's last-known index, so a dead or
        //   offline peer still reports completion 100. Trusting that stale figure
        //   turns a source-node reboot into followers deleting their partial copies.
        //   remoteState is the connectivity discriminator ('valid' iff connected);
        //   when absent, there is no evidence and the peer must not be trusted.
        // - Syncthing reports completion 100 for an empty folder (globalBytes 0) too,
        //   so without the globalBytes check a peer that synced empty/wrong data from
        //   a bad seed would falsely satisfy "peers are synced" and we would remove
        //   the good local copy in favour of an empty one (data loss).
        if (remoteState === 'valid' && completion === 100 && globalBytes > 0) {
          log.info(`findSyncedPeer - Found synced peer for ${folderId}: device ${device.deviceID.substring(0, 7)}... at ${completion}% (${globalBytes} bytes, connected)`);
          return { deviceID: device.deviceID, globalBytes };
        }
        if (completion === 100 && remoteState !== 'valid') {
          log.warn(`findSyncedPeer - ${folderId}: device ${device.deviceID.substring(0, 7)}... reports 100% but is not connected (remoteState ${remoteState}); stale index, not a synced source`);
        } else if (completion === 100) {
          log.warn(`findSyncedPeer - ${folderId}: device ${device.deviceID.substring(0, 7)}... reports 100% but 0 bytes (empty); not treating it as a synced source`);
        }
      } catch (deviceError) {
        // a failed completion read silently skipping the device would read as
        // "peer not synced" with zero diagnostics - fail-safe, but loud
        log.warn(`findSyncedPeer - ${folderId}: completion read for device ${device.deviceID.substring(0, 7)}... failed: ${deviceError.message}`);
      }
    }

    return null;
  } catch (error) {
    log.error(`findSyncedPeer - Error checking peers for ${folderId}: ${error.message}`);
    return null;
  }
}

/**
 * Nudge a folder's devices: pause then resume each device the folder is shared
 * with. The reconnect forces a fresh index exchange, which re-arms a dormant
 * puller (failed-pull retry backoff, or the inert no-retry state where a failed
 * pull never retries again - verified live; recovery takes ~30s). This is the
 * surgical version of the only useful thing a syncthing process restart did,
 * without dropping every other folder's transfers node-wide.
 * @param {string} folderId - Syncthing folder ID
 */
async function nudgeFolderDevices(folderId) {
  try {
    const config = await syncthingService.getConfig();
    const folder = config.folders?.find((f) => f.id === folderId);
    if (!folder) return;
    // eslint-disable-next-line no-restricted-syntax
    for (const device of folder.devices || []) {
      let paused = false;
      try {
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.systemPause(device.deviceID);
        paused = true;
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(OPERATION_DELAY_MS);
      } catch (error) {
        log.warn(`nudgeFolderDevices - ${folderId}: pause of device ${device.deviceID.substring(0, 7)} failed: ${error.message}`);
      } finally {
        // Resume is mandatory once a pause landed: the pause dropped this device's
        // connection (device-level, source-confirmed), so leaving it paused keeps
        // it disconnected and silently degrades every folder shared with it until
        // some unrelated later nudge happens to resume it. A failed resume is the
        // genuinely dangerous outcome - log it loudly.
        if (paused) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await syncthingService.systemResume(device.deviceID);
          } catch (error) {
            log.error(`nudgeFolderDevices - ${folderId}: RESUME of device ${device.deviceID.substring(0, 7)} FAILED - device left paused (its connection stays suspended): ${error.message}`);
          }
        }
      }
    }
  } catch (error) {
    log.warn(`nudgeFolderDevices - ${folderId}: ${error.message}`);
  }
}

/**
 * Handle receive-only to send-receive transition
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function handleReceiveOnlyTransition(params) {
  const {
    appId,
    cache,
    runningAppList,
    localSocketAddr,
    containerDataFlags,
    syncthingFolder,
    liveness,
  } = params;

  log.info(`handleReceiveOnlyTransition - ${appId} in cache and not restarted, processing receive-only logic`);

  const folderPath = syncthingFolder.path || `${appsFolder}${appId}/appdata`;

  // Whether any CONNECTED peer genuinely holds the data. Gates the election (a true
  // cold start - nobody serving - must still elect one seed instead of standing off)
  // and is reused by the stall ladder below, so it is computed once per cycle here.
  const aPeerHasData = await checkIfPeersAreSynced(appId);
  // Read the local sync status once here (reused by the stall ladder below). The intent,
  // folded into deferToRunningPeers below, is that only a node holding NOTHING - no
  // global, no synced bytes, no receive-only local changes - cold-start SEEDs (promotes
  // an empty folder without a sync check); a node holding ANY data instead defers to a
  // connected source, and an unreadable status (null) counts as "holds data". Seeding or
  // promoting an empty global otherwise is the B1 hazard (promote unverified data, or
  // db/revert deletes the only copy). NOTE this intent holds only while a running peer
  // exists to defer to - see the RESIDUAL LIMITATION on the seed below for where it stops.
  const syncStatus = await getFolderSyncCompletion(appId);
  const folderIsEmpty = !!syncStatus && syncStatus.globalBytes === 0
    && syncStatus.inSyncBytes === 0 && (syncStatus.receiveOnlyChangedFiles || 0) === 0;
  // Designated-leader election, debounced: require leadership to hold for
  // LEADER_CONFIRM_COUNT consecutive cycles, so a single transient peer-visibility blip
  // doesn't flip a follower to leader. Defer to a running peer UNLESS this is a true,
  // safe cold start (no peer serving AND this node holds no data) - then elect one seed.
  // The election picks by identity and carries no liveness, so a holder that dies
  // keeps winning and every survivor defers to it until its location broadcast
  // expires - 125 minutes with the app down. Dropped from the list here, before the
  // pick, when this node can show the holder is gone rather than merely silent to it.
  const electionList = await holderListExcludingDead(appId, runningAppList, localSocketAddr, liveness);
  const electedLeader = isDesignatedLeader(electionList, localSocketAddr, aPeerHasData || !folderIsEmpty);
  // The floor holderIsGone asks of a silent holder, asked of this node before
  // its own win can count: a node whose peers have gone quiet is the one that
  // fell over, and a win it confirms in that state seeds the app on a
  // partition's minority side while the majority defers to its IP. Isolation
  // resets the streak rather than pausing it, so a heal is followed by
  // LEADER_CONFIRM_COUNT clean passes like any other blip.
  const { connected } = liveness.localConnectivity();
  cache.leaderStreak = electedLeader && connected ? (cache.leaderStreak || 0) + 1 : 0;
  const isLeader = electedLeader && cache.leaderStreak >= LEADER_CONFIRM_COUNT;
  // Withdrawn on every unpromoted pass, so a lost election drops the claim
  // and the intent behind it. It is raised again only where the promotion is
  // APPLIED - the state machine records intent at the last gate, and the
  // monitor flips it once the folder batch lands in syncthing.
  // masterSlaveApps reads designatedLeader to skip the primary-selection
  // index stagger, so it has to mean "the folder is writable", not "won the
  // vote" and not "promotion decided".
  cache.designatedLeader = false;
  cache.designationPending = false;

  // RESIDUAL LIMITATION (architectural - this election is a heuristic, not consensus):
  // a confirmed leader is the cold-start seed and flips to sendreceive WITHOUT a sync
  // check - it cannot verify against a source because it IS the source. The
  // "hold data -> don't seed" protection is enforced ONLY through the running-peer proxy:
  // deferToRunningPeers makes us defer just when a peer carries runningSince (broadcast on
  // placement). So with NO running peer, a node holding data can still win the IP election
  // and seed; and a peer holding NEWER data while DISCONNECTED is not "serving" and an
  // empty local folder cannot know of it, so a fresh seed can win over that peer's data
  // when it returns. The root cause is that electing by gossip + lowest-IP guarantees
  // neither a single master under partition (split-brain - the reason this path is now
  // IP-only) nor that the seed holds the newest data. Reachability is low - every running
  // node broadcasts runningSince, so an empty runningPeers means this node is effectively
  // alone. Properly closing it needs a consensus-grounded election (a deterministic
  // candidate over the on-chain confirmed node set + a data-aware quorum lease that
  // subsumes the data-version check) - a separate, proposed redesign, out of scope here.
  if (isLeader) {
    // The seed flip below runs WITHOUT a sync check, and that is only sound when
    // there is nothing to lose: an empty folder (the cold start this election
    // exists for) or a fully synced copy (a survivor taking over). A node can
    // reach a confirmed designation MID-SYNC - its source dropped out of the
    // election as provably gone and the list collapsed to itself - and promoting
    // there publishes a partial copy as the truth: the files it has not fetched
    // yet become deletions on every peer the moment a source returns. A leader
    // holding a partial copy therefore waits, receiveonly - either the sync
    // completes against a returning source, or the stall ladder decides the data
    // question. An unreadable status counts as partial: it cannot show there is
    // nothing to lose.
    if (!folderIsEmpty && !(syncStatus && syncStatus.isSynced)) {
      log.info(`handleReceiveOnlyTransition - ${appId} is the confirmed designated leader but holds a partial copy (${syncStatus ? `${syncStatus.syncPercentage.toFixed(2)}% synced` : 'sync status unreadable'}); staying receiveonly until synced`);
      syncthingFolder.type = 'receiveonly';
      return { syncthingFolder, cache };
    }
    log.info(`handleReceiveOnlyTransition - ${appId} is the designated leader (elected from ${runningAppList.length} peers, confirmed ${cache.leaderStreak}x), starting immediately`);

    // Winning the election is not the same as being the first to win it. Each node
    // decides from its own view of the holder list, and those views fill in at
    // different moments: the first-placed node is briefly the only holder it knows
    // of and seeds on that basis, which is correct - somebody has to seed an empty
    // folder or the app never starts. A node that can see further then wins the
    // tiebreak among the holders it can see and seeds too, and neither revisits it,
    // because a promoted folder never re-enters this election. So the last check
    // before promoting is whether somebody already has.
    const blocker = await findPeerBlockingPromotion(appId, runningAppList, localSocketAddr, liveness);
    if (blocker) {
      log.info(`handleReceiveOnlyTransition - ${appId} won the election but ${blocker.ip} ${blocker.reason}; staying receiveonly`);
      syncthingFolder.type = 'receiveonly';
      return { syncthingFolder, cache };
    }

    // A folder must pass the sendreceive safety verification BEFORE it ever
    // flips - the seed included. An empty cold-start folder passes (empty index
    // over an empty disk); an unmounted dir, or a stale index claiming bytes
    // over an empty volume, must never seed: sendreceive would broadcast the
    // missing files as deletions.
    const seedSafety = await verifySendReceiveFolderSafety(appId, folderPath);
    if (!seedSafety.isSafe) {
      log.warn(`handleReceiveOnlyTransition - ${appId} elected leader but not safe to seed (${seedSafety.reason}); staying receiveonly`);
      syncthingFolder.type = 'receiveonly';
      return { syncthingFolder, cache };
    }

    // Every gate passed - but deciding the promotion is not applying it. The
    // designation masterSlaveApps reads has to mean "the folder IS writable",
    // and the type below reaches syncthing only when the monitor applies this
    // pass's folder batch - so the claim is recorded as intent here, and the
    // monitor raises designatedLeader once the apply lands. Raising it now
    // would let the container start against a folder still receiveonly for as
    // long as the apply takes.
    cache.designationPending = true;

    // Fix permissions before changing to sendreceive - ensures correct ownership for synced data
    await fixAppdataPermissions(appId);

    syncthingFolder.type = 'sendreceive';

    if (containerDataFlags.includes('r')) {
      log.info(`handleReceiveOnlyTransition - requesting start of ${appId} (leader)`);
      appReconciler.setControllerDesired(appId, 'running', 'syncthing leader start');
    }

    cache.restarted = true;
    return { syncthingFolder, cache };
  }

  // Not the leader - syncStatus already read above
  syncthingFolder.type = 'receiveonly';
  cache.numberOfExecutions = (cache.numberOfExecutions || 0) + 1;

  if (syncStatus) {
    cache.statusUnreadableSince = null; // status readable again - reset the unreadable timer

    log.info(
      `handleReceiveOnlyTransition - ${appId} sync status: ${syncStatus.syncPercentage.toFixed(2)}% `
      + `(${syncStatus.inSyncBytes}/${syncStatus.globalBytes} bytes), `
      + `state: ${syncStatus.state}, executions: ${cache.numberOfExecutions}`,
    );

    // Synced -> candidate for sendreceive. But completion metrics only count CLUSTER
    // data: local additions in a receiveonly folder leave needBytes 0 / completion 100,
    // and promoting would broadcast those local changes cluster-wide. Verify the folder
    // is clean first; if not, revert the local changes (db/revert undoes local edits in
    // a receiveonly folder) and promote on a later cycle once verifiably clean. The
    // leader path above is exempt by design - the leader's local data IS the seed.
    if (syncStatus.isSynced && syncStatus.receiveOnlyChangedFiles > 0) {
      log.warn(`handleReceiveOnlyTransition - ${appId} is synced but the receive-only folder has ${syncStatus.receiveOnlyChangedFiles} locally changed item(s); reverting local changes instead of promoting (promotion would propagate them to the cluster)`);
      try {
        // dataOrThrow: dbRevert answers in-band; without it this catch is
        // dead code and a failed revert reads as reverted
        messageHelper.dataOrThrow(await syncthingService.dbRevert(appId));
      } catch (error) {
        log.error(`handleReceiveOnlyTransition - revert of local changes for ${appId} failed: ${error.message}`);
      }
      return { syncthingFolder, cache };
    }
    if (syncStatus.isSynced) {
      // Same pre-flip verification as the seed above: completion metrics come
      // from the index, and an index can be stale - promotion requires the disk
      // to actually hold the data the index claims.
      const promoteSafety = await verifySendReceiveFolderSafety(appId, folderPath);
      if (!promoteSafety.isSafe) {
        log.warn(`handleReceiveOnlyTransition - ${appId} is synced but not safe to promote (${promoteSafety.reason}); staying receiveonly`);
        return { syncthingFolder, cache };
      }
      log.info(`handleReceiveOnlyTransition - ${appId} is synced (${syncStatus.syncPercentage.toFixed(2)}%), switching to sendreceive`);
      await fixAppdataPermissions(appId);
      syncthingFolder.type = 'sendreceive';
      if (containerDataFlags.includes('r')) {
        log.info(`handleReceiveOnlyTransition - requesting start of ${appId} (synced)`);
        appReconciler.setControllerDesired(appId, 'running', 'syncthing synced start');
      }
      cache.restarted = true;
      return { syncthingFolder, cache };
    }

    // Not synced. We must NEVER start on unsynced data: going sendreceive would
    // propagate an inconsistent state to peers. While bytes are moving (block-
    // granular accounting) or the folder state is active (e.g. a long
    // sync-preparing phase), syncthing is working - wait. Flat bytes while idle
    // means no blocks are arriving; the causes need DIFFERENT responses:
    //   - no CONNECTED synced source (offline source, partition): wait - syncthing
    //     resumes by itself when the source returns; acting destroys a healthy copy.
    //   - source available but the puller is dormant (failed-pull retry backoff up
    //     to ~1h, or the inert no-retry state): nudge - device pause/resume forces
    //     a reconnect + index re-exchange, which re-arms the puller in seconds.
    //   - sustained evidence (connected synced source, repeated nudges over a
    //     minimum window, zero progress): this node provably cannot ingest the
    //     data - remove locally, the data is preserved on the synced peer.
    const now = Date.now();
    if (cache.lastProgressBytes === undefined || syncStatus.inSyncBytes !== cache.lastProgressBytes) {
      cache.lastProgressBytes = syncStatus.inSyncBytes;
      cache.lastProgressAt = now;
      cache.nudgeCount = 0;
      cache.evidenceSince = null;
      cache.lastNudgeAt = null;
      return { syncthingFolder, cache };
    }

    if (ACTIVE_FOLDER_STATES.includes(syncStatus.state)) {
      return { syncthingFolder, cache };
    }

    if (now - cache.lastProgressAt < STALL_NUDGE_AFTER_MS) {
      return { syncthingFolder, cache };
    }

    if (!aPeerHasData) {
      log.warn(`handleReceiveOnlyTransition - ${appId} idle with no sync progress and no CONNECTED synced peer; waiting (syncthing auto-resumes when a source returns)`);
      return { syncthingFolder, cache };
    }

    cache.evidenceSince = cache.evidenceSince || now;
    const nudgeCount = cache.nudgeCount || 0;
    const nudgeInterval = Math.min(STALL_NUDGE_AFTER_MS * 2 ** nudgeCount, STALL_NUDGE_MAX_INTERVAL_MS);
    const nudgeDue = !cache.lastNudgeAt || now - cache.lastNudgeAt >= nudgeInterval;
    if (!nudgeDue) {
      return { syncthingFolder, cache };
    }

    if (nudgeCount >= STALL_REMOVE_MIN_NUDGES && now - cache.evidenceSince >= STALL_REMOVE_MIN_WINDOW_MS) {
      log.error(`handleReceiveOnlyTransition - ${appId}: ${nudgeCount} nudges over ${Math.round((now - cache.evidenceSince) / 60000)}m with zero progress and a connected synced peer; this node cannot ingest the data - removing locally (data preserved on peers)`);
      // the whole app, by its bare main name: a component identifier here routes
      // removeAppLocally into a component-scoped removal that leaves the app's
      // installed-DB row behind (still broadcast as running, never re-evaluated)
      const mainAppName = appId.split('_')[1] || appId;
      try {
        await appUninstaller.removeAppLocally(mainAppName, null, true, false, true);
      } catch (error) {
        log.error(`handleReceiveOnlyTransition - Failed to remove ${mainAppName}: ${error.message}`);
      }
      cache.restarted = true;
      return { syncthingFolder, cache };
    }

    log.warn(`handleReceiveOnlyTransition - ${appId} idle with no sync progress for ${Math.round((now - cache.lastProgressAt) / 60000)}m and a connected synced peer; nudging the folder devices (pause/resume #${nudgeCount + 1})`);
    await nudgeFolderDevices(appId);
    cache.nudgeCount = nudgeCount + 1;
    cache.lastNudgeAt = now;
    return { syncthingFolder, cache };
  } else {
    // Could not read the folder's sync status, so we can verify NOTHING - neither
    // that the local data is synced nor that any peer holds it. Never start on
    // unverified data, and never remove without positive evidence either: removal
    // justified by blindness would delete a possibly-good copy. Alert and wait -
    // an operator, or recovery of the status endpoint, resolves it.
    cache.statusUnreadableSince = cache.statusUnreadableSince || Date.now();
    const unreadableMs = Date.now() - cache.statusUnreadableSince;
    log.warn(`handleReceiveOnlyTransition - ${appId} sync status unreadable for ${Math.round(unreadableMs / 60000)}m; staying receiveonly (will not start on unverified data, will not remove without evidence)`);
  }

  return { syncthingFolder, cache };
}

/**
 * Handle new app that was never processed
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function handleNewApp(params) {
  const {
    appId,
    syncthingFolder,
    receiveOnlySyncthingAppsCache,
  } = params;

  log.info(`handleNewApp - ${appId} NOT in cache. requesting stop + clean of ${appId}`);
  syncthingFolder.type = 'receiveonly';
  const cache = { numberOfExecutions: 1 };

  // Set cache BEFORE requesting the reset so subsequent monitoring cycles don't
  // re-process this app as "new"
  receiveOnlySyncthingAppsCache.set(appId, cache);

  // stop + local appdata clear is declared to the reconciler (the sole actuator)
  appReconciler.requestStopAndClearData(appId, 'syncthing new app clean install');

  return { syncthingFolder, cache };
}

/**
 * Ensure container is running if needed
 * @param {string} appId - App ID
 * @param {string} containerDataFlags - Container flags
 * @returns {Promise<void>}
 */
async function ensureContainerRunning(appId, containerDataFlags) {
  try {
    const containerInspect = await dockerService.dockerContainerInspect(appId);

    if (!containerInspect.State.Running && containerDataFlags.includes('r')) {
      log.info(`ensureContainerRunning - ${appId} is not running, requesting start`);
      appReconciler.setControllerDesired(appId, 'running', 'syncthing r: ensure-running');
    }
  } catch (error) {
    log.error(`ensureContainerRunning - Error checking/starting ${appId}: ${error.message}`);
  }
}

/**
 * Main state machine for folder sync management
 * Manages the transition from receiveonly to sendreceive mode
 *
 * @param {Object} params - All required parameters
 * @returns {Promise<Object>} Updated folder config and cache
 */
async function manageFolderSyncState(params) {
  const {
    appId,
    syncFolder,
    containerDataFlags,
    syncthingAppsFirstRun,
    receiveOnlySyncthingAppsCache,
    appLocation,
    localSocketAddr,
    syncthingFolder,
    installedAppName,
    liveness,
  } = params;

  // Check if folder already exists and is in sendreceive mode
  const folderAlreadySyncing = syncFolder && syncFolder.type === 'sendreceive';

  // If already syncing in sendreceive mode, ensure container is running
  if (folderAlreadySyncing) {
    // The mount is sound by the time this runs: the pass verifies every folder
    // it is going to act on before it acts, and holds out the ones that fail.
    // Re-deriving that verdict here would cost a syncthing round trip and a
    // directory walk per folder to answer a question already answered.
    await ensureContainerRunning(appId, containerDataFlags);
    // Ensure cache entry exists so health monitor can track this folder
    const existingCache = receiveOnlySyncthingAppsCache.get(appId);
    const cache = existingCache || { restarted: true };
    return { syncthingFolder, cache };
  }

  // First run scenario
  if (syncthingAppsFirstRun) {
    const result = await handleFirstRun({
      appId,
      syncFolder,
      syncthingFolder,
      receiveOnlySyncthingAppsCache,
    });
    return result;
  }

  const cache = receiveOnlySyncthingAppsCache.get(appId);

  // Second encounter of a skipped app
  if (cache?.firstEncounterSkipped) {
    const result = await handleSkippedAppSecondEncounter({
      appId,
      syncthingFolder,
      receiveOnlySyncthingAppsCache,
    });
    return result;
  }

  // App in cache but not yet restarted - handle transition
  if (cache && !cache.restarted) {
    const runningAppList = await appLocation(installedAppName);
    const result = await handleReceiveOnlyTransition({
      appId,
      cache,
      runningAppList,
      localSocketAddr,
      containerDataFlags,
      syncthingFolder,
      liveness,
    });
    return result;
  }

  // App not in cache at all
  if (!cache) {
    // If syncFolder doesn't exist, this is a NEW app installation - process it immediately
    // regardless of syncthingAppsFirstRun flag to prevent data loss
    if (!syncFolder) {
      log.info(`manageFolderSyncState - ${appId} NOT in cache but syncFolder doesn't exist, treating as new app installation`);
      const result = await handleNewApp({
        appId,
        syncthingFolder,
        receiveOnlySyncthingAppsCache,
      });
      return result;
    }

    // syncFolder exists but not in cache and not first run - skip on first encounter
    // This handles apps that existed before monitoring but weren't tracked in cache
    if (!syncthingAppsFirstRun) {
      log.info(`manageFolderSyncState - ${appId} NOT in cache and not first run, marking for skip on first encounter`);
      const skipCache = { firstEncounterSkipped: true };
      return { syncthingFolder, cache: skipCache, skipProcessing: true };
    }

    // First run and not in cache - clean install
    const result = await handleNewApp({
      appId,
      syncthingFolder,
      receiveOnlySyncthingAppsCache,
    });
    return result;
  }

  // Default case - ensure container is running
  await ensureContainerRunning(appId, containerDataFlags);
  return { syncthingFolder, cache: null };
}

module.exports = {
  manageFolderSyncState,
  getFolderSyncCompletion,
  probeFolderSyncCompletion,
  isDesignatedLeader,
  verifyFolderMountSafety,
  verifySendReceiveFolderSafety,
  findSyncedPeer,
  isPathMounted,
  checkDirectoryHasContent,
  checkDirectoryHasSyncScopedContent,
  nudgeFolderDevices,
};
