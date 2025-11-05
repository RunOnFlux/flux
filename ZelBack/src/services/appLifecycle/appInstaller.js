const os = require('os');
// path is used for dynamic requires in the file
// eslint-disable-next-line no-unused-vars
const path = require('path');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const dockerService = require('../dockerService');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const generalService = require('../generalService');
const benchmarkService = require('../benchmarkService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const geolocationService = require('../geolocationService');
const appUninstaller = require('./appUninstaller');
// const advancedWorkflows = require('./advancedWorkflows'); // Moved to dynamic require to avoid circular dependency
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const { storeAppRunningMessage, storeAppInstallingErrorMessage } = require('../appMessaging/messageStore');
const { systemArchitecture } = require('../appSystem/systemIntegration');
const { checkApplicationImagesCompliance } = require('../appSecurity/imageManager');
const { startAppMonitoring } = require('../appManagement/appInspector');
const imageVerifier = require('../utils/imageVerifier');
// pgpService is used in commented out code
// eslint-disable-next-line no-unused-vars
const pgpService = require('../pgpService');
const registryCredentialHelper = require('../utils/registryCredentialHelper');
const upnpService = require('../upnpService');
const globalState = require('../utils/globalState');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const log = require('../../lib/log');
const { appsFolder, localAppsInformation, scannedHeightCollection } = require('../utils/appConstants');
const { checkAppTemporaryMessageExistence, checkAppMessageExistence } = require('../appMessaging/messageVerifier');
const { availableApps, getApplicationGlobalSpecifications } = require('../appDatabase/registryManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const config = require('config');

// Legacy apps that use old gateway IP assignment method
const appsThatMightBeUsingOldGatewayIpAssignment = ['HNSDoH', 'dane', 'fdm', 'Jetpack2', 'fdmdedicated', 'isokosse', 'ChainBraryDApp', 'health', 'ethercalc'];

// Helper functions and constants for installApplicationHard
const util = require('util');
const { exec } = require('child_process');

const cmdAsync = util.promisify(exec);
const dockerPullStreamPromise = util.promisify(dockerService.dockerPullStream);

const supportedArchitectures = ['amd64', 'arm64'];

/**
 * Verify that the app volume is mounted
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {string} componentName - Component name (if isComponent is true)
 * @returns {Promise<boolean>} True if mount exists, throws error otherwise
 */
async function verifyAppVolumeMount(appName, isComponent, componentName) {
  const identifier = isComponent ? `${componentName}_${appName}` : appName;
  const appId = dockerService.getAppIdentifier(identifier);
  const mountPath = `${appsFolder}${appId}`;

  try {
    // Check if mount exists using mount command
    // grep will throw if no match is found
    const { stdout } = await cmdAsync(`mount | grep "${mountPath}"`);
    if (stdout && stdout.includes(mountPath)) {
      log.info(`Volume mount verified for ${identifier} at ${mountPath}`);
      return true;
    }
  } catch (error) {
    // grep returns non-zero exit code when no matches found, or other command errors
    const errorMessage = `Volume mount verification failed for ${mountPath}. Mount does not exist or is not accessible.`;
    log.error(`${errorMessage} Details: ${error.message}`);
    throw new Error(errorMessage);
  }

  // This shouldn't be reached, but just in case
  throw new Error(`Volume mount verification failed for ${mountPath}. Mount does not exist or is not accessible.`);
}

/**
 * Perform Docker cleanup (prune containers, networks, volumes, images)
 * @param {object} res - Response object for streaming
 * @returns {Promise<void>}
 */
async function performDockerCleanup(res) {
  const dockerContainers = {
    status: 'Clearing up unused docker containers...',
  };
  log.info(dockerContainers);
  if (res) {
    res.write(serviceHelper.ensureString(dockerContainers));
    if (res.flush) res.flush();
  }
  await dockerService.pruneContainers();
  const dockerContainers2 = {
    status: 'Docker containers cleaned.',
  };
  if (res) {
    res.write(serviceHelper.ensureString(dockerContainers2));
    if (res.flush) res.flush();
  }

  const dockerNetworks = {
    status: 'Clearing up unused docker networks...',
  };
  log.info(dockerNetworks);
  if (res) {
    res.write(serviceHelper.ensureString(dockerNetworks));
    if (res.flush) res.flush();
  }
  await dockerService.pruneNetworks();
  const dockerNetworks2 = {
    status: 'Docker networks cleaned.',
  };
  if (res) {
    res.write(serviceHelper.ensureString(dockerNetworks2));
    if (res.flush) res.flush();
  }

  const dockerVolumes = {
    status: 'Clearing up unused docker volumes...',
  };
  log.info(dockerVolumes);
  if (res) {
    res.write(serviceHelper.ensureString(dockerVolumes));
    if (res.flush) res.flush();
  }
  await dockerService.pruneVolumes();
  const dockerVolumes2 = {
    status: 'Docker volumes cleaned.',
  };
  if (res) {
    res.write(serviceHelper.ensureString(dockerVolumes2));
    if (res.flush) res.flush();
  }

  const dockerImages = {
    status: 'Clearing up unused docker images...',
  };
  log.info(dockerImages);
  if (res) {
    res.write(serviceHelper.ensureString(dockerImages));
    if (res.flush) res.flush();
  }
  await dockerService.pruneImages();
  const dockerImages2 = {
    status: 'Docker images cleaned.',
  };
  if (res) {
    res.write(serviceHelper.ensureString(dockerImages2));
    if (res.flush) res.flush();
  }
}

/**
 * Setup firewall and UPnP ports for application/component
 * @param {object} appSpecifications - App or component specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object for streaming
 * @param {boolean} test - Whether this is a test installation (skips port setup if true)
 * @returns {Promise<void>}
 */
async function setupApplicationPorts(appSpecifications, appName, isComponent, res, test = false) {
  const portStatusInitial = {
    status: isComponent ? `Allowing component ${appSpecifications.name} of Flux App ${appName} ports...` : `Allowing Flux App ${appName} ports...`,
  };
  log.info(portStatusInitial);
  if (res) {
    res.write(serviceHelper.ensureString(portStatusInitial));
    if (res.flush) res.flush();
  }

  if (!test && appSpecifications.ports) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        const portResponse = await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(port));
        if (portResponse.status === true) {
          const portStatus = {
            status: `Port ${port} OK`,
          };
          log.info(portStatus);
          if (res) {
            res.write(serviceHelper.ensureString(portStatus));
            if (res.flush) res.flush();
          }
        } else {
          throw new Error(`Error: Port ${port} FAILed to open.`);
        }
      }
    } else {
      log.info('Firewall not active, application ports are open');
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      log.info('Custom port specified, mapping ports');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        const portResponse = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
        if (portResponse === true) {
          const portStatus = {
            status: `Port ${port} mapped OK`,
          };
          log.info(portStatus);
          if (res) {
            res.write(serviceHelper.ensureString(portStatus));
            if (res.flush) res.flush();
          }
        } else {
          throw new Error(`Error: Port ${port} FAILed to map.`);
        }
      }
    }
  } else if (!test && appSpecifications.port) {
    // v1 compatibility
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      const portResponse = await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(appSpecifications.port));
      if (portResponse.status === true) {
        const portStatus = {
          status: `Port ${appSpecifications.port} OK`,
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
          if (res.flush) res.flush();
        }
      } else {
        throw new Error(`Error: Port ${appSpecifications.port} FAILed to open.`);
      }
    } else {
      log.info('Firewall not active, application ports are open');
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      log.info('Custom port specified, mapping ports');
      const portResponse = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
      if (portResponse === true) {
        const portStatus = {
          status: `Port ${appSpecifications.port} mapped OK`,
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
          if (res.flush) res.flush();
        }
      } else {
        throw new Error(`Error: Port ${appSpecifications.port} FAILed to map.`);
      }
    }
  }
}

/**
 * Verify and pull Docker image for application/component
 * @param {object} appSpecifications - App or component specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object for streaming
 * @param {object} fullAppSpecs - Full app specifications
 * @returns {Promise<void>}
 */
async function verifyAndPullImage(appSpecifications, appName, isComponent, res, fullAppSpecs) {
  // check image and its architecture
  const architecture = await systemArchitecture();
  if (!supportedArchitectures.includes(architecture)) {
    throw new Error(`Invalid architecture ${architecture} detected.`);
  }

  // check blacklist
  await checkApplicationImagesCompliance(fullAppSpecs);

  const { repotag, repoauth } = appSpecifications;
  const { version: specVersion } = fullAppSpecs;

  const imgVerifier = new imageVerifier.ImageVerifier(
    repotag,
    { maxImageSize: config.fluxapps.maxImageSize, architecture, architectureSet: supportedArchitectures },
  );

  const pullConfig = { repoTag: repotag };

  let authToken = null;

  if (repoauth) {
    // Use credential helper to handle version-aware decryption and cloud providers
    const credentials = await registryCredentialHelper.getCredentials(
      repotag,
      repoauth,
      specVersion, // Pass parent spec version for v7/v8 handling
    );

    if (!credentials) {
      throw new Error('Unable to get credentials');
    }

    // Pass credentials object directly to ImageVerifier (no string conversion needed)
    imgVerifier.addCredentials(credentials);

    // dockerService still expects string format - convert only for that
    authToken = `${credentials.username}:${credentials.password}`;
    pullConfig.authToken = authToken;
  }

  await imgVerifier.verifyImage();
  imgVerifier.throwIfError();

  if (!imgVerifier.supported) {
    throw new Error(`Architecture ${architecture} not supported by ${appSpecifications.repotag}`);
  }

  // if dockerhub, this is now registry-1.docker.io instead of hub.docker.com
  pullConfig.provider = imgVerifier.provider;

  // eslint-disable-next-line no-unused-vars
  await dockerPullStreamPromise(pullConfig, res);

  const pullStatus = {
    status: isComponent ? `Pulling component ${appSpecifications.name} of Flux App ${appName}` : `Pulling global Flux App ${appName} was successful`,
  };

  if (res) {
    res.write(serviceHelper.ensureString(pullStatus));
    if (res.flush) res.flush();
  }
}

/**
 * To register an app locally. Performs pre-installation checks - database in place, Flux Docker network in place and if app already installed. Then registers app in database and performs hard install. If registration fails, the app is removed locally.
 * @param {object} appSpecs App specifications.
 * @param {object} componentSpecs Component specifications.
 * @param {object} res Response.
 * @param {boolean} test indicates if it is just to test the app install.
 * @returns {Promise<boolean>} Returns true if installation was successful, false otherwise.
 */
async function registerAppLocally(appSpecs, componentSpecs, res, test = false) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from app messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  try {
    if (globalState.removalInProgress) {
      const rStatus = messageHelper.createWarningMessage('Another application is undergoing removal. Installation not possible.');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }
    if (globalState.installationInProgress) {
      const rStatus = messageHelper.createWarningMessage('Another application is undergoing installation. Installation not possible');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
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
      return false;
    }

    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (benchmarkResponse.status === 'error') {
      throw new Error('FluxBench status Error. Application cannot be installed at the moment');
    }
    if (benchmarkResponse.data.thunder) {
      throw new Error('Flux Node is a Fractus Storage Node. Applications cannot be installed at this node type');
    }
    // get my external IP and check that it is longer than 5 in length.
    let myIP = null;
    if (benchmarkResponse.data.ipaddress) {
      log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
      myIP = benchmarkResponse.data.ipaddress.length > 5 ? benchmarkResponse.data.ipaddress : null;
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
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
        res.write(rStatus);
        res.end();
      }
      return false;
    }

    // Lazy-load appQueryService to avoid circular dependency issues
    // eslint-disable-next-line global-require
    const appQueryService = require('../appQuery/appQueryService');
    const installedAppsRes = await appQueryService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const runningAppsRes = await appQueryService.listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const runningApps = runningAppsRes.data;
    const installedAppComponentNames = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((appAux) => {
          installedAppComponentNames.push(`${appAux.name}_${app.name}`);
        });
      } else {
        installedAppComponentNames.push(app.name);
      }
    });
    // kadena and folding is old naming scheme having /zel.  all global application start with /flux
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    // installed always is bigger array than running
    const runningSet = new Set(runningAppsNames);
    const stoppedApps = installedAppComponentNames.filter((installedApp) => !runningSet.has(installedApp));
    if (stoppedApps.length === 0 && !globalState.masterSlaveAppsRunning) {
      await performDockerCleanup(res);
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

      // Ensure no stale database entry exists before inserting
      // This prevents duplicate key errors and ensures fresh data
      const cleanupQuery = { name: appSpecifications.name };
      const existingEntry = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, cleanupQuery, {});
      if (existingEntry) {
        log.warn(`Found existing database entry for ${appSpecifications.name} during registration. Cleaning up stale entry.`);
        await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, cleanupQuery, {});
        log.info(`Stale database entry for ${appSpecifications.name} removed. Proceeding with fresh insert.`);
      }

      const insertResult = await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
      if (!insertResult) {
        throw new Error(`CRITICAL: Failed to create database entry for ${appSpecifications.name}. Database insert returned undefined - likely duplicate key error or database failure. Aborting installation to prevent orphaned Docker containers.`);
      }
      log.info(`Database entry created for ${appSpecifications.name} BEFORE Docker container creation`);
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appSpecifications.cpu = test ? 0.2 : appSpecifications[cpuTier] || appSpecifications.cpu;
      appSpecifications.ram = test ? 300 : appSpecifications[ramTier] || appSpecifications.ram;
      appSpecifications.hdd = test ? 2 : appSpecifications[hddTier] || appSpecifications.hdd;
    } else {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      appComponent.cpu = test ? 0.2 : appComponent[cpuTier] || appComponent.cpu;
      appComponent.ram = test ? 300 : appComponent[ramTier] || appComponent.ram;
      appComponent.hdd = test ? 2 : appComponent[hddTier] || appComponent.hdd;
    }

    const specificationsToInstall = isComponent ? appComponent : appSpecifications;
    try {
      // Validate database entry exists before creating Docker containers (atomic transaction check)
      // This prevents orphaned Docker containers if DB entry was deleted/corrupted between insert and Docker creation
      if (!isComponent) {
        const dbValidationQuery = { name: appSpecifications.name };
        const dbValidationProjection = { projection: { _id: 0, name: 1 } };
        const dbEntryExists = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, dbValidationQuery, dbValidationProjection);
        if (!dbEntryExists) {
          throw new Error(`Database entry validation failed for ${appSpecifications.name}. Entry was inserted but disappeared before Docker container creation. Possible race condition or database corruption detected.`);
        }
        log.info(`Database entry validated for ${appSpecifications.name} before Docker container creation`);
      }

      if (specificationsToInstall.version >= 4) { // version is undefined for component
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponentSpecs of specificationsToInstall.compose) {
          isComponent = true;
          const hddTier = `hdd${tier}`;
          const ramTier = `ram${tier}`;
          const cpuTier = `cpu${tier}`;
          appComponentSpecs.cpu = test ? 0.2 : appComponentSpecs[cpuTier] || appComponentSpecs.cpu;
          appComponentSpecs.ram = test ? 300 : appComponentSpecs[ramTier] || appComponentSpecs.ram;
          appComponentSpecs.hdd = test ? 2 : appComponentSpecs[hddTier] || appComponentSpecs.hdd;
          // eslint-disable-next-line no-await-in-loop, no-use-before-define
          await installApplicationHard(appComponentSpecs, appName, isComponent, res, appSpecifications, test);
        }
      } else {
        // eslint-disable-next-line no-use-before-define
        await installApplicationHard(specificationsToInstall, appName, isComponent, res, appSpecifications, test);
      }
    } catch (error) {
      if (!test) {
        const errorResponse = messageHelper.createErrorMessage(
          error.message || error,
          error.name,
          error.code,
        );
        const broadcastedAt = Date.now();
        const newAppRunningMessage = {
          type: 'fluxappinstallingerror',
          version: 1,
          name: appSpecifications.name,
          hash: appSpecifications.hash, // hash of application specifics that are running
          error: serviceHelper.ensureString(errorResponse),
          ip: myIP,
          broadcastedAt,
        };
        // store it in local database first
        // eslint-disable-next-line no-await-in-loop, no-use-before-define
        await storeAppInstallingErrorMessage(newAppRunningMessage);
        // broadcast messages about running apps to all peers
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
        await serviceHelper.delay(500);
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
        // broadcast messages about running apps to all peers
      }
      throw error;
    }

    log.info(`Flux App: ${appName} is test install: ${test}`);

    if (!test) {
      const broadcastedAt = Date.now();
      const newAppRunningMessage = {
        type: 'fluxapprunning',
        version: 1,
        name: appSpecifications.name,
        hash: appSpecifications.hash, // hash of application specifics that are running
        ip: myIP,
        broadcastedAt,
        runningSince: new Date(broadcastedAt).toISOString(),
        osUptime: os.uptime(),
        staticIp: geolocationService.isStaticIP(),
      };

      // store it in local database first
      // eslint-disable-next-line no-await-in-loop, no-use-before-define
      await storeAppRunningMessage(newAppRunningMessage);
      // broadcast messages about running apps to all peers
      await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
      await serviceHelper.delay(500);
      await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
      // broadcast messages about running apps to all peers
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
    if (!test) {
      const removeStatus = messageHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
      log.info(removeStatus);
      if (res) {
        res.write(serviceHelper.ensureString(removeStatus));
        if (res.flush) res.flush();
      }
      await appUninstaller.removeAppLocally(appSpecs.name, res, true, true, false);
      log.info(`Cleanup completed for ${appSpecs.name} after installation failure`);
    }
    return false;
  }
  return true;
}

/**
 * Install application (hard installation with Docker)
 * @param {object} appSpecifications - App specifications or component specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object
 * @param {object} fullAppSpecs - Full app specifications
 * @param {boolean} test - Whether this is a test installation
 * @returns {Promise<void>} Installation result
 */
async function installApplicationHard(appSpecifications, appName, isComponent, res, fullAppSpecs, test = false) {
  // Verify and pull Docker image
  await verifyAndPullImage(appSpecifications, appName, isComponent, res, fullAppSpecs);

  // Dynamic require to avoid circular dependency
  // eslint-disable-next-line global-require
  const advancedWorkflows = require('./advancedWorkflows');
  await advancedWorkflows.createAppVolume(appSpecifications, appName, isComponent, res);

  // Verify that the volume was mounted successfully
  const verifyingMount = {
    status: isComponent ? `Verifying volume mount for component ${appSpecifications.name}...` : `Verifying volume mount for ${appName}...`,
  };
  log.info(verifyingMount);
  if (res) {
    res.write(serviceHelper.ensureString(verifyingMount));
    if (res.flush) res.flush();
  }

  await verifyAppVolumeMount(appName, isComponent, appSpecifications.name);

  const mountVerified = {
    status: isComponent ? `Volume mount verified for component ${appSpecifications.name}` : `Volume mount verified for ${appName}`,
  };
  log.info(mountVerified);
  if (res) {
    res.write(serviceHelper.ensureString(mountVerified));
    if (res.flush) res.flush();
  }

  const createApp = {
    status: isComponent ? `Creating component ${appSpecifications.name} of Flux App ${appName}` : `Creating Flux App ${appName}`,
  };
  log.info(createApp);
  if (res) {
    res.write(serviceHelper.ensureString(createApp));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  // Setup firewall and UPnP ports
  await setupApplicationPorts(appSpecifications, appName, isComponent, res, test);

  const startStatus = {
    status: isComponent ? `Starting component ${appSpecifications.name} of Flux App ${appName}...` : `Starting Flux App ${appName}...`,
  };
  log.info(startStatus);
  if (res) {
    res.write(serviceHelper.ensureString(startStatus));
    if (res.flush) res.flush();
  }
  if (test || (!appSpecifications.containerData.includes('r:') && !appSpecifications.containerData.includes('g:'))) {
    const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
    const app = await dockerService.appDockerStart(identifier);
    if (!app) {
      throw new Error(`Failed to start ${identifier} container`);
    }
    if (!test) {
      startAppMonitoring(identifier);
    }
    const appResponse = messageHelper.createDataMessage(app);
    log.info(appResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appResponse));
      if (res.flush) res.flush();
    }
  }
}

/**
 * To soft install app. Pulls image/s, creates components/app, assigns ports to components/app and starts all containers. Does not create data volumes.
 * @param {object} appSpecifications App specifications or component specifications.
 * @param {string} appName App name.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} res Response.
 * @param {object} fullAppSpecs Full app specifications.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function installApplicationSoft(appSpecifications, appName, isComponent, res, fullAppSpecs) {
  // Verify and pull Docker image
  await verifyAndPullImage(appSpecifications, appName, isComponent, res, fullAppSpecs);

  const createApp = {
    status: isComponent ? `Creating component ${appSpecifications.name} of local Flux App ${appName}` : `Creating local Flux App ${appName}`,
  };
  log.info(createApp);
  if (res) {
    res.write(serviceHelper.ensureString(createApp));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  // Setup firewall and UPnP ports (no test parameter for soft install, defaults to false)
  await setupApplicationPorts(appSpecifications, appName, isComponent, res);

  const startStatus = {
    status: isComponent ? `Starting component ${appSpecifications.name} of Flux App ${appName}...` : `Starting Flux App ${appName}...`,
  };
  log.info(startStatus);
  if (res) {
    res.write(serviceHelper.ensureString(startStatus));
    if (res.flush) res.flush();
  }
  if (!appSpecifications.containerData.includes('g:')) {
    const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
    const app = await dockerService.appDockerStart(identifier);
    if (!app) {
      throw new Error(`Failed to start ${identifier} container`);
    }
    startAppMonitoring(identifier);
    const appResponse = messageHelper.createDataMessage(app);
    log.info(appResponse);
    if (res) {
      res.write(serviceHelper.ensureString(appResponse));
      if (res.flush) res.flush();
    }
  }
}

/**
 * Install application locally - Main API entry point
 * @param {object} req - Request object containing appname in params or query
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function installAppLocally(req, res) {
  try {
    // appname can be app name or app hash of specific app version
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }
    let blockAllowance = config.fluxapps.ownerAppAllowance;
    // needs to be logged in
    const authorized = await verificationHelper.verifyPrivilege('user', req);
    if (authorized) {
      let appSpecifications;
      // anyone can deploy temporary app
      // favor temporary to launch test temporary apps
      const tempMessage = await checkAppTemporaryMessageExistence(appname);
      if (tempMessage) {
        // eslint-disable-next-line prefer-destructuring
        appSpecifications = tempMessage.appSpecifications;
        // blockAllowance is used for future validation
        // eslint-disable-next-line no-unused-vars
        blockAllowance = config.fluxapps.temporaryAppAllowance;
      }
      if (!appSpecifications) {
        // only owner can deploy permanent message or existing app
        const ownerAuthorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
        if (!ownerAuthorized) {
          const errMessage = messageHelper.errUnauthorizedMessage();
          res.json(errMessage);
          return;
        }
      }
      if (!appSpecifications) {
        const allApps = await availableApps();
        appSpecifications = allApps.find((app) => app.name === appname);
      }
      if (!appSpecifications) {
        // eslint-disable-next-line no-use-before-define
        appSpecifications = await getApplicationGlobalSpecifications(appname);
      }
      // search in permanent messages for the specific apphash to launch
      if (!appSpecifications) {
        const permMessage = await checkAppMessageExistence(appname);
        if (permMessage) {
          // eslint-disable-next-line prefer-destructuring
          appSpecifications = permMessage.appSpecifications;
        }
      }
      if (!appSpecifications) {
        throw new Error(`Application Specifications of ${appname} not found`);
      }

      // we have to do this as not all paths above decrypt the app specs
      // this is a bit of a hack until we tidy up the app spec mess (use classes)
      if (
        appSpecifications.version >= 8
        && appSpecifications.enterprise
        && !appSpecifications.compose.length
      ) {
        appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
        appSpecifications = specificationFormatter(appSpecifications);
      }

      // get current height
      const dbopen = dbHelper.databaseConnection();
      if (!appSpecifications.height && appSpecifications.height !== 0) {
        // precaution for old temporary apps. Set up for custom test specifications.
        const database = dbopen.db(config.database.daemon.database);
        const query = { generalScannedHeight: { $gte: 0 } };
        const projection = {
          projection: {
            _id: 0,
            generalScannedHeight: 1,
          },
        };
        const result = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
        if (!result) {
          throw new Error('Scanning not initiated');
        }
        const explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight);
        appSpecifications.height = explorerHeight - config.fluxapps.blocksLasting + blockAllowance; // allow running for this amount of blocks
      }

      const appsDatabase = dbopen.db(config.database.appslocal.database);
      const appsQuery = {}; // all
      const appsProjection = {
        projection: {
          _id: 0,
          name: 1,
        },
      };
      const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
      const appExists = apps.find((app) => app.name === appSpecifications.name);
      if (appExists) { // double checked in installation process.
        throw new Error(`Application ${appname} is already installed`);
      }

      // eslint-disable-next-line no-use-before-define
      await checkAppRequirements(appSpecifications); // entire app

      res.setHeader('Content-Type', 'application/json');
      await registerAppLocally(appSpecifications, undefined, res); // can throw
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
    res.json(errorResponse);
  }
}

/**
 * Check application requirements - validates hardware, static IP, nodes, and geolocation requirements
 * @param {object} appSpecs - Application specifications to check
 * @returns {Promise<boolean>} True if requirements are met
 */
async function checkAppRequirements(appSpecs) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  await hwRequirements.checkAppHWRequirements(appSpecs);
  // check geolocation

  hwRequirements.checkAppStaticIpRequirements(appSpecs);

  await hwRequirements.checkAppNodesRequirements(appSpecs);

  hwRequirements.checkAppGeolocationRequirements(appSpecs);

  return true;
}

/**
 * Test application installation - Similar to installAppLocally but for testing with reduced resource requirements
 * @param {object} req - Request object containing appname in params or query
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function testAppInstall(req, res) {
  try {
    // appname can be app name or app hash of specific app version
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    log.info(`testAppInstall: ${appname}`);
    let blockAllowance = config.fluxapps.ownerAppAllowance;

    // needs to be logged in
    const authorized = await verificationHelper.verifyPrivilege('user', req);
    if (authorized) {
      let appSpecifications;

      // anyone can deploy temporary app
      // favor temporary to launch test temporary apps
      const tempMessage = await checkAppTemporaryMessageExistence(appname);
      if (tempMessage) {
        // eslint-disable-next-line prefer-destructuring
        appSpecifications = tempMessage.appSpecifications;
        // blockAllowance is used for future validation
        // eslint-disable-next-line no-unused-vars
        blockAllowance = config.fluxapps.temporaryAppAllowance;
      }

      if (!appSpecifications) {
        // only owner can deploy permanent message or existing app
        const ownerAuthorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
        if (!ownerAuthorized) {
          const errMessage = messageHelper.errUnauthorizedMessage();
          res.json(errMessage);
          return;
        }
      }

      if (!appSpecifications) {
        const allApps = await availableApps();
        appSpecifications = allApps.find((app) => app.name === appname);
      }

      if (!appSpecifications) {
        appSpecifications = await getApplicationGlobalSpecifications(appname);
      }

      // search in permanent messages for the specific apphash to launch
      if (!appSpecifications) {
        const permMessage = await checkAppMessageExistence(appname);
        if (permMessage) {
          // eslint-disable-next-line prefer-destructuring
          appSpecifications = permMessage.appSpecifications;
        }
      }

      if (!appSpecifications) {
        throw new Error(`Application Specifications of ${appname} not found`);
      }

      // Test installation - similar to regular install but with test flag
      await checkAppRequirements(appSpecifications);

      res.setHeader('Content-Type', 'application/json');

      // Run test installation (registerAppLocally with test=true)
      await registerAppLocally(appSpecifications, undefined, res, true);
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
    res.json(errorResponse);
  }
}

module.exports = {
  registerAppLocally,
  installApplicationHard,
  installApplicationSoft,
  installAppLocally,
  checkAppRequirements,
  testAppInstall,
};
