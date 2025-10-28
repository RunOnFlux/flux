// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const dbHelper = require('../../ZelBack/src/services/dbHelper');

describe('advancedWorkflows tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('getPreviousAppSpecifications tests', () => {
    it('should throw error if no previous message found', async () => {
      const specifications = { name: 'NewApp' };
      const verificationTimestamp = Date.now();

      sinon.stub(dbHelper, 'databaseConnection').returns({
        db: () => ({}),
      });
      sinon.stub(dbHelper, 'findInDatabase').resolves([]);

      try {
        await advancedWorkflows.getPreviousAppSpecifications(specifications, verificationTimestamp);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('does not exists');
      }
    });
  });

  describe('setInstallationInProgress and getInstallationInProgress tests', () => {
    it('should set installation in progress', () => {
      advancedWorkflows.setInstallationInProgressTrue();

      const inProgress = advancedWorkflows.getInstallationInProgress();
      expect(inProgress).to.be.true;
    });

    it('should reset installation in progress', () => {
      advancedWorkflows.setInstallationInProgressTrue();
      advancedWorkflows.installationInProgressReset();

      const inProgress = advancedWorkflows.getInstallationInProgress();
      expect(inProgress).to.be.false;
    });

    it('should set specific app installation in progress', () => {
      advancedWorkflows.setInstallationInProgress('TestApp', true);

      const inProgress = advancedWorkflows.getInstallationInProgress();
      // When setting specific app, function returns the app name, not just true
      expect(inProgress).to.equal('TestApp');
    });
  });

  describe('setRemovalInProgress and getRemovalInProgress tests', () => {
    it('should set removal in progress', () => {
      advancedWorkflows.setRemovalInProgressToTrue();

      const inProgress = advancedWorkflows.getRemovalInProgress();
      expect(inProgress).to.be.true;
    });

    it('should reset removal in progress', () => {
      advancedWorkflows.setRemovalInProgressToTrue();
      advancedWorkflows.removalInProgressReset();

      const inProgress = advancedWorkflows.getRemovalInProgress();
      expect(inProgress).to.be.false;
    });

    it('should set specific app removal in progress', () => {
      advancedWorkflows.setRemovalInProgress('TestApp', true);

      const inProgress = advancedWorkflows.getRemovalInProgress();
      // When setting specific app, function returns the app name, not just true
      expect(inProgress).to.equal('TestApp');
    });
  });

  describe('addToRestoreProgress and removeFromRestoreProgress tests', () => {
    beforeEach(() => {
      const globalState = require('../../ZelBack/src/services/utils/globalState');
      globalState.restoreInProgress = [];
    });

    it('should add app to restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');

      const globalState = require('../../ZelBack/src/services/utils/globalState');
      expect(globalState.restoreInProgress).to.include('TestApp');
    });

    it('should remove app from restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');
      advancedWorkflows.removeFromRestoreProgress('TestApp');

      const globalState = require('../../ZelBack/src/services/utils/globalState');
      expect(globalState.restoreInProgress).to.not.include('TestApp');
    });

    it('should not duplicate apps in restore progress', () => {
      advancedWorkflows.addToRestoreProgress('TestApp');
      advancedWorkflows.addToRestoreProgress('TestApp');

      const globalState = require('../../ZelBack/src/services/utils/globalState');
      const count = globalState.restoreInProgress.filter((app) => app === 'TestApp').length;
      expect(count).to.equal(1);
    });
  });

  // Note: verifyAppUpdateParameters, validateApplicationUpdateCompatibility,
  // createAppVolume, getPeerAppsInstallingErrorMessages, and stopSyncthingApp are
  // complex integration functions or HTTP request handlers that require extensive
  // mocking of database connections, HTTP requests, and external services.
  // These should be tested in integration tests rather than unit tests.
});
