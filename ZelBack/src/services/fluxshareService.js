const path = require('path');
const fs = require('fs').promises;

const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const { Privilege, authOf } = require('./utils/privileges');
const { sendFile } = require('./utils/fileTransfer');
const { sanitizePath, verifyRealPathOfExistingPath } = require('./utils/pathSecurity');
const { appsFolder } = require('./utils/appConstants');
const log = require('../lib/log');

// What a node will still do with the files an operator left in ZelShare: list
// them, and hand them back. It will not take new ones, rename them, delete
// them, or serve them to anybody but the operator - a node is not a file host,
// and the rest of FluxShare went for that reason.
//
// This exists so that removal does not take an operator's files with it on the
// one population where FluxShare could run: a legacy install resolves its apps
// folder to the checkout, which shipped `ZelApps/ZelShare`. It is measured
// unused on every Arcane node and unmeasurable on the 393 legacy ones.
//
// It goes when those files have had a release to be collected in. Nothing here
// is a foundation to build on.
const shareRoot = path.join(appsFolder, 'ZelShare');

/**
 * The share directory, or null when the request does not address something
 * inside it.
 *
 * A caller-supplied name reaches this, so containment is resolved rather than
 * spelled: `verifyRealPathOfExistingPath` walks to the deepest part that
 * exists, which refuses a link out of the directory even when what it names
 * does not exist yet.
 * @param {string} relative Caller-supplied path, relative to the share root.
 * @returns {Promise<string|null>} The absolute path, or null when it escapes.
 */
async function resolveInShare(relative) {
  const target = sanitizePath(relative || '', shareRoot);
  try {
    await verifyRealPathOfExistingPath(target, shareRoot);
  } catch (error) {
    // A path that resolves outside the share is refused; a path this node
    // could not read has not been shown to be either. Telling an operator
    // their path is invalid, when what happened is that the disk would not
    // answer, sends them to fix the one thing that is not wrong - and these
    // endpoints exist so they can collect files that are still there.
    if (error.code && error.code !== 'ENOENT') {
      log.warn(`fluxshare - could not read ${relative}: ${error.message}`);
      throw new Error(`This node could not read ${relative}: ${error.code}`);
    }
    log.warn(`fluxshare - refused ${relative}: ${error.message}`);
    return null;
  }
  return target;
}

/**
 * Lists a directory under the share root.
 *
 * A node that never had a share directory answers with an empty list rather
 * than an error: absent and empty are the same thing to a caller collecting
 * files, and nothing in FluxOS has ever created that directory.
 *
 * Directory entries carry a null size. Reporting one would mean walking the
 * operator's data to add it up, and the number is not worth the walk.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>}
 */
async function fluxShareGetFolder(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR, authOf(req));
    if (!authorized) {
      res.json(messageHelper.errUnauthorizedMessage());
      return;
    }

    let { folder } = req.params;
    folder = folder || req.query.folder || '';

    const target = await resolveInShare(folder);
    if (!target) {
      throw new Error('Path validation failed..');
    }

    const names = await fs.readdir(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (names === null) {
      res.json(messageHelper.createDataMessage([]));
      return;
    }

    const entries = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.lstat(path.join(target, name));
      const isDirectory = stats.isDirectory();
      entries.push({
        name,
        size: isDirectory ? null : stats.size,
        isDirectory,
        isFile: stats.isFile(),
        isSymbolicLink: stats.isSymbolicLink(),
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      });
    }

    res.json(messageHelper.createDataMessage(entries));
  } catch (error) {
    log.error(error);
    res.json(messageHelper.createErrorMessage(error.message || error, error.name, error.code));
  }
}

/**
 * Sends one file from under the share root.
 *
 * The node's operator, and nobody else. These are their files on their
 * hardware, and the flux team has never been able to read them. FluxShare used
 * to fall through to a token lookup when the privilege check failed, which
 * served the file to whoever held the link; there is no such path here and a
 * test asserts there is not.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>}
 */
async function fluxShareDownloadFile(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR, authOf(req));
    if (!authorized) {
      res.json(messageHelper.errUnauthorizedMessage());
      return;
    }

    let { file } = req.params;
    file = file || req.query.file;
    if (!file) {
      throw new Error('No file specified');
    }

    const target = await resolveInShare(file);
    if (!target) {
      throw new Error('Path validation failed..');
    }

    await sendFile(res, target, path.basename(target));
  } catch (error) {
    log.error(error);
    res.json(messageHelper.createErrorMessage(error.message || error, error.name, error.code));
  }
}

module.exports = {
  fluxShareGetFolder,
  fluxShareDownloadFile,
};
