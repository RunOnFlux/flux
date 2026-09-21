const log = require('../lib/log');
const path = require('path');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const { sendFile } = require('./utils/fileTransfer');
const IOUtils = require('./IOUtils');
const dockerService = require('./dockerService');
const { appsFolder } = require('./utils/appConstants');
const fs = require('fs').promises;
const { sanitizePath, verifyRealPathOfExistingPath } = require('./utils/pathSecurity');
const { Privilege, authOf } = require('./utils/privileges');

// ToDo: Fix all the string concatenation in this file and use path.join()

/**
 * Whether an app volume directory directly beneath appsFolder belongs to a
 * named app. A single-component app is mounted at `flux<app>` and a composed one
 * at `flux<component>_<app>` per component, so the directory is rebuilt from the
 * authorized app name and compared whole. Neither an app name nor a component
 * name may contain an underscore, so the field after the separator is the entire
 * app name and no other app's directory can satisfy the comparison.
 * @param {string} volumeDir - Directory name directly beneath appsFolder.
 * @param {string} appname - The app the caller holds a privilege over.
 * @returns {boolean} - True when the directory is that app's own volume.
 */
function volumeDirectoryBelongsToApp(volumeDir, appname) {
  // An appname carrying the separator could otherwise be spelled to rebuild
  // another app's composed directory, so it is refused here rather than left to
  // the caller's ordering.
  if (!volumeDir || !appname || appname.includes('_')) {
    return false;
  }
  if (volumeDir === dockerService.getAppIdentifier(appname)) {
    return true;
  }
  const separatorIndex = volumeDir.indexOf('_');
  if (separatorIndex === -1) {
    return false;
  }
  const component = dockerService.getBaseAppName(volumeDir.slice(0, separatorIndex));
  return volumeDir === dockerService.getAppIdentifier(`${component}_${appname}`);
}

/**
 * The app volume a backup path names: `<appsFolder>/<identifier>`, the boundary
 * a request authorised over one app may reach.
 *
 * The symlink check resolves against this rather than against appsFolder, which
 * holds every app's volume - a link inside one app's backup directory pointing
 * at another's is under appsFolder too.
 * @param {string} filepath - A path already known to start with appsFolder.
 * @returns {string} The volume directory the path names.
 */
function appVolumeDir(filepath) {
  const [volumeDir] = filepath.slice(appsFolder.length).split('/');
  return volumeDir;
}

/**
 * The absolute path of that volume.
 * @param {string} filepath - A path already known to start with appsFolder.
 * @returns {string} `<appsFolder>/<identifier>`.
 */
function appVolumeRoot(filepath) {
  return path.join(appsFolder, appVolumeDir(filepath));
}

/**
 * Validates that a path names a backup file or directory inside the volume of
 * one named app. The tenancy check belongs here with the other path checks
 * because every caller authorizes against `appname` and then operates on a path
 * supplied separately: without binding the two, a valid privilege over any app
 * reaches every app's backups on the node.
 * @param {string} filepath - The file path to be validated.
 * @param {string} appname - The app the caller holds a privilege over.
 * @returns {string|false} - The filepath if valid, otherwise false.
 */
function pathValidation(filepath, appname) {
  if (!filepath || typeof filepath !== 'string') {
    return false;
  }

  // Must start with appsFolder to be a valid backup path
  if (!filepath.startsWith(appsFolder)) {
    return false;
  }

  // Extract relative path from appsFolder
  const relativePath = filepath.slice(appsFolder.length);

  try {
    // Use sanitizePath for security validation (handles traversal, null bytes, etc.)
    sanitizePath(relativePath, appsFolder);
  } catch (error) {
    return false;
  }

  // An app volume is mounted at `<appsFolder>/<identifier>` and sanitizePath has
  // already refused any traversal leaving it, so the first segment of the
  // relative path is the volume the request would reach.
  if (!volumeDirectoryBelongsToApp(appVolumeDir(filepath), appname)) {
    return false;
  }

  // Check for valid backup type in the path
  const types = ['/backup/upload', '/backup/local', '/backup/remote'];
  const lastSlashIndex = filepath.lastIndexOf('/');
  let uploadType = null;

  // eslint-disable-next-line no-restricted-syntax
  for (const type of types) {
    const typeIndex = filepath.indexOf(type);
    if (typeIndex !== -1 && typeIndex < lastSlashIndex) {
      // Check if the upload type is at the end of the filepath or followed by a slash
      const nextChar = filepath[typeIndex + type.length];
      if (nextChar === '/' || nextChar === undefined) {
        uploadType = type.replace('/backup/', '');
        break;
      }
    }
  }

  return uploadType !== null ? filepath : false;
}

/**
 * Get volume data of an application component.
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {object} - JSON response containing the volume data of the specified application component.
 * @throws {object} - JSON error response if an error occurs.
 */
async function getVolumeDataOfComponent(req, res) {
  try {
    console.log(req.params);
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { component } = req.params;
    component = component || req.query.component;
    let { multiplier } = req.params;
    multiplier = (multiplier !== undefined && multiplier !== null) ? multiplier : (req.query.multiplier || 'MB');
    let { decimal } = req.params;
    decimal = (decimal !== undefined && decimal !== null) ? decimal : (req.query.decimal || '0');
    let { fields } = req.params;
    fields = (fields !== undefined && fields !== null) ? fields : (req.query.fields || '');
    if (!appname || !component) {
      throw new Error('Both the appname and component parameters are required');
    }
    const authorized = await verificationHelper.verifyPrivilege(Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: appname });
    if (authorized === true) {
      const { error, mounts } = await IOUtils.getVolumeInfo(appname, component, multiplier, decimal, fields);
      // A mount table that could not be read and a volume that is not mounted
      // are both "no data to report" to this endpoint.
      if (error || !mounts.length) {
        throw new Error('No matching mount found');
      }
      const response = messageHelper.createDataMessage(mounts[0]);
      return res.json(response);
      // eslint-disable-next-line no-else-return
    } else {
      const errorResponse = messageHelper.errUnauthorizedMessage();
      return res.json(errorResponse);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

/**
 * Get the list of local backups based on the provided path.
 * @async
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {object} - JSON response containing the list of local backups.
 * @throws {object} - JSON error response if an error occurs.
 */
async function getLocalBackupList(req, res) {
  try {
    console.log(req.params);
    let { path: vPath } = req.params;
    vPath = vPath || req.query.path;
    let { multiplier } = req.params;
    multiplier = (multiplier !== undefined && multiplier !== null) ? multiplier : (req.query.multiplier || 'B');
    let { decimal } = req.params;
    decimal = (decimal !== undefined && decimal !== null) ? decimal : (req.query.decimal || '0');
    let { number } = req.params;
    number = (number !== undefined && number !== null) ? number : (req.query.number || 'false');
    let { appname } = req.params;
    appname = appname ?? req.query.appname ?? '';
    if (!vPath || !appname) {
      throw new Error('path and appname parameters are required');
    }
    const authorized = await verificationHelper.verifyPrivilege(Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: appname });
    if (authorized === true) {
      if (!pathValidation(vPath, appname)) {
        throw new Error('Path validation failed..');
      }
      await verifyRealPathOfExistingPath(vPath, appVolumeRoot(vPath));
      const listData = await IOUtils.getPathFileList(vPath, multiplier, decimal, ['.tar.gz'], number);
      if (listData.length === 0) {
        throw new Error('No matching mount found');
      }
      const response = messageHelper.createDataMessage(listData);
      return res.json(response);
      // eslint-disable-next-line no-else-return
    } else {
      const errorResponse = messageHelper.errUnauthorizedMessage();
      return res.json(errorResponse);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

/**
 * Get the size of a remote file.
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {object} - JSON response containing the file size.
 * @throws {object} - JSON error response if an error occurs.
 */
async function getRemoteFileSize(req, res) {
  try {
    console.log(req.params);
    let { fileurl } = req.params;
    fileurl = fileurl || req.query.fileurl;
    let { multiplier } = req.params;
    multiplier = (multiplier !== undefined && multiplier !== null) ? multiplier : (req.query.multiplier || 'B');
    let { decimal } = req.params;
    decimal = (decimal !== undefined && decimal !== null) ? decimal : (req.query.decimal || '0');
    let { number } = req.params;
    number = (number !== undefined && number !== null) ? number : (req.query.number || 'false');
    let { appname } = req.params;
    appname = (appname !== undefined && appname !== null) ? appname : (req.query.appname || '');
    if (!fileurl || !appname) {
      throw new Error('fileurl and appname parameters are mandatory');
    }
    const authorized = await verificationHelper.verifyPrivilege(Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: appname });
    if (authorized === true) {
      const fileSize = await IOUtils.getRemoteFileSize(fileurl, multiplier, decimal, number);
      if (fileSize === false) {
        throw new Error('Error fetching file size');
      }
      const response = messageHelper.createDataMessage(fileSize);
      return res.json(response);
      // eslint-disable-next-line no-else-return
    } else {
      const errorResponse = messageHelper.errUnauthorizedMessage();
      return res.json(errorResponse);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

/**
 * Remove a backup file specified by the filepath.
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {object} - JSON response indicating the success of the file removal.
 * @throws {object} - JSON error response if an error occurs.
 */
async function removeBackupFile(req, res) {
  try {
    console.log(req.params);
    let { filepath } = req.params;
    filepath = filepath || req.query.filepath;
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!filepath || !appname) {
      throw new Error('filepath and appname parameters are mandatory');
    }
    const authorized = await verificationHelper.verifyPrivilege(Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: appname });
    if (authorized === true) {
      if (!pathValidation(filepath, appname)) {
        throw new Error('Path validation failed..');
      }
      await verifyRealPathOfExistingPath(filepath, appVolumeRoot(filepath));
      const output = await IOUtils.removeFile(filepath);
      const response = messageHelper.createSuccessMessage(output);
      return res.json(response);
      // eslint-disable-next-line no-else-return
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

/**
 * Download a local file specified by the filepath.
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {object} - File download response or JSON error response if an error occurs.
 * @throws {object} - JSON error response if an error occurs.
 */
async function downloadLocalFile(req, res) {
  try {
    console.log(req.params);
    let { filepath } = req.params;
    filepath = filepath || req.query.filepath;
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!filepath || !appname) {
      throw new Error('filepath and appname parameters are mandatory');
    }
    const authorized = await verificationHelper.verifyPrivilege(Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: appname });
    if (authorized) {
      if (!pathValidation(filepath, appname)) {
        throw new Error('Path validation failed..');
      }
      await verifyRealPathOfExistingPath(filepath, appVolumeRoot(filepath));
      const fileNameArray = filepath.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      return await sendFile(res, filepath, fileName);
      // eslint-disable-next-line no-else-return
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    // The route is its only caller, so there is always a response to write to.
    return res.json(errorResponse);
  }
}

async function cleanLocalBackup() {
  try {
    // Get a list of folders in the root path
    const folders = await fs.readdir(appsFolder);
    // eslint-disable-next-line no-restricted-syntax
    for (const folder of folders) {
      // A node may still carry a ZelShare directory of operator files beside
      // the app volumes. It is not an app, so nothing under it is a backup to
      // reap.
      if (folder.toLowerCase() === 'zelshare') {
        // eslint-disable-next-line no-continue
        continue;
      }
      const folderPath = path.join(appsFolder, folder);
      // eslint-disable-next-line no-await-in-loop
      const isDirectory = (await fs.stat(folderPath)).isDirectory();
      if (isDirectory) {
        // Check if there is a 'local' folder in each subdirectory
        const localFolderPath = path.join(folderPath, 'backup', 'local');
        try {
          // Check if 'local' folder exists
          // eslint-disable-next-line no-await-in-loop
          await fs.access(localFolderPath);
          // Get a list of files in the 'local' folder
          // eslint-disable-next-line no-await-in-loop
          const localFiles = await fs.readdir(localFolderPath);
          // Filter out files older than 24 hours
          const currentDate = Date.now();
          const twentyFourHoursAgo = currentDate - 24 * 60 * 60 * 1000;
          // eslint-disable-next-line no-restricted-syntax
          for (const file of localFiles) {
            const filePath = path.join(localFolderPath, file);
            // Get file stats
            // eslint-disable-next-line no-await-in-loop
            const stats = await fs.stat(filePath);
            const creationTime = new Date(stats.birthtime);
            // Check if the file is older than 24 hours
            if (creationTime < twentyFourHoursAgo) {
              // Delete the file
              // eslint-disable-next-line no-await-in-loop
              await fs.unlink(filePath);
              log.info(`Deleted file: ${filePath}`);
            }
          }
        } catch (error) {
          // 'local' folder doesn't exist in this subdirectory
        }
      }
    }
  } catch (err) {
    log.error('Error:', err);
  }
}

module.exports = {
  getVolumeDataOfComponent,
  getRemoteFileSize,
  getLocalBackupList,
  removeBackupFile,
  downloadLocalFile,
  cleanLocalBackup,
};
