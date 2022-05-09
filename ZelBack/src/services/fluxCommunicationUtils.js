/* eslint-disable no-underscore-dangle */
const LRU = require('lru-cache');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const daemonServiceZelnodeRpcs = require('./daemonServiceZelnodeRpcs');
const { outgoingConnections } = require('./utils/establishedConnections');

// default cache
const LRUoptions = {
  max: 2000, // currently 750 nodes lets put a value expecting increase in the numbers.
  maxAge: 1000 * 150, // 150 seconds slightly over average blocktime. Allowing 1 block expired too.
};

const myCache = new LRU(LRUoptions);

let addingNodesToCache = false;

// get deterministc Flux list from cache
// filter can only be a publicKey!
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
        const daemonFluxNodesList = await daemonServiceZelnodeRpcs.viewDeterministicZelNodeList(request);
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

// return boolean
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
    const zl = await deterministicFluxList(pubKey); // this itself is sufficient.
    node = zl.find((key) => key.pubkey === pubKey); // another check in case sufficient check failed on daemon level
  }
  if (!node) {
    return false;
  }
  const messageToVerify = version + message + timestamp;
  const verified = await verificationHelper.verifyMessage(messageToVerify, pubKey, signature);
  if (verified === true) {
    return true;
  }
  return false;
}

async function verifyTimestampInFluxBroadcast(data, currentTimeStamp) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = serviceHelper.ensureObject(data);
  const { timestamp } = dataObj; // ms
  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp + 300000)) { // bigger than 5 mins
    return true;
  }
  return false;
}

// extends verifyFluxBroadcast by not allowing request older than 5 mins.
async function verifyOriginalFluxBroadcast(data, obtainedFluxNodeList, currentTimeStamp) {
  if (await verifyTimestampInFluxBroadcast(data, currentTimeStamp)) {
    return verifyFluxBroadcast(data, obtainedFluxNodeList, currentTimeStamp);
  }
  return false;
}

module.exports = {
  verifyTimestampInFluxBroadcast,
  verifyOriginalFluxBroadcast,
  outgoingConnections,
  deterministicFluxList,
  verifyFluxBroadcast,
};
