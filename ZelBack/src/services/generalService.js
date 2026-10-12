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

/**
 * Every collateral a Flux node can hold, keyed by its amount: the tier it makes
 * the node (`tier`, and `nodeTier` as /flux/nodetier names it), and the
 * hardware a node must have to serve as that tier.
 */
const COLLATERAL_TIERS = Object.freeze({
  10000: Object.freeze({
    tier: 'basic', nodeTier: 'cumulus', label: 'Cumulus', minRamGb: 3, minCpuThreads: 2,
  }),
  25000: Object.freeze({
    tier: 'super', nodeTier: 'nimbus', label: 'Nimbus', minRamGb: 7, minCpuThreads: 4,
  }),
  100000: Object.freeze({
    tier: 'bamf', nodeTier: 'stratus', label: 'Stratus', minRamGb: 30, minCpuThreads: 8,
  }),
  1000: Object.freeze({
    tier: 'basic', nodeTier: 'cumulus_new', label: 'new Cumulus', minRamGb: 3, minCpuThreads: 4,
  }),
  12500: Object.freeze({
    tier: 'super', nodeTier: 'nimbus_new', label: 'new Nimbus', minRamGb: 30, minCpuThreads: 8,
  }),
  40000: Object.freeze({
    tier: 'bamf', nodeTier: 'stratus_new', label: 'new Stratus', minRamGb: 61, minCpuThreads: 16,
  }),
});

// This node's collateral and its tier, held once known: neither changes while
// FluxOS runs.
let storedCollateralTier = null;

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
 * This node's collateral and the tier it makes the node, as the daemon reports
 * them. Throws only when the daemon cannot say: `collateral` is null when the
 * node holds none, or when the collateral's transaction has no output at its
 * index, and `tier` is null when its collateral is not one of COLLATERAL_TIERS.
 * @returns {Promise<{collateral: (number|null), tier: (object|null), missingOutput: (string|undefined)}>}
 *   tier is the node's COLLATERAL_TIERS entry; missingOutput names, as
 *   `txhash:index`, a collateral output its transaction does not have.
 */
async function nodeCollateralTier() {
  if (storedCollateralTier) return storedCollateralTier;

  const nodeStatus = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
  if (nodeStatus.status === 'error') {
    throw nodeStatus.data;
  }
  if (!nodeStatus.data.collateral) return { collateral: null, tier: null };

  const { txhash, txindex } = getCollateralInfo(nodeStatus.data.collateral);
  const txInformation = await daemonServiceTransactionRpcs.getRawTransaction({ params: { txid: txhash, verbose: 1 } });
  if (txInformation.status === 'error') {
    throw txInformation.data;
  }
  const output = txInformation.data.vout[txindex];
  if (!output) return { collateral: null, tier: null, missingOutput: `${txhash}:${txindex}` };

  const collateralTier = { collateral: output.value, tier: COLLATERAL_TIERS[output.value] || null };
  if (collateralTier.tier) storedCollateralTier = collateralTier;
  return collateralTier;
}

/**
 * To return the tier of a node in old naming scheme
 * @returns {Promise<string>} basic, super or bamf. Throws when the node's
 *   collateral makes it no tier.
 */
async function nodeTier() {
  const { tier } = await nodeCollateralTier();
  if (!tier) throw new Error('Unrecognised Flux Node tier');
  return tier.tier;
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
 * @returns {Promise<number>} The quantity of collateral. Throws when the node's
 *   collateral makes it no tier.
 */
async function nodeCollateral() {
  const { collateral, tier } = await nodeCollateralTier();
  if (!tier) throw new Error('Unrecognised Flux Node Collateral');
  return collateral;
}

/**
 * Checks if a node's status is confirmed.
 * @returns {boolean} True if node is confirmed, false if not, throws exception if there is a problem with dameon.
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
    throw error;
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
 * @deprecated The image whitelist is retired - nothing has enforced it since
 * July 2024 and the network accepts any image (the blocklist still governs).
 * Kept returning an empty list so existing callers get a valid answer instead
 * of a 404. Remove once no supported release could still call it.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function whitelistedRepositories(req, res) {
  const resultsResponse = messageHelper.createDataMessage([]);
  res.json(resultsResponse);
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
 * Set the held collateral by its amount, or clear it with null - created for testing purposes
 * @param {(number|null)} collateral Collateral amount.
 */
function setStoredCollateral(collateral) {
  storedCollateralTier = collateral === null
    ? null
    : { collateral, tier: COLLATERAL_TIERS[collateral] || null };
}

/**
 * Returns the held collateral amount - created for testing purposes
 * @returns {(number|null)} Collateral amount.
 */
function getStoredCollateral() {
  return storedCollateralTier ? storedCollateralTier.collateral : null;
}

/**
 * Returns the held tier in old naming scheme - created for testing purposes
 * @returns {(string|null)} basic, super or bamf.
 */
function getStoredTier() {
  return storedCollateralTier && storedCollateralTier.tier ? storedCollateralTier.tier.tier : null;
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
  nodeCollateralTier,
  obtainNodeCollateralInformation,
  COLLATERAL_TIERS,

  // exported for testing purposes
  setStoredCollateral,
  getStoredCollateral,
  getStoredTier,
};
