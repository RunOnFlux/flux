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

  // The cpu count is chosen at 2 because it's the smallest value that produces
  // distinguishable quota/burst numbers and a meaningful round-trip. We do NOT
  // hard-code expected burst values here — we ask the helper what it computed
  // and assert the cgroup file matches that, so the test stays correct
  // regardless of host size and regardless of whether the per-container
  // fairness cap binds (the cap can produce burstUs < quotaUs on small hosts,
  // burstUs == 0 on very small hosts).
  const TEST_CPU_CORES = 2;

  it('round-trips: helper computes burst, kernel accepts it, cgroup reflects it', async () => {
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
        // NanoCpus is the same path real flux apps now use post-#1714
        NanoCpus: TEST_CPU_CORES * 1e9,
      },
    });
    await container.start();

    const inspect = await container.inspect();
    pid = inspect.State?.Pid;
    expect(pid).to.be.a('number').and.greaterThan(0);
    expect(inspect.HostConfig.NanoCpus).to.equal(TEST_CPU_CORES * 1e9);

    // Ask the helper what it computed for this cpu on this host. We assert
    // the round-trip against THIS value, not against a magic number.
    const params = cpuBurstHelper.calculateBurstParams(TEST_CPU_CORES);
    expect(params.quotaUs).to.equal(TEST_CPU_CORES * params.periodUs);
    expect(params.burstUs).to.be.at.most(params.quotaUs); // kernel rule

    // Apply burst via the helper. setCpuBurst writes whatever value we pass;
    // even burstUs === 0 is a valid (no-op) write.
    const ok = await cpuBurstHelper.setCpuBurst(pid, params.burstUs);
    expect(ok).to.be.true;

    // Read the cgroup file directly and confirm it matches what the helper
    // told us — this is the actual round-trip assertion.
    const burstPath = await cpuBurstHelper.getCgroupBurstPath(pid);
    expect(burstPath).to.be.a('string');
    const raw = await fsp.readFile(burstPath, 'utf8');
    expect(parseInt(raw.trim(), 10)).to.equal(params.burstUs);

    // isBurstActive's contract: true iff cpu.max.burst > 0
    const active = await cpuBurstHelper.isBurstActive(pid);
    expect(active).to.equal(params.burstUs > 0);
  });

  it('rejects burst values above quota (kernel rule burst <= quota)', async () => {
    if (!supported || !docker || !pid) return;

    // Establish a known-good baseline first, so this test doesn't depend on
    // whatever state the previous test left behind. Use the helper's own
    // computed value (which is always within kernel rule + host cap).
    const params = cpuBurstHelper.calculateBurstParams(TEST_CPU_CORES);
    if (params.burstUs === 0) {
      // Host is too small for burst at this cpu count. There is no
      // "valid burst" baseline to compare against, so skip the rejection
      // check — the kernel-rule path is exercised on larger hosts.
      return;
    }
    const baseline = await cpuBurstHelper.setCpuBurst(pid, params.burstUs);
    expect(baseline).to.be.true;

    // Now try to write a value strictly above the kernel rule (quota+1us).
    // The kernel must reject with EINVAL regardless of host size.
    const aboveQuota = params.quotaUs + 1;
    const ok = await cpuBurstHelper.setCpuBurst(pid, aboveQuota);
    expect(ok).to.be.false;

    // The baseline should still be in place — the failed write must not
    // have corrupted state.
    const burstPath = await cpuBurstHelper.getCgroupBurstPath(pid);
    const raw = await fsp.readFile(burstPath, 'utf8');
    expect(parseInt(raw.trim(), 10)).to.equal(params.burstUs);
  });
});
