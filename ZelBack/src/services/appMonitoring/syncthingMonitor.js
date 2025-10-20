// Syncthing Monitor - Manages syncthing configuration for apps
const path = require('node:path');
const config = require('config');
const axios = require('axios');
const util = require('util');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const syncthingService = require('../syncthingService');
const log = require('../../lib/log');

const cmdAsync = util.promisify(require('child_process').exec);

// Global collections
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

// Path constants
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

// Helper function to get device ID from remote node
async function getDeviceID(fluxIP) {
  try {
    const axiosConfig = {
      timeout: 5000,
    };
    const response = await axios.get(`http://${fluxIP}/syncthing/deviceid`, axiosConfig);
    if (response.data.status === 'success') {
      return response.data.data;
    }
    throw new Error(`Unable to get deviceid from ${fluxIP}`);
  } catch (error) {
    log.error(error);
    return null;
  }
}

// Helper function to get app locations
async function appLocation(appName) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = { name: appName };
    const projection = { _id: 0 };
    const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
    return results || [];
  } catch (error) {
    log.error(`Error getting app location for ${appName}: ${error.message}`);
    return [];
  }
}

/**
 * Helper function to check Syncthing folder sync completion status
 * Queries the Syncthing API to get real-time sync progress for a specific folder
 *
 * @param {string} folderId - The Syncthing folder ID (typically the app identifier)
 * @returns {Promise<Object|null>} Sync status object or null if unavailable
 * @returns {number} return.syncPercentage - Percentage of data synced (0-100)
 * @returns {number} return.globalBytes - Total bytes in the folder
 * @returns {number} return.inSyncBytes - Bytes currently synced
 * @returns {string} return.state - Syncthing folder state (e.g., 'idle', 'syncing', 'sync-preparing')
 * @returns {boolean} return.isSynced - True if sync percentage is 100%
 */
async function getFolderSyncCompletion(folderId) {
  try {
    const statusResponse = await syncthingService.getDbStatus(null, {
      query: { folder: folderId },
    });

    if (statusResponse && statusResponse.status === 'success') {
      const { globalBytes = 0, inSyncBytes = 0, state } = statusResponse.data;

      // Calculate sync percentage
      const syncPercentage = globalBytes > 0 ? (inSyncBytes / globalBytes) * 100 : 100;

      return {
        syncPercentage,
        globalBytes,
        inSyncBytes,
        state,
        isSynced: syncPercentage === 100, // Consider synced only at 100%
      };
    }

    log.warn(`Failed to get sync status for folder ${folderId}`);
    return null;
  } catch (error) {
    log.error(`Error checking sync completion for ${folderId}: ${error.message}`);
    return null;
  }
}

/**
 * Determines if this node should be the designated leader for starting an app first.
 * Uses deterministic leader election to prevent race conditions when multiple nodes
 * install an app simultaneously.
 *
 * Algorithm:
 * 1. If any OTHER peer is already running, this node is NOT the leader
 * 2. If only one peer exists and it's this node, this node IS the leader
 * 3. If multiple peers exist, elect leader deterministically:
 *    - Primary: Earliest broadcastedAt timestamp (with >5s threshold for clock skew tolerance)
 *    - Tie-breaker: Lowest IP address (lexicographically sorted)
 *
 * This ensures all nodes independently arrive at the same leader decision, preventing
 * multiple nodes from starting in sendreceive mode simultaneously and causing sync conflicts.
 *
 * @param {Array<Object>} allPeersList - List of ALL peers including the current node
 * @param {string} allPeersList[].ip - Peer IP address (e.g., '10.0.0.1:16127')
 * @param {number|null} allPeersList[].runningSince - Timestamp when peer started running, or null if not running
 * @param {number} allPeersList[].broadcastedAt - Timestamp when peer broadcasted its installation
 * @param {string} myIP - The current node's IP address
 * @returns {boolean} True if this node is the designated leader and should start the app immediately
 *
 * @example
 * // Three nodes install simultaneously
 * const peers = [
 *   { ip: '10.0.0.1:16127', broadcastedAt: 1000, runningSince: null },
 *   { ip: '10.0.0.2:16127', broadcastedAt: 1000, runningSince: null },
 *   { ip: '10.0.0.3:16127', broadcastedAt: 1000, runningSince: null }
 * ];
 * // All nodes run the same algorithm and elect 10.0.0.1 as leader
 * isDesignatedLeader(peers, '10.0.0.1:16127'); // returns true (I am leader)
 * isDesignatedLeader(peers, '10.0.0.2:16127'); // returns false (I am NOT leader)
 * isDesignatedLeader(peers, '10.0.0.3:16127'); // returns false (I am NOT leader)
 */
function isDesignatedLeader(allPeersList, myIP) {
  // If no peers at all, we can't make a safe decision yet
  // Wait for network propagation to avoid race conditions
  if (!allPeersList || allPeersList.length === 0) {
    return false; // Be conservative - wait for peers to broadcast
  }

  // Check if any OTHER peer is already running - if so, we're definitely not the leader
  const runningPeers = allPeersList.filter((peer) => peer.runningSince && peer.ip !== myIP);
  if (runningPeers.length > 0) {
    return false; // Someone else is already running
  }

  // Special case: if only one peer exists and it's us, we're the leader
  // This handles the single-node deployment scenario
  if (allPeersList.length === 1 && allPeersList[0].ip === myIP) {
    return true;
  }

  // Multiple peers exist. Use deterministic leader election:
  // Sort by broadcastedAt first (earliest gets priority)
  // Then by IP as a tie-breaker (smallest IP wins)
  const sortedPeers = [...allPeersList].sort((a, b) => {
    // Earlier broadcastedAt wins
    if (a.broadcastedAt && b.broadcastedAt) {
      const timeDiff = a.broadcastedAt - b.broadcastedAt;
      // Only consider significant time differences (>5 seconds)
      // to avoid race conditions with clock skew
      if (Math.abs(timeDiff) > 5000) {
        return timeDiff;
      }
    }
    // Use IP as deterministic tie-breaker
    if (a.ip < b.ip) return -1;
    if (a.ip > b.ip) return 1;
    return 0;
  });

  const leader = sortedPeers[0];
  const isLeader = leader?.ip === myIP;

  // Safety check: ensure we're comparing the right node
  return isLeader && allPeersList.some((peer) => peer.ip === myIP);
}

/**
 * Syncthing Apps monitoring and configuration
 * @param {object} state - State object containing necessary variables
 * @param {Function} installedAppsFn - Function to get installed apps
 * @param {Function} getGlobalStateFn - Function to get global state
 * @param {Function} appDockerStopFn - Function to stop app docker
 * @param {Function} appDockerRestartFn - Function to restart app docker
 * @param {Function} appDeleteDataInMountPointFn - Function to delete app data
 * @param {Function} removeAppLocallyFn - Function to remove app locally
 * @returns {Promise<void>}
 */
async function syncthingApps(state, installedAppsFn, getGlobalStateFn, appDockerStopFn, appDockerRestartFn, appDeleteDataInMountPointFn, removeAppLocallyFn) {
  try {
    // Sync global state before checking
    getGlobalStateFn();
    // do not run if installationInProgress or removalInProgress
    if (state.installationInProgress || state.removalInProgress || state.updateSyncthingRunning) {
      return;
    }
    state.updateSyncthingRunning = true;
    // get list of all installed apps
    const appsInstalled = await installedAppsFn();
    if (appsInstalled.status === 'error') {
      state.updateSyncthingRunning = false;
      return;
    }
    // go through every containerData of all components of every app
    const devicesIds = [];
    const devicesConfiguration = [];
    const folderIds = [];
    const foldersConfiguration = [];
    const newFoldersConfiguration = [];
    const myDeviceId = await syncthingService.getDeviceId();

    if (!myDeviceId) {
      log.error('syncthingApps - Failed to get myDeviceId');
      state.updateSyncthingRunning = false;
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      log.error('syncthingApps - Failed to get myIP');
      state.updateSyncthingRunning = false;
      return;
    }

    const allFoldersResp = await syncthingService.getConfigFolders();
    const allDevicesResp = await syncthingService.getConfigDevices();
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data) {
      const backupSkip = state.backupInProgress.some((backupItem) => installedApp.name === backupItem);
      const restoreSkip = state.restoreInProgress.some((backupItem) => installedApp.name === backupItem);
      if (backupSkip || restoreSkip) {
        log.info(`syncthingApps - Backup is running for ${installedApp.name}, syncthing disabled for that app`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (installedApp.version <= 3) {
        const containersData = installedApp.containerData.split('|');
        // eslint-disable-next-line no-restricted-syntax
        for (let i = 0; i < containersData.length; i += 1) {
          const container = containersData[i];
          const containerDataFlags = container.split(':')[1] ? container.split(':')[0] : '';
          if (containerDataFlags.includes('s') || containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
            const containerFolder = i === 0 ? '' : `/appdata${container.split(':')[1].replace(containersData[0], '')}`;
            const identifier = installedApp.name;
            const appId = dockerService.getAppIdentifier(identifier);
            const folder = `${appsFolder + appId + containerFolder}`;
            const id = appId;
            const label = appId;
            const devices = [{ deviceID: myDeviceId }];
            const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`; // if stfolder doesn't exist creates it
            // eslint-disable-next-line no-await-in-loop
            await cmdAsync(execDIRst);
            // eslint-disable-next-line no-await-in-loop
            let locations = await appLocation(installedApp.name);
            locations.sort((a, b) => {
              if (a.ip < b.ip) {
                return -1;
              }
              if (a.ip > b.ip) {
                return 1;
              }
              return 0;
            });
            locations = locations.filter((loc) => loc.ip !== myIP);
            // eslint-disable-next-line no-restricted-syntax
            for (const appInstance of locations) {
              const ip = appInstance.ip.split(':')[0];
              const port = appInstance.ip.split(':')[1] || '16127';
              const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
              const name = `${ip}:${port}`;
              let deviceID;
              if (state.syncthingDevicesIDCache.has(name)) {
                deviceID = state.syncthingDevicesIDCache.get(name);
              } else {
                // eslint-disable-next-line no-await-in-loop
                deviceID = await getDeviceID(name);
                if (deviceID) {
                  state.syncthingDevicesIDCache.set(name, deviceID);
                }
              }
              if (deviceID) {
                if (deviceID !== myDeviceId) { // skip my id, already present
                  const folderDeviceExists = devices.find((device) => device.deviceID === deviceID);
                  if (!folderDeviceExists) { // double check if not multiple the same ids
                    devices.push({ deviceID });
                  }
                }
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
            }
            const syncthingFolder = {
              id,
              label,
              path: folder,
              devices,
              paused: false,
              type: 'sendreceive',
              rescanIntervalS: 900,
              maxConflicts: 0,
            };
            const syncFolder = allFoldersResp.data.find((x) => x.id === id);
            if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
              // Check if folder already exists and is in sendreceive mode - if so, keep it
              const folderAlreadySyncing = syncFolder && syncFolder.type === 'sendreceive';

              if (state.syncthingAppsFirstRun && !folderAlreadySyncing) {
                if (!syncFolder) {
                  log.info(`syncthingApps - First run, no sync folder - stopping and cleaning appIdentifier ${appId}`);
                  syncthingFolder.type = 'receiveonly';
                  const cache = {
                    numberOfExecutions: 1,
                  };
                  state.receiveOnlySyncthingAppsCache.set(appId, cache);
                  // eslint-disable-next-line no-await-in-loop
                  await appDockerStopFn(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                  // eslint-disable-next-line no-await-in-loop
                  await appDeleteDataInMountPointFn(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                } else {
                  log.info(`syncthingApps - First run, sync folder exists - checking container status`);
                  let containerRunning = false;
                  try {
                    const containerInspect = await dockerService.dockerContainerInspect(id);
                    containerRunning = containerInspect.State.Running;
                    log.info(`syncthingApps - App ${appId} running status: ${containerRunning}`);
                  } catch (error) {
                    log.warn(`syncthingApps - Could not inspect app ${appId}: ${error.message}`);
                  }

                  const cache = {
                    restarted: true,
                  };
                  state.receiveOnlySyncthingAppsCache.set(appId, cache);
                  if (syncFolder.type === 'receiveonly') {
                    log.info(`syncthingApps - Sync folder is receiveonly, updating cache`);
                    cache.restarted = false;
                    cache.numberOfExecutions = 1;
                    state.receiveOnlySyncthingAppsCache.set(appId, cache);
                  } else if (!containerRunning && containerDataFlags.includes('r')) {
                    log.info(`syncthingApps - Container not running, starting app ${appId}`);
                    try {
                      // eslint-disable-next-line no-await-in-loop
                      await dockerService.appDockerStart(id);
                    } catch (error) {
                      log.error(`syncthingApps - Error starting app ${appId}: ${error.message}`);
                    }
                  }
                }
              } else if (state.receiveOnlySyncthingAppsCache.has(appId) && !state.receiveOnlySyncthingAppsCache.get(appId).restarted && !folderAlreadySyncing) {
                log.info(`syncthingApps - App ${appId} in cache and not restarted, processing receive-only logic`);
                const cache = state.receiveOnlySyncthingAppsCache.get(appId);
                // eslint-disable-next-line no-await-in-loop
                const runningAppList = await appLocation(installedApp.name);

                // Check if this node is the designated leader (includes all peers for deterministic selection)
                const isLeader = isDesignatedLeader(runningAppList, myIP);

                if (isLeader) {
                  log.info(`syncthingApps - App ${appId} is the designated leader (elected from ${runningAppList.length} peers), starting immediately`);
                  syncthingFolder.type = 'sendreceive';
                  if (containerDataFlags.includes('r')) {
                    log.info(`syncthingApps - starting appIdentifier ${appId}`);
                    // eslint-disable-next-line no-await-in-loop
                    await appDockerRestartFn(id);
                  }
                  cache.restarted = true;
                  state.receiveOnlySyncthingAppsCache.set(appId, cache);
                } else {
                  // Check sync status instead of using time-based delays
                  // eslint-disable-next-line no-await-in-loop
                  const syncStatus = await getFolderSyncCompletion(appId);

                  syncthingFolder.type = 'receiveonly';
                  cache.numberOfExecutions = (cache.numberOfExecutions || 0) + 1;

                  // Fallback: max wait time (60 executions = ~30 minutes at 30s intervals)
                  const maxExecutions = 60;

                  if (syncStatus) {
                    log.info(`syncthingApps - App ${appId} sync status: ${syncStatus.syncPercentage.toFixed(2)}% (${syncStatus.inSyncBytes}/${syncStatus.globalBytes} bytes), state: ${syncStatus.state}, executions: ${cache.numberOfExecutions}`);

                    if (syncStatus.isSynced || cache.numberOfExecutions >= maxExecutions) {
                      if (syncStatus.isSynced) {
                        log.info(`syncthingApps - App ${appId} is synced (${syncStatus.syncPercentage.toFixed(2)}%), switching to sendreceive`);
                      } else {
                        log.warn(`syncthingApps - App ${appId} reached max wait time (${maxExecutions} executions), forcing start`);
                      }
                      syncthingFolder.type = 'sendreceive';
                      if (containerDataFlags.includes('r')) {
                        log.info(`syncthingApps - starting appIdentifier ${appId}`);
                        // eslint-disable-next-line no-await-in-loop
                        await appDockerRestartFn(id);
                      }
                      cache.restarted = true;
                    }
                  } else {
                    // If we can't get sync status, fall back to time-based approach
                    log.warn(`syncthingApps - Could not get sync status for ${appId}, using fallback time-based logic`);
                    runningAppList.sort((a, b) => {
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

                    const index = runningAppList.findIndex((x) => x.ip === myIP);
                    let numberOfExecutionsRequired = 2;
                    if (index > 0) {
                      numberOfExecutionsRequired = 2 + 10 * index;
                    }
                    if (numberOfExecutionsRequired > maxExecutions) {
                      numberOfExecutionsRequired = maxExecutions;
                    }
                    cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

                    log.info(`syncthingApps - App ${appId} executions: ${cache.numberOfExecutions}/${cache.numberOfExecutionsRequired}`);
                    if (cache.numberOfExecutions >= numberOfExecutionsRequired) {
                      log.info(`syncthingApps - App ${appId} reached required executions, switching to sendreceive`);
                      syncthingFolder.type = 'sendreceive';
                      if (containerDataFlags.includes('r')) {
                        log.info(`syncthingApps - starting appIdentifier ${appId}`);
                        // eslint-disable-next-line no-await-in-loop
                        await appDockerRestartFn(id);
                      }
                      cache.restarted = true;
                    }
                  }

                  state.receiveOnlySyncthingAppsCache.set(appId, cache);
                }
              } else if (!state.receiveOnlySyncthingAppsCache.has(appId) && !folderAlreadySyncing) {
                log.info(`syncthingApps - App ${appId} NOT in cache. stopping and cleaning appIdentifier ${appId}`);
                syncthingFolder.type = 'receiveonly';
                const cache = {
                  numberOfExecutions: 1,
                };
                state.receiveOnlySyncthingAppsCache.set(appId, cache);
                // eslint-disable-next-line no-await-in-loop
                await appDockerStopFn(id);
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(500);
                // eslint-disable-next-line no-await-in-loop
                await appDeleteDataInMountPointFn(id);
                // eslint-disable-next-line no-await-in-loop
                await serviceHelper.delay(500);
              } else {
                try {
                  const containerInspect = await dockerService.dockerContainerInspect(id);
                  if (!containerInspect.State.Running && containerDataFlags.includes('r')) {
                    log.info(`syncthingApps - App ${appId} is not running, starting it`);
                    // eslint-disable-next-line no-await-in-loop
                    await dockerService.appDockerStart(id);
                  }
                } catch (error) {
                  log.error(`syncthingApps - Error checking/starting app ${appId}: ${error.message}`);
                }
              }
            }
            folderIds.push(id);
            foldersConfiguration.push(syncthingFolder);
            if (!syncFolder) {
              newFoldersConfiguration.push(syncthingFolder);
            } else if (syncFolder && (syncFolder.maxConflicts !== 0 || syncFolder.paused || syncFolder.type !== syncthingFolder.type || JSON.stringify(syncFolder.devices) !== JSON.stringify(syncthingFolder.devices))) {
              newFoldersConfiguration.push(syncthingFolder);
            }
          }
        }
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const installedComponent of installedApp.compose) {
          const containersData = installedComponent.containerData.split('|');
          // eslint-disable-next-line no-restricted-syntax
          for (let i = 0; i < containersData.length; i += 1) {
            const container = containersData[i];
            const containerDataFlags = container.split(':')[1] ? container.split(':')[0] : '';
            if (containerDataFlags.includes('s') || containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
              const containerFolder = i === 0 ? '' : `/appdata${container.split(':')[1].replace(containersData[0], '')}`;
              const identifier = `${installedComponent.name}_${installedApp.name}`;
              const appId = dockerService.getAppIdentifier(identifier);
              const folder = `${appsFolder + appId + containerFolder}`;
              const id = appId;
              const label = appId;
              const devices = [{ deviceID: myDeviceId }];
              const execDIRst = `[ ! -d \\"${folder}/.stfolder\\" ] && sudo mkdir -p ${folder}/.stfolder`; // if stfolder doesn't exist creates it
              // eslint-disable-next-line no-await-in-loop
              await cmdAsync(execDIRst);
              // eslint-disable-next-line no-await-in-loop
              let locations = await appLocation(installedApp.name);
              locations.sort((a, b) => {
                if (a.ip < b.ip) {
                  return -1;
                }
                if (a.ip > b.ip) {
                  return 1;
                }
                return 0;
              });
              locations = locations.filter((loc) => loc.ip !== myIP);
              // eslint-disable-next-line no-restricted-syntax
              for (const appInstance of locations) {
                const ip = appInstance.ip.split(':')[0];
                const port = appInstance.ip.split(':')[1] || '16127';
                const addresses = [`tcp://${ip}:${+port + 2}`, `quic://${ip}:${+port + 2}`];
                const name = `${ip}:${port}`;
                let deviceID;
                if (state.syncthingDevicesIDCache.has(name)) {
                  deviceID = state.syncthingDevicesIDCache.get(name);
                } else {
                  // eslint-disable-next-line no-await-in-loop
                  deviceID = await getDeviceID(name);
                  if (deviceID) {
                    state.syncthingDevicesIDCache.set(name, deviceID);
                  }
                }
                if (deviceID) {
                  if (deviceID !== myDeviceId) { // skip my id, already present
                    const folderDeviceExists = devices.find((device) => device.deviceID === deviceID);
                    if (!folderDeviceExists) { // double check if not multiple the same ids
                      devices.push({ deviceID });
                    }
                  }
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
              }
              const syncthingFolder = {
                id,
                label,
                path: folder,
                devices,
                paused: false,
                type: 'sendreceive',
                rescanIntervalS: 900,
                maxConflicts: 0,
              };
              const syncFolder = allFoldersResp.data.find((x) => x.id === id);
              if (containerDataFlags.includes('r') || containerDataFlags.includes('g')) {
                // Check if folder already exists and is in sendreceive mode - if so, keep it
                const folderAlreadySyncing = syncFolder && syncFolder.type === 'sendreceive';

                if (state.syncthingAppsFirstRun && !folderAlreadySyncing) {
                  if (!syncFolder) {
                    log.info(`syncthingApps - First run, no sync folder - stopping and cleaning component ${appId}`);
                    syncthingFolder.type = 'receiveonly';
                    const cache = {
                      numberOfExecutions: 1,
                    };
                    state.receiveOnlySyncthingAppsCache.set(appId, cache);
                    // eslint-disable-next-line no-await-in-loop
                    await appDockerStopFn(id);
                    // eslint-disable-next-line no-await-in-loop
                    await serviceHelper.delay(500);
                    // eslint-disable-next-line no-await-in-loop
                    await appDeleteDataInMountPointFn(id);
                    // eslint-disable-next-line no-await-in-loop
                    await serviceHelper.delay(500);
                  } else {
                    log.info(`syncthingApps - First run, sync folder exists - checking container status`);
                    let containerRunning = false;
                    try {
                      const containerInspect = await dockerService.dockerContainerInspect(id);
                      containerRunning = containerInspect.State.Running;
                      log.info(`syncthingApps - Component ${appId} running status: ${containerRunning}`);
                    } catch (error) {
                      log.warn(`syncthingApps - Could not inspect component ${appId}: ${error.message}`);
                    }

                    const cache = {
                      restarted: true,
                    };
                    state.receiveOnlySyncthingAppsCache.set(appId, cache);
                    if (syncFolder.type === 'receiveonly') {
                      log.info(`syncthingApps - Sync folder is receiveonly, updating cache`);
                      cache.restarted = false;
                      cache.numberOfExecutions = 1;
                      state.receiveOnlySyncthingAppsCache.set(appId, cache);
                    } else if (!containerRunning && containerDataFlags.includes('r')) {
                      log.info(`syncthingApps - Container not running, starting component ${appId}`);
                      try {
                        // eslint-disable-next-line no-await-in-loop
                        await dockerService.appDockerStart(id);
                      } catch (error) {
                        log.error(`syncthingApps - Error starting component ${appId}: ${error.message}`);
                      }
                    }
                  }
                } else if (state.receiveOnlySyncthingAppsCache.has(appId) && !state.receiveOnlySyncthingAppsCache.get(appId).restarted && !folderAlreadySyncing) {
                  log.info(`syncthingApps - Component ${appId} in cache and not restarted, processing receive-only logic`);
                  const cache = state.receiveOnlySyncthingAppsCache.get(appId);
                  // eslint-disable-next-line no-await-in-loop
                  const runningAppList = await appLocation(installedApp.name);

                  // Check if this node is the designated leader (includes all peers for deterministic selection)
                  const isLeader = isDesignatedLeader(runningAppList, myIP);

                  if (isLeader) {
                    log.info(`syncthingApps - Component ${appId} is the designated leader (elected from ${runningAppList.length} peers), starting immediately`);
                    syncthingFolder.type = 'sendreceive';
                    if (containerDataFlags.includes('r')) {
                      log.info(`syncthingApps - starting component ${appId}`);
                      // eslint-disable-next-line no-await-in-loop
                      await appDockerRestartFn(id);
                    }
                    cache.restarted = true;
                    state.receiveOnlySyncthingAppsCache.set(appId, cache);
                  } else {
                    // Check sync status instead of using time-based delays
                    // eslint-disable-next-line no-await-in-loop
                    const syncStatus = await getFolderSyncCompletion(appId);

                    syncthingFolder.type = 'receiveonly';
                    cache.numberOfExecutions = (cache.numberOfExecutions || 0) + 1;

                    // Fallback: max wait time (60 executions = ~30 minutes at 30s intervals)
                    const maxExecutions = 60;

                    if (syncStatus) {
                      log.info(`syncthingApps - Component ${appId} sync status: ${syncStatus.syncPercentage.toFixed(2)}% (${syncStatus.inSyncBytes}/${syncStatus.globalBytes} bytes), state: ${syncStatus.state}, executions: ${cache.numberOfExecutions}`);

                      if (syncStatus.isSynced || cache.numberOfExecutions >= maxExecutions) {
                        if (syncStatus.isSynced) {
                          log.info(`syncthingApps - Component ${appId} is synced (${syncStatus.syncPercentage.toFixed(2)}%), switching to sendreceive`);
                        } else {
                          log.warn(`syncthingApps - Component ${appId} reached max wait time (${maxExecutions} executions), forcing start`);
                        }
                        syncthingFolder.type = 'sendreceive';
                        if (containerDataFlags.includes('r')) {
                          log.info(`syncthingApps - starting component ${appId}`);
                          // eslint-disable-next-line no-await-in-loop
                          await appDockerRestartFn(id);
                        }
                        cache.restarted = true;
                      }
                    } else {
                      // If we can't get sync status, fall back to time-based approach
                      log.warn(`syncthingApps - Could not get sync status for ${appId}, using fallback time-based logic`);
                      runningAppList.sort((a, b) => {
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

                      const index = runningAppList.findIndex((x) => x.ip === myIP);
                      let numberOfExecutionsRequired = 2;
                      if (index > 0) {
                        numberOfExecutionsRequired = 2 + 10 * index;
                      }
                      if (numberOfExecutionsRequired > maxExecutions) {
                        numberOfExecutionsRequired = maxExecutions;
                      }
                      cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

                      log.info(`syncthingApps - Component ${appId} executions: ${cache.numberOfExecutions}/${cache.numberOfExecutionsRequired}`);
                      if (cache.numberOfExecutions >= numberOfExecutionsRequired) {
                        log.info(`syncthingApps - Component ${appId} reached required executions, switching to sendreceive`);
                        syncthingFolder.type = 'sendreceive';
                        if (containerDataFlags.includes('r')) {
                          log.info(`syncthingApps - starting component ${appId}`);
                          // eslint-disable-next-line no-await-in-loop
                          await appDockerRestartFn(id);
                        }
                        cache.restarted = true;
                      }
                    }

                    state.receiveOnlySyncthingAppsCache.set(appId, cache);
                  }
                } else if (!state.receiveOnlySyncthingAppsCache.has(appId) && !folderAlreadySyncing) {
                  log.info(`syncthingApps - Component ${appId} NOT in cache. Stopping and cleaning appIdentifier ${appId}`);
                  syncthingFolder.type = 'receiveonly';
                  const cache = {
                    numberOfExecutions: 1,
                  };
                  state.receiveOnlySyncthingAppsCache.set(appId, cache);
                  // eslint-disable-next-line no-await-in-loop
                  await appDockerStopFn(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                  // eslint-disable-next-line no-await-in-loop
                  await appDeleteDataInMountPointFn(id);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(500);
                } else {
                  try {
                    const containerInspect = await dockerService.dockerContainerInspect(id);
                    if (!containerInspect.State.Running && containerDataFlags.includes('r')) {
                      log.info(`syncthingApps - Component ${appId} is not running, starting it`);
                      // eslint-disable-next-line no-await-in-loop
                      await dockerService.appDockerStart(id);
                    }
                  } catch (error) {
                    log.error(`syncthingApps - Error checking/starting component ${appId}: ${error.message}`);
                  }
                }
              }
              folderIds.push(id);
              foldersConfiguration.push(syncthingFolder);
              if (!syncFolder) {
                newFoldersConfiguration.push(syncthingFolder);
              } else if (syncFolder && (syncFolder.maxConflicts !== 0 || syncFolder.paused || syncFolder.type !== syncthingFolder.type || JSON.stringify(syncFolder.devices) !== JSON.stringify(syncthingFolder.devices))) {
                newFoldersConfiguration.push(syncthingFolder);
              }
            }
          }
        }
      }
    }

    // remove folders that should not be synced anymore (this shall actually not trigger)
    const nonUsedFolders = allFoldersResp.data.filter((syncthingFolder) => !folderIds.includes(syncthingFolder.id));
    // eslint-disable-next-line no-restricted-syntax
    for (const nonUsedFolder of nonUsedFolders) {
      log.info(`syncthingApps - Removing unused Syncthing of folder ${nonUsedFolder.id}`);
      // eslint-disable-next-line no-await-in-loop
      await syncthingService.adjustConfigFolders('delete', undefined, nonUsedFolder.id);
    }
    // remove obsolete devices
    const nonUsedDevices = allDevicesResp.data.filter((syncthingDevice) => !devicesIds.includes(syncthingDevice.deviceID));
    // eslint-disable-next-line no-restricted-syntax
    for (const nonUsedDevice of nonUsedDevices) {
      // exclude our deviceID
      if (nonUsedDevice.deviceID !== myDeviceId) {
        log.info(`syncthingApps - Removing unused Syncthing device ${nonUsedDevice.deviceID}`);
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.adjustConfigDevices('delete', undefined, nonUsedDevice.deviceID);
      }
    }
    // finally apply all new configuration
    // now we have new accurate devicesConfiguration and foldersConfiguration
    // add more of current devices
    // excludes our current deviceID adjustment
    if (devicesConfiguration.length > 0) {
      await syncthingService.adjustConfigDevices('put', devicesConfiguration);
    }
    if (newFoldersConfiguration.length > 0) {
      await syncthingService.adjustConfigFolders('put', newFoldersConfiguration);
    }
    // all configuration changes applied

    // check for errors in folders and if true reset that index database
    for (let i = 0; i < foldersConfiguration.length; i += 1) {
      const folder = foldersConfiguration[i];
      // eslint-disable-next-line no-await-in-loop
      const folderError = await syncthingService.getFolderIdErrors(folder.id);
      if (folderError && folderError.status === 'success' && folderError.data.errors && folderError.data.errors.length > 0) {
        log.error(`syncthingApps - Errors detected on syncthing folderId:${folder.id} - app is going to be uninstalled`);
        log.error(folderError);
        let appName = folder.id;
        if (appName.includes('_')) {
          appName = appName.split('_')[1];
        }
        // eslint-disable-next-line no-await-in-loop
        await removeAppLocallyFn(appName, null, true, false, true);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(5 * 1000);
      }
    }
    // check if restart is needed
    const restartRequired = await syncthingService.getConfigRestartRequired();
    if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
      log.info('syncthingApps - New configuration applied. Syncthing restart required, restarting...');
      await syncthingService.systemRestart();
    }
  } catch (error) {
    log.error(error);
  } finally {
    state.updateSyncthingRunning = false;
    state.syncthingAppsFirstRun = false;
    await serviceHelper.delay(30 * 1000);
    syncthingApps(state, installedAppsFn, getGlobalStateFn, appDockerStopFn, appDockerRestartFn, appDeleteDataInMountPointFn, removeAppLocallyFn);
  }
}

module.exports = {
  syncthingApps,
};
