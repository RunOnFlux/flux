// File Query Service - Query functions for app file and folder operations
const fs = require('fs').promises;
const messageHelper = require('../messageHelper');
const verificationHelper = require('../verificationHelper');
const IOUtils = require('../IOUtils');
const log = require('../../lib/log');
const { sanitizePath, verifyRealPath } = require('../utils/pathSecurity');
const { isReservedName } = require('../appSystem/volumeReservedNames');

/**
 * To get apps folder contents.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        // Browse at appid level to show appdata and all other mount points
        // Sanitize folder path to prevent directory traversal attacks
        filepath = sanitizePath(folder, appVolumePath[0].mount);
        // Verify resolved path stays within the allowed base directory
        await verifyRealPath(filepath, appVolumePath[0].mount);
      } else {
        throw new Error('Application volume not found');
      }
      const options = {
        withFileTypes: false,
      };
      const listed = await fs.readdir(filepath, options);

      // The browser opens at the volume root so an app with several mounts
      // shows them all, and that root also holds things that are not the
      // owner's: syncthing's control files, the filesystem's recovery
      // directory, and what an interrupted file operation left for the boot
      // sweep. They are implementation detail, they cannot be written through
      // any endpoint, and a listing that offers them invites an operation that
      // will only be refused.
      const atRoot = filepath === appVolumePath[0].mount;
      const files = atRoot ? listed.filter((name) => !isReservedName(name)) : listed;

      const filesWithDetails = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const fileStats = await fs.lstat(`${filepath}/${file}`);
        const isDirectory = fileStats.isDirectory();
        const isFile = fileStats.isFile();
        const isSymbolicLink = fileStats.isSymbolicLink();
        let fileFolderSize = fileStats.size;
        if (isDirectory) {
          // eslint-disable-next-line no-await-in-loop
          fileFolderSize = await IOUtils.getFolderSize(`${filepath}/${file}`);
        }
        const detailedFile = {
          name: file,
          size: fileFolderSize, // bytes
          isDirectory,
          isFile,
          isSymbolicLink,
          createdAt: fileStats.birthtime,
          modifiedAt: fileStats.mtime,
        };
        filesWithDetails.push(detailedFile);
      }
      const resultsResponse = messageHelper.createDataMessage(filesWithDetails);
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

module.exports = {
  getAppsFolder,
};
