const log = require('../../lib/log');
const dockerService = require('../dockerService');
const enterpriseNetwork = require('../utils/enterpriseNetwork');
const imageCacheStore = require('./imageCacheStore');
const imageCacheService = require('./imageCacheService');

// Maintenance for the enterprise image cache: a one-shot boot reconcile of pulls that
// a restart interrupted, plus a periodic GC (drop de-authorized owners, drop records
// whose docker image has vanished, expire stale in-memory jobs). All best-effort:
// every step logs and continues so a transient DB/docker blip never wedges boot or GC.

/**
 * Boot: a record still in 'pulling' means the process restarted mid-download. Private
 * images cannot be auto-resumed (credentials are never persisted), so mark it failed;
 * the owner re-submits and docker's layer cache makes the re-pull cheap.
 */
async function reconcileInterruptedPulls() {
  const records = await imageCacheStore.listAllImages();
  if (!records) return;
  const stuck = records.filter((r) => r.state === 'pulling');
  // eslint-disable-next-line no-restricted-syntax
  for (const record of stuck) {
    // eslint-disable-next-line no-await-in-loop
    await imageCacheStore.patchImage(record.fluxId, record.repotag, { state: 'failed', error: 'interrupted by restart' });
    log.info(`imageCache - marked interrupted pull failed on boot: ${record.fluxId}/${record.repotag}`);
  }
}

/**
 * Remove cache records owned by FluxIDs no longer allowed on this node (mirrors the
 * app ownership-violation cleanup). Skips while the node identity is still resolving so
 * a not-yet-known allow-list can't wrongly purge everything.
 */
async function cleanupDeauthorizedOwners() {
  const allowed = enterpriseNetwork.getCachedAllowedOwnersForNode();
  if (allowed === null) return; // identity not resolved yet - defer
  const records = await imageCacheStore.listAllImages();
  if (!records) return;
  const offenderFluxIds = [...new Set(
    records.filter((r) => !allowed.includes(r.fluxId)).map((r) => r.fluxId),
  )];
  // eslint-disable-next-line no-restricted-syntax
  for (const fluxId of offenderFluxIds) {
    // eslint-disable-next-line no-await-in-loop
    await imageCacheStore.removeAllForFluxId(fluxId);
    log.warn(`imageCache - removed cache records for de-authorized owner ${fluxId}`);
  }
}

/**
 * Drop records whose docker image no longer exists (reclaimed externally by the
 * compliance sweep, a manual prune, or disk repair) so the quota accounting stays
 * honest. Only pinned records are checked (pulling/failed carry no real disk).
 */
async function reconcileOrphanedRecords() {
  const records = await imageCacheStore.listAllImages();
  if (!records) return;
  const pinned = records.filter((r) => r.state === 'pinned');
  if (!pinned.length) return;
  let images;
  try {
    images = await dockerService.dockerListImages();
  } catch (err) {
    log.warn(`imageCache - reconcileOrphanedRecords skipped (listImages failed): ${err.message}`);
    return;
  }
  const present = new Set();
  (images || []).forEach((img) => (img.RepoTags || []).forEach((tag) => present.add(tag)));
  const orphans = pinned.filter((r) => !present.has(r.repotag));
  // eslint-disable-next-line no-restricted-syntax
  for (const record of orphans) {
    // eslint-disable-next-line no-await-in-loop
    await imageCacheStore.removeImage(record.fluxId, record.repotag);
    log.info(`imageCache - dropped record for missing image ${record.fluxId}/${record.repotag}`);
  }
}

/** One-shot at boot. */
async function runBootReconcile() {
  try {
    await reconcileInterruptedPulls();
  } catch (err) {
    log.error(`imageCache - boot reconcile error: ${err.message}`);
  }
}

/** Periodic GC tick. */
async function runGc() {
  try {
    imageCacheService.pruneExpiredJobs();
    await cleanupDeauthorizedOwners();
    await reconcileOrphanedRecords();
  } catch (err) {
    log.error(`imageCache - gc error: ${err.message}`);
  }
}

module.exports = {
  reconcileInterruptedPulls,
  cleanupDeauthorizedOwners,
  reconcileOrphanedRecords,
  runBootReconcile,
  runGc,
};
