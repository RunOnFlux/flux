// path is used for dynamic requires in the file
// eslint-disable-next-line no-unused-vars
const path = require('path');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const dockerService = require('../dockerService');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const generalService = require('../generalService');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const appUninstaller = require('./appUninstaller');
const appNetworkLinker = require('./appNetworkLinker');
const appsRuntimeState = require('../appManagement/appsRuntimeState');
const pendingTeardownStore = require('./pendingTeardownStore');
// const advancedWorkflows = require('./advancedWorkflows'); // Moved to dynamic require to avoid circular dependency
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const { storeAppInstallingErrorMessage } = require('../appMessaging/messageStore');

let onInstallComplete = null;
function setOnInstallComplete(callback) {
  onInstallComplete = callback;
}
const { systemArchitecture } = require('../appSystem/systemIntegration');
const { checkApplicationImagesCompliance, verifyRepository } = require('../appSecurity/imageManager');
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
const { findCommonArchitectures } = require('../utils/appUtilities');
const { withHostMutationLock } = require('../utils/hostMutationLock');
const log = require('../../lib/log');
const { localAppsInformation, scannedHeightCollection } = require('../utils/appConstants');
const messageVerifier = require('../appMessaging/messageVerifier');
const { availableApps, getApplicationGlobalSpecifications } = require('../appDatabase/registryManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const config = require('config');
const fluxEventBus = require('../utils/fluxEventBus');
const volumeService = require('../utils/volumeService');

// Legacy apps that use old gateway IP assignment method
const appsThatMightBeUsingOldGatewayIpAssignment = ['HNSDoH', 'dane', 'fdm', 'Jetpack2', 'fdmdedicated', 'isokosse', 'ChainBraryDApp', 'health', 'ethercalc'];

// Helper functions and constants for installApplicationHard
const util = require('util');

const dockerPullStreamPromise = util.promisify(dockerService.dockerPullStream);

const supportedArchitectures = ['amd64', 'arm64'];

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
  // serialize the system-wide image prune against concurrent teardown image-removes / pulls
  await withHostMutationLock(() => dockerService.pruneImages());
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
        const portResponse = await withHostMutationLock(() => fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(port)));
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
        const portResponse = await withHostMutationLock(() => upnpService.mapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${appName}`));
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
      const portResponse = await withHostMutationLock(() => fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(appSpecifications.port)));
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
      const portResponse = await withHostMutationLock(() => upnpService.mapUpnpPort(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`));
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
      appName, // Required for per-app provider caching
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

  // Abortable pull: thread this install's AbortController signal (registered by
  // registerAppLocally, keyed by app name) so a concurrent cancel/removal of the
  // same app aborts the in-flight pull instead of finishing the download.
  const inFlightInstall = globalState.installingApps.get(appName);
  if (inFlightInstall) {
    pullConfig.abortSignal = inFlightInstall.signal;
  }

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
 * @param {boolean} sendRemovalMessage whether to broadcast removal message to network if installation fails.
 * @returns {Promise<boolean>} Returns true if installation was successful, false otherwise.
 */
async function registerAppLocally(appSpecs, componentSpecs, res, test = false, sendRemovalMessage = false, opts = {}) {
  // opts.skipPorts: a redeploy opens the port DELTA itself (new-old) and leaves unchanged
  // ports untouched, so the install must NOT open this app's ports. A fresh install leaves
  // it false and opens all ports as before. Only the ufw/UPnP setup is skipped - the
  // container is still created with its docker port mappings.
  const skipPorts = opts.skipPorts === true;
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

    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddr) {
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

    // Install-side interlock (cancel-vs-install): refuse to start while a teardown
    // of this name is still owed (its pendingAppTeardowns doc has not cleared). A
    // forced cancel runs background=true, so it deletes the local row + clears
    // removalInProgress in its prelude while the drain + Phase B host teardown
    // (umount, rm -rf the volume, ufw/UPnP, network) keep running detached - the
    // "already installed" check above misses it because the row is already gone.
    // Without this gate a re-registration of the same name would create a fresh
    // volume that the still-running teardown then rm -rf's. Bail; the spawner
    // retries on its next cycle, by which time the teardown has cleared the doc.
    if (await pendingTeardownStore.teardownOwedFor(appName)) {
      globalState.installationInProgress = false;
      const rStatus = messageHelper.createWarningMessage(`Flux App ${appName} is still being torn down; deferring installation until teardown completes.`);
      log.warn(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        res.end();
      }
      return false;
    }

    // Register this install's AbortController by app name so a concurrent
    // cancel/removal of the same app can abort the in-flight image pull
    // (cancel-during-install). verifyAndPullImage threads its signal into
    // docker.pull; the finally below clears the entry. Last-writer-wins is fine -
    // installs of a given name are gated serial by installationInProgress.
    globalState.installingApps.set(appName, new AbortController());

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
    const decryptedAppsInstalled = await appQueryService.decryptEnterpriseApps(appsInstalled, { formatSpecs: false });
    const runningApps = runningAppsRes.data;
    const installedAppComponentNames = [];
    decryptedAppsInstalled.forEach((app) => {
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

    // Verify the apps this app must be networked with (networkWith token in the
    // description) are installed locally and owned by the same owner before any
    // side effects.
    await appNetworkLinker.checkAppNetworkRequirements(appSpecifications);

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
        // Take the same host-mutation lock that Phase-B removeAppDockerNetwork holds:
        // create and removal both touch the one fluxDockerNetwork_<app> host resource, so
        // they must not run concurrently (a stale same-name removal must not delete a
        // freshly-created network, nor vice versa). Leaf/per-attempt - a single bounded
        // docker create, no unbounded wait; neither call site is reached holding the lock.
        // eslint-disable-next-line no-await-in-loop
        fluxNet = await withHostMutationLock(() => dockerService.createFluxAppDockerNetwork(appName, dockerNetworkAddrValue)).catch((error) => log.error(error));
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

    // Installing a component is the inverse of condemning it: an installed
    // component must NEVER carry a condemned stamp, or the reconciler's entry gate
    // would early-bail on it forever. A prior teardown of the same identifier may
    // have left a stamp set (e.g. a swallowed DB error during its finish, so the
    // durable doc kept it for boot recovery); clear it here so this install is not
    // wedged out of reconciliation until the next reboot. Best-effort per id.
    let installedIdentifiers;
    if (isComponent) {
      installedIdentifiers = [`${appComponent.name}_${appName}`];
    } else if (appSpecifications.version >= 4 && Array.isArray(appSpecifications.compose)) {
      installedIdentifiers = appSpecifications.compose.map((c) => `${c.name}_${appName}`);
    } else {
      installedIdentifiers = [appName];
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const identifier of installedIdentifiers) {
      // eslint-disable-next-line no-await-in-loop
      await appsRuntimeState.setCondemned(identifier, false).catch((error) => {
        log.error(`Failed to clear condemned stamp for ${identifier} on install: ${error.message}`);
      });
    }

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
          await installApplicationHard(appComponentSpecs, appName, isComponent, res, appSpecifications, test, skipPorts);
        }
      } else {
        // eslint-disable-next-line no-use-before-define
        await installApplicationHard(specificationsToInstall, appName, isComponent, res, appSpecifications, test, skipPorts);
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
          ip: localSocketAddr,
          broadcastedAt,
        };
        // store it in local database first
        // eslint-disable-next-line no-await-in-loop, no-use-before-define
        await storeAppInstallingErrorMessage(newAppRunningMessage);
        // broadcast messages about running apps to all peers
        await fluxCommunicationMessagesSender.broadcastMessageToAll(newAppRunningMessage);
        // broadcast messages about running apps to all peers
      }
      throw error;
    }

    log.info(`Flux App: ${appName} is test install: ${test}`);

    // Reconnect any locally installed apps that are networked with this app —
    // its private network was (re)created during this install. Guarded on
    // appComponent (the unmutated entry value) since isComponent is flipped to
    // true inside the component install loop above.
    if (!appComponent && !test) {
      await appNetworkLinker.reconnectLinkedApps(appName);
    }

    // all done message
    const successStatus = messageHelper.createSuccessMessage(`Flux App ${appName} successfully installed and launched`);
    log.info(successStatus);
    if (res) {
      res.write(serviceHelper.ensureString(successStatus));
      res.end();
    }
    globalState.installationInProgress = false;

    // Broadcast this node's running apps AFTER releasing the install lock.
    // onInstallComplete() -> checkAndNotifyPeersOfRunningApps() relies on
    // containerHealthMonitor.monitorAndRecoverApps() to force-include syncthing
    // apps whose components are not all simultaneously "running" at this instant
    // (e.g. a component mid receive-only resync). That recovery path bails out
    // while globalState.isOperationInProgress() is true, so broadcasting before
    // installationInProgress is cleared would exclude the just-installed app from
    // its own announcement. checkAndNotifyPeersOfRunningApps never throws (it
    // catches internally), so running it after res.end() is safe.
    if (!test && onInstallComplete) {
      await onInstallComplete();
      fluxEventBus.publish('app:installed', { name: appSpecifications.name, hash: appSpecifications.hash });
    }
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
      await appUninstaller.removeAppLocally(appSpecs.name, res, true, true, sendRemovalMessage);
      log.info(`Cleanup completed for ${appSpecs.name} after installation failure`);
    }

    return false;
  } finally {
    // Drop this install's AbortController (no-op if we bailed before registering).
    if (appSpecs && appSpecs.name) globalState.installingApps.delete(appSpecs.name);
    if (test) {
      try {
        await appUninstaller.removeAppLocally(appSpecs.name, null, true, false, false);
        log.info(`Test cleanup completed for ${appSpecs.name}`);
      } catch (cleanupError) {
        log.error(`Error during test cleanup for ${appSpecs.name}: ${cleanupError.message}`);
      }
    }
  }
  return true;
}

/**
 * Checks Orbit (Deploy with Git) app health by polling its /api/status endpoint.
 * Waits for initialTestStatus to become true, then checks if the deployment failed.
 * @param {object} appSpecifications - Component specifications containing repotag and ports
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object for streaming status updates
 * @returns {Promise<{passed: boolean, reason: string|null}>} Result with passed status and failure reason
 */
async function checkOrbitAppHealth(appSpecifications, appName, isComponent, res) {
  if (!appSpecifications.ports || !appSpecifications.ports.length) {
    return { passed: false, reason: 'No ports configured for Orbit component' };
  }
  const hostPort = appSpecifications.ports[0];
  const statusUrl = `http://127.0.0.1:${hostPort}/api/status`;
  const pollInterval = 5000; // 5 seconds between polls
  const maxAttempts = 24; // 2 minutes total (24 * 5s)
  const initialWait = 5000; // 5 seconds before first poll

  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;

  const checkingStatus = {
    status: `Checking Orbit deployment status for ${identifier} on port ${hostPort}...`,
  };
  log.info(checkingStatus);
  if (res) {
    res.write(serviceHelper.ensureString(checkingStatus));
    if (res.flush) res.flush();
  }

  // Wait for Orbit to initialize before first poll
  await serviceHelper.delay(initialWait);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let pollStatus = '';
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await serviceHelper.axiosGet(statusUrl, { timeout: 5000 });

      if (response.data && response.data.initialTestStatus === true) {
        if (response.data.failed === true) {
          const reason = response.data.failure_reason || 'Unknown failure';
          return { passed: false, reason };
        }
        // initialTestStatus is true and failed is false - test passed
        const successStatus = {
          status: `Orbit initial test passed for ${identifier}`,
        };
        log.info(successStatus);
        if (res) {
          res.write(serviceHelper.ensureString(successStatus));
          if (res.flush) res.flush();
        }
        return { passed: true, reason: null };
      }

      // Log what Orbit is actually returning for debugging
      pollStatus = ` | response: ${JSON.stringify(response.data)}`;
    } catch (error) {
      pollStatus = ` | error: ${error.message}`;
      log.info(`Orbit status poll attempt ${attempt}/${maxAttempts} for ${identifier}: ${error.message}`);
    }

    const elapsed = attempt * 5;
    const waitingStatus = {
      status: `Waiting for Orbit initial test... (${elapsed}s/${maxAttempts * 5}s)${pollStatus}`,
    };
    if (res) {
      res.write(serviceHelper.ensureString(waitingStatus));
      if (res.flush) res.flush();
    }

    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(pollInterval);
  }

  return { passed: false, reason: 'Orbit health check timed out: initial test did not complete within 2 minutes' };
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
async function installApplicationHard(appSpecifications, appName, isComponent, res, fullAppSpecs, test = false, skipPorts = false) {
  // Verify the apps this app must be networked with (networkWith token) are
  // installed locally and owned by the same owner. Enforced here too — not just
  // in registerAppLocally — so direct callers that bypass it (container health
  // recovery, legacy v<=3 redeploys) cannot create a container without its
  // network links satisfied.
  await appNetworkLinker.checkAppNetworkRequirements(fullAppSpecs);

  // Setup firewall and UPnP ports (fail fast before downloading images). A redeploy
  // passes skipPorts and reconciles the port delta itself (leaving unchanged ports
  // untouched); a fresh install opens them all.
  if (!skipPorts) {
    await setupApplicationPorts(appSpecifications, appName, isComponent, res, test);
  }

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

  await volumeService.verifyAppVolumeMount(appName, isComponent, appSpecifications.name);

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

  // Mount paths must exist before the container is created (Syncthing cleanup can
  // remove them while a container is stopped); ensure them at the orchestration layer.
  await volumeService.ensureMountPathsExist(appSpecifications, appName, isComponent, fullAppSpecs);
  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  // Attach this component to the private network of every app it is linked with
  // so it can reach their components by docker DNS name.
  const componentContainerName = dockerService.getAppIdentifier(isComponent ? `${appSpecifications.name}_${appName}` : appName);
  await appNetworkLinker.connectComponentToLinkedApps(componentContainerName, fullAppSpecs);

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

    // For Orbit (Deploy with Git) apps, verify deployment health during test installs
    if (test && appSpecifications.repotag && appSpecifications.repotag.startsWith('runonflux/orbit')) {
      const orbitHealth = await checkOrbitAppHealth(appSpecifications, appName, isComponent, res);
      if (!orbitHealth.passed) {
        throw new Error(`Orbit deployment failed: ${orbitHealth.reason}`);
      }
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
async function installApplicationSoft(appSpecifications, appName, isComponent, res, fullAppSpecs, skipPorts = false) {
  // Verify the apps this app must be networked with (networkWith token) are
  // installed locally and owned by the same owner. Enforced here too — not just
  // in softRegisterAppLocally — so direct callers that bypass it (container
  // health recovery, legacy v<=3 redeploys) cannot create a container without
  // its network links satisfied.
  await appNetworkLinker.checkAppNetworkRequirements(fullAppSpecs);

  // Setup firewall and UPnP ports (fail fast before downloading images). A redeploy
  // passes skipPorts and reconciles the port delta itself; a fresh install opens all.
  if (!skipPorts) {
    await setupApplicationPorts(appSpecifications, appName, isComponent, res);
  }

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

  // Mount paths must exist before the container is created (Syncthing cleanup can
  // remove them while a container is stopped); ensure them at the orchestration layer.
  await volumeService.ensureMountPathsExist(appSpecifications, appName, isComponent, fullAppSpecs);
  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  // Attach this component to the private network of every app it is linked with
  // so it can reach their components by docker DNS name.
  const componentContainerName = dockerService.getAppIdentifier(isComponent ? `${appSpecifications.name}_${appName}` : appName);
  await appNetworkLinker.connectComponentToLinkedApps(componentContainerName, fullAppSpecs);

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
      const tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(appname);
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
        const permMessage = await messageVerifier.checkAppMessageExistence(appname);
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
 * @param {boolean} skipGeolocation - Whether to skip geolocation checks (useful for testing)
 * @param {boolean} skipStaticIp - Whether to skip static IP checks (useful for testing)
 * @param {boolean} skipHardware - Whether to skip hardware and nodes checks (useful for testing)
 * @returns {Promise<boolean>} True if requirements are met
 */
async function checkAppRequirements(appSpecs, skipGeolocation = false, skipStaticIp = false, skipHardware = false) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  if (!skipHardware) {
    await hwRequirements.checkAppHWRequirements(appSpecs);
  }

  if (!skipStaticIp) {
    hwRequirements.checkAppStaticIpRequirements(appSpecs);
  }

  if (!skipHardware) {
    await hwRequirements.checkAppNodesRequirements(appSpecs);
  }

  if (!skipGeolocation) {
    await hwRequirements.checkAppGeolocationRequirements(appSpecs);
  }

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
      const tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(appname);
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
        const permMessage = await messageVerifier.checkAppMessageExistence(appname);
        if (permMessage) {
          // eslint-disable-next-line prefer-destructuring
          appSpecifications = permMessage.appSpecifications;
        }
      }

      if (!appSpecifications) {
        throw new Error(`Application Specifications of ${appname} not found`);
      }

      // Decrypt enterprise specifications if needed
      if (
        appSpecifications.version >= 8
        && appSpecifications.enterprise
        && !appSpecifications.compose.length
      ) {
        // Get current daemon height for decryption
        const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
        if (!syncStatus.data.synced) {
          throw new Error('Daemon not yet synced.');
        }
        const daemonHeight = syncStatus.data.height;

        appSpecifications = await checkAndDecryptAppSpecs(appSpecifications, {
          daemonHeight,
          owner: appSpecifications.owner,
        });
        appSpecifications = specificationFormatter(appSpecifications);
      }

      // Test installation - similar to regular install but with test flag
      // Skip all requirement checks for test installations (geolocation, static IP, hardware, nodes)
      await checkAppRequirements(appSpecifications, true, true, true);

      res.setHeader('Content-Type', 'application/json');

      // Check architecture compatibility for test installations
      // Get local node architecture
      const localArch = await systemArchitecture();

      // Collect supported architectures from all components
      const componentArchitectures = [];
      for (const component of appSpecifications.compose) {
        const repoVerification = await verifyRepository(component.repotag, {
          repoauth: component.repoauth,
          specVersion: appSpecifications.version,
          appName: appSpecifications.name,
          architecture: localArch,
        });
        componentArchitectures.push({
          name: component.name,
          architectures: repoVerification.supportedArchitectures,
        });
      }

      // Calculate common architectures across all components
      const commonArchitectures = findCommonArchitectures(componentArchitectures);

      // If local architecture is not in common architectures, skip Docker operations
      if (!commonArchitectures.includes(localArch)) {
        // Write an initial status message
        const initMessage = {
          status: 'Checking architecture compatibility...',
        };
        res.write(serviceHelper.ensureString(initMessage));
        if (res.flush) res.flush();

        // Write the skip message
        const successMessage = {
          status: `Test installation validation passed. Installation skipped due to architecture incompatibility: this node is ${localArch} but app requires [${commonArchitectures.join(', ')}]`,
        };
        res.write(serviceHelper.ensureString(successMessage));
        res.end();
        return;
      }

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
  setupApplicationPorts,
  installApplicationSoft,
  installAppLocally,
  checkAppRequirements,
  testAppInstall,
  setOnInstallComplete,
};
