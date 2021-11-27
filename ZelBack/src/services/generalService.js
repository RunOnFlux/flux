const config = require('config');
const crypto = require('crypto');

const log = require('../lib/log');

const serviceHelper = require('./serviceHelper');
const daemonService = require('./daemonService');

const scannedHeightCollection = config.database.daemon.collections.scannedHeight;

let storedTier = '';

function getCollateralInfo(collateralOutpoint) {
  const a = collateralOutpoint;
  const b = a.split(', ');
  const txhash = b[0].substr(10, b[0].length);
  const txindex = serviceHelper.ensureNumber(b[1].split(')')[0]);
  return { txhash, txindex };
}

async function nodeTier() {
  if (storedTier) {
    return storedTier; // node tier is not changing. We can use globally cached value.
  }
  // get our collateral information to decide if app specifications are basic, super, bamf
  // getzlenodestatus.collateral
  const nodeStatus = await daemonService.getZelNodeStatus();
  if (nodeStatus.status === 'error') {
    throw nodeStatus.data;
  }
  const collateralInformation = getCollateralInfo(nodeStatus.data.collateral);
  // get transaction information about collateralInformation.txhash
  const request = {
    params: {
      txid: collateralInformation.txhash,
      verbose: 1,
    },
  };
  const txInformation = await daemonService.getRawTransaction(request);
  if (txInformation.status === 'error') {
    throw txInformation.data;
  }
  // get collateralInformation.txindex vout
  const { value } = txInformation.data.vout[collateralInformation.txindex];
  if (value === 10000) {
    storedTier = 'basic';
    return storedTier;
  }
  if (value === 25000) {
    storedTier = 'super';
    return storedTier;
  }
  if (value === 100000) {
    storedTier = 'bamf';
    return storedTier;
  }
  throw new Error('Unrecognised Flux Node tier');
}

async function isNodeStatusConfirmed() {
  try {
    const response = await daemonService.getZelNodeStatus();
    if (response.status === 'error') {
      throw response.data;
    }
    if (response.data.status === 'CONFIRMED') {
      return true;
    }
    return false;
  } catch (error) {
    log.error(error);
    return false;
  }
}

async function checkSynced() {
  try {
    // check if flux database is synced with daemon database (equal or -1 inheight)
    const syncStatus = daemonService.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }
    const daemonHeight = syncStatus.data.height;
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight);

    if (explorerHeight + 1 === daemonHeight || explorerHeight === daemonHeight) {
      return true;
    }
    return false;
  } catch (e) {
    log.error(e);
    return false;
  }
}

async function checkWhitelistedRepository(repotag) {
  if (typeof repotag !== 'string') {
    throw new Error('Invalid repotag');
  }
  const splittedRepo = repotag.split(':');
  if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
    const resWhitelistRepo = await serviceHelper.axiosGet('https://raw.githubusercontent.com/runonflux/flux/master/helpers/repositories.json');

    if (!resWhitelistRepo) {
      throw new Error('Unable to communicate with Flux Services! Try again later.');
    }

    const repos = resWhitelistRepo.data;
    const whitelisted = repos.includes(repotag);
    if (!whitelisted) {
      throw new Error('Repository is not whitelisted. Please contact Flux Team.');
    }
  } else {
    throw new Error(`Repository ${repotag} is not in valid format namespace/repository:tag`);
  }
  return true;
}

async function checkWhitelistedZelID(zelid) {
  if (typeof zelid !== 'string') {
    throw new Error('Invalid Owner ZelID');
  }
  const resZelIDs = await serviceHelper.axiosGet('https://raw.githubusercontent.com/runonflux/flux/master/helpers/zelids.json');

  if (!resZelIDs) {
    throw new Error('Unable to communicate with Flux Services! Try again later.');
  }

  const zelids = resZelIDs.data;
  const whitelisted = zelids.includes(zelid);
  if (!whitelisted) {
    throw new Error('Owner ZelID is not whitelisted. Please contact Flux Team.');
  }
  return true;
}

async function whitelistedRepositories(req, res) {
  try {
    const whitelisted = await serviceHelper.axiosGet('https://raw.githubusercontent.com/runonflux/flux/master/helpers/repositories.json');
    const resultsResponse = serviceHelper.createDataMessage(whitelisted.data);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function whitelistedZelIDs(req, res) {
  try {
    const whitelisted = await serviceHelper.axiosGet('https://raw.githubusercontent.com/runonflux/flux/master/helpers/zelids.json');
    const resultsResponse = serviceHelper.createDataMessage(whitelisted.data);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function messageHash(message) {
  if (typeof message !== 'string') {
    return new Error('Invalid message');
  }
  return crypto.createHash('sha256').update(message).digest('hex');
}

module.exports = {
  getCollateralInfo,
  nodeTier,
  isNodeStatusConfirmed,
  checkSynced,
  checkWhitelistedRepository,
  checkWhitelistedZelID,
  whitelistedRepositories,
  whitelistedZelIDs,
  messageHash,
};
