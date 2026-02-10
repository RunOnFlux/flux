// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();

// Create all stubs upfront
const dockerServiceStub = {
  dockerListContainers: sinon.stub(),
  dockerListImages: sinon.stub(),
  dockerContainerInspect: sinon.stub(),
  getDockerContainer: sinon.stub(),
  getAppIdentifier: sinon.stub(),
};

const appQueryServiceStub = {
  installedApps: sinon.stub(),
  decryptEnterpriseApps: sinon.stub(),
};

const advancedWorkflowsStub = {
  softRedeploy: sinon.stub(),
};

const registryCredentialHelperStub = {
  getCredentials: sinon.stub(),
};

const serviceHelperStub = {
  delay: sinon.stub().resolves(),
};

const globalStateStub = {
  removalInProgress: false,
  installationInProgress: false,
  softRedeployInProgress: false,
  hardRedeployInProgress: false,
};

const logStub = {
  info: sinon.stub(),
  warn: sinon.stub(),
  error: sinon.stub(),
  debug: sinon.stub(),
};

// Mock ImageVerifier class
let mockVerifierParseError = false;
let mockVerifierError = false;
let mockVerifierErrorDetail = '';
let mockVerifierErrorMeta = null;
let mockDigestToReturn = null;

class MockImageVerifier {
  constructor(repotag, options) {
    this.repotag = repotag;
    this.options = options;
    this.parseError = mockVerifierParseError;
    this.error = mockVerifierError;
    this.errorDetail = mockVerifierErrorDetail;
    this.errorMeta = mockVerifierErrorMeta;
  }

  async fetchManifestDigestOnly() {
    if (this.parseError || this.error) return null;
    return mockDigestToReturn;
  }
}

// Load module with stubs using noCallThru
const imageUpdateService = proxyquire('../../ZelBack/src/services/imageUpdateService', {
  '../lib/log': logStub,
  './dockerService': dockerServiceStub,
  './appQuery/appQueryService': appQueryServiceStub,
  './appLifecycle/advancedWorkflows': advancedWorkflowsStub,
  './utils/registryCredentialHelper': registryCredentialHelperStub,
  './utils/imageVerifier': { ImageVerifier: MockImageVerifier },
  './serviceHelper': serviceHelperStub,
  './utils/globalState': globalStateStub,
});

describe('imageUpdateService tests', () => {
  beforeEach(() => {
    // Reset all stubs
    dockerServiceStub.dockerListContainers.reset();
    dockerServiceStub.dockerListImages.reset();
    dockerServiceStub.dockerContainerInspect.reset();
    dockerServiceStub.getDockerContainer.reset();
    dockerServiceStub.getAppIdentifier.reset();

    appQueryServiceStub.installedApps.reset();
    appQueryServiceStub.decryptEnterpriseApps.reset();
    // Configure decryptEnterpriseApps to pass through apps unchanged by default
    appQueryServiceStub.decryptEnterpriseApps.callsFake(async (apps) => apps);

    advancedWorkflowsStub.softRedeploy.reset();

    registryCredentialHelperStub.getCredentials.reset();

    serviceHelperStub.delay.reset();

    logStub.info.reset();
    logStub.warn.reset();
    logStub.error.reset();
    logStub.debug.reset();

    // Reset globalState
    globalStateStub.removalInProgress = false;
    globalStateStub.installationInProgress = false;
    globalStateStub.softRedeployInProgress = false;
    globalStateStub.hardRedeployInProgress = false;

    // Reset mock verifier state
    mockVerifierParseError = false;
    mockVerifierError = false;
    mockVerifierErrorDetail = '';
    mockVerifierErrorMeta = null;
    mockDigestToReturn = null;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('removeWatchtowerContainer tests', () => {
    it('should return false when no watchtower container exists', async () => {
      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/fluxMyApp'], Id: 'abc123', State: 'running' },
      ]);

      const result = await imageUpdateService.removeWatchtowerContainer();

      expect(result).to.equal(false);
      sinon.assert.calledOnce(dockerServiceStub.dockerListContainers);
      sinon.assert.calledWith(dockerServiceStub.dockerListContainers, true);
    });

    it('should stop and remove watchtower container when found running', async () => {
      const mockContainer = {
        stop: sinon.stub().resolves(),
        remove: sinon.stub().resolves(),
      };

      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/flux_watchtower'], Id: 'watchtower123', State: 'running' },
      ]);
      dockerServiceStub.getDockerContainer.returns(mockContainer);
      dockerServiceStub.dockerListImages.resolves([]);

      const result = await imageUpdateService.removeWatchtowerContainer();

      expect(result).to.equal(true);
      sinon.assert.calledOnce(mockContainer.stop);
      sinon.assert.calledOnce(mockContainer.remove);
    });

    it('should remove watchtower container when found stopped', async () => {
      const mockContainer = {
        stop: sinon.stub().resolves(),
        remove: sinon.stub().resolves(),
      };

      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/flux_watchtower'], Id: 'watchtower123', State: 'exited' },
      ]);
      dockerServiceStub.getDockerContainer.returns(mockContainer);
      dockerServiceStub.dockerListImages.resolves([]);

      const result = await imageUpdateService.removeWatchtowerContainer();

      expect(result).to.equal(true);
      sinon.assert.notCalled(mockContainer.stop);
      sinon.assert.calledOnce(mockContainer.remove);
    });

    it('should force remove container when stop fails', async () => {
      const mockContainer = {
        stop: sinon.stub().rejects(new Error('Container already stopped')),
        remove: sinon.stub().resolves(),
      };

      dockerServiceStub.dockerListContainers.resolves([
        { Names: ['/flux_watchtower'], Id: 'watchtower123', State: 'running' },
      ]);
      dockerServiceStub.getDockerContainer.returns(mockContainer);
      dockerServiceStub.dockerListImages.resolves([]);

      const result = await imageUpdateService.removeWatchtowerContainer();

      expect(result).to.equal(true);
      sinon.assert.calledWith(mockContainer.remove, { force: true });
    });

    it('should return false when dockerListContainers throws error', async () => {
      dockerServiceStub.dockerListContainers.rejects(new Error('Docker not available'));

      const result = await imageUpdateService.removeWatchtowerContainer();

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logStub.error);
    });
  });

  describe('getLocalImageDigest tests', () => {
    it('should return digest when container and image exist', async () => {
      const containerInfo = { Image: 'sha256:imageId123' };
      const images = [
        {
          Id: 'sha256:imageId123',
          RepoDigests: ['nginx@sha256:abc123def456'],
        },
      ];

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      dockerServiceStub.dockerListImages.resolves(images);

      const result = await imageUpdateService.getLocalImageDigest('fluxMyApp');

      expect(result).to.equal('sha256:abc123def456');
    });

    it('should return null when container not found', async () => {
      dockerServiceStub.dockerContainerInspect.rejects(new Error('Container not found'));

      const result = await imageUpdateService.getLocalImageDigest('fluxMissingApp');

      expect(result).to.equal(null);
    });

    it('should return null when container has no image', async () => {
      dockerServiceStub.dockerContainerInspect.resolves({ Image: null });

      const result = await imageUpdateService.getLocalImageDigest('fluxMyApp');

      expect(result).to.equal(null);
    });

    it('should return null when image not found in local images', async () => {
      const containerInfo = { Image: 'sha256:imageId123' };
      const images = [
        { Id: 'sha256:differentImage', RepoDigests: ['other@sha256:xyz'] },
      ];

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      dockerServiceStub.dockerListImages.resolves(images);

      const result = await imageUpdateService.getLocalImageDigest('fluxMyApp');

      expect(result).to.equal(null);
    });

    it('should return null when RepoDigests is empty', async () => {
      const containerInfo = { Image: 'sha256:imageId123' };
      const images = [
        { Id: 'sha256:imageId123', RepoDigests: [] },
      ];

      dockerServiceStub.dockerContainerInspect.resolves(containerInfo);
      dockerServiceStub.dockerListImages.resolves(images);

      const result = await imageUpdateService.getLocalImageDigest('fluxMyApp');

      expect(result).to.equal(null);
    });
  });

  describe('getRemoteManifestDigest tests', () => {
    it('should return digest for public image without auth', async () => {
      mockDigestToReturn = 'sha256:remote123';

      const result = await imageUpdateService.getRemoteManifestDigest('nginx:latest', null, 4, 'testApp');

      expect(result).to.deep.equal({ error: null, digest: 'sha256:remote123' });
    });

    it('should return null when image tag parse fails', async () => {
      mockVerifierParseError = true;
      mockVerifierErrorDetail = 'Invalid tag';

      const result = await imageUpdateService.getRemoteManifestDigest('invalid tag', null, 4, 'testApp');

      expect(result).to.deep.equal({ error: 'parse_error', digest: null });
    });

    it('should get credentials for authenticated repos', async () => {
      registryCredentialHelperStub.getCredentials.resolves({
        username: 'user',
        password: 'pass',
      });
      mockDigestToReturn = 'sha256:auth123';

      const result = await imageUpdateService.getRemoteManifestDigest(
        'private/image:v1',
        'encrypted_auth',
        7,
        'privateApp',
      );

      expect(result).to.deep.equal({ error: null, digest: 'sha256:auth123' });
      sinon.assert.calledOnce(registryCredentialHelperStub.getCredentials);
      sinon.assert.calledWith(
        registryCredentialHelperStub.getCredentials,
        'private/image:v1',
        'encrypted_auth',
        7,
        'privateApp',
      );
    });

    it('should return null when credentials fail', async () => {
      registryCredentialHelperStub.getCredentials.rejects(new Error('Decryption failed'));

      const result = await imageUpdateService.getRemoteManifestDigest(
        'private/image:v1',
        'bad_auth',
        7,
        'privateApp',
      );

      expect(result).to.deep.equal({ error: 'credentials_failed', digest: null });
    });
  });

  describe('checkAppForUpdates tests', () => {
    beforeEach(() => {
      dockerServiceStub.getAppIdentifier.callsFake((name) => `flux${name}`);
    });

    it('should detect update needed for v1-v3 app', async () => {
      const appSpec = {
        name: 'TestApp',
        version: 3,
        repotag: 'nginx:latest',
        repoauth: null,
      };

      // Mock local digest - use valid hex for sha256
      const localDigest = 'sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abcd';
      const remoteDigest = 'sha256:fed987cba654fed987cba654fed987cba654fed987cba654fed987cba654fedc';

      dockerServiceStub.dockerContainerInspect.resolves({ Image: 'sha256:local123' });
      dockerServiceStub.dockerListImages.resolves([
        { Id: 'sha256:local123', RepoDigests: [`nginx@${localDigest}`] },
      ]);

      // Mock remote digest (different from local)
      mockDigestToReturn = remoteDigest;

      const result = await imageUpdateService.checkAppForUpdates(appSpec);

      expect(result.needsUpdate).to.equal(true);
      expect(result.components).to.have.lengthOf(1);
      expect(result.components[0].name).to.equal('TestApp');
      expect(result.components[0].localDigest).to.equal(localDigest);
      expect(result.components[0].remoteDigest).to.equal(remoteDigest);
    });

    it('should not detect update when digests match for v1-v3 app', async () => {
      const appSpec = {
        name: 'TestApp',
        version: 3,
        repotag: 'nginx:latest',
        repoauth: null,
      };

      const sameDigest = 'sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abcd';

      dockerServiceStub.dockerContainerInspect.resolves({ Image: 'sha256:local123' });
      dockerServiceStub.dockerListImages.resolves([
        { Id: 'sha256:local123', RepoDigests: [`nginx@${sameDigest}`] },
      ]);

      mockDigestToReturn = sameDigest;

      const result = await imageUpdateService.checkAppForUpdates(appSpec);

      expect(result.needsUpdate).to.equal(false);
      expect(result.components).to.have.lengthOf(0);
    });

    it('should check all components for v4+ compose app', async () => {
      const appSpec = {
        name: 'ComposedApp',
        version: 4,
        compose: [
          { name: 'web', repotag: 'nginx:latest', repoauth: null },
          { name: 'api', repotag: 'node:18', repoauth: null },
        ],
      };

      const webLocalDigest = 'sha256:111111111111111111111111111111111111111111111111111111111111aaaa';
      const webRemoteDigest = 'sha256:222222222222222222222222222222222222222222222222222222222222bbbb';
      const apiDigest = 'sha256:333333333333333333333333333333333333333333333333333333333333cccc';

      // Mock local digests - both containers exist
      dockerServiceStub.dockerContainerInspect
        .onFirstCall().resolves({ Image: 'sha256:webImage' })
        .onSecondCall().resolves({ Image: 'sha256:apiImage' });

      dockerServiceStub.dockerListImages.resolves([
        { Id: 'sha256:webImage', RepoDigests: [`nginx@${webLocalDigest}`] },
        { Id: 'sha256:apiImage', RepoDigests: [`node@${apiDigest}`] },
      ]);

      // Mock remote digests - web has update (different), api stays same
      mockDigestToReturn = webRemoteDigest;

      const result = await imageUpdateService.checkAppForUpdates(appSpec);

      expect(result.needsUpdate).to.equal(true);
      expect(result.components.length).to.be.at.least(1);
      expect(result.components[0].name).to.equal('web');
    });

    it('should skip app with no compose array for v4+', async () => {
      const appSpec = {
        name: 'BrokenApp',
        version: 4,
        compose: null,
      };

      const result = await imageUpdateService.checkAppForUpdates(appSpec);

      expect(result.needsUpdate).to.equal(false);
      sinon.assert.calledOnce(logStub.warn);
    });

    it('should skip component when local digest cannot be retrieved', async () => {
      const appSpec = {
        name: 'TestApp',
        version: 3,
        repotag: 'nginx:latest',
        repoauth: null,
      };

      dockerServiceStub.dockerContainerInspect.rejects(new Error('Container not found'));

      const result = await imageUpdateService.checkAppForUpdates(appSpec);

      expect(result.needsUpdate).to.equal(false);
    });
  });

  describe('triggerAppUpdate tests', () => {
    it('should call softRedeploy when no operation in progress', async () => {
      const appSpec = { name: 'TestApp', version: 3 };

      advancedWorkflowsStub.softRedeploy.resolves();

      const result = await imageUpdateService.triggerAppUpdate(appSpec);

      expect(result).to.equal(true);
      sinon.assert.calledOnce(advancedWorkflowsStub.softRedeploy);
      sinon.assert.calledWith(advancedWorkflowsStub.softRedeploy, appSpec, null);
    });

    it('should return false when removal is in progress', async () => {
      globalStateStub.removalInProgress = true;
      const appSpec = { name: 'TestApp', version: 3 };

      const result = await imageUpdateService.triggerAppUpdate(appSpec);

      expect(result).to.equal(false);
      sinon.assert.notCalled(advancedWorkflowsStub.softRedeploy);
    });

    it('should return false when installation is in progress', async () => {
      globalStateStub.installationInProgress = true;
      const appSpec = { name: 'TestApp', version: 3 };

      const result = await imageUpdateService.triggerAppUpdate(appSpec);

      expect(result).to.equal(false);
      sinon.assert.notCalled(advancedWorkflowsStub.softRedeploy);
    });

    it('should return false when soft redeploy is in progress', async () => {
      globalStateStub.softRedeployInProgress = true;
      const appSpec = { name: 'TestApp', version: 3 };

      const result = await imageUpdateService.triggerAppUpdate(appSpec);

      expect(result).to.equal(false);
      sinon.assert.notCalled(advancedWorkflowsStub.softRedeploy);
    });

    it('should return false when hard redeploy is in progress', async () => {
      globalStateStub.hardRedeployInProgress = true;
      const appSpec = { name: 'TestApp', version: 3 };

      const result = await imageUpdateService.triggerAppUpdate(appSpec);

      expect(result).to.equal(false);
      sinon.assert.notCalled(advancedWorkflowsStub.softRedeploy);
    });

    it('should return false and log error when softRedeploy throws', async () => {
      const appSpec = { name: 'TestApp', version: 3 };
      advancedWorkflowsStub.softRedeploy.rejects(new Error('Redeploy failed'));

      const result = await imageUpdateService.triggerAppUpdate(appSpec);

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logStub.error);
    });
  });

  describe('checkForImageUpdates tests', () => {
    it('should skip check when operation in progress', async () => {
      globalStateStub.installationInProgress = true;

      await imageUpdateService.checkForImageUpdates();

      sinon.assert.notCalled(appQueryServiceStub.installedApps);
      sinon.assert.calledWith(logStub.info, 'Skipping image update check: another operation in progress');
    });

    it('should process all installed apps', async () => {
      appQueryServiceStub.installedApps.resolves({
        status: 'success',
        data: [
          { name: 'App1', version: 3, repotag: 'nginx:latest' },
          { name: 'App2', version: 3, repotag: 'redis:latest' },
        ],
      });

      dockerServiceStub.getAppIdentifier.callsFake((name) => `flux${name}`);
      dockerServiceStub.dockerContainerInspect.resolves({ Image: 'sha256:img' });
      dockerServiceStub.dockerListImages.resolves([
        { Id: 'sha256:img', RepoDigests: ['repo@sha256:same'] },
      ]);
      mockDigestToReturn = 'sha256:same';

      await imageUpdateService.checkForImageUpdates();

      sinon.assert.calledOnce(appQueryServiceStub.installedApps);
      sinon.assert.calledWith(logStub.info, sinon.match(/Checking 2 installed apps/));
    });

    it('should handle installedApps error gracefully', async () => {
      appQueryServiceStub.installedApps.resolves({
        status: 'error',
        data: 'Database error',
      });

      await imageUpdateService.checkForImageUpdates();

      sinon.assert.calledWith(logStub.warn, 'Could not get installed apps list');
    });

    it('should abort when operation starts during check', async () => {
      const apps = [
        { name: 'App1', version: 3, repotag: 'nginx:latest' },
        { name: 'App2', version: 3, repotag: 'redis:latest' },
      ];

      appQueryServiceStub.installedApps.resolves({ status: 'success', data: apps });
      dockerServiceStub.getAppIdentifier.callsFake((name) => `flux${name}`);

      // First app check triggers state change
      let callCount = 0;
      dockerServiceStub.dockerContainerInspect.callsFake(() => {
        callCount += 1;
        if (callCount === 1) {
          // After first app, set flag to simulate operation starting
          globalStateStub.removalInProgress = true;
        }
        return Promise.resolve({ Image: 'sha256:img' });
      });

      dockerServiceStub.dockerListImages.resolves([
        { Id: 'sha256:img', RepoDigests: ['repo@sha256:same'] },
      ]);
      mockDigestToReturn = 'sha256:same';

      await imageUpdateService.checkForImageUpdates();

      sinon.assert.calledWith(logStub.info, 'Aborting image update check: operation started');
    });
  });

  describe('startImageUpdateService and stopImageUpdateService tests', () => {
    let clock;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
      imageUpdateService.stopImageUpdateService();
    });

    it('should start the service and log startup message', () => {
      imageUpdateService.startImageUpdateService();

      sinon.assert.calledWith(logStub.info, 'Starting native image update service');
      sinon.assert.calledWith(logStub.info, sinon.match(/Image update service started/));
    });

    it('should run initial check after delay', async () => {
      appQueryServiceStub.installedApps.resolves({ status: 'success', data: [] });

      imageUpdateService.startImageUpdateService();

      // Initial delay is random between 10-30 minutes, so advance by 30 minutes to ensure callback runs
      await clock.tickAsync(30 * 60 * 1000);

      sinon.assert.calledWith(logStub.info, 'Running initial image update check');
      sinon.assert.calledOnce(appQueryServiceStub.installedApps);
      sinon.assert.calledOnce(appQueryServiceStub.decryptEnterpriseApps);
    });

    it('should stop the service and clear interval', () => {
      imageUpdateService.startImageUpdateService();
      imageUpdateService.stopImageUpdateService();

      sinon.assert.calledWith(logStub.info, 'Image update service stopped');
    });

    it('should handle multiple start calls by clearing previous interval', () => {
      imageUpdateService.startImageUpdateService();
      imageUpdateService.startImageUpdateService();

      // Should still only have one active interval
      imageUpdateService.stopImageUpdateService();
      sinon.assert.calledWith(logStub.info, 'Image update service stopped');
    });
  });
});
