const config = require('config');
const crypto = require('crypto');

const log = require('../lib/log');

const serviceHelper = require('./serviceHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceTransactionRpcs = require('./daemonService/daemonServiceTransactionRpcs');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');

const scannedHeightCollection = config.database.daemon.collections.scannedHeight;

let storedTier = null;
let storedCollateral = null;

/**
 * To return a transaction hash and index.
 * @param {string[]} collateralOutpoint List of collateral outpoints.
 * @returns {object} Collateral info object.
 * @property {string} txhash Transaction hash.
 * @property {number} txindex Transaction index.
 */
function getCollateralInfo(collateralOutpoint) {
  const b = collateralOutpoint.split(', ');
  const txhash = b[0].slice(10);
  const txindex = serviceHelper.ensureNumber(b[1].split(')')[0]);
  return { txhash, txindex };
}

/**
 * To return a transaction hash and index of our node collateral
 * @returns {object} Collateral info object.
 * @property {string} txhash Transaction hash.
 * @property {number} txindex Transaction index.
 */
async function obtainNodeCollateralInformation() {
  // get our collateral information to decide if app specifications are basic, super, bamf
  // getzlenodestatus.collateral
  const nodeStatus = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
  if (nodeStatus.status === 'error') {
    throw nodeStatus.data;
  }
  const collateralInformation = getCollateralInfo(nodeStatus.data.collateral);
  return collateralInformation;
}

/**
 * To return the tier of a node in old naming scheme
 * @returns {string} Name of the node tier in old naming scheme
 */
async function nodeTier() {
  if (storedTier) {
    return storedTier; // node tier is not changing. We can use globally cached value.
  }
  // get our collateral information to decide if app specifications are basic, super, bamf
  // getzlenodestatus.collateral
  const nodeStatus = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
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
  const txInformation = await daemonServiceTransactionRpcs.getRawTransaction(request);
  if (txInformation.status === 'error') {
    throw txInformation.data;
  }
  // get collateralInformation.txindex vout
  const { value } = txInformation.data.vout[collateralInformation.txindex];
  if (value === 10000 || value === 1000) {
    storedTier = 'basic';
    storedCollateral = value;
    return storedTier;
  }
  if (value === 25000 || value === 12500) {
    storedTier = 'super';
    storedCollateral = value;
    return storedTier;
  }
  if (value === 100000 || value === 40000) {
    storedTier = 'bamf';
    storedCollateral = value;
    return storedTier;
  }
  throw new Error('Unrecognised Flux Node tier');
}

/**
 * To return the tier of a node.
 * @returns {string} Name of the node tier.
 */
async function getNewNodeTier() {
  const tier = await nodeTier();
  if (tier === 'bamf') {
    return 'stratus';
  }
  if (tier === 'super') {
    return 'nimbus';
  }
  return 'cumulus';
}

/**
 * To return the quantity of collateral stored and determine what type of node it can be used for.
 * @returns {number} The quantity of collateral.
 */
async function nodeCollateral() {
  if (storedCollateral) {
    return storedCollateral; // node collateral is not changing. We can use globally cached value.
  }
  // get our collateral information to decide if app specifications are basic, super, bamf
  // getzlenodestatus.collateral
  const nodeStatus = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
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
  const txInformation = await daemonServiceTransactionRpcs.getRawTransaction(request);
  if (txInformation.status === 'error') {
    throw txInformation.data;
  }
  // get collateralInformation.txindex vout
  const { value } = txInformation.data.vout[collateralInformation.txindex];
  if (value === 10000 || value === 1000) {
    storedTier = 'basic';
    storedCollateral = value;
    return storedCollateral;
  }
  if (value === 100000 || value === 40000) {
    storedTier = 'bamf';
    storedCollateral = value;
    return storedCollateral;
  }
  if (value === 25000 || value === 12500) {
    storedTier = 'super';
    storedCollateral = value;
    return storedCollateral;
  }
  throw new Error('Unrecognised Flux Node Collateral');
}

/**
 * Checks if a node's status is confirmed.
 * @returns {boolean} True if node is confirmed. False if there is an error.
 */
async function isNodeStatusConfirmed() {
  try {
    const response = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
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

/**
 * Checks if a node's FluxOS database is synced with the node's daemon database.
 * @returns {boolean} True if FluxOS databse height is within 1 of the daemon database height. False if not within 1 of the height or if there is an error.
 */
async function checkSynced() {
  try {
    // check if flux database is synced with daemon database (equal or -1 inheight)
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }
    const daemonHeight = serviceHelper.ensureNumber(syncStatus.data.height);
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight);

    log.info(`Explorer Sync Status check: ${explorerHeight}/${daemonHeight}`);
    const difference = Math.abs(daemonHeight - explorerHeight);
    if (difference <= 5) {
      return true;
    }
    return false;
  } catch (e) {
    log.error(e);
    return false;
  }
}

/**
 * To create a JSON response showing a list of whitelisted Github repositories.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function whitelistedRepositories(req, res) {
  try {
    const whitelisted = await serviceHelper.axiosGet('https://raw.githubusercontent.com/RunOnFlux/flux/master/helpers/repositories.json');
    const resultsResponse = messageHelper.createDataMessage(whitelisted.data);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To hash a message using sha256 encryption.
 * @param {string} message Message to be hashed.
 * @returns {string} Hashed message.
 */
async function messageHash(message) {
  if (typeof message !== 'string') {
    return new Error('Invalid message');
  }
  return crypto.createHash('sha256').update(message).digest('hex');
}

/**
 * Set nodeTier - created for testing purposes
 */
function setStoredTier(newValue) {
  storedTier = newValue;
}

/**
 * Returns storedTier - created for testing purposes
 * @returns {string} storedTier
 */
function getStoredTier() {
  return storedTier;
}

/**
 * Set storedCollateral - created for testing purposes
 */
function setStoredCollateral(newValue) {
  storedCollateral = newValue;
}

/**
 * Returns storedCollateral - created for testing purposes
 * @returns {number} storedTier
 */
function getStoredCollateral() {
  return storedCollateral;
}

module.exports = {
  getCollateralInfo,
  nodeTier,
  getNewNodeTier,
  isNodeStatusConfirmed,
  checkSynced,
  whitelistedRepositories,
  messageHash,
  nodeCollateral,
  obtainNodeCollateralInformation,

  // exported for testing purposes
  setStoredTier,
  setStoredCollateral,
  getStoredCollateral,
  getStoredTier,
};
