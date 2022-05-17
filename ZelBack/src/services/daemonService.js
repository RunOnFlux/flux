const fullnode = require('fullnode');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const daemonServiceBlockchainRpcs = require('./daemonServiceBlockchainRpcs');

const log = require('../lib/log');
const userconfig = require('../../../config/userconfig');

const fnconfig = new fullnode.Config();
const isTestnet = userconfig.initial.testnet;

let currentDaemonHeight = 0;
let currentDaemonHeader = isTestnet === true ? 249187 : 1102828;
let isDaemonInsightExplorer = null;

let response = messageHelper.createErrorMessage();

/**
 * To get a value for a specified key from the configuration file.
 * @param {string} parameter Config key.
 * @returns {string} Config value.
 */
function getConfigValue(parameter) {
  const value = fnconfig.get(parameter);
  return value;
}

/**
 * To check if Insight Explorer is activated in the daemon configuration file.
 * @returns {boolean} True if the daemon is configured with Insight Explorer on.
 */
function isInsightExplorer() {
  if (isDaemonInsightExplorer != null) {
    return isDaemonInsightExplorer;
  }
  const insightValue = getConfigValue('insightexplorer');
  if (insightValue === 1 || insightValue === '1') {
    isDaemonInsightExplorer = true;
    return true;
  }
  isDaemonInsightExplorer = false;
  return false;
}

// == Control ==
/**
 * To request help message. Command required as parameter for RPC call.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function help(req, res) {
  let { command } = req.params; // we accept both help/command and help?command=getinfo
  command = command || req.query.command || '';

  const rpccall = 'help';
  const rpcparameters = [command];

  response = await daemonServiceUtils.executeCall(rpccall, rpcparameters);

  return res ? res.json(response) : response;
}

/**
 * To get info on daemon version and RPC port. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function getInfo(req, res) {
  const rpccall = 'getInfo';

  response = await daemonServiceUtils.executeCall(rpccall);
  if (res) {
    const authorized = await verificationHelper.verifyPrivilege('admin', req);
    if (authorized !== true) {
      delete response.data.balance;
    }
  } else {
    delete response.data.balance;
  }

  return res ? res.json(response) : response;
}

/**
 * To stop node daemon. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function stop(req, res) { // practically useless
  const authorized = await verificationHelper.verifyPrivilege('admin', req);
  if (authorized === true) {
    const rpccall = 'stop';

    response = await daemonServiceUtils.executeCall(rpccall);
  } else {
    response = messageHelper.errUnauthorizedMessage();
  }

  return res ? res.json(response) : response;
}

// == NON Daemon ==
/**
 * To check if daemon is synced.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function isDaemonSynced(req, res) {
  const isSynced = {
    header: currentDaemonHeader,
    height: currentDaemonHeight,
    synced: false,
  };
  if (currentDaemonHeight > currentDaemonHeader - 5) {
    isSynced.synced = true;
  }
  const successResponse = messageHelper.createDataMessage(isSynced);
  return res ? res.json(successResponse) : successResponse;
}

/**
 * To show flux daemon blockchain sync status in logs.
 */
async function fluxDaemonBlockchainInfo() {
  try {
    const daemonBlockChainInfo = await daemonServiceBlockchainRpcs.getBlockchainInfo();
    if (daemonBlockChainInfo.status === 'success') {
      currentDaemonHeight = daemonBlockChainInfo.data.blocks;
      if (daemonBlockChainInfo.data.headers >= currentDaemonHeader) {
        currentDaemonHeader = daemonBlockChainInfo.data.headers;
      }
      log.info(`Daemon Sync status: ${currentDaemonHeight}/${currentDaemonHeader}`);
    } else {
      log.error(daemonBlockChainInfo.data.message || daemonBlockChainInfo.data);
    }
  } catch (error) {
    log.warn(error);
  }
}

/**
 * To call the flux daemon blockchain info function at set intervals.
 */
function daemonBlockchainInfoService() {
  fluxDaemonBlockchainInfo();
  setInterval(() => {
    fluxDaemonBlockchainInfo();
  }, 60 * 1000);
}

module.exports = {
  getConfigValue,
  isInsightExplorer,
  // == Control ==
  help,
  getInfo,
  stop,

  // == NON Daemon ==
  isDaemonSynced,
  daemonBlockchainInfoService,
};
