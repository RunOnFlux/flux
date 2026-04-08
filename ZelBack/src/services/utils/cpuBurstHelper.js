const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const config = require('config');
const log = require('../../lib/log');

let burstSupportCache = null;

/**
 * Checks if an app owner is in the enterprise app owners whitelist.
 * @param {string} owner - The app owner address
 * @returns {boolean}
 */
function isEnterpriseOwner(owner) {
  const enterpriseAppOwners = config.enterpriseAppOwners || [];
  return enterpriseAppOwners.includes(owner);
}

/**
 * Checks if the system supports CFS CPU burst (cgroups v2 + kernel >= 5.14).
 * Caches the result after first check.
 * @returns {Promise<boolean>}
 */
async function isCpuBurstSupported() {
  if (burstSupportCache !== null) return burstSupportCache;

  try {
    if (!config.cpuBurst?.enabled) {
      burstSupportCache = false;
      return false;
    }

    // Check cgroups v2: /sys/fs/cgroup/cgroup.controllers must exist
    try {
      await fsp.access('/sys/fs/cgroup/cgroup.controllers');
    } catch {
      log.warn('CPU burst: cgroups v2 not detected, burst disabled');
      burstSupportCache = false;
      return false;
    }

    // Check kernel version >= 5.14 for cpu.cfs_burst_us support
    const release = await fsp.readFile('/proc/version', 'utf8');
    const match = release.match(/(\d+)\.(\d+)/);
    if (!match) {
      log.warn('CPU burst: unable to parse kernel version, burst disabled');
      burstSupportCache = false;
      return false;
    }
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    if (major < 5 || (major === 5 && minor < 14)) {
      log.warn(`CPU burst: kernel ${major}.${minor} < 5.14, burst disabled`);
      burstSupportCache = false;
      return false;
    }

    burstSupportCache = true;
    log.info('CPU burst: system supports CFS burst (cgroups v2, kernel >= 5.14)');
    return true;
  } catch (error) {
    log.warn(`CPU burst: capability check failed: ${error.message}`);
    burstSupportCache = false;
    return false;
  }
}

/**
 * Resolves the cpu.max.burst cgroup file path for a running container by
 * reading /proc/<pid>/cgroup. Works regardless of cgroup driver, container
 * runtime, or systemd integration.
 * @param {number|string} pid - The container's main process pid
 * @returns {Promise<string|null>} Path to cpu.max.burst, or null if not resolvable
 */
async function getCgroupBurstPath(pid) {
  try {
    const data = await fsp.readFile(`/proc/${pid}/cgroup`, 'utf8');
    // cgroup v2 format: a single line "0::<path>"
    const match = data.match(/^0::(.+)$/m);
    if (!match) return null;
    const burstPath = path.join('/sys/fs/cgroup', match[1].trim(), 'cpu.max.burst');
    await fsp.access(burstPath);
    return burstPath;
  } catch {
    return null;
  }
}

/**
 * Calculates CpuPeriod, CpuQuota, and burst value for a given CPU spec.
 *
 * Two constraints govern the result:
 *   1. Kernel rule: 0 <= burst <= quota (cgroup-v2 docs: cpu.max.burst range
 *      is [0, $quota]). We start at the kernel maximum (burst == quota) since
 *      burst is "free" headroom that only fires when banked idle time exists.
 *   2. Host fairness: a single container's peak (quota + burst) must not
 *      exceed (hostCpus - reservedCores) * period, leaving at least
 *      `reservedCores` worth of CPU-time per period for system services
 *      (systemd, fluxos itself, sshd, monitoring). This caps the burst per
 *      container so big apps degrade gracefully — a 12-core app on a stratus
 *      (16-core) host with reservedCores=1 gets quota=12, burst=3, peak=15.
 *      A 15-core app gets burst=0 and runs without burst entirely.
 *
 * Note: this is a per-container cap, not a host-aggregate budget. Multiple
 * burst-eligible containers on the same host can collectively oversubscribe
 * the host during simultaneous bursts; the kernel CFS scheduler handles
 * contention proportionally. See the burst design notes for the rationale.
 *
 * @param {number} cpuCores - CPU allocation from app spec (e.g. 2.5 means 2.5 cores)
 * @returns {{ periodUs: number, quotaUs: number, burstUs: number }}
 */
function calculateBurstParams(cpuCores) {
  const periodUs = config.cpuBurst?.periodUs ?? 100000;
  const reservedCores = config.cpuBurst?.reservedCores ?? 1;
  const quotaUs = Math.round(cpuCores * periodUs);

  // Start at the kernel maximum (burst == quota)
  let burstUs = quotaUs;

  // Cap so peak (quota + burst) leaves at least reservedCores free for the host
  const hostCpus = os.cpus().length;
  const maxPeakUs = Math.max(0, hostCpus - reservedCores) * periodUs;
  const maxBurstUs = Math.max(0, maxPeakUs - quotaUs);
  if (burstUs > maxBurstUs) {
    log.info(`CPU burst: capping burstUs from ${burstUs} to ${maxBurstUs} (cpu=${cpuCores}, hostCpus=${hostCpus}, reservedCores=${reservedCores})`);
    burstUs = maxBurstUs;
  }

  return { periodUs, quotaUs, burstUs };
}

/**
 * Writes the CFS burst value to a running container's cgroup.
 * @param {number|string} pid - The container's main process pid
 * @param {number} burstUs - Burst value in microseconds
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function setCpuBurst(pid, burstUs) {
  try {
    const burstPath = await getCgroupBurstPath(pid);
    if (!burstPath) {
      log.warn(`CPU burst: cgroup burst path not found for pid ${pid}`);
      return false;
    }
    await fsp.writeFile(burstPath, burstUs.toString());
    log.info(`CPU burst: set ${burstUs}us for pid ${pid}`);
    return true;
  } catch (error) {
    log.warn(`CPU burst: failed to set burst for pid ${pid}: ${error.message}`);
    return false;
  }
}

/**
 * Reads ground-truth burst state for a running container directly from the
 * cgroup. This is the only authoritative answer to "is burst applied to this
 * container right now". Used by the throttle loop to gate its bypass.
 * @param {number|string} pid - The container's main process pid
 * @returns {Promise<boolean>} true if cpu.max.burst > 0
 */
async function isBurstActive(pid) {
  try {
    const burstPath = await getCgroupBurstPath(pid);
    if (!burstPath) return false;
    const value = await fsp.readFile(burstPath, 'utf8');
    return parseInt(value.trim(), 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Applies CFS burst to a running container. Idempotent — safe to call on every
 * start of an enterprise container. Logs loudly on failure so the operator can
 * see that an enterprise container is running without its expected burst.
 * @param {number|string} pid - The container's main process pid
 * @param {number} cpuCores - CPU allocation from app spec
 * @param {string} [identifier] - Optional name for log lines
 * @returns {Promise<boolean>} true if burst was successfully applied
 */
async function applyBurst(pid, cpuCores, identifier) {
  if (!cpuCores || cpuCores <= 0) return false;
  if (!await isCpuBurstSupported()) return false;

  const { burstUs } = calculateBurstParams(cpuCores);
  const ok = await setCpuBurst(pid, burstUs);
  if (!ok) {
    log.error(
      `CPU burst: REQUESTED but FAILED for ${identifier || `pid ${pid}`} `
      + '— enterprise app will run without burst capability',
    );
  }
  return ok;
}

/**
 * Resets the burst support cache. Used in testing.
 */
function resetBurstSupportCache() {
  burstSupportCache = null;
}

module.exports = {
  isEnterpriseOwner,
  isCpuBurstSupported,
  getCgroupBurstPath,
  calculateBurstParams,
  setCpuBurst,
  isBurstActive,
  applyBurst,
  resetBurstSupportCache,
};
