const config = require('config');
const natUpnp = require('@megachips/nat-upnp');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
const nodecmd = require('node-cmd');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');

const log = require('../lib/log');

const client = new natUpnp.Client({ cacheGateway: true });

// UPnP mapping description constants
const MAPPING_DESC_TEST = 'Flux_UPNP_Mapping_Test';
const MAPPING_DESC_APP_TEST = 'Flux_Test_App';
const MAPPING_DESC_APP_PREFIX = 'Flux_App_';
const MAPPING_DESC_PRELAUNCH_PREFIX = 'Flux_Prelaunch_App_';

// FluxOS service port definitions — offset from apiport, TCP-only HTTP services
const FLUXOS_PORT_DEFS = [
  { offset: 0, description: 'Flux_Backend_API', protocols: ['TCP'] },
  { offset: 1, description: 'Flux_Backend_API_SSL', protocols: ['TCP'] },
  { offset: -1, description: 'Flux_Home_UI', protocols: ['TCP'] },
  { offset: 2, description: 'Flux_Syncthing', protocols: ['TCP'] },
];

// Minimum TTL for test mappings — must survive multi-retry peer checks (up to ~165s worst case)
const MIN_TEST_MAPPING_TTL_S = 180;

// Smart refresh cycle duration — shared with portManager
const CYCLE_DURATION_S = 600;

// Minimum TTL at startup — must survive until first loop cycle completes
const MIN_STARTUP_TTL_S = CYCLE_DURATION_S + 30;

let upnpMachine = false;

// Router capability state, populated during verifyUPNPsupport()
const routerCapabilities = {
  supportsLeaseDuration: false, // Can we use finite TTL?
  minLeaseDuration: 60, // Router's minimum TTL (60 on most, 900 on Sagemcom F5685)
  igdV2Capping: false, // Does ttl=0 get capped?
  maxLeaseDuration: 0, // Actual lease when ttl=0 requested (0 = permanent, 604800 = capped)
  routerInfo: null, // { manufacturer, model, daemonVersion } for logging
  probed: false, // Whether probing has completed
};


/**
 * To quickly check if node has UPnP (Universal Plug and Play) support.
 * @returns {boolean} True if port mappings can be set. Otherwise false.
 */
function isUPNP() {
  return upnpMachine;
}

/**
 * To check if a firewall is active.
 * @returns {Promise<boolean>} True if a firewall is active. Otherwise false.
 */
async function isFirewallActive() {
  try {
    const cmdAsync = util.promisify(nodecmd.run);
    const execA = 'LANG="en_US.UTF-8" && sudo ufw status | grep Status';
    const cmdresA = await cmdAsync(execA);
    if (serviceHelper.ensureString(cmdresA).includes('Status: active')) {
      return true;
    }
    return false;
  } catch (error) {
    // command ufw not found is the most likely reason
    log.error(error);
    return false;
  }
}

/**
 * To adjust a firewall to allow comms between host and router.
 */
async function adjustFirewallForUPNP() {
  try {
    let { routerIP } = userconfig.initial;
    routerIP = serviceHelper.ensureString(routerIP);
    if (routerIP) {
      const cmdAsync = util.promisify(nodecmd.run);
      const firewallActive = await isFirewallActive();
      if (firewallActive) {
        // standard rules for upnp
        const execA = 'LANG="en_US.UTF-8" && sudo ufw insert 1 allow out from any to 239.255.255.250 port 1900 proto udp > /dev/null 2>&1';
        const execB = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow from ${routerIP} port 1900 to any proto udp > /dev/null 2>&1`;
        const execC = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow out from any to ${routerIP} proto tcp > /dev/null 2>&1`;
        const execD = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow from ${routerIP} to any proto udp > /dev/null 2>&1`;
        await cmdAsync(execA);
        await cmdAsync(execB);
        await cmdAsync(execC);
        await cmdAsync(execD);

        const fluxCommunicationPorts = config.server.allowedPorts;
        // eslint-disable-next-line no-restricted-syntax
        for (const port of fluxCommunicationPorts) {
          // create rule for hone nodes ws connections
          const execAllowHomeComsA = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow in proto tcp from any to ${routerIP} port ${port} > /dev/null 2>&1`;
          const execAllowHomeComsB = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow out proto tcp to ${routerIP} port ${port} > /dev/null 2>&1`;
          const execAllowHomeComsC = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow in proto udp from any to ${routerIP} port ${port} > /dev/null 2>&1`;
          const execAllowHomeComsD = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow out proto udp to ${routerIP} port ${port} > /dev/null 2>&1`;
          // eslint-disable-next-line no-await-in-loop
          await cmdAsync(execAllowHomeComsA);
          // eslint-disable-next-line no-await-in-loop
          await cmdAsync(execAllowHomeComsB);
          // eslint-disable-next-line no-await-in-loop
          await cmdAsync(execAllowHomeComsC);
          // eslint-disable-next-line no-await-in-loop
          await cmdAsync(execAllowHomeComsD);
          log.info(`Firewall adjusted for UPNP local connections on port ${port}`);
        }
        // delete and recreate deny rule at end
        let routerIpNetwork = `${routerIP.split('.')[0]}.${routerIP.split('.')[1]}.0.0`;
        if (routerIpNetwork === '10.0.0.0') {
          routerIpNetwork += '/8';
        } else if (routerIpNetwork === '172.16.0.0') {
          routerIpNetwork += '/12';
        } else if (routerIpNetwork === '192.168.0.0') {
          routerIpNetwork += '/16';
        } else if (routerIpNetwork === '100.64.0.0') {
          routerIpNetwork += '/10';
        } else if (routerIpNetwork === '198.18.0.0') {
          routerIpNetwork += '/15';
        } else if (routerIpNetwork === '169.254.0.0') {
          routerIpNetwork += '/16';
        }
        const execDelete = `LANG="en_US.UTF-8" && sudo ufw delete deny out from any to ${routerIpNetwork}`;
        await cmdAsync(execDelete);
        log.info('Firewall adjusted for UPNP');
      } else {
        log.info('RouterIP is set but firewall is not active. Adjusting not applied for UPNP');
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Verify UPnP support and probe router capabilities in a single flow.
 * Uses the test port (apiport + 3) to both verify UPnP works and learn the
 * router's TTL/lease behavior. Each step proves a capability while also
 * gathering data:
 *
 * 1. getPublicIp()        — gateway is reachable
 * 2. getGateway()         — gateway responds + capture router info
 * 3. createMapping(ttl=60) — can we create mappings? does router support finite TTL?
 *    - If error 725 (MikroTik): no TTL support, fall back to ttl=0
 * 4. getMapping(port)     — can we query? what TTL did the router actually store?
 * 5. removeMapping()      — can we remove mappings?
 * 6. createMapping(ttl=0) — check if ttl=0 gets capped by IGD v2
 * 7. getMapping(port)     — read back actual lease for ttl=0
 * 8. removeMapping()      — final cleanup
 *
 * @param {number} apiport Port number.
 * @param {Array} [appPorts=[]] App port entries to check/map: [{ port, description, protocols }].
 * @returns {Promise<boolean>} True if UPnP is functional. Otherwise false.
 */
async function verifyUPNPsupport(apiport = config.server.apiport, appPorts = []) {
  const testPort = +apiport + 3;

  // Firewall setup for UPnP communication
  try {
    if (userconfig.initial.routerIP) {
      await adjustFirewallForUPNP();
    }
  } catch (error) {
    log.error(error);
  }

  // Step 1: Verify gateway is reachable
  try {
    await client.getPublicIp();
    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get public ip');
    upnpMachine = false;
    return false;
  }

  // Step 2: Get gateway + capture router info
  try {
    const info = await client.getGateway();
    await serviceHelper.delay(500);
    const deviceInfo = await info.getDevice();
    if (deviceInfo) {
      routerCapabilities.routerInfo = {
        manufacturer: deviceInfo.manufacturer || 'unknown',
        model: deviceInfo.modelName || deviceInfo.friendlyName || 'unknown',
        daemonVersion: deviceInfo.modelDescription || 'unknown',
      };
    }
    log.info(`Router: ${routerCapabilities.routerInfo.manufacturer} ${routerCapabilities.routerInfo.model}`);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Gateway');
    upnpMachine = false;
    return false;
  }

  // Step 3: Create mapping with ttl=60 — tests create + probes TTL support
  let supportsLease = false;
  let minLease = 60;
  try {
    await client.createMapping({
      public: testPort,
      private: testPort,
      ttl: 60,
      description: MAPPING_DESC_TEST,
    });
    await serviceHelper.delay(500);
    supportsLease = true; // tentatively — readback will confirm
  } catch (error) {
    if (error.code === 725) {
      // OnlyPermanentLeasesSupported (MikroTik) — not a verify failure, just no TTL support
      log.info('Router rejects finite TTL (error 725) — only permanent leases supported');
      supportsLease = false;
      // Fall back: create with ttl=0 to complete verification
      try {
        await client.createMapping({
          public: testPort,
          private: testPort,
          ttl: 0,
          description: MAPPING_DESC_TEST,
        });
        await serviceHelper.delay(500);
      } catch (fallbackError) {
        log.error(fallbackError);
        log.error('VerifyUPNPsupport - Failed Create Mapping (ttl=0 fallback)');
        upnpMachine = false;
        return false;
      }
    } else {
      log.error(error);
      log.error('VerifyUPNPsupport - Failed Create Mapping');
      upnpMachine = false;
      return false;
    }
  }

  // Step 4: Read back the mapping — tests query + checks actual TTL stored
  try {
    const readback = await client.getMapping({ public: testPort });
    await serviceHelper.delay(500);

    if (supportsLease && readback && typeof readback.ttl === 'number') {
      if (readback.ttl === 0) {
        // Router accepted ttl=60 but stored permanent (e.g. neufbox GR140CG)
        supportsLease = false;
        log.info('Router accepted ttl=60 but readback is 0 — treating as no lease duration support');
      } else {
        // Some routers enforce a minimum (e.g. Sagemcom F5685 caps to 900)
        minLease = readback.ttl;
        log.info(`Router supports lease duration, effective minimum TTL: ${minLease}s`);
      }
    }
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Mapping readback');
    upnpMachine = false;
    return false;
  }

  // Step 5: Remove the test mapping — tests removal
  try {
    await client.removeMapping({ public: testPort });
    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed Remove Mapping');
    upnpMachine = false;
    return false;
  }

  // Steps 6-8: Probe ttl=0 capping (IGD v2 check)
  // This is non-critical — failure here doesn't block UPnP
  let igdV2Capping = false;
  let maxLease = 0;
  try {
    await client.createMapping({
      public: testPort,
      private: testPort,
      ttl: 0,
      description: MAPPING_DESC_TEST,
    });
    await serviceHelper.delay(500);

    const readback = await client.getMapping({ public: testPort });
    await serviceHelper.delay(500);

    if (readback && typeof readback.ttl === 'number' && readback.ttl > 0) {
      igdV2Capping = true;
      maxLease = readback.ttl;
      log.info(`Router caps ttl=0 to ${maxLease}s — lease-aware refresh needed`);
    } else {
      log.info('Router supports truly permanent leases (ttl=0 stays 0)');
    }

    await client.removeMapping({ public: testPort }).catch((e) => log.warn(`Probe cleanup: ${e.message}`));
    await serviceHelper.delay(500);
  } catch (error) {
    log.warn(`IGD v2 capping probe failed (non-critical): ${error.message}`);
    await client.removeMapping({ public: testPort }).catch((e) => log.warn(`Probe cleanup: ${e.message}`));
  }

  // Store capabilities
  routerCapabilities.supportsLeaseDuration = supportsLease;
  routerCapabilities.minLeaseDuration = supportsLease ? minLease : 60;
  routerCapabilities.igdV2Capping = igdV2Capping;
  routerCapabilities.maxLeaseDuration = maxLease;
  routerCapabilities.probed = true;

  log.info(`Router capabilities: supportsLeaseDuration=${supportsLease}, minLeaseDuration=${routerCapabilities.minLeaseDuration}s, igdV2Capping=${igdV2Capping}, maxLeaseDuration=${maxLease}s`);

  // Ensure all FluxOS service ports are mapped before servers bind.
  // Check each port first — only map if absent, wrong host, or TTL too low
  // to survive until the first loop cycle.
  // eslint-disable-next-line no-restricted-syntax
  for (const def of FLUXOS_PORT_DEFS) {
    const port = +apiport + def.offset;
    let needsMapping = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      const mapping = await getPortMapping(port);
      if (!mapping) {
        needsMapping = true;
      } else if (!mapping.local) {
        log.warn(`Startup: port ${port} mapped to ${mapping.private.host}, not this node — remapping`);
        needsMapping = true;
      } else if (mapping.ttl > 0 && mapping.ttl < MIN_STARTUP_TTL_S) {
        log.info(`Startup: port ${port} TTL ${mapping.ttl}s too low — refreshing`);
        needsMapping = true;
      }
    } catch (error) {
      // Router unreachable on query — try to map anyway
      needsMapping = true;
    }
    if (needsMapping) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await mapUpnpPort(port, def.description, { protocols: def.protocols });
      if (!ok) {
        log.error(`VerifyUPNPsupport - Failed to map FluxOS port ${port} (${def.description})`);
        upnpMachine = false;
        return false;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }

  // Check and map app ports (if any installed apps were passed in)
  // eslint-disable-next-line no-restricted-syntax
  for (const entry of appPorts) {
    let needsMapping = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      const mapping = await getPortMapping(entry.port);
      if (!mapping) {
        needsMapping = true;
      } else if (!mapping.local) {
        log.warn(`Startup: app port ${entry.port} mapped to ${mapping.private.host}, not this node — remapping`);
        needsMapping = true;
      } else if (mapping.ttl > 0 && mapping.ttl < MIN_STARTUP_TTL_S) {
        log.info(`Startup: app port ${entry.port} TTL ${mapping.ttl}s too low — refreshing`);
        needsMapping = true;
      }
    } catch (error) {
      needsMapping = true;
    }
    if (needsMapping) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await mapUpnpPort(entry.port, entry.description, { protocols: entry.protocols });
      if (!ok) {
        // App port failure at startup is a warning, not fatal — loop will retry
        log.warn(`Startup: failed to map app port ${entry.port} (${entry.description})`);
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }

  upnpMachine = true;
  return true;
}

/**
 * Create UPnP port mapping(s) for the specified protocols.
 * @param {number} port Port number.
 * @param {string} description Port description.
 * @param {object} [options] Optional settings.
 * @param {number} [options.ttl=0] Lease duration in seconds (0 = permanent/router default).
 * @param {string[]} [options.protocols=['TCP','UDP']] Protocols to map.
 * @param {number} [options.delay=1000] Delay in ms between protocol mappings (0 to disable).
 * @returns {Promise<boolean>} True if all mappings created successfully. Otherwise false.
 */
async function mapUpnpPort(port, description, options = {}) {
  const ttl = options.ttl ?? 0;
  const protocols = options.protocols ?? ['TCP', 'UDP'];
  const delay = options.delay ?? 1000;
  try {
    for (let i = 0; i < protocols.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await client.createMapping({
        public: port,
        private: port,
        ttl,
        protocol: protocols[i],
        description,
      });
      if (delay > 0 && i < protocols.length - 1) {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(delay);
      }
    }
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Get all active UPNP mappings on the router for this host.
 * Uses { local: true } to filter to only mappings where private.host matches our local address.
 * @returns {Promise<Array|null>} All local mappings, or null if query failed.
 */
async function getLocalMappings() {
  try {
    const mappings = await client.getMappings({ local: true });
    return mappings || [];
  } catch (error) {
    log.error(error);
    return null;
  }
}

/**
 * O(1) lookup for a specific port mapping on the router.
 * Returns null if the mapping is confirmed absent (SOAP error 714).
 * Throws on network/router errors so the caller can distinguish "not found" from "unreachable".
 * @param {number} port Public port number.
 * @param {string} [protocol='TCP'] Protocol ('TCP' or 'UDP').
 * @returns {Promise<object|null>} Mapping object with ttl field, or null if confirmed absent.
 * @throws {Error} On network/SOAP errors (router unreachable, timeout, etc.)
 */
async function getPortMapping(port, protocol = 'TCP') {
  try {
    const mapping = await client.getMapping({ public: port, protocol });
    return mapping;
  } catch (error) {
    // Error 714 = NoSuchEntryInArray (mapping confirmed absent)
    if (error.code === 714) return null;
    throw error;
  }
}


/**
 * Get the current router capabilities (populated during verifyUPNPsupport).
 * @returns {object} Router capabilities state.
 */
function getRouterCapabilities() {
  return {
    ...routerCapabilities,
    routerInfo: routerCapabilities.routerInfo ? { ...routerCapabilities.routerInfo } : null,
  };
}


/**
 * Remove UPnP port mapping(s) for the specified protocols.
 * @param {number} port Port number.
 * @param {object} [options] Optional settings.
 * @param {string[]} [options.protocols=['TCP','UDP']] Protocols to remove.
 * @param {number} [options.delay=1000] Delay in ms between protocol removals (0 to disable).
 * @returns {Promise<boolean>} True if all mappings removed successfully. Otherwise false.
 */
async function removeMapUpnpPort(port, options = {}) {
  const protocols = options.protocols ?? ['TCP', 'UDP'];
  const delay = options.delay ?? 1000;
  try {
    for (let i = 0; i < protocols.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await client.removeMapping({
        public: port,
        protocol: protocols[i],
      });
      if (delay > 0 && i < protocols.length - 1) {
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(delay);
      }
    }
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To map a specified port and show a message if successfully mapped. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function mapPortApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      let { port } = req.params;
      port = port || req.query.port;
      if (port === undefined || port === null) {
        throw new Error('No Port address specified.');
      }
      port = serviceHelper.ensureNumber(port);
      await client.createMapping({
        public: port,
        private: port,
        ttl: 0,
        protocol: 'TCP',
        description: 'Flux_manual_entry',
      });

      await client.createMapping({
        public: port,
        private: port,
        ttl: 0,
        protocol: 'UDP',
        description: 'Flux_manual_entry',
      });
      const message = messageHelper.createSuccessMessage('Port mapped');
      res.json(message);
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
 * To unmap a specified port and show a message if successfully unmapped. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function removeMapPortApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      let { port } = req.params;
      port = port || req.query.port;
      if (port === undefined || port === null) {
        throw new Error('No Port address specified.');
      }
      port = serviceHelper.ensureNumber(port);
      await client.removeMapping({
        public: port,
        protocol: 'TCP',
      });
      await client.removeMapping({
        public: port,
        protocol: 'UDP',
      });
      const message = messageHelper.createSuccessMessage('Port unmapped');
      res.json(message);
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
 * To show a message with mappings. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function getMapApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      const map = await client.getMappings();
      const message = messageHelper.createDataMessage(map);
      res.json(message);
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
 * To show a message with IP address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function getIpApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      const ip = await client.getPublicIp();
      const message = messageHelper.createDataMessage(ip);
      res.json(message);
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
 * To show a message with gateway address. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function getGatewayApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      const gateway = await client.getGateway();
      const message = messageHelper.createDataMessage(gateway);
      res.json(message);
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
  isUPNP,
  verifyUPNPsupport,
  mapUpnpPort,
  removeMapUpnpPort,
  mapPortApi,
  removeMapPortApi,
  getMapApi,
  getLocalMappings,
  getPortMapping,
  getRouterCapabilities,
  getIpApi,
  getGatewayApi,
  adjustFirewallForUPNP,
  FLUXOS_PORT_DEFS,
  CYCLE_DURATION_S,
  MAPPING_DESC_APP_TEST,
  MAPPING_DESC_APP_PREFIX,
  MAPPING_DESC_PRELAUNCH_PREFIX,
  MIN_TEST_MAPPING_TTL_S,
};
