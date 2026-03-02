const asyncLock = require('../utils/asyncLock');
const fluxRpc = require('../utils/fluxRpc');
const daemonConfig = require('../utils/daemonConfig');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');

const config = require('config');
const configManager = require('../utils/configManager');
const cacheManager = require('../utils/cacheManager').default;

// Helper function to get testnet flag dynamically
const isTestnet = () => configManager.getConfigValue('initial.testnet') || false;

let fluxdConfig = null;
let fluxdClient = null;
let previousTestnetValue = isTestnet();

// Listen for config changes and rebuild RPC client if testnet mode changes
configManager.on('configReloaded', async (newConfig) => {
  const newTestnetValue = newConfig.initial?.testnet || false;
  if (newTestnetValue !== previousTestnetValue) {
    previousTestnetValue = newTestnetValue;
    // Rebuild RPC client with new port
    await buildFluxdClient();
    const portId = isTestnet() ? 'rpcporttestnet' : 'rpcport';
    const rpcPort = fluxdConfig?.rpcport || config.daemon[portId];
    serviceHelper.log('info', `Testnet mode changed, rebuilt daemon RPC client on port ${rpcPort}`);
  }
});

/**
 * AsyncLock used to limit concurrent calls to the Daemon RPC endpoint.
 * Semaphore with 5 slots to prevent a single long-running RPC (e.g.
 * createConfirmationTransaction) from blocking unrelated RPCs like loginPhrase.
 */
const lock = new asyncLock.AsyncLock(5);

const cache = cacheManager.daemonGenericCache;
const rawTxCache = cacheManager.daemonTxCache;
const blockCache = cacheManager.daemonBlockCache;

async function readDaemonConfig() {
  fluxdConfig = new daemonConfig.DaemonConfig();
  await fluxdConfig.parseConfig();
}

async function buildFluxdClient() {
  if (!fluxdConfig) await readDaemonConfig();

  const username = fluxdConfig.rpcuser || 'rpcuser';
  const password = fluxdConfig.rpcpassword || 'rpcpassword';

  const portId = isTestnet() ? 'rpcporttestnet' : 'rpcport';

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

  await lock.enable();

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
    lock.disable();
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
