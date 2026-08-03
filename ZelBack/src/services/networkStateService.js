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
 * Resolves once the node list has been fetched and indexed. It exists before
 * start() is called, so a caller that arrives early waits for the state rather
 * than being handed an empty list and reading it as a network with no nodes.
 */
let resolveStarted;
let started = new Promise((resolve) => { resolveStarted = resolve; });

/**
 * Throttle state for daemon RPC calls
 */
// eslint-disable-next-line no-unused-vars
const lastDaemonCallTimestamp = 0;
// eslint-disable-next-line no-unused-vars
const lastDaemonCallResult = [];
// eslint-disable-next-line no-unused-vars
const DAEMON_CALL_THROTTLE_MS = 30000; // 30 seconds

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
  return new Promise((resolve, reject) => { // eslint-disable-line consistent-return
    if (stateManager) {
      resolve();
      return;
    }

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
      stateEvent: 'blocksProcessed',
      progressEvent: 'syncProgress',
    });

    const timeout = waitTimeoutMs ? setTimeout(
      () => reject(new Error('Unable To start NetworkStateService: Timeout reached')),
      waitTimeoutMs,
    ) : null;

    stateManager.once('populated', () => {
      clearTimeout(timeout);
      resolveStarted();
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
  started = new Promise((resolve) => { resolveStarted = resolve; });
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

/**
 * Waits until the network state is known. Callers use this to decide what the
 * network looks like, so it must not return before there is an answer.
 * @returns {Promise<void>}
 */
async function waitStarted() {
  await started;
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

  // Default-port format ("ip" vs "ip:16127") is reconciled inside
  // networkStateManager, which canonicalises both index keys and lookups.
  return stateManager.includes(socketAddress, 'socketAddress');
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
