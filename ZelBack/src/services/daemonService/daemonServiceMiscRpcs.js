const messageHelper = require('../messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const daemonServiceBlockchainRpcs = require('./daemonServiceBlockchainRpcs');

const log = require('../../lib/log');
const userconfig = require('../../../../config/userconfig');

const isTestnet = userconfig.initial.testnet;

let currentDaemonHeight = 0;
let currentDaemonHeader = isTestnet === true ? 377006 : 1136836;
let isDaemonInsightExplorer = null;

/**
 * To check if Insight Explorer is activated in the daemon configuration file.
 * @returns {boolean} True if the daemon is configured with Insight Explorer on.
 */
function isInsightExplorer() {
  if (isDaemonInsightExplorer != null) {
    return isDaemonInsightExplorer;
  }
  const insightValue = daemonServiceUtils.getConfigValue('insightexplorer');
  if (insightValue === 1 || insightValue === '1') {
    isDaemonInsightExplorer = true;
    return true;
  }
  isDaemonInsightExplorer = false;
  return false;
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
    if (daemonBlockChainInfo.status !== 'success') {
      return log.error(daemonBlockChainInfo.data.message || daemonBlockChainInfo.data);
    }
    currentDaemonHeight = daemonBlockChainInfo.data.blocks;
    if (daemonBlockChainInfo.data.headers >= currentDaemonHeader) {
      currentDaemonHeader = daemonBlockChainInfo.data.headers;
    }
    return log.info(`Daemon Sync status: ${currentDaemonHeight}/${currentDaemonHeader}`);
  } catch (error) {
    return log.warn(error);
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

function getIsDaemonInsightExplorer() {
  return isDaemonInsightExplorer;
}

function setIsDaemonInsightExplorer(newValue) {
  isDaemonInsightExplorer = newValue;
}

function setCurrentDaemonHeight(newValue) {
  currentDaemonHeight = newValue;
}

function setCurrentDaemonHeader(newValue) {
  currentDaemonHeader = newValue;
}

function getCurrentDaemonHeight() {
  return currentDaemonHeight;
}

function getCurrentDaemonHeader() {
  return currentDaemonHeader;
}

module.exports = {
  isInsightExplorer,
  // == NON Daemon ==
  isDaemonSynced,
  daemonBlockchainInfoService,

  // exports for testing purposes
  fluxDaemonBlockchainInfo,
  getIsDaemonInsightExplorer,
  setIsDaemonInsightExplorer,
  setCurrentDaemonHeight,
  setCurrentDaemonHeader,
  getCurrentDaemonHeight,
  getCurrentDaemonHeader,
};
