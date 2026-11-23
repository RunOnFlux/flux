// path is used for dynamic requires in the file
// eslint-disable-next-line no-unused-vars
const path = require('path');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const dockerService = require('../dockerService');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const { InstallOutcome } = require('../utils/installOutcome');
const generalService = require('../generalService');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const appUninstaller = require('./appUninstaller');
const appNetworkLinker = require('./appNetworkLinker');
const appTestRun = require('./appTestRun');
// const advancedWorkflows = require('./advancedWorkflows'); // Moved to dynamic require to avoid circular dependency
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const { storeAppInstallingErrorMessage, storeSignedAppInstallingErrorBroadcast } = require('../appMessaging/messageStore');

let onInstallComplete = null;
function setOnInstallComplete(callback) {
  onInstallComplete = callback;
}
const { systemArchitecture } = require('../appSystem/systemIntegration');
const { checkApplicationImagesCompliance, verifyRepository } = require('../appSecurity/imageManager');
const { startAppMonitoring } = require('../appManagement/appInspector');
const imageVerifier = require('../utils/imageVerifier');
const registryCredentialHelper = require('../utils/registryCredentialHelper');
const upnpService = require('../upnpService');
const portReconciler = require('../portReconciler');
const portClaims = require('../appNetwork/portClaims');
const globalState = require('../utils/globalState');
const fluxosTrial = require('../utils/fluxosTrial');
const folderStates = require('../appMonitoring/folderStates');
const appsRuntimeState = require('../appManagement/appsRuntimeState');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { verifyEncryptedSpec } = require('../utils/enterpriseSpec');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const mountParser = require('../utils/mountParser');
const { ensureStignoreCovers } = require('../appSystem/syncthingIgnorePolicy');
const { findCommonArchitectures, getAppPorts } = require('../utils/appUtilities');
const log = require('../../lib/log');
const { localAppsInformation, INSTALL_ERROR_MAX_LENGTH } = require('../utils/appConstants');
const appPlacements = require('../appManagement/appPlacements');
const messageVerifier = require('../appMessaging/messageVerifier');
const { availableApps, getApplicationGlobalSpecifications } = require('../appDatabase/registryManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const config = require('config');
const fluxEventBus = require('../utils/fluxEventBus');
const volumeService = require('../utils/volumeService');
const operationRegistry = require('../utils/operationRegistry');
const spawnerControl = require('../utils/spawnerControl');
const { Privilege, authOf } = require('../utils/privileges');

// Legacy apps that use old gateway IP assignment method
const appsThatMightBeUsingOldGatewayIpAssignment = ['HNSDoH', 'dane', 'fdm', 'Jetpack2', 'fdmdedicated', 'isokosse', 'ChainBraryDApp', 'health', 'ethercalc'];

// The octets those legacy apps pin by name (charCodeAt of the last character).
// Reserve them in the free-octet scan so a non-legacy app can't take one before
// the legacy app heals onto its fixed octet.
const legacyPinnedOctets = appsThatMightBeUsingOldGatewayIpAssignment.map((name) => name.charCodeAt(name.length - 1));

// Helper functions and constants for installApplicationHard


const supportedArchitectures = ['amd64', 'arm64'];

/**
 * Reclaim disk before an install by removing unreferenced docker images.
 *
 * Only images. Containers, networks and volumes were pruned here too, keyed on
 * docker's notion of "unused" - nothing attached right now - which is equally
 * true of a healthy app whose container is momentarily down, of a container
 * FluxOS is running for its own purposes, and of anything the node operator
 * left stopped. The guard in front of this only ever knew about installed app
 * components, so those other three were never covered. An image, by contrast,
 * is unreferenced or it is not, and re-pulling one is a download rather than a
 * loss.
 *
 * @param {object} res - Response object for streaming
 * @returns {Promise<void>}
 */
async function performDockerCleanup(res) {
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
 * @returns {Promise<void>}
 */
async function setupApplicationPorts(appSpecifications, appName, isComponent, res) {
  const portStatusInitial = {
    status: isComponent ? `Allowing component ${appSpecifications.name} of Flux App ${appName} ports...` : `Allowing Flux App ${appName} ports...`,
  };
  log.info(portStatusInitial);
  if (res) {
    res.write(serviceHelper.ensureString(portStatusInitial));
    if (res.flush) res.flush();
  }

  const appPorts = appSpecifications.ports ?? (appSpecifications.port ? [appSpecifications.port] : []);
  const { failed, locked } = await fluxNetworkHelper.allowAppPorts(appPorts.map((port) => serviceHelper.ensureNumber(port)));
  // Clients outside the node reach the ports over IPv4 either way, so the install goes on.
  if (locked) log.warn(`Ports of ${appName} not opened in the firewall: ufw is locked by another ufw command`);
  failed.forEach(({ rule, error }) => log.warn(`Port of ${appName} not opened in the firewall: ufw ${rule}: ${error}`));

  if (appSpecifications.ports) {
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      log.info('Custom port specified, mapping ports');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        const portResponse = await portReconciler.want(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
        if (portResponse.mapped) {
          const portStatus = {
            status: `Port ${port} mapped OK`,
          };
          log.info(portStatus);
          if (res) {
            res.write(serviceHelper.ensureString(portStatus));
            if (res.flush) res.flush();
          }
        } else {
          throw new Error(`Error: Port ${port} FAILed to map. ${portResponse.reason}`);
        }
      }
    }
  } else if (appSpecifications.port) {
    // v1 compatibility
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      log.info('Custom port specified, mapping ports');
      const portResponse = await portReconciler.want(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
      if (portResponse.mapped) {
        const portStatus = {
          status: `Port ${appSpecifications.port} mapped OK`,
        };
        log.info(portStatus);
        if (res) {
          res.write(serviceHelper.ensureString(portStatus));
          if (res.flush) res.flush();
        }
      } else {
        throw new Error(`Error: Port ${appSpecifications.port} FAILed to map. ${portResponse.reason}`);
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
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - Ends the pull when aborted
 * @returns {Promise<void>}
 */
async function verifyAndPullImage(appSpecifications, appName, isComponent, res, fullAppSpecs, { signal = null } = {}) {
  // check image and its architecture
  const architecture = await systemArchitecture();
  if (!supportedArchitectures.includes(architecture)) {
    throw new Error(`Invalid architecture ${architecture} detected.`);
  }

  // POLICY IS A PRECONDITION, as it is at registration. The blocked-repository list lives
  // in the signed bundle, so a node without one cannot establish that an image is not
  // banned - and installing on the assumption it is fine is the mistake that cannot be
  // taken back, because the container is running by the time anything else notices.
  if (!globalState.policyReady) {
    throw new Error('Cannot verify application images: network policy not yet obtained.');
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

  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.INSTALL_BEFORE_PULL, appName);
  if (signal) pullConfig.signal = signal;
  // eslint-disable-next-line no-unused-vars
  await dockerService.pullImage(pullConfig, res);

  const pullStatus = {
    status: isComponent ? `Pulling component ${appSpecifications.name} of Flux App ${appName}` : `Pulling global Flux App ${appName} was successful`,
  };

  if (res) {
    res.write(serviceHelper.ensureString(pullStatus));
    if (res.flush) res.flush();
  }
}

/**
 * Ensures the per-app docker network (fluxDockerNetwork_<appName>) exists,
 * creating it with a free /24 (172.23.<octet>.0/24) if absent. Safe to call on
 * every install and from the reconciler's heal path, where a pruned network
 * (docker prune, daemon restart) must be re-created before any container can be
 * re-created onto it.
 *
 * When the network already exists this returns EARLY, with no allocation.
 * Creating the network re-applies the container firewall with its bridge
 * (dockerService.dockerCreateNetwork) before any container is created on it.
 *
 * Allocation is deterministic (lowest free octet) but collision-safe: many heals can
 * run concurrently after a mass prune, so a create that loses its octet to another
 * app - or to a non-flux network whose subnet docker rejects - is retried against the
 * NEXT free octet, giving up only on true exhaustion. A premature give-up would throw,
 * and on the vanished-container path that throw escalates to an app uninstall, so the
 * loop must never fail while octets are free. The subnet is not persisted; nothing
 * outside the container depends on it (ports are host-mapped, gelf targets resolve
 * from the collector's live container IP at create time).
 * @param {string} appName bare app name (the network is per-app, not per-component)
 * @param {object} [res] optional express response for install-status streaming
 * @returns {Promise<object|string>} the created-or-existing network response
 */
async function ensureAppDockerNetwork(appName, res) {
  const fluxNetworkStatus = {
    status: `Checking Flux App network of ${appName}...`,
  };
  log.info(fluxNetworkStatus);
  if (res) {
    res.write(serviceHelper.ensureString(fluxNetworkStatus));
    if (res.flush) res.flush();
  }

  if (await dockerService.dockerNetworkState(`fluxDockerNetwork_${appName}`) === 'exists') {
    const existsStatus = {
      status: `Flux App network of ${appName} already exists.`,
    };
    log.info(existsStatus);
    if (res) {
      res.write(serviceHelper.ensureString(existsStatus));
      if (res.flush) res.flush();
    }
    return `Flux App Network of ${appName} already exists.`;
  }

  let fluxNet = null;
  if (appsThatMightBeUsingOldGatewayIpAssignment.includes(appName)) {
    // legacy apps pinned their gateway octet by name (it was baked into their
    // config); they must keep it rather than take the next free one.
    fluxNet = await dockerService.createFluxAppDockerNetwork(appName, appName.charCodeAt(appName.length - 1)).catch((error) => log.error(error));
  } else {
    // Take the lowest free 172.23.x.0/24, advancing past any octet a create loses
    // (a concurrent heal of another app, or a non-flux network holding the subnet).
    // Seed the exclude set with the legacy-pinned octets so a non-legacy app can't
    // squat an octet a legacy app must heal onto. Give up only when the octet space
    // is genuinely exhausted, never on a fixed count - see the JSDoc for why a
    // premature throw is dangerous here.
    const tried = new Set(legacyPinnedOctets);
    while (!fluxNet) {
      // eslint-disable-next-line no-await-in-loop
      const octet = await dockerService.getFreeFluxAppNetworkOctet(tried);
      if (octet === null) {
        throw new Error(`Flux App network of ${appName} failed to initiate. No free 172.23.x.0/24 subnet available on this node.`);
      }
      // eslint-disable-next-line no-await-in-loop
      fluxNet = await dockerService.createFluxAppDockerNetwork(appName, octet).catch((error) => log.error(error));
      if (!fluxNet) tried.add(octet);
    }
  }
  if (!fluxNet) {
    throw new Error(`Flux App network of ${appName} failed to initiate. Not possible to create docker application network.`);
  }
  log.info(serviceHelper.ensureString(fluxNet));
  const fluxNetResponse = {
    status: `Docker network of ${appName} initiated.`,
  };
  if (res) {
    res.write(serviceHelper.ensureString(fluxNetResponse));
    if (res.flush) res.flush();
  }
  return fluxNet;
}

/**
 * To register an app locally. Performs pre-installation checks - database in place, Flux Docker network in place and if app already installed. Then registers app in database and performs hard install. If registration fails, the app is removed locally.
 * @param {object} appSpecs App specifications.
 * @param {object} componentSpecs Component specifications.
 * @param {object} res Response.
 * @param {boolean} sendRemovalMessage whether the teardown broadcasts the removal.
 *   True wherever this node does not already hold the app: an announcement landing
 *   during the install claims it, and nothing else takes that claim back before it
 *   expires. False for a rebuild, whose claim the node is keeping.
 * @param {object} [options]
 * @param {object} [options.parent] The operation this install is a step of.
 * @param {function(): void} [options.onRecorded] Called once the node records the app as
 *   installed (its row and its placement), before any container is made.
 * @returns {Promise<string>} One of InstallOutcome.
 */
async function attemptRegisterAppLocally(appSpecs, componentSpecs, res, sendRemovalMessage = false, { parent = null, onRecorded = null } = {}) {
  // cpu, ram, hdd were assigned to correct tiered specs.
  // get applications specifics from app messages database
  // check if hash is in blockchain
  // register and launch according to specifications in message
  // Whether this node's local table has named the app during this call. The
  // announcement is built from that table, so the row is the claim, and the
  // teardown below has one to take back only once it exists.
  let claimed = false;
  // This install's claim on the host ports it starts containers on, held until
  // the install ends.
  let portClaim = null;
  // The node installing the app is what any spawner attempt deciding on it was
  // deciding: that attempt ends, and the spawner decides afresh.
  if (!componentSpecs) spawnerControl.stopAttemptFor(appSpecs.name).catch((error) => log.error(error));
  try {
    // A pending removal of the app removes whatever is installed in its place, so
    // the app takes no install until that removal has finished.
    if (globalState.departingApps.has(appSpecs.name)) {
      const rStatus = messageHelper.createWarningMessage(`Flux App ${appSpecs.name} is being removed. Installation not possible`);
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        if (res.flush) res.flush();
      }
      return InstallOutcome.BUSY;
    }
    const hostPorts = componentSpecs ? (componentSpecs.ports ?? []).map(Number) : getAppPorts(appSpecs);
    const ports = await portClaims.claimForInstall(hostPorts, appSpecs.name, portClaims.InstallStep.INSTALL);
    if (!ports.claim) {
      const rStatus = messageHelper.createWarningMessage(`Port ${ports.heldBy.ports.find((port) => hostPorts.includes(port))} of Flux App ${appSpecs.name} is held by an installation of ${ports.heldBy.owner}. Installation not possible`);
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        if (res.flush) res.flush();
      }
      return InstallOutcome.BUSY;
    }
    portClaim = ports.claim;
    const tier = await generalService.nodeTier().catch((error) => log.error(error));
    if (!tier) {
      const rStatus = messageHelper.createErrorMessage('Failed to get Node Tier');
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        if (res.flush) res.flush();
      }
      return InstallOutcome.DECLINED;
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
      const rStatus = messageHelper.createErrorMessage(`Flux App ${appName} already installed`);
      log.error(rStatus);
      if (res) {
        res.write(rStatus);
        if (res.flush) res.flush();
      }
      return InstallOutcome.ALREADY_INSTALLED;
    }

    // Room on the node for the app, reserved until the operation holding it ends;
    // an install that no longer fits touches nothing.
    try {
      await hwRequirements.admitApp(appSpecs);
    } catch (error) {
      const rStatus = messageHelper.createErrorMessage(error.message);
      log.error(rStatus);
      if (res) {
        res.write(serviceHelper.ensureString(rStatus));
        if (res.flush) res.flush();
      }
      return InstallOutcome.DECLINED;
    }
    await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.INSTALL_AFTER_ADMISSION, appSpecs.name);

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
    const { readable: decryptedAppsInstalled, unreadable } = await appQueryService.decryptEnterpriseApps(appsInstalled, { formatSpecs: false });
    if (unreadable.length) {
      log.warn(`Component names unavailable for undecryptable apps: ${unreadable.map((app) => app.name).join(', ')}`);
    }
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
      await ensureAppDockerNetwork(appName, res);
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
        claimed = true;
      }

      const insertResult = await dbHelper.insertOneToDatabase(appsDatabase, localAppsInformation, dbSpecs);
      if (!insertResult) {
        throw new Error(`CRITICAL: Failed to create database entry for ${appSpecifications.name}. Database insert returned undefined - likely duplicate key error or database failure. Aborting installation to prevent orphaned Docker containers.`);
      }
      log.info(`Database entry created for ${appSpecifications.name} BEFORE Docker container creation`);
      // Installed from here: a peer deciding a cold-start seed waits on this node
      // until its monitor has measured what it holds.
      folderStates.installed(appSpecifications);
      claimed = true;
      // The app's volumes are created next: this node's record of when it took
      // the app starts now. The write must succeed, like the insert above: an
      // install that went on without it would leave any earlier record of the
      // app standing, dated before this volume existed.
      await appPlacements.recordPlacement(appSpecifications.name);
      onRecorded?.();
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
      await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.INSTALL_BEFORE_CONTAINERS, appSpecs.name);

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
          // eslint-disable-next-line no-await-in-loop, no-use-before-define
          await installApplicationHard(appComponentSpecs, appName, isComponent, res, appSpecifications, { signal: parent?.signal });
        }
      } else {
        // eslint-disable-next-line no-use-before-define
        await installApplicationHard(specificationsToInstall, appName, isComponent, res, appSpecifications, { signal: parent?.signal });
      }
    } catch (error) {
      // An install a removal stopped is that removal's to take down and tell.
      if (!(error instanceof operationRegistry.OperationPreemptedError)) {
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
          error: serviceHelper.ensureString(errorResponse).slice(0, INSTALL_ERROR_MAX_LENGTH),
          ip: localSocketAddr,
          broadcastedAt,
        };
        // store it in local database first
        // eslint-disable-next-line no-await-in-loop, no-use-before-define
        await storeAppInstallingErrorMessage(newAppRunningMessage);
        // Recorded signed before it is sent, where the errors this node received
        // are: a peer syncing from this node is given it.
        const signedError = await fluxCommunicationMessagesSender.signBroadcast(newAppRunningMessage);
        if (signedError) {
          await storeSignedAppInstallingErrorBroadcast(signedError.message);
          await fluxCommunicationMessagesSender.sendToAll(signedError.serialised);
        }
      }
      throw error;
    }

    // Reconnect any locally installed apps that are networked with this app —
    // its private network was (re)created during this install. Guarded on
    // appComponent (the unmutated entry value) since isComponent is flipped to
    // true inside the component install loop above.
    if (!appComponent) {
      await appNetworkLinker.reconnectLinkedApps(appName);
    }

    // all done message
    const successStatus = messageHelper.createSuccessMessage(`Flux App ${appName} successfully installed and launched`);
    log.info(successStatus);
    if (res) {
      // Written, not closed. Every caller here is mid-stream on a response its
      // own endpoint opened; closing it from in here is what let a failed
      // reinstall answer with the teardown's success line.
      res.write(serviceHelper.ensureString(successStatus));
      if (res.flush) res.flush();
    }
  } catch (error) {
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
    if (error instanceof operationRegistry.OperationPreemptedError) throw error;

    // One component of an installed app: the app's row and its other components
    // stay, and the caller hands the component to the reconciler.
    if (componentSpecs) {
      log.warn(`Component ${componentSpecs.name} of ${appSpecs.name} was not installed: ${error.message}. The app stays installed.`);
      return InstallOutcome.FAILED;
    }

    const removeStatus = messageHelper.createErrorMessage(`Error occured. Initiating Flux App ${appSpecs.name} removal`);
    log.info(removeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(removeStatus));
      if (res.flush) res.flush();
    }
    // endResponse false: the endpoint opened this response and closes it. With
    // true, this teardown's own "was successfuly removed" landed as the last
    // thing the caller saw, and the reinstall failure that caused it was
    // written into a response that had already closed.
    await appUninstaller.removeAppLocally(appSpecs.name, res, true, false, sendRemovalMessage && claimed, { parent });
    log.info(`Cleanup completed for ${appSpecs.name} after installation failure`);

    // A whole app is gone from this node - the teardown above removed it. A
    // caller that reads this as "nothing happened" leaves a half-removed app
    // behind; one that reads BUSY as this destroys a running app for a scheduling
    // collision. They are not the same answer.
    return InstallOutcome.FAILED;
  } finally {
    portClaims.release(portClaim);
  }

  // Announced once the finally above has released this install's port claims, so
  // a broadcast cycle, which takes as long as it takes, holds no port another
  // install needs. checkAndNotifyPeersOfRunningApps never throws.
  if (onInstallComplete) {
    await onInstallComplete();
    fluxEventBus.publish('app:installed', { name: appSpecs.name, hash: appSpecs.hash });
  }
  return InstallOutcome.INSTALLED;
}

/**
 * Register an app on this node, and publish what the attempt did.
 *
 * AN ATTEMPT THAT DOES NOT INSTALL IS AS MUCH A RESULT AS ONE THAT DOES. An install
 * publishes `app:installed`; every other outcome publishes `app:installOutcome` carrying
 * which one it was. The response stream cannot carry the difference: `already installed` is
 * an error envelope and `another application is undergoing installation` is a warning in one
 * place and an error in another, so a waiter reading the wording cannot tell the app being
 * there from the node being busy.
 *
 * The outcomes are published as themselves rather than flattened into a failure, because
 * they are not the same fact about the node. ALREADY_INSTALLED means the app is there, BUSY
 * means ask again, DECLINED and FAILED mean it is not - and FAILED alone means this attempt
 * is what took it away.
 *
 * A throw is reported under FAILED: the app is in whatever state the teardown reached, which
 * is what FAILED means everywhere else.
 *
 * Installing one component of an installed app, FAILED removes nothing: the app's row and
 * its other components stay, and the component is the caller's to hand to the reconciler.
 * @param {object} appSpecs App specifications.
 * @param {object} componentSpecs Component specifications, when one component is being installed.
 * @param {object} res Response stream, when a caller holds one.
 * @param {boolean} [sendRemovalMessage] Whether a teardown announces itself.
 * @param {object} [options]
 * @param {object} [options.parent] The operation this install is a step of.
 * @param {boolean} [options.wait] False refuses the install, as BUSY, while another
 *   operation holds the app, for a caller whose next round asks again.
 * @param {function(): void} [options.onRecorded] Called once the node records the app as
 *   installed, before any container is made; never called for an install that ends
 *   before that, nor for a component.
 * @returns {Promise<string>} One of InstallOutcome. The install is sent to the
 *   app's manager; refused there, it is BUSY.
 */
async function registerAppLocally(appSpecs, componentSpecs, res, sendRemovalMessage = false, { parent = null, wait = true, onRecorded = null } = {}) {
  await fluxosTrial.settled();
  // Published for every outcome but INSTALLED, which has app:installed of its own.
  const announce = (outcome) => {
    if (outcome === InstallOutcome.INSTALLED) return;
    fluxEventBus.publish('app:installOutcome', { name: appSpecs?.name, outcome });
  };
  const attempt = (op) => attemptRegisterAppLocally(appSpecs, componentSpecs, res, sendRemovalMessage, { parent: op, onRecorded });
  let outcome;
  try {
    outcome = appSpecs?.name
      ? await operationRegistry.submit(appSpecs.name, 'install', attempt, {
        parent, wait, owner: 'install',
      })
      : await attempt(null);
  } catch (error) {
    if (error instanceof operationRegistry.OperationRefusedError) {
      log.warn(`registerAppLocally - ${error.message}`);
      if (res) {
        res.write(serviceHelper.ensureString(messageHelper.createWarningMessage(error.message)));
        if (res.flush) res.flush();
      }
      announce(InstallOutcome.BUSY);
      return InstallOutcome.BUSY;
    }
    announce(InstallOutcome.FAILED);
    throw error;
  }
  announce(outcome);
  return outcome;
}

/**
 * Install application (hard installation with Docker)
 * @param {object} appSpecifications - App specifications or component specifications
 * @param {string} appName - Application name
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object
 * @param {object} fullAppSpecs - Full app specifications
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - The operation's: the install stops at its
 *   next step, and its pull at once, when it aborts
 * @returns {Promise<void>} Installation result
 */
async function installApplicationHard(appSpecifications, appName, isComponent, res, fullAppSpecs, { signal = null } = {}) {
  // Verify the apps this app must be networked with (networkWith token) are
  // installed locally and owned by the same owner. Enforced here too — not just
  // in registerAppLocally — so direct callers that bypass it (container health
  // recovery, legacy v<=3 redeploys) cannot create a container without its
  // network links satisfied.
  await appNetworkLinker.checkAppNetworkRequirements(fullAppSpecs);

  // Setup firewall and UPnP ports (fail fast before downloading images)
  await setupApplicationPorts(appSpecifications, appName, isComponent, res);

  // Verify and pull Docker image
  operationRegistry.throwIfPreempted(signal);
  await verifyAndPullImage(appSpecifications, appName, isComponent, res, fullAppSpecs, { signal });

  // Dynamic require to avoid circular dependency
  // eslint-disable-next-line global-require
  const advancedWorkflows = require('./advancedWorkflows');
  operationRegistry.throwIfPreempted(signal);
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
  operationRegistry.throwIfPreempted(signal);
  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  // Attach this component to the private network of every app it is linked with
  // so it can reach their components by docker DNS name.
  const componentContainerName = dockerService.getAppIdentifier(isComponent ? `${appSpecifications.name}_${appName}` : appName);
  await appNetworkLinker.connectComponentToLinkedApps(componentContainerName, fullAppSpecs);

  operationRegistry.throwIfPreempted(signal);
  const startStatus = {
    status: isComponent ? `Starting component ${appSpecifications.name} of Flux App ${appName}...` : `Starting Flux App ${appName}...`,
  };
  log.info(startStatus);
  if (res) {
    res.write(serviceHelper.ensureString(startStatus));
    if (res.flush) res.flush();
  }
  if (!appSpecifications.containerData.includes('r:') && !appSpecifications.containerData.includes('g:')) {
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
 * To soft install app. Pulls image/s, creates components/app, assigns ports to components/app and starts all containers. Does not create data volumes.
 * @param {object} appSpecifications App specifications or component specifications.
 * @param {string} appName App name.
 * @param {boolean} isComponent True if a Docker Compose component.
 * @param {object} res Response.
 * @param {object} fullAppSpecs Full app specifications.
 * @param {object} [options]
 * @param {boolean} [options.start] False creates the container without starting
 *   it, for a caller whose next reconcile pass starts it.
 * @param {AbortSignal} [options.signal] - The operation's: the install stops at its
 *   next step, and its pull at once, when it aborts
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function installApplicationSoft(appSpecifications, appName, isComponent, res, fullAppSpecs, { start = true, signal = null } = {}) {
  // Verify the apps this app must be networked with (networkWith token) are
  // installed locally and owned by the same owner, so no caller creates a
  // container without its network links satisfied.
  await appNetworkLinker.checkAppNetworkRequirements(fullAppSpecs);

  // Setup firewall and UPnP ports (fail fast before downloading images)
  await setupApplicationPorts(appSpecifications, appName, isComponent, res);

  // Verify and pull Docker image
  operationRegistry.throwIfPreempted(signal);
  await verifyAndPullImage(appSpecifications, appName, isComponent, res, fullAppSpecs, { signal });
  operationRegistry.throwIfPreempted(signal);

  const createApp = {
    status: isComponent ? `Creating component ${appSpecifications.name} of local Flux App ${appName}` : `Creating local Flux App ${appName}`,
  };
  log.info(createApp);
  if (res) {
    res.write(serviceHelper.ensureString(createApp));
    if (res.flush) res.flush();
  }

  // A DIRECTORY THE SPECIFICATION DECLARES LOCAL IS NOT CREATED BEFORE THE RULE THAT
  // KEEPS IT OFF THE NETWORK. This path installs onto a volume that already exists, so
  // nothing seeds .stignore - that is volume creation's, which only the hard path
  // reaches. A name this specification adds would be covered by the monitor's next
  // converge, while syncthing's watcher indexes a new directory within its own delay
  // and the container is writing into it by then. What replicates in that window stays
  // on every peer: an ignore stops a file syncing, it does not withdraw one already
  // sent.
  //
  // Asked of the spec, so it costs nothing for a component that declares no such
  // directory or whose volume is not replicated at all.
  const unsyncedSubdirs = mountParser.getUnsyncedSubdirs(appSpecifications.containerData);
  const identifier = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  if (unsyncedSubdirs.length && mountParser.getComponentSyncMode(appSpecifications.containerData)) {
    await ensureStignoreCovers(dockerService.getAppIdentifier(identifier), unsyncedSubdirs);
  }

  // Mount paths must exist before the container is created (Syncthing cleanup can
  // remove them while a container is stopped); ensure them at the orchestration layer.
  await volumeService.ensureMountPathsExist(appSpecifications, appName, isComponent, fullAppSpecs);
  await dockerService.appDockerCreate(appSpecifications, appName, isComponent, fullAppSpecs);

  // Attach this component to the private network of every app it is linked with
  // so it can reach their components by docker DNS name.
  const componentContainerName = dockerService.getAppIdentifier(identifier);
  await appNetworkLinker.connectComponentToLinkedApps(componentContainerName, fullAppSpecs);

  const startStatus = {
    status: isComponent ? `Starting component ${appSpecifications.name} of Flux App ${appName}...` : `Starting Flux App ${appName}...`,
  };
  log.info(startStatus);
  if (res) {
    res.write(serviceHelper.ensureString(startStatus));
    if (res.flush) res.flush();
  }
  const startedHere = start && !appSpecifications.containerData.includes('g:');
  const componentId = isComponent ? `${appSpecifications.name}_${appName}` : appName;
  // A soft install keeps the volume, and with it a restore that did not finish
  // on it: such a component is not started here, and the reconciler keeps it
  // stopped until the record is cleared. An unread record holds it too.
  const restoreHolds = startedHere
    && await appsRuntimeState.isRestoreUnfinished(componentId).catch(() => true);
  if (restoreHolds) {
    const held = { status: `${componentId} is not started: a restore of its data did not finish` };
    log.warn(held);
    if (res) {
      res.write(serviceHelper.ensureString(held));
      if (res.flush) res.flush();
    }
  }
  if (startedHere && !restoreHolds) {
    const identifier = componentId;
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
    // Placing an app on a node is not the node operator's call, for the same
    // reason removing one is not: hosting an app is not owning it. The spawner
    // decides placement; the owner decides everything else. An app not yet paid
    // for is never placed here: it is tried out through testAppInstall, which
    // tears it down again and never announces it.
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
    if (authorized) {
      const allApps = await availableApps();
      let appSpecifications = allApps.find((app) => app.name === appname);
      if (!appSpecifications) {
        // eslint-disable-next-line no-use-before-define
        appSpecifications = await getApplicationGlobalSpecifications(appname);
      }
      // search in permanent messages for the specific apphash to launch
      if (!appSpecifications) {
        const permMessage = await messageVerifier.checkAppMessageExistence(appname);
        if (permMessage) {
          // The message carries the hash and height its specification does not:
          // the announcement names the app by that hash, and the expiry sweep
          // removes a local row without a height.
          appSpecifications = { ...permMessage.appSpecifications, hash: permMessage.hash, height: permMessage.height };
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
        // the formatter strips spec metadata; height/hash must survive it -
        // a local row stored without height is force-removed (with broadcast)
        // by expireGlobalApplications' missing-height check on every sweep
        const { height, hash } = appSpecifications;
        appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
        appSpecifications = specificationFormatter(appSpecifications);
        appSpecifications.height = height;
        appSpecifications.hash = hash;
      }

      // An app's term runs from the height its payment was mined at, and the
      // expiry sweep removes it when the term ends. A specification without one
      // has no term to run, so it is not installed.
      if (appSpecifications.height === undefined || appSpecifications.height === null) {
        throw new Error(`Application Specifications of ${appname} carry no height`);
      }
      const dbopen = dbHelper.databaseConnection();

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
      // A placement this node does not hold yet - refused above if it did - so a
      // failed install retracts the claim rather than keeping it.
      await registerAppLocally(appSpecifications, undefined, res, true); // can throw
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
    if (res.headersSent) {
      res.write(serviceHelper.ensureString(errorResponse));
    } else {
      res.json(errorResponse);
    }
  } finally {
    // This response has one owner and it is here. registerAppLocally writes its
    // progress into it and does not close it, so a failure that arrives after
    // the stream has started still reaches the caller instead of landing in a
    // response the installer had already ended.
    if (!res.writableEnded) res.end();
  }
}

/**
 * Check application requirements - validates hardware, static IP, nodes, and geolocation requirements
 * @param {object} appSpecs - Application specifications to check
 * @param {boolean} skipGeolocation - Whether to skip geolocation checks (useful for testing)
 * @param {boolean} skipStaticIp - Whether to skip static IP checks (useful for testing)
 * @param {boolean} skipHardware - Whether to skip hardware and nodes checks (useful for testing)
 * @param {object} [options]
 * @param {string} [options.replacing] - Name of an installed app this one replaces: a redeploy
 *   checks the new specification against the node without the old one's resources, which its
 *   database row still holds while its containers are being replaced.
 * @returns {Promise<boolean>} True if requirements are met
 */
async function checkAppRequirements(appSpecs, skipGeolocation = false, skipStaticIp = false, skipHardware = false, options = {}) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  if (!skipHardware) {
    await hwRequirements.checkAppHWRequirements(appSpecs, { replacing: options.replacing });
  }

  if (!skipStaticIp) {
    hwRequirements.checkAppStaticIpRequirements(appSpecs);
  }

  if (!skipHardware) {
    await hwRequirements.checkAppNodesRequirements(appSpecs);
  }

  if (!skipGeolocation) {
    const geo = await hwRequirements.appGeolocationVerdict(appSpecs);
    if (geo.verdict !== hwRequirements.GeoVerdict.PASS) {
      throw new Error(geo.reason);
    }
  }

  return true;
}

/**
 * The owner whose key signs a pending app message: the owner a registration
 * names, and for an update the owner of the app as registered, who signs the
 * update whatever owner it names.
 * @param {object} tempMessage A temporary app message.
 * @returns {Promise<string|null>} The signer's address, or null when it cannot be found.
 */
async function pendingMessageSigner(tempMessage) {
  const isUpdate = tempMessage.type === 'fluxappupdate' || tempMessage.type === 'zelappupdate';
  if (!isUpdate) return tempMessage.appSpecifications?.owner ?? null;
  const registered = await getApplicationGlobalSpecifications(tempMessage.appSpecifications?.name);
  return registered?.owner ?? null;
}

/**
 * Test an app on this node: its containers run for the test-run window at the resources it
 * declares, outside the app machinery, and nothing is installed (appTestRun). FluxOS v9's
 * playground replaces it.
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

    // needs to be logged in
    const authorized = await verificationHelper.verifyPrivilege(Privilege.USER, authOf(req));
    if (authorized) {
      let appSpecifications;

      // An app not yet paid for is tested by the owner whose key signs its
      // message, addressed by its message hash. The flux team may test any.
      const tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(appname);
      if (tempMessage) {
        const caller = serviceHelper.ensureObject(authOf(req))?.zelid;
        const signer = await pendingMessageSigner(tempMessage);
        const mayTest = (Boolean(caller) && caller === signer)
          || await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
        if (!mayTest) {
          const errMessage = messageHelper.errUnauthorizedMessage();
          res.json(errMessage);
          return;
        }
        verifyEncryptedSpec(tempMessage.appSpecifications);
        // The hash is the message's, not the specification's.
        appSpecifications = { ...tempMessage.appSpecifications, hash: tempMessage.hash };
      }

      if (!appSpecifications) {
        // Placing a registered app on a node is not the node operator's call, for
        // the same reason removing one is not: hosting an app is not owning it.
        // This branch resolves an app BY NAME from the marketplace, the global
        // registry or a permanent message, so an operator reaching it is choosing
        // which customer's app runs on hardware they control - and for a g:/r: app
        // the new instance syncs that customer's data down to it. The spawner
        // decides placement; the owner decides everything else.
        const ownerAuthorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
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
          verifyEncryptedSpec(permMessage.appSpecifications);
          appSpecifications = { ...permMessage.appSpecifications, hash: permMessage.hash, height: permMessage.height };
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

        // the formatter strips spec metadata; the hash and height must survive it
        const { height, hash } = appSpecifications;
        appSpecifications = await checkAndDecryptAppSpecs(appSpecifications, {
          daemonHeight,
          owner: appSpecifications.owner,
        });
        appSpecifications = specificationFormatter(appSpecifications);
        appSpecifications.height = height;
        appSpecifications.hash = hash;
      }

      // An app this node holds is not tested here.
      const installed = await dbHelper.findOneInDatabase(
        dbHelper.databaseConnection().db(config.database.appslocal.database),
        localAppsInformation,
        { name: appSpecifications.name },
        { projection: { _id: 0, name: 1 } },
      );
      if (installed) {
        res.json(messageHelper.createErrorMessage(`Flux App ${appSpecifications.name} is installed on this node. Test it on a node that does not hold it.`));
        return;
      }

      // Placement rules (geolocation, static IP, nodes) do not apply to a test; the
      // test run refuses on the node's free hardware itself.
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
        return;
      }

      await appTestRun.run(appSpecifications, res, {
        pull: (component) => verifyAndPullImage(component, appSpecifications.name, true, res, appSpecifications),
      });
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
    if (res.headersSent) {
      res.write(serviceHelper.ensureString(errorResponse));
    } else {
      res.json(errorResponse);
    }
  } finally {
    // This response has one owner and it is here. registerAppLocally writes its
    // progress into it and does not close it, so a failure that arrives after
    // the stream has started still reaches the caller instead of landing in a
    // response the installer had already ended.
    if (!res.writableEnded) res.end();
  }
}

module.exports = {
  registerAppLocally,
  ensureAppDockerNetwork,
  installApplicationHard,
  installApplicationSoft,
  installAppLocally,
  checkAppRequirements,
  testAppInstall,
  setOnInstallComplete,
  setupApplicationPorts,
};
