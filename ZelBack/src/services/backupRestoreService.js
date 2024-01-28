const df = require('node-df');
const fs = require('fs').promises;
const util = require('util');
const axios = require('axios');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');

/**
 * Get volume information for a specific application component.
 * @param {string} appname - Name of the application.
 * @param {string} component - Name of the component.
 * @param {string} multiplier - Unit multiplier for displaying sizes (B, KB, MB, GB).
 * @param {number} decimal - Number of decimal places for precision.
 * @param {string} fields - Optional comma-separated list of fields to include in the response.
 * @returns {Array|null} - Array of objects containing volume information for the specified component, or null if no matching mount is found.
 */
async function getVolumeInfo(appname, component, multiplier, decimal, fields) {
  try {
    const options = {
      prefixMultiplier: multiplier,
      isDisplayPrefixMultiplier: false,
      precision: +decimal,
    };
    const dfAsync = util.promisify(df);
    const dfData = await dfAsync(options);
    const regex = new RegExp(`${component}_${appname}$`);
    const allowedFields = fields ? fields.split(',') : null;
    const dfSorted = dfData
      .filter((entry) => regex.test(entry.mount))
      .map((entry) => {
        const filteredEntry = allowedFields
          ? Object.fromEntries(Object.entries(entry).filter(([key]) => allowedFields.includes(key)))
          : entry;
        return filteredEntry;
      });
    if (dfSorted.length === 0) {
      return null;
    }
    return dfSorted;
  } catch (error) {
    log.error(error);
    return null;
  }
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
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      const dfInfoData = await getVolumeInfo(appname, component, multiplier, decimal, fields);
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
 * Check if a file exists at the specified filePath.
 * @param {string} filePath - The path to the file.
 * @returns {boolean} - True if the file exists, false otherwise.
 */
async function checkFileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Remove a file at the specified filePath.
 * @param {string} filePath - The path to the file to be removed.
 * @returns {boolean} - True if the file is removed successfully, false otherwise.
 */
async function removeFile(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Convert file size from bytes to the specified unit.
 * @param {number} sizeInBytes - Size of the file in bytes.
 * @param {string} multiplier - Unit to convert to (B, KB, MB, GB).
 * @returns {number} - Converted file size.
 */
function convertFileSize(sizeInBytes, multiplier) {
  const multiplierMap = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  return sizeInBytes / multiplierMap[multiplier.toUpperCase()];
}

/**
 * Get a list of file information for the specified path.
 * @param {string} path - The path of the directory.
 * @param {string} multiplier - Unit to convert file sizes (B, KB, MB, GB).
 * @param {number} decimal - Number of decimal places for file sizes.
 * @returns {Array|null} - An array of file information or null if there's an issue reading the directory or obtaining file information.
 */
async function getPathFileList(path, multiplier, decimal) {
  try {
    const files = await fs.readdir(path);
    const filesArray = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const file of files) {
      const filePath = `${path}/${file}`;
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(filePath);
      const fileSize = convertFileSize(stats.size, multiplier);
      const roundedFileSize = fileSize.toFixed(decimal);
      const fileInfo = {
        name: file,
        createat: stats.birthtimeMs.toFixed(0),
        size: roundedFileSize,

      };
      filesArray.push(fileInfo);
    }
    log.info(filesArray);
    return filesArray;
  } catch (err) {
    log.error('Error reading directory:', err);
    return null;
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
    multiplier = (multiplier !== undefined && multiplier !== null) ? multiplier : (req.query.multiplier || 'MB');
    let { decimal } = req.params;
    decimal = (decimal !== undefined && decimal !== null) ? decimal : (req.query.decimal || '0');
    if (!fileurl) {
      throw new Error('fileurl parameter is mandatory');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      const head = await axios.head(fileurl);
      const contentLengthHeader = head.headers['content-length'] || head.headers['Content-Length'];
      const fileSizeInBytes = parseInt(contentLengthHeader, 10);
      if (!Number.isFinite(fileSizeInBytes)) {
        throw new Error('Error fetching file size');
      }
      const fileSize = convertFileSize(fileSizeInBytes, multiplier);
      const roundedFileSize = fileSize.toFixed(decimal);
      const response = messageHelper.createDataMessage(roundedFileSize);
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
 * Downloads a file from a remote URL and saves it locally.
 *
 * @param {string} url - The URL of the file to download.
 * @param {string} path - The local path to save the downloaded file.
 * @param {string} component - The component name for identification.
 * @param {string} appname - The application name for identification.
 * @returns {string|null} - A success message if the file is downloaded and saved, or null on failure.
 */
async function downloadFile(url, path, component, appname) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const fileData = Buffer.from(response.data, 'binary');
    await fs.writeFile(`${path}/${component}_${appname}.tar.gz`, fileData);
    console.log(`File ${path}/${component}_${appname}.tar.gz saved!`);
    return `File ${path}/${component}_${appname}.tar.gz saved!`;
  } catch (err) {
    log.error(err);
    return null;
  }
}

/**
 * Handles a request to retrieve remote files.
 *
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {object} - JSON response indicating the success or failure.
 * @throws {object} - JSON error response if an error occurs.
 */
// eslint-disable-next-line consistent-return
async function getRemoteFile(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    let body = '';
    req.on('data', (data) => {
      body += data;
    });
    req.on('end', async () => {
      try {
        const bodyData = serviceHelper.ensureObject(body);
        console.log(`Data: ${JSON.stringify(bodyData)}`);
        if (!bodyData || bodyData.length === 0) {
          throw new Error('Request body must contain data (body parameters are required)');
        }
        const isValidData = bodyData.every((item) => 'url' in item && 'component' in item && 'appname' in item);
        if (!isValidData) {
          throw new Error('Each object in bodyData must have "url", "component", and "appname" properties');
        }
        // eslint-disable-next-line no-restricted-syntax
        for (const { url, component, appname } of bodyData) {
          // eslint-disable-next-line no-await-in-loop
          const volumePath = await getVolumeInfo(appname, component, 'MB', 0, 'mount');
          // eslint-disable-next-line no-await-in-loop
          if (await checkFileExists(`${volumePath[0].mount}/backup/remotefile/${component}_${appname}.tar.gz`)) {
            // eslint-disable-next-line no-await-in-loop
            await removeFile(`${volumePath[0].mount}/backup/remotefile/${component}_${appname}.tar.gz`);
          }
          // eslint-disable-next-line no-await-in-loop
          await fs.mkdir(`${volumePath[0].mount}/backup/remotefile`, { recursive: true });
          // eslint-disable-next-line no-await-in-loop
          await downloadFile(url, `${volumePath[0].mount}/backup/remotefile`, component, appname);
        }
        const response = messageHelper.createDataMessage('successful!');
        return res ? res.json(response) : response;
        // eslint-disable-next-line no-else-return
      } catch (error) {
        log.error(error);
        const errorResponse = messageHelper.createErrorMessage(
          error.message || error,
          error.name,
          error.code,
        );
        return res ? res.json(errorResponse) : errorResponse;
      }
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
}

module.exports = {
  getVolumeInfo,
  getVolumeDataOfComponent,
  getRemoteFileSize,
  getRemoteFile,
  getPathFileList,
  checkFileExists,
  removeFile,
  convertFileSize,
  downloadFile,
};
