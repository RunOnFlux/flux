const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/utils/enterpriseConfig';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function makeLog() {
  return { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
}

// Each load runs the module top-level fresh. Initialization does not happen as a side
// effect of require(): callers must startSync() before the getters answer anything.
function loadModule(overrides = {}) {
  const log = overrides.log || makeLog();

  const serviceHelperStub = overrides.serviceHelper
    || { axiosGet: sinon.stub().rejects(new Error('no network')) };

  const configStub = overrides.config || {
    policy: { baseUrl: 'https://raw.example/RunOnFlux/fluxos-network-policy/main' },
  };

  // A plain object, so a test can read back whether the module opened the gate.
  const globalStateStub = overrides.globalState || { policyReady: false };

  const stubs = {
    config: configStub,
    '../serviceHelper': serviceHelperStub,
    '../../lib/log': log,
    './globalState': globalStateStub,
  };

  return {
    module: proxyquire(MODULE_PATH, stubs),
    serviceHelper: serviceHelperStub,
    globalState: globalStateStub,
    log,
  };
}

describe('enterpriseConfig', () => {
  afterEach(() => sinon.restore());

  // The release used to ship helpers/enterprisenodes.json and startSync seeded from it.
  // That seed was frozen at the moment the release was cut, so every restart began by
  // enforcing a snapshot that could name the wrong nodes and the wrong owners - and the
  // ownership sweep acted on it five minutes later. There is no disk seed now, and the
  // map is unknown until a fetch succeeds.
  describe('unknown until a fetch succeeds', () => {
    it('answers null from every getter before any successful fetch', async () => {
      const { module: m } = loadModule();
      await m.startSync();

      expect(m.isPolicyKnown()).to.equal(false);
      expect(m.getEnterpriseNodeOwnerMap()).to.equal(null);
      expect(m.getEnterpriseNodesPublicKeys()).to.equal(null);
      expect(m.getEnterpriseAppOwners()).to.equal(null);
      expect(m.getAllowedOwnersForNode('nodeA')).to.equal(null);
      m.stopSync();
    });

    it('null is not an empty map: an unknown policy never reads as "nobody is enterprise"', async () => {
      const { module: m } = loadModule();
      await m.startSync();

      // The distinction this module exists to preserve. `[]` would let a caller conclude
      // this node is not an enterprise node, which is the answer that fills it with apps
      // it must not host.
      expect(m.getEnterpriseNodesPublicKeys()).to.not.deep.equal([]);
      expect(m.getEnterpriseAppOwners()).to.not.deep.equal([]);
      m.stopSync();
    });

    it('leaves the policyReady gate shut while the fetch keeps failing', async () => {
      const { module: m, globalState } = loadModule();
      await m.startSync();

      expect(globalState.policyReady).to.equal(false);
      m.stopSync();
    });

    it('opens the policyReady gate once a valid payload arrives', async () => {
      const axiosGet = sinon.stub().resolves({ data: { nodeA: ['ownerA'] } });
      const { module: m, globalState } = loadModule({ serviceHelper: { axiosGet } });
      await m.startSync();

      expect(globalState.policyReady).to.equal(true);
      expect(m.isPolicyKnown()).to.equal(true);
      m.stopSync();
    });

    it('does not open the gate for a payload of the wrong shape', async () => {
      const axiosGet = sinon.stub().resolves({ data: { nodeA: 'not-an-array' } });
      const { module: m, globalState } = loadModule({ serviceHelper: { axiosGet } });
      await m.startSync();

      expect(globalState.policyReady).to.equal(false);
      expect(m.isPolicyKnown()).to.equal(false);
      m.stopSync();
    });

    it('once known, an unmapped node reads as [] rather than null', async () => {
      const axiosGet = sinon.stub().resolves({ data: { nodeA: ['ownerA', 'ownerB'] } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });
      await m.startSync();

      expect(m.getAllowedOwnersForNode('nodeA')).to.deep.equal(['ownerA', 'ownerB']);
      expect(m.getAllowedOwnersForNode('nodeZ')).to.deep.equal([]); // known, and hosts nobody
      m.stopSync();
    });
  });

  describe('syncFromGithub', () => {
    it('replaces the in-memory map when github returns a valid object', async () => {
      const axiosGet = sinon.stub().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.syncFromGithub();

      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({ nodeC: ['ownerC'] });
      expect(m.getEnterpriseAppOwners()).to.deep.equal(['ownerC']);
    });

    it('uses a bounded request timeout', async () => {
      const axiosGet = sinon.stub().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.syncFromGithub();

      expect(axiosGet.firstCall.args[1]).to.have.property('timeout');
      expect(axiosGet.firstCall.args[1].timeout).to.be.a('number');
    });

    it('keeps the last-good map when the github fetch fails', async () => {
      const axiosGet = sinon.stub();
      axiosGet.onFirstCall().resolves({ data: { nodeC: ['ownerC'] } }); // seed via startSync
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });
      await m.startSync();
      m.stopSync();
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({ nodeC: ['ownerC'] });

      axiosGet.rejects(new Error('network down'));
      await m.syncFromGithub();

      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({ nodeC: ['ownerC'] });
    });

    it('rejects a non-object payload and keeps the current map', async () => {
      const axiosGet = sinon.stub();
      axiosGet.onFirstCall().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m, log } = loadModule({ serviceHelper: { axiosGet } });
      await m.startSync();
      m.stopSync();

      axiosGet.resolves({ data: ['unexpected'] });
      await m.syncFromGithub();

      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({ nodeC: ['ownerC'] });
      expect(log.error.called).to.equal(true);
    });

    it('rejects a payload with non-array values and keeps the last-good map (finding #2/#10)', async () => {
      const axiosGet = sinon.stub();
      axiosGet.onFirstCall().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m, log } = loadModule({ serviceHelper: { axiosGet } });
      await m.startSync();
      m.stopSync();

      axiosGet.resolves({ data: { nodeC: null } });
      await m.syncFromGithub();

      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({ nodeC: ['ownerC'] });
      expect(log.error.called).to.equal(true);
    });

    it('rejects a payload whose array contains non-string entries (finding #2/#10)', async () => {
      const axiosGet = sinon.stub();
      axiosGet.onFirstCall().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });
      await m.startSync();
      m.stopSync();

      axiosGet.resolves({ data: { nodeC: [123] } });
      await m.syncFromGithub();

      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({ nodeC: ['ownerC'] });
    });
  });

  describe('startSync / stopSync', () => {
    it('runs an immediate sync then refreshes every 6h, and stops on stopSync', async () => {
      const axiosGet = sinon.stub().resolves({ data: { nodeC: ['ownerC'] } });
      // Capture the interval registration rather than advancing a clock. No fake
      // timers means nothing for a loaded CI event loop to starve and nothing to
      // leak into sibling tests. The contract is asserted directly: scheduled at
      // 6h, the callback performs a sync, and stopSync clears the interval.
      let intervalCb = null;
      let intervalMs = null;
      const intervalId = Symbol('enterpriseConfig-interval');
      sinon.stub(global, 'setInterval').callsFake((cb, ms) => {
        intervalCb = cb;
        intervalMs = ms;
        return intervalId;
      });
      const clearIntervalStub = sinon.stub(global, 'clearInterval');
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      expect(axiosGet.callCount).to.equal(1); // immediate sync
      expect(intervalMs).to.equal(SIX_HOURS_MS); // refresh scheduled at 6h

      await intervalCb(); // simulate one refresh tick (axiosGet is invoked synchronously)
      expect(axiosGet.callCount).to.equal(2); // refreshed once

      m.stopSync();
      expect(clearIntervalStub.calledOnceWithExactly(intervalId)).to.equal(true); // interval cleared
    });

    it('is idempotent — a second startSync does not schedule a second interval', async () => {
      const axiosGet = sinon.stub().resolves({ data: { nodeC: ['ownerC'] } });
      let intervalCb = null;
      const setIntervalStub = sinon.stub(global, 'setInterval').callsFake((cb) => {
        intervalCb = cb;
        return Symbol('enterpriseConfig-interval');
      });
      sinon.stub(global, 'clearInterval');
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      await m.startSync();
      expect(axiosGet.callCount).to.equal(1); // second startSync no-ops
      expect(setIntervalStub.callCount).to.equal(1); // only one interval scheduled

      await intervalCb(); // the single scheduled interval still refreshes
      expect(axiosGet.callCount).to.equal(2);

      m.stopSync();
    });
  });

  // Two cadences, because the failures are not equivalent. A refresh that fails costs
  // nothing - the node keeps the map it has. A FIRST fetch that fails leaves it unable to
  // acquire any app at all, so waiting the full refresh interval to try again would turn a
  // momentary blip at boot into six hours of a node doing nothing.
  describe('retry while the policy is unknown', () => {
    it('retries on a short interval instead of waiting for the refresh', async () => {
      const axiosGet = sinon.stub().rejects(new Error('no network'));
      let retryCb = null;
      let retryMs = null;
      sinon.stub(global, 'setTimeout').callsFake((cb, ms) => {
        retryCb = cb;
        retryMs = ms;
        return 'retry-handle';
      });
      const setIntervalStub = sinon.stub(global, 'setInterval');
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();

      expect(retryMs).to.be.at.most(60 * 1000); // within the first minute, not six hours
      expect(setIntervalStub.called).to.equal(false); // no refresh until there is something to refresh
      expect(retryCb).to.be.a('function');
    });

    it('keeps retrying for as long as the fetch keeps failing', async () => {
      const axiosGet = sinon.stub().rejects(new Error('no network'));
      const timeoutStub = sinon.stub(global, 'setTimeout').returns('retry-handle');
      sinon.stub(global, 'setInterval');
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      await timeoutStub.firstCall.args[0](); // one retry tick, still failing

      expect(axiosGet.callCount).to.equal(2);
      expect(timeoutStub.callCount).to.equal(2); // another retry scheduled
    });

    it('settles into the refresh once the policy is obtained', async () => {
      const axiosGet = sinon.stub();
      axiosGet.onFirstCall().rejects(new Error('no network'));
      axiosGet.onSecondCall().resolves({ data: { nodeA: ['ownerA'] } });
      const timeoutStub = sinon.stub(global, 'setTimeout').returns('retry-handle');
      const setIntervalStub = sinon.stub(global, 'setInterval');
      const { module: m, globalState } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      expect(setIntervalStub.called).to.equal(false);

      await timeoutStub.firstCall.args[0](); // the retry that succeeds

      expect(globalState.policyReady).to.equal(true);
      expect(setIntervalStub.calledOnce).to.equal(true);
      expect(setIntervalStub.firstCall.args[1]).to.equal(SIX_HOURS_MS);
      expect(timeoutStub.callCount).to.equal(1); // no further retry scheduled
    });

    it('backs off, and never past the cap', async () => {
      // A fixed interval would put the whole fleet on raw.githubusercontent at a
      // constant rate for as long as an outage lasted - and the outage is the only
      // time this path runs.
      const axiosGet = sinon.stub().rejects(new Error('no network'));
      const timeoutStub = sinon.stub(global, 'setTimeout').returns('retry-handle');
      sinon.stub(global, 'setInterval');
      sinon.stub(Math, 'random').returns(1); // take the top of each window
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      // eslint-disable-next-line no-await-in-loop
      for (let i = 0; i < 10; i += 1) await timeoutStub.lastCall.args[0]();

      const delays = timeoutStub.getCalls().map((c) => c.args[1]);
      expect(delays[0]).to.equal(60 * 1000);
      expect(delays[1]).to.equal(120 * 1000);
      expect(delays[2]).to.equal(240 * 1000);
      expect(Math.max(...delays)).to.equal(30 * 60 * 1000); // capped
    });

    it('jitters, so nodes that restarted together do not stay in lockstep', async () => {
      const axiosGet = sinon.stub().rejects(new Error('no network'));
      const timeoutStub = sinon.stub(global, 'setTimeout').returns('retry-handle');
      sinon.stub(global, 'setInterval');
      const randomStub = sinon.stub(Math, 'random');
      randomStub.onCall(0).returns(0.1);
      randomStub.onCall(1).returns(0.9);
      randomStub.returns(0.5);
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      await timeoutStub.lastCall.args[0]();

      const [first, second] = timeoutStub.getCalls().map((c) => c.args[1]);
      expect(first).to.equal(6 * 1000); // 10% of the first window
      expect(second).to.equal(108 * 1000); // 90% of the second - not a multiple of the first
    });

    it('stopSync clears a pending retry', async () => {
      const axiosGet = sinon.stub().rejects(new Error('no network'));
      const handle = 'retry-handle';
      sinon.stub(global, 'setTimeout').returns(handle);
      sinon.stub(global, 'setInterval');
      const clearTimeoutStub = sinon.stub(global, 'clearTimeout');
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      m.stopSync();

      expect(clearTimeoutStub.calledOnceWithExactly(handle)).to.equal(true);
    });

    it('a second startSync does not stack a second retry', async () => {
      const axiosGet = sinon.stub().rejects(new Error('no network'));
      const timeoutStub = sinon.stub(global, 'setTimeout').returns('retry-handle');
      sinon.stub(global, 'setInterval');
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      await m.startSync();

      expect(axiosGet.callCount).to.equal(1);
      expect(timeoutStub.callCount).to.equal(1);
    });
  });

  describe('getEnterpriseAppOwners memoization (finding #6)', () => {
    it('returns the same array instance until the map is replaced', async () => {
      const axiosGet = sinon.stub();
      axiosGet.onFirstCall().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });
      await m.startSync();
      m.stopSync();

      const first = m.getEnterpriseAppOwners();
      const second = m.getEnterpriseAppOwners();
      expect(second).to.equal(first); // same reference, not rebuilt

      axiosGet.resolves({ data: { nodeD: ['ownerD'] } });
      await m.syncFromGithub();
      const third = m.getEnterpriseAppOwners();
      expect(third).to.not.equal(first); // rebuilt after map replacement
      expect(third).to.deep.equal(['ownerD']);
    });
  });
});
