const fs = require('fs').promises;
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const IOService = require('./IOService');

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
      const dfInfoData = await IOService.getVolumeInfo(appname, component, multiplier, decimal, fields);
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

async function getBackupleList(req, res) {
  try {
    console.log(req.params);
    let { path } = req.params;
    path = path || req.query.path;
    let { multiplier } = req.params;
    multiplier = (multiplier !== undefined && multiplier !== null) ? multiplier : (req.query.multiplier || 'MB');
    let { decimal } = req.params;
    decimal = (decimal !== undefined && decimal !== null) ? decimal : (req.query.decimal || '0');
    if (!path) {
      throw new Error('path parameter is required');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      const listData = await IOService.getPathFileList(path, multiplier, decimal, ['.tar.gz']);
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
    multiplier = (multiplier !== undefined && multiplier !== null) ? multiplier : (req.query.multiplier || 'MB');
    let { decimal } = req.params;
    decimal = (decimal !== undefined && decimal !== null) ? decimal : (req.query.decimal || '0');
    if (!fileurl) {
      throw new Error('fileurl parameter is mandatory');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      // const head = await axios.head(fileurl);
      // const contentLengthHeader = head.headers['content-length'] || head.headers['Content-Length'];
      // const fileSizeInBytes = parseInt(contentLengthHeader, 10);
      // if (!Number.isFinite(fileSizeInBytes)) {
      //   throw new Error('Error fetching file size');
      // }
      // const fileSize = IOService.convertFileSize(fileSizeInBytes, multiplier);
      // const roundedFileSize = fileSize.toFixed(decimal);
      // const response = messageHelper.createDataMessage(roundedFileSize);
      const response = await IOService.getRemoteFileSize(fileurl, multiplier, decimal);
      if (response === false) {
        throw new Error('Error fetching file size...');
      }
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
          const volumePath = await IOService.getVolumeInfo(appname, component, 'MB', 0, 'mount');
          // eslint-disable-next-line no-await-in-loop
          if (await IOService.checkFileExists(`${volumePath[0].mount}/backup/remote/${component}_${appname}.tar.gz`)) {
            // eslint-disable-next-line no-await-in-loop
            await IOService.removeFile(`${volumePath[0].mount}/backup/remote/${component}_${appname}.tar.gz`);
          }
          // eslint-disable-next-line no-await-in-loop
          await fs.mkdir(`${volumePath[0].mount}/backup/remote`, { recursive: true });
          // eslint-disable-next-line no-await-in-loop
          await IOService.downloadFileFromUrl(url, `${volumePath[0].mount}/backup/remote`, component, appname, true);
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

async function removeBackupFile(req, res) {
  try {
    console.log(req.params);
    let { filepath } = req.params;
    filepath = filepath || req.query.filepath;
    if (!filepath) {
      throw new Error('filepath parameter is mandatory');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      const output = await IOService.removeFile(filepath);
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

async function downloadLocalFile(req, res) {
  try {
    console.log(req.params);
    let { filepath } = req.params;
    filepath = filepath || req.query.filepath;
    if (!filepath) {
      throw new Error('filepath parameter is mandatory');
    }
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
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
  getRemoteFile,
  getBackupleList,
  removeBackupFile,
  downloadLocalFile,
};
