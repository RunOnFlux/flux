const config = require('config');

const path = require('node:path');
// eslint-disable-next-line import/no-extraneous-dependencies
const nodecmd = require('node-cmd');
const archiver = require('archiver');
const df = require('node-df');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const fs = require('fs').promises;
const execShell = util.promisify(require('child_process').exec);
const serviceHelper = require('../serviceHelper');
const dbHelper = require('../dbHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const syncthingService = require('../syncthingService');
const IOUtils = require('../IOUtils');
const log = require('../../lib/log');
const { PassThrough } = require('stream');

const fluxDirPath = path.join(__dirname, '../../../../');
// ToDo: Fix all the string concatenation in this file and use path.join()
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

const cmdAsync = util.promisify(nodecmd.run);

const localAppsInformation = config.database.appslocal.collections.appsInformation;

const globalAppsInformation = config.database.appsglobal.collections.appsInformation;

const backupInProgress = [];
const restoreInProgress = [];
const receiveOnlySyncthingAppsCache = new Map();

let dosMountMessage = '';

/**
 * To get app specifications for a specific global app.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationGlobalSpecifications(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const dbAppSpec = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

  // This is abusing the spec formatter. It's not meant for this. This whole thing
  // is kind of broken. The reason we have to use the spec formatter here is the
  // frontend is passing properties as strings (then stringify the whole object)
  // the frontend should parse the strings up front, and just pass an encrypted,
  // stringified object.
  //
  // Will fix this in v9 specs. Move to model based specs with pre sorted keys.
  let appSpec = await checkAndDecryptAppSpecs(dbAppSpec);
  if (appSpec && appSpec.version >= 8 && appSpec.enterprise) {
    const { height, hash } = appSpec;
    appSpec = specificationFormatter(appSpec);
    appSpec.height = height;
    appSpec.hash = hash;
  }
  return appSpec;
}

/**
 * Function for formatting app specifications
 * @param {object} appSpecification App specifications
 * @returns {object} Formatted app specifications
 */
function specificationFormatter(appSpecification) {
  const {
    version,
    name,
    description,
    repotag,
    owner,
    compose,
    ports,
    domains,
    enviromentParameters,
    commands,
    containerPorts,
    containerData,
    cpu,
    ram,
    hdd,
    tiered,
    priority,
    hash,
    height,
    creatorsignature,
    teamsignature,
    enterprise,
    enterpriseTier,
    signature,
    expire,
    nodes,
    clusterId,
    geolocation,
    backup,
    static: staticApp,
    instances,
  } = appSpecification;
  let formattedAppSpecification = {
    version: serviceHelper.ensureNumber(version),
    name: serviceHelper.ensureString(name),
    description: serviceHelper.ensureString(description),
    owner: serviceHelper.ensureString(owner),
    creatorsignature: serviceHelper.ensureString(creatorsignature || ''),
    teamsignature: serviceHelper.ensureString(teamsignature || ''),
    enterprise: serviceHelper.ensureBoolean(enterprise) || false,
    hash: serviceHelper.ensureString(hash || ''),
    height: serviceHelper.ensureNumber(height || 0),
    signature: serviceHelper.ensureString(signature || ''),
  };

  // Check for v8 and up app specs properties
  if (formattedAppSpecification.version >= 8) {
    formattedAppSpecification.enterpriseTier = serviceHelper.ensureString(enterpriseTier || '');
    formattedAppSpecification.expire = serviceHelper.ensureNumber(expire || 0);
    formattedAppSpecification.nodes = serviceHelper.ensureObject(nodes || []);
    formattedAppSpecification.geolocation = serviceHelper.ensureObject(geolocation || []);
    formattedAppSpecification.backup = serviceHelper.ensureObject(backup || {});
    formattedAppSpecification.clusterId = serviceHelper.ensureString(clusterId || '');
    formattedAppSpecification.static = serviceHelper.ensureBoolean(staticApp) || false;
    formattedAppSpecification.instances = serviceHelper.ensureNumber(instances || 0);
    if (formattedAppSpecification.version >= 9) {
      formattedAppSpecification.priority = serviceHelper.ensureString(priority || '');
    }
  }

  // Compose v4+ handling
  if (formattedAppSpecification.version >= 4) {
    const formattedCompose = [];
    compose.forEach((component) => {
      const formattedComponent = {
        name: serviceHelper.ensureString(component.name),
        description: serviceHelper.ensureString(component.description),
        repotag: serviceHelper.ensureString(component.repotag),
        ports: serviceHelper.ensureObject(component.ports || []),
        domains: serviceHelper.ensureObject(component.domains || []),
        environmentParameters: serviceHelper.ensureObject(component.environmentParameters || []),
        commands: serviceHelper.ensureObject(component.commands || []),
        containerPorts: serviceHelper.ensureObject(component.containerPorts || []),
        containerData: serviceHelper.ensureString(component.containerData || ''),
        cpu: serviceHelper.ensureNumber(component.cpu),
        ram: serviceHelper.ensureNumber(component.ram),
        hdd: serviceHelper.ensureNumber(component.hdd),
        tiered: serviceHelper.ensureBoolean(component.tiered) || false,
      };
      formattedCompose.push(formattedComponent);
    });
    formattedAppSpecification.compose = formattedCompose;
  } else {
    // Legacy v1-v3 handling
    formattedAppSpecification = {
      ...formattedAppSpecification,
      repotag: serviceHelper.ensureString(repotag),
      ports: serviceHelper.ensureObject(ports || []),
      domains: serviceHelper.ensureObject(domains || []),
      environmentParameters: serviceHelper.ensureObject(enviromentParameters || []),
      commands: serviceHelper.ensureObject(commands || []),
      containerPorts: serviceHelper.ensureObject(containerPorts || []),
      containerData: serviceHelper.ensureString(containerData || ''),
      cpu: serviceHelper.ensureNumber(cpu),
      ram: serviceHelper.ensureNumber(ram),
      hdd: serviceHelper.ensureNumber(hdd),
      tiered: serviceHelper.ensureBoolean(tiered) || false,
    };
  }

  return formattedAppSpecification;
}

/**
 * Function to check and decrypt app specs if needed
 * @param {object} appSpec App specification object
 * @param {object} options Additional options
 * @returns {object} Decrypted app specifications
 */
async function checkAndDecryptAppSpecs(appSpec, options = {}) {
  if (!appSpec) {
    return null;
  }

  // If enterprise and encrypted, decrypt it
  if (appSpec.enterprise && appSpec.signature) {
    try {
      // Enterprise decryption logic would go here
      // For now, just return the spec as-is
      return appSpec;
    } catch (error) {
      log.error('Failed to decrypt enterprise app specs:', error);
      return null;
    }
  }

  return appSpec;
}

/**
 * To get app specifications for a specific app if global/local status is unkown. First searches global apps and if not found then searches local apps.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationSpecifications(appName) {
  let appSpec = await getApplicationGlobalSpecifications(appName);
  if (!appSpec) {
    appSpec = await getApplicationLocalSpecifications(appName);
  }
  return appSpec;
}

/**
 * To get app specifications for a specific local app.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationLocalSpecifications(appName) {
  // This would typically call availableApps() but since we're extracting,
  // we'll leave this as a stub
  return null;
}

/**
 * Start monitoring for an app
 * @param {string} appName App name
 */
function startAppMonitoring(appName) {
  // Monitoring logic would go here
  // This is a stub for the extracted file
  log.info(`Starting monitoring for ${appName}`);
}

/**
 * Stop monitoring for an app
 * @param {string} appName App name
 * @param {boolean} deleteData Whether to delete monitoring data
 */
function stopAppMonitoring(appName, deleteData) {
  // Monitoring logic would go here
  // This is a stub for the extracted file
  log.info(`Stopping monitoring for ${appName}, deleteData: ${deleteData}`);
}

/**
 * To stop syncthing for an app component
 * @param {string} appComponentName App component name
 * @param {object} res Response object
 * @param {boolean} isBackRestore Whether this is for backup/restore
 */
async function stopSyncthingApp(appComponentName, res, isBackRestore) {
  try {
    const identifier = appComponentName;
    const appId = dockerService.getAppIdentifier(identifier);
    if (!isBackRestore && receiveOnlySyncthingAppsCache.has(appId)) {
      receiveOnlySyncthingAppsCache.delete(appId);
    }
    const folder = `${appsFolder + appId}`;
    const allSyncthingFolders = await syncthingService.getConfigFolders();
    if (allSyncthingFolders.status === 'error') {
      return;
    }
    let folderId = null;
    // eslint-disable-next-line no-restricted-syntax
    for (const syncthingFolder of allSyncthingFolders.data) {
      if (syncthingFolder.path === folder || syncthingFolder.path.includes(`${folder}/`)) {
        folderId = syncthingFolder.id;
      }
      if (folderId) {
        const adjustSyncthingA = {
          status: `Stopping syncthing on folder ${syncthingFolder.path}...`,
        };
        // remove folder from syncthing
        // eslint-disable-next-line no-await-in-loop
        await syncthingService.adjustConfigFolders('delete', undefined, folderId);
        // check if restart is needed
        // eslint-disable-next-line no-await-in-loop
        const restartRequired = await syncthingService.getConfigRestartRequired();
        if (restartRequired.status === 'success' && restartRequired.data.requiresRestart === true) {
          log.info('Syncthing restart required, restarting...');
          // eslint-disable-next-line no-await-in-loop
          await syncthingService.systemRestart();
        }
        const adjustSyncthingB = {
          status: 'Syncthing adjusted',
        };
        log.info(adjustSyncthingA);
        if (res) {
          res.write(serviceHelper.ensureString(adjustSyncthingA));
          if (res.flush) res.flush();
        }
        log.info(adjustSyncthingB);
        if (res) {
          res.write(serviceHelper.ensureString(adjustSyncthingB));
          if (res.flush) res.flush();
        }
        folderId = null;
        break;
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To start an app. Start each component if the app is using Docker Compose.
 * @param {string} appname Request.
 */
async function appDockerStart(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerStart(appname);
      startAppMonitoring(appname);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerStart(appname);
        startAppMonitoring(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStart(`${appComponent.name}_${appSpecs.name}`);
          startAppMonitoring(`${appComponent.name}_${appSpecs.name}`);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To stop an app. Stop each component if the app is using Docker Compose.
 * Function to ba called before starting synthing in r: mode.
 * @param {string} appname Request.
 */
async function appDockerStop(appname) {
  try {
    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_'); // it is a component restart. Proceed with restarting just component
    if (isComponent) {
      await dockerService.appDockerStop(appname);
      stopAppMonitoring(appname, false);
    } else {
      // ask for restarting entire composed application
      // eslint-disable-next-line no-use-before-define
      const appSpecs = await getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerStop(appname);
        stopAppMonitoring(appname, false);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerStop(`${appComponent.name}_${appSpecs.name}`);
          stopAppMonitoring(`${appComponent.name}_${appSpecs.name}`, false);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Get list of installed apps from database
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function installedApps(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appslocal.database);
    const query = {};
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, localAppsInformation, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    return res ? res.json(resultsResponse) : resultsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Remove app locally - stub for extracted file
 * @param {string} appName App name to remove
 * @returns {Promise} Promise resolving when app is removed
 */
async function removeAppLocally(appName) {
  // This would typically contain the full implementation
  // For the extracted file, this is a stub
  log.info(`Removing app locally: ${appName}`);
  return Promise.resolve();
}

/**
 * Soft redeploy app - stub for extracted file
 * @param {object} appSpecs App specifications
 * @returns {Promise} Promise resolving when app is redeployed
 */
async function softRedeploy(appSpecs) {
  // This would typically contain the full implementation
  // For the extracted file, this is a stub
  log.info(`Soft redeploying app: ${appSpecs.name}`);
  return Promise.resolve();
}

// Unmount Testing Functionality
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

// Mount Testing Functionality
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
  * Check if the running application container, volumes are using less than maximum allowed space
  * If not, then softly redeploy the application, potentially remove
  * This is to prevent applications from using too much space
*/
let appsStorageViolations = [];
async function checkStorageSpaceForApps() {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const dockerSystemDF = await dockerService.dockerGetUsage();
    const allowedMaximum = (config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap) * 1000 * 1024 * 1024;
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      if (app.version >= 4) {
        let totalSize = 0;
        // eslint-disable-next-line no-restricted-syntax
        for (const component of app.compose) {
          // compose
          const identifier = `${component.name}_${app.name}`;
          const contId = dockerService.getAppDockerNameIdentifier(identifier);
          const contExists = dockerSystemDF.Containers.find((cont) => cont.Names[0] === contId);
          if (contExists) {
            totalSize += contExists.SizeRootFs;
          }
        }
        const maxAllowedSize = app.compose.length * allowedMaximum;
        if (totalSize > maxAllowedSize) { // here we allow that one component can take more space than allowed as long as total per entire app is lower than total allowed
          // soft redeploy, todo remove the entire app if multiple violations
          appsStorageViolations.push(app.name);
          const occurancies = appsStorageViolations.filter((appName) => (appName) === app.name).length;
          if (occurancies > 3) { // if more than 3 violations, then remove the app
            log.warn(`Application ${app.name} is using ${totalSize} space which is more than allowed ${maxAllowedSize}. Removing...`);
            // eslint-disable-next-line no-await-in-loop
            await removeAppLocally(app.name).catch((error) => {
              log.error(error);
            });
            const adjArray = appsStorageViolations.filter((appName) => (appName) !== app.name);
            appsStorageViolations = adjArray;
          } else {
            log.warn(`Application ${app.name} is using ${totalSize} space which is more than allowed ${maxAllowedSize}. Soft redeploying...`);
            // eslint-disable-next-line no-await-in-loop
            await softRedeploy(app).catch((error) => {
              log.error(error);
            });
          }
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(2 * 60 * 1000); // 2 mins
        }
      } else {
        const identifier = app.name;
        const contId = dockerService.getAppDockerNameIdentifier(identifier);
        const contExists = dockerSystemDF.Containers.find((cont) => cont.Names[0] === contId);
        if (contExists) {
          if (contExists.SizeRootFs > allowedMaximum) {
            // soft redeploy, todo remove the entire app if multiple violations
            appsStorageViolations.push(app.name);
            const occurancies = appsStorageViolations.filter((appName) => (appName) === app.name).length;
            if (occurancies > 3) { // if more than 3 violations, then remove the app
              log.warn(`Application ${app.name} is using ${contExists.SizeRootFs} space which is more than allowed ${allowedMaximum}. Removing...`);
              // eslint-disable-next-line no-await-in-loop
              await removeAppLocally(app.name).catch((error) => {
                log.error(error);
              });
              const adjArray = appsStorageViolations.filter((appName) => (appName) !== app.name);
              appsStorageViolations = adjArray;
            } else {
              log.warn(`Application ${app.name} is using ${contExists.SizeRootFs} space which is more than allowed ${allowedMaximum}. Soft redeploying...`);
              // eslint-disable-next-line no-await-in-loop
              await softRedeploy(app).catch((error) => {
                log.error(error);
              });
            }
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(2 * 60 * 1000); // 2 mins
          }
        }
      }
    }
    setTimeout(() => {
      checkStorageSpaceForApps();
    }, 30 * 60 * 1000);
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      checkStorageSpaceForApps();
    }, 30 * 60 * 1000);
  }
}

/**
 * Send a chunk of data as a response to the client with a delay.
 * @async
 * @param {object} res - Response object.
 * @param {string} chunk - Data chunk to be sent.
 * @returns {Promise<void>} - A Promise that resolves after sending the chunk with a delay.
 */
async function sendChunk(res, chunk) {
  return new Promise((resolve) => {
    setTimeout(() => {
      res.write(`${chunk}\n`);
      if (res.flush) res.flush();
      resolve();
    }, 3000); // Adjust the delay as needed
  });
}

/**
 * Append a backup task based on the provided parameters.
 * @async
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {boolean} - True if the backup task is successfully appended, otherwise false.
 * @throws {object} - JSON error response if an error occurs.
 */
async function appendBackupTask(req, res) {
  let appname;
  let backup;
  try {
    const processedBody = serviceHelper.ensureObject(req.body);
    log.info(processedBody);
    // eslint-disable-next-line prefer-destructuring
    appname = processedBody.appname;
    // eslint-disable-next-line prefer-destructuring
    backup = processedBody.backup;
    if (!appname || !backup) {
      throw new Error('appname and backup parameters are mandatory');
    }
    const indexBackup = backupInProgress.indexOf(appname);
    if (indexBackup !== -1) {
      throw new Error('Backup in progress...');
    }
    const hasTrueBackup = backup.some((backupitem) => backupitem.backup);
    if (hasTrueBackup === false) {
      throw new Error('No backup jobs...');
    }
  } catch (error) {
    log.error(error);
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
  }
  try {
    const authorized = res ? await verificationHelper.verifyPrivilege('appownerabove', req, appname) : true;
    if (authorized === true) {
      backupInProgress.push(appname);
      // Check if app using syncthing, stop syncthing for all component that using it
      const appDetails = await getApplicationGlobalSpecifications(appname);
      // eslint-disable-next-line no-restricted-syntax
      const syncthing = appDetails.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
      if (syncthing) {
        // eslint-disable-next-line no-await-in-loop
        await sendChunk(res, `Stopping syncthing for ${appname}\n`);
        // eslint-disable-next-line no-await-in-loop
        await stopSyncthingApp(appname, res, true);
      }

      await sendChunk(res, 'Stopping application...\n');
      await appDockerStop(appname);
      await serviceHelper.delay(5 * 1000);
      // eslint-disable-next-line no-restricted-syntax
      for (const component of backup) {
        if (component.backup) {
          // eslint-disable-next-line no-await-in-loop
          const componentPath = await IOUtils.getVolumeInfo(appname, component.component, 'B', 0, 'mount');
          const targetPath = `${componentPath[0].mount}/appdata`;
          const tarGzPath = `${componentPath[0].mount}/backup/local/backup_${component.component.toLowerCase()}.tar.gz`;
          // eslint-disable-next-line no-await-in-loop
          const existStatus = await IOUtils.checkFileExists(`${componentPath[0].mount}/backup/local/backup_${component.component.toLowerCase()}.tar.gz`);
          if (existStatus === true) {
            // eslint-disable-next-line no-await-in-loop
            await sendChunk(res, `Removing exists backup archive for ${component.component.toLowerCase()}...\n`);
            // eslint-disable-next-line no-await-in-loop
            await IOUtils.removeFile(`${componentPath[0].mount}/backup/local/backup_${component.component.toLowerCase()}.tar.gz`);
          }
          // eslint-disable-next-line no-await-in-loop
          await sendChunk(res, `Creating backup archive for ${component.component.toLowerCase()}...\n`);
          // eslint-disable-next-line no-await-in-loop
          const tarStatus = await IOUtils.createTarGz(targetPath, tarGzPath);
          if (tarStatus.status === false) {
            // eslint-disable-next-line no-await-in-loop
            await IOUtils.removeFile(`${componentPath[0].mount}/backup/local/backup_${component.component.toLowerCase()}.tar.gz`);
            throw new Error(`Error: Failed to create backup archive for ${component.component.toLowerCase()}, ${tarStatus.error}`);
          }
        }
      }
      await serviceHelper.delay(5 * 1000);
      await sendChunk(res, 'Starting application...\n');
      if (!syncthing) {
        await appDockerStart(appname);
      } else {
        const componentsWithoutGSyncthing = appDetails.compose.filter((comp) => !comp.containerData.includes('g:'));
        // eslint-disable-next-line no-restricted-syntax
        for (const component of componentsWithoutGSyncthing) {
          // eslint-disable-next-line no-await-in-loop
          await appDockerStart(`${component.name}_${appname}`);
        }
      }
      await sendChunk(res, 'Finalizing...\n');
      await serviceHelper.delay(5 * 1000);
      const indexToRemove = backupInProgress.indexOf(appname);
      backupInProgress.splice(indexToRemove, 1);
      res.end();
      return true;
      // eslint-disable-next-line no-else-return
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const indexToRemove = backupInProgress.indexOf(appname);
    if (indexToRemove >= 0) {
      backupInProgress.splice(indexToRemove, 1);
    }
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
  }
}

/**
 * Append a restore task based on the provided parameters.
 * @async
 * @param {object} req - Request object.
 * @param {object} res - Response object.
 * @returns {boolean} - True if the restore task is successfully appended, otherwise false.
 * @throws {object} - JSON error response if an error occurs.
 */
async function appendRestoreTask(req, res) {
  let appname;
  let restore;
  let type;
  try {
    const processedBody = serviceHelper.ensureObject(req.body);
    log.info(processedBody);
    // eslint-disable-next-line prefer-destructuring
    appname = processedBody.appname;
    // eslint-disable-next-line prefer-destructuring
    restore = processedBody.restore;
    // eslint-disable-next-line prefer-destructuring
    type = processedBody.type;
    if (!appname || !restore || !type) {
      throw new Error('appname, restore and type parameters are mandatory');
    }
    const indexRestore = restoreInProgress.indexOf(appname);
    if (indexRestore !== -1) {
      throw new Error(`Restore for app ${appname} is running...`);
    }
    const hasTrueRestore = restore.some((restoreitem) => restoreitem.restore);
    if (hasTrueRestore === false) {
      throw new Error('No restore jobs...');
    }
  } catch (error) {
    log.error(error);
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
  }
  try {
    const authorized = res ? await verificationHelper.verifyPrivilege('appownerabove', req, appname) : true;
    if (authorized === true) {
      const componentItem = restore.map((restoreItem) => restoreItem);
      restoreInProgress.push(appname);
      const appDetails = await getApplicationGlobalSpecifications(appname);
      // eslint-disable-next-line no-restricted-syntax
      const syncthing = appDetails.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
      if (syncthing) {
        // eslint-disable-next-line no-await-in-loop
        await sendChunk(res, `Stopping syncthing for ${appname}\n`);
        // eslint-disable-next-line no-await-in-loop
        await stopSyncthingApp(appname, res, true);
      }
      await sendChunk(res, 'Stopping application...\n');
      await appDockerStop(appname);
      await serviceHelper.delay(5 * 1000);
      // eslint-disable-next-line no-restricted-syntax
      for (const component of restore) {
        if (component.restore) {
          // eslint-disable-next-line no-await-in-loop
          const componentVolumeInfo = await IOUtils.getVolumeInfo(appname, component.component, 'B', 0, 'mount');
          const appDataPath = `${componentVolumeInfo[0].mount}/appdata`;
          // eslint-disable-next-line no-await-in-loop
          await sendChunk(res, `Removing ${component.component} component data...\n`);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(2 * 1000);
          // eslint-disable-next-line no-await-in-loop
          await IOUtils.removeDirectory(appDataPath, true);
        }
      }

      if (type === 'remote') {
        // eslint-disable-next-line no-restricted-syntax
        for (const restoreItem of componentItem) {
          if (restoreItem?.url !== '') {
            // eslint-disable-next-line no-await-in-loop
            const componentPath = await IOUtils.getVolumeInfo(appname, restoreItem.component, 'B', 0, 'mount');
            // eslint-disable-next-line no-await-in-loop
            await IOUtils.removeDirectory(`${componentPath[0].mount}/backup/remote`, true);
            // eslint-disable-next-line no-await-in-loop
            await sendChunk(res, `Downloading ${restoreItem.url}...\n`);
            // eslint-disable-next-line no-await-in-loop
            const downloadStatus = await IOUtils.downloadFileFromUrl(restoreItem.url, `${componentPath[0].mount}/backup/remote`, restoreItem.component, true);
            if (downloadStatus !== true) {
              throw new Error(`Error: Failed to download ${restoreItem.url}...`);
            }
          }
        }
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const component of restore) {
        if (component.restore) {
          // eslint-disable-next-line no-await-in-loop
          const componentPath = await IOUtils.getVolumeInfo(appname, component.component, 'B', 0, 'mount');
          const targetPath = `${componentPath[0].mount}/appdata`;
          const tarGzPath = `${componentPath[0].mount}/backup/${type}/backup_${component.component.toLowerCase()}.tar.gz`;
          // eslint-disable-next-line no-await-in-loop
          await sendChunk(res, `Unpacking backup archive for ${component.component.toLowerCase()}...\n`);
          // eslint-disable-next-line no-await-in-loop
          const tarStatus = await IOUtils.untarFile(targetPath, tarGzPath);
          if (tarStatus.status === false) {
            throw new Error(`Error: Failed to unpack archive file for ${component.component.toLowerCase()}, ${tarStatus.error}`);
          } else {
            // eslint-disable-next-line no-await-in-loop
            await sendChunk(res, `Removing backup file for ${component.component.toLowerCase()}...\n`);
            // eslint-disable-next-line no-await-in-loop
            await IOUtils.removeFile(tarGzPath);
          }
          const syncthingAux = appDetails.compose.find((comp) => comp.name === component.component && (comp.containerData.includes('g:') || comp.containerData.includes('r:')));
          if (syncthingAux) {
            const identifier = `${component.component}_${appname}`;
            const appId = dockerService.getAppIdentifier(identifier);
            const cache = {
              restarted: true,
              numberOfExecutionsRequired: 4,
              numberOfExecutions: 10,
            };
            receiveOnlySyncthingAppsCache.set(appId, cache);
          }
        }
      }
      await serviceHelper.delay(1 * 5 * 1000);
      await sendChunk(res, 'Starting application...\n');
      await appDockerStart(appname);
      if (syncthing) {
        await sendChunk(res, 'Redeploying other instances...\n');
        // executeAppGlobalCommand would need to be imported or stubbed
        // executeAppGlobalCommand(appname, 'redeploy', req.headers.zelidauth, true);
        await serviceHelper.delay(1 * 60 * 1000);
      }
      await sendChunk(res, 'Finalizing...\n');
      await serviceHelper.delay(5 * 1000);
      const indexToRemove = restoreInProgress.indexOf(appname);
      restoreInProgress.splice(indexToRemove, 1);
      res.end();
      return true;
      // eslint-disable-next-line no-else-return
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const indexToRemove = restoreInProgress.indexOf(appname);
    if (indexToRemove >= 0) {
      restoreInProgress.splice(indexToRemove, 1);
    }
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
  }
}

/**
 * To get a list of files with their details for all files.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const options = {
        withFileTypes: false,
      };
      const files = await fs.readdir(filepath, options);
      const filesWithDetails = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const fileStats = await fs.lstat(`${filepath}/${file}`);
        const isDirectory = fileStats.isDirectory();
        const isFile = fileStats.isFile();
        const isSymbolicLink = fileStats.isSymbolicLink();
        let fileFolderSize = fileStats.size;
        if (isDirectory) {
          // eslint-disable-next-line no-await-in-loop
          fileFolderSize = await IOUtils.getFolderSize(`${filepath}/${file}`);
        }
        const detailedFile = {
          name: file,
          size: fileFolderSize, // bytes
          isDirectory,
          isFile,
          isSymbolicLink,
          createdAt: fileStats.birthtime,
          modifiedAt: fileStats.mtime,
        };
        filesWithDetails.push(detailedFile);
      }
      const resultsResponse = messageHelper.createDataMessage(filesWithDetails);
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To create a folder
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function createAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder || '';
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo mkdir "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const resultsResponse = messageHelper.createSuccessMessage('Folder Created');
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To rename a file or folder. Oldpath is relative path to default fluxshare directory; newname is just a new name of folder/file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function renameAppsObject(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { oldpath } = req.params;
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!appname || !component) {
        throw new Error('appname and component parameters are mandatory');
      }
      oldpath = oldpath || req.query.oldpath;
      if (!oldpath) {
        throw new Error('No file nor folder to rename specified');
      }
      let { newname } = req.params;
      newname = newname || req.query.newname;
      if (!newname) {
        throw new Error('No new name specified');
      }
      if (newname.includes('/')) {
        throw new Error('New name is invalid');
      }
      // stop sharing of ALL files that start with the path
      const fileURI = encodeURIComponent(oldpath);
      let oldfullpath;
      let newfullpath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        oldfullpath = `${appVolumePath[0].mount}/appdata/${oldpath}`;
        newfullpath = `${appVolumePath[0].mount}/appdata/${newname}`;
      } else {
        throw new Error('Application volume not found');
      }
      const fileURIArray = fileURI.split('%2F');
      fileURIArray.pop();
      if (fileURIArray.length > 0) {
        const renamingFolder = fileURIArray.join('/');
        newfullpath = `${appVolumePath[0].mount}/appdata/${renamingFolder}/${newname}`;
      }
      const cmd = `sudo mv -T "${oldfullpath}" "${newfullpath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const response = messageHelper.createSuccessMessage('Rename successful');
      res.json(response);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To remove a specified shared file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function removeAppsObject(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { object } = req.params;
      object = object || req.query.object;
      let { component } = req.params;
      component = component || req.query.component || '';
      if (!component) {
        throw new Error('component parameter is mandatory');
      }
      if (!object) {
        throw new Error('No object specified');
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${object}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo rm -rf "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      const response = messageHelper.createSuccessMessage('File Removed');
      res.json(response);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To download a zip folder for a specified directory. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @param {boolean} authorized False until verified as an admin.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function downloadAppsFolder(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { folder } = req.params;
      folder = folder || req.query.folder;
      let { component } = req.params;
      component = component || req.query.component;
      if (!folder || !component) {
        const errorResponse = messageHelper.createErrorMessage('folder and component parameters are mandatory');
        res.json(errorResponse);
        return;
      }
      let folderpath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        folderpath = `${appVolumePath[0].mount}/appdata/${folder}`;
      } else {
        throw new Error('Application volume not found');
      }
      const zip = archiver('zip');
      const sizeStream = new PassThrough();
      let compressedSize = 0;
      sizeStream.on('data', (chunk) => {
        compressedSize += chunk.length;
      });
      sizeStream.on('end', () => {
        const folderNameArray = folderpath.split('/');
        const folderName = folderNameArray[folderNameArray.length - 1];
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-disposition': `attachment; filename=${folderName}.zip`,
          'Content-Length': compressedSize,
        });
        // Now, pipe the compressed data to the response stream
        const zipFinal = archiver('zip');
        zipFinal.pipe(res);
        zipFinal.directory(folderpath, false);
        zipFinal.finalize();
      });
      zip.pipe(sizeStream);
      zip.directory(folderpath, false);
      zip.finalize();
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

/**
 * To download a specified file. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function downloadAppsFile(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname || '';
    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (authorized) {
      let { file } = req.params;
      file = file || req.query.file;
      let { component } = req.params;
      component = component || req.query.component;
      if (!file || !component) {
        const errorResponse = messageHelper.createErrorMessage('file and component parameters are mandatory');
        res.json(errorResponse);
        return;
      }
      let filepath;
      const appVolumePath = await IOUtils.getVolumeInfo(appname, component, 'B', 'mount', 0);
      if (appVolumePath.length > 0) {
        filepath = `${appVolumePath[0].mount}/appdata/${file}`;
      } else {
        throw new Error('Application volume not found');
      }
      const cmd = `sudo chmod 777 "${filepath}"`;
      await execShell(cmd, { maxBuffer: 1024 * 1024 * 10 });
      // beautify name
      const fileNameArray = filepath.split('/');
      const fileName = fileNameArray[fileNameArray.length - 1];
      res.download(filepath, fileName);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    try {
      res.write(serviceHelper.ensureString(errorResponse));
      res.end();
    } catch (e) {
      log.error(e);
    }
  }
}

module.exports = {
  // File system operations
  getAppsFolder,
  createAppsFolder,
  renameAppsObject,
  removeAppsObject,
  downloadAppsFolder,
  downloadAppsFile,

  // Backup and restore operations
  appendBackupTask,
  appendRestoreTask,
  sendChunk,

  // Mount testing functionality
  testAppMount,
  removeTestAppMount,

  // Storage operations
  checkStorageSpaceForApps,

  // Helper functions for internal use
  getApplicationGlobalSpecifications,
  stopSyncthingApp,
  appDockerStart,
  appDockerStop,
  installedApps,
  removeAppLocally,
  softRedeploy,
  specificationFormatter,
  checkAndDecryptAppSpecs,
  getApplicationSpecifications,
  getApplicationLocalSpecifications,
  startAppMonitoring,
  stopAppMonitoring,
};
