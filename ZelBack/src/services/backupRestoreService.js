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

async function downloadFile(url, path, component, appname) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const fileData = Buffer.from(response.data, 'binary');
    await fs.writeFile(`${path}/backup/remotefile/${component}_${appname}.tar.gz`, fileData);
    console.log(`File ${path}/backup/remotefile/${component}_${appname}.tar.gz saved!`);
    return `File ${path}/backup/remotefile/${component}_${appname}.tar.gz saved!`;
  } catch (err) {
    console.error(err);
    return null;
  }
}

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
          console.log(volumePath[0].mount);
          console.log(url);
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
  convertFileSize,
  downloadFile,
};
