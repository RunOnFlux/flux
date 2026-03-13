const fsp = require('fs').promises;
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
    const burstConfig = config.cpuBurst || {};
    if (!burstConfig.enabled) {
      burstSupportCache = false;
      return false;
    }

    // Check cgroups v2: /sys/fs/cgroup/cgroup.controllers must exist
    const cgroupV2Marker = '/sys/fs/cgroup/cgroup.controllers';
    try {
      await fsp.access(cgroupV2Marker);
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
 * Resolves the cgroup cpu.max.burst path for a Docker container.
 * Tries common systemd-based cgroup v2 paths.
 * @param {string} containerId - Full Docker container ID
 * @returns {string|null} Path to cpu.max.burst or null if not found
 */
async function getCgroupBurstPath(containerId) {
  const candidates = [
    path.join('/sys/fs/cgroup/system.slice', `docker-${containerId}.scope`, 'cpu.max.burst'),
    path.join('/sys/fs/cgroup/docker', containerId, 'cpu.max.burst'),
  ];

  for (const candidate of candidates) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {
      // continue to next candidate
    }
  }
  return null;
}

/**
 * Calculates CpuPeriod, CpuQuota, and burst value for a given CPU spec.
 * @param {number} cpuCores - CPU allocation from app spec (e.g. 2.5 means 2.5 cores)
 * @returns {{ periodUs: number, quotaUs: number, burstUs: number }}
 */
function calculateBurstParams(cpuCores) {
  const burstConfig = config.cpuBurst || {};
  const periodUs = burstConfig.periodUs || 100000;
  const burstMultiplier = burstConfig.burstMultiplier || 2.0;

  const quotaUs = Math.round(cpuCores * periodUs);
  const burstUs = Math.round(quotaUs * (burstMultiplier - 1));

  return { periodUs, quotaUs, burstUs };
}

/**
 * Sets the CFS burst value for a Docker container via cgroup v2 filesystem.
 * @param {string} containerId - Full Docker container ID
 * @param {number} burstUs - Burst value in microseconds
 * @returns {boolean} true if burst was set, false on failure
 */
async function setCpuBurst(containerId, burstUs) {
  try {
    const burstPath = await getCgroupBurstPath(containerId);
    if (!burstPath) {
      log.warn(`CPU burst: cgroup burst path not found for container ${containerId.substring(0, 12)}`);
      return false;
    }

    await fsp.writeFile(burstPath, burstUs.toString());
    log.info(`CPU burst: set ${burstUs}us for container ${containerId.substring(0, 12)}`);
    return true;
  } catch (error) {
    log.warn(`CPU burst: failed to set burst for container ${containerId.substring(0, 12)}: ${error.message}`);
    return false;
  }
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
  resetBurstSupportCache,
};
