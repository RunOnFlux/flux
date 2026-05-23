const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

chai.use(chaiAsPromised);
const { expect } = chai;

describe('appNetworkLinker tests', () => {
  let appNetworkLinker;
  let dbHelperStub;
  let dockerServiceStub;
  let logStub;

  const configStub = {
    database: {
      appslocal: { database: 'localapps' },
    },
  };

  const appConstantsStub = {
    localAppsInformation: 'localAppsInformation',
    APP_NAME_REGEX: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
  };

  beforeEach(() => {
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns('appsDB') }),
      findOneInDatabase: sinon.stub(),
      findInDatabase: sinon.stub(),
    };
    dockerServiceStub = {
      appDockerNetworkConnect: sinon.stub().resolves(),
      getAppContainerNames: sinon.stub().resolves([]),
    };
    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

    appNetworkLinker = proxyquire('../../ZelBack/src/services/appLifecycle/appNetworkLinker', {
      config: configStub,
      '../dbHelper': dbHelperStub,
      '../dockerService': dockerServiceStub,
      '../../lib/log': logStub,
      '../utils/appConstants': appConstantsStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('parseNetworkWith', () => {
    it('returns [] when description is not a string', () => {
      expect(appNetworkLinker.parseNetworkWith(undefined)).to.eql([]);
      expect(appNetworkLinker.parseNetworkWith(null)).to.eql([]);
      expect(appNetworkLinker.parseNetworkWith(123)).to.eql([]);
      expect(appNetworkLinker.parseNetworkWith('')).to.eql([]);
    });

    it('returns [] when no token is present', () => {
      expect(appNetworkLinker.parseNetworkWith('just a normal description')).to.eql([]);
    });

    it('parses an unquoted token embedded in free text', () => {
      expect(appNetworkLinker.parseNetworkWith('My great app. networkWith:[appA,appB]')).to.eql(['appA', 'appB']);
    });

    it('parses a quoted JSON-style token', () => {
      expect(appNetworkLinker.parseNetworkWith('text networkWith:["appA","appB"]')).to.eql(['appA', 'appB']);
    });

    it('tolerates spaces, the = separator and a case-insensitive key', () => {
      expect(appNetworkLinker.parseNetworkWith('NETWORKWITH = [ appA , appB ]')).to.eql(['appA', 'appB']);
    });

    it('drops invalid names and deduplicates', () => {
      expect(appNetworkLinker.parseNetworkWith('networkWith:[appA,appA,bad name,inv@lid,appB]')).to.eql(['appA', 'appB']);
    });

    it('returns [] for empty brackets', () => {
      expect(appNetworkLinker.parseNetworkWith('networkWith:[]')).to.eql([]);
    });

    it('returns [] when brackets are missing (malformed)', () => {
      expect(appNetworkLinker.parseNetworkWith('networkWith:appA,appB')).to.eql([]);
    });

    it('does not match networkWith embedded inside a larger word', () => {
      expect(appNetworkLinker.parseNetworkWith('mynetworkWith:[appA]')).to.eql([]);
    });

    it('accepts app names containing internal hyphens', () => {
      expect(appNetworkLinker.parseNetworkWith('networkWith:[my-app]')).to.eql(['my-app']);
    });
  });

  describe('getLinkedApps', () => {
    it('excludes a self-reference to the app itself', () => {
      const specs = { name: 'appA', description: 'networkWith:[appA,appB]' };
      expect(appNetworkLinker.getLinkedApps(specs)).to.eql(['appB']);
    });

    it('returns [] when the app has no name', () => {
      expect(appNetworkLinker.getLinkedApps({ description: 'networkWith:[appB]' })).to.eql([]);
    });

    it('returns [] for a falsy app spec', () => {
      expect(appNetworkLinker.getLinkedApps(null)).to.eql([]);
    });
  });

  describe('checkAppNetworkRequirements', () => {
    it('resolves true and touches no database when there are no linked apps', async () => {
      const result = await appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'plain text', owner: 'owner1' });
      expect(result).to.equal(true);
      sinon.assert.notCalled(dbHelperStub.findOneInDatabase);
    });

    it('throws when a linked app is not installed locally', async () => {
      dbHelperStub.findOneInDatabase.resolves(null);
      await expect(appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'networkWith:[appA]', owner: 'owner1' }))
        .to.be.rejectedWith(/is not installed on this node/);
    });

    it('throws when a linked app is owned by a different owner', async () => {
      dbHelperStub.findOneInDatabase.resolves({ name: 'appA', owner: 'owner2' });
      await expect(appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'networkWith:[appA]', owner: 'owner1' }))
        .to.be.rejectedWith(/owned by a different owner/);
    });

    it('resolves true when every linked app is installed with the same owner', async () => {
      dbHelperStub.findOneInDatabase.resolves({ name: 'appA', owner: 'owner1' });
      const result = await appNetworkLinker.checkAppNetworkRequirements({ name: 'appB', description: 'networkWith:[appA]', owner: 'owner1' });
      expect(result).to.equal(true);
    });
  });

  describe('connectComponentToLinkedApps', () => {
    it('does nothing when the app declares no network links', async () => {
      await appNetworkLinker.connectComponentToLinkedApps('fluxweb_appB', { name: 'appB', description: 'plain text' });
      sinon.assert.notCalled(dockerServiceStub.appDockerNetworkConnect);
    });

    it('connects the container to every linked app network', async () => {
      await appNetworkLinker.connectComponentToLinkedApps('fluxweb_appB', { name: 'appB', description: 'networkWith:[appA,appC]' });
      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxweb_appB', 'fluxDockerNetwork_appA');
      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxweb_appB', 'fluxDockerNetwork_appC');
    });

    it('propagates a connection failure so the install is rolled back', async () => {
      dockerServiceStub.appDockerNetworkConnect.rejects(new Error('docker boom'));
      await expect(appNetworkLinker.connectComponentToLinkedApps('c', { name: 'appB', description: 'networkWith:[appA]' }))
        .to.be.rejectedWith('docker boom');
    });
  });

  describe('reconnectLinkedApps', () => {
    it('reconnects only the apps that are networked with the given app', async () => {
      dbHelperStub.findInDatabase.resolves([
        { name: 'appB', description: 'networkWith:[appA]' },
        { name: 'appC', description: 'no links here' },
        { name: 'appA', description: 'networkWith:[appA]' },
      ]);
      dockerServiceStub.getAppContainerNames.withArgs('appB').resolves(['fluxweb_appB', 'fluxapi_appB']);
      dockerServiceStub.getAppContainerNames.withArgs('appC').resolves(['fluxweb_appC']);

      await appNetworkLinker.reconnectLinkedApps('appA');

      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxweb_appB', 'fluxDockerNetwork_appA');
      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxapi_appB', 'fluxDockerNetwork_appA');
      expect(dockerServiceStub.appDockerNetworkConnect.calledWith('fluxweb_appC')).to.equal(false);
    });

    it('does not throw when the database read fails', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('db down'));
      await expect(appNetworkLinker.reconnectLinkedApps('appA')).to.not.be.rejected;
    });
  });

  describe('reconcileAllAppNetworkLinks', () => {
    it('connects every linked app to each of its linked app networks', async () => {
      dbHelperStub.findInDatabase.resolves([
        { name: 'appB', description: 'networkWith:[appA]' },
        { name: 'appC', description: 'plain' },
      ]);
      dockerServiceStub.getAppContainerNames.withArgs('appB').resolves(['fluxweb_appB']);

      await appNetworkLinker.reconcileAllAppNetworkLinks();

      sinon.assert.calledWith(dockerServiceStub.appDockerNetworkConnect, 'fluxweb_appB', 'fluxDockerNetwork_appA');
    });

    it('does not throw when the database read fails', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('db down'));
      await expect(appNetworkLinker.reconcileAllAppNetworkLinks()).to.not.be.rejected;
    });
  });
});
