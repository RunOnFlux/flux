const path = require('path');

/**
 * How many entries one measurement may look at.
 *
 * A bound rather than a timeout, because the cost of a walk is entries visited
 * and that is the thing to cap. A tree larger than this reports NO figure, which
 * every caller must treat as a refusal rather than as zero: a size that cannot
 * be established is not a small one.
 */
const DEFAULT_BUDGET = 20000;

/**
 * Bytes under a path, following nothing, bounded.
 *
 * `lstat`, never `stat`. The difference is the whole point of this module: an
 * app owner can write a symlink into their own volume, and a walk that follows
 * one leaves the volume entirely - `evil -> /` measures the host, and
 * `loop -> ..` measures itself until the process dies. Neither needs privilege
 * to plant, both run as the FluxOS process, and one of the callers here is the
 * plain file browser, which measures every directory it lists.
 *
 * A symlink therefore contributes zero, which is also the honest answer for the
 * operations this feeds: `cp -a` and the archivers copy the link itself, not
 * what it points at, so the bytes it costs to copy really are none.
 *
 * Iterative rather than recursive, and sequential rather than a Promise.all
 * fan-out: an unbounded recursion is a stack overflow waiting for a deep tree,
 * and fanning out means a wide one opens thousands of concurrent file handles.
 *
 * @param {string} root - absolute path to measure
 * @param {object} fsPromises - fs.promises, or a stand-in with lstat/readdir
 * @param {number} [budget] - maximum entries to visit
 * @returns {Promise<number|null>} bytes, or null if the budget ran out
 */
async function measureTree(root, fsPromises, budget = DEFAULT_BUDGET) {
  let bytes = 0;
  let remaining = budget;
  const pending = [root];

  while (pending.length) {
    if (remaining <= 0) return null;
    remaining -= 1;
    const current = pending.pop();

    // A path that cannot be read is skipped rather than fatal: a tree being
    // written while it is measured loses entries between the readdir and the
    // lstat, and that is not a reason to refuse the whole measurement.
    // eslint-disable-next-line no-await-in-loop
    const stats = await fsPromises.lstat(current).catch(() => null);
    if (!stats) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (stats.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      const names = await fsPromises.readdir(current).catch(() => []);
      pending.push(...names.map((name) => path.join(current, name)));
    } else if (stats.isFile()) {
      bytes += stats.size;
    }
  }

  return bytes;
}

module.exports = {
  measureTree,
  DEFAULT_BUDGET,
};
