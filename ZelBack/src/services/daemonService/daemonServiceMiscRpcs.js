const config = require('config');
const messageHelper = require('../messageHelper');
const daemonServiceUtils = require('./daemonServiceUtils');
const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');

let currentDaemonHeight = 0;
let currentDaemonHeader = config.daemon.initialHeaderFloor;
let lastSuccessfulRpcCall = null; // Track last successful getBlockchainInfo call
// Called with the daemon's height after each poll that reads it.
const heightListeners = new Set();

/**
 * Whether fluxd keeps the insight explorer's indexes. False only before fluxd
 * first reports them; from boot on (waitForFluxd), fluxd's latest answer.
 * @returns {boolean}
 */
function isInsightExplorer() {
  return daemonServiceUtils.insightIndexes() === true;
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

/**
 * Calls `listener` with the daemon's height after each poll that reads it.
 * @param {function(number): (void|Promise<void>)} listener
 * @returns {function(): void} Stops the calls.
 */
function onDaemonHeight(listener) {
  heightListeners.add(listener);
  return () => { heightListeners.delete(listener); };
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

// A chain fact since the PON fork.
const BLOCK_MS = 30 * 1000;

/**
 * The chain's height now: while the daemon is synced to the chain's tip, the
 * height it last reported and a block for every BLOCK_MS since it reported it;
 * 0 - unknown - otherwise. The daemon is still taken as synced for a while after
 * its last answer, and the chain moves on meanwhile. A daemon behind the tip,
 * catching up or re-syncing, reports a height below the heights recorded while
 * it was synced, and would read every one of them as recent.
 * @returns {number}
 */
function chainHeight() {
  const { synced, height } = isDaemonSynced().data;
  if (!synced || !(height > 0)) return 0;
  return height + Math.max(0, Math.floor((Date.now() - lastSuccessfulRpcCall) / BLOCK_MS));
}

module.exports = {
  isInsightExplorer,
  // == NON Daemon ==
  isDaemonSynced,
  chainHeight,
  daemonBlockchainInfoService,
  onDaemonHeight,

  // exports for testing purposes
  fluxDaemonBlockchainInfo,
  setCurrentDaemonHeight,
  setCurrentDaemonHeader,
  getCurrentDaemonHeight,
  getCurrentDaemonHeader,
  getLastSuccessfulRpcCall,
  setLastSuccessfulRpcCall,
};
