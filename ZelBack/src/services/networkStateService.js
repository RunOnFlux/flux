const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const networkStateManager = require('./utils/networkStateManager');

/**
 * @typedef {import('./utils/networkStateManager').Fluxnode} Fluxnode
 * @typedef {import('./fluxCommunicationMessagesSender').FluxNetworkMessage} FluxNetworkMessage
 */

/**
 * The NetworkStateManager object. Responsible for fetching the nodelist,
 * and maintaining indexes for fast access.
 */
let stateManager = null;

/**
 * Starts the network state service. It will either subscribe to the fluxd zmq
 * endpoint if possible, or fallback to polling.
 * @returns {void}
 */
async function start() {
  const { daemon: { zmqport } } = config ?? { daemon: { zmqport: 16126 } };

  const zmqEndpoint = `tcp://127.0.0.1:${zmqport}`;

  return new Promise((resolve, reject) => {
    if (stateManager) resolve();

    const fetcher = async (filter = null) => {
      const options = { params: { useCache: false, filter }, query: { filter: null } };

      const res = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(
        options,
      );

      const nodes = res.status === 'success' ? res.data : null;

      return nodes;
    };

    stateManager = new networkStateManager.NetworkStateManager(fetcher, {
      intervalMs: 120_000,
      zmqEndpoint,
    });

    const timeout = setTimeout(
      () => reject(new Error('Unable To Start: Timeout of 300s reached')),
      300_000,
    );

    stateManager.once('populated', () => {
      clearTimeout(timeout);
      resolve();
    });

    stateManager.start();
  });
}

async function stop() {
  if (!stateManager) return;

  await stateManager.stop();
  stateManager = null;
}

/**
 * Returns the entire fluxnode network state
 * @returns {Array<Fluxnode>}
 */
function networkState() {
  if (!stateManager) return [];

  return stateManager.state;
}

async function getFluxnodesByPubkey(pubkey) {
  const nodes = await stateManager.search(pubkey, 'pubkey');
  // in the future, just return the map.
  return nodes ? [...nodes.values()] : [];
}

/**
 *
 * @param {FluxNetworkMessage} broadcast
 * @param {{maxAge?: number}} options
 * @returns {boolean}
 */
function isBroadcastStale(broadcast, options = {}) {
  const maxAge = options.maxAge || 300_000;

  const { timestamp } = broadcast;
  const now = Date.now();

  if (now > timestamp + maxAge) {
    log.warn(
      `isBroadcastStale: Timestamp ${timestamp} of broadcast is too old ${now}}`,
    );
    return true;
  }
  return false;
}

/**
 * To verify Flux broadcast.
 * @param {object} broadcast Flux network layer message containing public key, timestamp, signature and version.
 * @returns {Promise<boolean>} False unless message is successfully verified.
 */
async function verifyBroadcast(broadcast) {
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

  const nodes = await stateManager.search(pubKey, 'pubkey');

  let error = '';
  let target = '';

  switch (msgType) {
    case 'fluxapprunning':
      target = payload.ip;
      // most of invalids are caused because our deterministic list is cached for couple of minutes
      error = `Invalid fluxapprunning message, ip: ${payload.ip} pubkey: ${pubKey}`;
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
      // we take the first node. Why??? What does this validate?
      target = nodes.size ? nodes.keys().next().value : null;
      error = `No node belonging to ${pubKey} found`;
  }

  const node = nodes.get(target) || await stateManager.search(target, 'endpoint');

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

if (require.main === module) {
  start();
  setInterval(() => {
    console.log(stateManager.search('045ae66321cfc172086d79252323b6cd4b83460e580e88f220582affda8a83b3ec68078ad80f7e465c42c3ef9bc01b912b3663e2ba09057bc43fbedf0afa9f3864', 'pubkey'));
  }, 5_000);
}

module.exports = {
  getFluxnodesByPubkey,
  isBroadcastStale,
  networkState,
  start,
  stop,
  verifyBroadcast,
};
