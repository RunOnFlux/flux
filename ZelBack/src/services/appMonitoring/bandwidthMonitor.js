const util = require('util');
const nodecmd = require('node-cmd');

const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const benchmarkService = require('../benchmarkService');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');

const cmdAsync = util.promisify(nodecmd.run);

// Bandwidth throttle state - tracks which apps are currently throttled
// Structure: { containerName: { throttleLevel: 0.8, vethInterface: 'veth123', appliedAt: timestamp } }
const appsBandwidthThrottled = {};

// Track bandwidth violations for progressive throttling
// Structure: { containerName: { violationCount: 0, lastViolationTime: timestamp } }
const bandwidthViolations = {};

// Node tier bandwidth limits in Mbps (minimum requirements)
// These are fallbacks if benchmark data is not available
const TIER_MINIMUM_BANDWIDTH = {
  cumulus: 25,
  nimbus: 50,
  stratus: 100,
};

// Reserve 20% of bandwidth for system operations (P2P, sync, etc.)
const SYSTEM_BANDWIDTH_RESERVE_PERCENT = 0.20;

// Throttle levels for progressive throttling (percentage of fair share)
const THROTTLE_LEVELS = [1.0, 0.95, 0.90, 0.85, 0.80];

// Threshold: if app uses more than this percentage of fair share, it's considered abusing
const BANDWIDTH_ABUSE_THRESHOLD = 0.95;

// Percentage of samples that must exceed threshold to trigger throttling
const ABUSE_SAMPLE_THRESHOLD = 0.80;

// Minimum samples required for bandwidth analysis
const MIN_SAMPLES_FOR_ANALYSIS = 4;

// Time to wait before removing throttle after good behavior (30 minutes)
const THROTTLE_RECOVERY_TIME = 30 * 60 * 1000;

// Reasonable bandwidth limits for validation (in Mbps)
const MIN_VALID_BANDWIDTH = 1;
const MAX_VALID_BANDWIDTH = 10000;

/**
 * Validate and sanitize bandwidth value
 * @param {number} value - Bandwidth value in Mbps
 * @param {number} fallback - Fallback value if invalid
 * @returns {number} Valid bandwidth value
 */
function validateBandwidth(value, fallback) {
  const num = parseFloat(value);
  if (Number.isNaN(num) || num < MIN_VALID_BANDWIDTH || num > MAX_VALID_BANDWIDTH) {
    log.warn(`Invalid bandwidth value: ${value}, using fallback: ${fallback} Mbps`);
    return fallback;
  }
  return num;
}

/**
 * Get the node's actual bandwidth from benchmark results
 * Falls back to tier minimums if benchmark data is unavailable
 * @returns {Promise<{download: number, upload: number}>} Bandwidth in Mbps
 */
async function getNodeBandwidth() {
  try {
    const benchmarkData = await benchmarkService.getBenchmarkFromDb();
    if (benchmarkData && benchmarkData.benchmark) {
      const { download_speed: download, upload_speed: upload } = benchmarkData.benchmark;
      if (download && upload) {
        // eslint-disable-next-line global-require
        const generalService = require('../generalService');
        const tier = await generalService.getNewNodeTier();
        const tierMin = TIER_MINIMUM_BANDWIDTH[tier] || TIER_MINIMUM_BANDWIDTH.cumulus;

        // Validate benchmark values, fallback to tier minimum if invalid
        const validDownload = validateBandwidth(download, tierMin);
        const validUpload = validateBandwidth(upload, tierMin);

        return {
          download: validDownload,
          upload: validUpload,
        };
      }
    }

    // Fallback to tier minimums
    // eslint-disable-next-line global-require
    const generalService = require('../generalService');
    const tier = await generalService.getNewNodeTier();
    const minBandwidth = TIER_MINIMUM_BANDWIDTH[tier] || TIER_MINIMUM_BANDWIDTH.cumulus;

    return {
      download: minBandwidth,
      upload: minBandwidth,
    };
  } catch (error) {
    log.error(`Failed to get node bandwidth: ${error.message}`);
    return {
      download: TIER_MINIMUM_BANDWIDTH.cumulus,
      upload: TIER_MINIMUM_BANDWIDTH.cumulus,
    };
  }
}

/**
 * Get the number of running app containers
 * @param {Function} installedApps - Function to get installed apps
 * @returns {Promise<number>} Number of running containers
 */
async function getRunningAppContainersCount(installedApps) {
  try {
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      return 1; // Default to 1 to avoid division by zero
    }

    let count = 0;
    // Decrypt enterprise apps (version 8 with encrypted content)
    installedAppsRes.data = await decryptEnterpriseApps(installedAppsRes.data);
    const appsInstalled = installedAppsRes.data;

    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.version <= 3) {
        count += 1;
      } else {
        // Compose apps have multiple components
        count += app.compose ? app.compose.length : 1;
      }
    }

    return Math.max(count, 1); // At least 1 to avoid division by zero
  } catch (error) {
    log.error(`Failed to get running app count: ${error.message}`);
    return 1;
  }
}

/**
 * Calculate fair share bandwidth for each app
 * @param {Function} installedApps - Function to get installed apps
 * @returns {Promise<{download: number, upload: number, total: number, runningApps: number}>} Fair share in Mbps
 */
async function getFairShareBandwidth(installedApps) {
  const nodeBandwidth = await getNodeBandwidth();
  const runningApps = await getRunningAppContainersCount(installedApps);

  // Use the lower of download/upload as the limiting factor
  const totalBandwidth = Math.min(nodeBandwidth.download, nodeBandwidth.upload);

  // Reserve bandwidth for system
  const availableForApps = totalBandwidth * (1 - SYSTEM_BANDWIDTH_RESERVE_PERCENT);

  // Fair share per app
  const fairShare = availableForApps / runningApps;

  return {
    download: fairShare,
    upload: fairShare,
    total: totalBandwidth,
    available: availableForApps,
    runningApps,
  };
}

/**
 * Calculate bandwidth usage from Docker stats samples
 * Bandwidth is calculated as (current_bytes - previous_bytes) / time_delta
 * @param {Array} statsArray - Array of stat samples with timestamp and data
 * @returns {Array<{timestamp: number, downloadMbps: number, uploadMbps: number, totalMbps: number}>}
 */
function calculateBandwidthFromStats(statsArray) {
  if (!statsArray || statsArray.length < 2) {
    return [];
  }

  const bandwidthSamples = [];

  for (let i = 1; i < statsArray.length; i += 1) {
    const current = statsArray[i];
    const previous = statsArray[i - 1];

    // Time delta in seconds
    const timeDeltaSec = (current.timestamp - previous.timestamp) / 1000;
    if (timeDeltaSec <= 0) continue;

    // Get network stats - Docker stats have networks object with interface names
    const currentNetworks = current.data.networks || {};
    const previousNetworks = previous.data.networks || {};

    let totalRxBytes = 0;
    let totalTxBytes = 0;
    let prevRxBytes = 0;
    let prevTxBytes = 0;

    // Sum up all network interfaces
    // eslint-disable-next-line no-restricted-syntax
    for (const [ifaceName, stats] of Object.entries(currentNetworks)) {
      totalRxBytes += stats.rx_bytes || 0;
      totalTxBytes += stats.tx_bytes || 0;

      if (previousNetworks[ifaceName]) {
        prevRxBytes += previousNetworks[ifaceName].rx_bytes || 0;
        prevTxBytes += previousNetworks[ifaceName].tx_bytes || 0;
      }
    }

    // Calculate bytes transferred in this interval
    const rxBytesDelta = totalRxBytes - prevRxBytes;
    const txBytesDelta = totalTxBytes - prevTxBytes;

    // Handle counter reset or container restart
    if (rxBytesDelta < 0 || txBytesDelta < 0) {
      continue;
    }

    // Convert to Mbps: bytes/sec * 8 / 1,000,000 = Mbps
    const downloadMbps = (rxBytesDelta / timeDeltaSec) * 8 / 1000000;
    const uploadMbps = (txBytesDelta / timeDeltaSec) * 8 / 1000000;

    bandwidthSamples.push({
      timestamp: current.timestamp,
      downloadMbps,
      uploadMbps,
      totalMbps: downloadMbps + uploadMbps,
    });
  }

  return bandwidthSamples;
}

/**
 * Get the veth interface for a Docker container on the host
 * @param {string} containerName - Container name or ID
 * @returns {Promise<string|null>} veth interface name or null if not found
 */
async function getContainerVethInterface(containerName) {
  try {
    // Get container's PID
    const inspect = await dockerService.dockerContainerInspect(containerName);
    if (!inspect || !inspect.State || inspect.State.Pid === undefined || inspect.State.Pid === null) {
      log.error(`Cannot get PID for container ${containerName}`);
      return null;
    }

    const containerPid = inspect.State.Pid;
    if (containerPid === 0) {
      log.warn(`Container ${containerName} is not running (PID=0)`);
      return null;
    }

    // Get the interface index from inside the container's network namespace
    // eth0@ifXX where XX is the host's veth index
    const exec = `nsenter -t ${containerPid} -n ip link show eth0 2>/dev/null | grep -oP 'eth0@if\\K[0-9]+'`;
    const result = await cmdAsync(exec);
    const ifIndex = result.trim();

    if (!ifIndex) {
      log.warn(`Cannot find interface index for container ${containerName}`);
      return null;
    }

    // Find the veth interface on the host with this index
    const hostExec = `ip link show | grep "^${ifIndex}:" | awk -F: '{print $2}' | tr -d ' '`;
    const hostResult = await cmdAsync(hostExec);
    const vethInterface = hostResult.trim();

    if (!vethInterface) {
      log.warn(`Cannot find veth interface on host for container ${containerName}`);
      return null;
    }

    return vethInterface;
  } catch (error) {
    log.error(`Failed to get veth interface for ${containerName}: ${error.message}`);
    return null;
  }
}

/**
 * Calculate appropriate burst size for tc tbf
 * Rule of thumb: burst should be at least rate * latency / 8, minimum 32kbit
 * @param {number} rateMbps - Rate in Mbps
 * @returns {string} Burst size string for tc (e.g., "128kbit")
 */
function calculateBurstSize(rateMbps) {
  // burst = rate (in bits) * latency (in seconds) / 8
  // Using 400ms latency: burst = rateMbps * 1000000 * 0.4 / 8 = rateMbps * 50000 bits
  const burstBits = Math.max(rateMbps * 50000, 32000); // Minimum 32kbit
  const burstKbit = Math.ceil(burstBits / 1000);
  return `${burstKbit}kbit`;
}

/**
 * Apply bandwidth throttle to a container using Linux tc
 * @param {string} containerName - Container name
 * @param {number} limitMbps - Bandwidth limit in Mbps
 * @returns {Promise<boolean>} Success status
 */
async function applyBandwidthThrottle(containerName, limitMbps) {
  try {
    const vethInterface = await getContainerVethInterface(containerName);
    if (!vethInterface) {
      log.error(`Cannot apply throttle to ${containerName}: veth interface not found`);
      return false;
    }

    // Convert Mbps to tc format (e.g., 20mbit)
    const rateStr = `${Math.round(limitMbps)}mbit`;
    const burstStr = calculateBurstSize(limitMbps);

    // First, remove any existing qdisc (ignore errors if none exists)
    await serviceHelper.runCommand('tc', {
      runAsRoot: true,
      params: ['qdisc', 'del', 'dev', vethInterface, 'root'],
    }).catch(() => {}); // Ignore error if no qdisc exists

    // Also remove any ingress qdisc
    await serviceHelper.runCommand('tc', {
      runAsRoot: true,
      params: ['qdisc', 'del', 'dev', vethInterface, 'ingress'],
    }).catch(() => {}); // Ignore error if no ingress qdisc exists

    // Apply Token Bucket Filter (tbf) for egress (upload from container) rate limiting
    // rate: the maximum rate
    // burst: size of the bucket (calculated based on rate)
    // latency: maximum time a packet can wait in the queue
    const egressResult = await serviceHelper.runCommand('tc', {
      runAsRoot: true,
      params: ['qdisc', 'add', 'dev', vethInterface, 'root', 'tbf',
        'rate', rateStr,
        'burst', burstStr,
        'latency', '400ms'],
    });

    if (egressResult.error) {
      log.error(`Failed to apply egress throttle to ${containerName}: ${egressResult.error.message}`);
      return false;
    }

    // Apply ingress policing for download throttling
    // This limits traffic coming INTO the veth (which is traffic going TO the container)
    const ingressResult = await serviceHelper.runCommand('tc', {
      runAsRoot: true,
      params: ['qdisc', 'add', 'dev', vethInterface, 'ingress'],
    });

    if (!ingressResult.error) {
      // Add police filter for ingress
      // Convert Mbps to bytes per second for police: Mbps * 1000000 / 8 = bytes/sec
      const rateBytesPerSec = Math.round(limitMbps * 125000); // Mbps to bytes/sec
      const burstBytes = Math.max(Math.round(rateBytesPerSec * 0.1), 10000); // 100ms worth or 10KB min

      await serviceHelper.runCommand('tc', {
        runAsRoot: true,
        params: ['filter', 'add', 'dev', vethInterface, 'parent', 'ffff:',
          'protocol', 'ip', 'prio', '1', 'u32', 'match', 'ip', 'src', '0.0.0.0/0',
          'police', 'rate', rateStr, 'burst', `${burstBytes}`, 'drop', 'flowid', ':1'],
      }).catch((err) => {
        log.warn(`Failed to apply ingress police to ${containerName}: ${err.message}`);
      });
    }

    // Track the throttle
    appsBandwidthThrottled[containerName] = {
      throttleLevel: limitMbps,
      vethInterface,
      appliedAt: Date.now(),
    };

    log.info(`Applied bandwidth throttle to ${containerName}: ${limitMbps} Mbps (egress+ingress) on ${vethInterface}`);
    return true;
  } catch (error) {
    log.error(`Error applying bandwidth throttle to ${containerName}: ${error.message}`);
    return false;
  }
}

/**
 * Remove bandwidth throttle from a container
 * @param {string} containerName - Container name
 * @returns {Promise<boolean>} Success status
 */
async function removeBandwidthThrottle(containerName) {
  try {
    const throttleInfo = appsBandwidthThrottled[containerName];
    if (!throttleInfo) {
      return true; // Not throttled
    }

    // Remove egress qdisc
    const egressResult = await serviceHelper.runCommand('tc', {
      runAsRoot: true,
      params: ['qdisc', 'del', 'dev', throttleInfo.vethInterface, 'root'],
    });

    if (egressResult.error) {
      log.warn(`Failed to remove egress throttle from ${containerName}: ${egressResult.error.message}`);
      // Still continue to try removing ingress and tracking
    }

    // Remove ingress qdisc
    await serviceHelper.runCommand('tc', {
      runAsRoot: true,
      params: ['qdisc', 'del', 'dev', throttleInfo.vethInterface, 'ingress'],
    }).catch(() => {}); // Ignore error if no ingress qdisc exists

    delete appsBandwidthThrottled[containerName];
    delete bandwidthViolations[containerName];

    log.info(`Removed bandwidth throttle from ${containerName}`);
    return true;
  } catch (error) {
    log.error(`Error removing bandwidth throttle from ${containerName}: ${error.message}`);
    return false;
  }
}

/**
 * Get current throttle level index for progressive throttling
 * @param {string} containerName - Container name
 * @returns {number} Current throttle level index (0 = no throttle, higher = more throttled)
 */
function getCurrentThrottleLevelIndex(containerName) {
  const violations = bandwidthViolations[containerName];
  if (!violations) {
    return 0;
  }
  // Cap at maximum throttle level
  return Math.min(violations.violationCount, THROTTLE_LEVELS.length - 1);
}

/**
 * Check and manage bandwidth usage for all applications
 * Progressive throttling: apps can burst briefly but get throttled if sustained high usage
 * @param {object} appsMonitored - Apps monitoring data
 * @param {Function} installedApps - Function to get installed apps
 */
async function checkApplicationsBandwidthUsage(appsMonitored, installedApps) {
  try {
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }

    // Decrypt enterprise apps (version 8 with encrypted content)
    installedAppsRes.data = await decryptEnterpriseApps(installedAppsRes.data);
    const appsInstalled = installedAppsRes.data;

    // Get fair share bandwidth
    const fairShareInfo = await getFairShareBandwidth(installedApps);
    log.info(`Bandwidth check - Total: ${fairShareInfo.total.toFixed(2)} Mbps, Available: ${fairShareInfo.available.toFixed(2)} Mbps, Fair share: ${fairShareInfo.download.toFixed(2)} Mbps, Apps: ${fairShareInfo.runningApps}`);

    const now = Date.now();

    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.version <= 3) {
        // Single container app
        // eslint-disable-next-line no-await-in-loop
        await checkContainerBandwidth(app.name, appsMonitored, fairShareInfo, now);
      } else {
        // Compose app with multiple components
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of app.compose) {
          const containerName = `${appComponent.name}_${app.name}`;
          // eslint-disable-next-line no-await-in-loop
          await checkContainerBandwidth(containerName, appsMonitored, fairShareInfo, now);
        }
      }
    }
  } catch (error) {
    log.error(`checkApplicationsBandwidthUsage error: ${error.message}`);
  }
}

/**
 * Check bandwidth for a single container and apply/remove throttling as needed
 * @param {string} containerName - Container name
 * @param {object} appsMonitored - Apps monitoring data
 * @param {object} fairShareInfo - Fair share bandwidth info
 * @param {number} now - Current timestamp
 */
async function checkContainerBandwidth(containerName, appsMonitored, fairShareInfo, now) {
  const stats = appsMonitored[containerName]?.lastHourstatsStore;

  if (!stats || stats.length < MIN_SAMPLES_FOR_ANALYSIS) {
    return; // Not enough data
  }

  // Calculate bandwidth from stats
  const bandwidthSamples = calculateBandwidthFromStats(stats);

  if (bandwidthSamples.length < MIN_SAMPLES_FOR_ANALYSIS - 1) {
    return; // Not enough bandwidth samples
  }

  // Check how many samples exceed the fair share threshold
  const threshold = fairShareInfo.download * BANDWIDTH_ABUSE_THRESHOLD;
  const abusingSamples = bandwidthSamples.filter((sample) => sample.totalMbps > threshold);
  const abuseRatio = abusingSamples.length / bandwidthSamples.length;

  const isThrottled = appsBandwidthThrottled[containerName] !== undefined;

  // Calculate average bandwidth for logging
  const avgBandwidth = bandwidthSamples.reduce((sum, s) => sum + s.totalMbps, 0) / bandwidthSamples.length;

  log.info(`Bandwidth check ${containerName}: avg=${avgBandwidth.toFixed(2)} Mbps, threshold=${threshold.toFixed(2)} Mbps, abuse=${(abuseRatio * 100).toFixed(1)}%`);

  if (abuseRatio >= ABUSE_SAMPLE_THRESHOLD) {
    // App is abusing bandwidth
    if (!bandwidthViolations[containerName]) {
      bandwidthViolations[containerName] = { violationCount: 0, lastViolationTime: 0 };
    }

    bandwidthViolations[containerName].violationCount += 1;
    bandwidthViolations[containerName].lastViolationTime = now;

    const newThrottleIndex = getCurrentThrottleLevelIndex(containerName);
    const throttleMultiplier = THROTTLE_LEVELS[newThrottleIndex];
    const newLimit = fairShareInfo.download * throttleMultiplier;

    log.warn(`${containerName} exceeding bandwidth fair share (${(abuseRatio * 100).toFixed(1)}% of samples). Violation count: ${bandwidthViolations[containerName].violationCount}`);

    // Apply progressive throttle
    if (throttleMultiplier < 1.0) {
      log.info(`Applying throttle to ${containerName}: ${(throttleMultiplier * 100).toFixed(0)}% of fair share (${newLimit.toFixed(2)} Mbps)`);
      await applyBandwidthThrottle(containerName, newLimit);
    }
  } else if (isThrottled) {
    // App is behaving well but is throttled - check if we should relax
    const violations = bandwidthViolations[containerName];
    const timeSinceLastViolation = now - (violations?.lastViolationTime || 0);

    if (timeSinceLastViolation > THROTTLE_RECOVERY_TIME) {
      // Good behavior for recovery period - reduce throttle level
      if (violations && violations.violationCount > 0) {
        violations.violationCount = Math.max(0, violations.violationCount - 1);
        log.info(`${containerName} good behavior for ${Math.round(timeSinceLastViolation / 60000)} min. Reducing violation count to ${violations.violationCount}`);

        if (violations.violationCount === 0) {
          // Fully recovered - remove throttle
          log.info(`${containerName} fully recovered. Removing bandwidth throttle.`);
          await removeBandwidthThrottle(containerName);
        } else {
          // Reduce throttle level
          const newThrottleIndex = getCurrentThrottleLevelIndex(containerName);
          const throttleMultiplier = THROTTLE_LEVELS[newThrottleIndex];
          const newLimit = fairShareInfo.download * throttleMultiplier;
          log.info(`Relaxing throttle on ${containerName}: ${(throttleMultiplier * 100).toFixed(0)}% of fair share (${newLimit.toFixed(2)} Mbps)`);
          await applyBandwidthThrottle(containerName, newLimit);
        }

        // Reset last violation time to current for next recovery check
        violations.lastViolationTime = now;
      }
    }
  }
}

/**
 * Get bandwidth usage statistics for an app
 * @param {string} appName - Application name
 * @param {object} appsMonitored - Apps monitoring data
 * @returns {object} Bandwidth statistics
 */
function getAppBandwidthStats(appName, appsMonitored) {
  const stats = appsMonitored[appName]?.lastHourstatsStore;

  if (!stats || stats.length < 2) {
    return {
      available: false,
      message: 'Not enough data',
    };
  }

  const bandwidthSamples = calculateBandwidthFromStats(stats);

  if (bandwidthSamples.length === 0) {
    return {
      available: false,
      message: 'Cannot calculate bandwidth',
    };
  }

  const downloadSamples = bandwidthSamples.map((s) => s.downloadMbps);
  const uploadSamples = bandwidthSamples.map((s) => s.uploadMbps);
  const totalSamples = bandwidthSamples.map((s) => s.totalMbps);

  const throttleInfo = appsBandwidthThrottled[appName];
  const violations = bandwidthViolations[appName];

  return {
    available: true,
    current: {
      download: downloadSamples[downloadSamples.length - 1],
      upload: uploadSamples[uploadSamples.length - 1],
      total: totalSamples[totalSamples.length - 1],
    },
    average: {
      download: downloadSamples.reduce((a, b) => a + b, 0) / downloadSamples.length,
      upload: uploadSamples.reduce((a, b) => a + b, 0) / uploadSamples.length,
      total: totalSamples.reduce((a, b) => a + b, 0) / totalSamples.length,
    },
    max: {
      download: Math.max(...downloadSamples),
      upload: Math.max(...uploadSamples),
      total: Math.max(...totalSamples),
    },
    sampleCount: bandwidthSamples.length,
    throttled: throttleInfo !== undefined,
    throttleLimit: throttleInfo?.throttleLevel || null,
    violationCount: violations?.violationCount || 0,
  };
}

/**
 * Get bandwidth throttle status for all apps
 * @returns {object} Throttle status for all apps
 */
function getBandwidthThrottleStatus() {
  return {
    throttledApps: { ...appsBandwidthThrottled },
    violations: { ...bandwidthViolations },
  };
}

/**
 * Clean up throttle for removed containers
 * Should be called when an app is removed
 * @param {string} containerName - Container name
 */
async function cleanupContainerBandwidth(containerName) {
  if (appsBandwidthThrottled[containerName]) {
    await removeBandwidthThrottle(containerName);
  }
  delete bandwidthViolations[containerName];
}

module.exports = {
  getNodeBandwidth,
  getFairShareBandwidth,
  calculateBandwidthFromStats,
  getContainerVethInterface,
  applyBandwidthThrottle,
  removeBandwidthThrottle,
  checkApplicationsBandwidthUsage,
  getAppBandwidthStats,
  getBandwidthThrottleStatus,
  cleanupContainerBandwidth,
  // Export constants for testing
  TIER_MINIMUM_BANDWIDTH,
  THROTTLE_LEVELS,
};
