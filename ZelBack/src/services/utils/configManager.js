const EventEmitter = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const { watch } = require('node:fs/promises');
const hash = require('object-hash');

/**
 * ConfigManager - Centralized configuration management with hot reload support
 *
 * This module provides a singleton that manages userconfig with event-based
 * hot reload capabilities. Services can subscribe to config changes and
 * always get the latest configuration values.
 *
 * Usage:
 *   const configManager = require('./utils/configManager');
 *
 *   // Access config directly via globalThis
 *   const apiPort = globalThis.userconfig.initial.apiport;
 *
 *   // Listen for changes (only needed for reactive services like daemon client)
 *   configManager.on('configReloaded', (newConfig) => {
 *     // Handle config change
 *   });
 */
class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.configPath = path.join(__dirname, '../../../../config/userconfig.js');
    this.initialHash = null;
    this.loadConfig();
  }

  /**
   * Load or reload the userconfig
   * @param {boolean} isReload - Whether this is a reload operation
   */
  loadConfig(isReload = false) {
    try {
      // Clear cache if reloading
      if (isReload && require.cache[require.resolve('../../../../config/userconfig')]) {
        delete require.cache[require.resolve('../../../../config/userconfig')];
      }

      // eslint-disable-next-line global-require
      const userconfig = require('../../../../config/userconfig');

      // The writers rewrite this file whole, so a read can land between the truncate
      // and the write. require() resolves an empty or truncated file to an object
      // rather than throwing, which makes a missing `initial` the only evidence that
      // it did.
      if (!userconfig || typeof userconfig.initial !== 'object' || userconfig.initial === null) {
        throw new Error('userconfig.js carries no initial section');
      }

      // Set on globalThis for global access
      globalThis.userconfig = userconfig;

      // Store hash for file watching
      if (!isReload) {
        this.initialHash = hash(fs.readFileSync(this.configPath));
      }

      if (isReload) {
        this.emit('configReloaded', userconfig);
      }
      return true;
    } catch (error) {
      console.error('Error loading userconfig:', error);
      // A node that already holds a config keeps it. The defaults below carry no zelid
      // and no keypair, so publishing them over a good config would have the node act
      // under an identity that is not its own — and the read that failed is most often
      // a write in progress, which the next change event resolves.
      if (globalThis.userconfig && globalThis.userconfig.initial) {
        return false;
      }
      // Initialize with defaults if load fails
      globalThis.userconfig = {
        initial: {
          ipaddress: '127.0.0.1',
          zelid: null,
          kadena: '',
          testnet: false,
          development: false,
          apiport: 16127,
          routerIP: '',
          pgpPrivateKey: '',
          pgpPublicKey: '',
          blockedPorts: [],
          blockedRepositories: [],
        },
      };
      return false;
    }
  }

  /**
   * Reload configuration from disk
   * This should be called when the config file changes
   */
  reloadConfig() {
    const hashCurrent = hash(fs.readFileSync(this.configPath));
    if (hashCurrent === this.initialHash) {
      return;
    }
    // Recorded only once the file has actually been read. Stamping it first marks a
    // half-written file as the version this node holds, when what it holds is still
    // the previous config - so the write that completes a moment later has to be
    // noticed all over again to be picked up.
    if (this.loadConfig(true)) {
      this.initialHash = hashCurrent;
    }
  }

  /**
   * Start watching the config file for changes
   * @param {Function} log - Logger function
   * @param {Function} onReload - Optional callback for additional reload logic
   */
  async startWatching(log, onReload) {
    try {
      const configDir = path.join(__dirname, '../../../../config');
      const watcher = watch(configDir);
      // eslint-disable-next-line
      for await (const event of watcher) {
        if (event.eventType === 'change' && event.filename === 'userconfig.js') {
          log.info(`Config file changed, reloading ${event.filename}...`);
          this.reloadConfig();
          if (onReload) {
            await onReload(globalThis.userconfig);
          }
        }
      }
    } catch (error) {
      log.error(`Error watching config file: ${error}`);
    }
  }

  /**
   * Get the current userconfig object
   * @returns {object} Current userconfig
   */
  getUserConfig() {
    return globalThis.userconfig;
  }

  /**
   * Get a specific config value
   * @param {string} path - Dot notation path (e.g., 'initial.apiport')
   * @returns {*} Config value
   */
  getConfigValue(path) {
    const config = globalThis.userconfig;
    const parts = path.split('.');
    let value = config;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Check if config has been initialized
   * @returns {boolean}
   */
  isInitialized() {
    return globalThis.userconfig !== null && globalThis.userconfig !== undefined;
  }
}

// Create singleton instance
const configManager = new ConfigManager();

module.exports = configManager;
