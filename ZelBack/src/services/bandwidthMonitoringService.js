const config = require('config');
const os = require('node:os');
const { exec } = require('node:child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const dockerService = require('./dockerService');
const appFileService = require('./apps/appFileService');
const benchmarkService = require('./benchmarkService');
const log = require('../lib/log');
const fs = require('fs');
const path = require('path');

// Load monitored repositories from JSON file
let bandwidthMonitoredRepositories = [];
try {
  const configPath = path.join(__dirname, '../helpers/bandwidthMonitoredRepositories.json');
  const configData = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configData);
  bandwidthMonitoredRepositories = config.repositories || [];
} catch (error) {
  log.error('Error loading bandwidth monitored repositories config:', error);
  bandwidthMonitoredRepositories = [];
}

// Configuration
const MONITORING_INTERVAL = 5 * 60 * 1000; // 5 minutes
const BANDWIDTH_CHECK_PERIOD = 30 * 60 * 1000; // 30 minutes for analysis
const BANDWIDTH_THRESHOLD_PERCENTAGE = 0.5; // 50% of bandwidth

// Store bandwidth statistics
const bandwidthStats = new Map();

/**
 * Get available internet speed from benchmark
 * @returns {Promise<number>} Speed in Mbps
 */
async function getNodeBandwidth() {
  try {
    const benchmarks = await benchmarkService.getBenchmarks();
    if (benchmarks.status === 'success' && benchmarks.data) {
      // Benchmark returns download speed in Mbps
      const downloadSpeed = benchmarks.data.download || 0;
      return downloadSpeed;
    }
    return 100; // Default value if unable to obtain
  } catch (error) {
    log.error('Error getting bandwidth benchmark:', error);
    return 100; // Default value
  }
}

/**
 * Get network statistics from a Docker container
 * @param {string} containerName Container name
 * @returns {Promise<object>} Network statistics
 */
async function getContainerNetworkStats(containerName) {
  try {
    const container = await dockerService.getDockerContainerByIdOrName(containerName);
    const stats = await container.stats({ stream: false });
    
    // Calculate current bandwidth
    const networks = stats.networks || {};
    let totalRxBytes = 0;
    let totalTxBytes = 0;
    
    for (const network of Object.values(networks)) {
      totalRxBytes += network.rx_bytes || 0;
      totalTxBytes += network.tx_bytes || 0;
    }
    
    return {
      timestamp: Date.now(),
      rxBytes: totalRxBytes,
      txBytes: totalTxBytes,
      totalBytes: totalRxBytes + totalTxBytes
    };
  } catch (error) {
    log.error(`Error getting network stats from container ${containerName}:`, error);
    return null;
  }
}

/**
 * Calculate bandwidth speed in Mbps
 * @param {object} previousStats Previous statistics
 * @param {object} currentStats Current statistics
 * @returns {number} Speed in Mbps
 */
function calculateBandwidthSpeed(previousStats, currentStats) {
  if (!previousStats || !currentStats) return 0;
  
  const timeDiff = (currentStats.timestamp - previousStats.timestamp) / 1000; // seconds
  const bytesDiff = currentStats.totalBytes - previousStats.totalBytes;
  
  // Convert bytes/second to Mbps
  const bytesPerSecond = bytesDiff / timeDiff;
  const mbps = (bytesPerSecond * 8) / (1024 * 1024);
  
  return mbps;
}

/**
 * Apply throttling to a Docker container
 * @param {string} containerName Container name
 * @param {number} limitMbps Limit in Mbps
 */
async function applyThrottling(containerName, limitMbps) {
  try {
    // Use tc (traffic control) to limit bandwidth
    const limitKbps = Math.floor(limitMbps * 1024);
    
    // Get container PID
    const container = await dockerService.getDockerContainerByIdOrName(containerName);
    const containerInfo = await container.inspect();
    const pid = containerInfo.State.Pid;
    
    // Apply throttling using tc in container's network namespace
    const commands = [
      `nsenter -t ${pid} -n tc qdisc del dev eth0 root 2>/dev/null || true`,
      `nsenter -t ${pid} -n tc qdisc add dev eth0 root handle 1: htb default 30`,
      `nsenter -t ${pid} -n tc class add dev eth0 parent 1: classid 1:1 htb rate ${limitKbps}kbit`,
      `nsenter -t ${pid} -n tc class add dev eth0 parent 1:1 classid 1:30 htb rate ${limitKbps}kbit`
    ];
    
    for (const cmd of commands) {
      await execAsync(cmd);
    }
    
    log.info(`Throttling applied to container ${containerName}: ${limitMbps} Mbps`);
  } catch (error) {
    log.error(`Error applying throttling to container ${containerName}:`, error);
  }
}

/**
 * Remove throttling from a Docker container
 * @param {string} containerName Container name
 */
async function removeThrottling(containerName) {
  try {
    const container = await dockerService.getDockerContainerByIdOrName(containerName);
    const containerInfo = await container.inspect();
    const pid = containerInfo.State.Pid;
    
    await execAsync(`nsenter -t ${pid} -n tc qdisc del dev eth0 root 2>/dev/null || true`);
    
    log.info(`Throttling removed from container ${containerName}`);
  } catch (error) {
    log.error(`Error removing throttling from container ${containerName}:`, error);
  }
}

/**
 * Check if an application should be monitored
 * @param {object} app Application specifications
 * @returns {boolean} True if should be monitored
 */
function shouldMonitorApp(app) {
  if (!app || !app.repotag) return false;
  
  // Check if repository is in monitored list
  return bandwidthMonitoredRepositories.some(repo => {
    // Flexible comparison to support different formats
    const appRepo = app.repotag.toLowerCase();
    const monitoredRepo = repo.toLowerCase();
    
    // Exact or partial match
    return appRepo === monitoredRepo || 
           appRepo.startsWith(monitoredRepo) ||
           appRepo.includes(monitoredRepo);
  });
}

/**
 * Monitor applications bandwidth
 */
async function monitorApplicationsBandwidth() {
  try {
    // Get installed applications
    const installedAppsRes = await appFileService.installedApps();
    if (installedAppsRes.status !== 'success') {
      log.error('Failed to get installed applications');
      return;
    }
    
    const apps = installedAppsRes.data;
    const nodeBandwidth = await getNodeBandwidth();
    const bandwidthLimit = nodeBandwidth * BANDWIDTH_THRESHOLD_PERCENTAGE;
    
    // Process each application
    for (const app of apps) {
      if (!shouldMonitorApp(app)) continue;
      
      const containerName = dockerService.getAppDockerNameIdentifier(app.name).substring(1);
      
      // Get current statistics
      const currentStats = await getContainerNetworkStats(containerName);
      if (!currentStats) continue;
      
      // Get previous statistics
      let appStats = bandwidthStats.get(containerName);
      if (!appStats) {
        appStats = {
          history: [],
          throttled: false
        };
        bandwidthStats.set(containerName, appStats);
      }
      
      // Add current statistics to history
      appStats.history.push(currentStats);
      
      // Keep only statistics from analysis period
      const cutoffTime = Date.now() - BANDWIDTH_CHECK_PERIOD;
      appStats.history = appStats.history.filter(stat => stat.timestamp > cutoffTime);
      
      // Calculate average bandwidth if we have enough history
      if (appStats.history.length >= 2) {
        let totalBandwidth = 0;
        let measurements = 0;
        
        for (let i = 1; i < appStats.history.length; i++) {
          const speed = calculateBandwidthSpeed(appStats.history[i-1], appStats.history[i]);
          if (speed > 0) {
            totalBandwidth += speed;
            measurements++;
          }
        }
        
        if (measurements > 0) {
          const avgBandwidth = totalBandwidth / measurements;
          
          log.info(`App ${app.name}: Average bandwidth ${avgBandwidth.toFixed(2)} Mbps (Limit: ${bandwidthLimit.toFixed(2)} Mbps)`);
          
          // Apply throttling if necessary
          if (avgBandwidth > bandwidthLimit && !appStats.throttled) {
            await applyThrottling(containerName, bandwidthLimit);
            appStats.throttled = true;
            log.warn(`Throttling applied to ${app.name} for exceeding bandwidth limit`);
          } else if (avgBandwidth <= bandwidthLimit * 0.8 && appStats.throttled) {
            // Remove throttling if bandwidth dropped to 80% of limit
            await removeThrottling(containerName);
            appStats.throttled = false;
            log.info(`Throttling removed from ${app.name} - bandwidth normalized`);
          }
        }
      }
    }
  } catch (error) {
    log.error('Error in bandwidth monitoring:', error);
  }
}

/**
 * Start monitoring service
 */
function startBandwidthMonitoring() {
  log.info('Starting bandwidth monitoring service');
  
  // Execute first check
  monitorApplicationsBandwidth();
  
  // Configure monitoring interval
  setInterval(() => {
    monitorApplicationsBandwidth();
  }, MONITORING_INTERVAL);
}

/**
 * Stop monitoring service
 */
async function stopBandwidthMonitoring() {
  log.info('Stopping bandwidth monitoring service');
  
  // Remove throttling from all applications
  for (const [containerName, appStats] of bandwidthStats.entries()) {
    if (appStats.throttled) {
      await removeThrottling(containerName);
    }
  }
  
  // Clear statistics
  bandwidthStats.clear();
}

module.exports = {
  startBandwidthMonitoring,
  stopBandwidthMonitoring,
  monitorApplicationsBandwidth,
  getNodeBandwidth,
  getContainerNetworkStats,
  calculateBandwidthSpeed,
  applyThrottling,
  removeThrottling,
  shouldMonitorApp
};