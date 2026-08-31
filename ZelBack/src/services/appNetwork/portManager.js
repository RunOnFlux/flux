const config = require('config');
const axios = require('axios');
const dbHelper = require('../dbHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { extractIp, extractPort } = require('../utils/socketAddressUtils');
const networkStateService = require('../networkStateService');
const verificationHelper = require('../verificationHelper');
const log = require('../../lib/log');
const upnpService = require('../upnpService');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const fluxHttpTestServer = require('../utils/fluxHttpTestServer');
const { localAppsInformation, globalAppsInformation } = require('../utils/appConstants');

// Global cache for failed nodes
const failedNodesTestPortsCache = new Map();

// A single UPnP map failure is routine on consumer routers (busy router, a
// node network blip) and the app itself keeps running regardless - it must
// NEVER escalate straight to a force-removal + network broadcast. Removal
// requires the failure to be sustained: consecutive restore cycles AND a
// minimum wall-clock window, measured on the monotonic clock.
const UPNP_REMOVAL_MIN_CONSECUTIVE_CYCLES = 3;
const UPNP_REMOVAL_MIN_WINDOW_MS = 30 * 60 * 1000;
const UPNP_MAP_RETRY_DELAY_MS = 30 * 1000;
// appName -> { cycles, firstFailureAtMs } (monotonic ms)
const upnpMapFailures = new Map();

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

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
  // Through the cached path, not checkAndDecryptAppSpecs directly. That
  // primitive holds no cache: it costs two globalAppsMessages queries and a
  // benchd RSA decrypt per enterprise app on every call, and this function is
  // reached from an unauthenticated endpoint. The wrapper answers from
  // enterpriseAppDecryptionCache (keyed on spec.hash, seven days), shares one
  // in-flight attempt between concurrent callers, and remembers a failure
  // briefly. formatSpecs is false because the formatter strips the hash the
  // cache keys on.
  //
  // An app that cannot be read throws, which is what the per-spec call it
  // replaces already did. A port list missing an app's ports is worse than no
  // list: every caller here is asking which ports are taken, and a hole in the
  // answer reads as "free".
  // eslint-disable-next-line global-require
  const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
  const { inPlace: decryptedApps, unreadable } = await decryptEnterpriseApps(results, { formatSpecs: false });
  if (unreadable.length) {
    throw new Error(`Cannot list ports in use: ${unreadable.length} of ${results.length} application specifications could not be read`);
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

    const { userconfig } = globalThis;
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
 * Restores applications firewall, UPNP rules
 * @returns {Promise<void>}
 */
async function restoreAppsPortsSupport() {
  try {
    const currentAppsPorts = await assignedPortsInstalledApps();
    const isUPNP = upnpService.isUPNP();

    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    // setup UFW for apps
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

    // UPNP
    if (isUPNP) {
      // one shared recovery pause per cycle: every failing mapping still gets
      // its retry, but a router-wide outage must not stack per-app pauses
      // (N apps -> N x 30s of serial delay, outgrowing the restore interval)
      let retryDelayElapsed = false;
      // map application ports
      // eslint-disable-next-line no-restricted-syntax
      for (const application of currentAppsPorts) {
        let failedPort = null;
        // eslint-disable-next-line no-restricted-syntax
        for (const port of application.ports) {
          // eslint-disable-next-line no-await-in-loop
          let upnpOk = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${application.name}`);
          if (!upnpOk) {
            if (!retryDelayElapsed) {
              // eslint-disable-next-line no-await-in-loop
              await serviceHelper.delay(UPNP_MAP_RETRY_DELAY_MS);
              retryDelayElapsed = true;
            }
            // eslint-disable-next-line no-await-in-loop
            upnpOk = await upnpService.mapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${application.name}`);
          }
          if (!upnpOk) {
            failedPort = port;
            break;
          }
        }

        if (failedPort === null) {
          upnpMapFailures.delete(application.name);
          // eslint-disable-next-line no-continue
          continue;
        }

        const now = monotonicMs();
        const tracker = upnpMapFailures.get(application.name) || { cycles: 0, firstFailureAtMs: now };
        tracker.cycles += 1;
        upnpMapFailures.set(application.name, tracker);
        const sustainedMs = now - tracker.firstFailureAtMs;

        if (tracker.cycles < UPNP_REMOVAL_MIN_CONSECUTIVE_CYCLES || sustainedMs < UPNP_REMOVAL_MIN_WINDOW_MS) {
          log.warn(`restoreAppsPortsSupport - ${application.name} failed to map port ${failedPort} via UPNP `
            + `(failure ${tracker.cycles}, ${Math.round(sustainedMs / 60000)}m sustained); not removing - removal requires `
            + `${UPNP_REMOVAL_MIN_CONSECUTIVE_CYCLES} consecutive cycles over ${UPNP_REMOVAL_MIN_WINDOW_MS / 60000}m`);
          // eslint-disable-next-line no-continue
          continue;
        }

        log.warn(`REMOVAL REASON: UPNP port mapping failure - ${application.name} failed to map port ${failedPort} via UPNP for ${tracker.cycles} consecutive cycles over ${Math.round(sustainedMs / 60000)}m (portManager)`);
        upnpMapFailures.delete(application.name);
        // Import locally to avoid circular dependency
        // eslint-disable-next-line global-require
        const appUninstaller = require('../appLifecycle/appUninstaller');
        // eslint-disable-next-line no-await-in-loop
        await appUninstaller.removeAppLocally(application.name, null, true, true, true).catch((error) => log.error(error)); // remove entire app
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(3 * 60 * 1000); // 3 mins
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
 * The host ports this node's applications hold.
 *
 * Answered from this node's own record of what it has installed rather than
 * from its containers. That record covers an enterprise application like any
 * other - a node decrypts its own specifications - and it covers an application
 * that is installed but stopped, which still holds the router's forward.
 *
 * @returns {Promise<number[]>} the ports, ascending
 */
async function portsInUse() {
  const ports = await getAllUsedPorts();

  return ports.map(Number).filter(Number.isInteger).sort((a, b) => a - b);
}

/**
 * GET /flux/portsinuse - the ports this node holds.
 *
 * Read by another Flux node on the same public address, deciding whether a port
 * it is about to install onto is already spoken for. The router forwards each
 * port to exactly one node, so two applications wanting the same port at one
 * address cannot both be reached, whichever applications they are - which is why
 * the answer is ports alone and names no application.
 *
 * Nothing here is withheld elsewhere: a port in use at an address is what a port
 * scan of that address reports, and this names nothing that would attribute one
 * to an application.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>}
 */
async function portsInUseApi(req, res) {
  try {
    res.json(messageHelper.createDataMessage(await portsInUse()));
  } catch (error) {
    log.error(error);
    res.json(messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    ));
  }
}

/**
 * The host ports a specification asks for.
 *
 * @param {object} appSpecFormatted - App specification
 * @returns {number[]}
 */
function specifiedPorts(appSpecFormatted) {
  if (appSpecFormatted.version === 1) {
    return appSpecFormatted.port ? [Number(appSpecFormatted.port)] : [];
  }
  if (appSpecFormatted.version <= 3) {
    return (appSpecFormatted.ports || []).map(Number);
  }

  return (appSpecFormatted.compose || [])
    .flatMap((component) => (component.ports || []).map(Number));
}

/**
 * The other Flux nodes sharing our public address.
 *
 * Taken from the node list rather than from app locations, so a node that is not
 * running anything yet is still counted - that is the node most likely to be
 * installing.
 *
 * @param {string} localSocketAddress - our own ip:port
 * @returns {string[]|null} their socket addresses, or null when the node list is
 *   not known - which is an absence of information, not an absence of siblings
 */
function siblingSocketAddresses(localSocketAddress) {
  const ip = extractIp(localSocketAddress);
  if (!ip || !networkStateService.isReady()) return null;

  const ownPort = extractPort(localSocketAddress);

  return networkStateService.networkState()
    .map((node) => node.ip)
    .filter((address) => address
      && extractIp(address) === ip
      && extractPort(address) !== ownPort);
}

/**
 * The Flux node at our public address holding a port this specification wants,
 * if there is one.
 *
 * Each node behind a shared address keeps its own database and its own docker,
 * so every one of them binds the port and only the one the router forwards to
 * ever receives traffic. The rest run unreachable while still being broadcast as
 * live instances.
 *
 * Asked before the firewall is opened and before any mapping is attempted, so a
 * refusal costs nothing to unwind.
 *
 * Answers rather than throws. This is the same class of fact as "the ports are
 * not reachable from outside" and is handled on the same path. A thrown error
 * would file the app in the pre-install error cache, and a port that belongs to
 * a neighbour is an ordinary answer rather than a fault.
 *
 * Advisory. A sibling that is down, or answers nothing we can read, leaves us no
 * wiser - and silence is never read as clearance, because the port test that
 * follows is what decides.
 *
 * @param {object} appSpecFormatted - App specification
 * @param {string} localSocketAddress - our own ip:port
 * @returns {Promise<{address: string, port: number}|null>} the sibling and the
 *   port it holds, or null when none of them reported one
 */
async function siblingHoldingPort(appSpecFormatted, localSocketAddress) {
  const wanted = new Set(specifiedPorts(appSpecFormatted).filter(Number.isInteger));
  if (!wanted.size) return null;

  const siblings = siblingSocketAddresses(localSocketAddress);
  if (!siblings || !siblings.length) return null;

  const timeout = config.fluxapps.siblingPortsTimeoutMs;

  const answers = await Promise.all(siblings.map(async (address) => {
    const response = await serviceHelper.axiosGet(
      `http://${extractIp(address)}:${extractPort(address)}/flux/portsinuse`,
      // A list of port numbers, so the ceiling is generous by orders of
      // magnitude. Bounded at all because axios does not bound a response body
      // by default, and this address is only as trustworthy as whatever is
      // answering on it.
      { timeout, maxContentLength: 64 * 1024, maxBodyLength: 64 * 1024 },
    ).catch(() => null);

    const body = response && response.data;
    if (!body || body.status !== 'success' || !Array.isArray(body.data)) return null;

    return { address, ports: body.data.map(Number) };
  }));

  // eslint-disable-next-line no-restricted-syntax
  for (const answer of answers) {
    if (answer) {
      const held = answer.ports.find((port) => wanted.has(port));
      if (held) return { address: answer.address, port: held };
    }
  }

  return null;
}

/**
 * The first port a peer's pass did not actually prove, or null if it proved them all.
 *
 * A peer reports that something answered at our public address. Where several
 * Flux nodes share that address the router forwards each port to exactly one of
 * them, so what answered can be a sibling's application while our own test
 * server sat unreached - and the peer cannot tell the difference, because from
 * outside there is none.
 *
 * Our test servers can. Each records the addresses that reached it, so the
 * question becomes whether the peer we just asked arrived here. Matching on that
 * peer, rather than on any caller, keeps an unrelated connection during the test
 * window from reading as proof the port is ours.
 *
 * Only ports the peer would have probed are required to show a connection: it
 * skips any outside the app port range, and a port it never tried says nothing
 * either way.
 *
 * @param {number[]} portsToTest - the ports, in the order their servers were made
 * @param {Array<{reachedBy: Function}>} servers - one test server per port
 * @param {string} askingIP - the peer we sent
 * @returns {number|null}
 */
function portNotReached(portsToTest, servers, askingIP) {
  const at = servers.findIndex((server, index) => {
    const port = portsToTest[index];
    const probed = port >= config.fluxapps.portMin && port <= config.fluxapps.portMax;

    return probed && !server.reachedBy(askingIP);
  });

  return at === -1 ? null : portsToTest[at];
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
    const localSocketAddress = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddress) {
      throw new Error('Failed to detect Public IP');
    }
    const localIp = extractIp(localSocketAddress);
    const localPort = extractPort(localSocketAddress);

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
      await serviceHelper.delay(config.fluxapps.portTestBindDelayMs);

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

    await serviceHelper.delay(config.fluxapps.portTestPropagationDelayMs);
    const timeout = config.fluxapps.portTestPeerTimeoutMs;
    const axiosConfig = {
      timeout,
    };
    const data = {
      ip: localIp,
      port: localPort,
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
    while (!finished && i < config.fluxapps.portTestMaxAttempts) {
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      const randomSocketAddress = await networkStateService.getRandomSocketAddress(
        localSocketAddress,
      );

      // this should never happen as the list should be populated here
      if (!randomSocketAddress) {
        throw new Error('Unable to get random test connection');
      }

      const askingIP = extractIp(randomSocketAddress);
      const askingIpPort = extractPort(randomSocketAddress);

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
        const unreachedPort = portNotReached(portsToTest, beforeAppInstallTestingServers, askingIP);

        if (unreachedPort === null) {
          portsStatus = true;
        } else {
          log.warn(`checkInstallingAppPortAvailable - port ${unreachedPort} answered ${askingIP} from somewhere other than this node`);
          portsNotWorking.add(unreachedPort);
          if (!originalPortFailed) {
            originalPortFailed = unreachedPort;
            // eslint-disable-next-line no-unused-vars
            nextTestingPort = unreachedPort < 65535 ? unreachedPort + 1 : unreachedPort - 1;
          }
          portsStatus = false;
        }
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
    const { userconfig } = globalThis;
    const apiPort = userconfig.initial.apiport || config.server.apiport;
    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddr) {
      return;
    }

    const randomSocketAddress = await networkStateService.getRandomSocketAddress(localSocketAddr);

    if (!randomSocketAddress) return;

    const askingIP = extractIp(randomSocketAddress);
    const askingIpPort = extractPort(randomSocketAddress);
    const localIp = extractIp(localSocketAddr);

    if (localIp === askingIP) {
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
      ip: localIp,
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
  portsInUse,
  portsInUseApi,
  specifiedPorts,
  portNotReached,
  siblingHoldingPort,
  isPortAvailable,
  findNextAvailablePort,
  signCheckAppData,
  checkInstallingAppPortAvailable,
  callOtherNodeToKeepUpnpPortsOpen,
  failedNodesTestPortsCache,
  upnpMapFailures,
};
