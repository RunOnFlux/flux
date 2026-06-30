const config = require('config');
const imageCacheStore = require('./imageCacheStore');

// Policy: whether an app uninstall must KEEP a repotag's docker image because it
// is pinned in the enterprise image cache. Consulted at every appUninstaller
// image-removal site so a pinned image survives the app's teardown and a later
// reinstall is a local layer-cache hit instead of a full re-pull.
//
// Scope on this branch is deliberately narrow: retain ONLY images explicitly
// pinned in the cache (bounded by the per-fluxId + node-wide quotas). Blanket
// retention of every enterprise app's image (the separate retention plan) needs
// the disk-pressure eviction net that lands with the v9 disk-fit work and is NOT
// done here. A non-failed pin by ANY owner retains the shared image.

/**
 * @param {string} repotag
 * @returns {Promise<boolean>} true = keep the image, false = remove as usual.
 *   Fail-safe: a DB read error returns true (keep) — deleting an image that is
 *   actually pinned is the irreversible outcome; a leaked image is merely
 *   reclaimed on a later pass.
 */
async function shouldRetainImage(repotag) {
  if (!config.fluxapps.imageCacheEnabled) return false;
  if (!repotag) return false;
  const pins = await imageCacheStore.findPinsForRepotag(repotag);
  if (pins === null) return true; // fail-safe: cannot verify, keep the image
  return pins.some((pin) => pin.state !== 'failed');
}

module.exports = {
  shouldRetainImage,
};
