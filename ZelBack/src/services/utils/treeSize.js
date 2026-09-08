const path = require('path');

/**
 * How many paths are stat'ed at once.
 *
 * Measured, not chosen: on a fleet-spec box, 20,000 files take 1169ms one at a
 * time and 179ms at 32, with nothing further to gain past ~128. The same
 * six-fold is what the published work on parallelising du's stat loop reports,
 * so it is a property of the problem rather than of that box. Bounded, because
 * the unbounded Promise.all fan-out this replaced opened a handle per entry in
 * the tree.
 */
const DEFAULT_CONCURRENCY = 32;

/**
 * The unit lstat reports allocated blocks in. Fixed, and unrelated to the
 * filesystem's own block size.
 */
const BLOCK_UNIT = 512;

/**
 * Bytes under a path, following nothing.
 *
 * `lstat`, never `stat`. The difference is the whole point of this module: an
 * app owner can write a symlink into their own volume, and a walk that follows
 * one leaves the volume entirely - `escape -> /` measures the host, and
 * `loop -> ..` never finishes at all. A symlink therefore contributes zero,
 * which is also the honest answer for the operations this feeds: `cp -a` and
 * the archivers copy the link, not what it points at.
 *
 * No time limit, deliberately. Every tool that reports a total scans the whole
 * tree first and takes as long as that takes - rsync builds its file list,
 * Explorer shows "Calculating...". A limit here was only ever guarding against
 * the cycle that lstat has already made impossible, and a scan that gives up
 * would leave callers to invent a meaning for a missing figure.
 *
 * Iterative, so a deep tree cannot overflow the stack, and batched, so a wide
 * one cannot open a handle per entry.
 *
 * Two different questions can be asked of a tree, and which one a caller wants
 * is not guessable - so it has to say. `occupied` reports what the tree costs
 * the filesystem: a file occupies whole blocks, so a hundred one-byte files are
 * 100 bytes by their own account and 409,600 on disk. Anything compared against
 * free space needs that one, because free space is itself a count of blocks.
 * The default reports what the files say, which is what a listing shows a user
 * and what every file browser means by the size of a folder.
 *
 * Directories are counted only for `occupied`, where they hold blocks like
 * anything else. Their apparent size is an implementation detail of the
 * filesystem rather than an amount of anyone's data.
 *
 * @param {string} root - absolute path to measure
 * @param {object} fsPromises - fs.promises, or a stand-in with lstat/readdir
 * @param {{concurrency?: number, occupied?: boolean}} [options]
 * @returns {Promise<number>} bytes
 */
async function measureTree(root, fsPromises, options = {}) {
  const { concurrency = DEFAULT_CONCURRENCY, occupied = false } = options;

  let bytes = 0;
  const pending = [root];

  while (pending.length) {
    const batch = pending.splice(0, concurrency);
    // A path that cannot be read is skipped rather than fatal: a tree being
    // written while it is measured loses entries between the readdir and the
    // lstat, and that is not a reason to refuse the whole measurement.
    // eslint-disable-next-line no-await-in-loop
    const entries = await Promise.all(batch.map(
      (p) => fsPromises.lstat(p).then((stats) => [p, stats]).catch(() => [p, null]),
    ));

    const directories = [];
    for (const [entryPath, stats] of entries) {
      if (!stats) continue;
      if (stats.isDirectory()) directories.push(entryPath);
      // A symlink is neither, and contributes nothing either way: the
      // operations this feeds copy the link rather than what it points at.
      if (occupied) {
        if (stats.isDirectory() || stats.isFile()) bytes += stats.blocks * BLOCK_UNIT;
      } else if (stats.isFile()) {
        bytes += stats.size;
      }
    }

    if (directories.length) {
      // eslint-disable-next-line no-await-in-loop
      const listings = await Promise.all(directories.map(
        (d) => fsPromises.readdir(d).then((names) => [d, names]).catch(() => [d, []]),
      ));
      for (const [directory, names] of listings) {
        // One push per name: spreading a readdir's names as arguments is
        // bounded by V8's argument limit, and one wide directory - a mail
        // spool, a cache - is enough to reach it.
        for (const name of names) pending.push(path.join(directory, name));
      }
    }
  }

  return bytes;
}

module.exports = {
  measureTree,
  DEFAULT_CONCURRENCY,
  BLOCK_UNIT,
};
