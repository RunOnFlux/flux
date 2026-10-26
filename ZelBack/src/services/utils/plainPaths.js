const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Throws unless every named entry under a volume mount that exists is a plain
 * directory. The volume is the app owner's to fill, links included, and the
 * backup and restore tasks read and write it with the node's privileges, so
 * they work only on entries that are what they appear to be. Entries that do
 * not exist yet are fine: the tasks create them.
 * @param {string} mount Volume mount path.
 * @param {string[]} relativePaths Entries under the mount, outermost first.
 * @returns {Promise<void>}
 * @throws {Error} When an entry exists and is not a plain directory.
 */
async function requirePlainDirectories(mount, relativePaths) {
  // eslint-disable-next-line no-restricted-syntax
  for (const relativePath of relativePaths) {
    let stats;
    try {
      // eslint-disable-next-line no-await-in-loop
      stats = await fs.lstat(path.join(mount, relativePath));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stats.isDirectory()) {
      throw new Error(`Refused: ${relativePath} in the volume is not a plain directory`);
    }
  }
}

/**
 * Throws unless a path that exists is a regular file, not a link to something.
 * @param {string} filePath File path.
 * @returns {Promise<void>}
 * @throws {Error} When the path exists and is not a regular file.
 */
async function requireRegularFile(filePath) {
  let stats;
  try {
    stats = await fs.lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error('Refused: the backup archive is not a regular file');
  }
}

module.exports = {
  requirePlainDirectories,
  requireRegularFile,
};
