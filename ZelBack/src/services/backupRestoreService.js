// const fs = require('fs').promises;
const log = require('../lib/log');
const path = require('path');
const messageHelper = require('./messageHelper');
// const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const IOUtils = require('./IOUtils');

const fluxDirPath = path.join(__dirname, '../../../');
const appsFolder = `${fluxDirPath}ZelApps/`;

/**
 * Validates if a file path belongs to a specific set of upload types within the appsFolder.
 * @param {string} filepath - The file path to be validated.
 * @returns {boolean} - True if the filepath is valid, otherwise false.
 */
function pathValidation(filepath) {
  const pathStart = filepath.startsWith(appsFolder);
  let uploadType = null;

  if (pathStart) {
    const lastSlashIndex = filepath.lastIndexOf('/');
    const types = ['/backup/upload', '/backup/local', '/backup/remote'];
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
  }
  const result = pathStart && uploadType !== null;
  return result;
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
 * Handles a request to retrieve remote files.
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {object} - JSON response indicating the success or failure.
 * @throws {object} - JSON error response if an error occurs.
 */
// eslint-disable-next-line consistent-return
// async function getRemoteFile(req, res) {
//   const authorized = await verificationHelper.verifyPrivilege('appownerabove', req);
//   if (authorized === true) {
//     try {
//       console.log();
//       const bodyData = serviceHelper.ensureObject(req.body);
//       console.log(bodyData);
//       if (!bodyData || bodyData.length === 0) {
//         throw new Error('Request body must contain data (body parameters are required)');
//       }
//       const isValidData = bodyData.every((item) => 'url' in item && 'component' in item && 'appname' in item);
//       if (!isValidData) {
//         throw new Error('Each object in bodyData must have "url", "component", and "appname" properties');
//       }
//       // eslint-disable-next-line no-restricted-syntax
//       for (const { url, component, appname } of bodyData) {
//         // eslint-disable-next-line no-await-in-loop
//         const volumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 0, 'mount');
//         // eslint-disable-next-line no-await-in-loop
//         if (await IOUtils.checkFileExists(`${volumePath[0].mount}/backup/remote/${component}_${appname}.tar.gz`)) {
//           // eslint-disable-next-line no-await-in-loop
//           await IOUtils.removeFile(`${volumePath[0].mount}/backup/remote/${component}_${appname}.tar.gz`);
//         }
//         // eslint-disable-next-line no-await-in-loop
//         await fs.mkdir(`${volumePath[0].mount}/backup/remote`, { recursive: true });
//         // eslint-disable-next-line no-await-in-loop
//         await IOUtils.downloadFileFromUrl(url, `${volumePath[0].mount}/backup/remote`, component, appname, true);
//       }
//       const response = messageHelper.createDataMessage(true);
//       return res ? res.json(response) : response;
//       // eslint-disable-next-line no-else-return
//     } catch (error) {
//       log.error(error);
//       const errorResponse = messageHelper.createErrorMessage(
//         error.message || error,
//         error.name,
//         error.code,
//       );
//       return res ? res.json(errorResponse) : errorResponse;
//     }
//   } else {
//     const errMessage = messageHelper.errUnauthorizedMessage();
//     return res.json(errMessage);
//   }
// }

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
      const fileNameArray = filepath.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
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

module.exports = {
  getVolumeDataOfComponent,
  getRemoteFileSize,
  // getRemoteFile,
  getLocalBackupList,
  removeBackupFile,
  downloadLocalFile,
};
