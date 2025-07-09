const { LRUCache } = require('lru-cache');

const asyncLock = require('../utils/asyncLock');
const fluxRpc = require('../utils/fluxRpc');
const daemonConfig = require('../utils/daemonConfig');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');

const config = require('config');
const userconfig = require('../../../../config/userconfig');

const { initial: { testnet: isTestnet } } = userconfig;

let fluxdConfig = null;
let fluxdClient = null;

/**
 * AsyncLock used to limit calls to the Daemon RPC endpoint
 */
const lock = new asyncLock.AsyncLock();

// default cache
const LRUoptions = {
  max: 500, // store 500 values for up to 20 seconds of other daemon calls
  ttl: 1000 * 20, // 20 seconds
  maxAge: 1000 * 20, // 20 seconds
};

const cache = new LRUCache(LRUoptions);

const LRUoptionsTxs = {
  max: 30000, // store 30000 values for up to 1 hour of other daemon calls
  ttl: 1000 * 60 * 60, // 1 hour
  maxAge: 1000 * 60 * 60, // 1 hour
};

const rawTxCache = new LRUCache(LRUoptionsTxs); // store 30k txs in cache

const LRUoptionsBlocks = {
  max: 1500, // store 1500 values for up to 1 hour of other daemon calls
  ttl: 1000 * 60 * 60, // 1 hour
  maxAge: 1000 * 60 * 60, // 1 hour
};

const blockCache = new LRUCache(LRUoptionsBlocks); // store 1.5k blocks in cache

async function readDaemonConfig() {
  fluxdConfig = new daemonConfig.DaemonConfig();
  await fluxdConfig.parseConfig();
}

async function buildFluxdClient() {
  if (!fluxdConfig) await readDaemonConfig();

  const username = fluxdConfig.rpcuser || 'rpcuser';
  const password = fluxdConfig.rpcpassword || 'rpcpassword';

  const portId = isTestnet ? 'rpcporttestnet' : 'rpcport';

  const rpcPort = fluxdConfig.rpcport || config.daemon[portId];

  const client = new fluxRpc.FluxRpc(`http://127.0.0.1:${rpcPort}`, {
    auth: { username, password }, timeout: 40_000,
  });

  fluxdClient = client;

  return client;
}

/**
 * To execute a remote procedure call (RPC).
 * @param {string} rpc Remote procedure call.
 * @param {string[]} params RPC parameters.
 * @param {{useCache?: boolean}} options
 * @returns {object} Message.
 */
async function executeCall(rpc, params, options = {}) {
  const rpcparameters = params || [];
  const useCache = options.useCache ?? true;

  if (!fluxdClient) await buildFluxdClient();

  /**
   * This used to wait a bunch of separate times if a call was already running
   * This averaged to be approx 635ms max. Eg Math.random * 250 would average to be 125ms.
   * So 125 100 75 50 50 60 50 40 30 25 20 10 = 635ms.
   *
   * So it wasn't really sync, as it would wait some time, then run anyway, even if a call
   * was already running.
   *
   * I don't really understand the intent of what this was trying to do. It was waiting a bit of time
   * then just running anyway.
   *
   * The biggest api call by far will be getting the network state, which right now, is 8.2Mb. On my test
   * machine, this takes approx 400-500ms.
   *
   * So in keeping with what we were doing, we now wait a max of 500ms, then run anyway.
   */

  await lock.readyTimeout(500);
  const lockedByOther = lock.locked;
  if (!lockedByOther) await lock.enable();

  try {
    let data;

    if (useCache && rpc === 'getBlock') {
      data = blockCache.get(rpc + serviceHelper.ensureString(rpcparameters));
    } else if (useCache && rpc === 'getRawTransaction') {
      data = rawTxCache.get(rpc + serviceHelper.ensureString(rpcparameters));
    } else if (useCache) {
      data = cache.get(rpc + serviceHelper.ensureString(rpcparameters));
    }

    if (!data) {
      data = await fluxdClient.run(rpc, { params: rpcparameters });
      if (useCache && rpc === 'getBlock') {
        blockCache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      } else if (useCache && rpc === 'getRawTransaction') {
        rawTxCache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      } else if (useCache) {
        cache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      }
    }
    const successResponse = messageHelper.createDataMessage(data);
    return successResponse;
  } catch (error) {
    const daemonError = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return daemonError;
  } finally {
    if (!lockedByOther) lock.disable();
  }
}

/**
 * Sets standard cache data.
 * Created for testing purposes.
 *
 * @param {object} key
 * @param {object} value
 */
function setStandardCache(key, value) {
  cache.set(key, value);
}

/**
 * Gets standard cache data.
 * Created for testing purposes.
 *
 * @param {object} key
 *
 * @returns {object} cached data
 */
function getStandardCache(key) {
  return cache.get(key);
}

/**
 * Sets rawTx cache data.
 * Created for testing purposes.
 *
 * @param {object} key
 * @param {object} value
 */
function setRawTxCache(key, value) {
  rawTxCache.set(key, value);
}

/**
 * Gets rawTxCache data.
 * Created for testing purposes.
 *
 * @param {object} key
 *
 * @returns {object} cached data
 */
function getRawTxCacheCache(key) {
  return rawTxCache.get(key);
}

/**
 * Sets block cache data.
 * Created for testing purposes.
 *
 * @param {object} key
 * @param {object} value
 */
function setBlockCache(key, value) {
  blockCache.set(key, value);
}

/**
 * Gets blockCache data.
 * Created for testing purposes.
 *
 * @param {object} key
 *
 * @returns {object} cached data
 */
function getBlockCache(key) {
  return blockCache.get(key);
}

/**
 * To get a value for a specified key from the configuration file.
 * @param {string} parameter Config key.
 * @returns {string} Config value.
 */
function getConfigValue(parameter) {
  if (!fluxdConfig) return undefined;

  const value = fluxdConfig.get(parameter);
  return value;
}

/**
 * To set a value for a specified key from the configuration file.
 * @param {string} parameter Config key.
 * @param {string} value Config key value.
 * @param {{replace?: boolean}} options
 * @returns {<void>}
 */
function setConfigValue(parameter, value, options = {}) {
  if (!fluxdConfig) return;

  const replace = options.replace || false;

  fluxdConfig.set(parameter, value, replace);
}

/**
 * The DaemonConfig object
 * @returns {daemonConfig.DaemonConfig}
 */
function getFluxdConfig() {
  return fluxdConfig;
}

/**
 * The fluxd config file path
 * @returns {string}
 */
function getFluxdConfigPath() {
  return fluxdConfig.absConfigPath;
}

/**
 * The fluxd config directory
 * @returns {string}
 */
function getFluxdDir() {
  if (!fluxdConfig) return undefined;

  return fluxdConfig.configDir;
}

/**
 * The fluxd daemon rpc client
 * @returns {daemonrpc.Client}
 */
function getFluxdClient() {
  return fluxdClient;
}

/**
 *  writes a flux config to the fluxd config directory
 * @param {string?} fileName The name of the config file to write. If empty, this
 * defaults to flux.conf
 * @returns {Promise<Boolean>}
 */
async function writeFluxdConfig(fileName = null) {
  await fluxdConfig.write({ fileName });
}

/**
 *
 * @param {string} fileName The name of the backup file to write (in the fluxd conf dir)
 * @returns {Promise<boolean>}
 */
async function createBackupFluxdConfig(fileName) {
  if (!fileName) return false;

  return fluxdConfig.createBackupConfig(fileName);
}

/**
 * Testing
 */
function setFluxdClient(testClient) {
  fluxdClient = testClient;
}

module.exports = {
  buildFluxdClient,
  createBackupFluxdConfig,
  executeCall,
  getConfigValue,
  getFluxdClient,
  getFluxdConfig,
  getFluxdConfigPath,
  getFluxdDir,
  readDaemonConfig,
  setConfigValue,
  writeFluxdConfig,

  // exports for testing purposes
  getBlockCache,
  getRawTxCacheCache,
  getStandardCache,
  setBlockCache,
  setFluxdClient,
  setRawTxCache,
  setStandardCache,
};
