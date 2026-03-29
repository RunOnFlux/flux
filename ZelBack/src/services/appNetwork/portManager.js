const config = require('config');
const axios = require('axios');
const dbHelper = require('../dbHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const networkStateService = require('../networkStateService');
const verificationHelper = require('../verificationHelper');
const log = require('../../lib/log');
const upnpService = require('../upnpService');
const serviceHelper = require('../serviceHelper');
const fluxHttpTestServer = require('../utils/fluxHttpTestServer');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { localAppsInformation, globalAppsInformation } = require('../utils/appConstants');

// Global cache for failed nodes
const failedNodesTestPortsCache = new Map();

// Track consecutive UPNP mapping-absent failures per app across restore cycles
const upnpFailureCount = new Map(); // appName -> { count: number, firstFailure: number }
const UPNP_FAILURE_THRESHOLD = 3; // consecutive cycles (~30 min at 10-min intervals)
const UPNP_RETRY_COUNT = 2;
const UPNP_RETRY_DELAY_MS = 5000;

// Periodic cleanup of orphaned UPNP mappings
let lastMappingCleanup = 0;
const MAPPING_CLEANUP_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Check if ports in array are unique
 * @param {number[]} portsArray - Array of port numbers
 * @returns {boolean} True if all ports are unique
 */
function appPortsUnique(portsArray) {
  return (new Set(portsArray)).size === portsArray.length;
}

/**
 * Ensure that the app ports are unique within the app specification
 * @param {object} appSpecFormatted - App specifications
 * @returns {boolean} True if ports are unique
 * @throws {Error} If ports are not unique
 */
function ensureAppUniquePorts(appSpecFormatted) {
  if (appSpecFormatted.version === 1) {
    return true;
  }

  if (appSpecFormatted.version <= 3) {
    const portsUnique = appPortsUnique(appSpecFormatted.ports);
    if (!portsUnique) {
      throw new Error(`Flux App ${appSpecFormatted.name} must have unique ports specified`);
    }
  } else {
    // For version 4+ compose applications
    const allPorts = [];
    if (appSpecFormatted.compose) {
      appSpecFormatted.compose.forEach((component) => {
        if (component.ports) {
          allPorts.push(...component.ports);
        }
      });
    }

    const portsUnique = appPortsUnique(allPorts);
    if (!portsUnique) {
      throw new Error(`Flux App ${appSpecFormatted.name} must have unique ports specified accross all composition`);
    }
  }

  return true;
}

/**
 * Get ports assigned by currently installed applications
 * @returns {Promise<Array>} Array of objects with app names and their assigned ports
 */
async function assignedPortsInstalledApps() {
  // construct object ob app name and ports array
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appslocal.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const results = await dbHelper.findInDatabase(database, localAppsInformation, query, projection);
  const decryptedApps = [];
  // ToDo: move the functions around so we can remove no-use-before-define
  // eslint-disable-next-line no-restricted-syntax
  for (const spec of results) {
    const isEnterprise = Boolean(
      spec.version >= 8 && spec.enterprise,
    );
    if (isEnterprise) {
      // eslint-disable-next-line no-await-in-loop
      const decrypted = await checkAndDecryptAppSpecs(spec);
      const formatted = specificationFormatter(decrypted);
      decryptedApps.push(formatted);
    } else {
      decryptedApps.push(spec);
    }
  }
  const apps = [];
  decryptedApps.forEach((app) => {
    // there is no app
    if (app.version === 1) {
      const appSpecs = {
        name: app.name,
        ports: [Number(app.port)],
      };
      apps.push(appSpecs);
    } else if (app.version <= 3) {
      const appSpecs = {
        name: app.name,
        ports: [],
      };
      app.ports.forEach((port) => {
        appSpecs.ports.push(Number(port));
      });
      apps.push(appSpecs);
    } else if (app.version >= 4) {
      const appSpecs = {
        name: app.name,
        ports: [],
      };
      app.compose.forEach((component) => {
        component.ports.forEach((port) => {
          appSpecs.ports.push(Number(port));
        });
      });
      apps.push(appSpecs);
    }
  });
  return apps;
}

/**
 * Get ports assigned by global applications
 * @param {string[]} appNames - Array of app names to check
 * @returns {Promise<Array>} Array of objects with app names and their assigned ports
 */
async function assignedPortsGlobalApps(appNames) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  if (!appNames || appNames.length === 0) {
    return [];
  }

  const appsQuery = appNames.map((app) => ({ name: app }));
  const query = { $or: appsQuery };
  const projection = { projection: { _id: 0 } };
  const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);

  const appsWithPorts = [];

  results.forEach((app) => {
    const appPorts = [];

    if (app.version === 1) {
      if (app.port) {
        appPorts.push(Number(app.port));
      }
    } else if (app.version <= 3) {
      if (app.ports && Array.isArray(app.ports)) {
        app.ports.forEach((port) => {
          appPorts.push(Number(port));
        });
      }
    } else if (app.version >= 4 && app.compose) {
      // For compose applications, collect ports from all components
      app.compose.forEach((component) => {
        if (component.ports && Array.isArray(component.ports)) {
          component.ports.forEach((port) => {
            appPorts.push(Number(port));
          });
        }
      });
    }

    if (appPorts.length > 0) {
      appsWithPorts.push({
        name: app.name,
        ports: appPorts,
      });
    }
  });

  return appsWithPorts;
}

/**
 * Ensure application ports are not already in use
 * @param {object} appSpecFormatted - App specifications
 * @param {string[]} globalCheckedApps - Global apps to check against
 * @returns {Promise<boolean>} True if ports are available
 * @throws {Error} If ports are already in use
 */
async function ensureApplicationPortsNotUsed(appSpecFormatted, globalCheckedApps) {
  let currentAppsPorts = await assignedPortsInstalledApps();

  if (globalCheckedApps && globalCheckedApps.length) {
    const globalAppsPorts = await assignedPortsGlobalApps(globalCheckedApps);
    currentAppsPorts = currentAppsPorts.concat(globalAppsPorts);
  }

  if (appSpecFormatted.version === 1) {
    const portAssigned = currentAppsPorts.find((app) => app.ports.includes(Number(appSpecFormatted.port)));
    if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
      throw new Error(`Flux App ${appSpecFormatted.name} port ${appSpecFormatted.port} already used with different application. Installation aborted.`);
    }
  } else if (appSpecFormatted.version <= 3) {
    // eslint-disable-next-line no-restricted-syntax
    for (const port of appSpecFormatted.ports) {
      const portAssigned = currentAppsPorts.find((app) => app.ports.includes(Number(port)));
      if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
        throw new Error(`Flux App ${appSpecFormatted.name} port ${port} already used with different application. Installation aborted.`);
      }
    }
  } else {
    // eslint-disable-next-line no-restricted-syntax
    for (const appComponent of appSpecFormatted.compose) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appComponent.ports) {
        const portAssigned = currentAppsPorts.find((app) => app.ports.includes(port));
        if (portAssigned && portAssigned.name !== appSpecFormatted.name) {
          throw new Error(`Flux App ${appSpecFormatted.name} port ${port} already used with different application. Installation aborted.`);
        }
      }
    }
  }
  return true;
}

/**
 * Restores FluxOS firewall, UPNP rules
 * @returns {Promise<void>}
 */
async function restoreFluxPortsSupport() {
  try {
    const isUPNP = upnpService.isUPNP();

    const userconfig = globalThis.userconfig;
    const apiPort = userconfig.initial.apiport || config.server.apiport;
    const homePort = +apiPort - 1;
    const apiPortSSL = +apiPort + 1;
    const syncthingPort = +apiPort + 2;

    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // setup UFW if active
      await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(apiPort));
      await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(homePort));
      await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(apiPortSSL));
      await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(syncthingPort));
    }

    // UPNP
    if (isUPNP) {
      // map our Flux API, UI and SYNCTHING port
      await upnpService.setupUPNP(apiPort);
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Removes orphaned UPNP mappings that belong to apps no longer installed on this node.
 * Only removes mappings with the Flux_App_ description prefix.
 * @param {Array} localMappings Current mappings from the router.
 * @param {Set} installedAppNames Names of currently installed apps.
 * @returns {Promise<void>}
 */
async function cleanupOrphanedUpnpMappings(localMappings, installedAppNames) {
  const fluxAppPrefix = 'Flux_App_';
  // Deduplicate by port since removeMapUpnpPort removes both TCP and UDP
  const orphanedPorts = new Map(); // port -> description
  // eslint-disable-next-line no-restricted-syntax
  for (const m of localMappings) {
    if (!m.description || !m.description.startsWith(fluxAppPrefix)) continue;
    const appName = m.description.slice(fluxAppPrefix.length);
    if (!installedAppNames.has(appName)) {
      orphanedPorts.set(m.public.port, m.description);
    }
  }

  if (orphanedPorts.size === 0) return;

  log.info(`Cleaning up ${orphanedPorts.size} orphaned UPNP port mapping(s)`);
  // eslint-disable-next-line no-restricted-syntax
  for (const [port, description] of orphanedPorts) {
    log.info(`Removing orphaned UPNP mapping: ${description} port ${port}`);
    // eslint-disable-next-line no-await-in-loop
    await upnpService.removeMapUpnpPort(port).catch((error) => log.error(error));
  }
  lastMappingCleanup = Date.now();
}

/**
 * Attempts to retry UPNP port mapping after confirmed mapping loss.
 * @param {number} port Port number.
 * @param {string} description UPNP mapping description.
 * @returns {Promise<boolean>} True if a retry succeeded.
 */
async function retryUpnpMapping(port, description) {
  for (let i = 0; i < UPNP_RETRY_COUNT; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(UPNP_RETRY_DELAY_MS);
    // eslint-disable-next-line no-await-in-loop
    if (await upnpService.mapUpnpPort(port, description)) return true;
  }
  return false;
}

/**
 * Handles a failed UPNP mapping attempt for a single port. Checks if the existing
 * mapping is still valid on the router before taking action.
 * @param {string} appName Application name.
 * @param {number} port Port number.
 * @param {string} description UPNP mapping description.
 * @param {Array|null} localMappings Cached local mappings from router (null if query failed).
 * @returns {Promise<boolean>} True if the port is ok (mapping exists or retry succeeded), false if genuinely failed.
 */
async function handleUpnpPortFailure(appName, port, description, localMappings) {
  // Only positive confirmation of an active mapping is a free pass
  if (localMappings && localMappings.some((m) => m.public.port === port && m.enabled)) {
    log.warn(`UPNP refresh failed for ${appName} port ${port} but existing mapping is still active on router`);
    return true;
  }

  if (localMappings === null) {
    log.warn(`UPNP refresh failed for ${appName} port ${port} and unable to query router mapping state`);
  }

  if (await retryUpnpMapping(port, description)) return true;

  log.error(`UPNP mapping missing and retries exhausted for ${appName} port ${port}`);
  return false;
}

/**
 * Handles the failure counting and potential removal of an app after confirmed UPNP failure.
 * @param {string} appName Application name.
 * @returns {Promise<boolean>} True if the app was removed.
 */
async function handleUpnpAppFailure(appName) {
  const prev = upnpFailureCount.get(appName) || { count: 0, firstFailure: Date.now() };
  const updated = { count: prev.count + 1, firstFailure: prev.firstFailure };
  upnpFailureCount.set(appName, updated);

  if (updated.count < UPNP_FAILURE_THRESHOLD) {
    log.error(`UPNP mapping failure for ${appName} - attempt ${updated.count}/${UPNP_FAILURE_THRESHOLD}, will retry next cycle`);
    return false;
  }

  log.warn(`REMOVAL REASON: UPNP port mapping failure - ${appName} failed ${UPNP_FAILURE_THRESHOLD} consecutive cycles (since ${new Date(updated.firstFailure).toISOString()})`);
  // eslint-disable-next-line global-require
  const appUninstaller = require('../appLifecycle/appUninstaller');
  await appUninstaller.removeAppLocally(appName, null, true, true, true).catch((error) => log.error(error));
  upnpFailureCount.delete(appName);
  await serviceHelper.delay(3 * 60 * 1000);
  return true;
}

/**
 * Restores applications firewall, UPNP rules
 * @returns {Promise<void>}
 */
async function restoreAppsPortsSupport() {
  try {
    const currentAppsPorts = await assignedPortsInstalledApps();
    const isUPNP = upnpService.isUPNP();

    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const application of currentAppsPorts) {
        // eslint-disable-next-line no-restricted-syntax
        for (const port of application.ports) {
          // eslint-disable-next-line no-await-in-loop
          await fluxNetworkHelper.allowPort(serviceHelper.ensureNumber(port));
        }
      }
    }

    if (!isUPNP) return;

    // Lazy-loaded on first mapping failure, one SOAP call to router per cycle max
    let localMappings;
    const currentAppNames = new Set();

    // eslint-disable-next-line no-restricted-syntax
    for (const application of currentAppsPorts) {
      currentAppNames.add(application.name);
      let appFailed = false;

      // eslint-disable-next-line no-restricted-syntax
      for (const port of application.ports) {
        const portNum = serviceHelper.ensureNumber(port);
        const description = `Flux_App_${application.name}`;
        // eslint-disable-next-line no-await-in-loop
        const upnpOk = await upnpService.mapUpnpPort(portNum, description);
        if (upnpOk) continue;

        if (localMappings === undefined) {
          // eslint-disable-next-line no-await-in-loop
          localMappings = await upnpService.getLocalMappings();
        }

        // eslint-disable-next-line no-await-in-loop
        const portOk = await handleUpnpPortFailure(application.name, portNum, description, localMappings);
        if (portOk) continue;

        appFailed = true;
        break;
      }

      if (!appFailed) {
        upnpFailureCount.delete(application.name);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await handleUpnpAppFailure(application.name);
    }

    // Clean up stale failure counter entries for apps no longer installed
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of upnpFailureCount.keys()) {
      if (!currentAppNames.has(appName)) {
        upnpFailureCount.delete(appName);
      }
    }

    // Periodically clean up orphaned UPNP mappings (from past failed removals)
    // Only when no failures occurred this cycle (router is healthy)
    const noFailuresThisCycle = localMappings === undefined;
    const cleanupDue = Date.now() - lastMappingCleanup >= MAPPING_CLEANUP_INTERVAL_MS;
    if (noFailuresThisCycle && cleanupDue) {
      const mappings = await upnpService.getLocalMappings();
      if (mappings && mappings.length > 0) {
        await cleanupOrphanedUpnpMappings(mappings, currentAppNames);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Restores FluxOS and applications firewall, UPNP rules
 * @returns {Promise<void>}
 */
async function restorePortsSupport() {
  try {
    await restoreFluxPortsSupport();
    await restoreAppsPortsSupport();
  } catch (error) {
    log.error(error);
  }
}

/**
 * Get all ports currently in use by applications
 * @returns {Promise<number[]>} Array of port numbers in use
 */
async function getAllUsedPorts() {
  const installedAppsPorts = await assignedPortsInstalledApps();
  const allPorts = [];

  installedAppsPorts.forEach((app) => {
    allPorts.push(...app.ports);
  });

  return [...new Set(allPorts)]; // Remove duplicates
}

/**
 * Check if a specific port is available
 * @param {number} port - Port number to check
 * @param {string} excludeApp - App name to exclude from check (for updates)
 * @returns {Promise<boolean>} True if port is available
 */
async function isPortAvailable(port, excludeApp = null) {
  const usedPorts = await assignedPortsInstalledApps();

  // eslint-disable-next-line no-restricted-syntax
  for (const app of usedPorts) {
    if (excludeApp && app.name === excludeApp) {
      continue; // eslint-disable-line no-continue
    }
    if (app.ports.includes(Number(port))) {
      return false;
    }
  }

  return true;
}

/**
 * Find the next available port in a given range
 * @param {number} startPort - Starting port to check
 * @param {number} endPort - Ending port range
 * @param {string} excludeApp - App name to exclude from check
 * @returns {Promise<number|null>} Next available port or null if none found
 */
async function findNextAvailablePort(startPort, endPort, excludeApp = null) {
  for (let port = startPort; port <= endPort; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port, excludeApp);
    if (available) {
      return port;
    }
  }
  return null;
}

/**
 * Sign application data for verification
 * @param {string} message - Message to sign
 * @returns {Promise<string>} Signature
 */
async function signCheckAppData(message) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey();
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

/**
 * To check if app ports are available publicly before installation
 * @param {Array} portsToTest Array of ports to test
 * @returns {Promise<boolean>} True if ports are available, false otherwise
 */
async function checkInstallingAppPortAvailable(portsToTest = []) {
  const beforeAppInstallTestingServers = [];
  const isUPNP = upnpService.isUPNP();
  let portsStatus = false;
  const portsNotWorking = new Set();
  let originalPortFailed = null;
  let nextTestingPort = 0;

  try {
    const localSocketAddress = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!localSocketAddress) {
      throw new Error('Failed to detect Public IP');
    }
    const [myIP, myPort = '16127'] = localSocketAddress.split(':');

    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    let somePortBanned = false;
    portsToTest.forEach((portToTest) => {
      const iBP = fluxNetworkHelper.isPortBanned(portToTest);
      if (iBP) {
        somePortBanned = true;
      }
    });
    if (somePortBanned) {
      return false;
    }
    if (isUPNP) {
      somePortBanned = false;
      portsToTest.forEach((portToTest) => {
        const iBP = fluxNetworkHelper.isPortUPNPBanned(portToTest);
        if (iBP) {
          somePortBanned = true;
        }
      });
      if (somePortBanned) {
        return false;
      }
    }
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    // eslint-disable-next-line no-restricted-syntax
    for (const portToTest of portsToTest) {
      // now open this port properly and launch listening on it
      if (firewallActive) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.allowPort(portToTest);
      }
      if (isUPNP) {
        // eslint-disable-next-line no-await-in-loop
        const upnpMapResult = await upnpService.mapUpnpPort(portToTest, `Flux_Prelaunch_App_${portToTest}`);
        if (!upnpMapResult) {
          throw new Error('Failed to create map UPNP port');
        }
      }
      const testHttpServer = new fluxHttpTestServer.FluxHttpTestServer();

      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(5 * 1000);

      beforeAppInstallTestingServers.push(testHttpServer);

      // Tested: This catches EADDRINUSE. Previously, this was crashing the entire app
      // note - if you kill the port with:
      //    ss --kill state listening src :<the port>
      // nodeJS does not raise an error.
      const listening = new Promise((resolve, reject) => {
        testHttpServer
          .once('error', (err) => {
            testHttpServer.removeAllListeners('listening');
            reject(err.message);
          })
          .once('listening', () => {
            testHttpServer.removeAllListeners('error');
            resolve(null);
          });
        testHttpServer.listen(portToTest);
      });

      // eslint-disable-next-line no-await-in-loop
      const error = await listening.catch((err) => err);

      if (error) throw error;
    }

    await serviceHelper.delay(10 * 1000);
    const timeout = 30000;
    const axiosConfig = {
      timeout,
    };
    const data = {
      ip: myIP,
      port: myPort,
      appname: 'appPortsTest',
      ports: portsToTest,
      pubKey,
    };
    const stringData = JSON.stringify(data);
    // eslint-disable-next-line no-await-in-loop
    const signature = await signCheckAppData(stringData);
    data.signature = signature;
    let i = 0;
    let finished = false;
    while (!finished && i < 5) {
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      const randomSocketAddress = await networkStateService.getRandomSocketAddress(
        localSocketAddress,
      );

      // this should never happen as the list should be populated here
      if (!randomSocketAddress) {
        throw new Error('Unable to get random test connection');
      }

      const [askingIP, askingIpPort = '16127'] = randomSocketAddress.split(':');

      // first check against our IP address
      // eslint-disable-next-line no-await-in-loop
      const resMyAppAvailability = await axios.post(`http://${askingIP}:${askingIpPort}/flux/checkappavailability`, JSON.stringify(data), axiosConfig).catch((error) => {
        log.error(`${askingIP} for app availability is not reachable`);
        log.error(error);
      });
      if (resMyAppAvailability && resMyAppAvailability.data.status === 'error') {
        if (resMyAppAvailability.data.data && resMyAppAvailability.data.data.message && resMyAppAvailability.data.data.message.includes('Failed port: ')) {
          const portToRetest = serviceHelper.ensureNumber(resMyAppAvailability.data.data.message.split('Failed port: ')[1]);
          if (portToRetest > 0) {
            portsNotWorking.add(portToRetest);
            // if we aren't already testing ports, we set it here, otherwise, just continue
            if (!originalPortFailed) {
              originalPortFailed = portToRetest;
              // eslint-disable-next-line no-unused-vars
              nextTestingPort = portToRetest < 65535 ? portToRetest + 1 : portToRetest - 1;
            }
          }
        }
        portsStatus = false;
        finished = true;
      } else if (resMyAppAvailability && resMyAppAvailability.data.status === 'success') {
        portsStatus = true;
        finished = true;
      }
    }
    // stop listening on the port, close the port
    // eslint-disable-next-line no-restricted-syntax
    for (const portToTest of portsToTest) {
      if (firewallActive) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.deleteAllowPortRule(portToTest);
      }
      if (isUPNP) {
        // eslint-disable-next-line no-await-in-loop
        await upnpService.removeMapUpnpPort(portToTest, `Flux_Prelaunch_App_${portToTest}`);
      }
    }
    // Close all test servers and wait for them to finish
    await Promise.all(
      beforeAppInstallTestingServers.map((server) => new Promise((resolve) => {
        server.close((err) => {
          if (err) {
            log.error(`beforeAppInstallTestingServer Shutdown failed: ${err.message}`);
          }
          resolve();
        });
      })),
    );
    return portsStatus;
  } catch (error) {
    let firewallActive = true;
    firewallActive = await fluxNetworkHelper.isFirewallActive().catch((e) => log.error(e));
    // stop listening on the testing port, close the port
    // eslint-disable-next-line no-restricted-syntax
    for (const portToTest of portsToTest) {
      if (firewallActive) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.deleteAllowPortRule(portToTest).catch((e) => log.error(e));
      }
      if (isUPNP) {
        // eslint-disable-next-line no-await-in-loop
        await upnpService.removeMapUpnpPort(portToTest, `Flux_Prelaunch_App_${portToTest}`).catch((e) => log.error(e));
      }
    }
    // Close all test servers and wait for them to finish
    await Promise.all(
      beforeAppInstallTestingServers.map((server) => new Promise((resolve) => {
        try {
          server.close((err) => {
            if (err) {
              log.error(`beforeAppInstallTestingServer Shutdown failed: ${err.message}`);
            }
            resolve();
          });
        } catch (e) {
          log.warn(e);
          resolve();
        }
      })),
    );
    log.error(error);
    return false;
  }
}

/**
 * Periodically call other nodes to establish a connection with the ports I have open on UPNP to remain OPEN
 * @returns {Promise<void>}
 */
async function callOtherNodeToKeepUpnpPortsOpen() {
  try {
    const userconfig = globalThis.userconfig;
    const apiPort = userconfig.initial.apiport || config.server.apiport;
    let myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!myIP) {
      return;
    }

    const randomSocketAddress = await networkStateService.getRandomSocketAddress(myIP);

    if (!randomSocketAddress) return;

    const [askingIP, askingIpPort = '16127'] = randomSocketAddress.split(':');

    myIP = myIP.split(':')[0];

    if (myIP === askingIP) {
      callOtherNodeToKeepUpnpPortsOpen();
      return;
    }
    if (failedNodesTestPortsCache.has(askingIP)) {
      callOtherNodeToKeepUpnpPortsOpen();
      return;
    }

    // Import locally to avoid circular dependency
    // eslint-disable-next-line global-require
    const appQueryService = require('../appQuery/appQueryService');
    const installedAppsRes = await appQueryService.installedApps();
    if (installedAppsRes.status !== 'success') {
      return;
    }
    const apps = installedAppsRes.data;
    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    const ports = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      if (app.version === 1) {
        ports.push(+app.port);
      } else if (app.version <= 3) {
        app.ports.forEach((port) => {
          ports.push(+port);
        });
      } else {
        app.compose.forEach((component) => {
          component.ports.forEach((port) => {
            ports.push(+port);
          });
        });
      }
    }

    // We don't add the api port, as the remote node will callback to our
    // api port to make sure it can connect before testing any other ports
    // this is so that we know the remote end can reach us. I also removed
    // -2,-3,-4, +3 as they are currently not used.
    ports.push(apiPort - 1);
    // ports.push(apiPort - 2);
    // ports.push(apiPort - 3);
    // ports.push(apiPort - 4);
    ports.push(apiPort - 5);
    ports.push(apiPort + 1);
    ports.push(apiPort + 2);
    // ports.push(apiPort + 3);

    const axiosConfig = {
      timeout: 5_000,
    };

    const dataUPNP = {
      ip: myIP,
      apiPort,
      ports,
      pubKey,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const stringData = JSON.stringify(dataUPNP);
    const signature = await signCheckAppData(stringData);
    dataUPNP.signature = signature;

    const logMsg = `callOtherNodeToKeepUpnpPortsOpen - calling ${askingIP}:${askingIpPort} to test ports: ${ports}`;
    log.info(logMsg);

    const url = `http://${askingIP}:${askingIpPort}/flux/keepupnpportsopen`;
    await axios.post(url, dataUPNP, axiosConfig).catch(() => {
      // callOtherNodeToKeepUpnpPortsOpen();
    });
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  appPortsUnique,
  ensureAppUniquePorts,
  assignedPortsInstalledApps,
  assignedPortsGlobalApps,
  ensureApplicationPortsNotUsed,
  restoreFluxPortsSupport,
  restoreAppsPortsSupport,
  restorePortsSupport,
  getAllUsedPorts,
  isPortAvailable,
  findNextAvailablePort,
  signCheckAppData,
  checkInstallingAppPortAvailable,
  callOtherNodeToKeepUpnpPortsOpen,
  failedNodesTestPortsCache,
};
