const EventEmitter = require('node:events');
const path = require('node:path');

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
 *   // Get current config
 *   const config = configManager.getUserConfig();
 *
 *   // Listen for changes
 *   configManager.on('configReloaded', (newConfig) => {
 *     // Handle config change
 *   });
 */
class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.userconfig = null;
    this.configPath = null;
    this.loadConfig();
  }

  /**
   * Load or reload the userconfig
   * @param {boolean} isReload - Whether this is a reload operation
   */
  loadConfig(isReload = false) {
    try {
      // Use global.userconfig if available (set by apiServer.js)
      if (global.userconfig) {
        this.userconfig = global.userconfig;
        this.configPath = path.join(__dirname, '../../../../config/userconfig.js');
      } else {
        // Fallback to direct require
        this.configPath = path.join(__dirname, '../../../../config/userconfig.js');

        // Clear cache if reloading
        if (isReload && require.cache[require.resolve('../../../../config/userconfig')]) {
          delete require.cache[require.resolve('../../../../config/userconfig')];
        }

        // eslint-disable-next-line global-require
        this.userconfig = require('../../../../config/userconfig');
      }

      if (isReload) {
        this.emit('configReloaded', this.userconfig);
      }
    } catch (error) {
      console.error('Error loading userconfig:', error);
      // Initialize with defaults if load fails
      this.userconfig = {
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
    }
  }

  /**
   * Reload configuration from disk
   * This should be called when the config file changes
   */
  reloadConfig() {
    // Update from global if it was updated by apiServer
    if (global.userconfig) {
      this.userconfig = global.userconfig;
      this.emit('configReloaded', this.userconfig);
    } else {
      this.loadConfig(true);
    }
  }

  /**
   * Get the current userconfig object
   * @returns {object} Current userconfig
   */
  getUserConfig() {
    // Always return the latest from global if available
    if (global.userconfig) {
      return global.userconfig;
    }
    return this.userconfig;
  }

  /**
   * Get a specific config value
   * @param {string} path - Dot notation path (e.g., 'initial.apiport')
   * @returns {*} Config value
   */
  getConfigValue(path) {
    const config = this.getUserConfig();
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
    return this.userconfig !== null;
  }
}

// Create singleton instance
const configManager = new ConfigManager();

// No polling needed - apiServer.js file watcher handles config changes
// and calls configManager.reloadConfig() directly when userconfig.js changes
// This works for both API changes and manual file edits

module.exports = configManager;
