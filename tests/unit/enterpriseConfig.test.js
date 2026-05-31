const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/utils/enterpriseConfig';

const DISK_MAP = {
  nodeA: ['ownerA', 'ownerB'],
  nodeB: ['ownerB'],
};
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function makeLog() {
  return { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
}

// Each load runs the module top-level fresh. Initialization no longer happens as
// a side effect of require(): callers must startSync() (which seeds from disk and
// then syncs from github) before the getters return data.
function loadModule(overrides = {}) {
  const log = overrides.log || makeLog();

  const fsStub = overrides.fs || {
    promises: { readFile: sinon.stub().resolves(JSON.stringify(DISK_MAP)) },
  };

  // Default to a failing fetch so disk-seeding tests keep the disk value.
  const serviceHelperStub = overrides.serviceHelper
    || { axiosGet: sinon.stub().rejects(new Error('no network')) };

  const configStub = overrides.config || {
    github: { rawBaseUrl: 'https://raw.example/RunOnFlux/flux/master' },
  };

  const stubs = {
    config: configStub,
    fs: fsStub,
    '../serviceHelper': serviceHelperStub,
    '../../lib/log': log,
  };

  return {
    module: proxyquire(MODULE_PATH, stubs), fs: fsStub, serviceHelper: serviceHelperStub, log,
  };
}

describe('enterpriseConfig', () => {
  afterEach(() => sinon.restore());

  describe('disk seeding via startSync', () => {
    it('seeds the node->owners map from the on-disk helper file', async () => {
      const { module: m } = loadModule();
      await m.startSync();
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal(DISK_MAP);
      m.stopSync();
    });

    it('derives node pubkeys (keys) and the global owner union (deduped values)', async () => {
      const { module: m } = loadModule();
      await m.startSync();
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal(['nodeA', 'nodeB']);
      expect(m.getEnterpriseAppOwners()).to.deep.equal(['ownerA', 'ownerB']);
      m.stopSync();
    });

    it('returns a specific node\'s allowed owners, or [] for an unknown node', async () => {
      const { module: m } = loadModule();
      await m.startSync();
      expect(m.getAllowedOwnersForNode('nodeA')).to.deep.equal(['ownerA', 'ownerB']);
      expect(m.getAllowedOwnersForNode('nodeB')).to.deep.equal(['ownerB']);
      expect(m.getAllowedOwnersForNode('unknown')).to.deep.equal([]);
      m.stopSync();
    });

    it('does the disk read asynchronously (fs.promises.readFile)', async () => {
      const readFile = sinon.stub().resolves(JSON.stringify(DISK_MAP));
      const { module: m } = loadModule({ fs: { promises: { readFile } } });
      await m.startSync();
      expect(readFile.calledOnce).to.equal(true);
      m.stopSync();
    });

    it('falls back to an empty map when the disk read throws', async () => {
      const fs = { promises: { readFile: sinon.stub().rejects(new Error('ENOENT')) } };
      const { module: m } = loadModule({ fs });
      await m.startSync();
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({});
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal([]);
      expect(m.getEnterpriseAppOwners()).to.deep.equal([]);
      m.stopSync();
    });

    it('ignores disk content that is not a JSON object', async () => {
      const fs = { promises: { readFile: sinon.stub().resolves('["not","an","object"]') } };
      const { module: m } = loadModule({ fs });
      await m.startSync();
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({});
      m.stopSync();
    });

    it('rejects disk content whose values are not arrays of strings (finding #2/#10)', async () => {
      const fs = { promises: { readFile: sinon.stub().resolves(JSON.stringify({ nodeA: null })) } };
      const { module: m, log } = loadModule({ fs });
      await m.startSync();
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({});
      expect(log.error.called).to.equal(true);
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
      const clock = sinon.useFakeTimers();
      const axiosGet = sinon.stub().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      expect(axiosGet.callCount).to.equal(1); // immediate sync

      await clock.tickAsync(SIX_HOURS_MS);
      expect(axiosGet.callCount).to.equal(2); // refreshed once

      m.stopSync();
      await clock.tickAsync(SIX_HOURS_MS);
      expect(axiosGet.callCount).to.equal(2); // no more refreshes

      clock.restore();
    });

    it('is idempotent — a second startSync does not schedule a second interval', async () => {
      const clock = sinon.useFakeTimers();
      const axiosGet = sinon.stub().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      await m.startSync();
      expect(axiosGet.callCount).to.equal(1); // second startSync no-ops

      await clock.tickAsync(SIX_HOURS_MS);
      expect(axiosGet.callCount).to.equal(2); // single interval fired once

      m.stopSync();
      clock.restore();
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
