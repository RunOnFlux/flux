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

const DEVICE_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * The Luhn mod 32 check character syncthing appends to each 13-character group
 * of a device ID.
 * @param {string} group
 * @returns {string}
 */
function deviceIdCheckCharacter(group) {
  let factor = 1;
  let sum = 0;
  for (const character of group) {
    const addend = factor * DEVICE_ID_ALPHABET.indexOf(character);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / 32) + (addend % 32);
  }
  return DEVICE_ID_ALPHABET[(32 - (sum % 32)) % 32];
}

/**
 * `value` as syncthing writes a device ID - upper case, each 13-character group
 * followed by its check character, a dash after every 7 - when it is one as
 * syncthing reads one: base32, dashes and spaces aside and 0, 1 and 8 read as
 * O, I and B, either 56 characters whose every 14th is the check character of
 * the 13 before it, or 52 without them. Syncthing refuses a configuration that
 * names any other device, and with it every device the same write configures,
 * and it holds every device under this form, so an ID compared with its
 * configuration is compared in it.
 * @param {unknown} value
 * @returns {string|null} null when `value` is not a device ID
 */
function canonicalSyncthingDeviceId(value) {
  if (typeof value !== 'string') return null;
  const id = value.replace(/[-\s]/g, '').toUpperCase()
    .replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  if (![...id].every((character) => DEVICE_ID_ALPHABET.includes(character))) return null;
  let checked;
  if (id.length === 52) {
    checked = [0, 13, 26, 39].map((start) => {
      const group = id.slice(start, start + 13);
      return group + deviceIdCheckCharacter(group);
    }).join('');
  } else if (id.length === 56) {
    for (let start = 0; start < 56; start += 14) {
      if (id[start + 13] !== deviceIdCheckCharacter(id.slice(start, start + 13))) return null;
    }
    checked = id;
  } else {
    return null;
  }
  return checked.match(/.{7}/g).join('-');
}

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
 * A node listed at `name` that gives no device - its FluxOS does not answer, or
 * its syncthing has not answered it - keeps the device syncthing has configured
 * under `name`, so a holder stays in its folders for as long as it is listed.
 *
 * A device a peer gives that is not a syncthing device ID is no device: what
 * was held for `name` is dropped, and the device syncthing has configured under
 * it stands.
 *
 * Every call counts where its answer came from under `syncthing:deviceSource`,
 * keyed by `name`: verified, verifiedNoDevice, introduced, withheld, held,
 * unsigned, configured or malformed.
 *
 * @param {string} name - Device name (IP:port)
 * @param {Map} cache - Cache map
 * @param {string|null} [configured] - The device syncthing has configured under
 *   `name`, when exactly one is
 * @returns {Promise<string|null>} the device ID as syncthing writes it, or null
 */
async function getDeviceIDCached(name, cache, configured = null) {
  const { IdentityVerdict } = peerIdentityService;
  const from = (source, deviceID) => {
    if (deviceID === null || source === 'configured') {
      fluxEventBus.count('syncthing:deviceSource', name, source);
      return deviceID;
    }
    const canonical = canonicalSyncthingDeviceId(deviceID);
    if (canonical === null) {
      cache.delete(name);
      log.warn(`getDeviceIDCached - ${name} gave ${JSON.stringify(deviceID)} (${source}), which is not a syncthing device ID`);
      fluxEventBus.count('syncthing:deviceSource', name, 'malformed');
      return configured;
    }
    if (cache.get(name) === deviceID) cache.set(name, canonical);
    fluxEventBus.count('syncthing:deviceSource', name, source);
    return canonical;
  };
  const result = await peerIdentityService.verifyPeer(name);

  if (result.verdict === IdentityVerdict.VERIFIED) {
    const signedDeviceID = result.identity.deviceId;
    // Verified with no device: that node's syncthing has not answered it yet.
    // What was held stands until it has.
    if (!signedDeviceID) {
      if (cache.has(name)) return from('verifiedNoDevice', cache.get(name));
      return configured ? from('configured', configured) : from('verifiedNoDevice', null);
    }
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
    return from('unsigned', deviceID);
  }
  return configured ? from('configured', configured) : from('unsigned', null);
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

    const underName = allDevices.filter((device) => device.name === name);
    const configured = underName.length === 1 ? underName[0].deviceID : null;
    const deviceID = await getDeviceIDCached(name, deviceCache, configured);

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
 * The fields of a folder's syncthing configuration the monitor owns. Its type
 * is decided separately: by the monitor for an r: folder, by the primary role
 * for a g: folder.
 * @param {string} id - Folder ID
 * @param {string} label - Folder label
 * @param {string} path - Folder path
 * @param {Array} devices - Array of device objects
 * @returns {Object} Syncthing folder configuration, without a type
 */
function createSyncthingFolderConfig(id, label, path, devices) {
  return {
    id,
    label,
    path,
    devices,
    paused: false,
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
 * Whether two folder device lists name the same devices. Syncthing returns a
 * folder's devices sorted, once each, with fields FluxOS never sets; the device
 * IDs are what the monitor writes.
 * @param {Array<{deviceID: string}>} [held]
 * @param {Array<{deviceID: string}>} [wanted]
 * @returns {boolean}
 */
function sameDevices(held = [], wanted = []) {
  const heldIds = new Set(held.map((device) => device.deviceID));
  const wantedIds = new Set(wanted.map((device) => device.deviceID));
  return heldIds.size === wantedIds.size && [...wantedIds].every((id) => heldIds.has(id));
}

/**
 * Whether syncthing holds a folder differently from the config the monitor
 * built for it: any field of that config that differs, its devices compared as
 * the devices they name and every other field by value. A field the config
 * leaves out - a g: folder's type - is not the monitor's to compare.
 * @param {Object} existingFolder - The folder as syncthing holds it
 * @param {Object} newFolder - The config the monitor built for it
 * @returns {boolean} True if update is needed
 */
function folderNeedsUpdate(existingFolder, newFolder) {
  if (!existingFolder) {
    return true;
  }
  return Object.entries(newFolder).some(([field, value]) => (field === 'devices'
    ? !sameDevices(existingFolder.devices, value)
    : existingFolder[field] !== value));
}

module.exports = {
  OWNED_FOLDER_SETTINGS,
  canonicalSyncthingDeviceId,
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
