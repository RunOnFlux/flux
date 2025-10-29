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
  static #minFetchIntervalMs = 30_000;

  /**
   * @type {Array<Fluxnode>}
   */
  #state = [];

  #pubkeyIndex = new Map();

  #socketAddressIndex = new Map();

  #controller = new FluxController();

  #started = false;

  #fetchQueued = false;

  #lastFetchTime = BigInt(0);

  /**
   * @type {() => Promise | null}
   */
  #onStartComplete = null;

  /**
   * @type {Promise<void>}
   */
  waitStarted = new Promise((resolve) => {
    if (this.#onStartComplete) {
      resolve();
      return;
    }

    this.#onStartComplete = () => {
      resolve();
      this.#onStartComplete = () => Promise.resolve();
    };
  });

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
  #stateEmitter = null;

  /**
   * @type {()=>Promise<void> | null}
   */
  #boundEventHandler = null;

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

    if (!stateFetcher || typeof stateFetcher !== 'function') {
      throw new Error('State fetcher function is mandatory');
    }

    this.#stateFetcher = stateFetcher;
    this.intervalMs = options.intervalMs || 120_000;
    this.stateEvent = options.stateEvent || null;
    this.#stateEmitter = options.stateEmitter || null;

    if (this.#stateEmitter && !this.stateEvent) {
      throw new Error('The State Event is mandatory is state emitter is used');
    }

    this.#controller.addLock('fetcher');
  }

  get lastFetchElapsedMs() {
    const now = process.hrtime.bigint();

    const elapsedMs = Number(now - this.#lastFetchTime) / 1_000_000;

    return elapsedMs;
  }

  get canFetch() {
    const canFetch =
      this.lastFetchElapsedMs > NetworkStateManager.#minFetchIntervalMs;

    return canFetch;
  }

  get remainingFetchSeconds() {
    const remainingSec =
      (NetworkStateManager.#minFetchIntervalMs - this.lastFetchElapsedMs) /
      1_000;

    const rouneded = Math.round((remainingSec + Number.EPSILON) * 100) / 100;

    return rouneded;
  }

  get updateTrigger() {
    return this.#updateTrigger;
  }

  get indexesReady() {
    return !this.#controller.lock.locked;
  }

  get waitIndexesReady() {
    return this.#controller.lock.waitReady();
  }

  get nodeCount() {
    return this.#state.length;
  }

  get started() {
    return this.#started;
  }

  get fetchRunning() {
    const fetchLock = this.#controller.getLock('fetcher');

    return fetchLock.locked;
  }

  get fetchQueued() {
    return this.#fetchQueued;
  }

  get waitFetchComplete() {
    const fetchLock = this.#controller.getLock('fetcher');

    return fetchLock.waitReady({ waitAll: true });
  }

  /**
   * Index map. Has to be a getter and not a field, as the field doesn't update
   * the reference.
   */
  get #indexes() {
    return {
      pubkey: this.#pubkeyIndex,
      socketAddress: this.#socketAddressIndex,
    };
  }

  #setIndexes(pubkeyIndex, socketAddressIndex) {
    this.#pubkeyIndex = pubkeyIndex;
    this.#socketAddressIndex = socketAddressIndex;
  }

  async #buildIndexes(nodes) {
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
        const nodesByPubkey =
          pubkeyIndex.get(node.pubkey) ||
          pubkeyIndex.set(node.pubkey, new Map()).get(node.pubkey);

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

  /**
   * Gets a random node from the network state. Ensures that the connection is
   * not to this node. When we build the indexes, we could also store the node
   * keys in an array, however, that is another array we have to keep in memory.
   * It may pay to do that though, as this is O(n), vs O(1) for array index. CPU
   * tradeoff for memory is probably good though.
   * @param {string} localSocketAddress The ip:port of this node
   * @returns {Promise<string | null>} A random socketAddress from the map
   */
  async getRandomSocketAddress(localSocketAddress) {
    await this.waitIndexesReady;

    const indexSize = this.#socketAddressIndex.size;

    if (!indexSize) return null;

    let stepsRemaining = Math.floor(Math.random() * indexSize);
    const iterator = this.#socketAddressIndex.values();

    let previous = null;

    // eslint-disable-next-line no-restricted-syntax
    for (const node of iterator) {
      const { ip: socketAddress } = node;

      if (!stepsRemaining) {
        const match = localSocketAddress === socketAddress;
        // if we've been unlucky (or lucky however you look at it) enough to hit
        // this node, we just take the value before, or if it's the initial index,
        // the next value from the iterator
        if (match) return previous || iterator.next().value.ip;
        return socketAddress;
      }

      previous = socketAddress;
      stepsRemaining -= 1;
    }

    // this should never happen, should probably log it
    return this.socketAddressIndex.values().next().value.ip;
  }

  /**
   *
   * @param {{sort?: boolean}} options
   */
  state(options = {}) {
    const sort = options.sort || false;

    const clone = Array.from(this.#state);

    if (!sort) return clone;

    clone.sort((a, b) => {
      if (a.added_height > b.added_height) return 1;
      if (b.added_height > a.added_height) return -1;
      if (b.txhash > a.txhash) return 1;
      return 0;
    });

    return clone;
  }

  reset() {
    this.#stateEmitter = null;
    this.#pubkeyIndex = new Map();
    this.#socketAddressIndex = new Map();
    this.#state = [];
  }

  /**
   *
   * @param {number?} blockHeight Just for logging (from event emitter)
   * @returns {Promise<void>}
   */
  async fetchNetworkState(blockHeight = null) {
    // always use monotonic clock for any elapsed times
    const start = process.hrtime.bigint();
    const populated = Boolean(this.#state.length);

    let state = [];

    // on start, we loop until we have started. Then we only try fetch
    // once - if it fails, we give up (and let it retry on the next block)

    do {
      if (this.#controller.aborted) break;

      const fetchStart = process.hrtime.bigint();
      const fetchLock = this.#controller.getLock('fetcher');

      // eslint-disable-next-line no-await-in-loop
      await fetchLock.enable();
      // eslint-disable-next-line no-await-in-loop
      state = await this.#stateFetcher().catch((err) => {
        log.warn(`Network state fetcher error: ${err.message}`);
        return [];
      });
      fetchLock.disable();

      const fetchEnd = process.hrtime.bigint();

      this.#lastFetchTime = fetchEnd;

      const fetchElapsed =
        Number(fetchEnd - fetchStart) / 1_000_000;

      const rounded = Math.round((fetchElapsed + Number.EPSILON) * 100) / 100;

      const elapsedMsg = `Network state fetch finished, elapsed: ${rounded} ms`;
      // We run first time without a blockheight, only on events do we get the height
      const blockMsg = blockHeight ? `. Block height: ${blockHeight}` : '';
      log.info(elapsedMsg + blockMsg);

      // eslint-disable-next-line no-await-in-loop
      if (!state.length) await this.#controller.sleep(15_000);
    } while (!populated && !state.length);

    if (state.length) {
      this.#state = state;

      const indexStart = process.hrtime.bigint();

      await this.#buildIndexes(this.#state);

      const indexElapsed =
        Number(process.hrtime.bigint() - indexStart) / 1_000_000;

      const rounded = Math.round((indexElapsed + Number.EPSILON) * 100) / 100;

      const pubkeySize = this.#pubkeyIndex.size;
      const socketAddressSize = this.#socketAddressIndex.size;

      log.info(
        'Network State Indexes created, nodes found: ' +
        `${state.length}, elapsed: ${rounded} ms`
      );

      log.info(
        `pubkeyIndexSize: ${pubkeySize}, socketAddressSize: ${socketAddressSize}`
      );

      if (!populated) {
        this.emit('populated');
        if (this.#onStartComplete) this.#onStartComplete();
        this.#started = true;
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
    const handler = async (blockHeight) => {
      if (!this.canFetch) {
        log.info(
          'Throttling networkUpdate - using cached nodelist ' +
          `(${this.nodeCount} nodes). Next call allowed in ${this.remainingFetchSeconds}s`
        );

        return;
      }

      if (this.#fetchQueued) {
        log.info(
          `Block ${blockHeight} received but a fetch ` +
          'is already queued... skipping'
        );

        return;
      }

      if (this.fetchRunning) {
        log.info(
          'Block received but fetching in progress... ' + 'queueing next fetch'
        );

        this.#fetchQueued = true;
        await this.waitFetchComplete;
        this.#fetchQueued = false;
      }

      await this.fetchNetworkState(blockHeight);
    };

    this.#boundEventHandler = handler;

    this.#stateEmitter.on(this.stateEvent, handler);
  }

  async start() {
    await this.fetchNetworkState();
    await this.waitStarted;

    const updater =
      this.#stateEmitter && this.stateEvent
        ? this.#startEventEmitter
        : this.#startPolling;

    updater.bind(this)();
  }

  async stop() {
    await this.#controller.abort();

    if (this.#stateEmitter) {
      this.#stateEmitter.removeListener(
        this.stateEvent,
        this.#boundEventHandler
      );
      this.#boundEventHandler = null;
    }

    this.reset();
  }

  /**
   * Find node(s) in the fluxnode network state by either pubkey or socketAddress
   *
   * @param {string} filter pubkey or socketAddress (ip:port)
   * @param {"pubkey" | "socketAddress"} type
   * @returns {Promise<Map<string, Fluxnode>> | Fluxnode | null>} Clone of the state
   */
  async search(filter, type) {
    const invalidInput =
      !filter || typeof filter !== 'string' || typeof type !== 'string';

    if (invalidInput) return null;

    if (!Object.keys(this.#indexes).includes(type)) return null;

    // if we are mid stroke indexing, may as well wait the ~10ms and get the
    // latest block
    await this.waitIndexesReady;

    const cached = this.#indexes[type].get(filter);
    const clone = cached ? NetworkStateManager.deepClone(cached) : null;

    return clone;
  }

  /**
   * Verify if node is in network state. Filter by either pubkey or socketAddress
   *
   * @param {string} filter pubkey or socketAddress (ip:port)
   * @param {"pubkey" | "socketAddress"} type
   * @returns {Promise<boolean>} If the target exists in the state
   */
  async includes(filter, type) {
    if (!filter) return false;
    if (!Object.keys(this.#indexes).includes(type)) return false;

    // if we are mid stroke indexing, may as well wait the 10ms (max) and get the
    // latest block
    await this.waitIndexesReady;

    const found = this.#indexes[type].has(filter);

    return found;
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
    console.log('fetcher says no');
    return [];
  };

  const network = new NetworkStateManager(fetcher, { intervalMs: 120_000, zmqEndpoint: 'tcp://127.0.0.1:28332' });
  network.on('updated', () => {
    console.log('received updated event');
  });
  network.on('populated', async () => {
    console.log('received populated event');
    console.log('Search result populated:', await network.search('212.71.244.159:16137', 'socketAddress'));
  });
  network.start();
  setInterval(async () => {
    // await network.search('212.71.244.159:16137', 'socketAddress');
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
