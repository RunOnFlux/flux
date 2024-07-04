// const { Worker } = require('node:worker_threads');

const { EventEmitter } = require('node:events');
// const { FluxController } = require('../zelflux/ZelBack/src/services/utils/fluxController');

const { FluxController } = require('./fluxController');

const zmq = require('zeromq');

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

  #endpointIndex = new Map();

  #controller = new FluxController();

  #socket = zmq.socket('sub');

  #socketConnected = null;

  #indexStart = null;

  #updatingState = false;

  /**
   * @type { "polling" | "subscription" }
   */
  #updateTrigger = 'subscription';

  /**
   *
   * @param {()=>Promise<Array<Fluxnode>>} stateFetcher
   * @param {{intervalMs?: number, zmqEndpoint?: string, fallbackTimeout?: number}} options
   */
  constructor(stateFetcher, options = {}) {
    super();

    this.stateFetcher = stateFetcher;
    this.intervalMs = options.intervalMs || 120_000;
    this.zmqEndpoint = options.zmqEndpoint || null;

    if (!this.zmqEndpoint) this.#updateTrigger = 'polling';

    this.fallbackTimeout = options.fallbackTimeout || 120_000;

    this.#socket.setsockopt(zmq.ZMQ_RECONNECT_IVL, 500);
    this.#socket.setsockopt(zmq.ZMQ_RECONNECT_IVL_MAX, 15_000);
    this.#socket.setsockopt(zmq.ZMQ_HEARTBEAT_IVL, 20_000);
    this.#socket.setsockopt(zmq.ZMQ_HEARTBEAT_TIMEOUT, 60_000);
    this.#socket.setsockopt(zmq.ZMQ_CONNECT_TIMEOUT, 3_000);
    this.#socket.monitor();
  }

  get state() {
    // should probably return a complete copy
    return this.#state;
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
    return { pubkey: this.#pubkeyIndex, endpoint: this.#endpointIndex };
  }

  #setIndexes(pubkeyIndex, endpointIndex) {
    this.#pubkeyIndex = pubkeyIndex;
    this.#endpointIndex = endpointIndex;
  }

  async #buildIndexes(nodes) {
    // nodes.forEach((node) => {
    //   if (!this.#pubkeyIndex.has(node.pubkey)) {
    //     this.#pubkeyIndex.set(node.pubkey, new Map());
    //   }
    //   this.#pubkeyIndex.get(node.pubkey).set(node.ip, node);
    //   this.#endpointIndex.set(node.ip, node);
    // });

    // if we are building an index already, just wait for it to finish.
    // maybe look at cancelling it in future.
    await this.#controller.lock.enable();

    const nodeCount = nodes.length;

    const pubkeyIndex = new Map();
    const endpointIndex = new Map();

    function iterIndexes(startIndex, callback) {
      const endIndex = startIndex + 1000;
      const chunk = nodes.slice(startIndex, endIndex);

      chunk.forEach((node) => {
        const nodesByPubkey = pubkeyIndex.get(node.pubkey)
          || pubkeyIndex.set(node.pubkey, new Map()).get(node.pubkey);

        nodesByPubkey.set(node.ip, node);
        endpointIndex.set(node.ip, node);
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
        this.#setIndexes(pubkeyIndex, endpointIndex);
        console.log('pubkeyIndexSize:', pubkeyIndex.size);
        console.log('endpointIndexSize:', endpointIndex.size);
        this.#controller.lock.disable();
        resolve();
      });
    });
  }

  reset() {
    // recreate objects so they can't be mutated externally
    this.#pubkeyIndex = new Map();
    this.#endpointIndex = new Map();
    this.#state = [];
  }

  async fetchNetworkState() {
    console.log('fetching state');
    this.#updatingState = true;
    // always use monotonic clock for any elapsed times
    const start = process.hrtime.bigint();

    let state = [];

    while (!state.length) {
      if (this.#controller.aborted) break;

      const fetchStart = process.hrtime.bigint();
      // eslint-disable-next-line no-await-in-loop
      const res = await this.stateFetcher().catch(() => {
        console.log('state fetcher error');
        return [];
      });

      console.log('Fetch finished, elapsed ms:', Number(process.hrtime.bigint() - fetchStart) / 1000000);

      // eslint-disable-next-line no-await-in-loop
      state = res || await this.#controller.sleep(15_000);
    }

    const populated = Boolean(this.#state.length);

    if (state.length) {
      console.log('Nodes found:', state.length);

      this.#state = state;

      console.log('Setting state and indexes');
      this.#indexStart = process.hrtime.bigint();

      await this.#buildIndexes(this.#state);
      console.log('Indexes created, elapsed ms:', Number(process.hrtime.bigint() - this.#indexStart) / 1000000);
      this.#indexStart = null;

      if (!populated) this.emit('populated');
      this.emit('updated');
    }

    this.#updatingState = false;

    const elapsed = Number(process.hrtime.bigint() - start) / 1000000;
    return this.intervalMs - elapsed;
  }

  #handleBlock(msgBuf, seqBuf) {
    const blockId = msgBuf.toString('hex');
    const seq = seqBuf.readUInt32LE(0);
    console.log(`hashblock: ${blockId}, sequence: ${seq}`);

    if (this.#updatingState) this.#controller.abort();
    this.fetchNetworkState();

    // should we await fetch before emitting block?
    this.emit('block', blockId);
  }

  #handleMessage(topicBuf, msgBuf, seqBuf) {
    const topic = topicBuf.toString();

    switch (topic) {
      case 'hashblock':
        this.#handleBlock(msgBuf, seqBuf);
        break;
      default:
        throw new Error(`Unknown topic: ${topic}`);
    }
  }

  /**
   * Test if the zmqendpoint is connectable. Takes about 8 seconds to fail
   */
  async #probeZmqEndpoint() {
    const maxRetries = 10;
    let retryCounter = 0;

    const probe = zmq.socket('sub');

    probe.setsockopt(zmq.ZMQ_RECONNECT_IVL, 200);
    probe.setsockopt(zmq.ZMQ_RECONNECT_IVL_MAX, 1000);
    probe.setsockopt(zmq.ZMQ_CONNECT_TIMEOUT, 3_000);

    probe.monitor();

    return new Promise((resolve) => {
      probe.on('connect', () => {
        console.log('probe connected');
        probe.unmonitor();
        probe.close();
        resolve(true);
      });

      probe.on('connect_retry', (retryTimer) => {
        retryCounter += 1;

        if (retryCounter < maxRetries) {
          console.log('probe retrying ms:', retryTimer);
          return;
        }

        console.log('max retries hit, bailing');
        probe.unmonitor();
        probe.close();
        resolve(false);
      });

      probe.connect(this.zmqEndpoint);
    });
  }

  async #startSubscription() {
    console.log('start subscription');
    await this.fetchNetworkState();

    const zmqEnabled = await this.#probeZmqEndpoint();

    if (!zmqEnabled) {
      console.log('zmq not enabled');
      this.#updateTrigger = 'polling';
      this.#startPolling();
      return;
    }

    console.log('probe connected, setting up subscription');

    this.#socket.on('connect', () => {
      if (this.#socketConnected === false) {
        // State: previously connected, now reconnected.
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
        this.#controller.stopLoop();
      }

      this.#socketConnected = true;
      this.emit('zmqConnected');
    });

    this.#socket.on('disconnect', () => {
      this.#socketConnected = false;
      this.emit('zmqDisconnected');
      this.fallbackTimer = setTimeout(() => this.#startPolling(), this.fallbackTimeout);
    });

    this.#socket.on('message', (...args) => this.#handleMessage(...args));

    this.#socket.connect(this.zmqEndpoint);
    this.#socket.subscribe('hashblock');
  }

  #startPolling() {
    this.#controller.startLoop(this.fetchNetworkState);
  }

  async start() {
    const starter = this.zmqEndpoint
      ? this.#startSubscription
      : this.#startPolling;

    starter.bind(this)();
  }

  async stop() {
    // is this right?
    await this.#controller.abort();
  }

  /**
   * Find a node in the fluxnode network state by either pubkey or endpoint
   *
   * @param {string} filter Pubkey or endpoint (ip:port)
   * @param {"pubkey"|"endpoint"} type
   * @returns
   */
  async search(filter, type) {
    if (!filter) return null;
    if (!Object.keys(this.#indexes).includes(type)) return null;

    // if we are mid stroke indexing, may as well wait the 10ms (max) and get the
    // latest block
    await this.indexesReady;

    const cached = this.#indexes[type].get(filter);
    return cached || null;
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
// endpointIndexSize: 13041
// Indexes created, elapsed ms: 18.25089
// New Flux App Removed message received.
