const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const networkStateService = require('./networkStateService');

/**
 * @typedef {{
 *   version: number,
 *   timestamp: number,
 *   pubKey: string,
 *   signature: string,
 *   data : object,
 * }} FluxNetworkMessage
 */

/**
 * To get deterministc Flux list from network state manager
 * @param {string} filter Filter. Can only be a publicKey.
 * @param {{filter?: string, sort?: boolean, addressOnly?: boolean}} options
 * @returns {Promise<Array<Fluxnode>}
 */
async function deterministicFluxList(options = {}) {
  const filter = options.filter || '';
  const sort = options.sort || false;
  const addressOnly = options.addressOnly || false;

  await networkStateService.waitStarted();

  if (!filter) {
    const state = networkStateService.networkState({ sort });

    if (!addressOnly) return state;

    return state.reduce((filtered, node) => {
      if (node.ip) filtered.push(node.ip);

      return filtered;
    }, []);
  }

  const filtered = await networkStateService.getFluxnodesByPubkey(filter);

  if (!filtered) return [];

  const asArray = Array.from(filtered.values());

  return asArray;
}

async function getNodeCount() {
  await networkStateService.waitStarted();

  const count = networkStateService.nodeCount();

  return count;
}

/**
 *
 * @param {string} socketAddress
 * @returns {Proimse<Fluxnode | null}
 */
async function getFluxnodeFromFluxList(socketAddress) {
  await networkStateService.waitStarted();

  const node = await networkStateService.getFluxnodeBySocketAddress(socketAddress);

  return node;
}

/**
 *
 * @param {string} socketAddress
 * @returns {Proimse<boolean>}
 */
async function socketAddressInFluxList(socketAddress) {
  await networkStateService.waitStarted();

  const found = await networkStateService.socketAddressInNetworkState(socketAddress);

  return found;
}

let counter = 0;
let lastUpdate = 0;

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

  counter += 1;
  if (!lastUpdate) lastUpdate = process.hrtime.bigint();

  // log message rate every 1000 messages. As of 090725 - approx 1-2 MSG/s
  if (counter % 1000 === 0) {
    counter = 0;
    const nowHrtime = process.hrtime.bigint();
    const elapsed = Number(nowHrtime - lastUpdate) / 1000_000_000;
    const rate = 1000 / elapsed;
    // rounds to 2dp
    const rounded = Math.round((rate + Number.EPSILON) * 100) / 100;
    lastUpdate = nowHrtime;

    log.info(`Receiving broadcast message rate: ${rounded} MSG/s`);
  }

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

    case 'nodedown':
      target = payload.ip;
      error = `Invalid nodedown message, ip: ${payload.ip} pubkey: ${pubKey}`;
      break;

    // zelappregister zelappupdate fluxappregister fluxappupdate fluxapprequest
    default: {
      // this used to just take the first node. I.e:
      //   node = zl.find((key) => key.pubkey === pubKey);
      // however, that doesn't prove anything. So if we find the pubkey, good enough
      // ideally - every message should also have the source ip
      target = await networkStateService.getFluxnodesByPubkey(pubKey);
      error = `No node belonging to ${pubKey} found for ${msgType}`;
    }
  }

  // no public key found in cache
  if (target === null) {
    log.warn(error);
    return false;
  }

  // if we get a map, we have hit the default case and searched for pubkeys
  const found = target instanceof Map
    ? true
    : Boolean(await networkStateService.getFluxnodeBySocketAddress(target));

  if (!found) {
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
function verifyTimestampInFluxBroadcast(data, currentTimeStamp, maxOld = 300_000) {
  // eslint-disable-next-line no-param-reassign
  const dataObj = serviceHelper.ensureObject(data);
  const { timestamp } = dataObj; // ms

  if (!timestamp) return false;

  // eslint-disable-next-line no-param-reassign
  currentTimeStamp = currentTimeStamp || Date.now(); // ms
  if (currentTimeStamp < (timestamp + maxOld)) { // not older than 5 mins
    return true;
  }
  const age = Math.round((currentTimeStamp - timestamp) / 1_000);
  const maxAge = maxOld / 1_000;
  log.warn('Unable to verify mesage. Timestamp '
    + `${timestamp} is too old: ${age}s, Max: ${maxAge}`);

  return false;
}

/**
 * To verify original Flux broadcast. Extends verifyFluxBroadcast by not allowing request older than 5 mins.
 * @param {object} data Data.
 * @param {object[]} obtainedFluxNodeList List of FluxNodes.
 * @param {number} currentTimeStamp Current timestamp.
 * @returns {Promise<boolean>} False unless message is successfully verified.
 */
async function verifyOriginalFluxBroadcast(data, currentTimeStamp) {
  const timeStampOK = verifyTimestampInFluxBroadcast(data, currentTimeStamp);
  if (timeStampOK) {
    const broadcastOK = await verifyFluxBroadcast(data);
    return broadcastOK;
  }
  return false;
}

module.exports = {
  getNodeCount,
  verifyTimestampInFluxBroadcast,
  verifyOriginalFluxBroadcast,
  deterministicFluxList,
  socketAddressInFluxList,
  getFluxnodeFromFluxList,
  verifyFluxBroadcast,
};
