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
 * @param {{filter?: string, sort?: boolean}} options
 * @returns {Promise<Array<Fluxnode>}
 */
async function deterministicFluxList(options = {}) {
  const filter = options.filter || '';
  const sort = options.sort || false;

  await networkStateService.waitStarted();

  if (!filter) return networkStateService.networkState({ sort });

  const filtered = await networkStateService.getFluxnodesByPubkey(filter);

  return filtered;
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
  verifyTimestampInFluxBroadcast,
  verifyOriginalFluxBroadcast,
  deterministicFluxList,
  getFluxnodeFromFluxList,
  verifyFluxBroadcast,
};
