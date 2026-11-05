const os = require('node:os');
const path = require('node:path');
const log = require('../../lib/log');
const asyncLock = require('../utils/asyncLock');
const fluxRpc = require('../utils/fluxRpc');
const daemonConfig = require('../utils/daemonConfig');
const fluxdCredentials = require('./fluxdCredentials');
const fluxEventBus = require('../utils/fluxEventBus');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');

const config = require('config');
const cacheManager = require('../utils/cacheManager').default;

let fluxdConfig = null;
let fluxdClient = null;
// True when the unit passes the node key as a credential: flux.conf is then never
// read, and fluxd is asked about itself (see fluxdCredentials).
let fluxdReportsItself = false;
let nodeKey = null;
// What fluxd reports about itself: fluxdIndexes {name: info} from getindexinfo,
// fluxdZmq {type: address} from getzmqnotifications. Null until fluxd first
// reports them; each later report replaces them, so once known they stay known.
let fluxdIndexes = null;
let fluxdZmq = null;
let fluxdWait = null;
// Why the current wait for fluxd has not ended; null while no wait is running.
let fluxdWaitingFor = null;
let fluxdLogin = null;
const FLUXD_POLL_MS = 5000;
const FLUXD_LOG_MS = 60000;
const RPC_IN_WARMUP = -28;
const FLUXD_RPC_PORT_UNPUBLISHED = 'FLUXD_RPC_PORT_UNPUBLISHED';

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
 * as a credential, take the key from it and leave flux.conf alone.
 *
 * Published only once it is parsed. Assigning first left a window in which the config was
 * set and empty, so a caller arriving during the read took it for a file with nothing in it.
 * @returns {Promise<void>}
 */
async function readDaemonConfig() {
  const key = await fluxdCredentials.loadNodeKey();
  const parsed = new daemonConfig.DaemonConfig();
  if (key !== null) {
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

/**
 * Where fluxd's RPC server listens: the port fluxd publishes beside a fluxd that
 * reports itself; otherwise flux.conf's rpcport, or the network's default.
 * @returns {Promise<number>}
 * @throws {Error} code FLUXD_RPC_PORT_UNPUBLISHED beside a fluxd that reports
 *   itself and publishes no port, which is while it is not running.
 */
async function fluxdRpcPort() {
  if (fluxdReportsItself) {
    const port = await fluxdCredentials.readFluxdRpcPort();
    if (port === null) {
      throw Object.assign(new Error(`fluxd has not published its RPC port in ${fluxdCredentials.FLUXD_FILE}`), { code: FLUXD_RPC_PORT_UNPUBLISHED });
    }
    return port;
  }
  return fluxdConfig.rpcport || config.daemon.rpcport;
}

/**
 * Builds the client fluxd is called through, from what is known about fluxd now.
 * @returns {Promise<fluxRpc.FluxRpc>}
 * @throws {Error} as fluxdRpcPort, or when the login cannot be read.
 */
async function buildFluxdClient() {
  await ensureConfigLoaded();

  // With no cookie yet (fluxd not started) the client sends no login, fluxd
  // answers 401, and the next call reads the cookie again.
  const auth = usesRpcCookie()
    ? await fluxdCredentials.readRpcCookie(rpcCookieFile())
    : { username: fluxdConfig.rpcuser || 'rpcuser', password: fluxdConfig.rpcpassword };

  const rpcPort = await fluxdRpcPort();

  const rpcHost = config.daemon.host;
  const client = new fluxRpc.FluxRpc(`http://${rpcHost}:${rpcPort}`, {
    auth, timeout: 40_000,
  });

  fluxdClient = client;

  return client;
}

/**
 * Logs in to fluxd again after it restarted: the cookie and the RPC port are read
 * again, and fluxd is asked about itself again (waitForFluxd) without holding up
 * the caller. Callers arriving together share one login.
 * @returns {Promise<void>}
 */
function loginAgain() {
  fluxdLogin ??= (async () => {
    fluxEventBus.count('fluxd:login');
    await buildFluxdClient();
    // eslint-disable-next-line no-use-before-define
    if (fluxdReportsItself) waitForFluxd();
  })().finally(() => { fluxdLogin = null; });
  return fluxdLogin;
}

/**
 * Runs `call` with the client. fluxd writes a new cookie at each start, so a 401
 * on a node that logs in with the cookie means fluxd restarted: the call logs in
 * again (loginAgain) unless another call already has since this one began, and
 * is made once more.
 * @template T
 * @param {function(fluxRpc.FluxRpc): Promise<T>} call
 * @returns {Promise<T>}
 */
async function callFluxd(call) {
  const client = fluxdClient;
  try {
    return await call(client);
  } catch (error) {
    if (!usesRpcCookie() || error.status !== 401) throw error;
    if (fluxdClient === client) await loginAgain();
    return call(fluxdClient);
  }
}

/**
 * Waits until fluxd answers and, where fluxd reports itself, has reported its
 * indexes and ZMQ notifications, asking every FLUXD_POLL_MS. What it reports
 * replaces what was held. Boot waits on this before the daemon is ready; a fluxd
 * restart starts it again. Concurrent callers share one wait.
 * @returns {Promise<number>} fluxd's block height.
 */
function waitForFluxd() {
  fluxdWait ??= (async () => {
    let lastLogAt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let reason;
      try {
        // eslint-disable-next-line no-await-in-loop
        if (!fluxdClient) await buildFluxdClient();
        const calls = [{ method: 'getblockcount' }];
        if (fluxdReportsItself) calls.push({ method: 'getindexinfo' }, { method: 'getzmqnotifications' });
        // eslint-disable-next-line no-await-in-loop
        const answers = await callFluxd((client) => client.runBatch(calls));
        const failed = answers.find((answer) => answer.error);
        if (!failed) {
          const height = answers[0].result;
          if (fluxdReportsItself) {
            fluxdIndexes = answers[1].result;
            fluxdZmq = Object.fromEntries(answers[2].result.map(({ type, address }) => [type, address]));
          }
          log.info(`Daemon RPC available at block height ${height}`);
          fluxEventBus.publish('daemon:rpcAvailable', { height });
          return height;
        }
        reason = failed.error.code === RPC_IN_WARMUP
          ? failed.error.message
          : `${calls[failed.id].method}: ${failed.error.message}`;
      } catch (error) {
        reason = error.code === RPC_IN_WARMUP ? error.message : `daemon not reachable: ${error.message}`;
      }
      fluxdWaitingFor = reason;
      const now = Date.now();
      if (!lastLogAt || now - lastLogAt >= FLUXD_LOG_MS) {
        log.info(`Waiting for daemon RPC... (${reason})`);
        lastLogAt = now;
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(FLUXD_POLL_MS);
    }
  })().finally(() => {
    fluxdWait = null;
    fluxdWaitingFor = null;
  });
  return fluxdWait;
}

/**
 * Whether an answer is asked for by a height. A height names whichever block is
 * on fluxd's active chain at it, which a reorganisation changes; a block hash
 * names one block for ever. Such an answer is never kept.
 * @param {string} rpc
 * @param {Array} params
 * @returns {boolean}
 */
function askedByHeight(rpc, params) {
  if (rpc === 'getBlockHash') return true;
  if (rpc === 'getBlock') return !/^[0-9a-f]{64}$/i.test(String(params[0]));
  return false;
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
  const useCache = (options.useCache ?? true) && !askedByHeight(rpc, rpcparameters);

  if (!fluxdClient) {
    try {
      await buildFluxdClient();
    } catch (error) {
      return messageHelper.createErrorMessage(error.message, error.name, error.code);
    }
  }

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
  return response;
}

/**
 * Execute a batch of RPC calls directly, bypassing cache and semaphore lock.
 * @param {Array<{method: string, params: Array}>} calls Array of RPC call specifications.
 * @returns {object} Message containing array of {id, result, error} objects.
 */
async function executeBatchCall(calls) {
  try {
    if (!fluxdClient) await buildFluxdClient();
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
 *   not yet reported its indexes (waitForFluxd).
 */
function insightIndexes() {
  if (!fluxdConfig) return null;
  if (fluxdReportsItself) return fluxdIndexes ? Boolean(fluxdIndexes.addressindex) : null;
  const value = fluxdConfig.get('insightexplorer');
  return value === 1 || value === '1';
}

fluxEventBus.snapshot('fluxd', () => ({
  selfReporting: fluxdReportsItself,
  waitingFor: fluxdWaitingFor,
  insightIndexes: insightIndexes(),
}));

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
 * fluxd's data directory: FLUXD_PATH, which the node image sets, otherwise ~/.flux.
 * @returns {string}
 */
function fluxdDataDir() {
  return process.env.FLUXD_PATH || path.join(os.homedir(), '.flux');
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
  buildFluxdClient,
  createBackupFluxdConfig,
  executeCall,
  executeBatchCall,
  fluxdDataDir,
  FLUXD_RPC_PORT_UNPUBLISHED,
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
  waitForFluxd,
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
