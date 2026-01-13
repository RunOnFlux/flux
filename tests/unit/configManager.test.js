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

      // Simulate config change
      globalThis.userconfig.initial.zelid = 'ReloadedZelID';
      configManager.reloadConfig();
    });

    it('should update config when reloadConfig is called', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      const oldZelid = configManager.getConfigValue('initial.zelid');
      expect(oldZelid).to.equal('1TestZelID123');

      // Update globalThis.userconfig
      globalThis.userconfig.initial.zelid = 'UpdatedZelID789';
      configManager.reloadConfig();

      const newZelid = configManager.getConfigValue('initial.zelid');
      expect(newZelid).to.equal('UpdatedZelID789');
    });

    it('should update all config values on reload', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      // Update multiple values
      globalThis.userconfig.initial.apiport = 16137;
      globalThis.userconfig.initial.testnet = true;
      globalThis.userconfig.initial.blockedPorts = [3000, 4000, 5000];

      configManager.reloadConfig();

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

      globalThis.userconfig.initial.zelid = 'MultiListenerTest';
      configManager.reloadConfig();
    });

    it('should allow removing event listeners', () => {
      configManager = require('../../ZelBack/src/services/utils/configManager');

      let callCount = 0;
      const listener = () => { callCount += 1; };

      configManager.on('configReloaded', listener);

      // First reload - listener should be called
      configManager.reloadConfig();
      expect(callCount).to.equal(1);

      // Remove listener
      configManager.removeListener('configReloaded', listener);

      // Second reload - listener should not be called
      configManager.reloadConfig();
      expect(callCount).to.equal(1);
    });
  });

  describe('Integration with globalThis.userconfig', () => {
    it('should use globalThis.userconfig when available', () => {
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

      globalThis.userconfig = testConfig;
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
      globalThis.userconfig = { initial: {} };
      configManager = require('../../ZelBack/src/services/utils/configManager');

      expect(configManager.getUserConfig()).to.deep.equal({ initial: {} });
    });

    it('should handle null values in config', () => {
      globalThis.userconfig.initial.zelid = null;
      configManager = require('../../ZelBack/src/services/utils/configManager');

      expect(configManager.getConfigValue('initial.zelid')).to.be.null;
    });

    it('should handle undefined values in config', () => {
      globalThis.userconfig.initial.kadena = undefined;
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
