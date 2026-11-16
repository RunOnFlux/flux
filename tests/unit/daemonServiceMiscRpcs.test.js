const sinon = require('sinon');
const { expect } = require('chai');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const log = require('../../ZelBack/src/lib/log');
const proxyquire = require('proxyquire');
const { networks, configWith } = require('./fixtures/networkConfig');

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('daemonServiceMiscRpcs tests', () => {
  describe('isInsightExplorer tests', () => {
    let insightIndexes;

    beforeEach(() => {
      insightIndexes = sinon.stub(daemonServiceUtils, 'insightIndexes');
    });

    afterEach(() => {
      sinon.restore();
    });

    [[true, true], [false, false], [null, false]].forEach(([known, expected]) => {
      it(`answers ${expected} when fluxd's insight indexes are ${known}`, () => {
        insightIndexes.returns(known);
        expect(daemonServiceMiscRpcs.isInsightExplorer()).to.equal(expected);
      });
    });

    it('answers fluxd\'s latest report, so a fluxd restart reaches it', () => {
      insightIndexes.returns(true);
      expect(daemonServiceMiscRpcs.isInsightExplorer()).to.equal(true);
      insightIndexes.returns(false);
      expect(daemonServiceMiscRpcs.isInsightExplorer()).to.equal(false);
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

  describe('chainHeight', () => {
    const NOW = 1_800_000_000_000;

    beforeEach(() => {
      sinon.useFakeTimers({ now: NOW, toFake: ['Date'] });
      daemonServiceMiscRpcs.setCurrentDaemonHeader(50000);
      daemonServiceMiscRpcs.setCurrentDaemonHeight(50000);
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(NOW);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('is the height a synced daemon has just reported', () => {
      expect(daemonServiceMiscRpcs.chainHeight()).to.equal(50000);
    });

    // The daemon is still taken as synced for a while after its last answer,
    // and the chain moves on meanwhile: eight blocks in four minutes.
    it('counts a block for every 30 s since the daemon last answered', () => {
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(NOW - 4 * 60 * 1000);
      expect(daemonServiceMiscRpcs.chainHeight()).to.equal(50008);
    });

    // A daemon behind the tip reports a height below the chain's, which would
    // read heights recorded while it was synced as recent.
    it('is 0 while the daemon is behind the tip, whatever height it reports', () => {
      daemonServiceMiscRpcs.setCurrentDaemonHeight(100);
      expect(daemonServiceMiscRpcs.chainHeight()).to.equal(0);
      daemonServiceMiscRpcs.setCurrentDaemonHeight(49900);
      expect(daemonServiceMiscRpcs.chainHeight()).to.equal(0);
    });

    it('is 0 once the daemon has not answered for longer than it is taken as synced', () => {
      daemonServiceMiscRpcs.setLastSuccessfulRpcCall(NOW - 6 * 60 * 1000);
      expect(daemonServiceMiscRpcs.chainHeight()).to.equal(0);
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

    it('calls each height listener with the height a poll reads, and none for a poll that fails', async () => {
      const listener = sinon.stub();
      const stop = daemonServiceMiscRpcs.onDaemonHeight(listener);
      try {
        daemonServiceBlockchainRpcsStub.resolves({ status: 'success', data: { blocks: 123456, headers: 123456 } });
        await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo();
        await new Promise((resolve) => { setImmediate(resolve); });
        sinon.assert.calledOnceWithExactly(listener, 123456);

        daemonServiceBlockchainRpcsStub.resolves({ status: 'error', data: { message: 'Connection failed' } });
        await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo();
        await new Promise((resolve) => { setImmediate(resolve); });
        sinon.assert.calledOnce(listener);

        stop();
        daemonServiceBlockchainRpcsStub.resolves({ status: 'success', data: { blocks: 123457, headers: 123457 } });
        await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo();
        await new Promise((resolve) => { setImmediate(resolve); });
        sinon.assert.calledOnce(listener);
      } finally {
        stop();
        daemonServiceMiscRpcs.setCurrentDaemonHeight(0);
      }
    });

    it('logs a height listener that fails and keeps polling', async () => {
      const logError = sinon.stub(log, 'error');
      const stop = daemonServiceMiscRpcs.onDaemonHeight(() => Promise.reject(new Error('listener failed')));
      try {
        daemonServiceBlockchainRpcsStub.resolves({ status: 'success', data: { blocks: 123456, headers: 123456 } });

        expect(await daemonServiceMiscRpcs.fluxDaemonBlockchainInfo()).to.equal(true);
        await new Promise((resolve) => { setImmediate(resolve); });

        sinon.assert.calledWithMatch(logError, sinon.match({ message: 'listener failed' }));
      } finally {
        stop();
        daemonServiceMiscRpcs.setCurrentDaemonHeight(0);
      }
    });
  });

  describe('initial header tests', () => {
    const loadFor = (profile) => proxyquire('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs', {
      config: configWith({ daemon: { initialHeaderFloor: profile.daemon.initialHeaderFloor } }),
    });

    it('starts from the network\'s header floor until the daemon reports one', () => {
      expect(loadFor(networks.labnet).getCurrentDaemonHeader()).to.equal(0);
      expect(loadFor(networks.mainnet).getCurrentDaemonHeader()).to.equal(1136836);
    });
  });
});
