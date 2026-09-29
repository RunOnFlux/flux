// Syncthing Monitor - Helper Functions
const axios = require('axios');
const fs = require('node:fs/promises');
const path = require('node:path');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const volumeService = require('../utils/volumeService');
const {
  DEVICE_ID_REQUEST_TIMEOUT_MS,
  SYNCTHING_RESCAN_INTERVAL_SECONDS,
  SYNCTHING_MAX_CONFLICTS,
  DEVICE_ID_REFRESH_MS,
} = require('./syncthingMonitorConstants');

const { normalizeSocketAddress, extractIp, extractPort, socketAddressesMatch } = require('../utils/socketAddressUtils');

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

// When each cached device id was last read from its peer, per cache. Kept beside the
// cache rather than in it: the cache is shared, and its readers take the value as the
// id itself.
const deviceIdReadAt = new WeakMap();

/**
 * Get device ID with caching.
 *
 * The id is re-read from the peer once it is DEVICE_ID_REFRESH_MS old. An address
 * outlives the node behind it - a node reinstalled at the same ip:port, or a
 * residential address passed to another node, answers with a new id - and a cache
 * that never expires keeps configuring the old one until this node's FluxOS restarts,
 * so the two never connect. A failed re-read keeps the cached id: a peer that cannot
 * be asked right now has not been shown to have changed.
 *
 * @param {string} name - Device name (IP:port)
 * @param {Map} cache - Cache map
 * @returns {Promise<string|null>} Device ID or null
 */
async function getDeviceIDCached(name, cache) {
  if (!deviceIdReadAt.has(cache)) deviceIdReadAt.set(cache, new Map());
  const readAt = deviceIdReadAt.get(cache);

  if (cache.has(name)) {
    // An entry this module did not write (filled elsewhere, or before a restart of
    // this module) is dated from when it is first seen here.
    if (!readAt.has(name)) readAt.set(name, Date.now());
    if (Date.now() - readAt.get(name) < DEVICE_ID_REFRESH_MS) {
      return cache.get(name);
    }
    const fresh = await getDeviceID(name);
    if (!fresh) return cache.get(name);
    if (fresh !== cache.get(name)) {
      log.warn(`getDeviceIDCached - ${name} now answers with device ${fresh}, was ${cache.get(name)}`);
    }
    cache.set(name, fresh);
    readAt.set(name, Date.now());
    return fresh;
  }

  const deviceID = await getDeviceID(name);
  if (deviceID) {
    cache.set(name, deviceID);
    readAt.set(name, Date.now());
  }
  return deviceID;
}

/**
 * Sort and filter app locations
 * @param {Array} locations - App locations
 * @param {string} localSocketAddr - Current node socket address
 * @returns {Array} Sorted and filtered locations (excluding current node)
 */
function sortAndFilterLocations(locations, localSocketAddr) {
  return locations
    .sort((a, b) => {
      const addrA = normalizeSocketAddress(a.ip);
      const addrB = normalizeSocketAddress(b.ip);
      if (addrA < addrB) return -1;
      if (addrA > addrB) return 1;
      return 0;
    })
    .filter((loc) => !socketAddressesMatch(loc.ip, localSocketAddr));
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
 * @param {string} localSocketAddr - Current node socket address
 * @param {string} myDeviceId - Current node device ID
 * @param {Map} deviceCache - Device ID cache
 * @param {Array} devicesConfiguration - Array to populate with devices
 * @param {Array} devicesIds - Array to populate with device IDs
 * @param {Array} allDevices - Existing syncthing devices
 * @returns {Promise<Array>} Array of device objects for folder configuration
 */
async function buildDeviceConfiguration(
  locations,
  localSocketAddr,
  myDeviceId,
  deviceCache,
  devicesConfiguration,
  devicesIds,
  allDevices,
) {
  const devices = [{ deviceID: myDeviceId }];

  // Parallelize device ID fetching
  const devicePromises = locations.map(async (appInstance) => {
    const ip = extractIp(appInstance.ip);
    const port = extractPort(appInstance.ip);
    const addresses = [`tcp://${ip}:${port + 2}`, `quic://${ip}:${port + 2}`];
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
        // Configured means configured under THIS id. The name is only the peer's
        // address, and an address outlives the node behind it: a node reinstalled at
        // the same ip:port, or an address that has passed to another node, answers
        // with a new id while this node's syncthing still holds the old one under the
        // same name. Matching on the name alone then never writes the new id - the
        // folder lists a device syncthing does not know, and the two nodes never
        // connect, with both sync ports open and nothing in any log. The sweep drops
        // the stale entry once no folder names its id; until then the two coexist,
        // which syncthing allows (a device is keyed by its id, not its name).
        const syncthingDeviceExists = allDevices.find((device) => device.name === name && device.deviceID === deviceID);
        if (!syncthingDeviceExists) {
          const stale = allDevices.find((device) => device.name === name);
          if (stale) {
            log.warn(`buildDeviceConfiguration - ${name} now answers with device ${deviceID}, but syncthing has it as ${stale.deviceID}; adding the current id`);
          }
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
 * Ensure the .stfolder marker exists - ONLY inside the mounted volume. The
 * marker is syncthing's own guard against syncing a missing folder: creating
 * it on the bare mountpoint re-arms syncthing onto the host filesystem and
 * defeats that guard (this exact leak re-armed a sync onto the rootfs in the
 * 2026-07-01 data-loss incident).
 * @param {string} folder - Folder path
 * @returns {Promise<boolean>} True if the marker exists in a mounted volume
 */
async function ensureStfolderExists(folder) {
  const mounted = await volumeService.isPathMounted(folder);
  if (!mounted) {
    log.error(`ensureStfolderExists - ${folder} is not a mountpoint; refusing to create .stfolder on the bare directory`);
    return false;
  }
  // creation is a one-time setup act: when the marker is already present in
  // the mounted volume there is nothing to do (and nothing to log)
  const marker = path.join(folder, '.stfolder');
  const exists = await fs.stat(marker).then((stats) => stats.isDirectory()).catch(() => false);
  if (exists) return true;

  const mkdir = await serviceHelper.runCommand('mkdir', { runAsRoot: true, params: ['-p', marker] });
  if (mkdir.error) {
    log.error(`ensureStfolderExists - failed to create .stfolder in ${folder}: ${mkdir.error.message}`);
    return false;
  }
  log.info(`ensureStfolderExists - created .stfolder in ${folder}`);
  return true;
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
