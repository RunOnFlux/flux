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
    // Stub os.cpus() so the host-fairness cap is deterministic across CI hosts.
    // Default to 32 cores (well above any tier) so basic tests are uncapped.
    beforeEach(() => {
      sinon.stub(os, 'cpus').returns(new Array(32).fill({ model: 'stub', speed: 2400 }));
    });

    it('should calculate correct params for 1 CPU core (uncapped)', () => {
      const params = cpuBurstHelper.calculateBurstParams(1);
      expect(params.periodUs).to.equal(100000);
      expect(params.quotaUs).to.equal(100000);
      expect(params.burstUs).to.equal(100000); // == quota
    });

    it('should calculate correct params for 2.5 CPU cores (uncapped)', () => {
      const params = cpuBurstHelper.calculateBurstParams(2.5);
      expect(params.quotaUs).to.equal(250000);
      expect(params.burstUs).to.equal(250000);
    });

    it('should handle fractional CPU values', () => {
      const params = cpuBurstHelper.calculateBurstParams(0.5);
      expect(params.quotaUs).to.equal(50000);
      expect(params.burstUs).to.equal(50000);
    });

    it('burstUs equals quotaUs when host has plenty of headroom', () => {
      // 32-core host, reservedCores=1 → max peak = 31 cores. Anything ≤ 15 uncapped.
      [0.5, 1, 2, 4, 8, 15].forEach((cores) => {
        const params = cpuBurstHelper.calculateBurstParams(cores);
        expect(params.burstUs, `cores=${cores}`).to.equal(params.quotaUs);
      });
    });

    describe('host-fairness cap (peak <= hostCpus - reservedCores)', () => {
      it('cumulus (4 cores, reserved=1): 1-core app gets burst=100000, peak=2', () => {
        os.cpus.returns(new Array(4).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(1);
        expect(params.quotaUs).to.equal(100000);
        expect(params.burstUs).to.equal(100000); // not capped
      });

      it('cumulus (4 cores, reserved=1): 2-core app gets burst=100000, peak=3', () => {
        os.cpus.returns(new Array(4).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(2);
        expect(params.quotaUs).to.equal(200000);
        expect(params.burstUs).to.equal(100000); // capped: maxPeak=300000, maxBurst=100000
      });

      it('cumulus (4 cores, reserved=1): 3-core app gets burst=0 (peak already at limit)', () => {
        os.cpus.returns(new Array(4).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(3);
        expect(params.quotaUs).to.equal(300000);
        expect(params.burstUs).to.equal(0);
      });

      it('nimbus (8 cores, reserved=1): 4-core app gets burst=300000, peak=7', () => {
        os.cpus.returns(new Array(8).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(4);
        expect(params.quotaUs).to.equal(400000);
        expect(params.burstUs).to.equal(300000); // capped: maxPeak=700000, maxBurst=300000
      });

      it('nimbus (8 cores, reserved=1): 7-core app gets burst=0', () => {
        os.cpus.returns(new Array(8).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(7);
        expect(params.burstUs).to.equal(0);
      });

      it('stratus (16 cores, reserved=1): 7-core app uncapped, burst=quota=700000', () => {
        os.cpus.returns(new Array(16).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(7);
        expect(params.quotaUs).to.equal(700000);
        expect(params.burstUs).to.equal(700000);
      });

      it('stratus (16 cores, reserved=1): 8-core app capped, burst=700000, peak=15', () => {
        os.cpus.returns(new Array(16).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(8);
        expect(params.quotaUs).to.equal(800000);
        expect(params.burstUs).to.equal(700000); // capped
      });

      it('stratus (16 cores, reserved=1): 12-core app capped, burst=300000, peak=15', () => {
        os.cpus.returns(new Array(16).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(12);
        expect(params.quotaUs).to.equal(1200000);
        expect(params.burstUs).to.equal(300000); // capped
      });

      it('stratus (16 cores, reserved=1): 15-core app gets burst=0', () => {
        os.cpus.returns(new Array(16).fill({ model: 'stub', speed: 2400 }));
        const params = cpuBurstHelper.calculateBurstParams(15);
        expect(params.quotaUs).to.equal(1500000);
        expect(params.burstUs).to.equal(0);
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

    it('should write burstUs equal to quotaUs when supported and uncapped', async () => {
      // Stub a 32-core host so the per-container fairness cap doesn't bind
      sinon.stub(os, 'cpus').returns(new Array(32).fill({ model: 'stub', speed: 2400 }));
      const accessStub = sinon.stub(fs.promises, 'access').resolves();
      const readStub = sinon.stub(fs.promises, 'readFile');
      readStub.withArgs('/proc/version').resolves('Linux version 6.1.0-generic');
      readStub.withArgs('/proc/12345/cgroup').resolves('0::/system.slice/docker-x.scope\n');
      const writeStub = sinon.stub(fs.promises, 'writeFile').resolves();
      cpuBurstHelper.resetBurstSupportCache();

      const result = await cpuBurstHelper.applyBurst(12345, 2.0, 'test-app');
      expect(result).to.be.true;
      expect(writeStub.calledOnce).to.be.true;
      // 2 cores * 100000 periodUs = 200000 quotaUs; uncapped on a 32-core host
      expect(writeStub.firstCall.args[1]).to.equal('200000');
      expect(accessStub.called).to.be.true;
    });
  });
});
