const config = require('config');
const natUpnp = require('@runonflux/nat-upnp');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
// eslint-disable-next-line import/no-extraneous-dependencies

const log = require('../lib/log');
const ufw = require('./utils/ufw');
const fluxadmPort = require('./fluxadmPort');
const globalState = require('./utils/globalState');
const { Privilege, authOf } = require('./utils/privileges');

const client = new natUpnp.Client();

const FLUXADM_MAPPING_DESCRIPTION = 'Flux_Fluxadm_SSH';

// The descriptions this code gives the mappings it makes. Only these are ever
// swept: 'Flux_manual_entry' is the operator's own request through the API, and
// anything else on the router - the owner's own forwards, another program's, a
// description the router truncated - is not ours to judge.
const OWNED_MAPPING_DESCRIPTIONS = new Set([
  'Flux_Backend_API',
  'Flux_Backend_API_SSL',
  'Flux_Home_UI',
  'Flux_Syncthing',
  'Flux_UPNP_Mapping_Test',
  'Flux_Test_App',
  FLUXADM_MAPPING_DESCRIPTION,
]);
const OWNED_MAPPING_PREFIXES = ['Flux_App_', 'Flux_Prelaunch_App_'];
// The node's own api mappings: one of these left on the router to an address
// the node no longer has makes setupUPNP fail at its next start, and a node with
// a custom api port or a router IP then refuses to start at all.
const CORE_MAPPING_DESCRIPTIONS = new Set(['Flux_Backend_API', 'Flux_Backend_API_SSL', 'Flux_Home_UI', 'Flux_Syncthing']);

// A mapping is removed only once it has been stale on two sweeps at least this
// far apart. The test and prelaunch mappings live for seconds to minutes, and
// an app's ports are mapped after its record is written, so nothing in flight
// is old enough to be taken.
const STALE_MAPPING_MIN_AGE_MS = 30 * 60 * 1000;
// `${protocol}:${host}:${port}:${description}` -> first sweep it was seen stale (monotonic ms)
const staleMappingsSeen = new Map();
// port -> when mapUpnpPort last mapped it (monotonic ms), until removeMapUpnpPort
// unmaps it. A port mapped here that nobody has unmapped yet is in use - a test
// port mid-test, an app installing - whatever the app table says so far.
const recentlyMapped = new Map();
let sweeping = false;

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

if (config.upnp.gatewayUrl) {
  // eslint-disable-next-line global-require
  const { Device } = require('@runonflux/nat-upnp/build/src/nat-upnp/device');
  const { gatewayUrl } = config.upnp;
  const nodeIp = config.upnp.nodeIp || '127.0.0.1';
  client.getGateway = async () => ({
    gateway: new Device(gatewayUrl),
    address: nodeIp,
  });
}

let upnpMachine = false;

/**
 * To quickly check if node has UPnP (Universal Plug and Play) support.
 * @returns {boolean} True if port mappings can be set. Otherwise false.
 */
function isUPNP() {
  return upnpMachine;
}

/**
 * To adjust a firewall to allow comms between host and router.
 */
async function adjustFirewallForUPNP() {
  try {
    let { routerIP } = userconfig.initial;
    routerIP = serviceHelper.ensureString(routerIP);
    if (routerIP) {
      const firewallActive = await ufw.isFirewallActive();
      if (firewallActive) {
        // standard rules for upnp, then one pair per home node ws port
        const rules = [
          ['prepend', 'allow', 'from', routerIP, 'port', '1900', 'to', 'any', 'proto', 'udp'],
          ['prepend', 'allow', 'from', routerIP, 'to', 'any', 'proto', 'udp'],
          ...config.server.allowedPorts.flatMap((port) => [
            ['prepend', 'allow', 'in', 'proto', 'tcp', 'from', 'any', 'to', routerIP, 'port', String(port)],
            ['prepend', 'allow', 'in', 'proto', 'udp', 'from', 'any', 'to', routerIP, 'port', String(port)],
          ]),
        ];
        const { failed, locked } = await ufw.runUfwCommands(rules);
        if (locked) {
          log.error('Firewall not adjusted for UPNP: ufw is locked by another ufw command');
          return;
        }
        failed.forEach(({ rule, error }) => log.warn(`Firewall rule not applied for UPNP: ufw ${rule}: ${error}`));
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
 * To verify that a port has UPnP (Universal Plug and Play) support.
 * @param {number} apiport Port number.
 * @returns {Promise<boolean>} True if port mappings can be set. Otherwise false.
 */
async function verifyUPNPsupport(apiport = config.server.apiport) {
  try {
    if (userconfig.initial.routerIP) {
      await adjustFirewallForUPNP();
    }
    // run test on apiport + 1
    await client.getPublicIp();

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get public ip');
    upnpMachine = false;
    return false;
  }
  try {
    await client.getGateway();

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Gateway');
    upnpMachine = false;
    return false;
  }
  try {
    await client.createMapping({
      public: +apiport + 3,
      private: +apiport + 3,
      ttl: 0,
      description: 'Flux_UPNP_Mapping_Test',
    });

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed Create Mapping');
    upnpMachine = false;
    return false;
  }
  try {
    await client.getMappings();

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Mappings');
    upnpMachine = false;
    return false;
  }
  try {
    await client.removeMapping({
      public: +apiport + 3,
    });

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed Remove Mapping');
    upnpMachine = false;
    return false;
  }

  upnpMachine = true;
  return true;
}

/**
 * Maps the maintenance sshd's port (apiport - 5) while its socket is enabled -
 * the fluxadm reconcile enables it only once it has installed access - and
 * otherwise removes a mapping of that port only when this code made it, so a
 * node owner's own mapping of the same port keeps. ArcaneOS maps its own and
 * is never touched. A failure here is logged and never fails the core mapping
 * it runs beside.
 * @param {number|string} apiport
 * @returns {Promise<void>}
 */
async function reconcileFluxadmMapping(apiport) {
  if (fluxadmPort.isArcane) return;
  const port = fluxadmPort.sshPortFor(apiport);
  try {
    const { stdout: unitState } = await serviceHelper.runCommand('systemctl', {
      logError: false,
      params: ['is-enabled', fluxadmPort.sshdSocket],
    });
    if (serviceHelper.ensureString(unitState).trim() === 'enabled') {
      await client.createMapping({
        public: port,
        private: port,
        ttl: 0,
        description: FLUXADM_MAPPING_DESCRIPTION,
      });
      return;
    }
    const mappings = await client.getMappings();
    const ours = mappings.some((mapping) => mapping.local
      && mapping.public.port === port
      && mapping.description === FLUXADM_MAPPING_DESCRIPTION);
    if (ours) {
      await client.removeMapping({ public: port, protocol: 'TCP' });
      log.info(`fluxadm access - UPnP mapping for port ${port} removed`);
    }
  } catch (error) {
    log.error(`fluxadm access - UPnP mapping for port ${port} failed: ${error.message}`);
  }
}

/**
 * To set up UPnP (Universal Plug and Play) support.
 * @param {number} apiport Port number.
 * @returns {Promise<boolean>} True if port mappings can be set. Otherwise false.
 */
async function setupUPNP(apiport = config.server.apiport) {
  // a shutdown has released this node's mappings, and nothing may put them back
  if (globalState.shutdownInProgress) return false;
  try {
    await client.createMapping({
      public: +apiport,
      private: +apiport,
      ttl: 0, // Some routers force low ttl if 0, indefinite/default is used. Flux refreshes this every 6 blocks ~ 12 minutes
      description: 'Flux_Backend_API',
    });

    await serviceHelper.delay(500);

    await client.createMapping({
      public: +apiport + 1,
      private: +apiport + 1,
      ttl: 0, // Some routers force low ttl if 0, indefinite/default is used. Flux refreshes this every 6 blocks ~ 12 minutes
      description: 'Flux_Backend_API_SSL',
    });

    await serviceHelper.delay(500);

    await client.createMapping({
      public: +apiport - 1,
      private: +apiport - 1,
      ttl: 0,
      description: 'Flux_Home_UI',
    });

    await serviceHelper.delay(500);

    await client.createMapping({
      public: +apiport + 2,
      private: +apiport + 2,
      ttl: 0,
      description: 'Flux_Syncthing',
    });

    await serviceHelper.delay(500);

    await reconcileFluxadmMapping(apiport);

    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To create mappings for UPnP (Universal Plug and Play) port.
 * @param {number} port Port number.
 * @param {string} description Port description.
 * @returns {Promise<boolean>} True if port mappings can be created for both TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) protocols. Otherwise false.
 */
async function mapUpnpPort(port, description) {
  // a shutdown has released this node's mappings, and nothing may put them back
  if (globalState.shutdownInProgress) return false;
  try {
    await client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol: 'TCP',
      description,
    });

    await serviceHelper.delay(500);

    await client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol: 'UDP',
      description,
    });

    recentlyMapped.set(+port, monotonicMs());

    await serviceHelper.delay(500);

    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To remove TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) port mappings from UPnP (Universal Plug and Play) port.
 * @param {number} port Port number.
 * @returns {Promise<boolean>} True if port mappings have been removed for both TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) protocols. Otherwise false.
 */
async function removeMapUpnpPort(port) {
  // unmapped by intent even if the router refuses: what is left is the sweep's
  recentlyMapped.delete(+port);
  try {
    await client.removeMapping({
      public: port,
      protocol: 'TCP',
    });

    await serviceHelper.delay(500);

    await client.removeMapping({
      public: port,
      protocol: 'UDP',
    });

    await serviceHelper.delay(500);

    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Whether a mapping's description is one this code makes.
 * @param {string} description
 * @returns {boolean}
 */
function isOwnedMappingDescription(description) {
  if (typeof description !== 'string') return false;
  if (description === FLUXADM_MAPPING_DESCRIPTION && fluxadmPort.isArcane) return false;
  return OWNED_MAPPING_DESCRIPTIONS.has(description)
    || OWNED_MAPPING_PREFIXES.some((prefix) => description.startsWith(prefix));
}

/**
 * The ports FluxOS itself maps for an api port: the home UI, the api and its
 * SSL port, syncthing and the maintenance sshd.
 * @param {number|string} apiport
 * @returns {number[]}
 */
function corePorts(apiport) {
  return [+apiport - 1, +apiport, +apiport + 1, +apiport + 2, fluxadmPort.sshPortFor(apiport)];
}

/**
 * Removes the router's mappings to this node that this code made and nothing
 * here holds any more: an app removed while the router was unreachable, a
 * FluxOS that died between mapping and unmapping, a node reinstalled on the
 * same address without the apps it ran, an api port that moved. They are made
 * with an indefinite lease (or the router's longest, a week under IGDv2), so
 * nothing else ever takes them, and home routers hold only so many.
 *
 * Only mappings to this node's own address are looked at - several nodes behind
 * one router is an ordinary setup - and only those with a description this code
 * gives. Each is removed on the first sweep that finds it stale at least
 * STALE_MAPPING_MIN_AGE_MS after an earlier sweep first did, and never while
 * mapUpnpPort holds it.
 *
 * What is held is asked for only after the router has been listed: an app's
 * record is written before its ports are mapped, so every mapping the listing
 * holds already has its app in the answer.
 * @param {function(): Promise<Iterable<number>>} heldPorts every port something on this node holds
 * @returns {Promise<number>} how many mappings were removed
 */
async function removeStaleMappings(heldPorts) {
  if (sweeping) return 0;
  sweeping = true;
  try {
    const mappings = await client.getMappings({ local: true });
    const keep = new Set([...await heldPorts()].map(Number));
    const now = monotonicMs();
    const staleNow = new Set();
    let removed = 0;
    // eslint-disable-next-line no-restricted-syntax
    for (const mapping of mappings) {
      const port = mapping.public && mapping.public.port;
      // eslint-disable-next-line no-continue
      if (!mapping.local || !Number.isInteger(port) || keep.has(port) || !isOwnedMappingDescription(mapping.description)) continue;
      const key = `${mapping.protocol}:${mapping.public.host}:${port}:${mapping.description}`;
      staleNow.add(key);
      const firstSeen = staleMappingsSeen.get(key);
      if (firstSeen === undefined) {
        staleMappingsSeen.set(key, now);
        // eslint-disable-next-line no-continue
        continue;
      }
      // read at the moment of removal: a test or an install can map the port
      // while this sweep is still working through the ones before it
      const mappedAt = recentlyMapped.get(port);
      // eslint-disable-next-line no-continue
      if (now - firstSeen < STALE_MAPPING_MIN_AGE_MS || (mappedAt !== undefined && monotonicMs() - mappedAt < STALE_MAPPING_MIN_AGE_MS)) continue;
      const protocol = mapping.protocol.toUpperCase();
      try {
        // eslint-disable-next-line no-await-in-loop
        await client.removeMapping({ public: { host: mapping.public.host, port }, protocol });
        removed += 1;
        staleNow.delete(key);
        log.info(`UPnP - stale mapping removed: ${protocol} ${port} (${mapping.description})`);
      } catch (error) {
        log.warn(`UPnP - stale mapping ${protocol} ${port} (${mapping.description}) not removed: ${error.message}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
    }
    // what is no longer stale, or no longer there, starts over if it comes back
    [...staleMappingsSeen.keys()].filter((key) => !staleNow.has(key)).forEach((key) => staleMappingsSeen.delete(key));
    return removed;
  } finally {
    sweeping = false;
  }
}

/**
 * Settles with `work`, or once `deadline` (monotonic ms) has passed, whichever
 * comes first. A router that stops answering leaves its call behind: the
 * caller is on its way out.
 * @param {Promise<void>} work
 * @param {number} deadline
 * @returns {Promise<void>}
 */
async function settleBefore(work, deadline) {
  let timer;
  const expired = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - monotonicMs())); });
  try {
    await Promise.race([work.catch((error) => log.warn(`UPnP - mappings not released: ${error.message}`)), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Removes the given mappings, one after the other, until `deadline` passes.
 * @param {object[]} mappings as getMappings lists them
 * @param {number} deadline monotonic ms
 * @param {{removed: number}} tally counted as each one goes, so a deadline
 *   that cuts the work short still reports what was done
 * @returns {Promise<void>}
 */
async function removeMappingsBefore(mappings, deadline, tally) {
  // eslint-disable-next-line no-restricted-syntax
  for (const mapping of mappings) {
    if (monotonicMs() >= deadline) return;
    const { host, port } = mapping.public;
    const protocol = mapping.protocol.toUpperCase();
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.removeMapping({ public: { host, port }, protocol });
      // eslint-disable-next-line no-param-reassign
      tally.removed += 1;
    } catch (error) {
      log.warn(`UPnP - mapping ${protocol} ${port} (${mapping.description}) not released: ${error.message}`);
    }
  }
}

/**
 * On a system shutdown or reboot: removes every mapping to this node that this
 * code made, the app containers being stopped already. A node that never comes
 * back would otherwise leave them on the router for good, and one that comes
 * back on another address finds them in the way of its own - neither of which
 * the sweep can reach. The node's own api mappings go first. Mappings on `holdPorts` are left and handed back, for a
 * service still at work to be released with removeMappingsWithin once done.
 *
 * Never rejects, and settles within `timeoutMs` whatever the router does.
 * @param {number[]} holdPorts
 * @param {number} timeoutMs
 * @returns {Promise<{removed: number, held: object[]}>}
 */
async function releaseOwnMappings(holdPorts, timeoutMs) {
  const deadline = monotonicMs() + timeoutMs;
  const hold = new Set(holdPorts.map(Number));
  const result = { removed: 0, held: [] };
  const work = (async () => {
    const mappings = await client.getMappings({ local: true });
    const ours = mappings.filter((mapping) => mapping.local
      && Number.isInteger(mapping.public && mapping.public.port)
      && isOwnedMappingDescription(mapping.description));
    result.held = ours.filter((mapping) => hold.has(mapping.public.port));
    // the core ones first: a deadline that cuts the work short must not leave
    // behind the one kind that keeps the node from starting again
    const isCore = (mapping) => CORE_MAPPING_DESCRIPTIONS.has(mapping.description);
    const release = ours.filter((mapping) => !hold.has(mapping.public.port));
    await removeMappingsBefore([...release.filter(isCore), ...release.filter((mapping) => !isCore(mapping))], deadline, result);
  })();
  await settleBefore(work, deadline);
  log.info(`UPnP - ${result.removed} mapping(s) released for the shutdown`);
  return result;
}

/**
 * Removes the given mappings within `timeoutMs`. Never rejects.
 * @param {object[]} mappings as releaseOwnMappings hands them back
 * @param {number} timeoutMs
 * @returns {Promise<number>} how many were removed
 */
async function removeMappingsWithin(mappings, timeoutMs) {
  if (!mappings.length) return 0;
  const deadline = monotonicMs() + timeoutMs;
  const tally = { removed: 0 };
  await settleBefore(removeMappingsBefore(mappings, deadline, tally), deadline);
  return tally.removed;
}

/**
 * To map a specified port and show a message if successfully mapped. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {Promise<object>} res Response.
 */
async function mapPortApi(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
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
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
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
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
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
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
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
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
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
  setupUPNP,
  mapUpnpPort,
  removeMapUpnpPort,
  corePorts,
  removeStaleMappings,
  releaseOwnMappings,
  removeMappingsWithin,
  staleMappingsSeen,
  recentlyMapped,
  mapPortApi,
  removeMapPortApi,
  getMapApi,
  getIpApi,
  getGatewayApi,
  adjustFirewallForUPNP,
};
