// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
// eslint-disable-next-line no-unused-vars
const path = require('path');

describe('appConstants tests', () => {
  let originalFluxOSPath;
  let originalFluxAppsFolder;
  let originalHome;
  let appConstants;

  beforeEach(() => {
    // Save original environment variables
    originalFluxOSPath = process.env.FLUXOS_PATH;
    originalFluxAppsFolder = process.env.FLUX_APPS_FOLDER;
    originalHome = process.env.HOME;

    // Clear module cache to reload with new env vars (but keep config loaded)
    delete require.cache[require.resolve('../../ZelBack/src/services/utils/appConstants')];
  });

  afterEach(() => {
    // Restore original environment variables
    if (originalFluxOSPath !== undefined) {
      process.env.FLUXOS_PATH = originalFluxOSPath;
    } else {
      delete process.env.FLUXOS_PATH;
    }
    if (originalFluxAppsFolder !== undefined) {
      process.env.FLUX_APPS_FOLDER = originalFluxAppsFolder;
    } else {
      delete process.env.FLUX_APPS_FOLDER;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clear module cache
    delete require.cache[require.resolve('../../ZelBack/src/services/utils/appConstants')];
  });

  describe('path configuration tests', () => {
    it('should use FLUXOS_PATH when set', () => {
      process.env.FLUXOS_PATH = '/custom/flux/path';
      process.env.HOME = '/home/user';

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.fluxDirPath).to.equal('/custom/flux/path');
    });

    it('should default to HOME/zelflux when FLUXOS_PATH not set', () => {
      delete process.env.FLUXOS_PATH;
      process.env.HOME = '/home/testuser';

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.fluxDirPath).to.equal('/home/testuser/zelflux');
    });

    it('should use FLUX_APPS_FOLDER when set', () => {
      process.env.FLUXOS_PATH = '/flux';
      process.env.FLUX_APPS_FOLDER = '/custom/apps/folder';

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.appsFolderPath).to.equal('/custom/apps/folder');
    });

    it('should default to fluxDirPath/ZelApps when FLUX_APPS_FOLDER not set', () => {
      process.env.FLUXOS_PATH = '/flux';
      delete process.env.FLUX_APPS_FOLDER;

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.appsFolderPath).to.equal('/flux/ZelApps');
    });

    it('should set appsFolder with trailing slash', () => {
      process.env.FLUXOS_PATH = '/flux';
      delete process.env.FLUX_APPS_FOLDER;

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.appsFolder).to.equal('/flux/ZelApps/');
      expect(appConstants.appsFolder).to.match(/\/$/);
    });

    it('should construct proper path hierarchy', () => {
      process.env.FLUXOS_PATH = '/opt/flux';
      delete process.env.FLUX_APPS_FOLDER;

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.fluxDirPath).to.equal('/opt/flux');
      expect(appConstants.appsFolderPath).to.equal('/opt/flux/ZelApps');
      expect(appConstants.appsFolder).to.equal('/opt/flux/ZelApps/');
    });
  });

  describe('database collections tests', () => {
    beforeEach(() => {
      process.env.HOME = '/home/user';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');
    });

    it('should expose daemon database collections', () => {
      expect(appConstants.scannedHeightCollection).to.exist;
      expect(appConstants.appsHashesCollection).to.exist;
      expect(typeof appConstants.scannedHeightCollection).to.equal('string');
      expect(typeof appConstants.appsHashesCollection).to.equal('string');
    });

    it('should expose local apps collections', () => {
      expect(appConstants.localAppsInformation).to.exist;
      expect(typeof appConstants.localAppsInformation).to.equal('string');
    });

    it('should expose global apps collections', () => {
      expect(appConstants.globalAppsMessages).to.exist;
      expect(appConstants.globalAppsInformation).to.exist;
      expect(appConstants.globalAppsTempMessages).to.exist;
      expect(appConstants.globalAppsLocations).to.exist;
      expect(appConstants.globalAppsInstallingLocations).to.exist;
      expect(appConstants.globalAppsInstallingErrorsLocations).to.exist;

      expect(typeof appConstants.globalAppsMessages).to.equal('string');
      expect(typeof appConstants.globalAppsInformation).to.equal('string');
      expect(typeof appConstants.globalAppsTempMessages).to.equal('string');
      expect(typeof appConstants.globalAppsLocations).to.equal('string');
      expect(typeof appConstants.globalAppsInstallingLocations).to.equal('string');
      expect(typeof appConstants.globalAppsInstallingErrorsLocations).to.equal('string');
    });
  });

  describe('supported architectures tests', () => {
    beforeEach(() => {
      process.env.HOME = '/home/user';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');
    });

    it('should include amd64 architecture', () => {
      expect(appConstants.supportedArchitectures).to.include('amd64');
    });

    it('should include arm64 architecture', () => {
      expect(appConstants.supportedArchitectures).to.include('arm64');
    });

    it('should only include supported architectures', () => {
      expect(appConstants.supportedArchitectures).to.have.lengthOf(2);
      expect(appConstants.supportedArchitectures).to.deep.equal(['amd64', 'arm64']);
    });

    it('should be an array', () => {
      expect(appConstants.supportedArchitectures).to.be.an('array');
    });
  });

  describe('isArcane flag tests', () => {
    it('should be true when FLUXOS_PATH is set', () => {
      process.env.FLUXOS_PATH = '/arcane/path';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.isArcane).to.be.true;
    });

    it('should be false when FLUXOS_PATH is not set', () => {
      delete process.env.FLUXOS_PATH;
      process.env.HOME = '/home/user';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.isArcane).to.be.false;
    });

    it('should be false when FLUXOS_PATH is empty string', () => {
      process.env.FLUXOS_PATH = '';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.isArcane).to.be.false;
    });

    it('should be true for any non-empty FLUXOS_PATH', () => {
      process.env.FLUXOS_PATH = 'x';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.isArcane).to.be.true;
    });
  });

  describe('appsThatMightBeUsingOldGatewayIpAssignment tests', () => {
    beforeEach(() => {
      process.env.HOME = '/home/user';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');
    });

    it('should be an array', () => {
      expect(appConstants.appsThatMightBeUsingOldGatewayIpAssignment).to.be.an('array');
    });

    it('should include known legacy apps', () => {
      const legacyApps = appConstants.appsThatMightBeUsingOldGatewayIpAssignment;
      expect(legacyApps).to.include('HNSDoH');
      expect(legacyApps).to.include('dane');
      expect(legacyApps).to.include('fdm');
      expect(legacyApps).to.include('Jetpack2');
    });

    it('should not be empty', () => {
      expect(appConstants.appsThatMightBeUsingOldGatewayIpAssignment.length).to.be.greaterThan(0);
    });

    it('should contain string values', () => {
      appConstants.appsThatMightBeUsingOldGatewayIpAssignment.forEach((appName) => {
        expect(appName).to.be.a('string');
        expect(appName.length).to.be.greaterThan(0);
      });
    });
  });

  describe('defaultNodeSpecs tests', () => {
    beforeEach(() => {
      process.env.HOME = '/home/user';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');
    });

    it('should be an object', () => {
      expect(appConstants.defaultNodeSpecs).to.be.an('object');
    });

    it('should have cpuCores set to 0', () => {
      expect(appConstants.defaultNodeSpecs.cpuCores).to.equal(0);
    });

    it('should have ram set to 0', () => {
      expect(appConstants.defaultNodeSpecs.ram).to.equal(0);
    });

    it('should have ssdStorage set to 0', () => {
      expect(appConstants.defaultNodeSpecs.ssdStorage).to.equal(0);
    });

    it('should have exactly three properties', () => {
      const keys = Object.keys(appConstants.defaultNodeSpecs);
      expect(keys).to.have.lengthOf(3);
      expect(keys).to.include.members(['cpuCores', 'ram', 'ssdStorage']);
    });
  });

  describe('appsMonitoredTemplate tests', () => {
    beforeEach(() => {
      process.env.HOME = '/home/user';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');
    });

    it('should be an object', () => {
      expect(appConstants.appsMonitoredTemplate).to.be.an('object');
    });

    it('should be an empty template object', () => {
      expect(Object.keys(appConstants.appsMonitoredTemplate)).to.have.lengthOf(0);
    });
  });

  describe('module exports tests', () => {
    beforeEach(() => {
      process.env.HOME = '/home/user';
      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');
    });

    it('should export all path constants', () => {
      expect(appConstants).to.have.property('fluxDirPath');
      expect(appConstants).to.have.property('appsFolderPath');
      expect(appConstants).to.have.property('appsFolder');
    });

    it('should export all daemon database collections', () => {
      expect(appConstants).to.have.property('scannedHeightCollection');
      expect(appConstants).to.have.property('appsHashesCollection');
    });

    it('should export all local apps collections', () => {
      expect(appConstants).to.have.property('localAppsInformation');
    });

    it('should export all global apps collections', () => {
      expect(appConstants).to.have.property('globalAppsMessages');
      expect(appConstants).to.have.property('globalAppsInformation');
      expect(appConstants).to.have.property('globalAppsTempMessages');
      expect(appConstants).to.have.property('globalAppsLocations');
      expect(appConstants).to.have.property('globalAppsInstallingLocations');
      expect(appConstants).to.have.property('globalAppsInstallingErrorsLocations');
    });

    it('should export configuration constants', () => {
      expect(appConstants).to.have.property('supportedArchitectures');
      expect(appConstants).to.have.property('isArcane');
      expect(appConstants).to.have.property('appsThatMightBeUsingOldGatewayIpAssignment');
      expect(appConstants).to.have.property('defaultNodeSpecs');
      expect(appConstants).to.have.property('appsMonitoredTemplate');
    });
  });

  describe('integration scenarios', () => {
    it('should work with complex path configurations', () => {
      process.env.FLUXOS_PATH = '/mnt/data/flux/production';
      process.env.FLUX_APPS_FOLDER = '/var/apps/flux';

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.fluxDirPath).to.equal('/mnt/data/flux/production');
      expect(appConstants.appsFolderPath).to.equal('/var/apps/flux');
      expect(appConstants.appsFolder).to.equal('/var/apps/flux/');
      expect(appConstants.isArcane).to.be.true;
    });

    it('should work in standard FluxOS environment', () => {
      delete process.env.FLUXOS_PATH;
      delete process.env.FLUX_APPS_FOLDER;
      process.env.HOME = '/home/flux';

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.fluxDirPath).to.equal('/home/flux/zelflux');
      expect(appConstants.appsFolderPath).to.equal('/home/flux/zelflux/ZelApps');
      expect(appConstants.appsFolder).to.equal('/home/flux/zelflux/ZelApps/');
      expect(appConstants.isArcane).to.be.false;
    });

    it('should work in Arcane OS environment', () => {
      process.env.FLUXOS_PATH = '/opt/arcane';
      delete process.env.FLUX_APPS_FOLDER;

      // eslint-disable-next-line global-require
      appConstants = require('../../ZelBack/src/services/utils/appConstants');

      expect(appConstants.fluxDirPath).to.equal('/opt/arcane');
      expect(appConstants.appsFolderPath).to.equal('/opt/arcane/ZelApps');
      expect(appConstants.appsFolder).to.equal('/opt/arcane/ZelApps/');
      expect(appConstants.isArcane).to.be.true;
    });
  });
});
