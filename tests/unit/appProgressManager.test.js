const { expect } = require('chai');
const sinon = require('sinon');
const log = require('../../ZelBack/src/lib/log');

describe('appProgressManager tests', () => {
  let appProgressManager;

  beforeEach(() => {
    // Clear module cache to reset state
    delete require.cache[require.resolve('../../ZelBack/src/services/utils/appProgressManager')];
    // eslint-disable-next-line global-require
    appProgressManager = require('../../ZelBack/src/services/utils/appProgressManager');
    sinon.stub(log, 'info');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('installation progress tests', () => {
    it('should start with installation not in progress', () => {
      const status = appProgressManager.isInstallationInProgress();
      expect(status).to.be.false;
    });

    it('should set installation in progress to true', () => {
      appProgressManager.setInstallationInProgressTrue();
      const status = appProgressManager.isInstallationInProgress();
      expect(status).to.be.true;
    });

    it('should log when setting installation in progress', () => {
      appProgressManager.setInstallationInProgressTrue();
      sinon.assert.calledWith(log.info, 'App installation progress flag set to true');
    });

    it('should reset installation in progress', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.installationInProgressReset();
      const status = appProgressManager.isInstallationInProgress();
      expect(status).to.be.false;
    });

    it('should log when resetting installation in progress', () => {
      appProgressManager.setInstallationInProgressTrue();
      log.info.resetHistory();
      appProgressManager.installationInProgressReset();
      sinon.assert.calledWith(log.info, 'App installation progress flag reset');
    });

    it('should handle multiple sets without reset', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setInstallationInProgressTrue();
      const status = appProgressManager.isInstallationInProgress();
      expect(status).to.be.true;
    });

    it('should handle multiple resets', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.installationInProgressReset();
      appProgressManager.installationInProgressReset();
      const status = appProgressManager.isInstallationInProgress();
      expect(status).to.be.false;
    });
  });

  describe('removal progress tests', () => {
    it('should start with removal not in progress', () => {
      const status = appProgressManager.isRemovalInProgress();
      expect(status).to.be.false;
    });

    it('should set removal in progress to true', () => {
      appProgressManager.setRemovalInProgressToTrue();
      const status = appProgressManager.isRemovalInProgress();
      expect(status).to.be.true;
    });

    it('should log when setting removal in progress', () => {
      appProgressManager.setRemovalInProgressToTrue();
      sinon.assert.calledWith(log.info, 'App removal progress flag set to true');
    });

    it('should reset removal in progress', () => {
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.removalInProgressReset();
      const status = appProgressManager.isRemovalInProgress();
      expect(status).to.be.false;
    });

    it('should log when resetting removal in progress', () => {
      appProgressManager.setRemovalInProgressToTrue();
      log.info.resetHistory();
      appProgressManager.removalInProgressReset();
      sinon.assert.calledWith(log.info, 'App removal progress flag reset');
    });

    it('should handle multiple sets without reset', () => {
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.setRemovalInProgressToTrue();
      const status = appProgressManager.isRemovalInProgress();
      expect(status).to.be.true;
    });

    it('should handle multiple resets', () => {
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.removalInProgressReset();
      appProgressManager.removalInProgressReset();
      const status = appProgressManager.isRemovalInProgress();
      expect(status).to.be.false;
    });
  });

  describe('getProgressStatus tests', () => {
    it('should return both flags as false initially', () => {
      const status = appProgressManager.getProgressStatus();
      expect(status).to.deep.equal({
        installationInProgress: false,
        removalInProgress: false,
      });
    });

    it('should reflect installation in progress', () => {
      appProgressManager.setInstallationInProgressTrue();
      const status = appProgressManager.getProgressStatus();
      expect(status).to.deep.equal({
        installationInProgress: true,
        removalInProgress: false,
      });
    });

    it('should reflect removal in progress', () => {
      appProgressManager.setRemovalInProgressToTrue();
      const status = appProgressManager.getProgressStatus();
      expect(status).to.deep.equal({
        installationInProgress: false,
        removalInProgress: true,
      });
    });

    it('should reflect both in progress', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();
      const status = appProgressManager.getProgressStatus();
      expect(status).to.deep.equal({
        installationInProgress: true,
        removalInProgress: true,
      });
    });

    it('should return object with expected structure', () => {
      const status = appProgressManager.getProgressStatus();
      expect(status).to.be.an('object');
      expect(status).to.have.property('installationInProgress');
      expect(status).to.have.property('removalInProgress');
      expect(Object.keys(status)).to.have.lengthOf(2);
    });
  });

  describe('resetAllProgress tests', () => {
    it('should reset both flags when both are set', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.resetAllProgress();

      expect(appProgressManager.isInstallationInProgress()).to.be.false;
      expect(appProgressManager.isRemovalInProgress()).to.be.false;
    });

    it('should reset both flags when only installation is set', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.resetAllProgress();

      expect(appProgressManager.isInstallationInProgress()).to.be.false;
      expect(appProgressManager.isRemovalInProgress()).to.be.false;
    });

    it('should reset both flags when only removal is set', () => {
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.resetAllProgress();

      expect(appProgressManager.isInstallationInProgress()).to.be.false;
      expect(appProgressManager.isRemovalInProgress()).to.be.false;
    });

    it('should work when both flags are already false', () => {
      appProgressManager.resetAllProgress();

      expect(appProgressManager.isInstallationInProgress()).to.be.false;
      expect(appProgressManager.isRemovalInProgress()).to.be.false;
    });

    it('should log when resetting all progress', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();
      log.info.resetHistory();

      appProgressManager.resetAllProgress();

      sinon.assert.calledWith(log.info, 'All app progress flags reset');
    });

    it('should affect getProgressStatus result', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.resetAllProgress();

      const status = appProgressManager.getProgressStatus();
      expect(status).to.deep.equal({
        installationInProgress: false,
        removalInProgress: false,
      });
    });
  });

  describe('state independence tests', () => {
    it('should not affect removal when setting installation', () => {
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.setInstallationInProgressTrue();

      expect(appProgressManager.isRemovalInProgress()).to.be.true;
      expect(appProgressManager.isInstallationInProgress()).to.be.true;
    });

    it('should not affect installation when setting removal', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();

      expect(appProgressManager.isInstallationInProgress()).to.be.true;
      expect(appProgressManager.isRemovalInProgress()).to.be.true;
    });

    it('should not affect removal when resetting installation', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.installationInProgressReset();

      expect(appProgressManager.isInstallationInProgress()).to.be.false;
      expect(appProgressManager.isRemovalInProgress()).to.be.true;
    });

    it('should not affect installation when resetting removal', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.removalInProgressReset();

      expect(appProgressManager.isInstallationInProgress()).to.be.true;
      expect(appProgressManager.isRemovalInProgress()).to.be.false;
    });
  });

  describe('integration scenarios', () => {
    it('should handle typical installation workflow', () => {
      // Check not in progress
      expect(appProgressManager.isInstallationInProgress()).to.be.false;

      // Start installation
      appProgressManager.setInstallationInProgressTrue();
      expect(appProgressManager.isInstallationInProgress()).to.be.true;

      // Complete installation
      appProgressManager.installationInProgressReset();
      expect(appProgressManager.isInstallationInProgress()).to.be.false;
    });

    it('should handle typical removal workflow', () => {
      // Check not in progress
      expect(appProgressManager.isRemovalInProgress()).to.be.false;

      // Start removal
      appProgressManager.setRemovalInProgressToTrue();
      expect(appProgressManager.isRemovalInProgress()).to.be.true;

      // Complete removal
      appProgressManager.removalInProgressReset();
      expect(appProgressManager.isRemovalInProgress()).to.be.false;
    });

    it('should handle concurrent installation and removal', () => {
      // Start installation
      appProgressManager.setInstallationInProgressTrue();
      expect(appProgressManager.getProgressStatus()).to.deep.equal({
        installationInProgress: true,
        removalInProgress: false,
      });

      // Start removal while installing
      appProgressManager.setRemovalInProgressToTrue();
      expect(appProgressManager.getProgressStatus()).to.deep.equal({
        installationInProgress: true,
        removalInProgress: true,
      });

      // Complete installation
      appProgressManager.installationInProgressReset();
      expect(appProgressManager.getProgressStatus()).to.deep.equal({
        installationInProgress: false,
        removalInProgress: true,
      });

      // Complete removal
      appProgressManager.removalInProgressReset();
      expect(appProgressManager.getProgressStatus()).to.deep.equal({
        installationInProgress: false,
        removalInProgress: false,
      });
    });

    it('should handle emergency reset during operations', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();

      // Emergency reset
      appProgressManager.resetAllProgress();

      const status = appProgressManager.getProgressStatus();
      expect(status.installationInProgress).to.be.false;
      expect(status.removalInProgress).to.be.false;
    });

    it('should maintain state across multiple queries', () => {
      appProgressManager.setInstallationInProgressTrue();

      expect(appProgressManager.isInstallationInProgress()).to.be.true;
      expect(appProgressManager.isInstallationInProgress()).to.be.true;
      expect(appProgressManager.isInstallationInProgress()).to.be.true;

      const status1 = appProgressManager.getProgressStatus();
      const status2 = appProgressManager.getProgressStatus();
      const status3 = appProgressManager.getProgressStatus();

      expect(status1.installationInProgress).to.be.true;
      expect(status2.installationInProgress).to.be.true;
      expect(status3.installationInProgress).to.be.true;
    });

    it('should handle rapid state changes', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.installationInProgressReset();
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.installationInProgressReset();
      appProgressManager.setInstallationInProgressTrue();

      expect(appProgressManager.isInstallationInProgress()).to.be.true;

      appProgressManager.installationInProgressReset();
      expect(appProgressManager.isInstallationInProgress()).to.be.false;
    });
  });

  describe('logging behavior tests', () => {
    it('should log all state changes', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();
      appProgressManager.installationInProgressReset();
      appProgressManager.removalInProgressReset();

      expect(log.info.callCount).to.equal(4);
    });

    it('should log resetAllProgress once', () => {
      appProgressManager.setInstallationInProgressTrue();
      appProgressManager.setRemovalInProgressToTrue();
      log.info.resetHistory();

      appProgressManager.resetAllProgress();

      expect(log.info.callCount).to.equal(1);
      sinon.assert.calledWith(log.info, 'All app progress flags reset');
    });

    it('should not log on query operations', () => {
      log.info.resetHistory();

      appProgressManager.isInstallationInProgress();
      appProgressManager.isRemovalInProgress();
      appProgressManager.getProgressStatus();

      expect(log.info.callCount).to.equal(0);
    });
  });
});
