const df = require('node-df');
const util = require('util');
const axios = require('axios');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');

async function getAvailableSpaceOfApp(req, res) {
  try {
    console.log(req.params);
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { component } = req.params;
    component = component || req.query.component;
    if (!appname || !component) {
      throw new Error('Both the appname and component parameters are required');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      const regex = new RegExp(`${component}_${appname}$`);
      const options = {
        prefixMultiplier: 'MB',
        isDisplayPrefixMultiplier: false,
        precision: 0,
      };
      const dfAsync = util.promisify(df);
      const dfData = await dfAsync(options);
      const matchingEntry = dfData.find((entry) => regex.test(entry.mount));
      if (matchingEntry) {
        const appsResponse = messageHelper.createDataMessage(matchingEntry.available);
        return res ? res.json(appsResponse) : appsResponse;
      }
      const errorResponse = messageHelper.createErrorMessage('No matching entry found');
      return res ? res.json(errorResponse) : errorResponse;
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

function convertFileSize(sizeInBytes, multiplier) {
  const multiplierMap = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };
  return sizeInBytes / multiplierMap[multiplier.toUpperCase()];
}

async function checkRemoteFileSize(fileurl, multiplier = 'MB', decimal = 0) {
  try {
    const validMultipliers = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (!validMultipliers.includes(multiplier.toUpperCase())) {
      throw new Error('Invalid multiplier. Supported types: B, KB, MB, GB, TB.');
    }
    const response = await axios.head(fileurl);
    const contentLengthHeader = response.headers['content-length'] || response.headers['Content-Length'];
    const fileSizeInBytes = parseInt(contentLengthHeader, 10);
    const fileSize = convertFileSize(fileSizeInBytes, multiplier);
    const roundedFileSize = fileSize.toFixed(decimal);
    return roundedFileSize;
  } catch (error) {
    log.error('Error fetching file size:', error);
    return error;
  }
}

async function getRemoteFileSize(req, res) {
  try {
    console.log(req.params);
    let { fileurl } = req.params;
    fileurl = fileurl || req.query.fileurl;
    let { multiplier } = req.params;
    multiplier = multiplier || req.query.multiplier;
    let { decimal } = req.params;
    decimal = decimal || req.query.decimal;
    if (!fileurl) {
      throw new Error('fileurl parameter is mandatory');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      const sizeResult = await checkRemoteFileSize(fileurl, multiplier, decimal);
      console.log(sizeResult);
      if (!Number.isFinite(sizeResult)) {
        throw new Error('Error fetching file size');
      }
      const response = messageHelper.createDataMessage(sizeResult);
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

module.exports = {
  getAvailableSpaceOfApp,
  convertFileSize,
  checkRemoteFileSize,
  getRemoteFileSize,
};
