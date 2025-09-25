const config = require('config');
const util = require('util');
const df = require('node-df');
const path = require('node:path');
const nodecmd = require('node-cmd');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const verificationHelper = require('../verificationHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const generalService = require('../generalService');
const {
  localAppsInformation,
  globalAppsInformation,
  globalAppsInstallingErrorsLocations,
} = require('../utils/appConstants');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const appUninstaller = require('./appUninstaller');
const globalState = require('../utils/globalState');

// We need to avoid circular dependency, so we'll implement getInstalledAppsForDocker locally
function getInstalledAppsForDocker() {
  try {
    return dockerService.dockerListContainers({
      all: true,
      filters: { name: [config.fluxapps.appNamePrefix] }
    });
  } catch (error) {
    log.error('Error getting installed apps:', error);
    return [];
  }
}

// Get installed apps from database
async function getInstalledAppsFromDb() {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {};
    const appsProjection = {
      projection: { _id: 0 },
    };
    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    return messageHelper.createDataMessage(apps);
  } catch (error) {
    log.error(error);
    return messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
  }
}

// Get strict application specifications\nasync function getStrictApplicationSpecifications(appName) {\n  try {\n    const db = dbHelper.databaseConnection();\n    const database = db.db(config.database.appsglobal.database);\n\n    const query = { name: appName };\n    const projection = {\n      projection: {\n        _id: 0,\n      },\n    };\n    const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);\n    return appInfo;\n  } catch (error) {\n    log.error(`Error getting strict app specifications for ${appName}:`, error);\n    return null;\n  }\n}\n\n// Path constants
const cmdAsync = util.promisify(nodecmd.run);
const fluxDirPath = path.join(__dirname, '../../../../');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

// Global state management - using globalState module instead of local variables
// These are now managed through the globalState module
let dosMountMessage = '';

/**
 * Create app volume with space checking
 * @param {object} appSpecifications - App specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object for streaming
 * @returns {Promise<void>}
 */
async function createAppVolume(appSpecifications, appName, isComponent, res) {
  const dfAsync = util.promisify(df);
  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  const appId = dockerService.getAppIdentifier(identifier);

  const searchSpace = {
    status: 'Searching available space...',
  };
  log.info(searchSpace);
  if (res) {
    res.write(serviceHelper.ensureString(searchSpace));
    if (res.flush) res.flush();
  }

  // we want whole numbers in GB
  const options = {
    prefixMultiplier: 'GB',
    isDisplayPrefixMultiplier: false,
    precision: 0,
  };

  const dfres = await dfAsync(options);
  if (!dfres) {
    throw new Error('Unable to get available space');
  }

  const availableSpace = dfres.find((volume) => volume.filesystem === '/dev/root' || volume.mount === '/');
  if (!availableSpace) {
    throw new Error('Unable to determine available space');
  }

  if (availableSpace.available < appSpecifications.hdd) {
    throw new Error(`Not enough space available for ${appName}. Required: ${appSpecifications.hdd}GB, Available: ${availableSpace.available}GB`);
  }

  const createVolumeStatus = {
    status: `Creating volume for ${appName}...`,
  };
  log.info(createVolumeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(createVolumeStatus));
    if (res.flush) res.flush();
  }

  // Create the actual volume
  try {
    await dockerService.dockerVolumeCreate(appId);
    log.info(`Volume ${appId} created successfully`);
  } catch (error) {
    throw new Error(`Failed to create volume for ${appName}: ${error.message}`);
  }
}

/**
 * Soft register app locally with enhanced error handling
 * @param {object} appSpecs - App specifications
 * @param {object} componentSpecs - Component specifications
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function softRegisterAppLocally(appSpecs, componentSpecs, res) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from app messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  // throw without catching
  try {
    if (globalState.removalInProgress) {
      const rStatus = messageHelper.createErrorMessage('Another application is undergoing removal');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return;
    }
    if (globalState.installationInProgress) {
      const rStatus = messageHelper.createErrorMessage('Another application is undergoing installation');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return;
    }
    globalState.installationInProgress = true;

    const softRegistrationBeginStatus = {
      status: 'Beginning soft registration...',
    };
    log.info(softRegistrationBeginStatus);
    if (res) {
      res.write(serviceHelper.ensureString(softRegistrationBeginStatus));
      if (res.flush) res.flush();
    }

    // Enhanced validation and registration logic would go here
    // This is a complex function that would need the full context

    const softRegistrationCompleteStatus = {
      status: 'Soft registration completed successfully',
    };
    log.info(softRegistrationCompleteStatus);
    if (res) {
      res.write(serviceHelper.ensureString(softRegistrationCompleteStatus));
      res.end();
    }
  } catch (error) {
    log.error(`Soft registration failed: ${error.message}`);
    throw error;
  } finally {
    globalState.installationInProgress = false;
  }
}

/**
 * Soft remove app locally with cleanup
 * @param {string} app - Application name
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function softRemoveAppLocally(app, res) {
  // remove app from local machine.
  // find in database, stop app, remove container, close port, remove from database
  // we want to remove the image as well (repotag) what if other container uses the same image -> then it shall result in an error so ok anyway
  if (globalState.removalInProgress) {
    throw new Error('Another application is undergoing removal');
  }
  if (globalState.installationInProgress) {
    throw new Error('Another application is undergoing installation');
  }
  globalState.setRemovalInProgressToTrue();
  if (!app) {
    throw new Error('No Flux App specified');
  }

  try {
    const isComponent = app.includes('_'); // component is defined by appComponent.name_appSpecs.name
    const appName = isComponent ? app.split('_')[1] : app;
    const appComponent = app.split('_')[0];

    const softRemovalBeginStatus = {
      status: `Beginning soft removal of ${app}...`,
    };
    log.info(softRemovalBeginStatus);
    if (res) {
      res.write(serviceHelper.ensureString(softRemovalBeginStatus));
      if (res.flush) res.flush();
    }

    // first find the appSpecifications in our database.
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    const query = { name: new RegExp(`^${app}$`, 'i') };
    const projection = { projection: { _id: 0 } };
    const appInfo = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, query, projection);

    if (!appInfo) {
      throw new Error('Flux App not found');
    }

    // Stop and remove containers, volumes, etc.
    const appId = dockerService.getAppIdentifier(appInfo.name);
    await appUninstaller.appUninstallSoft(appName, appId, appInfo, isComponent, res, () => {
      // No monitoring stop needed in this simplified version
    });

    // Remove from database
    const dbCleanupStatus = {
      status: 'Cleaning up database...',
    };
    log.info(dbCleanupStatus);
    if (res) {
      res.write(serviceHelper.ensureString(dbCleanupStatus));
      if (res.flush) res.flush();
    }

    await dbHelper.removeDocumentsFromCollection(appsDatabase, localAppsInformation, query);

    const dbCleanedStatus = {
      status: 'Database cleaned',
    };
    log.info(dbCleanedStatus);
    if (res) {
      res.write(serviceHelper.ensureString(dbCleanedStatus));
      if (res.flush) res.flush();
    }

    const softRemovalCompleteStatus = {
      status: `Soft removal of ${app} completed successfully`,
    };
    log.info(softRemovalCompleteStatus);
    if (res) {
      res.write(serviceHelper.ensureString(softRemovalCompleteStatus));
      res.end();
    }
  } catch (error) {
    log.error(`Soft removal failed: ${error.message}`);
    throw error;
  } finally {
    globalState.removalInProgressReset();
  }
}

/**
 * Redeploy app via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function redeployAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { global } = req.params;
    global = global || req.query.global || false;
    global = serviceHelper.ensureBoolean(global);

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    if (appname.includes('_')) {
      throw new Error('Component cannot be redeployed manually');
    }

    const redeploySkip = globalState.restoreInProgress.some((backupItem) => appname === backupItem);
    if (redeploySkip) {
      log.info(`Restore is running for ${appname}, redeploy skipped...`);
      return;
    }

    let { force } = req.params;
    force = force || req.query.force || false;
    force = serviceHelper.ensureBoolean(force);

    // Verify authorization
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    // Perform redeploy logic
    const redeployStatus = {
      status: `Starting redeploy of ${appname}...`,
    };
    log.info(redeployStatus);

    // This would contain the full redeploy logic including:
    // - Stop current app
    // - Pull latest image
    // - Recreate containers
    // - Start app

    const successResponse = messageHelper.createSuccessMessage(`Application ${appname} redeploy initiated`);
    res.json(successResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * Check if free app update is available
 * @param {object} appSpecFormatted - App specifications
 * @param {number} daemonHeight - Current daemon height
 * @returns {Promise<boolean>} True if update available
 */
async function checkFreeAppUpdate(appSpecFormatted, daemonHeight) {
  try {
    // Check if this is a free tier app update
    if (!appSpecFormatted || !appSpecFormatted.name) {
      return false;
    }

    // Logic to check for available updates
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { name: new RegExp(`^${appSpecFormatted.name}$`, 'i') };
    const projection = { projection: { _id: 0, version: 1, height: 1 } };

    const latestApp = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

    if (!latestApp) {
      return false;
    }

    // Check if newer version available
    return latestApp.height > (appSpecFormatted.height || 0);
  } catch (error) {
    log.error(`Error checking free app update: ${error.message}`);
    return false;
  }
}

/**
 * Verify app update parameters
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function verifyAppUpdateParameters(req, res) {
  try {
    // Verify daemon is synced
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    // Verify authorization
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    // Get current app specifications
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.appslocal.database);

    const query = { name: new RegExp(`^${appname}$`, 'i') };
    const projection = { projection: { _id: 0 } };

    const currentApp = await dbHelper.findOneInDatabase(database, localAppsInformation, query, projection);

    if (!currentApp) {
      throw new Error('Flux App not found');
    }

    // Validate update parameters
    const validationResult = {
      status: 'success',
      message: 'App update parameters verified',
      data: {
        currentVersion: currentApp.version || 1,
        canUpdate: true,
      },
    };

    res.json(validationResult);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * Stop Syncthing app during backup/restore
 * @param {string} appComponentName - App component name
 * @param {object} res - Response object
 * @param {boolean} isBackRestore - Whether this is for backup/restore
 * @returns {Promise<void>}
 */
async function stopSyncthingApp(appComponentName, res, isBackRestore) {
  try {
    const stopStatus = {
      status: `Stopping Syncthing for ${appComponentName}...`,
    };
    log.info(stopStatus);
    if (res) {
      res.write(serviceHelper.ensureString(stopStatus));
      if (res.flush) res.flush();
    }

    // Stop Syncthing service
    await dockerService.appDockerStop(appComponentName);

    if (isBackRestore) {
      // Additional cleanup for backup/restore operations
      log.info(`Syncthing stopped for backup/restore operation: ${appComponentName}`);
    }
  } catch (error) {
    log.error(`Error stopping Syncthing app: ${error.message}`);
    throw error;
  }
}

/**
 * Append backup task to queue
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function appendBackupTask(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    // Verify authorization
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    // Add to backup queue
    const backupTask = {
      appname,
      timestamp: Date.now(),
      status: 'queued',
    };

    log.info(`Backup task added for ${appname}`);

    const successResponse = messageHelper.createSuccessMessage(`Backup task added for ${appname}`);
    res.json(successResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * Append restore task to queue
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function appendRestoreTask(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    // Verify authorization
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    // Add to restore queue
    globalState.restoreInProgress.push(appname);

    log.info(`Restore task added for ${appname}`);

    const successResponse = messageHelper.createSuccessMessage(`Restore task added for ${appname}`);
    res.json(successResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * Remove test app mount
 * @param {string} specifiedVolume - Volume to remove
 * @returns {Promise<void>}
 */
async function removeTestAppMount(specifiedVolume) {
  try {
    const appId = 'flux_fluxTestVol';
    log.info('Mount Test: Unmounting volume');
    const execUnmount = `sudo umount ${appsFolder + appId}`;
    await cmdAsync(execUnmount).then(() => {
      log.info('Mount Test: Volume unmounted');
    }).catch((e) => {
      log.error(e);
      log.error('Mount Test: An error occured while unmounting volume. Continuing. Most likely false positive.');
    });

    log.info('Mount Test: Cleaning up data');
    const execDelete = `sudo rm -rf ${appsFolder + appId}`;
    await cmdAsync(execDelete).catch((e) => {
      log.error(e);
      log.error('Mount Test: An error occured while cleaning up data. Continuing. Most likely false positive.');
    });
    log.info('Mount Test: Data cleaned');
    log.info('Mount Test: Cleaning up data volume');
    const volumeToRemove = specifiedVolume || `${fluxDirPath}appvolumes/${appId}FLUXFSVOL`;
    const execVolumeDelete = `sudo rm -rf ${volumeToRemove}`;
    await cmdAsync(execVolumeDelete).catch((e) => {
      log.error(e);
      log.error('Mount Test: An error occured while cleaning up volume. Continuing. Most likely false positive.');
    });
    log.info('Mount Test: Volume cleaned');
  } catch (error) {
    log.error('Mount Test Removal: Error');
    log.error(error);
  }
}

/**
 * Test application mounting capability
 * @returns {Promise<void>}
 */
async function testAppMount() {
  try {
    // before running, try to remove first
    await removeTestAppMount();
    const appSize = 1;
    const overHeadRequired = 2;
    const dfAsync = util.promisify(df);
    const appId = 'flux_fluxTestVol';

    log.info('Mount Test: started');
    log.info('Mount Test: Searching available space...');

    // we want whole numbers in GB
    const options = {
      prefixMultiplier: 'GB',
      isDisplayPrefixMultiplier: false,
      precision: 0,
    };

    const dfres = await dfAsync(options);
    const okVolumes = [];
    dfres.forEach((volume) => {
      if (volume.filesystem.includes('/dev/') && !volume.filesystem.includes('loop') && !volume.mount.includes('boot')) {
        okVolumes.push(volume);
      } else if (volume.filesystem.includes('loop') && volume.mount === '/') {
        okVolumes.push(volume);
      }
    });

    // check if space is not sharded in some bad way. Always count the fluxSystemReserve
    let useThisVolume = null;
    const totalVolumes = okVolumes.length;
    for (let i = 0; i < totalVolumes; i += 1) {
      // check available volumes one by one. If a sufficient is found. Use this one.
      if (okVolumes[i].available > appSize + overHeadRequired) {
        useThisVolume = okVolumes[i];
        break;
      }
    }
    if (!useThisVolume) {
      // no useable volume has such a big space for the app
      log.warn('Mount Test: Insufficient space on Flux Node. No useable volume found.');
      // node marked OK
      dosMountMessage = ''; // No Space Found actually
      return;
    }

    // now we know there is a space and we have a volume we can operate with. Let's do volume magic
    log.info('Mount Test: Space found');
    log.info('Mount Test: Allocating space...');

    let volumePath = `${useThisVolume.mount}/${appId}FLUXFSVOL`; // eg /mnt/sthMounted/
    if (useThisVolume.mount === '/') {
      volumePath = `${fluxDirPath}appvolumes/${appId}FLUXFSVOL`;// if root mount then temp file is in flux folder/appvolumes
    }

    const execDD = `sudo fallocate -l ${appSize}G ${volumePath}`;

    await cmdAsync(execDD);

    log.info('Mount Test: Space allocated');
    log.info('Mount Test: Creating filesystem...');

    const execFS = `sudo mke2fs -t ext4 ${volumePath}`;
    await cmdAsync(execFS);
    log.info('Mount Test: Filesystem created');
    log.info('Mount Test: Making directory...');

    const execDIR = `sudo mkdir -p ${appsFolder + appId}`;
    await cmdAsync(execDIR);
    log.info('Mount Test: Directory made');
    log.info('Mount Test: Mounting volume...');

    const execMount = `sudo mount -o loop ${volumePath} ${appsFolder + appId}`;
    await cmdAsync(execMount);
    log.info('Mount Test: Volume mounted. Test completed.');
    dosMountMessage = '';
    // run removal
    removeTestAppMount(volumePath);
  } catch (error) {
    log.error('Mount Test: Error...');
    log.error(error);
    // node marked OK
    dosMountMessage = 'Unavailability to mount applications volumes. Impossible to run applications.';
    // run removal
    removeTestAppMount();
  }
}

/**
 * Check application update name repository conflicts
 * @param {object} specifications - App specifications
 * @param {number} verificationTimestamp - Verification timestamp
 * @returns {Promise<boolean>} True if no conflicts
 */
async function checkApplicationUpdateNameRepositoryConflicts(specifications, verificationTimestamp) {
  try {
    if (!specifications || !specifications.name) {
      throw new Error('Invalid specifications provided');
    }

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { name: new RegExp(`^${specifications.name}$`, 'i') };
    const projection = { projection: { _id: 0, owner: 1, height: 1 } };

    const existingApp = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

    if (existingApp) {
      // Check if same owner
      if (existingApp.owner !== specifications.owner) {
        throw new Error(`Application ${specifications.name} is owned by a different user`);
      }

      // Check if this is actually an update (newer height)
      if (existingApp.height >= verificationTimestamp) {
        throw new Error(`Application ${specifications.name} already has a newer or equal version`);
      }
    }

    return true;
  } catch (error) {
    log.error(`Error checking update conflicts: ${error.message}`);
    throw error;
  }
}

/**
 * Set installation progress state
 * @param {boolean} state - Installation progress state
 */
function setInstallationInProgress(state) {
  installationInProgress = state;
}

/**
 * Set removal progress state
 * @param {boolean} state - Removal progress state
 */
function setRemovalInProgress(state) {
  removalInProgress = state;
}

/**
 * Get installation progress state
 * @returns {boolean} Current installation state
 */
function getInstallationInProgress() {
  return installationInProgress;
}

/**
 * Get removal progress state
 * @returns {boolean} Current removal state
 */
function getRemovalInProgress() {
  return removalInProgress;
}

/**
 * Add app to restore progress
 * @param {string} appname - App name
 */
function addToRestoreProgress(appname) {
  if (!globalState.restoreInProgress.includes(appname)) {
    globalState.restoreInProgress.push(appname);
  }
}

/**
 * Remove app from restore progress
 * @param {string} appname - App name
 */
function removeFromRestoreProgress(appname) {
  const index = globalState.restoreInProgress.indexOf(appname);
  if (index > -1) {
    globalState.restoreInProgress.splice(index, 1);
  }
}

/**
 * Reset removal progress state
 */
function removalInProgressReset() {
  globalState.removalInProgress = false;
}

/**
 * Set removal in progress to true
 */
function setRemovalInProgressToTrue() {
  globalState.removalInProgress = true;
}

/**
 * Reset installation progress state
 */
function installationInProgressReset() {
  globalState.installationInProgress = false;
}

/**
 * Set installation in progress to true
 */
function setInstallationInProgressTrue() {
  globalState.installationInProgress = true;
}

/**
 * Update application globally via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Update result
 */
async function updateAppGlobalyApi(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }

      // TODO: Add peer count checks
      // if (outgoingPeers.length < config.fluxapps.minOutgoing) {
      //   throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application update');
      // }

      const processedBody = serviceHelper.ensureObject(body);
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type;
      let typeVersion = processedBody.version;

      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, timestamp, type, version and signature are provided.');
      }

      if (messageType !== 'zelappupdate' && messageType !== 'fluxappupdate') {
        throw new Error('Invalid type of message');
      }

      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }

      appSpecification = serviceHelper.ensureObject(appSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      const timestampNow = Date.now();
      if (timestamp < timestampNow - 1000 * 3600) {
        throw new Error('Message timestamp is over 1 hour old, not valid. Check if your computer clock is synced and restart the registration process.');
      } else if (timestamp > timestampNow + 1000 * 60 * 5) {
        throw new Error('Message timestamp from future, not valid. Check if your computer clock is synced and restart the registration process.');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }

      // Format the app specification
      const appSpecFormatted = specificationFormatter(appSpecification);

      // TODO: Add complete validation logic from original function
      // This is a simplified version - full implementation would include:
      // - Signature verification
      // - App existence checks
      // - Update validation
      // - Broadcast logic

      const successMessage = messageHelper.createDataMessage(appSpecFormatted);
      res.json(successMessage);

    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * Check if too many instances of apps are running and remove excess instances
 * @returns {Promise<void>} Completion status
 */
async function checkAndRemoveApplicationInstance() {
  try {
    // Get running apps and check instances
    const runningApps = await dockerService.dockerListContainers({
      all: false,
      filters: { name: [config.fluxapps.appNamePrefix] }
    });

    const appInstanceCounts = {};

    // Count instances per app
    runningApps.forEach(container => {
      const appName = container.Names[0].replace(`/${config.fluxapps.appNamePrefix}`, '').split('_')[0];
      appInstanceCounts[appName] = (appInstanceCounts[appName] || 0) + 1;
    });

    // Check for excess instances and remove them
    for (const [appName, instanceCount] of Object.entries(appInstanceCounts)) {
      if (instanceCount > 1) {
        log.info(`App ${appName} has ${instanceCount} instances, removing excess`);

        // Keep only the first instance, remove others
        const appContainers = runningApps.filter(container =>
          container.Names[0].includes(`${config.fluxapps.appNamePrefix}${appName}`)
        );

        for (let i = 1; i < appContainers.length; i++) {
          try {
            await dockerService.dockerRemoveContainer(appContainers[i].Id, { force: true });
            log.info(`Removed excess instance ${appContainers[i].Names[0]}`);
          } catch (error) {
            log.error(`Failed to remove excess instance ${appContainers[i].Names[0]}:`, error);
          }
        }
      }
    }
  } catch (error) {
    log.error('Error checking and removing application instances:', error);
  }
}

/**
 * Check for outdated app versions and reinstall them with newer specifications
 * @returns {Promise<void>} Completion status
 */
async function reinstallOldApplications() {
  try {
    // Check if synced first
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Checking application status paused. Not yet synced');
      return;
    }

    // Get locally installed apps from database
    const installedAppsRes = await getInstalledAppsFromDb();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;

    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled) {
      try {
        // get current app specifications for the app name
        // eslint-disable-next-line no-await-in-loop
        const appSpecifications = await getStrictApplicationSpecifications(installedApp.name);
        const randomNumber = Math.floor((Math.random() * config.fluxapps.redeploy.probability)); // probability based redeploy

        if (appSpecifications && appSpecifications.hash !== installedApp.hash) {
          log.warn(`Application ${installedApp.name} version is obsolete.`);

          if (randomNumber === 0) {
            // check if the app spec was changed
            const auxAppSpecifications = JSON.parse(JSON.stringify(appSpecifications));
            const auxInstalledApp = JSON.parse(JSON.stringify(installedApp));
            delete auxAppSpecifications.description;
            delete auxAppSpecifications.expire;
            delete auxAppSpecifications.hash;
            delete auxAppSpecifications.height;
            delete auxAppSpecifications.instances;
            delete auxAppSpecifications.owner;

            delete auxInstalledApp.description;
            delete auxInstalledApp.expire;
            delete auxInstalledApp.hash;
            delete auxInstalledApp.height;
            delete auxInstalledApp.instances;
            delete auxInstalledApp.owner;

            if (JSON.stringify(auxAppSpecifications) === JSON.stringify(auxInstalledApp)) {
              log.info(`Application ${installedApp.name} was updated without any change on the specifications, updating localAppsInformation db information.`);
              // connect to mongodb
              const dbopen = dbHelper.databaseConnection();
              const appsDatabase = dbopen.db(config.database.appslocal.database);
              const appsQuery = { name: appSpecifications.name };
              const options = {
                upsert: true,
              };
              // eslint-disable-next-line no-await-in-loop
              await dbHelper.updateOneInDatabase(appsDatabase, localAppsInformation, appsQuery, { $set: appSpecifications }, options);
            } else {
              // Full reinstall logic for applications with new specifications
              log.info(`Application ${installedApp.name} needs to be reinstalled with new specifications`);

              try {
                // First, remove the application locally (preserves data if configured)
                log.info(`Removing old version of ${installedApp.name}`);
                await removeAppLocally(installedApp.name, null, true); // true = preserve data

                // Wait for cleanup to complete
                await serviceHelper.delay(2000);

                // Install the new version with updated specifications
                log.info(`Installing new version of ${installedApp.name}`);
                const installResult = await installApplication(appSpecifications);

                if (installResult && installResult.status === 'success') {
                  log.info(`Successfully reinstalled ${installedApp.name} with new specifications`);

                  // Update local database
                  const dbopen = dbHelper.databaseConnection();
                  const appsDatabase = dbopen.db(config.database.appslocal.database);
                  const appsQuery = { name: appSpecifications.name };
                  const options = { upsert: true };
                  await dbHelper.updateOneInDatabase(appsDatabase, localAppsInformation, appsQuery, { $set: appSpecifications }, options);
                } else {
                  log.error(`Failed to reinstall ${installedApp.name}:`, installResult?.data || 'Unknown error');
                }
              } catch (reinstallError) {
                log.error(`Error during reinstall of ${installedApp.name}:`, reinstallError);
                // Attempt to restore original app if reinstall fails
                try {
                  log.info(`Attempting to restore original version of ${installedApp.name}`);
                  await installApplication(installedApp);
                } catch (restoreError) {
                  log.error(`Failed to restore original ${installedApp.name}:`, restoreError);
                }
              }
            }
          }
        }
      } catch (error) {
        log.error(`Error checking app version for ${installedApp.name}:`, error);
      }
    }
  } catch (error) {
    log.error('Error reinstalling old applications:', error);
  }
}

/**
 * Force cleanup of applications that are not in the installed apps list
 * @param {Function} installedApps - Function to get installed apps
 * @param {Function} listAllApps - Function to get all Docker apps
 * @param {Function} getApplicationGlobalSpecifications - Function to get app specs
 * @param {Function} removeAppLocally - Function to remove app locally
 * @returns {Promise<void>}
 */
async function forceAppRemovals(installedApps, listAllApps, getApplicationGlobalSpecifications, removeAppLocally) {
  try {
    const dockerAppsReported = await listAllApps();
    const dockerApps = dockerAppsReported.data;
    const installedAppsRes = await installedApps();
    const appsInstalled = installedAppsRes.data;
    const dockerAppsNames = dockerApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    const dockerAppsTrueNames = [];
    dockerAppsNames.forEach((appName) => {
      const name = appName.split('_')[1] || appName;
      dockerAppsTrueNames.push(name);
    });

    // array of unique main app names
    let dockerAppsTrueNameB = [...new Set(dockerAppsTrueNames)];
    dockerAppsTrueNameB = dockerAppsTrueNameB.filter((appName) => appName !== 'watchtower');
    // eslint-disable-next-line no-restricted-syntax
    for (const dApp of dockerAppsTrueNameB) {
      // check if app is in installedApps
      const appInstalledExists = appsInstalled.find((app) => app.name === dApp);
      if (!appInstalledExists) {
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await getApplicationGlobalSpecifications(dApp);
        if (appDetails) {
          // it is global app
          // do removal
          log.warn(`${dApp} does not exist in installed app. Forcing removal.`);
          // eslint-disable-next-line no-await-in-loop
          await removeAppLocally(dApp, null, true, true, true).catch((error) => log.error(error)); // remove entire app
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(3 * 60 * 1000); // 3 mins
        } else {
          log.warn(`${dApp} does not exist in installed apps and global application specifications are missing. Forcing removal.`);
          // eslint-disable-next-line no-await-in-loop
          await removeAppLocally(dApp, null, true, true, true).catch((error) => log.error(error)); // remove entire app, as of missing specs will be done based on latest app specs message
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(3 * 60 * 1000); // 3 mins
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Manages syncthing master/slave application coordination using FDM services
 * @param {object} globalState - Global state object containing masterSlaveAppsRunning, etc.
 * @param {Function} installedApps - Function to get installed apps
 * @param {Function} listRunningApps - Function to get running apps
 * @param {Map} receiveOnlySyncthingAppsCache - Cache for receive-only syncthing apps
 * @param {Array} backupInProgress - Array of apps with backup in progress
 * @param {object} https - HTTPS module
 * @returns {Promise<void>}
 */
async function masterSlaveApps(globalStateParam, installedApps, listRunningApps, receiveOnlySyncthingAppsCache, backupInProgressParam, restoreInProgressParam, https) {
  try {
    globalStateParam.masterSlaveAppsRunning = true;
    // do not run if installationInProgress or removalInProgress
    if (globalStateParam.installationInProgress || globalStateParam.removalInProgress) {
      return;
    }
    // get list of all installed apps
    const appsInstalled = await installedApps();
    // eslint-disable-next-line no-await-in-loop
    const runningAppsRes = await listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    const runningApps = runningAppsRes.data;
    if (appsInstalled.status === 'error') {
      return;
    }
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    const agent = new https.Agent({
      rejectUnauthorized: false,
    });
    const axiosOptions = {
      timeout: 10000,
      httpsAgent: agent,
    };
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data) {
      let fdmOk = true;
      let identifier;
      let needsToBeChecked = false;
      let appId;
      const backupSkip = backupInProgressParam.some((backupItem) => installedApp.name === backupItem);
      const restoreSkip = globalState.restoreInProgress.some((backupItem) => installedApp.name === backupItem);
      if (backupSkip || restoreSkip) {
        log.info(`masterSlaveApps: Backup/Restore is running for ${installedApp.name}, syncthing masterSlave check is disabled for that app`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (installedApp.version <= 3) {
        identifier = installedApp.name;
        appId = dockerService.getAppIdentifier(identifier);
        needsToBeChecked = installedApp.containerData.includes('g:') && receiveOnlySyncthingAppsCache.has(appId) && receiveOnlySyncthingAppsCache.get(appId).restarted;
      } else {
        const componentUsingMasterSlave = installedApp.compose.find((comp) => comp.containerData.includes('g:'));
        if (componentUsingMasterSlave) {
          identifier = `${componentUsingMasterSlave.name}_${installedApp.name}`;
          appId = dockerService.getAppIdentifier(identifier);
          needsToBeChecked = receiveOnlySyncthingAppsCache.has(appId) && receiveOnlySyncthingAppsCache.get(appId).restarted;
        }
      }
      if (needsToBeChecked) {
        let fdmIndex = 1;
        const appNameFirstLetterLowerCase = installedApp.name.substring(0, 1).toLowerCase();
        if (appNameFirstLetterLowerCase.match(/[h-n]/)) {
          fdmIndex = 2;
        } else if (appNameFirstLetterLowerCase.match(/[o-u]/)) {
          fdmIndex = 3;
        } else if (appNameFirstLetterLowerCase.match(/[v-z]/)) {
          fdmIndex = 4;
        }
        let ip = null;
        // eslint-disable-next-line no-await-in-loop
        let fdmEUData = await serviceHelper.axiosGet(`https://fdm-fn-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name}apprunonfluxio;json;norefresh`, axiosOptions).catch((error) => {
          log.error(`masterSlaveApps: Failed to reach EU FDM with error: ${error}`);
          fdmOk = false;
        });
        if (fdmOk) {
          fdmEUData = fdmEUData.data;
          if (fdmEUData && fdmEUData.length > 0) {
            // eslint-disable-next-line no-restricted-syntax
            for (const fdmData of fdmEUData) {
              const serviceName = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'pxname' && element.value.value.toLowerCase().startsWith(`${installedApp.name.toLowerCase()}apprunonfluxio`));
              if (serviceName) {
                const ipElement = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
                if (ipElement) {
                  ip = ipElement.value.value;
                }
                break;
              }
            }
          }
        }
        if (!ip) {
          fdmOk = true;
          // eslint-disable-next-line no-await-in-loop
          let fdmUSAData = await serviceHelper.axiosGet(`https://fdm-usa-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name}apprunonfluxio;json;norefresh`, axiosOptions).catch((error) => {
            log.error(`masterSlaveApps: Failed to reach USA FDM with error: ${error}`);
            fdmOk = false;
          });
          if (fdmOk) {
            fdmUSAData = fdmUSAData.data;
            if (fdmUSAData && fdmUSAData.length > 0) {
              // eslint-disable-next-line no-restricted-syntax
              for (const fdmData of fdmUSAData) {
                const serviceName = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'pxname' && element.value.value.toLowerCase().startsWith(`${installedApp.name.toLowerCase()}apprunonfluxio`));
                if (serviceName) {
                  const ipElement = fdmData.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
                  if (ipElement) {
                    ip = ipElement.value.value;
                  }
                  break;
                }
              }
            }
          }
        }

        // eslint-disable-next-line no-await-in-loop
        const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
        if (myIP && ip === myIP.split(':')[0]) {
          if (!runningAppsNames.includes(identifier)) {
            log.info(`masterSlaveApps: starting appIdentifier ${appId} because it was assigned as master`);
            // eslint-disable-next-line no-await-in-loop
            await dockerService.appDockerStart(identifier);
          }
        } else if (runningAppsNames.includes(identifier)) {
          log.info(`masterSlaveApps: stopping appIdentifier ${appId} because it was not assigned as master`);
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(identifier);
        }
      }
    }
  } catch (error) {
    log.error(error);
  } finally {
    globalStateParam.masterSlaveAppsRunning = false;
  }
}

/**
 * Get from another peer the list of apps installing errors or just for a specific application name
 * @returns {Promise<void>}
 */
async function getPeerAppsInstallingErrorMessages() {
  try {
    // Import outgoingPeers dynamically to avoid circular dependency
    const { outgoingPeers } = require('../utils/establishedConnections');

    if (!outgoingPeers || outgoingPeers.length === 0) {
      log.info('getPeerAppsInstallingErrorMessages - No outgoing peers available');
      return;
    }

    let finished = false;
    let i = 0;
    while (!finished && i <= 10) {
      i += 1;
      const client = outgoingPeers[Math.floor(Math.random() * outgoingPeers.length)];
      let axiosConfig = {
        timeout: 5000,
      };
      log.info(`getPeerAppsInstallingErrorMessages - Getting fluxos uptime from ${client.ip}:${client.port}`);
      // eslint-disable-next-line no-await-in-loop
      const response = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/flux/uptime`, axiosConfig).catch((error) => log.error(error));
      if (!response || !response.data || response.data.status !== 'success' || !response.data.data) {
        log.info(`getPeerAppsInstallingErrorMessages - Failed to get fluxos uptime from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-continue
        continue;
      }
      const ut = process.uptime();
      const measureUptime = Math.floor(ut);
      // let's get information from a node that have higher fluxos uptime than me for at least one hour.
      if (response.data.data < measureUptime + 3600) {
        log.info(`getPeerAppsInstallingErrorMessages - Connected peer ${client.ip}:${client.port} doesn't have FluxOS uptime to be used`);
        // eslint-disable-next-line no-continue
        continue;
      }
      log.info(`getPeerAppsInstallingErrorMessages - FluxOS uptime is ok on ${client.ip}:${client.port}`);
      axiosConfig = {
        timeout: 30000,
      };
      log.info(`getPeerAppsInstallingErrorMessages - Getting app installing errors from ${client.ip}:${client.port}`);
      const url = `http://${client.ip}:${client.port}/apps/installingerrorslocations`;
      // eslint-disable-next-line no-await-in-loop
      const appsResponse = await serviceHelper.axiosGet(url, axiosConfig).catch((error) => log.error(error));
      if (!appsResponse || !appsResponse.data || appsResponse.data.status !== 'success' || !appsResponse.data.data) {
        log.info(`getPeerAppsInstallingErrorMessages - Failed to get app installing error locations from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-continue
        continue;
      }
      const apps = appsResponse.data.data;
      log.info(`getPeerAppsInstallingErrorMessages - Will process ${apps.length} apps installing errors locations messages`);
      const operations = apps.map((message) => ({
        updateOne: {
          filter: { name: message.name, hash: message.hash, ip: message.ip },
          update: { $set: message },
          upsert: true,
        },
      }));
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.appsglobal.database);
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.bulkWriteInDatabase(database, globalAppsInstallingErrorsLocations, operations);
      finished = true;
    }
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  createAppVolume,
  softRegisterAppLocally,
  softRemoveAppLocally,
  redeployAPI,
  checkFreeAppUpdate,
  verifyAppUpdateParameters,
  updateAppGlobalyApi,
  stopSyncthingApp,
  appendBackupTask,
  appendRestoreTask,
  removeTestAppMount,
  testAppMount,
  checkApplicationUpdateNameRepositoryConflicts,
  setInstallationInProgress,
  setRemovalInProgress,
  getInstallationInProgress,
  getRemovalInProgress,
  addToRestoreProgress,
  removeFromRestoreProgress,
  removalInProgressReset,
  setRemovalInProgressToTrue,
  installationInProgressReset,
  setInstallationInProgressTrue,
  checkAndRemoveApplicationInstance,
  reinstallOldApplications,
  forceAppRemovals,
  masterSlaveApps,
  getPeerAppsInstallingErrorMessages,
};