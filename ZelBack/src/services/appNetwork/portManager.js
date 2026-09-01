const config = require('config');
const crypto = require('node:crypto');
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
const { Privilege, authOf } = require('../utils/privileges');
const fluxCaching = require('../utils/cacheManager');
const fluxEventBus = require('../utils/fluxEventBus');

// Global cache for failed nodes
const failedNodesTestPortsCache = new Map();

// One entry: this answers what THIS node holds, so there is nothing to key on.
const PORTS_IN_USE_KEY = 'portsInUse';

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
  // Cached as a VALUE rather than as a response. A route cache stores whatever
  // the handler produced, so a transient failure answered with a 200 and an
  // error body was pinned for the whole window after the condition cleared -
  // which routes.js says in as many words must never happen. A throw produces
  // no value, so there is nothing here to remember.
  const cache = fluxCaching.default.portsInUseCache;

  const cached = cache.get(PORTS_IN_USE_KEY);
  if (cached) return cached;

  const ports = await getAllUsedPorts();
  const answer = ports.map(Number).filter(Number.isInteger).sort((a, b) => a - b);

  cache.set(PORTS_IN_USE_KEY, answer);
  return answer;
}

/**
 * POST /flux/portsinuse - the ports this node holds, to a Fluxnode that signed
 * the question.
 *
 * Read by another Flux node on the same public address, deciding whether a port
 * it is about to install onto is already spoken for. The router forwards each
 * port to exactly one node, so two applications wanting the same port at one
 * address cannot both be reached, whichever applications they are - which is why
 * the answer is ports alone and names no application.
 *
 * SIGNED, not open. What it discloses is small - port numbers, no application
 * identity, and a port scan of the address finds most of it anyway. The reason
 * is the other half: answering means reading this node's own specifications,
 * decrypting the enterprise ones, and an anonymous caller could ask for that as
 * often as it liked. The only real caller is a sibling Fluxnode, and this
 * codebase already verifies exactly that on /flux/checkappavailability - the
 * endpoint this feature's own port test posts to. Same check, same list, same
 * signature.
 *
 * An operator asking by hand is accepted on the usual privilege, so the endpoint
 * stays usable directly.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>}
 */
async function portsInUseApi(req, res) {
  try {
    // req.body, not the raw stream. express.json() is global (fluxServer.js), so
    // for a JSON content type the body is already consumed by the time a handler
    // runs and a stream read waits for an 'end' that has been and gone - the
    // request then hangs until the caller times out, which is what it did.
    //
    // The older handlers on this path read the stream because the product posts
    // JSON.stringify(...) as a STRING, which axios does not label as JSON, so
    // the parser skips it and leaves the stream untouched. Both work; only one
    // of them works for both kinds of caller.
    const processedBody = serviceHelper.ensureObject(req.body);

    const signed = await fluxNetworkHelper.verifySignedFluxnodeMessage(processedBody);
    const authorized = signed
      ? true
      : await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));

    if (signed !== true && authorized !== true) {
      throw new Error('Unable to verify request authenticity');
    }

    // A signed ask is good for its window and no longer. Refused as STALE rather
    // than as unauthentic, because the two want different fixes and a node whose
    // clock has drifted should be able to read which from one line.
    //
    // Not asked of an operator: they authenticated as themselves, and a person
    // asking by hand has no signature for anyone to capture.
    const askedAt = signed === true ? Number(processedBody.timestamp) : null;

    if (signed === true) {
      const drift = Math.abs(Date.now() - askedAt);
      if (!Number.isFinite(askedAt) || drift > config.fluxapps.siblingAskValidityMs) {
        throw new Error('Request is stale or carries no timestamp');
      }
    }

    const ports = await portsInUse();

    // Signed, so the answer is bound to the Fluxnode that owns this address
    // rather than to whatever is listening on it. A node's own record of what it
    // has installed IS the truth about which ports are spoken for here, and that
    // is the whole reason to act on the answer - but only once it is that node
    // saying it. The request side has always established who is ASKING; without
    // this the reply established nothing at all.
    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    // askedAt is the ASK's time signed back, not this answer's. It is what makes
    // the answer good for one question rather than for every later one.
    const answer = { pubKey, ports, askedAt };
    const signature = await signCheckAppData(JSON.stringify(answer));

    // signMessage catches its own failures and answers with nothing, so an
    // unsigned answer is a real possibility rather than a throw. It would be
    // discarded at the other end without a word; say what happened instead.
    if (!signature || typeof signature !== 'string') {
      throw new Error('Unable to sign the answer');
    }

    res.json(messageHelper.createDataMessage({ ...answer, signature }));
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
 * DEPENDS ON NAT HAIRPINNING. A sibling is addressed by the public address it
 * shares with us, so asking it means leaving the router and being sent straight
 * back in. Where a router does not do that, every sibling is silent and this
 * check contributes nothing. What is lost is the only answer to "is this port
 * already SPOKEN FOR here": the port test that follows answers a different
 * question - whether the port reaches us right now - and so cannot see a port a
 * neighbour has installed and is not currently serving. Asking over the LAN
 * rather than through the router is the fix, and it belongs with the work that
 * gives siblings an address that is not the shared one.
 *
 * @param {number[]} appPorts - the host ports this application wants
 * @param {string} localSocketAddress - our own ip:port
 * @returns {Promise<{address: string, port: number}|null>} the sibling and the
 *   port it holds, or null when none of them reported one
 */
async function siblingHoldingPort(appPorts, localSocketAddress) {
  const wanted = new Set((appPorts || []).map(Number).filter(Number.isInteger));
  if (!wanted.size) return null;

  const siblings = siblingSocketAddresses(localSocketAddress);
  if (!siblings || !siblings.length) return null;

  const timeout = config.fluxapps.siblingPortsTimeoutMs;

  // Signed for the sibling to verify, the same way the port test signs what it
  // sends to /flux/checkappavailability.
  const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
  // Timestamped. Without it the body is constant - a key and a fixed word - so
  // one captured signature is a bearer token for this endpoint on every node in
  // the network, for ever. It is also what binds the ANSWER to this question:
  // the sibling signs the time back, so a captured answer cannot be replayed
  // into a later ask either. One field, both directions.
  const ask = { pubKey, asking: 'portsInUse', timestamp: Date.now() };
  const signature = await signCheckAppData(JSON.stringify(ask));

  // signMessage catches its own failures and answers with nothing, so an
  // unsigned ask is a real possibility rather than a throw. Sending it anyway
  // would have every sibling refuse it and read back as "no sibling holds the
  // port" - the advisory check failing open, silently, on a node whose key is
  // briefly unavailable. Say what happened and answer no information instead.
  if (!signature || typeof signature !== 'string') {
    log.warn('siblingHoldingPort - could not sign the request; no sibling was asked');
    return null;
  }

  const signedAsk = { ...ask, signature };

  const answers = await Promise.all(siblings.map(async (address) => {
    const response = await axios.post(
      `http://${extractIp(address)}:${extractPort(address)}/flux/portsinuse`,
      signedAsk,
      // A list of port numbers, so the ceiling is generous by orders of
      // magnitude. Bounded at all because axios does not bound a response body
      // by default, and this address is only as trustworthy as whatever is
      // answering on it.
      { timeout, maxContentLength: 64 * 1024, maxBodyLength: 64 * 1024 },
    ).catch(() => null);

    const body = response && response.data;
    if (!body || body.status !== 'success') {
      // Said out loud. A sibling refusing the question - a stale ask, a clock
      // that has drifted, a key it will not accept - is a different thing from a
      // sibling that holds nothing, and both used to be the same silence.
      const refusal = body && body.data && body.data.message;
      if (refusal) log.warn(`siblingHoldingPort - ${address} refused the question: ${refusal}`);
      return null;
    }

    const answer = body.data;
    if (!answer || !Array.isArray(answer.ports)) return null;

    // The answer names the question it answers. An answer signed for some other
    // ask is a recording, and a recording says what was true then.
    if (answer.askedAt !== ask.timestamp) {
      log.warn(`siblingHoldingPort - ${address} answered a question other than the one asked; ignoring it`);
      return null;
    }

    // Verified as the answer of the node AT THIS ADDRESS. A listed Fluxnode
    // elsewhere signing a port list says nothing about what is installed here,
    // and this address is only as trustworthy as whatever is answering on it.
    // The body is passed through as it arrived, because that is what was signed.
    // eslint-disable-next-line no-await-in-loop
    const verified = await fluxNetworkHelper.verifySignedFluxnodeMessage(answer, { socketAddress: address });

    if (!verified) {
      log.warn(`siblingHoldingPort - ${address} did not answer as the Flux node at that address; ignoring it`);
      return null;
    }

    return { address, ports: answer.ports.map(Number) };
  }));

  const heard = answers.filter(Boolean);

  if (!heard.length) {
    // Nothing was learned, which is not the same as there being nothing to
    // learn - and the two used to be the same silence. Reaching a sibling means
    // leaving the router and being sent straight back in, so where the router
    // does not hairpin every sibling looks mute and this check quietly
    // contributes nothing on the very topology it exists for. Worth a line: it
    // is an anomaly rather than a routine state, and it cannot be told from an
    // absence of siblings by anyone reading afterwards.
    log.warn(`siblingHoldingPort - ${siblings.length} Flux node(s) share this address and none of them answered; `
      + 'which ports they hold is unknown to this node');
    return null;
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const answer of heard) {
    const held = answer.ports.find((port) => wanted.has(port));
    if (held) return { address: answer.address, port: held };
  }

  return null;
}

/**
 * How many independent peers must agree before a port test refuses an install.
 * Not config: it is a property of what counts as evidence, not a tuning knob,
 * and a fluxapps key has to be added in two places to be visible under test.
 */
const PORT_TEST_CORROBORATION = 2;

/**
 * The port to refuse on once enough independent readings agree the ports are
 * not ours, or null while the evidence is still one peer's word.
 *
 * Proof and report are not the same kind of evidence. Our own token coming back
 * PROVES the port reaches this node - a secret cannot be manufactured, so one
 * peer settles it and a second adds nothing. Anything else is one observer's
 * report about a third party, and a report can be wrong: a truncated read,
 * something in the path, a peer having a bad moment. Refusing on the first of
 * those stops the node installing anything at all, quietly, until somebody goes
 * looking for it.
 *
 * A real collision corroborates itself for free. Behind a shared address the
 * router forwards that port to one node, and every peer that reads it sees the
 * same thing; an anomaly does not reproduce on a different peer. So: one witness
 * to accept, two to refuse.
 *
 * Keyed by peer, because the draw is random and can return the same peer twice -
 * one peer asked twice is one witness, whatever the count of readings says.
 *
 * @param {Map<string, number>} disagreements Peer address -> the port its
 *   reading said was not ours.
 * @param {number} corroboration How many distinct peers must agree.
 * @returns {number | null} The first port to refuse on, or null.
 */
function refusedPort(disagreements, corroboration) {
  if (disagreements.size < corroboration) return null;
  return disagreements.values().next().value;
}

/**
 * The first port whose answer was not ours, or null when every one of them was.
 *
 * The peer read each port and handed back what it found; the comparison is
 * HERE, against a secret the peer was never given. That direction is the whole
 * design. A peer cannot tell our application from a neighbour's at the same
 * address - that is why this check exists - so a peer is not in a position to
 * judge, and one that is old, broken or lying cannot manufacture a token it
 * never saw.
 *
 * Only ports the peer would have read are required to carry it: it skips any
 * outside the app port range, and a port it never tried says nothing either
 * way.
 *
 * @param {number[]} portsToTest - the ports asked about
 * @param {object} answered - port -> what that port replied, from the peer
 * @param {string} token - the secret this node published on its test servers
 * @returns {number|null} the first port that was not ours, or null
 */
function portNotOurs(portsToTest, answered, token) {
  if (!token) return null;

  const at = portsToTest.findIndex((port) => {
    const probed = port >= config.fluxapps.portMin && port <= config.fluxapps.portMax;
    if (!probed) return false;

    const reply = answered?.[port] ?? answered?.[String(port)];

    // Substring rather than equality: the peer hands back the raw bytes the
    // port produced, headers and all, capped. What matters is that our token is
    // in there and could only have come from us.
    return typeof reply !== 'string' || !reply.includes(token);
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
  // One secret for this whole test run, published by our own test servers and
  // never sent to the peer. The peer returns what it read; we compare.
  const portTestToken = crypto.randomBytes(16).toString('hex');
  const isUPNP = upnpService.isUPNP();
  // null until something decides; see the loop below.
  let verdict = null;

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
      const testHttpServer = new fluxHttpTestServer.FluxHttpTestServer(portTestToken);

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
      // Asks the peer to READ each port and hand back what it found. The token
      // it should find is deliberately not here: a peer that never learns it
      // cannot produce it without actually reaching us.
      echo: true,
    };
    const stringData = JSON.stringify(data);
    // eslint-disable-next-line no-await-in-loop
    const signature = await signCheckAppData(stringData);
    data.signature = signature;
    // Every attempt does one of two things: it DECIDES, or it records what it
    // learned and asks somebody else. Running out - of attempts, of peers, of
    // anyone willing to answer - is resolved once, after the loop.
    //
    // It used to be resolved in three places inside it, each a variation on the
    // same paragraph, and a fourth way of running out had no paragraph at all: a
    // last attempt whose peer never answered fell out of the bottom onto the
    // `false` the answer was initialised with, and refused the install having
    // said nothing. A verdict and "nobody has decided yet" must never be the
    // same value, or the next exit somebody adds inherits that too.
    let i = 0;

    // Peer address -> the port that peer said is not serving this node. Keyed by
    // peer so that redrawing the same one does not read as a second opinion.
    const disagreements = new Map();
    // Every peer already asked, so a redraw is ANOTHER peer rather than another
    // draw. Without this the picker can hand back the one just asked - which on
    // a budget of two attempts it often does - and a check counting distinct
    // witnesses never reaches two however many times it tries.
    const asked = [];
    // Why the loop stopped learning, for the resolution below. There being
    // nobody left outside this address is not the same as everyone who was there
    // being unable or unwilling to answer, and a reader needs to know which.
    let ranOutOfObservers = false;
    let sawUnreadablePeer = false;
    let sawSilentPeer = false;

    while (verdict === null && i < config.fluxapps.portTestMaxAttempts) {
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      const randomSocketAddress = await networkStateService.getRandomExternalObserver(
        localSocketAddress,
        { exclude: asked },
      );

      // Nobody outside this address left to ask. A Flux node sharing our public
      // address is not outside it: its packets never leave the router, so what
      // it can reach says nothing about what the internet can reach. Answering
      // nothing is honest, and the resolution below takes it the same way it
      // takes every other "nothing was learned" - which is the check this node
      // made before the token existed.
      if (!randomSocketAddress) {
        ranOutOfObservers = true;
        break;
      }

      const askingIP = extractIp(randomSocketAddress);
      const askingIpPort = extractPort(randomSocketAddress);
      asked.push(randomSocketAddress);

      // first check against our IP address
      // eslint-disable-next-line no-await-in-loop
      const resMyAppAvailability = await axios.post(`http://${askingIP}:${askingIpPort}/flux/checkappavailability`, JSON.stringify(data), axiosConfig).catch((error) => {
        log.error(`${askingIP} for app availability is not reachable`);
        log.error(error);
      });

      // What this attempt learned about one of our ports, or null when it
      // learned nothing at all. Only a port recorded here counts as a witness.
      let reportedPort = null;

      if (!resMyAppAvailability) {
        // The peer never answered us. That is a fact about the peer, not about
        // our ports.
        sawSilentPeer = true;
        // eslint-disable-next-line no-continue
        continue;
      }

      if (resMyAppAvailability.data.status === 'error') {
        // Two different things arrive here and only one of them is about our
        // ports. A peer that NAMES the port it could not reach has read
        // something at this address. A peer that rejected the request outright -
        // a stale node list, a clock, a key briefly unavailable at its end - has
        // told us nothing, and taking that for "your port is closed" refuses an
        // install that was fine and records a cause that never happened.
        const failure = resMyAppAvailability.data.data && resMyAppAvailability.data.data.message;
        const failedPort = typeof failure === 'string' && failure.includes('Failed port: ')
          ? serviceHelper.ensureNumber(failure.split('Failed port: ')[1])
          : null;

        if (!(failedPort > 0)) {
          log.warn(`checkInstallingAppPortAvailable - ${askingIP} would not answer the question (${failure || 'no reason given'}); asking another peer`);
          sawSilentPeer = true;
          // eslint-disable-next-line no-continue
          continue;
        }

        // One peer's report that a port did not answer it. Evidence, and it goes
        // to the same rule everything else goes to - not a verdict. Only our own
        // token coming back settles a port on one peer's say-so, because only
        // this node could have produced it.
        log.warn(`checkInstallingAppPortAvailable - ${askingIP} could not reach port ${failedPort}`);
        reportedPort = failedPort;
      } else if (resMyAppAvailability.data.status === 'success') {
        const { answered } = resMyAppAvailability.data.data || {};

        if (!answered) {
          // This peer is on older code: it reached the ports but did not read
          // them, so it has told us nothing we can act on. Ask someone else.
          log.info(`checkInstallingAppPortAvailable - ${askingIP} cannot read ports back, asking another peer`);
          sawUnreadablePeer = true;
          // eslint-disable-next-line no-continue
          continue;
        }

        const notOurs = portNotOurs(portsToTest, answered, portTestToken);

        if (notOurs === null) {
          // Our own token came back. Proof, not report - only this node could
          // have produced it - so one peer settles it.
          verdict = true;
          break;
        }

        log.info(`checkInstallingAppPortAvailable - ${askingIP} read something other than this node on port ${notOurs}`);
        reportedPort = notOurs;
      } else {
        // An answer in a shape this node does not understand is not an answer.
        sawSilentPeer = true;
        // eslint-disable-next-line no-continue
        continue;
      }

      disagreements.set(askingIP, reportedPort);

      const refused = refusedPort(disagreements, PORT_TEST_CORROBORATION);

      if (refused === null) {
        log.info(`checkInstallingAppPortAvailable - one peer so far says port ${reportedPort} is not ours; asking another before refusing`);
        // eslint-disable-next-line no-continue
        continue;
      }

      // Behind a shared address that is a neighbour's application holding the
      // router's forward, which is exactly what this refuses - and now more than
      // one peer has read it that way. Each peer's own reading is named, because
      // two peers tripping on different ports is still corroboration and a line
      // naming only the first port would be describing something else.
      const readings = [...disagreements.entries()].map(([peer, port]) => `${peer} on port ${port}`);
      log.warn(`checkInstallingAppPortAvailable - port ${refused} at this address is answered by something other than this node, as read by `
        + `${disagreements.size} peers (${readings.join(', ')}). Installation aborted.`);
      fluxEventBus.publish('ports:notOurs', {
        port: refused,
        peers: [...disagreements.keys()],
        readings: Object.fromEntries(disagreements),
      });
      verdict = false;
    }

    if (verdict === null) {
      // Nothing proved and nothing corroborated. What was not learned does not
      // refuse an install: this is the check this node made before the token
      // existed, and it is what stops the first nodes to upgrade refusing
      // everything while the rest of the network catches up.
      let reason;
      if (disagreements.size) {
        reason = ranOutOfObservers ? 'noOtherObserver' : 'singleWitness';
      } else if (ranOutOfObservers) {
        reason = 'noObserver';
      } else if (sawUnreadablePeer) {
        reason = 'noReader';
      } else {
        reason = 'noneAnswered';
      }

      const witnesses = [...disagreements.keys()];
      const disputed = disagreements.size ? [...disagreements.values()][0] : null;

      if (witnesses.length) {
        log.warn(`checkInstallingAppPortAvailable - ${witnesses.length} peer(s) read a port that was not ours `
          + `(${witnesses.join(', ')}) and no other Flux node outside this address could be asked; `
          + 'proceeding on reachability alone');
      } else {
        log.warn(`checkInstallingAppPortAvailable - nothing was learned about these ports from ${asked.length} peer(s) asked `
          + `(${reason}); proceeding on reachability alone`);
      }

      fluxEventBus.publish('ports:unproven', {
        reason,
        port: disputed,
        // Unchanged in meaning: the peers that disagreed, where any did. `asked`
        // carries everyone who was asked, which is the other question a reader
        // of this event wants answered and could not previously get.
        peers: reason === 'noReader' ? asked.map(extractIp) : witnesses,
        asked: asked.map(extractIp),
        silent: sawSilentPeer,
      });

      verdict = true;
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
    return verdict;
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

    // An external observer, for the same reason the install-time port test wants
    // one: a node behind our own router cannot tell us what our address looks
    // like from outside it. This used to redraw by hand on a same-IP match; the
    // picker guarantees it now, for every caller that asks this question.
    const randomSocketAddress = await networkStateService.getRandomExternalObserver(localSocketAddr);

    if (!randomSocketAddress) return;

    const askingIP = extractIp(randomSocketAddress);
    const askingIpPort = extractPort(randomSocketAddress);
    // Still needed below: this node's own address is what it asks the peer to
    // keep open. It is no longer used to reject a same-address peer - the
    // picker does that.
    const localIp = extractIp(localSocketAddr);
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
  portNotOurs,
  refusedPort,
  siblingHoldingPort,
  isPortAvailable,
  findNextAvailablePort,
  signCheckAppData,
  checkInstallingAppPortAvailable,
  callOtherNodeToKeepUpnpPortsOpen,
  failedNodesTestPortsCache,
  upnpMapFailures,
};
