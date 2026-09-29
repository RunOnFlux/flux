// Syncthing Monitor - Helper Functions
const axios = require('axios');
const fs = require('node:fs/promises');
const path = require('node:path');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const volumeService = require('../utils/volumeService');
const peerIdentityService = require('../peerIdentityService');
const fluxEventBus = require('../utils/fluxEventBus');
const {
  DEVICE_ID_REQUEST_TIMEOUT_MS,
  SYNCTHING_RESCAN_INTERVAL_SECONDS,
  SYNCTHING_MAX_CONFLICTS,
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

/**
 * The syncthing device of the node at `name`.
 *
 * A peer that proves it is the node listed at `name` is believed about its
 * device, and what it signs replaces whatever was held for the address. So is a
 * peer that proved it by calling in - its introduction - which is how a node
 * whose own calls are redirected learns its partners: their connections to it
 * arrive intact, and syncthing needs only one direction to sync. A call to
 * `name` that another node answered, with no introduction to go on, yields no
 * device: configuring the answering node's device under this name leaves the
 * folder syncing with a device that holds no copy of it. A peer that cannot
 * prove either way is asked the unsigned way.
 *
 * Every call counts where its answer came from under `syncthing:deviceSource`,
 * keyed by `name`: verified, verifiedNoDevice, introduced, withheld, held or
 * unsigned.
 *
 * @param {string} name - Device name (IP:port)
 * @param {Map} cache - Cache map
 * @returns {Promise<string|null>} Device ID or null
 */
async function getDeviceIDCached(name, cache) {
  const { IdentityVerdict } = peerIdentityService;
  const from = (source, deviceID) => {
    fluxEventBus.count('syncthing:deviceSource', name, source);
    return deviceID;
  };
  const result = await peerIdentityService.verifyPeer(name);

  if (result.verdict === IdentityVerdict.VERIFIED) {
    const signedDeviceID = result.identity.deviceId;
    // Verified with no device: that node's syncthing has not answered it yet.
    // What was held stands until it has.
    if (!signedDeviceID) return from('verifiedNoDevice', cache.get(name) ?? null);
    cache.set(name, signedDeviceID);
    return from('verified', signedDeviceID);
  }

  const introduced = peerIdentityService.introducedPeer(name);
  if (introduced?.deviceId) {
    cache.set(name, introduced.deviceId);
    return from('introduced', introduced.deviceId);
  }

  if (result.verdict === IdentityVerdict.MISROUTED) {
    cache.delete(name);
    log.warn(`getDeviceIDCached - ${name} was answered by ${result.answeredAs}; configuring no device for it`);
    return from('withheld', null);
  }

  if (cache.has(name)) {
    return from('held', cache.get(name));
  }

  const deviceID = await getDeviceID(name);
  if (deviceID) {
    cache.set(name, deviceID);
  }
  return from('unsigned', deviceID);
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
 * The addresses a peer's syncthing is reached at: TCP alone. Every node
 * publishes its syncthing port for TCP, and the network's check of a node
 * requires it. Over QUIC, syncthing learns that the peer which dialled a
 * connection has stopped only at QUIC's idle timeout, 30 s, and until then
 * this node reads the peer as running and its own turn as not yet due.
 * @param {string} ip Peer IP
 * @param {number} port Peer API port
 * @returns {string[]}
 */
function peerSyncthingAddresses(ip, port) {
  return [`tcp://${ip}:${port + 2}`];
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
    const addresses = peerSyncthingAddresses(ip, port);
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
      // Folders are never auto-accepted: FluxOS creates every folder itself,
      // with its type and its peers. A folder a peer offers before then waits as
      // pending. Accepted, syncthing would create it with its default type,
      // sendreceive, and a new standby's empty copy - wiped clean for the
      // install - would go out as newer than the primary's data, which the
      // primary would then delete.
      const newDevice = {
        deviceID,
        name,
        addresses,
        autoAcceptFolders: false,
      };
      devicesIds.push(deviceID);

      // Matched on the id as well as the name: an entry under this name that
      // holds a different device is not this device. Once this one replaces it
      // no folder uses it, and it falls to the sweep of unused devices.
      if (deviceID !== myDeviceId) {
        const syncthingDeviceExists = allDevices.find((device) => device.name === name && device.deviceID === deviceID);
        if (!syncthingDeviceExists) {
          devicesConfiguration.push(newDevice);
        }
      }
    }
  }

  return devices;
}

/**
 * The settings every folder FluxOS owns carries, on creation and on every write
 * that changes its type. syncthing re-applies its own defaults to the fields a
 * type or ownership change leaves out of the body, and its default of ten
 * conflict copies puts renamed losers into a single-writer app's data.
 * syncOwnership makes a synced file arrive owned by the uid that wrote it on
 * the primary, so the same image writes it there without a permissions sweep.
 */
const OWNED_FOLDER_SETTINGS = Object.freeze({
  rescanIntervalS: SYNCTHING_RESCAN_INTERVAL_SECONDS,
  maxConflicts: SYNCTHING_MAX_CONFLICTS,
  syncOwnership: true,
});

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
    ...OWNED_FOLDER_SETTINGS,
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
    || existingFolder.syncOwnership !== newFolder.syncOwnership
    || existingFolder.paused
    || existingFolder.type !== newFolder.type
    || JSON.stringify(existingFolder.devices) !== JSON.stringify(newFolder.devices)
  );
}

module.exports = {
  OWNED_FOLDER_SETTINGS,
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
