const { EventEmitter } = require('node:events');
const { FluxController } = require('./fluxController');

const log = require('../../lib/log');

/**
 * The Fluxnode as returned by fluxd
 * @typedef {{
 *   collateral: string,
 *   txhash: string,
 *   outidx: number,
 *   ip: string,
 *   network: string,
 *   added_height: number,
 *   confirmed_height: number,
 *   last_confirmed_height: number,
 *   last_paid_height: number,
 *   tier: string,
 *   payment_address: string,
 *   pubkey: string,
 *   activesince: string,
 *   lastpaid: string,
 *   amount: string,
 *   rank: number
 * }} Fluxnode
 */

class NetworkStateManager extends EventEmitter {
  #state = [];

  #pubkeyIndex = new Map();

  #socketAddressIndex = new Map();

  #controller = new FluxController();

  #indexStart = null;

  /**
   * @type {() => {}}
   */
  #startComplete = Promise.resolve();

  /**
   * @type {Promise<void>}
   */
  started;

  /**
   * @type { "polling" | "subscription" }
   */
  #updateTrigger = 'subscription';

  /**
   * @type {()=>Promise<Array<Fluxnode>>}
   */
  #stateFetcher;

  /**
   * @type {EventEmitter | nulll}
   */
  #stateEmitter;

  /**
   * Until we get onto NodeJS > 17.0.0 - we need this. I.e. we have no
   * structured clone
   */
  static deepClone(target) {
    function replacer(_key, value) {
      if (value instanceof Map) {
        return {
          dataType: 'Map',
          payload: Array.from(value.entries()),
        };
      }
      return value;
    }
    function reviver(_key, value) {
      if (typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
          return new Map(value.payload);
        }
      }
      return value;
    }

    const asString = JSON.stringify(target, replacer);
    const clone = JSON.parse(asString, reviver);

    return clone;
  }

  /**
   *
   * @param {()=>Promise<Array<Fluxnode>>} stateFetcher
   * @param {{intervalMs?: number}} options
   */
  constructor(stateFetcher, options = {}) {
    super();

    this.intervalMs = options.intervalMs || 120_000;
    this.stateEvent = options.stateEvent || null;

    this.#stateEmitter = options.stateEmitter || null;
    this.#stateFetcher = stateFetcher;
  }

  get state() {
    const clone = NetworkStateManager.deepClone(this.#state);

    return clone;
  }

  get updateTrigger() {
    return this.#updateTrigger;
  }

  get indexesReady() {
    return this.#controller.lock.ready;
  }

  /**
   * Index map. Has to be a getter and not a field, as the field doesn't update
   * the reference.
   */
  get #indexes() {
    return { pubkey: this.#pubkeyIndex, endpoint: this.#socketAddressIndex };
  }

  #setIndexes(pubkeyIndex, socketAddressIndex) {
    this.#pubkeyIndex = pubkeyIndex;
    this.#socketAddressIndex = socketAddressIndex;
  }

  async #buildIndexes(nodes) {
    // nodes.forEach((node) => {
    //   if (!this.#pubkeyIndex.has(node.pubkey)) {
    //     this.#pubkeyIndex.set(node.pubkey, new Map());
    //   }
    //   this.#pubkeyIndex.get(node.pubkey).set(node.ip, node);
    //   this.#socketAddressIndex.set(node.ip, node);
    // });

    // if we are building an index already, just wait for it to finish.
    // maybe look at cancelling it in future.
    await this.#controller.lock.enable();

    const nodeCount = nodes.length;

    const pubkeyIndex = new Map();
    const socketAddressIndex = new Map();

    function iterIndexes(startIndex, callback) {
      const endIndex = startIndex + 1000;
      const chunk = nodes.slice(startIndex, endIndex);

      chunk.forEach((node) => {
        const nodesByPubkey = pubkeyIndex.get(node.pubkey)
          || pubkeyIndex.set(node.pubkey, new Map()).get(node.pubkey);

        nodesByPubkey.set(node.ip, node);
        socketAddressIndex.set(node.ip, node);
      });

      if (endIndex >= nodeCount) {
        callback();
        return;
      }

      setImmediate(iterIndexes.bind(this, endIndex, callback));
    }

    // Yield to the event queue here, this way we are only ever doing O(1000),
    // instead of O(n). With around 13k nodes, this was taking on average 8ms.
    // I.e. the event queue was blocked for 8ms. Now we yield. I was using a
    // worker here, but overkill for what we are doing.

    return new Promise((resolve) => {
      iterIndexes(0, () => {
        this.#setIndexes(pubkeyIndex, socketAddressIndex);
        this.#controller.lock.disable();
        resolve();
      });
    });
  }

  reset() {
    // recreate objects so they can't be mutated externally
    this.#pubkeyIndex = new Map();
    this.#socketAddressIndex = new Map();
    this.#state = [];
  }

  async fetchNetworkState() {
    // always use monotonic clock for any elapsed times
    const start = process.hrtime.bigint();

    let state = [];

    while (!state.length) {
      if (this.#controller.aborted) break;

      const fetchStart = process.hrtime.bigint();
      // eslint-disable-next-line no-await-in-loop
      state = await this.#stateFetcher().catch((err) => {
        log.warning(`Network state fetcher error: ${err.message}`);
        return [];
      });

      const elapsed = Number(process.hrtime.bigint() - fetchStart) / 1000000;
      log.info(`Network state fetch finished:, elapsed ms ${elapsed}`);

      // eslint-disable-next-line no-await-in-loop
      if (!state.length) await this.#controller.sleep(15_000);
    }

    const populated = Boolean(this.#state.length);

    if (state.length) {
      this.#state = state;

      this.#indexStart = process.hrtime.bigint();

      await this.#buildIndexes(this.#state);

      const elapsed = Number(process.hrtime.bigint() - this.#indexStart) / 1000000;
      const pubkeySize = this.#pubkeyIndex.size;
      const socketAddressSize = this.#socketAddressIndex.size;

      log.info('Network State Indexes created, nodes found: '
        + `${state.length}, elapsed ms: ${elapsed}, `
        + `pubkeyIndexSize: ${pubkeySize}, socketAddressSize: ${socketAddressSize}`);

      this.#indexStart = null;

      if (!populated) {
        this.emit('populated');
        this.#startComplete();
      }

      this.emit('updated');
    }

    const elapsed = Number(process.hrtime.bigint() - start) / 1000000;

    // min sleep period is 1s
    const sleepMs = Math.max(1_000, this.intervalMs - elapsed);
    return sleepMs;
  }

  #startPolling() {
    this.#controller.startLoop(this.fetchNetworkState.bind(this));
  }

  #startEventEmitter() {
    this.#stateEmitter.on(this.stateEvent, () => {
      this.fetchNetworkState();
    });
  }

  async start() {
    this.started = new Promise((resolve) => {
      this.#startComplete = () => {
        resolve();
        this.#startComplete = Promise.resolve();
      };
    });

    await this.fetchNetworkState();
    await this.started;

    const updater = this.#stateEmitter && this.stateEvent
      ? this.#startEventEmitter
      : this.#startPolling;

    updater();
  }

  async stop() {
    // is this right?
    await this.#controller.abort();
  }

  /**
   * Find node(s) in the fluxnode network state by either pubkey or socketAddress
   *
   * @param {string} filter pubkey or socketAddress (ip:port)
   * @param {"pubkey"|"socketAddress"} type
   * @returns {Promise<Map<string, Map<string, Fluxnode>>, Fluxnode>} Clone of the state
   */
  async search(filter, type) {
    if (!filter) return null;
    if (!Object.keys(this.#indexes).includes(type)) return null;

    // if we are mid stroke indexing, may as well wait the 10ms (max) and get the
    // latest block
    await this.indexesReady;

    const cached = this.#indexes[type].get(filter);
    const clone = cached ? NetworkStateManager.deepClone(cached) : null;

    return clone;
  }
}

async function main() {
  // eslint-disable-next-line global-require
  const daemonServiceFluxnodeRpcs = require('../daemonService/daemonServiceFluxnodeRpcs');

  const fetcher = async (filter = null) => {
    const options = { params: { useCache: false, filter }, query: { filter: null } };

    const res = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(options);

    if (res.status === 'success') {
      return res.data;
    }
    console.log('fetcher not success');
    return [];
  };

  const network = new NetworkStateManager(fetcher, { intervalMs: 120_000, zmqEndpoint: 'tcp://127.0.0.1:28332' });
  network.on('updated', () => {
    console.log('received updated event');
  });
  network.on('populated', async () => {
    console.log('received populated event');
    console.log('Search result populated:', await network.search('212.71.244.159:16137', 'endpoint'));
  });
  network.start();
  setInterval(async () => {
    // await network.search('212.71.244.159:16137', 'endpoint');
    console.log('Search pubkey:', await network.search('045ae66321cfc172086d79252323b6cd4b83460e580e88f220582affda8a83b3ec68078ad80f7e465c42c3ef9bc01b912b3663e2ba09057bc43fbedf0afa9f3864', 'pubkey'));
  }, 5_000);
}

if (require.main === module) {
  main();
}

module.exports = { NetworkStateManager };

// interesting stuff:

// 6 nodes with no ip address

// ~ 420ms fetch time (on localhost) ~ 8.2Mb i/o. Not sure if this is time for fluxd
// to generate the list, or for the actual i/o on localhost.

// ~ 20ms to build cache. This was 8ms under no load, so obviously, yielding
// to the event queue is a good thing as there is other work to be done.

// if we need to search... we wait for indexes. What about if fetching?
// do we try for a search without waiting, then if a cache miss, we wait for
// the search to finish?

// fetching state
// Fetch finished, elapsed ms: 418.639369
// Nodes found: 13047
// Setting state and indexes
// pubkeyIndexSize: 3011
// socketAddressIndexSize: 13041
// Indexes created, elapsed ms: 18.25089
// New Flux App Removed message received.
