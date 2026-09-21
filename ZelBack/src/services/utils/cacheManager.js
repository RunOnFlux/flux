/* eslint max-classes-per-file: ["error", 2] */

const TTLCache = require('@isaacs/ttlcache');
const log = require('../../lib/log');
const { FluxController } = require('./fluxController');

class FluxTTLCache extends TTLCache {
  #history = new Map([['get', 0], ['has', 0], ['set', 0]]);

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

  get(key, options) {
    const value = super.get(key, options);

    const counter = this.#history.get('get');
    this.#history.set('get', counter + 1);

    return value;
  }

  has(key) {
    const value = super.has(key);

    const counter = this.#history.get('has');
    this.#history.set('has', counter + 1);

    return value;
  }

  set(key, value, options) {
    super.set(key, value, options);

    const counter = this.#history.get('set');
    this.#history.set('set', counter + 1);
  }

  clearHistory() {
    this.#history = new Map([['get', 0], ['has', 0], ['set', 0]]);
  }

  getHistory() {
    return {
      get: this.#history.get('get'),
      has: this.#history.get('has'),
      set: this.#history.get('set'),
    };
  }
}

class FluxCacheManager {
  #controller = new FluxController();

  static oneSecond = 1_000;

  static oneMinute = 60_000;

  static oneHour = 3_600_000;

  static oneDay = 86_400_000;

  /**
   * A lot of these caches don't make sense. They are for api calls.
   * We should centralize the api calls, then put an LRU cache on that
   */
  static cacheConfigs = {
    // appsService
    appSpawnErrorCache: {
      max: 250,
      ttl: 7 * FluxCacheManager.oneDay,
    },
    appSpawnCache: {
      max: 250,
      ttl: 12 * FluxCacheManager.oneHour,
    },
    syncthingDevicesCache: {
      max: 50,
      ttl: FluxCacheManager.oneDay,
    },
    syncthingAppsCache: {
      max: 50,
      ttl: 3 * FluxCacheManager.oneHour,
    },
    testPortsCache: {
      max: 60,
      ttl: 3 * FluxCacheManager.oneHour,
    },
    // One answer per node - this asks what ports THIS node holds, so there is
    // nothing to key on and exactly one entry. It changes only when this node
    // installs or removes an app, and it is read by every sibling asking before
    // it installs.
    portsInUseCache: {
      max: 1,
      ttl: 30 * FluxCacheManager.oneSecond,
    },
    appPriceBlockedRepoCache: {
      max: 50,
      ttl: 3 * FluxCacheManager.oneHour,
    },
    fluxRatesCache: {
      max: 50,
      ttl: 5 * FluxCacheManager.oneMinute,
    },
    dockerHubVerificationCache: {
      max: 200,
      ttl: FluxCacheManager.oneHour,
    },
    registryProviderCache: {
      max: 500,
      ttl: 12 * FluxCacheManager.oneHour,
    },
    // fluxCommunicationMessageSender
    tempMessageCache: {
      max: 250,
      ttl: 20 * FluxCacheManager.oneMinute,
    },
    // fluxNetwork Helper
    ipCache: {
      max: 1,
      ttl: FluxCacheManager.oneDay,
    },
    rateLimitCache: {
      max: 150,
      ttl: 15 * FluxCacheManager.oneSecond,
      updateAgeOnGet: true,
    },
    // fluxCommunication. Two stores, because remembering a fact and being able to
    // hand it over are different jobs with different keys, contents and membership:
    //
    //   store              | key -> value          | holds              | why its own
    //   -------------------|-----------------------|--------------------|---------------------
    //   announcementSeen   | hash(data) -> true    | every announcement | runs before signature
    //                      |                       |                    | verification, so it is
    //                      |                       |                    | what bounds that cost
    //   announcementStore  | hash(data) -> message | announcements this | serves a peer that
    //                      |                       | node announced     | asks for the hash
    //
    // A node receives around 2.4k messages a minute from 26 peers, of which about 135
    // are distinct - so the filter collapses roughly eighteen copies into one, and it
    // sits in front of verification because that is the work being saved.
    //
    // The store holds only what this node announced, which is exactly the set a peer
    // can legitimately request: a request follows an announcement. Policy bundles,
    // asks and answers never enter it, so its entries no longer carry the payload of
    // messages nobody will ever fetch by hash.
    announcementSeen: {
      max: 1_000,
      ttl: 5 * FluxCacheManager.oneMinute,
    },
    announcementStore: {
      max: 1_000,
      ttl: 5 * FluxCacheManager.oneMinute,
    },
    wsPeerCache: {
      max: 100,
      ttl: 15 * FluxCacheManager.oneMinute,
    },
    // daemonServiceUtils
    daemonGenericCache: {
      max: 50,
      ttl: 20 * FluxCacheManager.oneSecond,
    },
    daemonTxCache: {
      max: 300,
      ttl: FluxCacheManager.oneHour,
    },
    daemonBlockCache: {
      max: 150,
      ttl: FluxCacheManager.oneHour,
    },
    // appQueryService
    enterpriseAppDecryptionCache: {
      max: 100,
      ttl: 7 * FluxCacheManager.oneDay,
    },
    // Pending app updates queue - stores update messages that arrived before registration
    pendingAppUpdatesCache: {
      max: 200,
      ttl: 30 * FluxCacheManager.oneMinute,
    },
    // appUtilities - disk usage moves slowly, while the monitoring UI polls app stats
    // every few seconds. Sample it once a minute however many callers ask.
    containerStorageCache: {
      max: 100,
      ttl: FluxCacheManager.oneMinute,
    },
    // paymentRelayService - one entry per browser waiting on a wallet, holding
    // the transaction id that wallet leaves. An hour is how long a wallet has
    // to answer; the bound is what a flood of unauthenticated requests costs.
    paymentRelayCache: {
      max: 20000,
      ttl: FluxCacheManager.oneHour,
    },
  };

  constructor() {
    const entries = Object.entries(FluxCacheManager.cacheConfigs);
    // eslint-disable-next-line no-restricted-syntax
    for (const [cacheName, cacheConfig] of entries) {
      this[cacheName] = new FluxTTLCache(cacheConfig);
    }
  }

  logCacheSizes() {
    Object.keys(FluxCacheManager.cacheConfigs).forEach(
      (cacheName) => {
        const { get, has, set } = this[cacheName].getHistory();
        this[cacheName].clearHistory();
        log.info(`Cache: ${cacheName}, Size: ${this[cacheName].size}, `
          + `getCount: ${get}, hasCount: ${has}, setCount: ${set}`);
      },
    );
  }

  async logCacheSizesEvery(intervalMs) {
    while (!this.#controller.aborted) {
      // eslint-disable-next-line no-await-in-loop
      await this.#controller.sleep(intervalMs);

      this.logCacheSizes();
    }
  }

  resetCaches() {
    Object.keys(FluxCacheManager.cacheConfigs).forEach(
      (cacheName) => {
        this[cacheName].clear();
      },
    );
  }
}

const fluxCaching = new FluxCacheManager();

module.exports = { default: fluxCaching, FluxTTLCache, FluxCacheManager };
