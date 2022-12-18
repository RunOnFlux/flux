import fullnode from 'fullnode';
import LRU from 'lru-cache';
import serviceHelper from '../serviceHelper.js';
import messageHelper from '../messageHelper.js';
import client from '../utils/daemonrpcClient.js';

const fnconfig = new fullnode.Config();

// default cache
const LRUoptions = {
  max: 500, // store 500 values for up to 20 seconds of other daemon calls
  maxAge: 1000 * 20, // 20 seconds
};

const cache = new LRU(LRUoptions);

const LRUoptionsTxs = {
  max: 30000, // store 30000 values for up to 1 hour of other daemon calls
  maxAge: 1000 * 60 * 60, // 1 hour
};

const rawTxCache = new LRU(LRUoptionsTxs); // store 30k txs in cache

const LRUoptionsBlocks = {
  max: 1500, // store 1500 values for up to 1 hour of other daemon calls
  maxAge: 1000 * 60 * 60, // 1 hour
};

const blockCache = new LRU(LRUoptionsBlocks); // store 1.5k blocks in cache

let daemonCallRunning = false;

/**
 * To execute a remote procedure call (RPC).
 * @param {string} rpc Remote procedure call.
 * @param {string[]} params RPC parameters.
 * @returns {object} Message.
 */
async function executeCall(rpc, params) {
  const rpcparameters = params || [];
  try {
    let data;
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 250)) + 60;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 200)) + 50;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 150)) + 40;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 100)) + 30;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 75)) + 25;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 50)) + 20;
      await serviceHelper.delay(randomDelay);
    }
    if (daemonCallRunning) {
      const randomDelay = Math.floor((Math.random() * 25)) + 10;
      await serviceHelper.delay(randomDelay);
    }
    if (rpc === 'getBlock') {
      data = blockCache.get(rpc + serviceHelper.ensureString(rpcparameters));
    } else if (rpc === 'getRawTransaction') {
      data = rawTxCache.get(rpc + serviceHelper.ensureString(rpcparameters));
    } else {
      data = cache.get(rpc + serviceHelper.ensureString(rpcparameters));
    }
    if (!data) {
      daemonCallRunning = true;
      data = await client[rpc](...rpcparameters);
      if (rpc === 'getBlock') {
        blockCache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      } else if (rpc === 'getRawTransaction') {
        rawTxCache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      } else {
        cache.set(rpc + serviceHelper.ensureString(rpcparameters), data);
      }
      daemonCallRunning = false;
    }
    const successResponse = messageHelper.createDataMessage(data);
    return successResponse;
  } catch (error) {
    const daemonError = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return daemonError;
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
  const value = fnconfig.get(parameter);
  return value;
}

export default {
  executeCall,
  getConfigValue,

  // exports for testing purposes
  setStandardCache,
  setRawTxCache,
  setBlockCache,
  getStandardCache,
  getRawTxCacheCache,
  getBlockCache,
};
