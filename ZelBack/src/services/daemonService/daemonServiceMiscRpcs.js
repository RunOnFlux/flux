const config = require('config');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const daemonServiceBlockchainRpcs = require('./daemonServiceBlockchainRpcs');
const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');

let currentDaemonHeight = 0;
let currentDaemonHeader = config.daemon.initialHeaderFloor;
let isDaemonInsightExplorer = null;
let lastSuccessfulRpcCall = null; // Track last successful getBlockchainInfo call
// Called with the daemon's height after each poll that reads it.
const heightListeners = new Set();

/**
 * Whether fluxd keeps the insight explorer's indexes. The answer is kept once
 * known; while it is not (flux.conf not yet read, or fluxd not yet asked) this
 * answers false and asks again next time.
 * @returns {boolean}
 */
function isInsightExplorer() {
  if (isDaemonInsightExplorer != null) {
    return isDaemonInsightExplorer;
  }
  const known = daemonServiceUtils.insightIndexes();
  if (known === null) return false;
  isDaemonInsightExplorer = known;
  return known;
}

/**
 * Whether fluxd keeps the address index, which answers getaddressdeltas and
 * getaddresstxids. False while not known.
 * @returns {boolean}
 */
function isAddressIndex() {
  return daemonServiceUtils.addressIndex() === true;
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
    const daemonBlockChainInfo = await daemonServiceUtils.executeCall('getBlockchainInfo', [], { useCache: false });
    if (daemonBlockChainInfo.status !== 'success') {
      log.error(daemonBlockChainInfo.data.message || daemonBlockChainInfo.data);
      return false;
    }
    currentDaemonHeight = daemonBlockChainInfo.data.blocks;
    if (daemonBlockChainInfo.data.headers >= currentDaemonHeader) {
      currentDaemonHeader = daemonBlockChainInfo.data.headers;
    }
    lastSuccessfulRpcCall = Date.now();
    fluxEventBus.publish('daemon:polled', { height: currentDaemonHeight, headers: currentDaemonHeader });
    heightListeners.forEach((listener) => {
      Promise.resolve().then(() => listener(currentDaemonHeight)).catch((error) => log.error(error));
    });
    log.info(`Daemon Sync status: ${currentDaemonHeight}/${currentDaemonHeader}`);
    return true;
  } catch (error) {
    log.warn(error);
    return false;
  }
}

/**
 * To call the flux daemon blockchain info function at set intervals.
 */
async function daemonBlockchainInfoService() {
  let reachable = null;
  async function pollAndEmit() {
    const succeeded = await fluxDaemonBlockchainInfo();
    if (reachable !== succeeded) {
      reachable = succeeded;
      fluxEventBus.publish(succeeded ? 'daemon:recovered' : 'daemon:unreachable', {});
    }
  }
  await pollAndEmit();
  function scheduleNext() {
    setTimeout(async () => {
      await pollAndEmit();
      scheduleNext();
    }, config.fluxapps.daemonInfoIntervalMs ?? 30000);
  }
  scheduleNext();
}

const RPC_IN_WARMUP = -28;

/**
 * Wait for the daemon RPC to become available.
 * Polls getblockcount every 5 seconds until a successful response.
 * @returns {Promise<number>} The block height once RPC is available.
 */
async function waitForDaemonRpc() {
  const POLL_INTERVAL_MS = 5000;
  const LOG_INTERVAL_MS = 60000;
  let lastLogAt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await daemonServiceBlockchainRpcs.getBlockCount();
    if (result.status === 'success') {
      log.info(`Daemon RPC available at block height ${result.data}`);
      return result.data;
    }
    const now = Date.now();
    if (!lastLogAt || now - lastLogAt >= LOG_INTERVAL_MS) {
      const reason = result.data?.code === RPC_IN_WARMUP
        ? result.data.message
        : 'daemon not reachable';
      log.info(`Waiting for daemon RPC... (${reason})`);
      lastLogAt = now;
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(POLL_INTERVAL_MS);
  }
}

/**
 * Calls `listener` with the daemon's height after each poll that reads it.
 * @param {function(number): (void|Promise<void>)} listener
 * @returns {function(): void} Stops the calls.
 */
function onDaemonHeight(listener) {
  heightListeners.add(listener);
  return () => { heightListeners.delete(listener); };
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
  isAddressIndex,
  isInsightExplorer,
  // == NON Daemon ==
  isDaemonSynced,
  daemonBlockchainInfoService,
  waitForDaemonRpc,
  onDaemonHeight,

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
