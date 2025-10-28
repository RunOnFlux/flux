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
    stoppedAppsCache: {
      max: 40,
      ttl: 1.5 * FluxCacheManager.oneHour,
    },
    testPortsCache: {
      max: 60,
      ttl: 3 * FluxCacheManager.oneHour,
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
    // fluxCommunication
    // this is basically all messageHashPresent and requestMessageHash messages
    // They receive around 2.4k messages a minute (26 peers). Of those 2.4k, there are about
    // 135 unique messages. Every node doesn't need to broadcast to every other node
    // it causes huge volumes of traffic and uses quite a bit of horsepower to hash
    // every message, and check if it's in the cache. We should come up with a better algo here.
    messageCache: {
      max: 1_000,
      ttl: FluxCacheManager.oneMinute,
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
