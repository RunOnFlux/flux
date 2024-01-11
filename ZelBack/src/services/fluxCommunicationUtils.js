/* eslint-disable no-underscore-dangle */
const { LRUCache } = require('lru-cache');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
// default cache
const LRUoptions = {
  max: 20000, // currently 20000 nodes
  ttl: 1000 * 240, // 240 seconds, allow up to 2 blocks
  maxAge: 1000 * 240, // 240 seconds, allow up to 2 blocks
};

const myCache = new LRUCache(LRUoptions);

let addingNodesToCache = false;

/**
 * To constantly update deterministic Flux list every 2 minutes so we always trigger cache and have up to date value
 */
async function constantlyUpdateDeterministicFluxList() {
  try {
    while (addingNodesToCache) {
      // prevent several instances filling the cache at the same time.
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(100);
    }
    addingNodesToCache = true;
    const request = {
      params: {},
      query: {},
    };
    const daemonFluxNodesList = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(request);
    if (daemonFluxNodesList.status === 'success') {
      const generalFluxList = daemonFluxNodesList.data || [];
      myCache.set('fluxList', generalFluxList);
    }
    addingNodesToCache = false;
    await serviceHelper.delay(2 * 60 * 1000); // 2 minutes
    constantlyUpdateDeterministicFluxList();
  } catch (error) {
    addingNodesToCache = false;
    log.error(error);
    await serviceHelper.delay(2 * 60 * 1000); // 2 minutes
    constantlyUpdateDeterministicFluxList();
  }
}

/**
 * To get deterministc Flux list from cache.
 * @param {string} filter Filter. Can only be a publicKey.
 * @returns {(*|*)} Value of any type or an empty array of any type.
 */
async function deterministicFluxList(filter) {
  try {
    while (addingNodesToCache) {
      // prevent several instances filling the cache at the same time.
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(100);
    }
    let fluxList;
    if (filter) {
      fluxList = myCache.get(`fluxList${serviceHelper.ensureString(filter)}`);
    } else {
      fluxList = myCache.get('fluxList');
    }
    if (!fluxList) {
      let generalFluxList = myCache.get('fluxList');
      addingNodesToCache = true;
      if (!generalFluxList) {
        const request = {
          params: {},
          query: {},
        };
        const daemonFluxNodesList = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(request);
        if (daemonFluxNodesList.status === 'success') {
          generalFluxList = daemonFluxNodesList.data || [];
          myCache.set('fluxList', generalFluxList);
          if (filter) {
            const filterFluxList = generalFluxList.filter((node) => node.pubkey === filter);
            myCache.set(`fluxList${serviceHelper.ensureString(filter)}`, filterFluxList);
          }
        }
      } else { // surely in filtered branch too
        const filterFluxList = generalFluxList.filter((node) => node.pubkey === filter);
        myCache.set(`fluxList${serviceHelper.ensureString(filter)}`, filterFluxList);
      }
      addingNodesToCache = false;
      if (filter) {
        fluxList = myCache.get(`fluxList${serviceHelper.ensureString(filter)}`);
      } else {
        fluxList = myCache.get('fluxList');
      }
    }
    return fluxList || [];
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * To verify Flux broadcast.
 * @param {object} data Data containing public key, timestamp, signature and version.
 * @param {object[]} obtainedFluxNodesList List of FluxNodes.
 * @param {number} currentTimeStamp Current timestamp.
 * @returns {boolean} False unless message is successfully verified.
 */
async function verifyFluxBroadcast(data, obtainedFluxNodesList, currentTimeStamp) {
  const dataObj = serviceHelper.ensureObject(data);
  const { pubKey } = dataObj;
  const { timestamp } = dataObj; // ms
  const { signature } = dataObj;
  const { version } = dataObj;
  // only version 1 is active
  if (version !== 1) {
    return false;
  }
  const message = serviceHelper.ensureString(dataObj.data);
  // is timestamp valid ?
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp - 120000)) { // message was broadcasted in the future. Allow 120 sec clock sync
    log.error('Message from future');
    return false;
  }

  let node = null;
  if (obtainedFluxNodesList) { // for test purposes.
    node = obtainedFluxNodesList.find((key) => key.pubkey === pubKey);
    if (!node) {
      return false;
    }
  }
  if (!node) {
    // node that broadcasted the message has to be on list
    // pubkey of the broadcast has to be on the list
    const zl = await deterministicFluxList(pubKey);
    if (dataObj.data && dataObj.data.type === 'fluxapprunning') {
      node = zl.find((key) => key.pubkey === pubKey && dataObj.data.ip && dataObj.data.ip === key.ip); // check ip is on the network and belongs to broadcasted public key
      if (!node) {
        log.warn(`Invalid fluxapprunning message, ip: ${dataObj.data.ip} pubkey: ${pubKey}`); // most of invalids are caused because our deterministic list is cached for couple of minutes
        return false;
      }
    } else if (dataObj.data && dataObj.data.type === 'fluxipchanged') {
      node = zl.find((key) => key.pubkey === pubKey && dataObj.data.oldIP && dataObj.data.oldIP === key.ip); // check ip is on the network and belongs to broadcasted public key
      if (!node) {
        log.warn(`Invalid fluxipchanged message, oldIP: ${dataObj.data.oldIP} pubkey: ${pubKey}`);
        return false;
      }
    } else if (dataObj.data && dataObj.data.type === 'fluxappremoved') {
      node = zl.find((key) => key.pubkey === pubKey && dataObj.data.ip && dataObj.data.ip === key.ip); // check ip is on the network and belongs to broadcasted public key
      if (!node) {
        log.warn(`Invalid fluxappremoved message, ip: ${dataObj.data.ip} pubkey: ${pubKey}`);
        return false;
      }
    } else {
      node = zl.find((key) => key.pubkey === pubKey);
    }
  }
  if (!node) {
    log.warn(`No node belonging to ${pubKey} found`);
    return false;
  }
  const messageToVerify = version + message + timestamp;
  const verified = verificationHelper.verifyMessage(messageToVerify, pubKey, signature);
  if (verified === true) {
    return true;
  }
  return false;
}

/**
 * To verify timestamp in Flux broadcast.
 * @param {object} data Data.
 * @param {number} currentTimeStamp Current timestamp.
 * @returns {boolean} False unless current timestamp is within 5 minutes of the data object's timestamp.
 */
function verifyTimestampInFluxBroadcast(data, currentTimeStamp, maxOld = 300000) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = serviceHelper.ensureObject(data);
  const { timestamp } = dataObj; // ms
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp + maxOld)) { // not older than 5 mins
    return true;
  }
  log.warn(`Timestamp ${timestamp} of message is too old ${currentTimeStamp}`);
  return false;
}

/**
 * To verify original Flux broadcast. Extends verifyFluxBroadcast by not allowing request older than 5 mins.
 * @param {object} data Data.
 * @param {object[]} obtainedFluxNodeList List of FluxNodes.
 * @param {number} currentTimeStamp Current timestamp.
 * @returns {boolean} False unless message is successfully verified.
 */
async function verifyOriginalFluxBroadcast(data, obtainedFluxNodeList, currentTimeStamp) {
  const timeStampOK = verifyTimestampInFluxBroadcast(data, currentTimeStamp);
  if (timeStampOK) {
    const broadcastOK = await verifyFluxBroadcast(data, obtainedFluxNodeList, currentTimeStamp);
    return broadcastOK;
  }
  return false;
}

module.exports = {
  constantlyUpdateDeterministicFluxList,
  verifyTimestampInFluxBroadcast,
  verifyOriginalFluxBroadcast,
  deterministicFluxList,
  verifyFluxBroadcast,
};
