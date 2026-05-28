const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/utils/enterpriseConfig';

const DISK_OWNERS = ['diskOwner1'];
const DISK_PUBKEYS = ['diskPubkey1'];
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function makeLog() {
  return { error: sinon.stub(), info: sinon.stub(), warn: sinon.stub() };
}

// Each load runs the module top-level fresh, re-seeding from the (stubbed) disk.
function loadModule(overrides = {}) {
  const log = overrides.log || makeLog();

  const fsStub = overrides.fs || {
    readFileSync: sinon.stub().callsFake((p) => {
      if (String(p).includes('enterpriseappowners')) return JSON.stringify(DISK_OWNERS);
      if (String(p).includes('enterprisenodespublickeys')) return JSON.stringify(DISK_PUBKEYS);
      throw new Error(`unexpected path ${p}`);
    }),
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
    it('seeds both lists from the on-disk helper files', () => {
      const { module: m } = loadModule();
      expect(m.getEnterpriseAppOwners()).to.deep.equal(DISK_OWNERS);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal(DISK_PUBKEYS);
    });

    it('falls back to [] when a disk read throws', () => {
      const fs = { readFileSync: sinon.stub().throws(new Error('ENOENT')) };
      const { module: m } = loadModule({ fs });
      expect(m.getEnterpriseAppOwners()).to.deep.equal([]);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal([]);
    });

    it('ignores disk content that is not a JSON array', () => {
      const fs = { readFileSync: sinon.stub().returns('{"not":"an array"}') };
      const { module: m } = loadModule({ fs });
      expect(m.getEnterpriseAppOwners()).to.deep.equal([]);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal([]);
    });
  });

  describe('syncFromGithub', () => {
    it('replaces in-memory values when github returns arrays', async () => {
      const axiosGet = sinon.stub();
      axiosGet.withArgs(sinon.match(/enterpriseappowners/)).resolves({ data: ['ghOwner'] });
      axiosGet.withArgs(sinon.match(/enterprisenodespublickeys/)).resolves({ data: ['ghPubkey'] });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.syncFromGithub();

      expect(m.getEnterpriseAppOwners()).to.deep.equal(['ghOwner']);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal(['ghPubkey']);
    });

    it('keeps the disk values when the github fetch fails', async () => {
      const axiosGet = sinon.stub().rejects(new Error('network down'));
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.syncFromGithub();

      expect(m.getEnterpriseAppOwners()).to.deep.equal(DISK_OWNERS);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal(DISK_PUBKEYS);
    });

    it('keeps the current value when github returns a non-array', async () => {
      const axiosGet = sinon.stub().resolves({ data: { unexpected: true } });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.syncFromGithub();

      expect(m.getEnterpriseAppOwners()).to.deep.equal(DISK_OWNERS);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal(DISK_PUBKEYS);
    });
  });

  describe('startSync / stopSync', () => {
    it('runs an immediate sync then refreshes every 6h, and stops on stopSync', async () => {
      const clock = sinon.useFakeTimers();
      const axiosGet = sinon.stub().resolves({ data: ['gh'] });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      expect(axiosGet.callCount).to.equal(2); // one per list, immediately

      await clock.tickAsync(SIX_HOURS_MS);
      expect(axiosGet.callCount).to.equal(4); // refreshed once

      m.stopSync();
      await clock.tickAsync(SIX_HOURS_MS);
      expect(axiosGet.callCount).to.equal(4); // no more refreshes

      clock.restore();
    });

    it('is idempotent — a second startSync does not schedule a second interval', async () => {
      const clock = sinon.useFakeTimers();
      const axiosGet = sinon.stub().resolves({ data: ['gh'] });
      const { module: m } = loadModule({ serviceHelper: { axiosGet } });

      await m.startSync();
      await m.startSync();
      expect(axiosGet.callCount).to.equal(2); // second startSync no-ops

      await clock.tickAsync(SIX_HOURS_MS);
      expect(axiosGet.callCount).to.equal(4); // single interval fired once

      m.stopSync();
      clock.restore();
    });
  });
});
