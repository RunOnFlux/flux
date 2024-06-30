/**
 * This should really subscribe to fluxd blocks using zmq.
 * It doesn't make sense to poll every 2 minutes when you often get
 * multiple blocks in a short timeframe.
 */

const { Worker } = require('node:worker_threads');

const { EventEmitter } = require('node:events');
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

  #indexes = { pubkey: this.#pubkeyIndex, endpoint: this.#endpointIndex };

  #running = false;

  #controller = new FluxController();

  #socket = new zmq.Subscriber({
    reconnectInterval: 500,
    reconnectMaxInterval: 15_000,
    heartbeatInterval: 20_000,
    heartbeatTimeout: 60_000,
    connectTimeout: 3_000,
    tcpMaxRetransmitTimeout: 120_000,
  });

  #socketConnected = null;

  #updatingState = false;

  #indexWorker = null;

  #indexStart = null;

  /**
   *
   * @param {()=>Promise<Array<Fluxnode>>} stateFetcher
   * @param {{}} options
   */
  constructor(stateFetcher, options = {}) {
    super();

    this.stateFetcher = stateFetcher;
    this.intervalMs = options.intervalMs || 0;
    this.zmqEndpoint = options.zmqEndpoint || null;
    this.fallbackTimeout = options.fallbackTimeout || 120_000;
    this.useIndexWorker = options.useIndexWorker || false;

    if (this.useIndexWorker) {
      this.#createIndexWorker();
    }
  }

  get state() {
    // should probably return a complete copy
    return this.#state;
  }

  get running() {
    return this.#running;
  }

  #createIndexWorker() {
    this.#indexWorker = new Worker('./ZelBack/src/services/utils/networkStateWorker.js');
    this.#indexWorker.on('message', (indexes) => {
      console.log('Indexes created, elapsed ms:', Number(process.hrtime.bigint() - this.#indexStart) / 1000000);
      this.#indexStart = null;

      const { pubkeyIndex, endpointIndex } = indexes;
      this.#setIndexes(pubkeyIndex, endpointIndex);
      this.emit('updated');
    });
    this.#indexWorker.on('error', (err) => { console.log(err); });
    this.#indexWorker.on('exit', (code) => { console.log(code); });
  }

  #setIndexes(pubkeyIndex, endpointIndex) {
    this.#pubkeyIndex = pubkeyIndex;
    this.#endpointIndex = endpointIndex;
  }

  #buildIndexes(nodes, options = {}) {
    const filter = options.filter || null;
    const type = options.type || 'stateUpdate';

    if (type === 'stateUpdate') {
      // nodes.forEach((node) => {
      //   if (!this.#pubkeyIndex.has(node.pubkey)) {
      //     this.#pubkeyIndex.set(node.pubkey, new Map());
      //   }
      //   this.#pubkeyIndex.get(node.pubkey).set(node.ip, node);
      //   this.#endpointIndex.set(node.ip, node);
      // });
      nodes.forEach((node) => {
        const nodesByPubkey = this.#pubkeyIndex.get(node.pubkey)
          || this.#pubkeyIndex.set(node.pubkey, new Map()).get(node.pubkey);

        nodesByPubkey.set(node.ip, node);
        this.#endpointIndex.set(node.ip, node);
      });
      // nodes.forEach((node) => {
      //   const pubkeyIndex = this.#pubkeyIndex.get(node.pubkey) || new Map();
      //   pubkeyIndex.set(node.ip, node);
      //   this.#endpointIndex.set(node.ip, node);
      // });
      return;
    }

    if (!nodes.length) {
      if (type === 'pubkey') {
        const toDelete = this.#indexes.pubkey.get(filter);
        this.#indexes.pubkey.delete(filter);
        toDelete.forEach((node) => {
          this.#indexes.endpoint.delete(node.ip);
        });
      } else if (type === 'endpoint') {
        this.#indexes.endpoint.delete(filter);
      }

      return;
    }

    let pubkeyMap = null;

    if (type === 'pubkey') {
      pubkeyMap = new Map();
      this.#pubkeyIndex.set(nodes[0].pubkey, pubkeyMap);
    }

    nodes.forEach((node) => {
      if (type === 'pubkey') pubkeyMap.set(node.ip, node);

      this.#endpointIndex.set(node.ip, node);
    });
  }

  #recreateIndexes() {
    this.#pubkeyIndex.clear();
    this.#endpointIndex.clear();

    this.#buildIndexes(this.#state);
  }

  reset() {
    // recreate objects so they can't be mutated externally
    this.#pubkeyIndex = new Map();
    this.#endpointIndex = new Map();
    this.#state = [];
  }

  async fetchNetworkState() {
    this.#updatingState = true;
    // should use monotonic clock for any elapsed times
    const start = process.hrtime.bigint();

    let state = null;

    while (!state) {
      if (this.#controller.aborted) break;

      const fetchStart = process.hrtime.bigint();
      // eslint-disable-next-line no-await-in-loop
      const res = await this.stateFetcher().catch(() => null);
      console.log('Fetch finished, elapsed ms:', Number(process.hrtime.bigint() - fetchStart) / 1000000);

      // eslint-disable-next-line no-await-in-loop
      state = res || await this.#controller.sleep(15_000);
    }

    const populated = Boolean(this.#state.length);

    if (state.length) {
      console.log('Nodes found:', state.length);
      console.log('Setting state and indexes');
      this.#indexStart = process.hrtime.bigint();
      this.#state = state;

      if (!populated) this.emit('populated');

      if (this.useIndexWorker) {
        this.#indexWorker.postMessage(state);
      } else {
        this.#recreateIndexes();
        console.log('Indexes created, elapsed ms:', Number(process.hrtime.bigint() - this.#indexStart) / 1000000);
        this.#indexStart = null;

        this.emit('updated');
      }
    }

    this.#updatingState = false;

    const elapsed = Number(process.hrtime.bigint() - start) / 1000000;
    return this.intervalMs - elapsed;
  }

  async #handleBlocks() {
    await this.fetchNetworkState();
    // eslint-disable-next-line no-restricted-syntax
    for await (const [topicBuf, msgBuf, seqBuf] of this.#socket) {
      const topic = topicBuf.toString();
      const blockId = msgBuf.toString('hex');
      const seq = seqBuf.readUInt32LE(0);
      console.log(`${topic}: ${blockId}, sequence: ${seq}`);
      this.emit('block', blockId);

      if (this.#updatingState) this.#controller.abort();
      this.fetchNetworkState();
    }
  }

  #startSubscription() {
    this.#socket.events.on('connect', () => {
      if (this.#socketConnected === false) {
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
        this.#controller.stopLoop();
      }

      this.#socketConnected = true;
      this.emit('zmqConnected');
    });

    this.#socket.events.on('disconnect', () => {
      this.#socketConnected = false;
      this.emit('zmqDisconnected');
      this.fallbackTimer = setTimeout(() => this.#startPolling(), this.fallbackTimeout);
    });

    this.#socket.connect(this.zmqEndpoint);
    this.#socket.subscribe('hashblock');

    this.#handleBlocks();
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
     * Find a node in the fluxnode list by either pubkey or endpoint, it
     * first looks up the node locally, using O(1) from a Map; failing that,
     * it goes out to the api and fetches it, and updates the local cache.
     *
     * @param {string} filter Pubkey or endpoint (ip:port)
     * @param {"pubkey"|"endpoint"} type
     * @returns
     */
  search(filter, type) {
    if (!filter) return null;
    if (!Object.keys(this.#indexes).includes(type)) return null;

    const cached = this.#indexes[type].get(filter);
    // if (cached) return cached;
    return cached || null;

    // this is a reference to the object in the LRU cache (daemonServiceutils),
    // if you modify this object, you are actually modifying the object in the cache.
    // Any LRU cache should not return a direct object, it should return a copy.
    // const nodes = await this.stateFetcher(filter).catch(() => []);

    // this.#setIndexes(nodes, { filter, type });

    // return this.#indexes[type].get(filter);
  }
}

const daemonServiceFluxnodeRpcs = require('../daemonService/daemonServiceFluxnodeRpcs');

async function main() {
  const fetcher = async (filter = null) => {
    const options = { params: { filter }, query: { filter: null } };

    const res = await daemonServiceFluxnodeRpcs.viewDeterministicFluxNodeList(options);

    if (res.status === 'success') {
      return res.data;
    }
    return [];
  };

  const network = new NetworkStateManager(fetcher, { intervalMs: 120_000 });
  network.on('updated', () => {
    console.log('received updated event');
  });
  network.on('populated', async () => {
    console.log('received populated event');
    console.log(await network.search('212.71.244.159:16137', 'endpoint'));
  });
  // network.start();
  setInterval(async () => {
    // await network.search('212.71.244.159:16137', 'endpoint');
    console.log(await network.search('0404bccaf5d3108439b4897697bf7ce4d045950264e118596e31cc579028a7f808870d6ac59b9c00412d2f354610a9d18b47db80b08ba6536f0ae093c08a3aaccb', 'pubkey'));
  }, 5_000);
}

if (require.main === module) {
  main();
}

module.exports = { NetworkStateManager };
