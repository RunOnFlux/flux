const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');

// Mock userconfig module BEFORE any other requires
const mockUserConfig = {
  initial: {
    ipaddress: '127.0.0.1',
    zelid: '1TestZelID123',
    kadena: 'kadena:test?chainid=0',
    testnet: false,
    development: false,
    apiport: 16127,
    routerIP: '192.168.1.1',
    pgpPrivateKey: 'test-private-key',
    pgpPublicKey: 'test-public-key',
    blockedPorts: [8080, 9090],
    blockedRepositories: ['blocked/repo1', 'blocked/repo2'],
  },
};

describe('configManager tests', () => {
  let configManager;
  let originalGlobalUserConfig;

  beforeEach(() => {
    // Save original globalThis.userconfig
    originalGlobalUserConfig = globalThis.userconfig;

    // Clear the module cache to get a fresh instance for each test
    delete require.cache[require.resolve('../../ZelBack/src/services/utils/configManager')];
    delete require.cache[require.resolve('../../config/userconfig')];

    // Create a fresh copy of mockUserConfig for each test to avoid mutations
    const freshMockConfig = JSON.parse(JSON.stringify(mockUserConfig));

    // Mock the userconfig module in require.cache BEFORE configManager loads it
    const userconfigPath = require.resolve('../../config/userconfig');
    require.cache[userconfigPath] = {
      id: userconfigPath,
      filename: userconfigPath,
      loaded: true,
      exports: freshMockConfig,
    };
  });

  afterEach(() => {
    // Restore original globalThis.userconfig
    globalThis.userconfig = originalGlobalUserConfig;
    sinon.restore();
  });

  describe('ConfigManager instantiation', () => {
    it('should create a singleton instance', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');
      expect(configManager).to.be.an('object');
    });

    it('should be initialized with config', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');
      expect(configManager.isInitialized()).to.equal(true);
    });

    it('should load config from globalThis.userconfig', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');
      const config = configManager.getUserConfig();

      expect(config).to.be.an('object');
      expect(config.initial).to.be.an('object');
      expect(config.initial.zelid).to.equal('1TestZelID123');
    });
  });

  describe('getUserConfig()', () => {
    it('should return current userconfig object', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');
      const config = configManager.getUserConfig();

      expect(config).to.deep.equal(globalThis.userconfig);
    });

    it('should return fresh config after globalThis.userconfig update', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      // Update globalThis.userconfig
      globalThis.userconfig.initial.zelid = 'NewZelID456';

      const config = configManager.getUserConfig();
      expect(config.initial.zelid).to.equal('NewZelID456');
    });

    it('should return config with all expected properties', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');
      const config = configManager.getUserConfig();

      expect(config.initial).to.have.property('ipaddress');
      expect(config.initial).to.have.property('zelid');
      expect(config.initial).to.have.property('kadena');
      expect(config.initial).to.have.property('testnet');
      expect(config.initial).to.have.property('development');
      expect(config.initial).to.have.property('apiport');
      expect(config.initial).to.have.property('routerIP');
      expect(config.initial).to.have.property('pgpPrivateKey');
      expect(config.initial).to.have.property('pgpPublicKey');
      expect(config.initial).to.have.property('blockedPorts');
      expect(config.initial).to.have.property('blockedRepositories');
    });
  });

  describe('getConfigValue()', () => {
    it('should get nested config value using dot notation', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      expect(configManager.getConfigValue('initial.zelid')).to.equal('1TestZelID123');
      expect(configManager.getConfigValue('initial.apiport')).to.equal(16127);
      expect(configManager.getConfigValue('initial.testnet')).to.equal(false);
    });

    it('should return undefined for non-existent paths', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      expect(configManager.getConfigValue('nonexistent.path')).to.be.undefined;
      expect(configManager.getConfigValue('initial.nonexistent')).to.be.undefined;
    });

    it('should handle array values', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      const blockedPorts = configManager.getConfigValue('initial.blockedPorts');
      expect(blockedPorts).to.be.an('array');
      expect(blockedPorts).to.deep.equal([8080, 9090]);
    });

    it('should handle deep nested paths', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      // Test single level
      expect(configManager.getConfigValue('initial')).to.be.an('object');

      // Test two levels
      expect(configManager.getConfigValue('initial.blockedRepositories')).to.be.an('array');
    });
  });

  describe('reloadConfig()', () => {
    it('should emit configReloaded event when config reloads', (done) => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      configManager.on('configReloaded', (newConfig) => {
        expect(newConfig).to.be.an('object');
        expect(newConfig.initial.zelid).to.equal('ReloadedZelID');
        done();
      });

      // Update the require.cache mock before reloading
      const userconfigPath = require.resolve('../../config/userconfig');
      const reloadedConfig = JSON.parse(JSON.stringify(mockUserConfig));
      reloadedConfig.initial.zelid = 'ReloadedZelID';
      require.cache[userconfigPath].exports = reloadedConfig;

      configManager.loadConfig(true);
    });

    it('should update config when reloadConfig is called', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      const oldZelid = configManager.getConfigValue('initial.zelid');
      expect(oldZelid).to.equal('1TestZelID123');

      // Update the require.cache mock before reloading
      const userconfigPath = require.resolve('../../config/userconfig');
      const updatedConfig = JSON.parse(JSON.stringify(mockUserConfig));
      updatedConfig.initial.zelid = 'UpdatedZelID789';
      require.cache[userconfigPath].exports = updatedConfig;

      configManager.loadConfig(true);

      const newZelid = configManager.getConfigValue('initial.zelid');
      expect(newZelid).to.equal('UpdatedZelID789');
    });

    it('should update all config values on reload', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      // Update the require.cache mock with new values before reloading
      const userconfigPath = require.resolve('../../config/userconfig');
      const updatedConfig = JSON.parse(JSON.stringify(mockUserConfig));
      updatedConfig.initial.apiport = 16137;
      updatedConfig.initial.testnet = true;
      updatedConfig.initial.blockedPorts = [3000, 4000, 5000];
      require.cache[userconfigPath].exports = updatedConfig;

      configManager.loadConfig(true);

      expect(configManager.getConfigValue('initial.apiport')).to.equal(16137);
      expect(configManager.getConfigValue('initial.testnet')).to.equal(true);
      expect(configManager.getConfigValue('initial.blockedPorts')).to.deep.equal([3000, 4000, 5000]);
    });
  });

  describe('isInitialized()', () => {
    it('should return true when config is loaded', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');
      expect(configManager.isInitialized()).to.equal(true);
    });

    it('should return true even after reload', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      configManager.reloadConfig();
      expect(configManager.isInitialized()).to.equal(true);
    });
  });

  describe('Event emitter functionality', () => {
    it('should be an EventEmitter', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');
      expect(configManager.on).to.be.a('function');
      expect(configManager.emit).to.be.a('function');
      expect(configManager.removeListener).to.be.a('function');
    });

    it('should allow multiple listeners for configReloaded event', (done) => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      let listener1Called = false;
      let listener2Called = false;

      configManager.on('configReloaded', () => {
        listener1Called = true;
        checkDone();
      });

      configManager.on('configReloaded', () => {
        listener2Called = true;
        checkDone();
      });

      function checkDone() {
        if (listener1Called && listener2Called) {
          done();
        }
      }

      // Update the require.cache mock before reloading
      const userconfigPath = require.resolve('../../config/userconfig');
      const multiListenerConfig = JSON.parse(JSON.stringify(mockUserConfig));
      multiListenerConfig.initial.zelid = 'MultiListenerTest';
      require.cache[userconfigPath].exports = multiListenerConfig;

      configManager.loadConfig(true);
    });

    it('should allow removing event listeners', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      let callCount = 0;
      const listener = () => { callCount += 1; };

      configManager.on('configReloaded', listener);

      // First reload - listener should be called
      // Update the require.cache mock before first reload
      const userconfigPath = require.resolve('../../config/userconfig');
      const reload1Config = JSON.parse(JSON.stringify(mockUserConfig));
      reload1Config.initial.zelid = 'Reload1';
      require.cache[userconfigPath].exports = reload1Config;

      configManager.loadConfig(true);
      expect(callCount).to.equal(1);

      // Remove listener
      configManager.removeListener('configReloaded', listener);

      // Second reload - listener should not be called
      // Update the require.cache mock before second reload
      const reload2Config = JSON.parse(JSON.stringify(mockUserConfig));
      reload2Config.initial.zelid = 'Reload2';
      require.cache[userconfigPath].exports = reload2Config;

      configManager.loadConfig(true);
      expect(callCount).to.equal(1);
    });
  });

  describe('Integration with globalThis.userconfig', () => {
    it('should use globalThis.userconfig when available', () => {
      // Clear module cache for this specific test
      delete require.cache[require.resolve('../../ZelBack/src/services/utils/configManager')];

      const testConfig = {
        initial: {
          ipaddress: '10.0.0.1',
          zelid: 'GlobalConfigTest',
          kadena: '',
          testnet: true,
          development: true,
          apiport: 16147,
          routerIP: '',
          pgpPrivateKey: '',
          pgpPublicKey: '',
          blockedPorts: [],
          blockedRepositories: [],
        },
      };

      // Mock the userconfig in require.cache with testConfig
      const userconfigPath = require.resolve('../../config/userconfig');
      require.cache[userconfigPath] = {
        id: userconfigPath,
        filename: userconfigPath,
        loaded: true,
        exports: testConfig,
      };

      configManager = require('../../ZelBack/src/services/utils/configManager');

      const config = configManager.getUserConfig();
      expect(config).to.deep.equal(testConfig);
      expect(config.initial.zelid).to.equal('GlobalConfigTest');
    });

    it('should reflect changes to globalThis.userconfig immediately', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      // Change a simple value
      globalThis.userconfig.initial.development = true;
      expect(configManager.getUserConfig().initial.development).to.equal(true);

      // Change it back
      globalThis.userconfig.initial.development = false;
      expect(configManager.getUserConfig().initial.development).to.equal(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty config gracefully', () => {
      // Clear module cache for this specific test
      delete require.cache[require.resolve('../../ZelBack/src/services/utils/configManager')];

      const emptyConfig = { initial: {} };

      // Mock the userconfig in require.cache with empty config
      const userconfigPath = require.resolve('../../config/userconfig');
      require.cache[userconfigPath] = {
        id: userconfigPath,
        filename: userconfigPath,
        loaded: true,
        exports: emptyConfig,
      };

      configManager = require('../../ZelBack/src/services/utils/configManager');

      expect(configManager.getUserConfig()).to.deep.equal({ initial: {} });
    });

    it('should handle null values in config', () => {
      // Clear module cache for this specific test
      delete require.cache[require.resolve('../../ZelBack/src/services/utils/configManager')];

      // Create fresh config with null zelid
      const freshMockConfig = JSON.parse(JSON.stringify(mockUserConfig));
      freshMockConfig.initial.zelid = null;

      // Mock the userconfig in require.cache
      const userconfigPath = require.resolve('../../config/userconfig');
      require.cache[userconfigPath] = {
        id: userconfigPath,
        filename: userconfigPath,
        loaded: true,
        exports: freshMockConfig,
      };

      configManager = require('../../ZelBack/src/services/utils/configManager');

      expect(configManager.getConfigValue('initial.zelid')).to.be.null;
    });

    it('should handle undefined values in config', () => {
      // Clear module cache for this specific test
      delete require.cache[require.resolve('../../ZelBack/src/services/utils/configManager')];

      // Create fresh config with undefined kadena
      const freshMockConfig = JSON.parse(JSON.stringify(mockUserConfig));
      freshMockConfig.initial.kadena = undefined;

      // Mock the userconfig in require.cache
      const userconfigPath = require.resolve('../../config/userconfig');
      require.cache[userconfigPath] = {
        id: userconfigPath,
        filename: userconfigPath,
        loaded: true,
        exports: freshMockConfig,
      };

      configManager = require('../../ZelBack/src/services/utils/configManager');

      expect(configManager.getConfigValue('initial.kadena')).to.be.undefined;
    });

    it('should handle array modifications', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      const blockedPorts = configManager.getConfigValue('initial.blockedPorts');
      blockedPorts.push(6000);

      // Should reflect the change since it's the same reference
      expect(configManager.getConfigValue('initial.blockedPorts')).to.include(6000);
    });
  });
});
