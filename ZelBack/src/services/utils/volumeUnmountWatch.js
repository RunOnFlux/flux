/**
 * Tells of the unmount of an app component's volume as it happens.
 *
 * The kernel announces a filesystem's unmount to every inotify watch on it, and
 * fs.watch on a mounted volume's root reports it as an event named for the root
 * itself. Entries changing in the root carry their own names. The mount table
 * cannot be watched instead: /proc does not support inotify.
 *
 * A volume unmounted while something still uses it - a running container holds
 * it through its own bind mount - is announced once the last user lets go.
 *
 * One watch per mounted volume, set when the volume is found mounted and gone
 * with its unmount; the next mount sets it again.
 */

const fs = require('node:fs');
const path = require('node:path');
const log = require('../../lib/log');

const watches = new Map(); // app id -> fs.FSWatcher

// Told the app id of each volume whose unmount was announced: set by
// serviceManager, as what it does lives in the reconciler.
let onUnmount = null;

/**
 * @param {(appId: string) => void} fn
 */
function setOnUnmount(fn) {
  onUnmount = fn;
}

/**
 * Whether a directory is the root of a filesystem other than its parent's.
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
async function isMountRoot(dir) {
  const [own, parent] = await Promise.all([
    fs.promises.stat(dir).catch(() => null),
    fs.promises.stat(path.dirname(dir)).catch(() => null),
  ]);
  return Boolean(own && parent && own.dev !== parent.dev);
}

function stopWatching(appId) {
  const watcher = watches.get(appId);
  if (!watcher) return;
  watches.delete(appId);
  try {
    watcher.close();
  } catch {
    // already closed by the unmount
  }
}

/**
 * Watch a component's volume for its unmount. Idempotent. A directory that is not
 * a mount root is not watched, checked again once the watch is set, so a volume
 * unmounted in between is not watched on the bare mountpoint beneath it.
 * @param {string} appId Docker app identifier, flux<component>_<app>.
 * @param {string} mountPoint Where the volume is mounted.
 * @returns {Promise<boolean>} Whether the volume is watched.
 */
async function watchVolume(appId, mountPoint) {
  if (watches.has(appId)) return true;
  if (!await isMountRoot(mountPoint)) return false;
  const rootName = path.basename(mountPoint);
  let watcher;
  try {
    watcher = fs.watch(mountPoint, (event, name) => {
      if (name !== rootName) return;
      stopWatching(appId);
      log.warn(`volumeUnmountWatch - the volume of ${appId} at ${mountPoint} was unmounted`);
      if (onUnmount) onUnmount(appId);
    });
  } catch (error) {
    log.warn(`volumeUnmountWatch - ${mountPoint} could not be watched: ${error.message}`);
    return false;
  }
  watcher.on('error', (error) => {
    log.warn(`volumeUnmountWatch - the watch on ${mountPoint} failed: ${error.message}`);
    stopWatching(appId);
  });
  watches.set(appId, watcher);
  if (!await isMountRoot(mountPoint)) {
    stopWatching(appId);
    return false;
  }
  return true;
}

/**
 * @returns {string[]} App ids whose volumes are watched.
 */
function watchedVolumes() {
  return [...watches.keys()];
}

/**
 * Test helper: closes every watch.
 */
function reset() {
  [...watches.keys()].forEach(stopWatching);
}

module.exports = {
  reset,
  setOnUnmount,
  watchVolume,
  watchedVolumes,
};
