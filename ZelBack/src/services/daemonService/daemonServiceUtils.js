const path = require('node:path');
const log = require('../../lib/log');
const asyncLock = require('../utils/asyncLock');
const fluxRpc = require('../utils/fluxRpc');
const daemonConfig = require('../utils/daemonConfig');
const fluxdCredentials = require('./fluxdCredentials');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');

const config = require('config');
const configManager = require('../utils/configManager');
const cacheManager = require('../utils/cacheManager').default;

// Helper function to get testnet flag dynamically
const isTestnet = () => configManager.getConfigValue('initial.testnet') || false;

let fluxdConfig = null;
let fluxdClient = null;
// True when the unit passes the node key as a credential: flux.conf is then never
// read, and fluxd is asked about itself (see fluxdCredentials).
let fluxdReportsItself = false;
let nodeKey = null;
// What fluxd reports about itself, each kept as soon as fluxd gives it:
// fluxdIndexes {name: info} from getindexinfo, fluxdZmq {type: address} from
// getzmqnotifications. Null until fluxd reports it, and again after fluxd restarts.
let fluxdIndexes = null;
let fluxdZmq = null;
let fluxdFactsLoading = null;
// When a fetch last left a fact unknown (Date.now()); 0 when none has.
let fluxdFactsFailedAt = 0;
// A fetch makes up to FACTS_ATTEMPTS attempts FACTS_RETRY_MS apart, and one that
// leaves a fact unknown is not repeated within FACTS_REFETCH_MS.
const FACTS_ATTEMPTS = 3;
const FACTS_RETRY_MS = 2000;
const FACTS_REFETCH_MS = 30_000;
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
    log.info(`Testnet mode changed, rebuilt daemon RPC client on port ${rpcPort}`);
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

/**
 * Parse flux.conf into the module's config, or, when the unit passes the node key
 * as a credential, take the key from it and resolve flux.conf's path without
 * reading the file.
 *
 * Published only once it is parsed. Assigning first left a window in which the config was
 * set and empty, so a caller arriving during the read took it for a file with nothing in it.
 * @returns {Promise<void>}
 */
async function readDaemonConfig() {
  const key = await fluxdCredentials.loadNodeKey();
  const parsed = new daemonConfig.DaemonConfig();
  if (key !== null) {
    await parsed.resolvePaths();
    nodeKey = key;
    fluxdReportsItself = true;
  } else {
    await parsed.parseConfig();
  }
  fluxdConfig = parsed;
}

/**
 * Parse flux.conf if nothing has yet.
 *
 * flux.conf is a local file and reading it involves no daemon at all - but until this was
 * something a caller could ask for, it was parsed only as a side effect of building the RPC
 * client. Anything that wanted a config value before the first RPC read undefined, and that
 * looked exactly like the daemon being down.
 * @returns {Promise<void>}
 */
async function ensureConfigLoaded() {
  // Two callers arriving before either finishes both parse the file. Left alone: they read
  // the same local file and write the same result, so it costs one duplicate parse at boot.
  if (!fluxdConfig) await readDaemonConfig();
}

/**
 * Whether fluxd authenticates this node's RPC with its cookie: always beside a
 * fluxd that reports itself, and beside any fluxd whose flux.conf sets no
 * rpcpassword, as fluxd then uses only its cookie.
 * @returns {boolean}
 */
function usesRpcCookie() {
  return fluxdReportsItself || !fluxdConfig?.rpcpassword;
}

/**
 * Where fluxd writes its RPC cookie: the fixed path beside a fluxd that reports
 * itself; otherwise flux.conf's rpccookiefile, a relative one inside fluxd's data
 * directory, or that directory's .cookie.
 * @returns {string}
 */
function rpcCookieFile() {
  if (fluxdReportsItself) return fluxdCredentials.RPC_COOKIE_FILE;
  const datadir = fluxdConfig.dataDir;
  const configured = fluxdConfig.get('rpccookiefile');
  if (!configured) return path.join(datadir, '.cookie');
  return path.isAbsolute(configured) ? configured : path.join(datadir, configured);
}

async function buildFluxdClient() {
  await ensureConfigLoaded();

  // With no cookie yet (fluxd not started) the client sends no login, fluxd
  // answers 401, and the next call reads the cookie again.
  const auth = usesRpcCookie()
    ? await fluxdCredentials.readRpcCookie(rpcCookieFile())
    : { username: fluxdConfig.rpcuser || 'rpcuser', password: fluxdConfig.rpcpassword };

  const portId = isTestnet() ? 'rpcporttestnet' : 'rpcport';

  const rpcPort = fluxdConfig.rpcport || config.daemon[portId];

  const rpcHost = config.daemon.host;
  const client = new fluxRpc.FluxRpc(`http://${rpcHost}:${rpcPort}`, {
    auth, timeout: 40_000,
  });

  fluxdClient = client;

  return client;
}

/**
 * Runs `call` with the client. fluxd writes a new cookie at each start, so a 401
 * on a node that logs in with the cookie means fluxd restarted: the cookie is read
 * again, what fluxd reported about itself is forgotten, and the call is made once
 * more.
 * @template T
 * @param {function(fluxRpc.FluxRpc): Promise<T>} call
 * @returns {Promise<T>}
 */
async function callFluxd(call) {
  try {
    return await call(fluxdClient);
  } catch (error) {
    if (!usesRpcCookie() || error.status !== 401) throw error;
    forgetFluxdFacts();
    await buildFluxdClient();
    return call(fluxdClient);
  }
}

/**
 * Forgets what fluxd reported about itself: it restarted.
 * @returns {void}
 */
function forgetFluxdFacts() {
  fluxdIndexes = null;
  fluxdZmq = null;
  fluxdFactsFailedAt = 0;
}

/**
 * Asks fluxd for whichever of its indexes and ZMQ notifications is not yet known,
 * once per start of fluxd. Each answer is kept as soon as fluxd gives it. A fetch
 * makes up to FACTS_ATTEMPTS attempts, so the address-index check made right after
 * fluxd's first answer is not decided by one transient failure; a fetch that still
 * leaves a fact unknown is not repeated for FACTS_REFETCH_MS. Concurrent callers
 * share one fetch.
 * @returns {Promise<void>}
 */
async function ensureFluxdFacts() {
  if (!fluxdReportsItself || (fluxdIndexes && fluxdZmq)) return;
  if (fluxdFactsFailedAt && Date.now() - fluxdFactsFailedAt < FACTS_REFETCH_MS) return;
  if (!fluxdFactsLoading) {
    fluxdFactsLoading = (async () => {
      let lastError = null;
      for (let attempt = 1; attempt <= FACTS_ATTEMPTS; attempt += 1) {
        const calls = [];
        if (!fluxdIndexes) calls.push({ method: 'getindexinfo' });
        if (!fluxdZmq) calls.push({ method: 'getzmqnotifications' });
        try {
          // eslint-disable-next-line no-await-in-loop
          const answers = await callFluxd((client) => client.runBatch(calls));
          answers.forEach((answer, i) => {
            if (answer.error) {
              lastError = new Error(`${calls[i].method}: ${answer.error.message}`);
            } else if (calls[i].method === 'getindexinfo') {
              fluxdIndexes = answer.result;
            } else {
              fluxdZmq = Object.fromEntries(answer.result.map(({ type, address }) => [type, address]));
            }
          });
        } catch (error) {
          lastError = error;
        }
        if (fluxdIndexes && fluxdZmq) break;
        // eslint-disable-next-line no-await-in-loop
        if (attempt < FACTS_ATTEMPTS) await serviceHelper.delay(FACTS_RETRY_MS);
      }
      if (fluxdIndexes && fluxdZmq) {
        fluxdFactsFailedAt = 0;
      } else {
        fluxdFactsFailedAt = Date.now();
        log.error(`fluxd did not report ${fluxdIndexes ? 'its ZMQ notifications' : 'its indexes'}: ${lastError?.message}`);
      }
    })().finally(() => { fluxdFactsLoading = null; });
  }
  await fluxdFactsLoading;
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

  let response;
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
      data = await callFluxd((client) => client.run(rpc, { params: rpcparameters }));
      if (useCache && rpc === 'getBlock') {
        blockCache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      } else if (useCache && rpc === 'getRawTransaction') {
        rawTxCache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      } else if (useCache) {
        cache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      }
    }
    response = messageHelper.createDataMessage(data);
  } catch (error) {
    response = messageHelper.createErrorMessage(error.message, error.name, error.code);
  } finally {
    lock.disable();
  }
  // fluxd answered: before any caller acts on the answer, learn what fluxd keeps,
  // so a check made right after its first answer reads fluxd's facts.
  if (response.status === 'success') await ensureFluxdFacts();
  return response;
}

/**
 * Execute a batch of RPC calls directly, bypassing cache and semaphore lock.
 * @param {Array<{method: string, params: Array}>} calls Array of RPC call specifications.
 * @returns {object} Message containing array of {id, result, error} objects.
 */
async function executeBatchCall(calls) {
  if (!fluxdClient) await buildFluxdClient();

  try {
    const data = await callFluxd((client) => client.runBatch(calls));
    return messageHelper.createDataMessage(data);
  } catch (error) {
    return messageHelper.createErrorMessage(error.message, error.name, error.code);
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
 *
 * When fluxd reports itself, flux.conf is not read: `zelnodeprivkey` is the
 * credential, `zmqpub<type>` the address fluxd reports publishing that type on,
 * and every other key undefined.
 * @param {string} parameter Config key.
 * @returns {string} Config value.
 */
function getConfigValue(parameter) {
  if (!fluxdConfig) return undefined;

  if (!fluxdReportsItself) return fluxdConfig.get(parameter);

  if (parameter === 'zelnodeprivkey') return nodeKey;
  if (parameter.startsWith('zmqpub')) return fluxdZmq?.[parameter.slice('zmq'.length)];
  return undefined;
}

/**
 * Whether fluxd keeps the insight explorer's indexes (address, spent, timestamp).
 * @returns {boolean|null} Null while not known: flux.conf not yet read, or fluxd
 *   not yet asked.
 */
function insightIndexes() {
  if (!fluxdConfig) return null;
  if (fluxdReportsItself) return fluxdIndexes ? Boolean(fluxdIndexes.addressindex) : null;
  const value = fluxdConfig.get('insightexplorer');
  return value === 1 || value === '1';
}

/**
 * Whether fluxd keeps the address index.
 * @returns {boolean|null} Null while not known, as insightIndexes.
 */
function addressIndex() {
  if (!fluxdConfig) return null;
  if (fluxdReportsItself) return fluxdIndexes ? Boolean(fluxdIndexes.addressindex) : null;
  const value = fluxdConfig.get('addressindex');
  return value === 1 || value === '1';
}

/**
 * Whether fluxd is asked about itself rather than read from flux.conf.
 * @returns {boolean}
 */
function isFluxdSelfReporting() {
  return fluxdReportsItself;
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
  if (fluxdReportsItself) throw new Error('flux.conf is not FluxOS\'s to write on this node');
  await fluxdConfig.write({ fileName });
}

/**
 *
 * @param {string} fileName The name of the backup file to write (in the fluxd conf dir)
 * @returns {Promise<boolean>}
 */
async function createBackupFluxdConfig(fileName) {
  if (!fileName) return false;
  if (fluxdReportsItself) throw new Error('flux.conf is not FluxOS\'s to copy on this node');

  return fluxdConfig.createBackupConfig(fileName);
}

/**
 * Testing
 */
function setFluxdClient(testClient) {
  fluxdClient = testClient;
}

module.exports = {
  addressIndex,
  buildFluxdClient,
  createBackupFluxdConfig,
  executeCall,
  executeBatchCall,
  getConfigValue,
  getFluxdClient,
  getFluxdConfig,
  getFluxdConfigPath,
  getFluxdDir,
  insightIndexes,
  isFluxdSelfReporting,
  readDaemonConfig,
  ensureConfigLoaded,
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
