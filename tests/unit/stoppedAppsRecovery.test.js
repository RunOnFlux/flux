const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('stoppedAppsRecovery tests', () => {
  let stoppedAppsRecovery;
  let logStub;
  let dbHelperStub;
  let dockerServiceStub;
  let serviceHelperStub;
  let fluxNetworkHelperStub;
  let registryManagerStub;
  let advancedWorkflowsStub;
  let appUninstallerStub;

  beforeEach(() => {
    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    dbHelperStub = {
      databaseConnection: sinon.stub(),
      findInDatabase: sinon.stub(),
    };

    dockerServiceStub = {
      dockerListContainers: sinon.stub(),
    };

    serviceHelperStub = {
      delay: sinon.stub().resolves(),
    };

    fluxNetworkHelperStub = {
      getMyFluxIPandPort: sinon.stub(),
    };

    registryManagerStub = {
      getApplicationGlobalSpecifications: sinon.stub(),
    };

    advancedWorkflowsStub = {
      appDockerStart: sinon.stub().resolves(),
    };

    appUninstallerStub = {
      removeAppLocally: sinon.stub().resolves(),
    };

    const mockDb = { db: sinon.stub().returns('mockDatabase') };
    dbHelperStub.databaseConnection.returns(mockDb);

    stoppedAppsRecovery = proxyquire('../../ZelBack/src/services/appLifecycle/stoppedAppsRecovery', {
      '../../lib/log': logStub,
      '../dbHelper': dbHelperStub,
      '../dockerService': dockerServiceStub,
      '../serviceHelper': serviceHelperStub,
      '../fluxNetworkHelper': fluxNetworkHelperStub,
      '../appDatabase/registryManager': registryManagerStub,
      './advancedWorkflows': advancedWorkflowsStub,
      './appUninstaller': appUninstallerStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('appHasValidLocationOnNode', () => {
    it('should return true when expireAt is in the future', async () => {
      const expireAt = new Date(Date.now() + (60 * 1000)); // 1 minute from now
      dbHelperStub.findInDatabase.resolves([{ expireAt }]);

      const result = await stoppedAppsRecovery.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(true);
    });

    it('should return false when no location records exist', async () => {
      dbHelperStub.findInDatabase.resolves([]);

      const result = await stoppedAppsRecovery.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(false);
    });

    it('should return false when records is null', async () => {
      dbHelperStub.findInDatabase.resolves(null);

      const result = await stoppedAppsRecovery.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(false);
    });

    it('should return false when expireAt is in the past', async () => {
      const expireAt = new Date(Date.now() - (60 * 1000)); // 1 minute ago
      dbHelperStub.findInDatabase.resolves([{ expireAt }]);

      const result = await stoppedAppsRecovery.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(false);
    });

    it('should return true if at least one record is still valid among mixed records', async () => {
      const expiredRecord = new Date(Date.now() - (60 * 1000));
      const validRecord = new Date(Date.now() + (300 * 1000));
      dbHelperStub.findInDatabase.resolves([
        { expireAt: expiredRecord },
        { expireAt: validRecord },
      ]);

      const result = await stoppedAppsRecovery.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(true);
    });

    it('should return true on database error (fail-safe)', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('DB connection lost'));

      const result = await stoppedAppsRecovery.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(true);
    });

    it('should query with correct app name and IP', async () => {
      dbHelperStub.findInDatabase.resolves([]);

      await stoppedAppsRecovery.appHasValidLocationOnNode('testApp', '192.168.1.1:16127');

      const query = dbHelperStub.findInDatabase.firstCall.args[2];
      expect(query).to.deep.equal({ name: 'testApp', ip: '192.168.1.1:16127' });
    });

    it('should project only the expireAt field', async () => {
      dbHelperStub.findInDatabase.resolves([]);

      await stoppedAppsRecovery.appHasValidLocationOnNode('testApp', '10.0.0.1:16127');

      const projection = dbHelperStub.findInDatabase.firstCall.args[3];
      expect(projection).to.deep.equal({ _id: 0, expireAt: 1 });
    });

    it('should return false when expireAt field is missing from record', async () => {
      dbHelperStub.findInDatabase.resolves([{ broadcastedAt: new Date() }]);

      const result = await stoppedAppsRecovery.appHasValidLocationOnNode('myApp', '10.0.0.1:16127');

      expect(result).to.equal(false);
    });
  });

  describe('startStoppedAppsOnBoot - location check and removal', () => {
    const stoppedFluxContainers = [
      { Names: ['/fluxAppA'], State: 'exited' },
      { Names: ['/fluxAppB'], State: 'exited' },
      { Names: ['/fluxAppC'], State: 'exited' },
    ];

    const installedApps = [
      { name: 'AppA' },
      { name: 'AppB' },
      { name: 'AppC' },
    ];

    beforeEach(() => {
      // Default: installed apps in local DB
      dbHelperStub.findInDatabase.onFirstCall().resolves(installedApps);

      // Default: stopped containers
      dockerServiceStub.dockerListContainers.resolves(stoppedFluxContainers);

      // Default: no g: syncthing mode
      registryManagerStub.getApplicationGlobalSpecifications.resolves({ version: 3, containerData: '' });

      // Default: node IP available
      fluxNetworkHelperStub.getMyFluxIPandPort.resolves('10.0.0.1:16127');
    });

    it('should start app when location record has not expired', async () => {
      // Only one stopped container
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      // Valid location record (expireAt in the future)
      const futureExpiry = new Date(Date.now() + (300 * 1000));
      dbHelperStub.findInDatabase.onSecondCall().resolves([{ expireAt: futureExpiry }]);

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsStarted).to.deep.equal(['AppA']);
      expect(results.appsRemoved).to.deep.equal([]);
      expect(advancedWorkflowsStub.appDockerStart.calledWith('AppA')).to.equal(true);
    });

    it('should remove app when location record has expired', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      // Expired location record (expireAt in the past)
      const pastExpiry = new Date(Date.now() - (60 * 1000));
      dbHelperStub.findInDatabase.onSecondCall().resolves([{ expireAt: pastExpiry }]);

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsRemoved).to.deep.equal(['AppA']);
      expect(results.appsStarted).to.deep.equal([]);
      expect(appUninstallerStub.removeAppLocally.calledWith('AppA', null, true, true, false)).to.equal(true);
      expect(advancedWorkflowsStub.appDockerStart.called).to.equal(false);
    });

    it('should remove app when location record is missing', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      // No location records
      dbHelperStub.findInDatabase.onSecondCall().resolves([]);

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsRemoved).to.deep.equal(['AppA']);
      expect(results.appsStarted).to.deep.equal([]);
      expect(appUninstallerStub.removeAppLocally.called).to.equal(true);
    });

    it('should skip location check and start app when IP is not available', async () => {
      fluxNetworkHelperStub.getMyFluxIPandPort.resolves(null);

      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsStarted).to.deep.equal(['AppA']);
      expect(results.appsRemoved).to.deep.equal([]);
    });

    it('should handle mixed apps: start valid, remove expired', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
        { Names: ['/fluxAppB'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([
        { name: 'AppA' },
        { name: 'AppB' },
      ]);

      // AppA has valid location (expireAt in the future)
      const futureExpiry = new Date(Date.now() + (300 * 1000));
      dbHelperStub.findInDatabase.onSecondCall().resolves([{ expireAt: futureExpiry }]);

      // AppB has expired location (expireAt in the past)
      const pastExpiry = new Date(Date.now() - (60 * 1000));
      dbHelperStub.findInDatabase.onThirdCall().resolves([{ expireAt: pastExpiry }]);

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsStarted).to.deep.equal(['AppA']);
      expect(results.appsRemoved).to.deep.equal(['AppB']);
    });

    it('should record failure when removeAppLocally throws', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      // Expired location
      dbHelperStub.findInDatabase.onSecondCall().resolves([]);

      appUninstallerStub.removeAppLocally.rejects(new Error('Remove failed'));

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsRemoved).to.deep.equal([]);
      expect(results.appsFailed).to.have.lengthOf(1);
      expect(results.appsFailed[0].app).to.equal('AppA');
      expect(results.appsFailed[0].error).to.equal('Remove failed');
    });

    it('should still start app when location DB check errors (fail-safe)', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxAppA'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AppA' }]);

      // Location check throws error - appHasValidLocationOnNode returns true (fail-safe)
      dbHelperStub.findInDatabase.onSecondCall().rejects(new Error('DB error'));

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsStarted).to.deep.equal(['AppA']);
      expect(results.appsRemoved).to.deep.equal([]);
    });

    it('should check location after g: syncthing check', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxSyncApp'], State: 'exited' },
        { Names: ['/fluxNormalApp'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([
        { name: 'SyncApp' },
        { name: 'NormalApp' },
      ]);

      // SyncApp uses g: syncthing mode
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('SyncApp').resolves({
        version: 3,
        containerData: 'g:/data',
      });
      // NormalApp does not
      registryManagerStub.getApplicationGlobalSpecifications.withArgs('NormalApp').resolves({
        version: 3,
        containerData: '',
      });

      // NormalApp has expired location
      dbHelperStub.findInDatabase.onSecondCall().resolves([]);

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      // SyncApp skipped by g: mode check (before location check)
      expect(results.appsSkippedGMode).to.deep.equal(['SyncApp']);
      // NormalApp removed because location expired
      expect(results.appsRemoved).to.deep.equal(['NormalApp']);
      expect(results.appsStarted).to.deep.equal([]);
    });

    it('should partially start mixed compose: non-g components only, g: component left for masterSlaveApps', async () => {
      // Mixed compose app: web (no g:) + db (g:) — both stopped at boot
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxweb_MixedApp'], State: 'exited' },
        { Names: ['/fluxdb_MixedApp'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'MixedApp' }]);

      registryManagerStub.getApplicationGlobalSpecifications.withArgs('MixedApp').resolves({
        version: 8,
        name: 'MixedApp',
        compose: [
          { name: 'web', containerData: '' },
          { name: 'db', containerData: 'g:/data' },
        ],
      });

      // Valid location
      const futureExpiry = new Date(Date.now() + (300 * 1000));
      dbHelperStub.findInDatabase.onSecondCall().resolves([{ expireAt: futureExpiry }]);

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsPartiallyStarted).to.deep.equal(['MixedApp']);
      expect(results.appsStarted).to.deep.equal([]);
      expect(results.appsSkippedGMode).to.deep.equal([]);
      // Non-g component started
      expect(advancedWorkflowsStub.appDockerStart.calledWith('web_MixedApp')).to.equal(true);
      // g: component NOT started here (left for masterSlaveApps)
      expect(advancedWorkflowsStub.appDockerStart.calledWith('db_MixedApp')).to.equal(false);
    });

    it('should skip a compose app where every component is g:', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxa_AllGApp'], State: 'exited' },
        { Names: ['/fluxb_AllGApp'], State: 'exited' },
      ]);
      dbHelperStub.findInDatabase.onFirstCall().resolves([{ name: 'AllGApp' }]);

      registryManagerStub.getApplicationGlobalSpecifications.withArgs('AllGApp').resolves({
        version: 8,
        name: 'AllGApp',
        compose: [
          { name: 'a', containerData: 'g:/x' },
          { name: 'b', containerData: 'g:/y' },
        ],
      });

      const results = await stoppedAppsRecovery.startStoppedAppsOnBoot();

      expect(results.appsSkippedGMode).to.deep.equal(['AllGApp']);
      expect(results.appsStarted).to.deep.equal([]);
      expect(results.appsPartiallyStarted).to.deep.equal([]);
      expect(advancedWorkflowsStub.appDockerStart.called).to.equal(false);
    });
  });

  describe('getNonGComponentIdentifiers', () => {
    it('should return empty array when appSpec is null', () => {
      expect(stoppedAppsRecovery.getNonGComponentIdentifiers(null, 'AppA')).to.deep.equal([]);
    });

    it('should return [appName] for a v<=3 app with no g:', () => {
      const spec = { version: 3, containerData: '' };
      expect(stoppedAppsRecovery.getNonGComponentIdentifiers(spec, 'AppA')).to.deep.equal(['AppA']);
    });

    it('should return [] for a v<=3 app with g:', () => {
      const spec = { version: 3, containerData: 'g:/data' };
      expect(stoppedAppsRecovery.getNonGComponentIdentifiers(spec, 'AppA')).to.deep.equal([]);
    });

    it('should return all component identifiers for a compose app with no g:', () => {
      const spec = {
        version: 8,
        name: 'AppA',
        compose: [
          { name: 'web', containerData: '' },
          { name: 'cache', containerData: 'r:/data' },
        ],
      };
      expect(stoppedAppsRecovery.getNonGComponentIdentifiers(spec, 'AppA'))
        .to.deep.equal(['web_AppA', 'cache_AppA']);
    });

    it('should return [] for a compose app where every component is g:', () => {
      const spec = {
        version: 8,
        name: 'AppA',
        compose: [
          { name: 'a', containerData: 'g:/x' },
          { name: 'b', containerData: 'g:/y' },
        ],
      };
      expect(stoppedAppsRecovery.getNonGComponentIdentifiers(spec, 'AppA')).to.deep.equal([]);
    });

    it('should return only the non-g identifiers for a mixed compose app', () => {
      const spec = {
        version: 8,
        name: 'AppA',
        compose: [
          { name: 'web', containerData: '' },
          { name: 'db', containerData: 'g:/data' },
          { name: 'worker', containerData: 'r:/q' },
        ],
      };
      expect(stoppedAppsRecovery.getNonGComponentIdentifiers(spec, 'AppA'))
        .to.deep.equal(['web_AppA', 'worker_AppA']);
    });

    it('should fall back to the supplied appName when appSpec.name is missing', () => {
      const spec = {
        version: 8,
        compose: [{ name: 'web', containerData: '' }],
      };
      expect(stoppedAppsRecovery.getNonGComponentIdentifiers(spec, 'AppA'))
        .to.deep.equal(['web_AppA']);
    });
  });
});
