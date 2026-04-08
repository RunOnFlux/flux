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
    // burstUs is always equal to quotaUs (kernel rule: burst <= quota), and there
    // is no operational reason to set it lower. The function is now a trivial
    // unit-converter from "fractional cores" to "{periodUs, quotaUs, burstUs}".

    it('should calculate correct params for 1 CPU core', () => {
      const params = cpuBurstHelper.calculateBurstParams(1);
      expect(params.periodUs).to.equal(100000);
      expect(params.quotaUs).to.equal(100000);
      expect(params.burstUs).to.equal(100000);
    });

    it('should calculate correct params for 2 CPU cores', () => {
      const params = cpuBurstHelper.calculateBurstParams(2);
      expect(params.periodUs).to.equal(100000);
      expect(params.quotaUs).to.equal(200000);
      expect(params.burstUs).to.equal(200000);
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

    it('burstUs should always equal quotaUs (kernel rule burst <= quota)', () => {
      [0.1, 0.5, 1, 2, 4, 8, 16, 32].forEach((cores) => {
        const params = cpuBurstHelper.calculateBurstParams(cores);
        expect(params.burstUs).to.equal(params.quotaUs);
      });
    });
  });

  describe('isCpuBurstSupported', () => {
    it('should return false when burst config is disabled', async () => {
      sinon.stub(config, 'cpuBurst').value({ enabled: false, periodUs: 100000 });
      cpuBurstHelper.resetBurstSupportCache();

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
      // readFile called once for kernel version (cached after that)
      expect(readStub.callCount).to.equal(1);
    });
  });

  describe('getCgroupBurstPath', () => {
    it('should resolve cpu.max.burst path from /proc/<pid>/cgroup', async () => {
      const pid = 12345;
      const cgroupContent = '0::/system.slice/docker-abc123def456.scope\n';
      sinon.stub(fs.promises, 'readFile').callsFake((p) => {
        if (p === `/proc/${pid}/cgroup`) return Promise.resolve(cgroupContent);
        return Promise.reject(new Error('ENOENT'));
      });
      sinon.stub(fs.promises, 'access').resolves();

      const result = await cpuBurstHelper.getCgroupBurstPath(pid);
      expect(result).to.equal('/sys/fs/cgroup/system.slice/docker-abc123def456.scope/cpu.max.burst');
    });

    it('should return null when /proc/<pid>/cgroup cannot be read', async () => {
      sinon.stub(fs.promises, 'readFile').rejects(new Error('ENOENT'));

      const result = await cpuBurstHelper.getCgroupBurstPath(99999);
      expect(result).to.be.null;
    });

    it('should return null when cgroup file does not contain a v2 entry', async () => {
      sinon.stub(fs.promises, 'readFile').resolves('1:cpu:/something/v1/style\n');

      const result = await cpuBurstHelper.getCgroupBurstPath(12345);
      expect(result).to.be.null;
    });

    it('should return null when cpu.max.burst file does not exist', async () => {
      sinon.stub(fs.promises, 'readFile').resolves('0::/some/path\n');
      sinon.stub(fs.promises, 'access').rejects(new Error('ENOENT'));

      const result = await cpuBurstHelper.getCgroupBurstPath(12345);
      expect(result).to.be.null;
    });
  });

  describe('setCpuBurst', () => {
    it('should write burst value to cgroup file', async () => {
      sinon.stub(fs.promises, 'readFile').resolves('0::/system.slice/docker-x.scope\n');
      sinon.stub(fs.promises, 'access').resolves();
      const writeStub = sinon.stub(fs.promises, 'writeFile').resolves();

      const result = await cpuBurstHelper.setCpuBurst(12345, 200000);
      expect(result).to.be.true;
      expect(writeStub.calledOnce).to.be.true;
      expect(writeStub.firstCall.args[1]).to.equal('200000');
    });

    it('should return false when cgroup path not found', async () => {
      sinon.stub(fs.promises, 'readFile').rejects(new Error('ENOENT'));

      const result = await cpuBurstHelper.setCpuBurst(99999, 200000);
      expect(result).to.be.false;
    });

    it('should return false when write fails', async () => {
      sinon.stub(fs.promises, 'readFile').resolves('0::/system.slice/docker-x.scope\n');
      sinon.stub(fs.promises, 'access').resolves();
      sinon.stub(fs.promises, 'writeFile').rejects(new Error('EINVAL'));

      const result = await cpuBurstHelper.setCpuBurst(12345, 200000);
      expect(result).to.be.false;
    });
  });

  describe('isBurstActive', () => {
    it('should return true when cpu.max.burst > 0', async () => {
      const readStub = sinon.stub(fs.promises, 'readFile');
      readStub.withArgs('/proc/12345/cgroup').resolves('0::/system.slice/docker-x.scope\n');
      readStub.withArgs('/sys/fs/cgroup/system.slice/docker-x.scope/cpu.max.burst').resolves('200000\n');
      sinon.stub(fs.promises, 'access').resolves();

      const result = await cpuBurstHelper.isBurstActive(12345);
      expect(result).to.be.true;
    });

    it('should return false when cpu.max.burst is 0', async () => {
      const readStub = sinon.stub(fs.promises, 'readFile');
      readStub.withArgs('/proc/12345/cgroup').resolves('0::/system.slice/docker-x.scope\n');
      readStub.withArgs('/sys/fs/cgroup/system.slice/docker-x.scope/cpu.max.burst').resolves('0\n');
      sinon.stub(fs.promises, 'access').resolves();

      const result = await cpuBurstHelper.isBurstActive(12345);
      expect(result).to.be.false;
    });

    it('should return false when cgroup path cannot be resolved', async () => {
      sinon.stub(fs.promises, 'readFile').rejects(new Error('ENOENT'));

      const result = await cpuBurstHelper.isBurstActive(99999);
      expect(result).to.be.false;
    });

    it('should return false on null/undefined pid', async () => {
      expect(await cpuBurstHelper.isBurstActive(null)).to.be.false;
      expect(await cpuBurstHelper.isBurstActive(undefined)).to.be.false;
    });
  });

  describe('applyBurst', () => {
    it('should return false when cpuCores is 0', async () => {
      const result = await cpuBurstHelper.applyBurst(12345, 0);
      expect(result).to.be.false;
    });

    it('should return false when isCpuBurstSupported is false', async () => {
      sinon.stub(fs.promises, 'access').rejects(new Error('ENOENT'));
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.applyBurst(12345, 2.0);
      expect(result).to.be.false;
    });

    it('should write burstUs equal to quotaUs when supported', async () => {
      const accessStub = sinon.stub(fs.promises, 'access').resolves();
      const readStub = sinon.stub(fs.promises, 'readFile');
      readStub.withArgs('/proc/version').resolves('Linux version 6.1.0-generic');
      readStub.withArgs('/proc/12345/cgroup').resolves('0::/system.slice/docker-x.scope\n');
      const writeStub = sinon.stub(fs.promises, 'writeFile').resolves();
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.applyBurst(12345, 2.0, 'test-app');
      expect(result).to.be.true;
      expect(writeStub.calledOnce).to.be.true;
      // 2 cores * 100000 periodUs = 200000 quotaUs == burstUs
      expect(writeStub.firstCall.args[1]).to.equal('200000');
      // sanity: access was called for cgroup-v2 marker and the burst path
      expect(accessStub.called).to.be.true;
    });
  });
});
