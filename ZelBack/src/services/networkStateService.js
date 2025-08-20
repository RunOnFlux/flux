const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const networkStateManager = require('./utils/networkStateManager');

/**
 * @typedef {import('./utils/networkStateManager').Fluxnode} Fluxnode
 * @typedef {import('./fluxCommunicationUtils').FluxNetworkMessage} FluxNetworkMessage
 */

/**
 * The NetworkStateManager object. Responsible for fetching the nodelist,
 * and maintaining indexes for fast access.
 * @type {networkStateManager.NetworkStateManager | null}
 */
let stateManager = null;

/**
 * Uses polling or an event emitter to get the flux network state
 * (Can use zmq here in the future)
 * @param {{
 *   waitTimeoutMs?: number,
 *   stateEmitter?: EventEmitter
 * }} options waitTimeoutMs - How long to wait for the promise to resolve  \
 * stateEmitter - the block eventEmitter
 * @returns {Promise<void>}
 */
async function start(options = {}) {
  return new Promise((resolve, reject) => {
    if (stateManager) resolve();

    const waitTimeoutMs = options.waitTimeoutMs || 0;
    const stateEmitter = options.stateEmitter || null;

    const fetcher = async (filter = null) => {
      // this is not how the function is supposed to be used, but it shouldn't take
      // an express req, res pair either. There should be an api function in front of it
      const rpcOptions = { params: { useCache: false, filter }, query: { filter: null } };

      const res = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(
        rpcOptions,
      );

      const nodes = res.status === 'success' ? res.data : [];

      return nodes;
    };

    stateManager = new networkStateManager.NetworkStateManager(fetcher, {
      stateEmitter,
      stateEvent: 'blockReceived',
    });

    const timeout = waitTimeoutMs ? setTimeout(
      () => reject(new Error('Unable To start NetworkStateService: Timeout reached')),
      waitTimeoutMs,
    ) : null;

    stateManager.once('populated', () => {
      clearTimeout(timeout);
      resolve();
    });

    setImmediate(() => stateManager.start());
  });
}

/**
 *
 * @returns {Promise<void>}
 */
async function stop() {
  if (!stateManager) return;

  await stateManager.stop();
  stateManager = null;
}

/**
 * Returns the entire fluxnode network state
 * @param {{sort?: boolean}} options Sort by added height, then txid
 * @returns {Array<Fluxnode>}
 */
function networkState(options = {}) {
  if (!stateManager) return [];

  const sort = options.sort || false;

  const state = stateManager.state({ sort });

  return state;
}

async function waitStarted() {
  if (!stateManager) return;

  await stateManager.waitStarted;
}

function nodeCount() {
  if (!stateManager) return 0;

  return stateManager.nodeCount;
}

/**
 *
 * @param {string} pubkey
 * @returns {Promise<Map<string, Fluxnode>> | null>} Clone of state
 */
async function getFluxnodesByPubkey(pubkey) {
  if (!stateManager) return null;

  const nodes = await stateManager.search(pubkey, 'pubkey');

  return nodes;
}

/**
 *
 * @param {string} socketAddress
 * @returns {Promise<boolean>}
 */
async function socketAddressInNetworkState(socketAddress) {
  if (!stateManager) return false;

  const found = await stateManager.includes(socketAddress, 'socketAddress');

  return found;
}

/**
 *
 * @param {string} pubkey
 * @returns {Promise<boolean>}
 */
async function pubkeyInNetworkState(pubkey) {
  if (!stateManager) return false;

  const found = await stateManager.includes(pubkey, 'pubkey');

  return found;
}

/**
 *
 * @param {string} socketAddress
 * @returns {Promise<string | null>}
 */
async function getRandomSocketAddress(socketAddress) {
  if (!stateManager) return null;

  const random = await stateManager.getRandomSocketAddress(socketAddress);

  return random;
}

/**
 *
 * @param {string} socketAddress
 * @returns {Promise<Fluxnode | null>}
 */
async function getFluxnodeBySocketAddress(socketAddress) {
  if (!stateManager) return null;

  const node = await stateManager.search(socketAddress, 'socketAddress');

  return node;
}

async function main() {
  start();

  console.log('Waiting for started');
  await stateManager.waitStarted;
  console.log('After started');

  setInterval(() => {
    console.log(stateManager.search('045ae66321cfc172086d79252323b6cd4b83460e580e88f220582affda8a83b3ec68078ad80f7e465c42c3ef9bc01b912b3663e2ba09057bc43fbedf0afa9f3864', 'pubkey'));
  }, 5_000);
}

if (require.main === module) {
  main();
}

module.exports = {
  getFluxnodeBySocketAddress,
  getFluxnodesByPubkey,
  getRandomSocketAddress,
  networkState,
  nodeCount,
  pubkeyInNetworkState,
  socketAddressInNetworkState,
  start,
  stop,
  waitStarted,
};
