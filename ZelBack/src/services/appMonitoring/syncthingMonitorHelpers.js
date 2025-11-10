// Syncthing Monitor - Helper Functions
const axios = require('axios');
const util = require('util');
const log = require('../../lib/log');
const {
  DEVICE_ID_REQUEST_TIMEOUT_MS,
  SYNCTHING_RESCAN_INTERVAL_SECONDS,
  SYNCTHING_MAX_CONFLICTS,
} = require('./syncthingMonitorConstants');

const cmdAsync = util.promisify(require('child_process').exec);

/**
 * Helper function to get device ID from remote node with retry capability
 * @param {string} fluxIP - IP address of the remote node
 * @param {number} retries - Number of retries (default: 0)
 * @returns {Promise<string|null>} Device ID or null
 */
async function getDeviceID(fluxIP, retries = 0) {
  try {
    const axiosConfig = {
      timeout: DEVICE_ID_REQUEST_TIMEOUT_MS,
    };
    const response = await axios.get(`http://${fluxIP}/syncthing/deviceid`, axiosConfig);
    if (response.data.status === 'success') {
      return response.data.data;
    }
    throw new Error(`Unable to get deviceid from ${fluxIP}`);
  } catch (error) {
    if (retries > 0) {
      log.warn(`Failed to get device ID from ${fluxIP}, retrying... (${retries} attempts left)`);
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return getDeviceID(fluxIP, retries - 1);
    }
    log.error(`Failed to get device ID from ${fluxIP}: ${error.message}`);
    return null;
  }
}

/**
 * Get device ID with caching
 * @param {string} name - Device name (IP:port)
 * @param {Map} cache - Cache map
 * @returns {Promise<string|null>} Device ID or null
 */
async function getDeviceIDCached(name, cache) {
  if (cache.has(name)) {
    return cache.get(name);
  }

  const deviceID = await getDeviceID(name);
  if (deviceID) {
    cache.set(name, deviceID);
  }
  return deviceID;
}

/**
 * Sort and filter app locations
 * @param {Array} locations - App locations
 * @param {string} myIP - Current node IP
 * @returns {Array} Sorted and filtered locations (excluding current node)
 */
function sortAndFilterLocations(locations, myIP) {
  return locations
    .sort((a, b) => {
      if (a.ip < b.ip) return -1;
      if (a.ip > b.ip) return 1;
      return 0;
    })
    .filter((loc) => loc.ip !== myIP);
}

/**
 * Sort running app list for leader election
 * @param {Array} runningAppList - List of running apps
 * @returns {Array} Sorted list
 */
function sortRunningAppList(runningAppList) {
  return [...runningAppList].sort((a, b) => {
    if (!a.runningSince && b.runningSince) return -1;
    if (a.runningSince && !b.runningSince) return 1;
    if (a.runningSince < b.runningSince) return -1;
    if (a.runningSince > b.runningSince) return 1;
    if (a.broadcastedAt < b.broadcastedAt) return -1;
    if (a.broadcastedAt > b.broadcastedAt) return 1;
    if (a.ip < b.ip) return -1;
    if (a.ip > b.ip) return 1;
    return 0;
  });
}

/**
 * Build device configuration from locations
 * @param {Array} locations - App locations
 * @param {string} myIP - Current node IP
 * @param {string} myDeviceId - Current node device ID
 * @param {Map} deviceCache - Device ID cache
 * @param {Array} devicesConfiguration - Array to populate with devices
 * @param {Array} devicesIds - Array to populate with device IDs
 * @param {Array} allDevicesResp - Existing syncthing devices
 * @returns {Promise<Array>} Array of device objects for folder configuration
 */
async function buildDeviceConfiguration(
  locations,
  myIP,
  myDeviceId,
  deviceCache,
  devicesConfiguration,
  devicesIds,
  allDevicesResp,
) {
  const devices = [{ deviceID: myDeviceId }];

  // Parallelize device ID fetching
  const devicePromises = locations.map(async (appInstance) => {
    const ip = appInstance.ip.split(':')[0];
    const port = appInstance.ip.split(':')[1] || '16127';
    const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
    const name = `${ip}:${port}`;

    const deviceID = await getDeviceIDCached(name, deviceCache);

    if (!deviceID) {
      return null;
    }

    return {
      deviceID,
      name,
      addresses,
      ip: appInstance.ip,
    };
  });

  const resolvedDevices = await Promise.all(devicePromises);

  // Process resolved devices
  // eslint-disable-next-line no-restricted-syntax
  for (const deviceInfo of resolvedDevices) {
    // eslint-disable-next-line no-continue
    if (!deviceInfo) continue;

    const { deviceID, name, addresses } = deviceInfo;

    // Add to folder devices if not already present and not my ID
    if (deviceID !== myDeviceId) {
      const folderDeviceExists = devices.find((device) => device.deviceID === deviceID);
      if (!folderDeviceExists) {
        devices.push({ deviceID });
      }
    }

    // Add to global devices configuration if not already configured
    const deviceExists = devicesConfiguration.find((device) => device.name === name);
    if (!deviceExists) {
      const newDevice = {
        deviceID,
        name,
        addresses,
        autoAcceptFolders: true,
      };
      devicesIds.push(deviceID);

      if (deviceID !== myDeviceId) {
        const syncthingDeviceExists = allDevicesResp.data.find((device) => device.name === name);
        if (!syncthingDeviceExists) {
          devicesConfiguration.push(newDevice);
        }
      }
    }
  }

  return devices;
}

/**
 * Create Syncthing folder configuration
 * @param {string} id - Folder ID
 * @param {string} label - Folder label
 * @param {string} path - Folder path
 * @param {Array} devices - Array of device objects
 * @param {string} type - Folder type (sendreceive, receiveonly)
 * @returns {Object} Syncthing folder configuration
 */
function createSyncthingFolderConfig(id, label, path, devices, type = 'sendreceive') {
  return {
    id,
    label,
    path,
    devices,
    paused: false,
    type,
    rescanIntervalS: SYNCTHING_RESCAN_INTERVAL_SECONDS,
    maxConflicts: SYNCTHING_MAX_CONFLICTS,
  };
}

/**
 * Ensure .stfolder directory exists
 * @param {string} folder - Folder path
 * @returns {Promise<void>}
 */
async function ensureStfolderExists(folder) {
  const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`;
  await cmdAsync(execDIRst);
}

/**
 * Parse container data to extract folder path
 * Primary mount goes to /appdata, additional mounts are at same level as appdata
 * @param {Array} containersData - Container data array
 * @param {number} index - Current container index
 * @returns {string} Container folder path
 */
function getContainerFolderPath(containersData, index) {
  if (index === 0) {
    return '/appdata';
  }
  const container = containersData[index];
  return container.split(':')[1].replace(containersData[0], '');
}

/**
 * Extract container data flags
 * @param {string} container - Container string
 * @returns {string} Container data flags
 */
function getContainerDataFlags(container) {
  return container.split(':')[1] ? container.split(':')[0] : '';
}

/**
 * Check if container requires syncing
 * @param {string} containerDataFlags - Container flags
 * @returns {boolean} True if sync is required
 */
function requiresSyncing(containerDataFlags) {
  return containerDataFlags.includes('s')
    || containerDataFlags.includes('r')
    || containerDataFlags.includes('g');
}

/**
 * Check if container should be running
 * @param {string} containerDataFlags - Container flags
 * @returns {boolean} True if container should be running
 */
function shouldBeRunning(containerDataFlags) {
  return containerDataFlags.includes('r');
}

/**
 * Check if folder configuration needs update
 * @param {Object} existingFolder - Existing folder config
 * @param {Object} newFolder - New folder config
 * @returns {boolean} True if update is needed
 */
function folderNeedsUpdate(existingFolder, newFolder) {
  if (!existingFolder) {
    return true;
  }

  return (
    existingFolder.maxConflicts !== SYNCTHING_MAX_CONFLICTS
    || existingFolder.paused
    || existingFolder.type !== newFolder.type
    || JSON.stringify(existingFolder.devices) !== JSON.stringify(newFolder.devices)
  );
}

module.exports = {
  getDeviceID,
  getDeviceIDCached,
  sortAndFilterLocations,
  sortRunningAppList,
  buildDeviceConfiguration,
  createSyncthingFolderConfig,
  ensureStfolderExists,
  getContainerFolderPath,
  getContainerDataFlags,
  requiresSyncing,
  shouldBeRunning,
  folderNeedsUpdate,
};
