const df = require('node-df');
const util = require('util');
const axios = require('axios');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');

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
    decimal = (decimal !== undefined && decimal !== null) ? decimal : (req.query.fields || '0');
    let { fields } = req.params;
    fields = (fields !== undefined && fields !== null) ? fields : (req.query.fields || '');
    if (!appname || !component) {
      throw new Error('Both the appname and component parameters are required');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      const dfAsync = util.promisify(df);
      const options = {
        prefixMultiplier: multiplier,
        isDisplayPrefixMultiplier: false,
        precision: +decimal,
      };
      const dfData = await dfAsync(options);
      const regex = new RegExp(`${component}_${appname}$`);
      const allowedFields = fields ? fields.split(',') : null;
      const dfInfo = dfData
        .filter((entry) => regex.test(entry.mount))
        .map((entry) => {
          const filteredEntry = allowedFields
            ? Object.fromEntries(Object.entries(entry).filter(([key]) => allowedFields.includes(key)))
            : entry;
          return filteredEntry;
        });
      if (dfInfo.length === 0) {
        throw new Error('No matching mount found');
      }
      console.log(`Info: ${dfInfo[0]}`);
      const response = messageHelper.createDataMessage(dfInfo[0]);
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

async function getRemoteFileSize(req, res) {
  try {
    console.log(req.params);
    let { fileurl } = req.params;
    fileurl = fileurl || req.query.fileurl;
    let { multiplier } = req.params;
    multiplier = multiplier || req.query.multiplier || 'MB';
    let { decimal } = req.params;
    decimal = decimal || req.query.decimal || 0;
    if (!fileurl) {
      throw new Error('fileurl parameter is mandatory');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      const head = await axios.head(fileurl);
      const contentLengthHeader = head.headers['content-length'] || head.headers['Content-Length'];
      const fileSizeInBytes = parseInt(contentLengthHeader, 10);
      console.log(fileSizeInBytes);
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

module.exports = {
  getVolumeDataOfComponent,
  convertFileSize,
  getRemoteFileSize,
};
