const config = require('config');
const natUpnp = require('@runonflux/nat-upnp');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
// eslint-disable-next-line import/no-extraneous-dependencies

const log = require('../lib/log');
const ufw = require('./utils/ufw');
const fluxadmPort = require('./fluxadmPort');
const { Privilege, authOf } = require('./utils/privileges');

// config.upnp.gatewayUrl names the router's device description, used in place
// of discovering the router; the node's address is then config.upnp.nodeIp.
// A discovered router is kept between calls, and found again when it stops
// answering where it was.
const client = config.upnp.gatewayUrl
  ? new natUpnp.Client({ url: config.upnp.gatewayUrl, localAddress: config.upnp.nodeIp || '127.0.0.1' })
  : new natUpnp.Client({ cacheGateway: true });

const FLUXADM_MAPPING_DESCRIPTION = 'Flux_Fluxadm_SSH';

// The descriptions this code gives the mappings it makes. Only these are ever
// cleaned up: 'Flux_manual_entry' is the operator's own request through the
// API, and anything else on the router - the owner's own forwards, another
// program's, a description the router truncated - is not ours to judge.
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
// Ports mapUpnpPort has mapped and removeMapUpnpPort has not given up since. A
// port mapped here is in use - a test port mid-test, an app installing -
// whatever the app table says so far.
const mappedHere = new Set();
// The cleanup pass runs in a wall-clock slot of its own, laid out as #1710 laid
// out its refresh: a 10-minute cycle of eight 75-second slots, the slot chosen
// by the api port's tens digit. Nodes behind one public address have distinct
// api ports (16127, 16137 ... 16197), so siblings behind one router never list
// its table at the same time.
const CLEANUP_CYCLE_MS = 10 * 60 * 1000;
const CLEANUP_SLOT_COUNT = 8;
const CLEANUP_SLOT_MS = CLEANUP_CYCLE_MS / CLEANUP_SLOT_COUNT;
// The listing has to finish this long before the slot ends, so that what it
// lists still has time to be removed.
const CLEANUP_REMOVAL_RESERVE_MS = 15 * 1000;

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

// The router's answers this code acts on: a full table, and no such entry.
const NO_PORT_MAPS_AVAILABLE = 728;
const NO_SUCH_ENTRY = 714;

// What a test leaves on the router while it runs and removes before it ends.
const TEST_MAPPING_DESCRIPTIONS = new Set(['Flux_UPNP_Mapping_Test', 'Flux_Test_App']);
const TEST_MAPPING_PREFIX = 'Flux_Prelaunch_App_';

const MAPPED = Object.freeze({
  mapped: true, code: null, reason: null, routerWide: false,
});

let routerRefusalCount = 0;

/**
 * How many mappings the router has refused since FluxOS started for a reason
 * that is the router's own and not the port's: a full table, or no answer. A
 * port another machine holds (718) and every other refusal are the port's.
 * Only ever goes up.
 * @returns {number}
 */
function routerRefusals() {
  return routerRefusalCount;
}

/**
 * Whether the router maps `port` to this node, port for port, enabled.
 * @param {object|null} mapping the router's entry for the port, as client.getMapping reads it
 * @param {number} port
 * @returns {boolean}
 */
function mapsHere(mapping, port) {
  return mapping !== null && mapping.local === true && mapping.enabled && mapping.private.port === port;
}

/**
 * Maps one protocol of a port to this node, port for port, with no lease
 * (some routers force a short one instead; the mappings are refreshed every
 * restore). A refusal is no failure when the router already maps the port
 * here: some routers refuse to add an entry they hold, and a full table
 * refuses everything, the refresh of a working mapping included. A router
 * that does not answer is not asked again.
 * @param {number} port
 * @param {string} protocol 'TCP' or 'UDP'
 * @param {string} description
 * @returns {Promise<{mapped: boolean, code: number|null, reason: string|null, routerWide: boolean}>}
 *   `code` is the router's UPnP error code, null when it gave none; `routerWide`
 *   whether the refusal counts in routerRefusals.
 */
async function mapProtocol(port, protocol, description) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      mapped: false, code: null, reason: `${protocol} ${port} not mapped: not a port`, routerWide: false,
    };
  }
  try {
    await client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol,
      description,
    });
    return MAPPED;
  } catch (error) {
    const answered = error instanceof natUpnp.UpnpError;
    if (answered) {
      const held = await client.getMapping({ public: port, protocol }).catch(() => null);
      if (mapsHere(held, port)) {
        log.info(`UPnP - ${protocol} ${port} refused (${error.message}), but the router already maps it to this node`);
        return MAPPED;
      }
    }
    const code = answered ? error.code : null;
    const routerWide = !answered || code === NO_PORT_MAPS_AVAILABLE;
    if (routerWide) routerRefusalCount += 1;
    return {
      mapped: false, code, reason: `${protocol} ${port} not mapped: ${error.message}`, routerWide,
    };
  }
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
  // held while the test runs: a cleanup pass taking it between the create and
  // the remove would fail the verify, and a node with a custom api port or a
  // router IP exits on that. A test that fails leaves it held.
  mappedHere.add(+apiport + 3);
  let testMapping = await mapProtocol(+apiport + 3, 'TCP', 'Flux_UPNP_Mapping_Test');
  // a full table: until UPnP is verified the stale mapping cleanup never runs,
  // so the test mappings earlier runs left are removed here to make room
  if (testMapping.code === NO_PORT_MAPS_AVAILABLE) {
    let removed = 0;
    try {
      removed = await removeLeftoverTestMappings();
    } catch (error) {
      log.warn(`VerifyUPNPsupport - left-over test mappings not removed: ${error.message}`);
    }
    if (removed > 0) testMapping = await mapProtocol(+apiport + 3, 'TCP', 'Flux_UPNP_Mapping_Test');
  }
  if (!testMapping.mapped) {
    log.error(`VerifyUPNPsupport - Failed Create Mapping: ${testMapping.reason}`);
    upnpMachine = false;
    return false;
  }
  await serviceHelper.delay(500);
  try {
    const mapping = await client.getMapping({ public: +apiport + 3, protocol: 'TCP' });
    if (!mapping) throw new Error(`the router holds no mapping for port ${+apiport + 3}`);

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Mapping');
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
  mappedHere.delete(+apiport + 3);

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
    const mapping = await client.getMapping({ public: port, protocol: 'TCP' });
    const ours = mapping !== null
      && mapping.local === true
      && mapping.description === FLUXADM_MAPPING_DESCRIPTION;
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
  try {
    const corePortMappings = [
      [+apiport, 'Flux_Backend_API'],
      [+apiport + 1, 'Flux_Backend_API_SSL'],
      [+apiport - 1, 'Flux_Home_UI'],
      [+apiport + 2, 'Flux_Syncthing'],
    ];
    // eslint-disable-next-line no-restricted-syntax
    for (const [port, description] of corePortMappings) {
      // eslint-disable-next-line no-await-in-loop
      const result = await mapProtocol(port, 'TCP', description);
      if (!result.mapped) {
        log.error(`setupUPNP - ${result.reason}`);
        return false;
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(500);
    }

    await reconcileFluxadmMapping(apiport);

    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * Maps a port to this node over TCP and then UDP.
 *
 * On a failure the port is no longer held here: a TCP half the router kept is
 * the caller's to remove with removeMapUpnpPort, or the stale mapping
 * cleanup's.
 * @param {number} port Port number.
 * @param {string} description Port description.
 * @returns {Promise<{mapped: boolean, code: number|null, reason: string|null, routerWide: boolean}>}
 *   the first refusal, as mapProtocol gives it; mapped when both protocols are
 */
async function mapUpnpPort(port, description) {
  // held from before the router has it: the cleanup pass may list it the
  // moment it is there
  mappedHere.add(+port);
  let result = await mapProtocol(+port, 'TCP', description);
  if (result.mapped) {
    await serviceHelper.delay(500);
    result = await mapProtocol(+port, 'UDP', description);
  }
  if (!result.mapped) {
    log.error(`UPnP - ${result.reason}`);
    mappedHere.delete(+port);
    return result;
  }
  await serviceHelper.delay(500);
  return result;
}

/**
 * Removes the router's mapping of one protocol of a port when it points at
 * this node. A router removes a mapping by its external port alone, whoever it
 * points at, so the entry is looked up first: one pointing at another machine
 * - another node behind the same router holding that port - is left, and one
 * the router does not hold is gone already. An entry that cannot be looked up
 * is removed.
 * @param {number} port
 * @param {string} protocol 'TCP' or 'UDP'
 * @returns {Promise<boolean>} whether no mapping of it to this node is left
 */
async function removeProtocol(port, protocol) {
  let held;
  try {
    held = await client.getMapping({ public: port, protocol });
  } catch (error) {
    log.warn(`UPnP - ${protocol} ${port} not looked up, removing it: ${error.message}`);
  }
  if (held === null) return true;
  if (held && held.local === false) {
    log.info(`UPnP - ${protocol} ${port} left mapped: the router maps it to ${held.private.host}`);
    return true;
  }
  try {
    await client.removeMapping({ public: port, protocol });
    return true;
  } catch (error) {
    if (error instanceof natUpnp.UpnpError && error.code === NO_SUCH_ENTRY) return true;
    log.error(`UPnP - ${protocol} ${port} not unmapped: ${error.message}`);
    return false;
  }
}

/**
 * Removes the TCP and the UDP mapping of a port to this node, each on its own:
 * a refusal of one leaves the other to go.
 * @param {number} port Port number.
 * @returns {Promise<boolean>} whether no mapping of the port to this node is left
 */
async function removeMapUpnpPort(port) {
  // given up even if the router refuses: what is left is the cleanup pass's
  mappedHere.delete(+port);
  const tcpRemoved = await removeProtocol(+port, 'TCP');
  await serviceHelper.delay(500);
  const udpRemoved = await removeProtocol(+port, 'UDP');
  await serviceHelper.delay(500);
  return tcpRemoved && udpRemoved;
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
 * Whether a mapping's description is a test's.
 * @param {string} description
 * @returns {boolean}
 */
function isTestMappingDescription(description) {
  return typeof description === 'string'
    && (TEST_MAPPING_DESCRIPTIONS.has(description) || description.startsWith(TEST_MAPPING_PREFIX));
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
 * Milliseconds until the next start of this node's cleanup slot.
 * @param {number|string} apiport the api port this FluxOS listens on
 * @param {number} [now] wall-clock ms
 * @returns {number}
 */
function msUntilCleanupSlot(apiport, now = Date.now()) {
  const slotStart = (Math.floor((+apiport % 100) / 10) % CLEANUP_SLOT_COUNT) * CLEANUP_SLOT_MS;
  return (slotStart - (now % CLEANUP_CYCLE_MS) + CLEANUP_CYCLE_MS) % CLEANUP_CYCLE_MS;
}

/**
 * Removes the router's mappings to this node that `select` picks from them.
 *
 * One listing, of the mappings to this node's own address only - several
 * nodes behind one router is an ordinary setup. A port mapUpnpPort has mapped
 * since FluxOS started, or maps while this runs, is never removed.
 *
 * Everything - the listing and each removal - happens within `budgetMs`. The
 * listing has to finish early enough to leave time for removals, or nothing is
 * removed; what has not been removed by the end is left for the next start. A
 * removal the router refuses with a UPnP error is stepped past; any other
 * failure - no answer in time, a connection refused or reset - ends the pass,
 * so as not to send more to a router that is not keeping up.
 * @param {function(object[]): (object[]|Promise<object[]>)} select the mappings to remove, from the listing
 * @param {number} budgetMs
 * @param {string} what the mappings' name in the log
 * @returns {Promise<number>} how many mappings were removed
 */
async function removeOwnMappings(select, budgetMs, what) {
  const deadline = monotonicMs() + budgetMs;
  const left = () => deadline - monotonicMs();
  const listingMs = budgetMs - Math.min(CLEANUP_REMOVAL_RESERVE_MS, budgetMs / 2);
  const mappings = await client.getMappings({ local: true, signal: AbortSignal.timeout(listingMs) });
  const chosen = (await select(mappings)).filter((mapping) => Number.isInteger(mapping.public.port));
  let removed = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const [index, mapping] of chosen.entries()) {
    if (left() <= 0) {
      log.warn(`UPnP - ${what} cleanup out of time, ${chosen.length - index} left for the next start`);
      break;
    }
    const { host, port } = mapping.public;
    // read at the moment of removal: a test or an install can map the port
    // while this pass is still working through the ones before it
    // eslint-disable-next-line no-continue
    if (mappedHere.has(port)) continue;
    const protocol = mapping.protocol.toUpperCase();
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.removeMapping({ public: { host, port }, protocol, signal: AbortSignal.timeout(left()) });
      removed += 1;
      log.info(`UPnP - ${what} removed: ${protocol} ${port} (${mapping.description})`);
    } catch (error) {
      log.warn(`UPnP - ${what} ${protocol} ${port} (${mapping.description}) not removed: ${error.message}`);
      if (!(error instanceof natUpnp.UpnpError)) {
        log.warn(`UPnP - ${what} cleanup stopped, ${chosen.length - index - 1} left for the next start`);
        break;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }
  return removed;
}

/**
 * Removes the router's mappings to this node that this code made and nothing
 * here holds any more: an app removed while the router was unreachable, a
 * FluxOS that died between mapping and unmapping, a node reinstalled on the
 * same address without the apps it ran, an api port that moved. They are made
 * with an indefinite lease (or the router's longest, a week under IGDv2), so
 * nothing else ever takes them, and home routers hold only so many.
 *
 * Only those with a description this code gives, on a port nothing here
 * holds. What is held is asked for only after the router has been listed: an
 * app's record is written before its ports are mapped, so every mapping the
 * listing holds already has its app in the answer.
 * @param {function(): Promise<Iterable<number>>} heldPorts every port something on this node holds
 * @param {number} budgetMs
 * @returns {Promise<number>} how many mappings were removed
 */
async function removeStaleMappings(heldPorts, budgetMs) {
  return removeOwnMappings(async (mappings) => {
    const keep = new Set([...await heldPorts()].map(Number));
    return mappings.filter((mapping) => !keep.has(mapping.public.port)
      && isOwnedMappingDescription(mapping.description));
  }, budgetMs, 'stale mapping');
}

/**
 * Removes the router's test mappings to this node: a port test's, an app's
 * prelaunch test's and verifyUPNPsupport's. A test removes its mapping before
 * it ends, so while UPnP is being verified at the start of FluxOS every one the
 * router holds was left by an earlier run.
 * @returns {Promise<number>} how many mappings were removed
 */
async function removeLeftoverTestMappings() {
  return removeOwnMappings(
    (mappings) => mappings.filter((mapping) => isTestMappingDescription(mapping.description)),
    CLEANUP_SLOT_MS,
    'left-over test mapping',
  );
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
      const info = await client.getGateway();
      const { description, services } = info.gateway;
      const message = messageHelper.createDataMessage({
        gateway: { description, services },
        address: await info.getLocalAddress(),
      });
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
  routerRefusals,
  corePorts,
  msUntilCleanupSlot,
  removeStaleMappings,
  mappedHere,
  CLEANUP_SLOT_MS,
  mapPortApi,
  removeMapPortApi,
  getMapApi,
  getIpApi,
  getGatewayApi,
  adjustFirewallForUPNP,
};
