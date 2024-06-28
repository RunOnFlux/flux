/**
 * This should really subscribe to fluxd blocks using zmq.
 * It doesn't make sense to poll every 2 minutes when you often get
 * multiple blocks in a short timeframe.
 */

globalThis.userconfig = { initial: { testnet: false } };

const { EventEmitter } = require('node:events');
const { FluxController } = require('./fluxController');

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

  /**
   *
   * @param {()=>Promise<Array<Fluxnode>>} stateFetcher
   * @param {{}} options
   */
  constructor(stateFetcher, options = {}) {
    super();

    this.stateFetcher = stateFetcher;
    this.intervalMs = options.intervalMs || 0;
  }

  get state() {
    // should probably return a complete copy
    return this.#state;
  }

  get running() {
    return this.#running;
  }

  #setIndexes(nodes, filter, type) {
    // storing a reference is 64 bits, same as a number, so may
    // as well just store the reference, instead of array index

    const remove = Boolean(nodes.length);

    if (remove) {
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

    this.#setIndexes(this.#state);
  }

  async start() {
    const runner = async () => {
      const start = Date.now();
      const state = await this.stateFetcher().catch(() => []);
      const populated = Boolean(this.#state.length);

      if (state.length) {
        this.#state = state;
        this.#recreateIndexes();
        if (!populated) this.emit('populated');
        this.emit('updated');
      }

      const elapsed = Date.now() - start;
      return this.intervalMs - elapsed;
    };

    this.#controller.startLoop(runner);
  }

  async stop() {
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
  async search(filter, type) {
    if (!filter) return null;
    if (!Object.keys(this.#indexes).includes(type)) return null;

    const cached = this.#indexes[type].get(filter);
    if (cached) return cached;

    // this is a reference to the object in the LRU cache (daemonServiceutils),
    // if you modify this object, you are actually modifying the object in the cache.
    // Any LRU cache should not return a direct object, it should return a copy.
    const nodes = await this.stateFetcher(filter).catch(() => []);

    this.#setIndexes(nodes, filter, type);

    return this.#indexes[type].get(filter);
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

main();

module.exports = { NetworkStateManager };
