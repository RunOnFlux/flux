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
 * Uses polling to get the flux network state (Can use zmq here in the future)
 * @param {number?} waitTimeoutMs How long to wait for the promise to resolve
 * @returns {Promise<void>}
 */
async function start(waitTimeoutMs = 0) {
  return new Promise((resolve, reject) => {
    if (stateManager) resolve();

    const fetcher = async (filter = null) => {
      // this is not how the function is supposed to be used, but it shouldn't take
      // an express req, res pair either. There should be an api function in front o fit
      const options = { params: { useCache: false, filter }, query: { filter: null } };

      const res = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(
        options,
      );

      const nodes = res.status === 'success' ? res.data : null;

      return nodes;
    };

    stateManager = new networkStateManager.NetworkStateManager(fetcher, {
      stateEmitter: globalThis.blockEmitter,
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

    stateManager.start();
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
 * @param {{sort?: boolean}} options
 * @returns {Array<Fluxnode>}
 */
function networkState(options = {}) {
  if (!stateManager) return [];

  const sort = options.sort || false;

  const { state } = stateManager;

  if (sort) {
    state.sort((a, b) => {
      if (a.added_height > b.added_height) return 1;
      if (b.added_height > a.added_height) return -1;
      if (b.txhash > a.txhash) return 1;
      return 0;
    });
  }

  return state;
}

async function waitStarted() {
  await stateManager.started;
}

/**
 *
 * @param {string} pubkey
 * @returns {Promise<Map<string, Fluxnode>> | null>} Clone of state
 */
async function getFluxnodesByPubkey(pubkey) {
  const nodes = await stateManager.search(pubkey, 'pubkey');

  return nodes;
}

async function socketAddressInNetworkState(socketAddress) {
  const found = await stateManager.includes(socketAddress, 'socketAddress');

  return found;
}

async function pubkeyInNetworkState(pubkey) {
  const found = await stateManager.includes(pubkey, 'pubkey');

  return found;
}

async function getRandomSocketAddress(socketAddress) {
  const socketAddress = await stateManager.getRandomSocketAddress(socketAddress);

  return socketAddress;
}

/**
 *
 * @param {string} socketAddress
 * @returns {Promise<Fluxnode | null>}
 */
async function getFluxnodeBySocketAddress(socketAddress) {
  const node = await stateManager.search(socketAddress, 'socketAddress');

  return node;
}

async function main() {
  start();

  console.log('Waiting for started');
  await stateManager.started;
  console.log('After started');

  setInterval(() => {
    console.log(stateManager.search('045ae66321cfc172086d79252323b6cd4b83460e580e88f220582affda8a83b3ec68078ad80f7e465c42c3ef9bc01b912b3663e2ba09057bc43fbedf0afa9f3864', 'pubkey'));
  }, 5_000);
}

if (require.main === module) {
  main();
}

module.exports = {
  waitStarted,
  getFluxnodesByPubkey,
  getFluxnodeBySocketAddress,
  getRandomSocketAddress,
  networkState,
  pubkeyInNetworkState,
  socketAddressInNetworkState,
  start,
  stop,
};
