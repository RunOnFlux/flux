const messageHelper = require('../messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const daemonServiceBlockchainRpcs = require('./daemonServiceBlockchainRpcs');
const log = require('../../lib/log');
const configManager = require('../utils/configManager');

/**
 * Get the default daemon header based on testnet configuration
 * @returns {number} Default header height
 */
function getDefaultDaemonHeader() {
  const isTestnet = globalThis.userconfig.initial?.testnet === true;
  return isTestnet ? 377006 : 1136836;
}

let currentDaemonHeight = 0;
let currentDaemonHeader = getDefaultDaemonHeader();
let isDaemonInsightExplorer = null;
let previousTestnetValue = globalThis.userconfig.initial?.testnet;
let lastSuccessfulRpcCall = null; // Track last successful getBlockchainInfo call

// Listen for config changes and reset header if testnet mode changes
configManager.on('configReloaded', (newConfig) => {
  const newTestnetValue = newConfig.initial?.testnet;
  if (newTestnetValue !== previousTestnetValue) {
    previousTestnetValue = newTestnetValue;
    currentDaemonHeader = getDefaultDaemonHeader();
    log.info(`Testnet mode changed, reset daemon header to ${currentDaemonHeader}`);
  }
});

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

  // Check if we have recent successful RPC communication (within 10 blocks = 300 seconds)
  const RPC_TIMEOUT_MS = 10 * 30 * 1000; // 10 blocks * 30 seconds per block
  const now = Date.now();

  if (lastSuccessfulRpcCall === null || (now - lastSuccessfulRpcCall) > RPC_TIMEOUT_MS) {
    // No recent successful RPC call - daemon is not responding
    isSynced.synced = false;
  } else if (currentDaemonHeight > currentDaemonHeader - 5) {
    // Recent RPC call AND height is close to header
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
    lastSuccessfulRpcCall = Date.now();
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
  }, 30 * 1000);
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

function getLastSuccessfulRpcCall() {
  return lastSuccessfulRpcCall;
}

function setLastSuccessfulRpcCall(newValue) {
  lastSuccessfulRpcCall = newValue;
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
  getLastSuccessfulRpcCall,
  setLastSuccessfulRpcCall,
};
