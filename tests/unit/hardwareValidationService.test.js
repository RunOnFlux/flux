const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('hardwareValidationService tests', () => {
  let hardwareValidationService;
  let logStub;
  let configStub;
  let registryManagerStub;
  let hwRequirementsStub;
  let appUninstallerStub;
  let serviceHelperStub;
  let generalServiceStub;

  beforeEach(() => {
    // Log stub
    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    // Config stub - 4 CPU node (40 CPU units), 8GB RAM, 100GB storage
    configStub = {
      lockedSystemResources: {
        cpu: 10, // 1 CPU reserved
        ram: 2000, // 2GB reserved
        hdd: 10, // 10GB reserved
        extrahdd: 0,
      },
      fluxapps: {
        hddFileSystemMinimum: 5, // 5GB per app
        defaultSwap: 2, // 2GB swap per app
      },
    };

    // Registry manager stub
    registryManagerStub = {
      getInstalledApps: sinon.stub(),
      getApplicationGlobalSpecifications: sinon.stub(),
    };

    // Hardware requirements stub
    hwRequirementsStub = {
      getNodeSpecs: sinon.stub(),
      totalAppHWRequirements: sinon.stub(),
    };

    // General service stub
    generalServiceStub = {
      nodeTier: sinon.stub().resolves('stratus'),
    };

    // App uninstaller stub
    appUninstallerStub = {
      removeAppLocally: sinon.stub(),
    };

    // Service helper stub
    serviceHelperStub = {
      delay: sinon.stub().resolves(),
    };

    // Load module with stubs
    hardwareValidationService = proxyquire('../../ZelBack/src/services/appLifecycle/hardwareValidationService', {
      '../../lib/log': logStub,
      config: configStub,
      '../appDatabase/registryManager': registryManagerStub,
      '../appRequirements/hwRequirements': hwRequirementsStub,
      './appUninstaller': appUninstallerStub,
      '../serviceHelper': serviceHelperStub,
      '../generalService': generalServiceStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('performBootTimeHardwareValidation', () => {
    it('should return empty results if no apps are installed', async () => {
      registryManagerStub.getInstalledApps.resolves([]);

      const result = await hardwareValidationService.performBootTimeHardwareValidation();

      expect(result).to.deep.equal({
        appsChecked: 0,
        appsRemoved: [],
        appsFailed: [],
      });
      expect(logStub.info.calledWith('hardwareValidationService - No installed apps found')).to.equal(true);
    });

    it('should return empty results if getInstalledApps returns null', async () => {
      registryManagerStub.getInstalledApps.resolves(null);

      const result = await hardwareValidationService.performBootTimeHardwareValidation();

      expect(result).to.deep.equal({
        appsChecked: 0,
        appsRemoved: [],
        appsFailed: [],
      });
      expect(logStub.info.calledWith('hardwareValidationService - No installed apps found')).to.equal(true);
    });

    it('should not remove apps if all apps meet hardware requirements', async () => {
      const installedApps = [
        { name: 'app1', height: 1000 },
        { name: 'app2', height: 2000 },
      ];

      // 4 CPU node with 3 CPU available after system resources
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getInstalledApps.resolves(installedApps);
      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'testApp' });

      // Each app needs 1 CPU, 1GB RAM, 5GB HDD - both fit
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1, ram: 1024, hdd: 5 });
      appUninstallerStub.removeAppLocally.resolves();

      const result = await hardwareValidationService.performBootTimeHardwareValidation();

      expect(result.appsChecked).to.equal(2);
      expect(result.appsRemoved).to.have.length(0);
      expect(result.appsFailed).to.have.length(0);
      expect(logStub.info.calledWith('hardwareValidationService - All installed apps meet hardware requirements')).to.equal(true);
      expect(appUninstallerStub.removeAppLocally.called).to.equal(false);
    });

    it('should handle critical error gracefully', async () => {
      registryManagerStub.getInstalledApps.rejects(new Error('Database connection failed'));

      const result = await hardwareValidationService.performBootTimeHardwareValidation();

      expect(result).to.deep.equal({
        appsChecked: 0,
        appsRemoved: [],
        appsFailed: [],
      });
      expect(logStub.error.calledWith(sinon.match(/Critical error/))).to.equal(true);
    });
  });

  describe('validateAppsCumulatively', () => {
    it('should return empty array if all apps fit within capacity', async () => {
      const installedApps = [
        { name: 'app1', height: 1000 },
        { name: 'app2', height: 2000 },
      ];

      // 4 CPU node (40 units), 8GB RAM, 100GB storage
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'testApp' });
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1, ram: 1024, hdd: 5 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(0);
    });

    it('should remove app that individually exceeds CPU capacity', async () => {
      const installedApps = [
        { name: 'bigApp', height: 1000 },
      ];

      // 4 CPU node = 40 units, useable = 30 units (after 10 reserved)
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'bigApp' });
      // App needs 5 CPUs = 50 units > 30 available
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 5, ram: 1024, hdd: 5 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('bigApp');
      expect(result[0].reason).to.include('requires 5 CPU');
    });

    it('should remove app that individually exceeds RAM capacity', async () => {
      const installedApps = [
        { name: 'bigApp', height: 1000 },
      ];

      // 8GB RAM node, useable = 6192MB (after 2000 reserved)
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'bigApp' });
      // App needs 7GB RAM = 7168MB > 6192 available
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1, ram: 7168, hdd: 5 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('bigApp');
      expect(result[0].reason).to.include('requires 7168MB RAM');
    });

    it('should remove app that individually exceeds storage capacity', async () => {
      const installedApps = [
        { name: 'bigApp', height: 1000 },
      ];

      // 100GB storage, useable = 85GB (95% - 10GB reserved)
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'bigApp' });
      // App needs 80GB + 5GB filesystem + 2GB swap = 87GB > 85GB available
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1, ram: 1024, hdd: 80 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('bigApp');
      expect(result[0].reason).to.include('requires 87GB storage');
    });

    it('should remove newer apps when cumulative CPU exceeds capacity', async () => {
      const installedApps = [
        { name: 'app1', height: 1000 }, // Older - keep
        { name: 'app2', height: 2000 }, // Newer - remove
      ];

      // 4 CPU node = 40 units, useable = 30 units (after 10 reserved)
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'testApp' });
      // Each app needs 2 CPUs = 20 units, total = 40 units > 30 available
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 2, ram: 1024, hdd: 5 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('app2'); // Newer app removed
      expect(result[0].reason).to.include('Cumulative CPU limit exceeded');
    });

    it('should remove newer apps when cumulative RAM exceeds capacity', async () => {
      const installedApps = [
        { name: 'app1', height: 1000 }, // Older - keep
        { name: 'app2', height: 2000 }, // Newer - remove
      ];

      // 8GB RAM node, useable = 6192MB (after 2000 reserved)
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'testApp' });
      // Each app needs 4GB = 4096MB, total = 8192MB > 6192 available
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1, ram: 4096, hdd: 5 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('app2');
      expect(result[0].reason).to.include('Cumulative RAM limit exceeded');
    });

    it('should remove newer apps when cumulative storage exceeds capacity', async () => {
      const installedApps = [
        { name: 'app1', height: 1000 }, // Older - keep
        { name: 'app2', height: 2000 }, // Newer - remove
      ];

      // 100GB storage, useable = 85GB (95% - 10GB reserved)
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'testApp' });
      // Each app needs 30GB + 7GB overhead = 37GB, total = 74GB but first app 37GB leaves 48GB for second
      // Actually this should fit... let me recalculate
      // App1: 30 + 5 + 2 = 37GB, cumulative = 37GB (fits)
      // App2: 30 + 5 + 2 = 37GB, cumulative = 74GB (fits in 85GB)
      // Need bigger apps: 40GB each + 7GB overhead = 47GB each, total = 94GB > 85GB
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1, ram: 1024, hdd: 40 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('app2');
      expect(result[0].reason).to.include('Cumulative storage limit exceeded');
    });

    it('should sort apps by height and keep oldest apps', async () => {
      const installedApps = [
        { name: 'newestApp', height: 3000 }, // Should be removed
        { name: 'oldestApp', height: 1000 }, // Should be kept
        { name: 'middleApp', height: 2000 }, // Should be removed
      ];

      // 4 CPU node = 40 units, useable = 30 units (after 10 reserved)
      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'testApp' });
      // Each app needs 1.5 CPUs = 15 units
      // App1 (oldest): 15 units, cumulative = 15 (fits)
      // App2 (middle): 15 units, cumulative = 30 (fits)
      // App3 (newest): 15 units, cumulative = 45 (exceeds 30) - remove
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1.5, ram: 1024, hdd: 5 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('newestApp');
      expect(result[0].height).to.equal(3000);
    });

    it('should handle apps with missing height field (treat as 0)', async () => {
      const installedApps = [
        { name: 'app1' }, // No height - treated as 0
        { name: 'app2', height: 1000 },
      ];

      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.resolves({ name: 'testApp' });
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1, ram: 1024, hdd: 5 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(0);
      // Should process app1 first (height 0) then app2 (height 1000)
    });

    it('should skip app if spec is not found', async () => {
      const installedApps = [
        { name: 'app1', height: 1000 },
        { name: 'app2', height: 2000 },
      ];

      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 100,
      });

      registryManagerStub.getApplicationGlobalSpecifications.onFirstCall().resolves(null); // No spec for app1
      registryManagerStub.getApplicationGlobalSpecifications.onSecondCall().resolves({ name: 'app2' });
      hwRequirementsStub.totalAppHWRequirements.returns({ cpu: 1, ram: 1024, hdd: 5 });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(0);
      expect(logStub.warn.calledWith('hardwareValidationService - No spec found for app1, skipping')).to.equal(true);
    });

    it('should return empty array if storage is 0', async () => {
      const installedApps = [
        { name: 'app1', height: 1000 },
      ];

      hwRequirementsStub.getNodeSpecs.resolves({
        cpuCores: 4,
        ram: 8192,
        ssdStorage: 0, // No storage detected
      });

      const result = await hardwareValidationService.validateAppsCumulatively(installedApps);

      expect(result).to.have.length(0);
      expect(logStub.error.calledWith(sinon.match(/No storage detected/))).to.equal(true);
    });
  });

  describe('removeNonCompliantApps', () => {
    it('should return empty results if no apps to remove', async () => {
      const result = await hardwareValidationService.removeNonCompliantApps([]);

      expect(result).to.deep.equal({
        removed: [],
        failed: [],
      });
      expect(appUninstallerStub.removeAppLocally.called).to.equal(false);
    });

    it('should successfully remove a single app', async () => {
      const appsToRemove = [
        { name: 'app1', reason: 'CPU requirements not met', height: 1000 },
      ];

      appUninstallerStub.removeAppLocally.resolves();

      const result = await hardwareValidationService.removeNonCompliantApps(appsToRemove);

      expect(result.removed).to.have.length(1);
      expect(result.removed[0]).to.equal('app1');
      expect(result.failed).to.have.length(0);
      expect(logStub.warn.calledWith(sinon.match(/REMOVAL REASON: Hardware downgrade - app1/))).to.equal(true);
      expect(logStub.info.calledWith(sinon.match(/Successfully removed app1/))).to.equal(true);
      expect(appUninstallerStub.removeAppLocally.calledWith('app1', null, true, true, true)).to.equal(true);
    });

    it('should successfully remove multiple apps', async () => {
      const appsToRemove = [
        { name: 'app1', reason: 'CPU requirements not met', height: 1000 },
        { name: 'app2', reason: 'RAM requirements not met', height: 2000 },
        { name: 'app3', reason: 'Storage requirements not met', height: 3000 },
      ];

      appUninstallerStub.removeAppLocally.resolves();

      const result = await hardwareValidationService.removeNonCompliantApps(appsToRemove);

      expect(result.removed).to.have.length(3);
      expect(result.removed).to.include('app1');
      expect(result.removed).to.include('app2');
      expect(result.removed).to.include('app3');
      expect(result.failed).to.have.length(0);
      expect(appUninstallerStub.removeAppLocally.callCount).to.equal(3);
      expect(serviceHelperStub.delay.callCount).to.equal(3);
    });

    it('should handle removal failure and add to failed list', async () => {
      const appsToRemove = [
        { name: 'app1', reason: 'CPU requirements not met', height: 1000 },
      ];

      appUninstallerStub.removeAppLocally.rejects(new Error('Container not found'));

      const result = await hardwareValidationService.removeNonCompliantApps(appsToRemove);

      expect(result.removed).to.have.length(0);
      expect(result.failed).to.have.length(1);
      expect(result.failed[0].name).to.equal('app1');
      expect(result.failed[0].error).to.equal('Container not found');
      expect(logStub.error.calledWith(sinon.match(/Failed to remove app1/))).to.equal(true);
    });

    it('should handle mixed success and failure', async () => {
      const appsToRemove = [
        { name: 'app1', reason: 'CPU requirements not met', height: 1000 },
        { name: 'app2', reason: 'RAM requirements not met', height: 2000 },
        { name: 'app3', reason: 'Storage requirements not met', height: 3000 },
      ];

      appUninstallerStub.removeAppLocally.onFirstCall().resolves();
      appUninstallerStub.removeAppLocally.onSecondCall().rejects(new Error('Removal failed'));
      appUninstallerStub.removeAppLocally.onThirdCall().resolves();

      const result = await hardwareValidationService.removeNonCompliantApps(appsToRemove);

      expect(result.removed).to.have.length(2);
      expect(result.removed).to.include('app1');
      expect(result.removed).to.include('app3');
      expect(result.failed).to.have.length(1);
      expect(result.failed[0].name).to.equal('app2');
    });

    it('should delay 5 seconds between removals', async () => {
      const appsToRemove = [
        { name: 'app1', reason: 'CPU requirements not met', height: 1000 },
        { name: 'app2', reason: 'RAM requirements not met', height: 2000 },
      ];

      appUninstallerStub.removeAppLocally.resolves();

      await hardwareValidationService.removeNonCompliantApps(appsToRemove);

      expect(serviceHelperStub.delay.callCount).to.equal(2);
      expect(serviceHelperStub.delay.alwaysCalledWith(5000)).to.equal(true);
    });

    it('should call removeAppLocally with correct parameters', async () => {
      const appsToRemove = [
        { name: 'app1', reason: 'CPU requirements not met', height: 1000 },
      ];

      appUninstallerStub.removeAppLocally.resolves();

      await hardwareValidationService.removeNonCompliantApps(appsToRemove);

      expect(appUninstallerStub.removeAppLocally.calledOnce).to.equal(true);
      const call = appUninstallerStub.removeAppLocally.getCall(0);
      expect(call.args[0]).to.equal('app1'); // appName
      expect(call.args[1]).to.equal(null); // res
      expect(call.args[2]).to.equal(true); // force
      expect(call.args[3]).to.equal(true); // endResponse
      expect(call.args[4]).to.equal(true); // sendMessage
    });
  });
});
