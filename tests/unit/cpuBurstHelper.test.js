process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const chai = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const proxyquire = require('proxyquire');
const config = require('config');

const { expect } = chai;

describe('cpuBurstHelper tests', () => {
  let cpuBurstHelper;

  beforeEach(() => {
    // Fresh require each time to reset the cache
    cpuBurstHelper = proxyquire('../../ZelBack/src/services/utils/cpuBurstHelper', {});
    cpuBurstHelper.resetBurstSupportCache();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('isEnterpriseOwner', () => {
    it('should return true for an owner in enterpriseAppOwners config', () => {
      const result = cpuBurstHelper.isEnterpriseOwner('16mzUh6byiQr7rnYQxKraDbeBPsEHYpSTW');
      expect(result).to.be.true;
    });

    it('should return false for an unknown owner', () => {
      const result = cpuBurstHelper.isEnterpriseOwner('1UnknownAddress123');
      expect(result).to.be.false;
    });

    it('should return false for null/undefined owner', () => {
      expect(cpuBurstHelper.isEnterpriseOwner(null)).to.be.false;
      expect(cpuBurstHelper.isEnterpriseOwner(undefined)).to.be.false;
    });
  });

  describe('calculateBurstParams', () => {
    it('should calculate correct params for 1 CPU core', () => {
      const params = cpuBurstHelper.calculateBurstParams(1);
      expect(params.periodUs).to.equal(100000);
      expect(params.quotaUs).to.equal(100000);
      expect(params.burstUs).to.equal(100000); // (2.0 - 1) * 100000
    });

    it('should calculate correct params for 2.5 CPU cores', () => {
      const params = cpuBurstHelper.calculateBurstParams(2.5);
      expect(params.periodUs).to.equal(100000);
      expect(params.quotaUs).to.equal(250000);
      expect(params.burstUs).to.equal(250000);
    });

    it('should calculate correct params for 10 CPU cores', () => {
      const params = cpuBurstHelper.calculateBurstParams(10);
      expect(params.periodUs).to.equal(100000);
      expect(params.quotaUs).to.equal(1000000);
      expect(params.burstUs).to.equal(1000000);
    });

    it('should handle fractional CPU values', () => {
      const params = cpuBurstHelper.calculateBurstParams(0.5);
      expect(params.periodUs).to.equal(100000);
      expect(params.quotaUs).to.equal(50000);
      expect(params.burstUs).to.equal(50000);
    });
  });

  describe('isCpuBurstSupported', () => {
    it('should return false when burst config is disabled', async () => {
      const configStub = sinon.stub(config, 'cpuBurst').value({ enabled: false, burstMultiplier: 2.0, periodUs: 100000 });
      cpuBurstHelper.resetBurstSupportCache();

      // Need a fresh instance for config change
      const helper = proxyquire('../../ZelBack/src/services/utils/cpuBurstHelper', {});
      helper.resetBurstSupportCache();
      const result = await helper.isCpuBurstSupported();
      expect(result).to.be.false;
    });

    it('should return false when cgroups v2 is not present', async () => {
      sinon.stub(fs, 'existsSync').returns(false);
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.isCpuBurstSupported();
      expect(result).to.be.false;
    });

    it('should return false for kernel < 5.14', async () => {
      const existsStub = sinon.stub(fs, 'existsSync').returns(true);
      sinon.stub(fs, 'readFileSync').returns('Linux version 5.4.0-generic');
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.isCpuBurstSupported();
      expect(result).to.be.false;
    });

    it('should return true for kernel >= 5.14 with cgroups v2', async () => {
      sinon.stub(fs, 'existsSync').returns(true);
      sinon.stub(fs, 'readFileSync').returns('Linux version 6.1.0-generic');
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.isCpuBurstSupported();
      expect(result).to.be.true;
    });

    it('should cache the result on subsequent calls', async () => {
      sinon.stub(fs, 'existsSync').returns(true);
      const readStub = sinon.stub(fs, 'readFileSync').returns('Linux version 6.1.0-generic');
      cpuBurstHelper.resetBurstSupportCache();

      await cpuBurstHelper.isCpuBurstSupported();
      await cpuBurstHelper.isCpuBurstSupported();
      // existsSync called once for cgroup check, readFileSync called once for kernel
      expect(readStub.callCount).to.equal(1);
    });
  });

  describe('getCgroupBurstPath', () => {
    it('should return systemd cgroup path when it exists', () => {
      const containerId = 'abc123def456';
      sinon.stub(fs, 'existsSync').callsFake((p) => p.includes('system.slice'));

      const result = cpuBurstHelper.getCgroupBurstPath(containerId);
      expect(result).to.include('system.slice');
      expect(result).to.include(containerId);
      expect(result).to.include('cpu.max.burst');
    });

    it('should return docker cgroup path as fallback', () => {
      const containerId = 'abc123def456';
      sinon.stub(fs, 'existsSync').callsFake((p) => p.includes('/docker/'));

      const result = cpuBurstHelper.getCgroupBurstPath(containerId);
      expect(result).to.include('/docker/');
      expect(result).to.include(containerId);
    });

    it('should return null when no cgroup path exists', () => {
      sinon.stub(fs, 'existsSync').returns(false);

      const result = cpuBurstHelper.getCgroupBurstPath('abc123');
      expect(result).to.be.null;
    });
  });

  describe('setCpuBurst', () => {
    it('should write burst value to cgroup file', () => {
      const containerId = 'abc123def456789012345678901234567890123456789012345678901234abcd';
      sinon.stub(fs, 'existsSync').callsFake((p) => p.includes('system.slice'));
      const writeStub = sinon.stub(fs, 'writeFileSync');

      const result = cpuBurstHelper.setCpuBurst(containerId, 100000);
      expect(result).to.be.true;
      expect(writeStub.calledOnce).to.be.true;
      expect(writeStub.firstCall.args[1]).to.equal('100000');
    });

    it('should return false when cgroup path not found', () => {
      sinon.stub(fs, 'existsSync').returns(false);

      const result = cpuBurstHelper.setCpuBurst('abc123', 100000);
      expect(result).to.be.false;
    });

    it('should return false when write fails', () => {
      sinon.stub(fs, 'existsSync').callsFake((p) => p.includes('system.slice'));
      sinon.stub(fs, 'writeFileSync').throws(new Error('Permission denied'));

      const result = cpuBurstHelper.setCpuBurst('abc123def456', 100000);
      expect(result).to.be.false;
    });
  });
});
