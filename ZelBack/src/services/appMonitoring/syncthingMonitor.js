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
                runningAppList.sort((a, b) => {
                  if (!a.runningSince && b.runningSince) {
                    return -1;
                  }
                  if (a.runningSince && !b.runningSince) {
                    return 1;
                  }
                  if (a.runningSince < b.runningSince) {
                    return -1;
                  }
                  if (a.runningSince > b.runningSince) {
                    return 1;
                  }
                  if (a.broadcastedAt < b.broadcastedAt) {
                    return -1;
                  }
                  if (a.broadcastedAt > b.broadcastedAt) {
                    return 1;
                  }
                  if (a.ip < b.ip) {
                    return -1;
                  }
                  if (a.ip > b.ip) {
                    return 1;
                  }
                  return 0;
                });
                if (myIP) {
                  const index = runningAppList.findIndex((x) => x.ip === myIP);
                  let numberOfExecutionsRequired = 2;
                  if (index > 0) {
                    numberOfExecutionsRequired = 2 + 10 * index;
                  }
                  if (numberOfExecutionsRequired > 60) {
                    numberOfExecutionsRequired = 60;
                  }
                  cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

                  syncthingFolder.type = 'receiveonly';
                  cache.numberOfExecutions += 1;
                  log.info(`syncthingApps - App ${appId} executions: ${cache.numberOfExecutions}/${cache.numberOfExecutionsRequired}`);
                  if (cache.numberOfExecutions === cache.numberOfExecutionsRequired) {
                    log.info(`syncthingApps - App ${appId} reached exact required executions, setting to sendreceive`);
                    syncthingFolder.type = 'sendreceive';
                  } else if (cache.numberOfExecutions >= cache.numberOfExecutionsRequired + 1) {
                    log.info(`syncthingApps - changing syncthing type to sendreceive for appIdentifier ${appId}`);
                    syncthingFolder.type = 'sendreceive';
                    if (containerDataFlags.includes('r')) {
                      log.info(`syncthingApps - starting appIdentifier ${appId}`);
                      // eslint-disable-next-line no-await-in-loop
                      await appDockerRestartFn(id);
                    }
                    cache.restarted = true;
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
                  runningAppList.sort((a, b) => {
                    if (!a.runningSince && b.runningSince) {
                      return -1;
                    }
                    if (a.runningSince && !b.runningSince) {
                      return 1;
                    }
                    if (a.runningSince < b.runningSince) {
                      return -1;
                    }
                    if (a.runningSince > b.runningSince) {
                      return 1;
                    }
                    if (a.broadcastedAt < b.broadcastedAt) {
                      return -1;
                    }
                    if (a.broadcastedAt > b.broadcastedAt) {
                      return 1;
                    }
                    if (a.ip < b.ip) {
                      return -1;
                    }
                    if (a.ip > b.ip) {
                      return 1;
                    }
                    return 0;
                  });
                  if (myIP) {
                    const index = runningAppList.findIndex((x) => x.ip === myIP);
                    log.info(`syncthingApps - appIdentifier ${appId} is node index ${index}`);
                    let numberOfExecutionsRequired = 2;
                    if (index > 0) {
                      numberOfExecutionsRequired = 2 + 10 * index;
                    }
                    if (numberOfExecutionsRequired > 60) {
                      numberOfExecutionsRequired = 60;
                    }
                    cache.numberOfExecutionsRequired = numberOfExecutionsRequired;

                    syncthingFolder.type = 'receiveonly';
                    cache.numberOfExecutions += 1;
                    log.info(`syncthingApps - Component ${appId} executions: ${cache.numberOfExecutions}/${cache.numberOfExecutionsRequired}`);
                    if (cache.numberOfExecutions === cache.numberOfExecutionsRequired) {
                      log.info(`syncthingApps - Component ${appId} reached exact required executions, setting to sendreceive`);
                      syncthingFolder.type = 'sendreceive';
                    } else if (cache.numberOfExecutions >= cache.numberOfExecutionsRequired + 1) {
                      log.info(`syncthingApps - changing syncthing type to sendreceive for component ${appId}`);
                      syncthingFolder.type = 'sendreceive';
                      if (containerDataFlags.includes('r')) {
                        log.info(`syncthingApps - starting component ${appId}`);
                        // eslint-disable-next-line no-await-in-loop
                        await appDockerRestartFn(id);
                      }
                      cache.restarted = true;
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
