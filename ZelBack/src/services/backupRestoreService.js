const log = require('../lib/log');
const path = require('path');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const serviceHelper = require('./serviceHelper');
const IOUtils = require('./IOUtils');
const fs = require('fs').promises;
const { sanitizePath, verifyRealPath } = require('./utils/pathSecurity');

const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
// ToDo: Fix all the string concatenation in this file and use path.join()
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

/**
 * Validates if a file path belongs to a specific set of upload types within the appsFolder.
 * Uses sanitizePath for security validation, then checks for valid backup types.
 * @param {string} filepath - The file path to be validated.
 * @returns {string|false} - The sanitized filepath if valid, otherwise false.
 */
function pathValidation(filepath) {
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
    const authorized = res ? await verificationHelper.verifyPrivilege('appownerabove', req, appname) : true;
    if (authorized === true) {
      const dfInfoData = await IOUtils.getVolumeInfo(appname, component, multiplier, decimal, fields);
      if (dfInfoData === null) {
        throw new Error('No matching mount found');
      }
      const response = messageHelper.createDataMessage(dfInfoData[0]);
      return res ? res.json(response) : response;
      // eslint-disable-next-line no-else-return
    } else {
      const errorResponse = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errorResponse) : errorResponse;
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
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
    appname = (appname !== undefined && appname !== null) ? appname : (req.query.number || '');
    if (!path) {
      throw new Error('path and appname parameters are required');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('appownerabove', req, appname) : true;
    if (authorized === true) {
      if (!pathValidation(vPath)) {
        throw new Error('Path validation failed..');
      }
      const listData = await IOUtils.getPathFileList(vPath, multiplier, decimal, ['.tar.gz'], number);
      if (listData.length === 0) {
        throw new Error('No matching mount found');
      }
      const response = messageHelper.createDataMessage(listData);
      return res ? res.json(response) : response;
      // eslint-disable-next-line no-else-return
    } else {
      const errorResponse = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errorResponse) : errorResponse;
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
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
    const authorized = res ? await verificationHelper.verifyPrivilege('appownerabove', req, appname) : true;
    if (authorized === true) {
      const fileSize = await IOUtils.getRemoteFileSize(fileurl, multiplier, decimal, number);
      if (fileSize === false) {
        throw new Error('Error fetching file size');
      }
      const response = messageHelper.createDataMessage(fileSize);
      return res ? res.json(response) : response;
      // eslint-disable-next-line no-else-return
    } else {
      const errorResponse = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errorResponse) : errorResponse;
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
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
    const authorized = res ? await verificationHelper.verifyPrivilege('appownerabove', req, appname) : true;
    if (authorized === true) {
      if (!pathValidation(filepath)) {
        throw new Error('Path validation failed..');
      }
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
    return res ? res.json(errorResponse) : errorResponse;
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
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      if (!pathValidation(filepath)) {
        throw new Error('Path validation failed..');
      }
      // Verify real path after symlink resolution to prevent symlink escape attacks
      await verifyRealPath(filepath, appsFolder);
      const fileNameArray = filepath.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      const chmodResult = await serviceHelper.runCommand('chmod', { runAsRoot: true, params: ['777', filepath] });
      if (chmodResult.error) {
        throw chmodResult.error;
      }
      return res.download(filepath, fileName);
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
    return res ? res.json(errorResponse) : errorResponse;
  }
}

async function cleanLocalBackup() {
  try {
    // Get a list of folders in the root path
    const folders = await fs.readdir(appsFolder);
    // eslint-disable-next-line no-restricted-syntax
    for (const folder of folders) {
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
