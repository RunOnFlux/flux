const sinon = require('sinon');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const log = require('../../ZelBack/src/lib/log');

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceMiscRpcs tests', () => {
  describe('isAddressIndex', () => {
    let addressIndex;

    beforeEach(() => {
      addressIndex = sinon.stub(daemonServiceUtils, 'addressIndex');
    });

    afterEach(() => {
      sinon.restore();
    });

    [[true, true], [false, false], [null, false]].forEach(([known, expected]) => {
      it(`answers ${expected} when fluxd's address index is ${known}`, () => {
        addressIndex.returns(known);
        expect(daemonServiceMiscRpcs.isAddressIndex()).to.equal(expected);
      });
    });
  });

  describe('isInsightExplorer tests', () => {
    let insightIndexes;

    beforeEach(() => {
      daemonServiceMiscRpcs.setIsDaemonInsightExplorer(null);
      insightIndexes = sinon.stub(daemonServiceUtils, 'insightIndexes');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return the isDaemonInsightExplorer value if it is already set', () => {
      daemonServiceMiscRpcs.setIsDaemonInsightExplorer(1);

      const result = daemonServiceMiscRpcs.isInsightExplorer();

      expect(result).to.eql(1);
      sinon.assert.notCalled(insightIndexes);
    });

    [true, false].forEach((known) => {
      it(`keeps a known answer: ${known}`, () => {
        insightIndexes.returns(known);

        expect(daemonServiceMiscRpcs.isInsightExplorer()).to.equal(known);
        expect(daemonServiceMiscRpcs.getIsDaemonInsightExplorer()).to.equal(known);
        expect(daemonServiceMiscRpcs.isInsightExplorer()).to.equal(known);
        sinon.assert.calledOnce(insightIndexes);
      });
    });

    it('answers false while not known, and asks again until it is', () => {
      // A request before fluxd first answers must not turn the explorer's routes
      // off until the next restart.
      insightIndexes.returns(null);
      expect(daemonServiceMiscRpcs.isInsightExplorer()).to.equal(false);
      expect(daemonServiceMiscRpcs.getIsDaemonInsightExplorer()).to.equal(null);

      insightIndexes.returns(true);
      expect(daemonServiceMiscRpcs.isInsightExplorer()).to.equal(true);
      sinon.assert.calledTwice(insightIndexes);
    });
  });

  describe('isDaemonSynced tests', () => {
    beforeEach(() => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(0);
      // Set recent RPC call timestamp for tests that expect synced behavior
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(Date.now());
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return isDaemonSynced message if current height is less than header height, no response passed', () => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(0);
      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(Date.now());
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
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(Date.now());
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
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(Date.now());
      const expectedResponse = {
        status: 'success',
        data: { header: 249187, height: 249192, synced: true },
      };
      const res = generateResponse();

      const result = daemonServiceMiscRpcs.isDaemonSynced(undefined, res);

      expect(result).to.eql(`Response: ${expectedResponse}`);
      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return unsynced if lastSuccessfulRpcCall is null', () => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(249192);
      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(null);
      const expectedResponse = {
        status: 'success',
        data: { header: 249187, height: 249192, synced: false },
      };

      const result = daemonServiceMiscRpcs.isDaemonSynced();

      expect(result).to.eql(expectedResponse);
    });

    it('should return unsynced if lastSuccessfulRpcCall is older than 10 blocks (300 seconds)', () => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(249192);
      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      // Set timestamp to 301 seconds ago (just over threshold)
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(Date.now() - (301 * 1000));
      const expectedResponse = {
        status: 'success',
        data: { header: 249187, height: 249192, synced: false },
      };

      const result = daemonServiceMiscRpcs.isDaemonSynced();

      expect(result).to.eql(expectedResponse);
    });

    it('should return synced if lastSuccessfulRpcCall is within 10 blocks (300 seconds) and height is close to header', () => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(249192);
      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      // Set timestamp to 299 seconds ago (just under threshold)
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(Date.now() - (299 * 1000));
      const expectedResponse = {
        status: 'success',
        data: { header: 249187, height: 249192, synced: true },
      };

      const result = daemonServiceMiscRpcs.isDaemonSynced();

      expect(result).to.eql(expectedResponse);
    });
  });

  describe('fluxDaemonBlockchainInfo tests', () => {
    let daemonServiceBlockchainRpcsStub;
    let logInfoSpy;

    beforeEach(() => {
      daemonServiceBlockchainRpcsStub = sinon.stub(daemonServiceUtils, 'executeCall');
      logInfoSpy = sinon.spy(log, 'info');

      daemonServiceMiscRpcs.setCurrentDaemonHeader(249187);
      daemonServiceMiscRpcs.setCurrentDaemonHeight(0);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should set new current header and height', async () => {
      daemonServiceBlockchainRpcsStub.resolves({
        status: 'success',
        data: {
          blocks: 123456,
          headers: 555555,
          message: 'testmessage',
        },
      });

      const beforeCall = Date.now();
      await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo();
      const afterCall = Date.now();

      expect(daemonServiceMiscRpcs.getCurrentDaemonHeader()).to.eql(555555);
      expect(daemonServiceMiscRpcs.getCurrentDaemonHeight()).to.eql(123456);

      // Verify lastSuccessfulRpcCall was updated
      const lastRpcCall = daemonServiceMiscRpcs.getLastSuccessfulRpcCall();
      expect(lastRpcCall).to.be.at.least(beforeCall);
      expect(lastRpcCall).to.be.at.most(afterCall);

      sinon.assert.calledOnceWithExactly(logInfoSpy, `Daemon Sync status: ${123456}/${555555}`);
    });

    it('should not set a new header if the number is lower', async () => {
      daemonServiceBlockchainRpcsStub.resolves({
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

    it('should not update lastSuccessfulRpcCall when RPC call fails', async () => {
      const initialTimestamp = Date.now() - 60000; // 1 minute ago
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(initialTimestamp);

      daemonServiceBlockchainRpcsStub.resolves({
        status: 'error',
        data: {
          message: 'Connection failed',
        },
      });

      await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo();

      // Verify lastSuccessfulRpcCall was NOT updated
      expect(daemonServiceMiscRpcs.getLastSuccessfulRpcCall()).to.eql(initialTimestamp);
    });

    it('should not update lastSuccessfulRpcCall when RPC call throws exception', async () => {
      const initialTimestamp = Date.now() - 60000; // 1 minute ago
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(initialTimestamp);

      daemonServiceBlockchainRpcsStub.rejects(new Error('Network error'));

      await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo();

      // Verify lastSuccessfulRpcCall was NOT updated
      expect(daemonServiceMiscRpcs.getLastSuccessfulRpcCall()).to.eql(initialTimestamp);
    });
  });
});
