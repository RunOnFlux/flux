const os = require('os');
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
const appsService = require('../appsService');
const appUninstaller = require('./appUninstaller');
const advancedWorkflows = require('./advancedWorkflows');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const { storeAppRunningMessage, storeAppInstallingErrorMessage } = require('../appMessaging/messageStore');
const { systemArchitecture } = require('../appSystem/systemIntegration');
const { checkApplicationImagesComplience } = require('../appSecurity/imageManager');
const { startAppMonitoring } = require('../appManagement/appInspector');
const imageVerifier = require('../utils/imageVerifier');
const pgpService = require('../pgpService');
const upnpService = require('../upnpService');
const globalState = require('../utils/globalState');
const log = require('../../lib/log');
const { appsFolder, localAppsInformation, scannedHeightCollection } = require('../utils/appConstants');
const { checkAppTemporaryMessageExistence, checkAppMessageExistence } = require('../appMessaging/messageVerifier');
const { availableApps, getApplicationGlobalSpecifications } = require('../appDatabase/registryManager');
const {
  checkAppHWRequirements,
  checkAppStaticIpRequirements,
  checkAppNodesRequirements,
  checkAppGeolocationRequirements,
} = require('../appRequirements/appValidator');
const config = require('config');

// Legacy apps that use old gateway IP assignment method
const appsThatMightBeUsingOldGatewayIpAssignment = ['HNSDoH', 'dane', 'fdm', 'Jetpack2', 'fdmdedicated', 'isokosse', 'ChainBraryDApp', 'health', 'ethercalc'];


// Helper functions and constants for installApplicationHard
const util = require('util');
const dockerPullStreamPromise = util.promisify(dockerService.dockerPullStream);

const supportedArchitectures = ['amd64', 'arm64'];


/**
 * To register an app locally. Performs pre-installation checks - database in place, Flux Docker network in place and if app already installed. Then registers app in database and performs hard install. If registration fails, the app is removed locally.
 * @param {object} appSpecs App specifications.
 * @param {object} componentSpecs Component specifications.
 * @param {object} res Response.
 * @param {boolean} test indicates if it is just to test the app install.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
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

    const installedAppsRes = await appsService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const runningAppsRes = await appsService.listRunningApps();
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

      await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
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
          // eslint-disable-next-line no-await-in-loop
          await installApplicationHard(appComponentSpecs, appName, isComponent, res, appSpecifications, test);
        }
      } else {
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
      appUninstaller.removeAppLocally(appSpecs.name, res, true, true, false);
    }
    return false;
  }
  return true;
}

/**
 * Install application (hard installation with Docker)
 * @param {object} appSpecifications - App specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object
 * @param {object} fullAppSpecs - Full app specifications
 * @param {boolean} test - Whether this is a test installation
 * @returns {Promise<object>} Installation result
 */
async function installApplicationHard(appSpecifications, appName, isComponent, res, fullAppSpecs, test = false) {
  // check image and its architecture
  const architecture = await systemArchitecture();
  if (!supportedArchitectures.includes(architecture)) {
    throw new Error(`Invalid architecture ${architecture} detected.`);
  }

  // check blacklist
  await checkApplicationImagesComplience(fullAppSpecs);

  const imgVerifier = new imageVerifier.ImageVerifier(
    appSpecifications.repotag,
    { maxImageSize: config.fluxapps.maxImageSize, architecture, architectureSet: supportedArchitectures },
  );

  const pullConfig = { repoTag: appSpecifications.repotag };

  let authToken = null;

  if (appSpecifications.repoauth) {
    authToken = await pgpService.decryptMessage(appSpecifications.repoauth);

    if (!authToken) {
      throw new Error('Unable to decrypt provided credentials');
    }

    if (!authToken.includes(':')) {
      throw new Error('Provided credentials not in the correct username:token format');
    }

    imgVerifier.addCredentials(authToken);
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

  await advancedWorkflows.createAppVolume(appSpecifications, appName, isComponent, res);

  const createApp = {
    status: isComponent ? `Creating component ${appSpecifications.name} of Flux App ${appName}` : `Creating Flux App ${appName}`,
  };
  log.info(createApp);
  if (res) {
    res.write(serviceHelper.ensureString(createApp));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

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
      return;
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
 * Install application (soft installation without Docker)
 * @param {object} appSpecifications - App specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object
 * @param {object} fullAppSpecs - Full app specifications
 * @returns {Promise<object>} Installation result
 */
async function installApplicationSoft(appSpecifications, appName, isComponent, res, fullAppSpecs) {
  try {
    log.info(`Starting soft installation of app ${appName}`);

    // Check if app already exists
    // eslint-disable-next-line no-use-before-define
    const existingApp = await getInstalledApps(appName);
    if (existingApp && existingApp.length > 0) {
      throw new Error(`App ${appName} already exists`);
    }

    // Soft register app in database
    const componentSpecs = isComponent ? [appSpecifications] : null;
    // eslint-disable-next-line no-use-before-define
    await softRegisterAppLocally(fullAppSpecs || appSpecifications, componentSpecs, res);

    log.info(`Successfully soft-installed app ${appName}`);

    const result = {
      status: 'success',
      message: `App ${appName} soft-installed successfully`,
      data: {
        appName,
        type: 'soft',
      },
    };

    return result;
  } catch (error) {
    log.error(`Error soft-installing app ${appName}: ${error.message}`);
    throw new Error(`Soft installation failed for ${appName}: ${error.message}`);
  }
}

/**
 * Soft register application locally (without Docker operations)
 * @param {object} appSpecs - Application specifications
 * @param {object} componentSpecs - Component specifications
 * @param {object} res - Response object
 * @returns {Promise<object>} Registration result
 */
async function softRegisterAppLocally(appSpecs, componentSpecs, res) {
  try {
    log.info(`Soft registering app ${appSpecs.name} locally`);

    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    // Prepare app registration data for soft install
    const appData = {
      ...appSpecs,
      registeredAt: Date.now(),
      status: 'soft-registered',
      installType: 'soft',
    };

    // Insert app into local database
    await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, appData);

    // Handle components if they exist
    if (componentSpecs && Array.isArray(componentSpecs)) {
      for (const component of componentSpecs) {
        const componentData = {
          ...component,
          parentApp: appSpecs.name,
          registeredAt: Date.now(),
          status: 'soft-registered',
          installType: 'soft',
        };
        await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, componentData);
      }
    }

    log.info(`Successfully soft registered app ${appSpecs.name} locally`);
    return { status: 'success', message: `App ${appSpecs.name} soft registered locally` };
  } catch (error) {
    log.error(`Error soft registering app ${appSpecs.name}: ${error.message}`);
    throw new Error(`Failed to soft register app locally: ${error.message}`);
  }
}

/**
 * Get installed applications
 * @param {string} appName - Optional app name filter
 * @returns {Promise<Array>} List of installed apps
 */
async function getInstalledApps(appName = null) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    const query = appName ? { name: appName } : {};
    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, query);

    return apps;
  } catch (error) {
    log.error(`Error getting installed apps: ${error.message}`);
    return [];
  }
}

/**
 * Update application status
 * @param {string} appName - Application name
 * @param {string} status - New status
 * @returns {Promise<void>}
 */
async function updateAppStatus(appName, status) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    const filter = { name: appName };
    const update = { $set: { status, updatedAt: Date.now() } };

    await dbHelper.updateOneInDatabase(appsDatabase, localAppsInformation, filter, update);
    log.info(`Updated status of app ${appName} to ${status}`);
  } catch (error) {
    log.error(`Error updating app status: ${error.message}`);
    throw error;
  }
}

/**
 * Cleanup failed installation
 * @param {string} appName - Application name to cleanup
 * @returns {Promise<void>}
 */
async function cleanupFailedInstallation(appName) {
  try {
    log.info(`Cleaning up failed installation for ${appName}`);

    // Stop and remove container if it exists
    try {
      await dockerService.dockerStopContainer(appName);
      await dockerService.dockerRemoveContainer(appName);
    } catch (dockerError) {
      log.warn(`Docker cleanup warning for ${appName}: ${dockerError.message}`);
    }

    // Remove from database
    try {
      const dbopen = dbHelper.databaseConnection();
      const appsDatabase = dbopen.db(config.database.appslocal.database);
      await dbHelper.removeDocumentsFromCollection(appsDatabase, localAppsInformation, { name: appName });
    } catch (dbError) {
      log.warn(`Database cleanup warning for ${appName}: ${dbError.message}`);
    }

    log.info(`Cleanup completed for ${appName}`);
  } catch (error) {
    log.error(`Cleanup error for ${appName}: ${error.message}`);
    throw error;
  }
}

/**
 * Install application locally - Main API entry point
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Installation result
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
      registerAppLocally(appSpecifications, undefined, res); // can throw
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
 * Check application requirements (wrapper for verifyAppSpecifications)
 * @param {object} appSpecifications - Application specifications to check
 * @returns {Promise<boolean>} True if requirements are met
 */
async function checkAppRequirements(appSpecs) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  await checkAppHWRequirements(appSpecs);
  // check geolocation

  checkAppStaticIpRequirements(appSpecs);

  await checkAppNodesRequirements(appSpecs);

  checkAppGeolocationRequirements(appSpecs);

  return true;
}

/**
 * Test application installation - Similar to installAppLocally but for testing
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Test installation result
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
      registerAppLocally(appSpecifications, undefined, res, true);

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
  softRegisterAppLocally,
  getInstalledApps,
  updateAppStatus,
  cleanupFailedInstallation,
  installAppLocally,
  checkAppRequirements,
  testAppInstall,
};
