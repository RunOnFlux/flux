/* eslint-disable no-await-in-loop */
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const chai = require('chai');
const fsp = require('fs').promises;

const { expect } = chai;

const cpuBurstHelper = require('../../ZelBack/src/services/utils/cpuBurstHelper');

// Real-host integration test for CFS burst. Requires:
//   - cgroups v2 (/sys/fs/cgroup/cgroup.controllers exists)
//   - kernel >= 5.14
//   - docker reachable from this process (via dockerode default socket)
// On any host that doesn't satisfy all three, the entire suite self-skips.
//
// What it proves end-to-end:
//   1. cpuBurstHelper.calculateBurstParams produces a kernel-valid burst value
//      (burst <= quota — verified empirically by writing it without EINVAL)
//   2. cpuBurstHelper.setCpuBurst writes the cpu.max.burst cgroup file
//   3. cpuBurstHelper.isBurstActive reads it back as ground truth
//   4. The whole path works on a real container that was started via NanoCpus
//      (Docker's high-level CPU API), not by setting CpuPeriod/CpuQuota directly

describe('cpuBurstHelper integration (real container, real cgroup)', function integrationSuite() {
  this.timeout(30000);

  let docker;
  let container;
  let pid;
  let supported = false;

  before(async function checkPreconditions() {
    cpuBurstHelper.resetBurstSupportCache();
    supported = await cpuBurstHelper.isCpuBurstSupported();
    if (!supported) {
      this.skip();
      return;
    }
    let Docker;
    try {
      // eslint-disable-next-line global-require
      Docker = require('dockerode');
    } catch {
      this.skip();
      return;
    }
    docker = new Docker();
    try {
      await docker.ping();
    } catch {
      this.skip();
    }
  });

  after(async () => {
    if (container) {
      try { await container.stop({ t: 0 }); } catch { /* ignore */ }
      try { await container.remove({ force: true }); } catch { /* ignore */ }
    }
  });

  it('creates a container with NanoCpus, applies burst, reads it back', async () => {
    if (!supported || !docker) return;

    // Pull a small image (alpine sleep — no stress dep needed for the assertion)
    await new Promise((resolve, reject) => {
      docker.pull('alpine:latest', (err, stream) => {
        if (err) return reject(err);
        return docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()));
      });
    });

    container = await docker.createContainer({
      Image: 'alpine:latest',
      name: `flux-burst-int-${Date.now()}`,
      Cmd: ['sleep', '60'],
      HostConfig: {
        // 2 cores via NanoCpus (the same path real flux apps now use)
        NanoCpus: 2 * 1e9,
      },
    });
    await container.start();

    const inspect = await container.inspect();
    pid = inspect.State?.Pid;
    expect(pid).to.be.a('number').and.greaterThan(0);

    // Sanity: HostConfig should show NanoCpus, not CpuPeriod/CpuQuota
    expect(inspect.HostConfig.NanoCpus).to.equal(2 * 1e9);

    // calculateBurstParams should produce burst==quota for 2 cores
    const params = cpuBurstHelper.calculateBurstParams(2);
    expect(params.quotaUs).to.equal(200000);
    expect(params.burstUs).to.equal(200000);

    // Apply burst via the helper
    const ok = await cpuBurstHelper.setCpuBurst(pid, params.burstUs);
    expect(ok).to.be.true;

    // Read ground truth via isBurstActive
    const active = await cpuBurstHelper.isBurstActive(pid);
    expect(active).to.be.true;

    // Read the cgroup file directly to confirm the exact value
    const burstPath = await cpuBurstHelper.getCgroupBurstPath(pid);
    expect(burstPath).to.be.a('string');
    const raw = await fsp.readFile(burstPath, 'utf8');
    expect(parseInt(raw.trim(), 10)).to.equal(200000);
  });

  it('rejects burst values above quota (kernel rule burst <= quota)', async () => {
    if (!supported || !docker || !pid) return;

    // Empirical: writing burst > quota returns EINVAL on Linux 5.14+
    const ok = await cpuBurstHelper.setCpuBurst(pid, 200001);
    expect(ok).to.be.false;

    // The previous valid value should still be in place
    const active = await cpuBurstHelper.isBurstActive(pid);
    expect(active).to.be.true;
  });
});
