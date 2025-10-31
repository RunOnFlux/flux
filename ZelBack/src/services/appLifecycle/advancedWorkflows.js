const config = require('config');
const util = require('util');
const df = require('node-df');
const path = require('node:path');
const nodecmd = require('node-cmd');
const systemcrontab = require('crontab');
const axios = require('axios');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const verificationHelper = require('../verificationHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const generalService = require('../generalService');
const upnpService = require('../upnpService');
const {
  localAppsInformation,
  globalAppsInformation,
  globalAppsInstallingErrorsLocations,
  globalAppsMessages,
  globalAppsLocations,
} = require('../utils/appConstants');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { stopAppMonitoring } = require('../appManagement/appInspector');
const globalState = require('../utils/globalState');

const isArcane = Boolean(process.env.FLUXOS_PATH);

// Legacy apps that use old gateway IP assignment method
const appsThatMightBeUsingOldGatewayIpAssignment = ['HNSDoH', 'dane', 'fdm', 'Jetpack2', 'fdmdedicated', 'isokosse', 'ChainBraryDApp', 'health', 'ethercalc'];

// Master/slave app tracking
const mastersRunningGSyncthingApps = new Map();
const timeTostartNewMasterApp = new Map();

// Promisified functions
const cmdAsync = util.promisify(nodecmd.run);
const crontabLoad = util.promisify(systemcrontab.load);
const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;

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

// Get strict application specifications
async function getStrictApplicationSpecifications(appName) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { name: appName };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
    return appInfo;
  } catch (error) {
    log.error(`Error getting strict app specifications for ${appName}:`, error);
    return null;
  }
}

/**
 * To get previous app specifications.
 * @param {object} specifications App sepcifications.
 * @param {object} verificationTimestamp Message timestamp
 * @returns {object} App specifications.
 */
async function getPreviousAppSpecifications(specifications, verificationTimestamp) {
  // we may not have the application in global apps. This can happen when we receive the message
  // after the app has already expired AND we need to get message right before our message.
  // Thus using messages system that is accurate
  const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const appsQuery = {
    'appSpecifications.name': specifications.name,
  };
  const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
  let latestPermanentRegistrationMessage;
  permanentAppMessage.forEach((foundMessage) => {
    // has to be registration message
    const validTypes = ['zelappregister', 'fluxappregister', 'zelappupdate', 'fluxappupdate'];
    if (validTypes.includes(foundMessage.type)) {
      if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= verificationTimestamp) {
        // no message and found message is not newer than our message
        latestPermanentRegistrationMessage = foundMessage;
      } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) {
        // we have some message and the message is quite new
        if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp
          && foundMessage.timestamp <= verificationTimestamp) {
          // but our message is newer. foundMessage has to have lower timestamp than our new message
          latestPermanentRegistrationMessage = foundMessage;
        }
      }
    }
  });
  // some early app have zelAppSepcifications
  const appsQueryB = {
    'zelAppSpecifications.name': specifications.name,
  };
  const permanentAppMessageB = await dbHelper.findInDatabase(database, globalAppsMessages, appsQueryB, projection);
  permanentAppMessageB.forEach((foundMessage) => {
    // has to be registration message
    const validTypes = ['zelappregister', 'fluxappregister', 'zelappupdate', 'fluxappupdate'];
    if (validTypes.includes(foundMessage.type)) {
      if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= verificationTimestamp) {
        // no message and found message is not newer than our message
        latestPermanentRegistrationMessage = foundMessage;
      } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) {
        // we have some message and the message is quite new
        if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp
          && foundMessage.timestamp <= verificationTimestamp) {
          // but our message is newer. foundMessage has to have lower timestamp than our new message
          latestPermanentRegistrationMessage = foundMessage;
        }
      }
    }
  });
  if (!latestPermanentRegistrationMessage) {
    throw new Error(`Flux App ${specifications.name} update message received but application does not exists!`);
  }
  const appSpecs = latestPermanentRegistrationMessage.appSpecifications
    || latestPermanentRegistrationMessage.zelAppSpecifications;
  if (!appSpecs) {
    throw new Error(`Previous specifications for ${specifications.name} update message does not exists! This should not happen.`);
  }
  const heightForDecrypt = latestPermanentRegistrationMessage.height;
  const decryptedPrev = await checkAndDecryptAppSpecs(appSpecs, { daemonHeight: heightForDecrypt });
  const formattedPrev = specificationFormatter(decryptedPrev);

  return formattedPrev;
}

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
  const okVolumes = [];
  dfres.forEach((volume) => {
    if (volume.filesystem.includes('/dev/') && !volume.filesystem.includes('loop') && !volume.mount.includes('boot')) {
      okVolumes.push(volume);
    } else if (volume.filesystem.includes('loop') && volume.mount === '/') {
      okVolumes.push(volume);
    }
  });

  // Dynamic require to avoid circular dependency
  const hwRequirements = require('../appRequirements/hwRequirements');
  const resourceQueryService = require('../appQuery/resourceQueryService');
  const nodeSpecs = await hwRequirements.getNodeSpecs();
  const totalSpaceOnNode = nodeSpecs.ssdStorage;
  const useableSpaceOnNode = totalSpaceOnNode * 0.95 - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
  const resourcesLocked = await resourceQueryService.appsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by Flux App. Aborting.');
  }
  const hddLockedByApps = resourcesLocked.data.appsHddLocked;
  const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps + appSpecifications.hdd + config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap; // because our application is already accounted in locked resources
  // bigger or equal so we have the 1 gb free...
  if (appSpecifications.hdd >= availableSpaceForApps) {
    throw new Error('Insufficient space on Flux Node to spawn an application');
  }
  // now we know that most likely there is a space available. IF user does not have his own stuff on the node or space may be sharded accross hdds.
  let usedSpace = 0;
  let availableSpace = 0;
  okVolumes.forEach((volume) => {
    usedSpace += serviceHelper.ensureNumber(volume.used);
    availableSpace += serviceHelper.ensureNumber(volume.available);
  });
  // space that is further reserved for flux os and that will be later substracted from available space. Max 60 + 20.
  const fluxSystemReserve = config.lockedSystemResources.hdd + config.lockedSystemResources.extrahdd - usedSpace > 0 ? config.lockedSystemResources.hdd + config.lockedSystemResources.extrahdd - usedSpace : 0;
  const minSystemReserve = Math.max(config.lockedSystemResources.extrahdd, fluxSystemReserve);
  const totalAvailableSpaceLeft = availableSpace - minSystemReserve;
  if (appSpecifications.hdd >= totalAvailableSpaceLeft) {
    // sadly user free space is not enough for this application
    throw new Error('Insufficient space on Flux Node. Space is already assigned to system files');
  }

  // check if space is not sharded in some bad way. Always count the minSystemReserve
  let useThisVolume = null;
  const totalVolumes = okVolumes.length;
  for (let i = 0; i < totalVolumes; i += 1) {
    // check available volumes one by one. If a sufficient is found. Use this one.
    if (okVolumes[i].available > appSpecifications.hdd + minSystemReserve) {
      useThisVolume = okVolumes[i];
      break;
    }
  }
  if (!useThisVolume) {
    // no useable volume has such a big space for the app
    throw new Error('Insufficient space on Flux Node. No useable volume found.');
  }

  // now we know there is a space and we have a volume we can operate with. Let's do volume magic
  const searchSpace2 = {
    status: 'Space found',
  };
  log.info(searchSpace2);
  if (res) {
    res.write(serviceHelper.ensureString(searchSpace2));
    if (res.flush) res.flush();
  }

  try {
    const allocateSpace = {
      status: 'Allocating space...',
    };
    log.info(allocateSpace);
    if (res) {
      res.write(serviceHelper.ensureString(allocateSpace));
      if (res.flush) res.flush();
    }

    let execDD = `sudo fallocate -l ${appSpecifications.hdd}G ${useThisVolume.mount}/${appId}FLUXFSVOL`; // eg /mnt/sthMounted
    if (useThisVolume.mount === '/') {
      const execMkdir = `sudo mkdir -p ${fluxDirPath}appvolumes`;
      await cmdAsync(execMkdir);
      execDD = `sudo fallocate -l ${appSpecifications.hdd}G ${fluxDirPath}appvolumes/${appId}FLUXFSVOL`; // if root mount then temp file is /flu/appvolumes
    }

    await cmdAsync(execDD);
    const allocateSpace2 = {
      status: 'Space allocated',
    };
    log.info(allocateSpace2);
    if (res) {
      res.write(serviceHelper.ensureString(allocateSpace2));
      if (res.flush) res.flush();
    }

    const makeFilesystem = {
      status: 'Creating filesystem...',
    };
    log.info(makeFilesystem);
    if (res) {
      res.write(serviceHelper.ensureString(makeFilesystem));
      if (res.flush) res.flush();
    }
    let execFS = `sudo mke2fs -t ext4 ${useThisVolume.mount}/${appId}FLUXFSVOL`;
    if (useThisVolume.mount === '/') {
      execFS = `sudo mke2fs -t ext4 ${fluxDirPath}appvolumes/${appId}FLUXFSVOL`;
    }
    await cmdAsync(execFS);
    const makeFilesystem2 = {
      status: 'Filesystem created',
    };
    log.info(makeFilesystem2);
    if (res) {
      res.write(serviceHelper.ensureString(makeFilesystem2));
      if (res.flush) res.flush();
    }

    const makeDirectory = {
      status: 'Making directory...',
    };
    log.info(makeDirectory);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectory));
      if (res.flush) res.flush();
    }
    const execDIR = `sudo mkdir -p ${appsFolder + appId}`;
    await cmdAsync(execDIR);
    const makeDirectory2 = {
      status: 'Directory made',
    };
    log.info(makeDirectory2);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectory2));
      if (res.flush) res.flush();
    }

    const mountingStatus = {
      status: 'Mounting volume...',
    };
    log.info(mountingStatus);
    if (res) {
      res.write(serviceHelper.ensureString(mountingStatus));
      if (res.flush) res.flush();
    }
    let execMount = `sudo mount -o loop ${useThisVolume.mount}/${appId}FLUXFSVOL ${appsFolder + appId}`;
    if (useThisVolume.mount === '/') {
      execMount = `sudo mount -o loop ${fluxDirPath}appvolumes/${appId}FLUXFSVOL ${appsFolder + appId}`;
    }
    await cmdAsync(execMount);
    const mountingStatus2 = {
      status: 'Volume mounted',
    };
    log.info(mountingStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(mountingStatus2));
      if (res.flush) res.flush();
    }

    const makeDirectoryB = {
      status: 'Making application data directories and files...',
    };
    log.info(makeDirectoryB);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectoryB));
      if (res.flush) res.flush();
    }

    // Parse containerData to get all required local paths
    const mountParser = require('../utils/mountParser');
    let parsedMounts;
    try {
      parsedMounts = mountParser.parseContainerData(appSpecifications.containerData);
    } catch (error) {
      log.error(`Failed to parse containerData: ${error.message}`);
      throw error;
    }

    const requiredPaths = mountParser.getRequiredLocalPaths(parsedMounts);
    log.info(`Creating ${requiredPaths.length} local path(s) for ${appId}`);

    // Create all required directories and files under appdata/
    for (const pathInfo of requiredPaths) {
      // Skip appdata itself as it's already created above
      if (pathInfo.name === 'appdata') {
        continue; // eslint-disable-line no-continue
      }

      if (pathInfo.isFile) {
        // Create an empty file under appdata/
        const createFileStatus = {
          status: `Creating file: appdata/${pathInfo.name}...`,
        };
        log.info(createFileStatus);
        if (res) {
          res.write(serviceHelper.ensureString(createFileStatus));
          if (res.flush) res.flush();
        }
        const execFile = `sudo touch ${appsFolder + appId}/appdata/${pathInfo.name}`;
        // eslint-disable-next-line no-await-in-loop
        await cmdAsync(execFile);
        const createFileStatus2 = {
          status: `File created: appdata/${pathInfo.name}`,
        };
        log.info(createFileStatus2);
        if (res) {
          res.write(serviceHelper.ensureString(createFileStatus2));
          if (res.flush) res.flush();
        }
      } else {
        // Create a directory under appdata/
        const createDirStatus = {
          status: `Creating directory: appdata/${pathInfo.name}...`,
        };
        log.info(createDirStatus);
        if (res) {
          res.write(serviceHelper.ensureString(createDirStatus));
          if (res.flush) res.flush();
        }
        const execDIR = `sudo mkdir -p ${appsFolder + appId}/appdata/${pathInfo.name}`;
        // eslint-disable-next-line no-await-in-loop
        await cmdAsync(execDIR);
        const createDirStatus2 = {
          status: `Directory created: appdata/${pathInfo.name}`,
        };
        log.info(createDirStatus2);
        if (res) {
          res.write(serviceHelper.ensureString(createDirStatus2));
          if (res.flush) res.flush();
        }
      }
    }

    const makeDirectoryB2 = {
      status: 'Application data directories and files created',
    };
    log.info(makeDirectoryB2);
    if (res) {
      res.write(serviceHelper.ensureString(makeDirectoryB2));
      if (res.flush) res.flush();
    }

    const permissionsDirectory = {
      status: 'Adjusting permissions...',
    };
    log.info(permissionsDirectory);
    if (res) {
      res.write(serviceHelper.ensureString(permissionsDirectory));
      if (res.flush) res.flush();
    }
    const execPERM = `sudo chmod 777 ${appsFolder + appId}`;
    await cmdAsync(execPERM);
    const execPERMdata = `sudo chmod 777 ${appsFolder + appId}/appdata`;
    await cmdAsync(execPERMdata);

    // Set permissions for all created paths under appdata/
    for (const pathInfo of requiredPaths) {
      // Skip appdata itself as it's already handled above
      if (pathInfo.name === 'appdata') {
        continue; // eslint-disable-line no-continue
      }
      const execPERMpath = `sudo chmod 777 ${appsFolder + appId}/appdata/${pathInfo.name}`;
      // eslint-disable-next-line no-await-in-loop
      await cmdAsync(execPERMpath);
    }
    const permissionsDirectory2 = {
      status: 'Permissions adjusted',
    };
    log.info(permissionsDirectory2);
    if (res) {
      res.write(serviceHelper.ensureString(permissionsDirectory2));
      if (res.flush) res.flush();
    }

    // Check if primary mount has syncthing flags (r:, g:, or s:)
    // Syncthing is configured ONCE for the entire appdata folder based on primary mount flags only
    const primaryFlags = mountParser.getPrimaryFlags(parsedMounts);
    const hasSyncthingFlag = primaryFlags.includes('r') || primaryFlags.includes('g') || primaryFlags.includes('s');

    if (hasSyncthingFlag) {
      const stFolderCreation = {
        status: 'Creating .stfolder for syncthing...',
      };
      log.info(stFolderCreation);
      if (res) {
        res.write(serviceHelper.ensureString(stFolderCreation));
        if (res.flush) res.flush();
      }
      // Create .stfolder in appdata directory for syncthing
      const execDIRst = `sudo mkdir -p ${appsFolder + appId}/appdata/.stfolder`;
      await cmdAsync(execDIRst);
      const stFolderCreation2 = {
        status: '.stfolder created',
      };
      log.info(stFolderCreation2);
      if (res) {
        res.write(serviceHelper.ensureString(stFolderCreation2));
        if (res.flush) res.flush();
      }

      // Create .stignore file to exclude backup directory
      const stignore = `sudo echo '/backup' >| ${appsFolder + appId}/appdata/.stignore`;
      log.info(stignore);
      await cmdAsync(stignore);
      const stiFileCreation = {
        status: '.stignore created',
      };
      log.info(stiFileCreation);
      if (res) {
        res.write(serviceHelper.ensureString(stiFileCreation));
        if (res.flush) res.flush();
      }
    }

    const cronStatus = {
      status: 'Creating crontab...',
    };
    log.info(cronStatus);
    if (res) {
      res.write(serviceHelper.ensureString(cronStatus));
      if (res.flush) res.flush();
    }
    const crontab = await crontabLoad();
    const jobs = crontab.jobs();
    let exists = false;
    jobs.forEach((job) => {
      if (job.comment() === appId) {
        exists = true;
      }
      if (!job || !job.isValid()) {
        // remove the job as its invalid anyway
        crontab.remove(job);
      }
    });
    if (!exists) {
      const job = crontab.create(execMount, '@reboot', appId);
      // check valid
      if (job == null) {
        throw new Error('Failed to create a cron job');
      }
      if (!job.isValid()) {
        throw new Error('Failed to create a valid cron job');
      }
      // save
      crontab.save();
    }
    const cronStatusB = {
      status: 'Crontab adjusted.',
    };
    log.info(cronStatusB);
    if (res) {
      res.write(serviceHelper.ensureString(cronStatusB));
      if (res.flush) res.flush();
    }
    const message = messageHelper.createSuccessMessage('Flux App volume creation completed.');
    return message;
  } catch (error) {
    clearInterval(global.allocationInterval);
    clearInterval(global.verificationInterval);
    // delete allocation, then uninstall as cron may not have been set
    const cleaningRemoval = {
      status: 'ERROR OCCURED: Pre-removal cleaning...',
    };
    log.info(cleaningRemoval);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningRemoval));
      if (res.flush) res.flush();
    }
    // Unmount the volume if it's mounted
    const execUnmount = `sudo umount ${appsFolder + appId}`;
    await cmdAsync(execUnmount).catch((e) => {
      log.warn('Volume not mounted or already unmounted during cleanup');
    });
    let execRemoveAlloc = `sudo rm -rf ${useThisVolume.mount}/${appId}FLUXFSVOL`;
    if (useThisVolume.mount === '/') {
      execRemoveAlloc = `sudo rm -rf ${fluxDirPath}appvolumes/${appId}FLUXFSVOL`;
    }
    await cmdAsync(execRemoveAlloc).catch((e) => log.error(e));
    const execFinal = `sudo rm -rf ${appsFolder + appId}`;
    await cmdAsync(execFinal).catch((e) => log.error(e));
    const aloocationRemoval2 = {
      status: 'Pre-removal cleaning completed. Forcing removal.',
    };
    log.info(aloocationRemoval2);
    if (res) {
      res.write(serviceHelper.ensureString(aloocationRemoval2));
      if (res.flush) res.flush();
    }
    throw error;
  }
}

/**
 * To soft register an app locally (with data volume already in existence). Performs pre-installation checks - database in place, Flux Docker network in place and if app already installed. Then registers app in database and performs soft install. If registration fails, the app is removed locally.
 * @param {object} appSpecs App specifications.
 * @param {object} componentSpecs Component specifications.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
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
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    if (!tier) {
      const rStatus = messageHelper.createErrorMessage('Failed to get Node Tier');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return;
    }
    const appSpecifications = appSpecs;
    const appComponent = componentSpecs;
    const appName = appSpecifications.name;
    let isComponent = !!appComponent;
    const precheckForInstallation = {
      status: 'Running initial checks for Flux App...',
    };
    log.info(precheckForInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(precheckForInstallation));
      if (res.flush) res.flush();
    }
    // connect to mongodb
    const dbOpenTest = {
      status: 'Connecting to database...',
    };
    log.info(dbOpenTest);
    if (res) {
      res.write(serviceHelper.ensureString(dbOpenTest));
      if (res.flush) res.flush();
    }
    const dbopen = dbHelper.databaseConnection();

    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = { name: appName };
    const appsProjection = {
      projection: {
        _id: 0,
        name: 1,
      },
    };

    // check if app is already installed
    const checkDb = {
      status: 'Checking database...',
    };
    log.info(checkDb);
    if (res) {
      res.write(serviceHelper.ensureString(checkDb));
      if (res.flush) res.flush();
    }
    const appResult = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (appResult && !isComponent) {
      globalState.installationInProgress = false;
      const rStatus = messageHelper.createErrorMessage(`Flux App ${appName} already installed`);
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return;
    }

    if (!isComponent) {
      let dockerNetworkAddrValue = Math.floor(Math.random() * 256);
      if (appsThatMightBeUsingOldGatewayIpAssignment.includes(appName)) {
        dockerNetworkAddrValue = appName.charCodeAt(appName.length - 1);
      }
      const fluxNetworkStatus = {
        status: `Checking Flux App network of ${appName}...`,
      };
      log.info(fluxNetworkStatus);
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetworkStatus));
        if (res.flush) res.flush();
      }
      let fluxNet = null;
      for (let i = 0; i <= 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        fluxNet = await dockerService.createFluxAppDockerNetwork(appName, dockerNetworkAddrValue).catch((error) => log.error(error));
        if (fluxNet || appsThatMightBeUsingOldGatewayIpAssignment.includes(appName)) {
          break;
        }
        dockerNetworkAddrValue = Math.floor(Math.random() * 256);
      }
      if (!fluxNet) {
        throw new Error(`Flux App network of ${appName} failed to initiate. Not possible to create docker application network.`);
      }
      log.info(serviceHelper.ensureString(fluxNet));
      const fluxNetworkInterfaces = await dockerService.getFluxDockerNetworkPhysicalInterfaceNames();
      const accessRemoved = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable(fluxNetworkInterfaces);
      const accessRemovedRes = {
        status: accessRemoved ? `Private network access removed for ${appName}` : `Error removing private network access for ${appName}`,
      };
      if (res) {
        res.write(serviceHelper.ensureString(accessRemovedRes));
        if (res.flush) res.flush();
      }
      const fluxNetResponse = {
        status: `Docker network of ${appName} initiated.`,
      };
      if (res) {
        res.write(serviceHelper.ensureString(fluxNetResponse));
        if (res.flush) res.flush();
      }
    }

    const appInstallation = {
      status: isComponent ? `Initiating Flux App component ${appComponent.name} installation...` : `Initiating Flux App ${appName} installation...`,
    };
    log.info(appInstallation);
    if (res) {
      res.write(serviceHelper.ensureString(appInstallation));
      if (res.flush) res.flush();
    }
    if (!isComponent) {
      // register the app

      const isEnterprise = Boolean(
        appSpecifications.version >= 8 && appSpecifications.enterprise,
      );

      const dbSpecs = JSON.parse(JSON.stringify(appSpecifications));

      if (isEnterprise) {
        dbSpecs.compose = [];
        dbSpecs.contacts = [];
      }

      const insertResult = await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
      if (!insertResult) {
        throw new Error(`CRITICAL: Failed to create database entry for ${appSpecifications.name} in soft registration. Database insert returned undefined - likely duplicate key error or database failure. Aborting soft registration to prevent orphaned Docker containers.`);
      }
      log.info(`Database entry created for ${appSpecifications.name} BEFORE Docker container creation (soft registration)`);
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram = appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd = appSpecifications[hddTier] || appSpecifications.hdd;
    } else {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appComponent.cpu = appComponent[cpuTier] || appComponent.cpu;
      appComponent.ram = appComponent[ramTier] || appComponent.ram;
      appComponent.hdd = appComponent[hddTier] || appComponent.hdd;
    }

    const specificationsToInstall = isComponent ? appComponent : appSpecifications;

    const appInstaller = require('./appInstaller');
    if (specificationsToInstall.version >= 4) { // version is undefined for component
      // eslint-disable-next-line no-restricted-syntax
      for (const appComponentSpecs of specificationsToInstall.compose) {
        isComponent = true;
        const hddTier = `hdd${tier}`;
        const ramTier = `ram${tier}`;
        const cpuTier = `cpu${tier}`;
        appComponentSpecs.cpu = appComponentSpecs[cpuTier] || appComponentSpecs.cpu;
        appComponentSpecs.ram = appComponentSpecs[ramTier] || appComponentSpecs.ram;
        appComponentSpecs.hdd = appComponentSpecs[hddTier] || appComponentSpecs.hdd;
        // eslint-disable-next-line no-await-in-loop
        await appInstaller.installApplicationSoft(appComponentSpecs, appName, isComponent, res, appSpecifications);
      }

      // Restore syncthing cache for apps with syncthing data to prevent data deletion
      // This is necessary because cache might be lost (service restart) or corrupted (firstEncounterSkipped flag)
      // During soft redeploy, data is preserved, so we mark apps as already synced
      for (const appComponentSpecs of specificationsToInstall.compose) {
        const hasSyncthingData = appComponentSpecs.containerData && (appComponentSpecs.containerData.includes('g:') || appComponentSpecs.containerData.includes('r:'));
        if (hasSyncthingData) {
          const identifier = `${appComponentSpecs.name}_${appName}`;
          const appId = dockerService.getAppIdentifier(identifier);
          globalState.receiveOnlySyncthingAppsCache.set(appId, {
            restarted: true,
            numberOfExecutionsRequired: 4,
            numberOfExecutions: 10,
          });
          log.info(`Restored syncthing cache for ${appId} during soft redeploy`);
        }
      }
    } else {
      await appInstaller.installApplicationSoft(specificationsToInstall, appName, isComponent, res, appSpecifications);

      // Restore syncthing cache for non-compose apps with syncthing data
      const hasSyncthingData = specificationsToInstall.containerData && (specificationsToInstall.containerData.includes('g:') || specificationsToInstall.containerData.includes('r:'));
      if (hasSyncthingData) {
        const identifier = isComponent ? `${specificationsToInstall.name}_${appName}` : appName;
        const appId = dockerService.getAppIdentifier(identifier);
        globalState.receiveOnlySyncthingAppsCache.set(appId, {
          restarted: true,
          numberOfExecutionsRequired: 4,
          numberOfExecutions: 10,
        });
        log.info(`Restored syncthing cache for ${appId} during soft redeploy`);
      }
    }
    // all done message
    const successStatus = messageHelper.createSuccessMessage(`Flux App ${appName} successfully installed and launched`);
    log.info(successStatus);
    if (res) {
      res.write(serviceHelper.ensureString(successStatus));
      res.end();
    }
    globalState.installationInProgress = false;
  } catch (error) {
    globalState.installationInProgress = false;
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
    const removeStatus = messageHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
    log.info(removeStatus);
    log.warn(`REMOVAL REASON: Soft registration failure - ${appSpecs.name} failed during soft registration: ${error.message} (softRegisterAppLocally)`);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
      if (res.flush) res.flush();
    }
    const appUninstaller = require('./appUninstaller');
    appUninstaller.removeAppLocally(appSpecs.name, res, true);
  }
}

/**
 * Helper function to uninstall app components softly
 * @param {string} appName App name
 * @param {string} appId App ID
 * @param {object} appSpecifications App specifications
 * @param {boolean} isComponent Whether this is a component
 * @param {object} res Response object
 */
async function appUninstallSoft(appName, appId, appSpecifications, isComponent, res) {
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecifications.name}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
    if (res.flush) res.flush();
  }
  let monitoredName = appName;
  if (isComponent) {
    monitoredName = `${appSpecifications.name}_${appName}`;
  }
  stopAppMonitoring(monitoredName, false);
  await dockerService.appDockerStop(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });

  const stopStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecifications.name} stopped` : `Flux App ${appName} stopped`,
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
    if (res.flush) res.flush();
  }

  const removeStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerRemove(appId);

  const removeStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name}container removed` : `Flux App ${appName} container removed`,
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
    if (res.flush) res.flush();
  }

  const imageStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} image...` : `Removing Flux App ${appName} image...`,
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
    if (res.flush) res.flush();
  }
  await dockerService.appDockerImageRemove(appSpecifications.repotag).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });
  const imageStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} image operations done` : `Flux App ${appName} image operations done`,
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
    if (res.flush) res.flush();
  }

  const portStatus = {
    status: isComponent ? `Denying Flux App component ${appSpecifications.name} ports...` : `Denying Flux App ${appName} ports...`,
  };
  log.info(portStatus);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus));
    if (res.flush) res.flush();
  }
  if (appSpecifications.ports) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.deleteAllowPortRule(serviceHelper.ensureNumber(port));
      }
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await upnpService.removeMapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
      }
    }
    // v1 compatibility
  } else if (appSpecifications.port) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      await fluxNetworkHelper.deleteAllowPortRule(serviceHelper.ensureNumber(appSpecifications.port));
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      await upnpService.removeMapUpnpPort(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
    }
  }
  const portStatus2 = {
    status: isComponent ? `Ports of component ${appSpecifications.name} denied` : `Ports of ${appName} denied`,
  };
  log.info(portStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus2));
    if (res.flush) res.flush();
  }
  const appRemovalResponse = {
    status: isComponent ? `Flux App component ${appSpecifications.name} of ${appName} was successfuly removed` : `Flux App ${appName} was successfuly removed`,
  };
  log.info(appRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appRemovalResponse));
    if (res.flush) res.flush();
  }
}

/**
 * To remove an app locally (including any components) without storage and cache deletion (keeps mounted volumes and cron job). First finds app specifications in database and then deletes the app from database. For app reload. Only for internal usage. We are throwing in functions using this.
 * @param {string} app App name.
 * @param {object} res Response.
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
  globalState.removalInProgress = true;
  if (!app) {
    throw new Error('No Flux App specified');
  }

  let isComponent = app.includes('_'); // copmonent is defined by appComponent.name_appSpecs.name

  const appName = isComponent ? app.split('_')[1] : app;
  const appComponent = app.split('_')[0];

  // first find the appSpecifications in our database.
  // connect to mongodb
  const dbopen = dbHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appslocal.database);

  const appsQuery = { name: appName };
  const appsProjection = {};
  let appSpecifications = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
  if (!appSpecifications) {
    throw new Error('Flux App not found');
  }

  let appId = dockerService.getAppIdentifier(app);

  // do this temporarily - otherwise we have to move a bunch of functions around
  appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
  appSpecifications = specificationFormatter(appSpecifications);

  if (appSpecifications.version >= 4 && !isComponent) {
    // it is a composed application
    // eslint-disable-next-line no-restricted-syntax
    for (const appComposedComponent of appSpecifications.compose.reverse()) {
      isComponent = true;
      appId = dockerService.getAppIdentifier(`${appComposedComponent.name}_${appSpecifications.name}`);
      const appComponentSpecifications = appComposedComponent;
      // eslint-disable-next-line no-await-in-loop
      await appUninstallSoft(appName, appId, appComponentSpecifications, isComponent, res);
    }
    isComponent = false;
  } else if (isComponent) {
    const componentSpecifications = appSpecifications.compose.find((component) => component.name === appComponent);
    await appUninstallSoft(appName, appId, componentSpecifications, isComponent, res);
  } else {
    await appUninstallSoft(appName, appId, appSpecifications, isComponent, res);
  }

  if (!isComponent) {
    const databaseStatus = {
      status: 'Cleaning up database...',
    };
    log.info(databaseStatus);
    if (res) {
      res.write(serviceHelper.ensureString(databaseStatus));
      if (res.flush) res.flush();
    }
    await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    const databaseStatus2 = {
      status: 'Database cleaned',
    };
    log.info(databaseStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(databaseStatus2));
      if (res.flush) res.flush();
    }
    const appRemovalResponseDone = messageHelper.createSuccessMessage(`Removal step done. Result: Flux App ${appName} was partially removed`);
    log.info(appRemovalResponseDone);
    if (res) {
      res.write(serviceHelper.ensureString(appRemovalResponseDone));
      if (res.flush) res.flush();
    }
  }

  globalState.removalInProgress = false;
}

/**
 * Soft redeploy - removes and reinstalls app locally (soft)
 * @param {object} appSpecs - App specifications
 * @param {object} res - Response object
 */
async function softRedeploy(appSpecs, res) {
  try {
    if (globalState.removalInProgress) {
      log.warn('Another application is undergoing removal');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing removal');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    if (globalState.installationInProgress) {
      log.warn('Another application is undergoing installation');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing installation');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    if (globalState.softRedeployInProgress) {
      log.warn('Another application is undergoing soft redeploy');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing soft redeploy');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    if (globalState.hardRedeployInProgress) {
      log.warn('Another application is undergoing hard redeploy');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing hard redeploy');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    globalState.softRedeployInProgress = true;
    log.info('Starting softRedeploy');
    try {
      await softRemoveAppLocally(appSpecs.name, res);
    } catch (error) {
      log.error(error);
      globalState.softRedeployInProgress = false;
      throw error;
    }
    const appRedeployResponse = messageHelper.createSuccessMessage('Application softly removed. Awaiting installation...');
    log.info(appRedeployResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appRedeployResponse));
      if (res.flush) res.flush();
    }
    await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins
    // verify requirements
    const appInstaller = require('./appInstaller');
    await appInstaller.checkAppRequirements(appSpecs);
    // register
    await softRegisterAppLocally(appSpecs, undefined, res);
    log.info('Application softly redeployed');
    globalState.softRedeployInProgress = false;
  } catch (error) {
    log.info('Error on softRedeploy');
    log.error(error);
    log.warn(`REMOVAL REASON: Soft redeploy failure - ${appSpecs.name} failed during soft redeploy: ${error.message} (softRedeploy)`);
    globalState.softRedeployInProgress = false;
    const appUninstaller = require('./appUninstaller');
    await appUninstaller.removeAppLocally(appSpecs.name, res, true, true, true);
    log.info(`Cleanup completed for ${appSpecs.name} after soft redeploy failure`);
  }
}

/**
 * Hard redeploy - removes and reinstalls app locally (hard)
 * @param {object} appSpecs - App specifications
 * @param {object} res - Response object
 */
async function hardRedeploy(appSpecs, res) {
  const appUninstaller = require('./appUninstaller');
  try {
    if (globalState.removalInProgress) {
      log.warn('Another application is undergoing removal');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing removal');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    if (globalState.installationInProgress) {
      log.warn('Another application is undergoing installation');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing installation');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    if (globalState.softRedeployInProgress) {
      log.warn('Another application is undergoing soft redeploy');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing soft redeploy');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    if (globalState.hardRedeployInProgress) {
      log.warn('Another application is undergoing hard redeploy');
      const appRedeployResponse = messageHelper.createWarningMessage('Another application is undergoing hard redeploy');
      if (res) {
        res.write(serviceHelper.ensureString(appRedeployResponse));
        if (res.flush) res.flush();
      }
      return;
    }
    globalState.hardRedeployInProgress = true;
    log.warn(`REMOVAL REASON: Hard redeploy initiated - ${appSpecs.name} being removed as part of hard redeploy process (hardRedeploy)`);
    await appUninstaller.removeAppLocally(appSpecs.name, res, false, false);
    const appRedeployResponse = messageHelper.createSuccessMessage('Application removed. Awaiting installation...');
    log.info(appRedeployResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appRedeployResponse));
      if (res.flush) res.flush();
    }
    await serviceHelper.delay(config.fluxapps.redeploy.delay * 1000); // wait for delay mins
    // verify requirements
    const appInstaller = require('./appInstaller');
    await appInstaller.checkAppRequirements(appSpecs);
    // register
    await appInstaller.registerAppLocally(appSpecs, undefined, res); // can throw
    log.info('Application redeployed');
    globalState.hardRedeployInProgress = false;
  } catch (error) {
    log.error(error);
    log.warn(`REMOVAL REASON: Hard redeploy failure - ${appSpecs.name} failed during hard redeploy: ${error.message} (hardRedeploy)`);
    globalState.hardRedeployInProgress = false;
    await appUninstaller.removeAppLocally(appSpecs.name, res, true, true, true);
    log.info(`Cleanup completed for ${appSpecs.name} after hard redeploy failure`);
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

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }
    if (global) {
      // Dynamic require to avoid circular dependency
      const appController = require('../appManagement/appController');
      appController.executeAppGlobalCommand(appname, 'redeploy', req.headers.zelidauth, force); // do not wait
      const hardOrSoft = force ? 'hard' : 'soft';
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global ${hardOrSoft} redeploy`);
      res.json(appResponse);
      return;
    }

    // Dynamic require to avoid circular dependency
    const registryManager = require('../appDatabase/registryManager');
    const specifications = await registryManager.getApplicationSpecifications(appname);
    if (!specifications) {
      throw new Error('Application not found');
    }

    res.setHeader('Content-Type', 'application/json');

    if (force) {
      await hardRedeploy(specifications, res);
    } else {
      await softRedeploy(specifications, res);
    }
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
 * Verify app update parameters
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function verifyAppUpdateParameters(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;
      appSpecification = serviceHelper.ensureObject(appSpecification);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const decryptedSpecs = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });

      const appSpecFormatted = specificationFormatter(decryptedSpecs);

      // Dynamic require to avoid circular dependency
      const appRequirements = require('../appRequirements/appValidator');
      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await appRequirements.verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            const appSecurity = require('../appSecurity/imageManager');
            // eslint-disable-next-line no-await-in-loop
            await appSecurity.checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner, false);
          }
        }
      }

      // Validate update compatibility with previous version
      const timestamp = Date.now();
      await validateApplicationUpdateCompatibility(appSpecFormatted, timestamp);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // app is valid and can be registered
      // respond with formatted specifications
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
      res.json(respondPrice);
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
 * Helper function to send chunk of data to response stream with delay
 * @param {object} res - Response object
 * @param {string} chunk - Data chunk to send
 * @returns {Promise<void>}
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
 * Stop Syncthing app - removes folder from syncthing config
 * @param {string} appComponentName - App component name
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function stopSyncthingApp(appComponentName, res) {
  try {
    const identifier = appComponentName;
    const appId = dockerService.getAppIdentifier(identifier);
    const folder = `${appsFolder + appId}`;
    const syncthingService = require('../syncthingService');
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
        if (res) {
          res.write(serviceHelper.ensureString(adjustSyncthingB));
          if (res.flush) res.flush();
        }
      }
      folderId = null;
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Helper function to start app docker containers
 * @param {string} appname - App name
 * @returns {Promise<void>}
 */
async function appDockerStart(appname) {
  try {
    const { startAppMonitoring } = require('../appManagement/appInspector');
    const registryManager = require('../appDatabase/registryManager');

    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_');
    if (isComponent) {
      await dockerService.appDockerStart(appname);
      startAppMonitoring(appname);
    } else {
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
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
 * Helper function to stop app docker containers
 * @param {string} appname - App name
 * @returns {Promise<void>}
 */
async function appDockerStop(appname) {
  try {
    const registryManager = require('../appDatabase/registryManager');

    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_');
    if (isComponent) {
      await dockerService.appDockerStop(appname);
      stopAppMonitoring(appname, false);
    } else {
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
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
 * Helper function to restart app docker containers
 * @param {string} appname - App name
 * @returns {Promise<void>}
 */
async function appDockerRestart(appname) {
  try {
    const { startAppMonitoring } = require('../appManagement/appInspector');
    const registryManager = require('../appDatabase/registryManager');

    const mainAppName = appname.split('_')[1] || appname;
    const isComponent = appname.includes('_');
    if (isComponent) {
      await dockerService.appDockerRestart(appname);
      startAppMonitoring(appname);
    } else {
      const appSpecs = await registryManager.getApplicationSpecifications(mainAppName);
      if (!appSpecs) {
        throw new Error('Application not found');
      }
      if (appSpecs.version <= 3) {
        await dockerService.appDockerRestart(appname);
        startAppMonitoring(appname);
      } else {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecs.compose) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerRestart(`${appComponent.name}_${appSpecs.name}`);
          startAppMonitoring(`${appComponent.name}_${appSpecs.name}`);
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Append backup task to queue
 * @param {object} req - Request object
 * @param {object} res - Response object
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
    const indexBackup = globalState.backupInProgress.indexOf(appname);
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
      globalState.backupInProgress.push(appname);
      // Check if app using syncthing, stop syncthing for all component that using it
      const registryManager = require('../appDatabase/registryManager');
      const appDetails = await registryManager.getApplicationGlobalSpecifications(appname);
      // eslint-disable-next-line no-restricted-syntax
      const syncthing = appDetails.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
      if (syncthing) {
        // eslint-disable-next-line no-await-in-loop
        await sendChunk(res, `Stopping syncthing for ${appname}\n`);
        // eslint-disable-next-line no-await-in-loop
        await stopSyncthingApp(appname, res);
      }

      await sendChunk(res, 'Stopping application...\n');
      await appDockerStop(appname);
      await serviceHelper.delay(5 * 1000);
      const IOUtils = require('../IOUtils');
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
      const indexToRemove = globalState.backupInProgress.indexOf(appname);
      globalState.backupInProgress.splice(indexToRemove, 1);
      res.end();
      return true;
      // eslint-disable-next-line no-else-return
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const indexToRemove = globalState.backupInProgress.indexOf(appname);
    if (indexToRemove >= 0) {
      globalState.backupInProgress.splice(indexToRemove, 1);
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
    const indexRestore = globalState.restoreInProgress.indexOf(appname);
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
      globalState.restoreInProgress.push(appname);
      const registryManager = require('../appDatabase/registryManager');
      const appDetails = await registryManager.getApplicationGlobalSpecifications(appname);
      // eslint-disable-next-line no-restricted-syntax
      const syncthing = appDetails.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
      if (syncthing) {
        // eslint-disable-next-line no-await-in-loop
        await sendChunk(res, `Stopping syncthing for ${appname}\n`);
        // eslint-disable-next-line no-await-in-loop
        await stopSyncthingApp(appname, res);
      }
      await sendChunk(res, 'Stopping application...\n');
      await appDockerStop(appname);
      await serviceHelper.delay(5 * 1000);
      const IOUtils = require('../IOUtils');
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
            const { receiveOnlySyncthingAppsCache } = require('../utils/appCaches');
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
        const appController = require('../appManagement/appController');
        appController.executeAppGlobalCommand(appname, 'redeploy', req.headers.zelidauth, true);
        await serviceHelper.delay(1 * 60 * 1000);
      }
      await sendChunk(res, 'Finalizing...\n');
      await serviceHelper.delay(5 * 1000);
      const indexToRemove = globalState.restoreInProgress.indexOf(appname);
      globalState.restoreInProgress.splice(indexToRemove, 1);
      res.end();
      return true;
      // eslint-disable-next-line no-else-return
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const indexToRemove = globalState.restoreInProgress.indexOf(appname);
    if (indexToRemove >= 0) {
      globalState.restoreInProgress.splice(indexToRemove, 1);
    }
    await sendChunk(res, `${error?.message}\n`);
    res.end();
    return false;
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
      const execMkdir = `sudo mkdir -p ${fluxDirPath}appvolumes`;
      await cmdAsync(execMkdir);
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
 * Validates that an application update is compatible with the previous version.
 * Enforces structural consistency rules based on app specification version:
 * - v1-3: Repository tags (repotag) cannot be changed
 * - v4+: Component names and count must remain constant (repotag changes allowed)
 * - Version downgrades from v4+ to v1-3 are forbidden
 * - Version updates only allowed to version 8 (current latest supported version)
 *
 * @param {object} specifications - The new/updated application specifications to validate
 * @param {string} specifications.name - Application name
 * @param {number} specifications.version - Specification version (1-4+)
 * @param {string} [specifications.repotag] - Docker image repository:tag (v1-3)
 * @param {Array} [specifications.compose] - Component definitions (v4+)
 * @param {number} verificationTimestamp - Timestamp for retrieving the correct previous app version
 * @returns {Promise<boolean>} Returns true if update is compatible
 * @throws {Error} When update violates version-specific compatibility rules:
 *   - Component count mismatch (v4+)
 *   - Component name changes (v4+)
 *   - Repository tag changes (v1-3)
 *   - Version downgrade from v4+ to v1-3
 *   - Version change to anything other than version 8
 */
async function validateApplicationUpdateCompatibility(specifications, verificationTimestamp) {
  // eslint-disable-next-line no-use-before-define
  const appSpecs = await getPreviousAppSpecifications(specifications, verificationTimestamp);

  // Only allow version changes to version 8 (current latest supported version)
  if (appSpecs.version !== specifications.version && specifications.version !== 8) {
    throw new Error(
      `Application update rejected: Version changes are only allowed when updating to version 8 (current latest supported version). ` +
      `Current version: ${appSpecs.version}, Attempted version: ${specifications.version}. ` +
      `To update this application, please use version 8 specifications.`
    );
  }
  if (specifications.version >= 4) {
    if (appSpecs.version >= 4) {
      // Both current and update are v4+ compositions
      // Component count must remain constant
      if (specifications.compose.length !== appSpecs.compose.length) {
        throw new Error(
          `Application update rejected: Cannot change the number of components for "${specifications.name}". ` +
          `Previous version has ${appSpecs.compose.length} component(s), new version has ${specifications.compose.length}. ` +
          `Component count must remain constant for v4+ applications.`
        );
      }

      // Component names must remain constant (but repotag can change)
      appSpecs.compose.forEach((appComponent) => {
        const newSpecComponentFound = specifications.compose.find((appComponentNew) => appComponentNew.name === appComponent.name);
        if (!newSpecComponentFound) {
          const oldNames = appSpecs.compose.map((c) => c.name).join(', ');
          const newNames = specifications.compose.map((c) => c.name).join(', ');
          throw new Error(
            `Application update rejected: Component "${appComponent.name}" not found in new specification for "${specifications.name}". ` +
            `Component names must remain constant. Previous components: [${oldNames}], New components: [${newNames}]. ` +
            `Note: Docker image tags (repotag) can be changed, but component names cannot.`
          );
        }
        // v4+ allows for changes of repotag (Docker image tags)
      });
    } else { // Update is v4+ and current app is v1-3
      // Node will perform hard redeploy of the app to migrate from v1-3 to v4+
    }
  } else if (appSpecs.version >= 4) {
    throw new Error(
      `Application update rejected: Cannot downgrade "${specifications.name}" from v4+ to v${specifications.version}. ` +
      `Version rollbacks from v4+ specifications to older versions (v1-3) are not permitted. ` +
      `Current version: v${appSpecs.version}, Attempted version: v${specifications.version}.`
    );
  } else { // Both update and current app are v1-3
    // v1-3 specifications do not allow repotag changes
    // eslint-disable-next-line no-lonely-if
    if (appSpecs.repotag !== specifications.repotag) {
      throw new Error(
        `Application update rejected: Cannot change Docker image repository/tag for v1-3 application "${specifications.name}". ` +
        `Previous repotag: "${appSpecs.repotag}", New repotag: "${specifications.repotag}". ` +
        `Repository tag changes are only allowed for v4+ applications. Consider upgrading to v4+ specification format.`
      );
    }
  }
  return true;
}

/**
 * Set installation progress state
 * @param {boolean} state - Installation progress state
 */
function setInstallationInProgress(state) {
  globalState.installationInProgress = state;
}

/**
 * Set removal progress state
 * @param {boolean} state - Removal progress state
 */
function setRemovalInProgress(state) {
  globalState.removalInProgress = state;
}

/**
 * Get installation progress state
 * @returns {boolean} Current installation state
 */
function getInstallationInProgress() {
  return globalState.installationInProgress;
}

/**
 * Get removal progress state
 * @returns {boolean} Current removal state
 */
function getRemovalInProgress() {
  return globalState.removalInProgress;
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
      // Dynamic require to avoid circular dependency
      const { outgoingPeers, incomingPeers } = require('../utils/establishedConnections');
      // first check if this node is available for application update
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application update');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application update');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and ports HAVE to be unique for application. Check if they don't exist in global database
      // first let's check if all fields are present and have proper format except tiered and tiered specifications and those can be omitted
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
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
      const daemonHeight = syncStatus.data.height;

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
        },
      );

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // Dynamic require to avoid circular dependency
      const appRequirements = require('../appRequirements/appValidator');
      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await appRequirements.verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            const appSecurity = require('../appSecurity/imageManager');
            // eslint-disable-next-line no-await-in-loop
            await appSecurity.checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner, false);
          }
        }
      }

      // verify that app exists, does not change repotag and is signed by app owner.
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      // may throw
      const query = { name: appSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      if (!appInfo) {
        throw new Error('Flux App update received but application to update does not exist!');
      }
      if (appInfo.version <= 3 && appInfo.repotag !== appSpecFormatted.repotag) { // this is OK. <= v3 cannot change, v4 can but does not have this in specifications as its compose
        throw new Error('Flux App update of repotag is not allowed');
      }
      const appOwner = appInfo.owner; // ensure previous app owner is signing this message

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? specificationFormatter(appSpecification)
        : appSpecFormatted;

      const appMessaging = require('../appMessaging/messageVerifier');
      // here signature is checked against PREVIOUS app owner
      await appMessaging.verifyAppMessageUpdateSignature(messageType, typeVersion, toVerify, timestamp, signature, appOwner, daemonHeight);

      // Validate update compatibility: ensure structural consistency (component names/count for v4+, repotag for v1-3)
      await validateApplicationUpdateCompatibility(appSpecFormatted, timestamp);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may pose some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);

      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
        arcaneSender: isArcane,
      };
      const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);
      // above takes 2-3 seconds
      await serviceHelper.delay(1200); // it takes receiving node at least 1 second to process the message. Add 1200 ms mas for processing
      // this operations takes 2.5-3.5 seconds and is heavy, message gets verified again.
      await appMessaging.requestAppMessage(messageHASH); // this itself verifies that Peers received our message broadcast AND peers send us the message back. By peers sending the message back we finally store it to our temporary message storage and rebroadcast it again
      await serviceHelper.delay(1200); // 1200 ms mas for processing - peer sends message back to us
      // check temporary message storage
      let tempMessage = await appMessaging.checkAppTemporaryMessageExistence(messageHASH);
      for (let i = 0; i < 20; i += 1) { // ask for up to 20 times - 10 seconds. Must have been processed by that time or it failed.
        if (!tempMessage) {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          tempMessage = await appMessaging.checkAppTemporaryMessageExistence(messageHASH);
        }
      }
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const responseHash = messageHelper.createDataMessage(tempMessage.hash);
        res.json(responseHash); // all ok
        return;
      }
      throw new Error('Unable to update application on the network. Try again later.');
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
 * To find and remove apps that are spawned more than maximum number of instances allowed locally.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkAndRemoveApplicationInstance() {
  // To check if more than allowed instances of application are running
  // check if synced
  try {
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Application duplication removal paused. Not yet synced');
      return;
    }

    // get list of locally installed apps.
    const installedAppsRes = await getInstalledAppsFromDb();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    // lazy load to avoid circular dependency
    const appUninstaller = require('./appUninstaller');
    const registryManager = require('../appDatabase/registryManager');
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled) {
      // eslint-disable-next-line no-await-in-loop
      const runningAppList = await registryManager.appLocation(installedApp.name);
      const minInstances = installedApp.instances || config.fluxapps.minimumInstances; // introduced in v3 of apps specs
      if (runningAppList.length > minInstances) {
        // eslint-disable-next-line no-await-in-loop
        const appDetails = await registryManager.getApplicationGlobalSpecifications(installedApp.name);
        if (appDetails) {
          log.info(`Application ${installedApp.name} is already spawned on ${runningAppList.length} instances. Checking if should be unninstalled from the FluxNode..`);
          runningAppList.sort((a, b) => {
            if (!a.runningSince && b.runningSince) {
              return 1;
            }
            if (a.runningSince && !b.runningSince) {
              return -1;
            }
            if (a.runningSince < b.runningSince) {
              return 1;
            }
            if (a.runningSince > b.runningSince) {
              return -1;
            }
            if (a.ip < b.ip) {
              return 1;
            }
            if (a.ip > b.ip) {
              return -1;
            }
            return 0;
          });
          // eslint-disable-next-line no-await-in-loop
          const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
          if (myIP) {
            const index = runningAppList.findIndex((x) => x.ip === myIP);
            if (index === 0) {
              log.info(`Application ${installedApp.name} going to be removed from node as it was the latest one running it to install it..`);
              log.warn(`REMOVAL REASON: Too many instances - ${installedApp.name} running on ${runningAppList.length} instances (max: ${minInstances}) - This node is the newest instance`);
              log.warn(`Removing application ${installedApp.name} locally`);
              // eslint-disable-next-line no-await-in-loop
              await appUninstaller.removeAppLocally(installedApp.name, null, false, true, true);
              log.warn(`Application ${installedApp.name} locally removed`);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(config.fluxapps.removal.delay * 1000); // wait for 6 mins so we don't have more removals at the same time
            }
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Check for outdated app versions and reinstall them with newer specifications
 * @returns {Promise<void>} Completion status
 */
async function reinstallOldApplications() {
  try {
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Checking application status paused. Not yet synced');
      return;
    }
    // first get installed apps
    const installedAppsRes = await getInstalledAppsFromDb();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled) {
      // get current app specifications for the app name
      // if match found. Check if hash found.
      // if same, do nothing. if different remove and install.

      // eslint-disable-next-line no-await-in-loop
      const appSpecifications = await getStrictApplicationSpecifications(installedApp.name);
      const randomNumber = Math.floor((Math.random() * config.fluxapps.redeploy.probability)); // 50%
      if (appSpecifications && appSpecifications.hash !== installedApp.hash) {
        // eslint-disable-next-line no-await-in-loop
        log.warn(`Application ${installedApp.name} version is obsolete.`);
        if (randomNumber === 0) {
          globalState.reinstallationOfOldAppsInProgress = true;
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
            log.info(`Application ${installedApp.name} Database updated`);
            // eslint-disable-next-line no-continue
            continue;
          }
          // Specs differ - log for debugging purposes
          log.info(`Application ${installedApp.name} has actual specification changes, proceeding with redeployment.`);

          // check if node is capable to run it according to specifications
          // run the verification
          // get tier and adjust specifications
          // eslint-disable-next-line no-await-in-loop
          const tier = await generalService.nodeTier();
          if (appSpecifications.version >= 4 && installedApp.version <= 3) {
            if (globalState.removalInProgress) {
              log.warn(`Another application is undergoing removal. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.installationInProgress) {
              log.warn(`Another application is undergoing installation. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.softRedeployInProgress) {
              log.warn(`Another application is undergoing soft redeploy. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.hardRedeployInProgress) {
              log.warn(`Another application is undergoing hard redeploy. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            log.warn('Updating from old application version, doing hard redeploy...');
            log.warn(`REMOVAL REASON: App version upgrade - ${appSpecifications.name} upgrading from v${installedApp.version} to v${appSpecifications.version}`);
            const appUninstaller = require('./appUninstaller');
            const appInstaller = require('./appInstaller');
            // eslint-disable-next-line no-await-in-loop
            await appUninstaller.removeAppLocally(appSpecifications.name, null, true, false);
            // connect to mongodb
            const dbopen = dbHelper.databaseConnection();
            const appsDatabase = dbopen.db(config.database.appslocal.database);
            const appsQuery = { name: appSpecifications.name };
            const appsProjection = {};
            log.warn('Cleaning up database...');
            // eslint-disable-next-line no-await-in-loop
            await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
            const databaseStatus2 = {
              status: 'Database cleaned',
            };
            log.warn('Database cleaned');
            log.warn(databaseStatus2);
            log.warn(`Compositions of application ${appSpecifications.name} uninstalled. Continuing with installation...`);
            // composition removal done. Remove from installed apps and being installation
            // eslint-disable-next-line no-await-in-loop
            await appInstaller.checkAppRequirements(appSpecifications); // entire app

            // Register the app in database BEFORE creating Docker containers to prevent race condition
            const isEnterprise = Boolean(
              appSpecifications.version >= 8 && appSpecifications.enterprise,
            );

            const dbSpecs = JSON.parse(JSON.stringify(appSpecifications));

            if (isEnterprise) {
              dbSpecs.compose = [];
              dbSpecs.contacts = [];
            }

            // eslint-disable-next-line no-await-in-loop
            const insertResult = await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
            if (!insertResult) {
              throw new Error(`CRITICAL: Failed to create database entry for ${appSpecifications.name} during version upgrade reinstallation. Database insert returned undefined - likely duplicate key error or database failure. Aborting reinstallation to prevent orphaned Docker containers.`);
            }
            log.info(`Database entry created for ${appSpecifications.name} BEFORE component Docker container creation (version upgrade path)`);

            // Now install components - containers will be created but app is already in DB
            // eslint-disable-next-line no-restricted-syntax
            for (const appComponent of appSpecifications.compose) {
              log.warn(`Continuing Hard Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
              // install the app
              // eslint-disable-next-line no-await-in-loop
              await appInstaller.registerAppLocally(appSpecifications, appComponent); // component
            }
            log.warn(`Composed application ${appSpecifications.name} updated.`);
            log.warn(`Restarting application ${appSpecifications.name}`);
            // eslint-disable-next-line no-await-in-loop, no-use-before-define
            await appDockerRestart(appSpecifications.name);
          } else if (appSpecifications.version <= 3) {
            if (appSpecifications.tiered) {
              const hddTier = `hdd${tier}`;
              const ramTier = `ram${tier}`;
              const cpuTier = `cpu${tier}`;
              appSpecifications.cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
              appSpecifications.ram = appSpecifications[ramTier] || appSpecifications.ram;
              appSpecifications.hdd = appSpecifications[hddTier] || appSpecifications.hdd;
            }

            if (globalState.removalInProgress) {
              log.warn(`Another application is undergoing removal. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.installationInProgress) {
              log.warn(`Another application is undergoing installation. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.softRedeployInProgress) {
              log.warn(`Another application is undergoing soft redeploy. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.hardRedeployInProgress) {
              log.warn(`Another application is undergoing hard redeploy. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }

            // Dynamic require to avoid circular dependency
            const appUninstaller = require('./appUninstaller');
            const appInstaller = require('./appInstaller');

            if (appSpecifications.hdd === installedApp.hdd) {
              log.warn(`Beginning Soft Redeployment of ${appSpecifications.name}...`);
              // soft redeployment
              // eslint-disable-next-line no-await-in-loop
              await appUninstaller.appUninstallSoft(appSpecifications.name, null, appSpecifications, false, null, true);
              // eslint-disable-next-line no-await-in-loop
              await appInstaller.installApplicationSoft(appSpecifications, appSpecifications.name, false, null, appSpecifications);
            } else {
              log.warn(`Beginning Hard Redeployment of ${appSpecifications.name}...`);
              log.warn(`REMOVAL REASON: Hard redeployment - ${appSpecifications.name} HDD changed from ${installedApp.hdd} to ${appSpecifications.hdd}`);
              // hard redeployment
              // eslint-disable-next-line no-await-in-loop
              await appUninstaller.appUninstallHard(appSpecifications.name, null, appSpecifications, false, null, true);
              // eslint-disable-next-line no-await-in-loop
              await appInstaller.installApplicationHard(appSpecifications, appSpecifications.name, false, null, appSpecifications);
            }
          } else {
            // composed application
            log.warn(`Beginning Redeployment of ${appSpecifications.name}...`);
            if (globalState.removalInProgress) {
              log.warn(`Another application is undergoing removal. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.installationInProgress) {
              log.warn(`Another application is undergoing installation. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.softRedeployInProgress) {
              log.warn(`Another application is undergoing soft redeploy. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if (globalState.hardRedeployInProgress) {
              log.warn(`Another application is undergoing hard redeploy. Skipping ${installedApp.name} for this cycle.`);
              // eslint-disable-next-line no-continue
              continue;
            }

            // Dynamic require to avoid circular dependency
            const appUninstaller = require('./appUninstaller');
            const appInstaller = require('./appInstaller');

            try {
              const reversedCompose = [...appSpecifications.compose].reverse();
              // eslint-disable-next-line no-restricted-syntax
              for (const appComponent of reversedCompose) {
                if (appComponent.tiered) {
                  const hddTier = `hdd${tier}`;
                  const ramTier = `ram${tier}`;
                  const cpuTier = `cpu${tier}`;
                  appComponent.cpu = appComponent[cpuTier] || appComponent.cpu;
                  appComponent.ram = appComponent[ramTier] || appComponent.ram;
                  appComponent.hdd = appComponent[hddTier] || appComponent.hdd;
                }

                const installedComponent = installedApp.compose.find((component) => component.name === appComponent.name);

                if (JSON.stringify(installedComponent) === JSON.stringify(appComponent)) {
                  log.warn(`Component ${appComponent.name}_${appSpecifications.name} specs were not changed, skipping.`);
                } else if (appComponent.hdd === installedComponent.hdd) {
                  log.warn(`Beginning Soft Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
                  // soft redeployment
                  // eslint-disable-next-line no-await-in-loop
                  await appUninstaller.appUninstallSoft(`${appComponent.name}_${appSpecifications.name}`, null, appSpecifications, true, null, true); // component
                  log.warn(`Application component ${appComponent.name}_${appSpecifications.name} softly removed. Awaiting installation...`);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
                } else {
                  log.warn(`Beginning Hard Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
                  log.warn(`REMOVAL REASON: Hard redeployment (component) - ${appComponent.name}_${appSpecifications.name} HDD changed from ${installedComponent.hdd} to ${appComponent.hdd}`);
                  // hard redeployment
                  // eslint-disable-next-line no-await-in-loop
                  await appUninstaller.appUninstallHard(`${appComponent.name}_${appSpecifications.name}`, null, appSpecifications, true, null, true); // component
                  log.warn(`Application component ${appComponent.name}_${appSpecifications.name} removed. Awaiting installation...`);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
                }
              }
              // connect to mongodb
              const dbopen = dbHelper.databaseConnection();
              const appsDatabase = dbopen.db(config.database.appslocal.database);
              const appsQuery = { name: appSpecifications.name };
              const appsProjection = {};
              log.warn('Cleaning up database...');
              // eslint-disable-next-line no-await-in-loop
              await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
              const databaseStatus2 = {
                status: 'Database cleaned',
              };
              log.warn('Database cleaned');
              log.warn(databaseStatus2);
              log.warn(`Compositions of application ${appSpecifications.name} uninstalled. Continuing with installation...`);
              // composition removal done. Remove from installed apps and being installation
              // eslint-disable-next-line no-await-in-loop
              await appInstaller.checkAppRequirements(appSpecifications); // entire app

              // Register the app in database BEFORE creating Docker containers to prevent race condition
              const isEnterprise = Boolean(
                appSpecifications.version >= 8 && appSpecifications.enterprise,
              );

              const dbSpecs = JSON.parse(JSON.stringify(appSpecifications));

              if (isEnterprise) {
                dbSpecs.compose = [];
                dbSpecs.contacts = [];
              }

              // eslint-disable-next-line no-await-in-loop
              const insertResult = await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
              if (!insertResult) {
                throw new Error(`CRITICAL: Failed to create database entry for ${appSpecifications.name} during composed app redeployment. Database insert returned undefined - likely duplicate key error or database failure. Aborting redeployment to prevent orphaned Docker containers.`);
              }
              log.info(`Database entry created for ${appSpecifications.name} BEFORE component Docker container creation (composed redeployment path)`);

              // Now install components - containers will be created but app is already in DB
              // eslint-disable-next-line no-restricted-syntax
              for (const appComponent of appSpecifications.compose) {
                if (appComponent.tiered) {
                  const hddTier = `hdd${tier}`;
                  const ramTier = `ram${tier}`;
                  const cpuTier = `cpu${tier}`;
                  appComponent.cpu = appComponent[cpuTier] || appComponent.cpu;
                  appComponent.ram = appComponent[ramTier] || appComponent.ram;
                  appComponent.hdd = appComponent[hddTier] || appComponent.hdd;
                }

                const installedComponent = installedApp.compose.find((component) => component.name === appComponent.name);

                if (JSON.stringify(installedComponent) === JSON.stringify(appComponent)) {
                  log.warn(`Component ${appComponent.name}_${appSpecifications.name} specs were not changed, skipping.`);
                } else if (appComponent.hdd === installedComponent.hdd) {
                  log.warn(`Continuing Soft Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
                  // install the app
                  // eslint-disable-next-line no-await-in-loop
                  await softRegisterAppLocally(appSpecifications, appComponent); // component
                } else {
                  log.warn(`Continuing Hard Redeployment of component ${appComponent.name}_${appSpecifications.name}...`);
                  // eslint-disable-next-line no-await-in-loop
                  await serviceHelper.delay(config.fluxapps.redeploy.composedDelay * 1000);
                  // install the app
                  // eslint-disable-next-line no-await-in-loop
                  await appInstaller.registerAppLocally(appSpecifications, appComponent); // component
                }
              }
              log.warn(`Composed application ${appSpecifications.name} updated.`);
              log.warn(`Restarting application ${appSpecifications.name}`);
              // eslint-disable-next-line no-await-in-loop, no-use-before-define
              await appDockerRestart(appSpecifications.name);
            } catch (error) {
              log.error(error);
              log.warn(`REMOVAL REASON: Redeployment error - ${appSpecifications.name} failed during redeployment: ${error.message}`);
              appUninstaller.removeAppLocally(appSpecifications.name, null, true, true, true); // remove entire app
            }
          }
        }
      }
    }
    globalState.reinstallationOfOldAppsInProgress = false;
  } catch (error) {
    globalState.reinstallationOfOldAppsInProgress = false;
    log.error(error);
  }
}

/**
 * Force cleanup of applications that are not in the installed apps list
 * @returns {Promise<void>}
 */
async function forceAppRemovals() {
  try {
    log.info('Executing forceAppRemovals.');

    // Skip if any installation or removal operations are in progress
    if (globalState.removalInProgress) {
      log.info('Skipping forceAppRemovals: Another application removal is in progress');
      return;
    }
    if (globalState.installationInProgress) {
      log.info('Skipping forceAppRemovals: Another application installation is in progress');
      return;
    }
    if (globalState.softRedeployInProgress) {
      log.info('Skipping forceAppRemovals: Soft redeploy is in progress');
      return;
    }
    if (globalState.hardRedeployInProgress) {
      log.info('Skipping forceAppRemovals: Hard redeploy is in progress');
      return;
    }
    if (globalState.reinstallationOfOldAppsInProgress) {
      log.info('Skipping forceAppRemovals: Reinstallation of old apps is in progress');
      return;
    }

    // Import services to match original business logic where everything was in the same file
    const appQueryService = require('../appQuery/appQueryService');
    const registryManager = require('../appDatabase/registryManager');
    const appUninstaller = require('./appUninstaller');

    // Get current node's IP for checking app locations
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      log.warn('Unable to get node IP, skipping forceAppRemovals');
      return;
    }

    const dockerAppsReported = await appQueryService.listAllApps();
    const dockerApps = dockerAppsReported.data;
    const installedAppsRes = await appQueryService.installedApps();
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

    // Connect to database for checking app locations
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.appsglobal.database);

    // eslint-disable-next-line no-restricted-syntax
    for (const dApp of dockerAppsTrueNameB) {
      // check if app is in installedApps
      const appInstalledExists = appsInstalled.find((app) => app.name === dApp);
      if (!appInstalledExists) {
        // Check if this app is registered in locations for this node's IP
        let shouldBroadcast = false;
        try {
          const locationQuery = { name: dApp, ip: myIP };
          const locationProjection = { projection: { _id: 0 } };
          // eslint-disable-next-line no-await-in-loop
          const appLocation = await dbHelper.findOneInDatabase(database, globalAppsLocations, locationQuery, locationProjection);
          if (appLocation) {
            shouldBroadcast = true;
            log.info(`${dApp} found in locations for this IP (${myIP}), will broadcast removal`);
          } else {
            log.info(`${dApp} not found in locations for this IP (${myIP}), skipping broadcast`);
          }
        } catch (locationError) {
          log.error(`Error checking app location for ${dApp}: ${locationError.message}`);
          // Default to not broadcasting on error to avoid false positives
        }

        // eslint-disable-next-line no-await-in-loop
        const appDetails = await registryManager.getApplicationGlobalSpecifications(dApp);
        if (appDetails) {
          // it is global app
          // do removal
          log.warn(`${dApp} does not exist in installed app. Forcing removal.`);
          log.warn(`REMOVAL REASON: Orphan app cleanup - ${dApp} running in Docker but not in installed apps database (forceAppRemovals)`);
          // eslint-disable-next-line no-await-in-loop
          await appUninstaller.removeAppLocally(dApp, null, true, true, shouldBroadcast).catch((error) => log.error(error)); // remove entire app, only broadcast if in locations
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(3 * 60 * 1000); // 3 mins
        } else {
          log.warn(`${dApp} does not exist in installed apps and global application specifications are missing. Forcing removal.`);
          log.warn(`REMOVAL REASON: Orphan app cleanup - ${dApp} running in Docker but missing from both installed apps DB and global specs (forceAppRemovals)`);
          // eslint-disable-next-line no-await-in-loop
          await appUninstaller.removeAppLocally(dApp, null, true, true, shouldBroadcast).catch((error) => log.error(error)); // remove entire app, only broadcast if in locations
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
 * @param {Array} restoreInProgress - Array of apps with restore in progress
 * @param {object} https - HTTPS module
 * @returns {Promise<void>}
 */
async function masterSlaveApps(globalStateParam, installedApps, listRunningApps, receiveOnlySyncthingAppsCache, backupInProgressParam, restoreInProgressParam, https) {
  try {
    globalStateParam.masterSlaveAppsRunning = true;
    // do not run if installationInProgress or removalInProgress or softRedeployInProgress or hardRedeployInProgress
    if (globalStateParam.installationInProgress || globalStateParam.removalInProgress || globalStateParam.softRedeployInProgress || globalStateParam.hardRedeployInProgress) {
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

    // Cleanup stale entries from maps to prevent memory leaks
    const validIdentifiers = new Set();
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled.data) {
      if (app.version <= 3) {
        if (app.containerData && app.containerData.includes('g:')) {
          validIdentifiers.add(app.name);
        }
      } else if (app.compose) {
        // eslint-disable-next-line no-restricted-syntax
        for (const comp of app.compose) {
          if (comp.containerData && comp.containerData.includes('g:')) {
            validIdentifiers.add(`${comp.name}_${app.name}`);
          }
        }
      }
    }

    // Remove stale entries from mastersRunningGSyncthingApps
    // eslint-disable-next-line no-restricted-syntax
    for (const identifier of mastersRunningGSyncthingApps.keys()) {
      if (!validIdentifiers.has(identifier)) {
        mastersRunningGSyncthingApps.delete(identifier);
        log.info(`masterSlaveApps: Cleaned up stale entry from mastersRunningGSyncthingApps: ${identifier}`);
      }
    }

    // Remove stale entries from timeTostartNewMasterApp
    // eslint-disable-next-line no-restricted-syntax
    for (const identifier of timeTostartNewMasterApp.keys()) {
      if (!validIdentifiers.has(identifier)) {
        timeTostartNewMasterApp.delete(identifier);
        log.info(`masterSlaveApps: Cleaned up stale entry from timeTostartNewMasterApp: ${identifier}`);
      }
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const installedApp of appsInstalled.data) {
      let fdmOk = true;
      let identifier;
      let needsToBeChecked = false;
      let appId;
      const backupSkip = backupInProgressParam.some((backupItem) => installedApp.name === backupItem);
      const restoreSkip = restoreInProgressParam.some((backupItem) => installedApp.name === backupItem);
      if (backupSkip || restoreSkip) {
        log.info(`masterSlaveApps: Backup/Restore is running for ${installedApp.name}, syncthing masterSlave check is disabled for that app`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (installedApp.version <= 3) {
        identifier = installedApp.name;
        appId = dockerService.getAppIdentifier(identifier);
        // Check all g: mode apps, not just those in cache with restarted flag
        // The cache tracks sync state, but shouldn't gate primary selection
        needsToBeChecked = installedApp.containerData.includes('g:');
      } else {
        const componentUsingMasterSlave = installedApp.compose.find((comp) => comp.containerData.includes('g:'));
        if (componentUsingMasterSlave) {
          identifier = `${componentUsingMasterSlave.name}_${installedApp.name}`;
          appId = dockerService.getAppIdentifier(identifier);
          // Check all g: mode apps, not just those in cache with restarted flag
          needsToBeChecked = true;
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
        if (!ip) {
          fdmOk = true;
          // eslint-disable-next-line no-await-in-loop
          let fdmASIAData = await serviceHelper.axiosGet(`https://fdm-sg-1-${fdmIndex}.runonflux.io/fluxstatistics?scope=${installedApp.name}apprunonfluxio;json;norefresh`, axiosOptions).catch((error) => {
            log.error(`masterSlaveApps: Failed to reach ASIA FDM with error: ${error}`);
            fdmOk = false;
          });
          if (fdmOk) {
            fdmASIAData = fdmASIAData.data;
            if (fdmASIAData && fdmASIAData.length > 0) {
              // eslint-disable-next-line no-restricted-syntax
              for (const fdmData of fdmASIAData) {
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
        if (!fdmOk) {
          log.warn(`masterSlaveApps: All FDM services failed for app:${installedApp.name}, skipping primary selection for this cycle`);
          // eslint-disable-next-line no-continue
          continue;
        }
        if (fdmOk) {
          // no ip means there was no row with ip on fdm
          // down means there was a row ip with status down
          // eslint-disable-next-line no-await-in-loop
          let myIP;
          try {
            myIP = await fluxNetworkHelper.getMyFluxIPandPort();
          } catch (error) {
            log.error(`masterSlaveApps: Failed to get my IP for app:${installedApp.name}, error: ${error.message}`);
            // eslint-disable-next-line no-continue
            continue;
          }
          if (myIP) {
            if (myIP.indexOf(':') < 0) {
              myIP += ':16127';
            }
            // Validate ip is a string if it exists
            if (ip && typeof ip !== 'string') {
              log.error(`masterSlaveApps: Invalid IP type from FDM for app:${installedApp.name}, got: ${typeof ip}`);
              // eslint-disable-next-line no-continue
              continue;
            }
            if ((!ip)) {
              log.info(`masterSlaveApps: app:${installedApp.name} has currently no primary set`);
              if (!runningAppsNames.includes(identifier)) {
                // Check if app is ready (syncthing data is synced) before allowing it to become primary
                let isReady = receiveOnlySyncthingAppsCache.has(appId) && receiveOnlySyncthingAppsCache.get(appId).restarted;

                // Fallback: If not in cache or not ready, check if syncthing folder is already in sendreceive mode
                // This handles the case where folder is synced but cache was cleared/lost
                if (!isReady) {
                  try {
                    const syncthingService = require('../syncthingService');
                    // eslint-disable-next-line no-await-in-loop
                    const allSyncthingFolders = await syncthingService.getConfigFolders();
                    if (allSyncthingFolders.status === 'success') {
                      const folder = `${appsFolder}${appId}`;
                      // eslint-disable-next-line no-restricted-syntax
                      for (const syncthingFolder of allSyncthingFolders.data) {
                        if (syncthingFolder.path === folder && syncthingFolder.type === 'sendreceive') {
                          log.info(`masterSlaveApps: app:${installedApp.name} folder is already in sendreceive mode, treating as ready`);
                          isReady = true;
                          break;
                        }
                      }
                    }
                  } catch (error) {
                    log.error(`masterSlaveApps: Failed to check syncthing folder status for ${installedApp.name}: ${error.message}`);
                  }
                }

                if (!isReady) {
                  log.info(`masterSlaveApps: app:${installedApp.name} is not ready yet (syncthing not synced), skipping primary selection for this cycle`);
                  // eslint-disable-next-line no-continue
                  continue;
                }
                // eslint-disable-next-line no-await-in-loop
                const registryManager = require('../appDatabase/registryManager');
                const runningAppList = await registryManager.appLocation(installedApp.name);
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
                  if (a.ip < b.ip) {
                    return -1;
                  }
                  if (a.ip > b.ip) {
                    return 1;
                  }
                  return 0;
                });
                const index = runningAppList.findIndex((x) => x.ip.split(':')[0] === myIP.split(':')[0]);
                if (index === 0 && !mastersRunningGSyncthingApps.has(identifier)) {
                  appDockerRestart(installedApp.name);
                  log.info(`masterSlaveApps: starting docker app:${installedApp.name} index: ${index}`);
                } else if (!timeTostartNewMasterApp.has(identifier) && mastersRunningGSyncthingApps.has(identifier) && mastersRunningGSyncthingApps.get(identifier) !== myIP) {
                  const { CancelToken } = axios;
                  const source = CancelToken.source();
                  let isResolved = false;
                  const timeout = 5 * 1000; // 5 seconds
                  setTimeout(() => {
                    if (!isResolved) {
                      source.cancel('Operation canceled by the user.');
                    }
                  }, timeout * 2);
                  const url = mastersRunningGSyncthingApps.get(identifier);
                  const ipToCheckAppRunning = url.split(':')[0];
                  const portToCheckAppRunning = url.split(':')[1] || '16127';
                  let previousMasterStillRunning = false;
                  try {
                    // eslint-disable-next-line no-await-in-loop
                    const response = await axios.get(`http://${ipToCheckAppRunning}:${portToCheckAppRunning}/apps/listrunningapps`, { timeout, cancelToken: source.token });
                    isResolved = true;
                    const appsRunning = response.data.data;
                    if (appsRunning.find((app) => app.Names[0].includes(installedApp.name))) {
                      log.info(`masterSlaveApps: app:${installedApp.name} is not on fdm but previous master is running it at: ${url}`);
                      previousMasterStillRunning = true;
                    }
                  } catch (error) {
                    log.info(`masterSlaveApps: Failed to reach previous master at ${url} for app:${installedApp.name}, will proceed with primary selection. Error: ${error.message}`);
                    isResolved = true;
                  }
                  if (previousMasterStillRunning) {
                    return;
                  }
                  // if it was running before on this node was removed from fdm, app was stopped or node rebooted, we will only start the app on a different node
                  if (index === 0) {
                    appDockerRestart(installedApp.name);
                    log.info(`masterSlaveApps: starting docker app:${installedApp.name} index: ${index}`);
                  } else {
                    const previousMasterIndex = runningAppList.findIndex((x) => x.ip.split(':')[0] === mastersRunningGSyncthingApps.get(identifier).split(':')[0]);
                    let timetoStartApp = Date.now();
                    if (previousMasterIndex >= 0) {
                      log.info(`masterSlaveApps: app:${installedApp.name} had primary running at index: ${previousMasterIndex}`);
                      if (index > previousMasterIndex) {
                        timetoStartApp += (index - 1) * 3 * 60 * 1000;
                      } else {
                        timetoStartApp += index * 3 * 60 * 1000;
                      }
                    } else {
                      timetoStartApp += index * 3 * 60 * 1000;
                    }
                    if (timetoStartApp <= Date.now()) {
                      appDockerRestart(installedApp.name);
                      log.info(`masterSlaveApps: starting docker app:${installedApp.name} index: ${index}`);
                    } else {
                      log.info(`masterSlaveApps: will start docker app:${installedApp.name} at ${timetoStartApp.toString()}`);
                      timeTostartNewMasterApp.set(identifier, timetoStartApp);
                    }
                  }
                } else if (timeTostartNewMasterApp.has(identifier) && timeTostartNewMasterApp.get(identifier) <= Date.now()) {
                  appDockerRestart(installedApp.name);
                  log.info(`masterSlaveApps: starting docker app:${installedApp.name} index: ${index} that was scheduled to start at ${timeTostartNewMasterApp.get(identifier).toString()}`);
                } else {
                  appDockerRestart(installedApp.name);
                  log.info(`masterSlaveApps: no previous information about primary, starting docker app:${installedApp.name}`);
                }
              }
            } else {
              mastersRunningGSyncthingApps.set(identifier, ip);
              if (timeTostartNewMasterApp.has(identifier)) {
                log.info(`masterSlaveApps: app:${installedApp.name} removed from timeTostartNewMasterApp cache, already started on another standby node`);
                timeTostartNewMasterApp.delete(identifier);
              }
              if (myIP.split(':')[0] !== ip.split(':')[0] && runningAppsNames.includes(identifier)) {
                appDockerStop(installedApp.name);
                log.info(`masterSlaveApps: stopping docker app:${installedApp.name} it's running on ip:${ip} and myIP is: ${myIP}`);
              } else if (myIP.split(':')[0] === ip.split(':')[0] && !runningAppsNames.includes(identifier)) {
                // Check if app is ready (syncthing data is synced) before starting
                let isReady = receiveOnlySyncthingAppsCache.has(appId) && receiveOnlySyncthingAppsCache.get(appId).restarted;

                // Fallback: If not in cache or not ready, check if syncthing folder is already in sendreceive mode
                if (!isReady) {
                  try {
                    const syncthingService = require('../syncthingService');
                    // eslint-disable-next-line no-await-in-loop
                    const allSyncthingFolders = await syncthingService.getConfigFolders();
                    if (allSyncthingFolders.status === 'success') {
                      const folder = `${appsFolder}${appId}`;
                      // eslint-disable-next-line no-restricted-syntax
                      for (const syncthingFolder of allSyncthingFolders.data) {
                        if (syncthingFolder.path === folder && syncthingFolder.type === 'sendreceive') {
                          log.info(`masterSlaveApps: app:${installedApp.name} folder is already in sendreceive mode, treating as ready`);
                          isReady = true;
                          break;
                        }
                      }
                    }
                  } catch (error) {
                    log.error(`masterSlaveApps: Failed to check syncthing folder status for ${installedApp.name}: ${error.message}`);
                  }
                }

                if (isReady) {
                  appDockerRestart(installedApp.name);
                  log.info(`masterSlaveApps: starting docker app:${installedApp.name}`);
                } else {
                  log.info(`masterSlaveApps: app:${installedApp.name} is registered as primary on FDM but not ready yet (syncthing not synced), skipping start for this cycle`);
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    log.error(`masterSlaveApps: ${error}`);
  } finally {
    globalStateParam.masterSlaveAppsRunning = false;
    await serviceHelper.delay(30 * 1000);
    masterSlaveApps(globalStateParam, installedApps, listRunningApps, receiveOnlySyncthingAppsCache, backupInProgressParam, restoreInProgressParam, https);
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
  hardRedeploy,
  redeployAPI,
  verifyAppUpdateParameters,
  updateAppGlobalyApi,
  stopSyncthingApp,
  appendBackupTask,
  appendRestoreTask,
  removeTestAppMount,
  testAppMount,
  validateApplicationUpdateCompatibility,
  getPreviousAppSpecifications,
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