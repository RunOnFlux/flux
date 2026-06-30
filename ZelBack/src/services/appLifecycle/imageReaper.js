const log = require('../../lib/log');
const dockerService = require('../dockerService');
const globalState = require('../utils/globalState');
const imageCacheRetention = require('./imageCacheRetention');
const { withHostMutationLock } = require('../utils/hostMutationLock');

// Cold-image reaper — the node's all-nodes janitor for reclaiming disk from docker images
// that nothing uses any more. It replaces the old install-time prune, which (despite a
// comment claiming otherwise) only ever removed dangling <none> images and let cold TAGGED
// images accumulate forever. This reaper removes a tagged image too once no container holds
// it and no cache pin protects it.
//
// Runs on ALL nodes (boot, after each image update, daily) — it is NOT gated on
// imageCacheEnabled: every node accrues cold images and must reclaim them. It is merely
// cache-AWARE: shouldRetainImage() protects pinned images, and on a node with the cache off
// that predicate returns false, so the reaper falls back to the intended aggressive
// "remove every cold unpinned image" behaviour.
//
// An image is KEPT when any of:
//   - a container (running OR stopped) references it — listContainers(true) includes stopped
//     containers, and a non-forced image.remove() would 409 anyway, so in-use is doubly safe;
//   - one of its repotags has a non-failed cache pin (shouldRetainImage) — this also covers an
//     in-flight cache pre-warm, whose record is written 'pulling' before the pull starts;
//   - an app install/redeploy is in progress (see the load-bearing note below).
//
// ── The install race and why this is correct, not just unlikely ──────────────────────────
// An app install pulls its image OUTSIDE the host-mutation lock and only afterwards creates
// the container, so for a moment the image is present with no container — i.e. it looks cold.
// Every app-image pull path, however, sets a globalState in-progress flag BEFORE pulling and
// clears it only AFTER the container exists (installation / soft-redeploy / hard-redeploy /
// reinstall-old-apps), and globalState.isOperationInProgress() aggregates all of them. So a
// `false` read means no install is anywhere in a pull->create span, hence no install depends
// on the image we are about to delete. The check and the delete run in ONE synchronous tick
// (no await between them), so in Node's single-threaded loop no install code can interleave
// to set its flag and pull in the gap. An install that starts AFTER the check sets its flag
// and pulls strictly after our delete dispatches, so it simply re-pulls the image.
// LOAD-BEARING: never insert an await between isOperationInProgress() and appDockerImageRemove,
// and never add an image-pull path that does not set an in-progress flag before pulling.

/**
 * Reclaim cold, unused, unpinned docker images. Best-effort: a failure to list or to remove
 * any single image is logged and never thrown, so the reaper can run unguarded from a timer.
 * @returns {Promise<{ removed: number, kept: number, skipped: number }>}
 */
async function pruneUnusedImages() {
  let images;
  let containers;
  try {
    [images, containers] = await Promise.all([
      dockerService.dockerListImages(),
      dockerService.dockerListContainers(true),
    ]);
  } catch (err) {
    log.warn(`imageReaper - skipped (docker list failed): ${err.message}`);
    return { removed: 0, kept: 0, skipped: 0 };
  }

  // Images held by any container (running or stopped), keyed both by image id and by the
  // image reference the container was created with (a tag may resolve to an id we don't see).
  const referencedIds = new Set();
  const referencedNames = new Set();
  (containers || []).forEach((container) => {
    if (container.ImageID) referencedIds.add(container.ImageID);
    if (container.Image) referencedNames.add(container.Image);
  });

  // Build the kill-list lock-free (read-only): everything that is neither container-referenced
  // nor cache-pinned. Dangling images (<none>:<none>) have no real tag, so they fall straight
  // through to removal exactly as the old dangling prune did.
  const doomed = [];
  let kept = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const image of images || []) {
    const tags = (image.RepoTags || []).filter((tag) => tag && tag !== '<none>:<none>');
    const inUse = referencedIds.has(image.Id) || tags.some((tag) => referencedNames.has(tag));
    if (inUse) { kept += 1; continue; }
    let pinned = false;
    // eslint-disable-next-line no-restricted-syntax
    for (const tag of tags) {
      // eslint-disable-next-line no-await-in-loop
      if (await imageCacheRetention.shouldRetainImage(tag)) { pinned = true; break; }
    }
    if (pinned) { kept += 1; continue; }
    doomed.push(image);
  }

  let removed = 0;
  let skipped = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const image of doomed) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await withHostMutationLock(() => {
      // LOAD-BEARING (see header): the in-progress check and the remove call MUST stay in one
      // synchronous tick — do not insert an await between them. A false read here means no
      // install depends on this image. If an op IS in progress we skip THIS image and let a
      // later run reclaim it (per-image, so non-coinciding images are still reclaimed now).
      if (globalState.isOperationInProgress()) return 'skipped';
      return dockerService.appDockerImageRemove(image.Id);
    }).catch((err) => {
      // A non-forced remove 409s if the image is still in use — the expected backstop; log and move on.
      log.warn(`imageReaper - could not remove image ${image.Id}: ${err.message}`);
      return 'error';
    });
    if (outcome === 'skipped') skipped += 1;
    else if (outcome !== 'error') removed += 1;
  }

  if (removed || skipped) {
    log.info(`imageReaper - removed ${removed} cold image(s), kept ${kept}, deferred ${skipped} (op in progress)`);
  }
  return { removed, kept, skipped };
}

module.exports = {
  pruneUnusedImages,
};
