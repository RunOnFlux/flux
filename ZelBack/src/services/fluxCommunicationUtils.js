/* eslint-disable no-underscore-dangle */
const { LRUCache } = require('lru-cache');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const networkStateService = require('./networkStateService');

// default cache
const LRUoptions = {
  max: 20000, // currently 20000 nodes
  ttl: 1000 * 240, // 240 seconds, allow up to 2 blocks
  maxAge: 1000 * 240, // 240 seconds, allow up to 2 blocks
};

/**
 * @typedef {{
 *   version: number,
 *   timestamp: number,
 *   pubKey: string,
 *   signature: string,
 *   data : object,
 * }} FluxNetworkMessage
 */

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
 * To verify a Flux broadcast message.
 * @param {FluxNetworkMessage} broadcast Flux network layer message containing public key, timestamp, signature and version.
 * @returns {Promise<boolean>} False unless message is successfully verified.
 */
async function verifyFluxBroadcast(broadcast) {
  const {
    pubKey, timestamp, signature, version, data: payload,
  } = broadcast;

  if (version !== 1) return false;

  const message = serviceHelper.ensureString(payload);

  if (!message) return false;

  const { type: msgType } = payload;

  if (!msgType) return false;

  const now = Date.now();

  // message was broadcasted in the future. Allow 120 sec clock sync
  if (now < timestamp - 120_000) {
    log.error('VerifyBroadcast: Message from future, rejecting');
    return false;
  }

  const nodes = await networkStateService.getFluxnodesByPubkey(pubKey);

  let error = '';
  let target = '';

  switch (msgType) {
    case 'fluxapprunning':
      target = payload.ip;
      // most of invalids are caused because our deterministic list is cached for couple of minutes
      error = `Invalid fluxapprunning message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    case 'fluxappinstalling':
      target = payload.ip;
      error = `Invalid fluxappinstalling message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    case 'fluxappinstallingerror':
      target = payload.ip;
      error = `Invalid fluxappinstallingerror message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    case 'fluxipchanged':
      target = payload.oldIP;
      error = `Invalid fluxipchanged message, oldIP: ${payload.oldIP} pubkey: ${pubKey}`;
      break;

    case 'fluxappremoved':
      target = payload.ip;
      error = `Invalid fluxappremoved message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    // zelappregister zelappupdate fluxappregister fluxappupdate
    default:
      // we take the first node. I.e. this used to be :
      //   node = zl.find((key) => key.pubkey === pubKey);
      //
      // Why??? What does this validate?
      target = nodes.size ? nodes.keys().next().value : null;
      error = `No node belonging to ${pubKey} found`;
  }

  // why not skip the entire pubkey index... and just match straight for endpoint?
  const node = nodes.get(target)
  || (await networkStateService.getFluxnodeBySocketAddress(target));

  if (!node) {
    log.warn(error);
    return false;
  }

  const messageToVerify = version + message + timestamp;
  const verified = verificationHelper.verifyMessage(
    messageToVerify,
    pubKey,
    signature,
  );

  return verified;
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
  log.warn(`Timestamp ${timestamp} of message is too old ${currentTimeStamp}}`);
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
