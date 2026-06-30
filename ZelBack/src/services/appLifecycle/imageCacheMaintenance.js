const log = require('../../lib/log');
const dockerService = require('../dockerService');
const enterpriseNetwork = require('../utils/enterpriseNetwork');
const imageCacheStore = require('./imageCacheStore');

// Cache-record maintenance for the enterprise image cache (DB bookkeeping only — this
// module never deletes a docker image; cold-image disk reclamation lives in imageReaper).
// These chores are enterprise-only (the cachedimages collection is empty off enterprise
// nodes) and event-driven, not polled: their inputs change rarely, so each runs once at
// boot and then only when its trigger fires (serviceManager wires the triggers):
//   - reconcileInterruptedPulls   : boot only (a restart can't leave a pull mid-flight twice)
//   - cleanupDeauthorizedOwners   : boot + after each allowed-owner-list refresh (6h github sync)
//   - reconcileOrphanedRecords    : boot + after the image-compliance sweep
// (pruneExpiredJobs self-cleans on every cache submit/status call, so it needs no periodic tick.)
// All best-effort: every step logs and continues so a transient DB/docker blip never wedges boot.

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

/**
 * One-shot at boot: run all three reconcilers for a clean slate after downtime. Each is
 * isolated so one failing never skips the next. Scheduled by serviceManager only once the
 * DB is ready AND the node identity has resolved (cleanupDeauthorizedOwners reads the
 * allowed-owner list, which is null until then); the ongoing de-auth/orphan triggers fire
 * from their own events thereafter.
 */
async function runBootReconcile() {
  try {
    await reconcileInterruptedPulls();
  } catch (err) {
    log.error(`imageCache - boot reconcileInterruptedPulls error: ${err.message}`);
  }
  try {
    await cleanupDeauthorizedOwners();
  } catch (err) {
    log.error(`imageCache - boot cleanupDeauthorizedOwners error: ${err.message}`);
  }
  try {
    await reconcileOrphanedRecords();
  } catch (err) {
    log.error(`imageCache - boot reconcileOrphanedRecords error: ${err.message}`);
  }
}

module.exports = {
  reconcileInterruptedPulls,
  cleanupDeauthorizedOwners,
  reconcileOrphanedRecords,
  runBootReconcile,
};
