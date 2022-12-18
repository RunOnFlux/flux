const sinon = require('sinon');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const daemonServiceBlockchainRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBlockchainRpcs').default;
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs').default;
const log = require('../../ZelBack/src/lib/log').default;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceMiscRpcs tests', () => {
  describe('isInsightExplorer tests', () => {
    let serviceUtilsStub;

    beforeEach(() => {
      daemonServiceMiscRpcs.setIsDaemonInsightExplorer(null);
      serviceUtilsStub = sinon.stub(daemonServiceUtils, 'getConfigValue');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return the isDaemonInsightExplorer value if it is already set', () => {
      daemonServiceMiscRpcs.setIsDaemonInsightExplorer(1);

      const result = daemonServiceMiscRpcs.isInsightExplorer();

      expect(result).to.eql(1);
      sinon.assert.notCalled(serviceUtilsStub);
    });

    it('should return config value and set isDaemonInsightExplorer to true if getConfigValue returns 1', () => {
      serviceUtilsStub.returns(1);

      const result = daemonServiceMiscRpcs.isInsightExplorer();

      expect(result).to.eql(true);
      expect(daemonServiceMiscRpcs.getIsDaemonInsightExplorer()).to.eql(true);
      sinon.assert.calledOnceWithExactly(serviceUtilsStub, 'insightexplorer');
    });

    it('should return config value and set isDaemonInsightExplorer to true if getConfigValue returns \'1\'', () => {
      serviceUtilsStub.returns('1');

      const result = daemonServiceMiscRpcs.isInsightExplorer();

      expect(result).to.eql(true);
      expect(daemonServiceMiscRpcs.getIsDaemonInsightExplorer()).to.eql(true);
      sinon.assert.calledOnceWithExactly(serviceUtilsStub, 'insightexplorer');
    });

    it('should return config value and set isDaemonInsightExplorer to false if getConfigValue returns anything but 1', () => {
      serviceUtilsStub.returns(2);

      const result = daemonServiceMiscRpcs.isInsightExplorer();

      expect(result).to.eql(false);
      expect(daemonServiceMiscRpcs.getIsDaemonInsightExplorer()).to.eql(false);
      sinon.assert.calledOnceWithExactly(serviceUtilsStub, 'insightexplorer');
    });
  });

  describe('isDaemonSynced tests', () => {
    beforeEach(() => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(0);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return isDaemonSynced message if current height is less than header height, no response passed', () => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(0);
      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      const expectedResponse = {
        status: 'success',
        data: { header: 249187, height: 0, synced: false },
      };

      const result = daemonServiceMiscRpcs.isDaemonSynced();

      expect(result).to.eql(expectedResponse);
    });

    it('should return isDaemonSynced message if current height is more than header height, no response passed', () => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(259187);
      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      const expectedResponse = {
        status: 'success',
        data: { header: 249187, height: 259187, synced: true },
      };

      const result = daemonServiceMiscRpcs.isDaemonSynced();

      expect(result).to.eql(expectedResponse);
    });

    it('should return isDaemonSynced message if current height is more than header height, response passed', () => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(249192);
      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      const expectedResponse = {
        status: 'success',
        data: { header: 249187, height: 249192, synced: true },
      };
      const res = generateResponse();

      const result = daemonServiceMiscRpcs.isDaemonSynced(undefined, res);

      expect(result).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });
  });

  describe('fluxDaemonBlockchainInfo tests', () => {
    let daemonServiceBlockchainRpcsStub;
    let logInfoSpy;

    beforeEach(() => {
      daemonServiceBlockchainRpcsStub = sinon.stub(daemonServiceBlockchainRpcs, 'getBlockchainInfo');
      logInfoSpy = sinon.spy(log, 'info');

      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      daemonServiceMiscRpcs.setCurrentDaemonHeight(0);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should set new current header and height', async () => {
      daemonServiceBlockchainRpcsStub.returns({
        status: 'success',
        data: {
          blocks: 123456,
          headers: 555555,
          message: 'testmessage',
        },
      });

      await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo();

      expect(daemonServiceMiscRpcs.getCurrentDaemonHeader()).to.eql(555555);
      expect(daemonServiceMiscRpcs.getCurrentDaemonHeight()).to.eql(123456);
      sinon.assert.calledOnceWithExactly(logInfoSpy, `Daemon Sync status: ${123456}/${555555}`);
    });

    it('should not set a new header if the number is lower', async () => {
      daemonServiceBlockchainRpcsStub.returns({
        status: 'success',
        data: {
          blocks: 123456,
          headers: 1234,
          message: 'testmessage',
        },
      });

      await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo();

      expect(daemonServiceMiscRpcs.getCurrentDaemonHeader()).to.eql(249187);
      expect(daemonServiceMiscRpcs.getCurrentDaemonHeight()).to.eql(123456);
      sinon.assert.calledOnceWithExactly(logInfoSpy, `Daemon Sync status: ${123456}/${249187}`);
    });
  });
});
