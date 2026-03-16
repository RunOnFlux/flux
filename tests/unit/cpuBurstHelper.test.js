process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const chai = require('chai');
const sinon = require('sinon');
const os = require('os');
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
    // Stub os.cpus() to return 32 cores so burst is uncapped in basic tests
    let cpusStub;
    beforeEach(() => {
      cpusStub = sinon.stub(os, 'cpus').returns(new Array(32).fill({ model: 'stub', speed: 2400 }));
    });

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

    it('should cap burst so peak does not exceed (hostCpus - reservedCores)', () => {
      // 4-core host, reservedCores=1, app requests 2.5 cores (multiplier 2x)
      // Uncapped burstUs = 250000, but peak would be 5 cores > 3 allowed
      // maxPeakUs = (4 - 1) * 100000 = 300000, maxBurstUs = 300000 - 250000 = 50000
      cpusStub.returns(new Array(4).fill({ model: 'stub', speed: 2400 }));
      const params = cpuBurstHelper.calculateBurstParams(2.5);
      expect(params.quotaUs).to.equal(250000);
      expect(params.burstUs).to.equal(50000);
    });

    it('should set burst to 0 when quota already exceeds host capacity minus reserved', () => {
      // 2-core host, reservedCores=1, app requests 2 cores
      // maxPeakUs = (2 - 1) * 100000 = 100000, quotaUs = 200000 => maxBurstUs = 0
      cpusStub.returns(new Array(2).fill({ model: 'stub', speed: 2400 }));
      const params = cpuBurstHelper.calculateBurstParams(2);
      expect(params.quotaUs).to.equal(200000);
      expect(params.burstUs).to.equal(0);
    });

    it('should not cap burst when host has plenty of cores', () => {
      cpusStub.returns(new Array(16).fill({ model: 'stub', speed: 2400 }));
      const params = cpuBurstHelper.calculateBurstParams(2.5);
      expect(params.burstUs).to.equal(250000); // uncapped
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
      sinon.stub(fs.promises, 'access').rejects(new Error('ENOENT'));
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.isCpuBurstSupported();
      expect(result).to.be.false;
    });

    it('should return false for kernel < 5.14', async () => {
      sinon.stub(fs.promises, 'access').resolves();
      sinon.stub(fs.promises, 'readFile').resolves('Linux version 5.4.0-generic');
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.isCpuBurstSupported();
      expect(result).to.be.false;
    });

    it('should return true for kernel >= 5.14 with cgroups v2', async () => {
      sinon.stub(fs.promises, 'access').resolves();
      sinon.stub(fs.promises, 'readFile').resolves('Linux version 6.1.0-generic');
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.isCpuBurstSupported();
      expect(result).to.be.true;
    });

    it('should cache the result on subsequent calls', async () => {
      sinon.stub(fs.promises, 'access').resolves();
      const readStub = sinon.stub(fs.promises, 'readFile').resolves('Linux version 6.1.0-generic');
      cpuBurstHelper.resetBurstSupportCache();

      await cpuBurstHelper.isCpuBurstSupported();
      await cpuBurstHelper.isCpuBurstSupported();
      // access called once for cgroup check, readFile called once for kernel
      expect(readStub.callCount).to.equal(1);
    });
  });

  describe('getCgroupBurstPath', () => {
    it('should return systemd cgroup path when it exists', async () => {
      const containerId = 'abc123def456';
      sinon.stub(fs.promises, 'access').callsFake((p) => {
        if (p.includes('system.slice')) return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await cpuBurstHelper.getCgroupBurstPath(containerId);
      expect(result).to.include('system.slice');
      expect(result).to.include(containerId);
      expect(result).to.include('cpu.max.burst');
    });

    it('should return docker cgroup path as fallback', async () => {
      const containerId = 'abc123def456';
      sinon.stub(fs.promises, 'access').callsFake((p) => {
        if (p.includes('/docker/')) return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await cpuBurstHelper.getCgroupBurstPath(containerId);
      expect(result).to.include('/docker/');
      expect(result).to.include(containerId);
    });

    it('should return null when no cgroup path exists', async () => {
      sinon.stub(fs.promises, 'access').rejects(new Error('ENOENT'));

      const result = await cpuBurstHelper.getCgroupBurstPath('abc123');
      expect(result).to.be.null;
    });
  });

  describe('setCpuBurst', () => {
    it('should write burst value to cgroup file', async () => {
      const containerId = 'abc123def456789012345678901234567890123456789012345678901234abcd';
      sinon.stub(fs.promises, 'access').callsFake((p) => {
        if (p.includes('system.slice')) return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });
      const writeStub = sinon.stub(fs.promises, 'writeFile').resolves();

      const result = await cpuBurstHelper.setCpuBurst(containerId, 100000);
      expect(result).to.be.true;
      expect(writeStub.calledOnce).to.be.true;
      expect(writeStub.firstCall.args[1]).to.equal('100000');
    });

    it('should return false when cgroup path not found', async () => {
      sinon.stub(fs.promises, 'access').rejects(new Error('ENOENT'));

      const result = await cpuBurstHelper.setCpuBurst('abc123', 100000);
      expect(result).to.be.false;
    });

    it('should return false when write fails', async () => {
      sinon.stub(fs.promises, 'access').callsFake((p) => {
        if (p.includes('system.slice')) return Promise.resolve();
        return Promise.reject(new Error('ENOENT'));
      });
      sinon.stub(fs.promises, 'writeFile').rejects(new Error('Permission denied'));

      const result = await cpuBurstHelper.setCpuBurst('abc123def456', 100000);
      expect(result).to.be.false;
    });
  });
});
