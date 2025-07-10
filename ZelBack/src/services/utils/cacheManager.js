const TTLCache = require('@isaacs/ttlcache');
const log = require('../../lib/log');
const { FluxController } = require('./fluxController');

class FluxCacheManager {
  #controller = new FluxController();

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
      max: 500,
      ttl: 7 * FluxCacheManager.oneDay,
    },
    appSpawnCache: {
      max: 500,
      ttl: 12 * FluxCacheManager.oneHour,
    },
    syncthingDevicesCache: {
      max: 500,
      ttl: FluxCacheManager.oneDay,
    },
    syncthingAppsCache: {
      max: 500,
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
      max: 500,
      ttl: 3 * FluxCacheManager.oneHour,
    },
    fluxRatesCache: {
      max: 500,
      ttl: 5 * FluxCacheManager.oneMinute,
    },
    // fluxCommunicationMessageSender
    tempMessageCache: {
      max: 1000,
      ttl: 20 * FluxCacheManager.oneMinute,
    },
    // fluxNetwork Helper. This should just be an object with
    // a setTimeout to delete the value
    ipCache: {
      max: 1,
      ttl: FluxCacheManager.oneDay,
    },
    rateLimitCache: {
      max: 500,
      ttl: 15 * FluxCacheManager.oneSecond,
    },
    // fluxCommunication
    messageCache: {
      max: 2000,
      ttl: 70 * FluxCacheManager.oneMinute,
    },
    blockedPubkeysCache: {
      max: 2000,
      ttl: 6 * FluxCacheManager.oneMinute,
    },
    // daemonServiceUtils
    daemonGenericCache: {
      max: 500,
      ttl: 20 * FluxCacheManager.oneSecond,
    },
    daemonTxCache: {
      max: 3000,
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
      this[cacheName] = new TTLCache(cacheConfig);
    }
  }

  logCacheSizes() {
    Object.keys(FluxCacheManager.cacheConfigs).forEach(
      (cacheName) => {
        log.info(`Cache: ${cacheName}, Size: ${this[cacheName].size}`);
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
}

const fluxCaching = new FluxCacheManager();

module.exports = fluxCaching;
