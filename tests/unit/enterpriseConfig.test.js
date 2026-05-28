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

// Each load runs the module top-level fresh, re-seeding from the (stubbed) disk.
function loadModule(overrides = {}) {
  const log = overrides.log || makeLog();

  const fsStub = overrides.fs || {
    readFileSync: sinon.stub().returns(JSON.stringify(DISK_MAP)),
  };

  const serviceHelperStub = overrides.serviceHelper || { axiosGet: sinon.stub() };

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

  describe('disk seeding at load', () => {
    it('seeds the node->owners map from the on-disk helper file', () => {
      const { module: m } = loadModule();
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal(DISK_MAP);
    });

    it('derives node pubkeys (keys) and the global owner union (deduped values)', () => {
      const { module: m } = loadModule();
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal(['nodeA', 'nodeB']);
      expect(m.getEnterpriseAppOwners()).to.deep.equal(['ownerA', 'ownerB']);
    });

    it('returns a specific node\'s allowed owners, or [] for an unknown node', () => {
      const { module: m } = loadModule();
      expect(m.getAllowedOwnersForNode('nodeA')).to.deep.equal(['ownerA', 'ownerB']);
      expect(m.getAllowedOwnersForNode('nodeB')).to.deep.equal(['ownerB']);
      expect(m.getAllowedOwnersForNode('unknown')).to.deep.equal([]);
    });

    it('falls back to an empty map when the disk read throws', () => {
      const fs = { readFileSync: sinon.stub().throws(new Error('ENOENT')) };
      const { module: m } = loadModule({ fs });
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({});
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal([]);
      expect(m.getEnterpriseAppOwners()).to.deep.equal([]);
    });

    it('ignores disk content that is not a JSON object', () => {
      const fs = { readFileSync: sinon.stub().returns('["not","an","object"]') };
      const { module: m } = loadModule({ fs });
      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({});
    });
  });

  describe('syncFromGithub', () => {
    it('replaces the in-memory map when github returns an object', async () => {
      const axiosGet = sinon.stub().resolves({ data: { nodeC: ['ownerC'] } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.syncFromGithub();

      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal({ nodeC: ['ownerC'] });
      expect(m.getEnterpriseAppOwners()).to.deep.equal(['ownerC']);
    });

    it('keeps the disk map when the github fetch fails', async () => {
      const axiosGet = sinon.stub().rejects(new Error('network down'));
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.syncFromGithub();

      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal(DISK_MAP);
    });

    it('keeps the current map when github returns a non-object', async () => {
      const axiosGet = sinon.stub().resolves({ data: ['unexpected'] });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.syncFromGithub();

      expect(m.getEnterpriseNodeOwnerMap()).to.deep.equal(DISK_MAP);
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
});
