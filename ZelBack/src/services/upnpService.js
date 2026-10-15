const http = require('http');
const config = require('config');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const natUpnp = require('@runonflux/nat-upnp');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
// eslint-disable-next-line import/no-extraneous-dependencies

const log = require('../lib/log');
const ufw = require('./utils/ufw');
const fluxadmPort = require('./fluxadmPort');
const { Privilege, authOf } = require('./utils/privileges');

// @runonflux/nat-upnp 2.x answers single-mapping lookups itself, takes a
// gateway url of its own and finds the local address itself; 1.x has none of
// that. What differs between the two is kept to this file.
const LIBRARY_V2 = typeof natUpnp.Client.prototype.getMapping === 'function';
const { gatewayUrl } = config.upnp;
const gatewayNodeIp = config.upnp.nodeIp || '127.0.0.1';
const client = gatewayUrl && LIBRARY_V2
  ? new natUpnp.Client({ url: gatewayUrl, localAddress: gatewayNodeIp })
  : new natUpnp.Client();

// nat-upnp 1.x fetches the router's device description before every action,
// through the global http agent, which keeps sockets alive since Node 19.
// Routers close those sockets without saying so, so an action sent moments
// after another reuses a dead socket and fails at once. The library then hands
// the Error on as if it were the description, and the action throws "Cannot
// read properties of undefined (reading 'device')", with the cause gone: the
// stale mapping cleanup, which lists the table one entry after another, died
// at its second entry. This is that one fetch, on a socket of its own, failing
// with its own reason. 2.x does both itself, and has no getXML to replace.
if (!LIBRARY_V2 && typeof natUpnp.Device.prototype.getXML === 'function') {
  const descriptionAgent = new http.Agent({ keepAlive: false });
  natUpnp.Device.prototype.getXML = async function getXML(url) {
    let data;
    try {
      ({ data } = await axios.get(url, { httpAgent: descriptionAgent, timeout: 10 * 1000, responseType: 'text' }));
    } catch (error) {
      throw new Error(`UPnP - the router's device description at ${url} could not be read: ${error.message}`);
    }
    const parsed = new XMLParser().parse(data);
    if (!parsed || !parsed.root) throw new Error(`UPnP - ${url} is not a UPnP device description`);
    return parsed;
  };
}

// A router's own answer to a request: 713/714 past the end of the table or for
// a mapping it does not have (402 on some), 718 a port another machine holds,
// 728 a full table.
const UPNP_NO_SUCH_ENTRY = [713, 714];
const UPNP_END_OF_TABLE = [402, 713, 714];

/**
 * The UPnP error code of a router's refusal. 2.x throws it as `code`; 1.x
 * leaves it in the SOAP fault of the reply. Null when the failure carried
 * none: no reply at all, or a reply without a fault.
 * @param {Error} error
 * @returns {number|null}
 */
function upnpErrorCode(error) {
  if (!error) return null;
  if (Number.isInteger(error.code) && error.code > 0) return error.code;
  const body = error.response && typeof error.response.data === 'string' ? error.response.data : '';
  const match = body.match(/<(?:\w+:)?errorCode>\s*(\d+)\s*</i);
  return match ? Number(match[1]) : null;
}

/**
 * A router's refusal as a log line can carry it. 1.x's own message is only the
 * HTTP status, the same 500 for a full table as for a taken port.
 * @param {Error} error
 * @returns {string}
 */
function describeUpnpError(error) {
  if (!error) return String(error);
  const body = error.response && typeof error.response.data === 'string' ? error.response.data : '';
  const code = body ? upnpErrorCode(error) : null;
  if (code === null) return error.message || String(error);
  const text = body.match(/<(?:\w+:)?errorDescription>([^<]*)</i);
  return `UPnP error ${code}${text && text[1].trim() ? ` ${text[1].trim()}` : ''} (HTTP ${error.response.status})`;
}

/** A field of a router's reply as text; 2.x's parser can wrap one in an object. */
const fieldText = (value) => String(value !== null && typeof value === 'object' && '#text' in value ? value['#text'] : value ?? '');

/**
 * The gateway and the address this node has on its network, from either
 * major version: 1.x hands the address over, 2.x is asked for it.
 * @returns {Promise<{gateway: object, address: string}>}
 */
async function gatewayAndAddress() {
  const info = await client.getGateway();
  const address = info.address !== undefined ? info.address : await info.getLocalAddress();
  return { gateway: info.gateway, address };
}

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
// The library's requests have no timeout of their own: a router that restarts
// with one in flight never answers it.
const CLEANUP_REQUEST_TIMEOUT_MS = 15 * 1000;
// The listing stops asking this long before the slot ends, so that what it has
// listed by then still has time to be removed.
const CLEANUP_REMOVAL_RESERVE_MS = 15 * 1000;

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

/**
 * Settles with `work`, or rejects once `timeoutMs` has passed, with an error
 * marked `timedOut`. Only the wait ends: the request is still in flight.
 * @param {Promise<*>} work
 * @param {number} timeoutMs
 * @param {string} what what is waited for, for the error
 * @returns {Promise<*>}
 */
async function withinTime(work, timeoutMs, what) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${what}: the router did not answer within ${timeoutMs / 1000}s`);
          error.timedOut = true;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

if (gatewayUrl && !LIBRARY_V2) {
  client.getGateway = async () => ({
    gateway: new natUpnp.Device(gatewayUrl),
    address: gatewayNodeIp,
  });
}

// Every request this file sends the router itself. The library sets no timeout
// on its own requests: a router that takes a connection and never answers
// would hold an install, the port restore or the availability test forever.
const ROUTER_REQUEST_TIMEOUT_MS = 15 * 1000;
const toRouter = (work, what) => withinTime(work, ROUTER_REQUEST_TIMEOUT_MS, what);

/**
 * Who the router maps `port` over `protocol` to: 'here' (this node, port for
 * port, enabled), 'disabled' (this node, but switched off), 'other' (another
 * machine on the network - another Flux node behind the same router, the
 * owner's own forward), 'none', or 'unknown' when the router could not be asked.
 * @param {number} port
 * @param {string} protocol 'TCP' or 'UDP'
 * @returns {Promise<string>}
 */
async function mappingOwner(port, protocol) {
  try {
    const { gateway, address } = await toRouter(gatewayAndAddress(), 'finding the gateway');
    const data = await toRouter(gateway.run('GetSpecificPortMappingEntry', [
      ['NewRemoteHost', ''],
      ['NewExternalPort', String(port)],
      ['NewProtocol', protocol],
    ]), `reading the ${protocol} ${port} mapping`);
    const key = Object.keys(data || {}).find((k) => /^GetSpecificPortMappingEntryResponse/.test(k));
    if (!key) return 'unknown';
    const entry = data[key];
    if (fieldText(entry.NewInternalClient) !== address || parseInt(fieldText(entry.NewInternalPort), 10) !== +port) return 'other';
    return fieldText(entry.NewEnabled) === '0' ? 'disabled' : 'here';
  } catch (error) {
    return UPNP_NO_SUCH_ENTRY.includes(upnpErrorCode(error)) ? 'none' : 'unknown';
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

// What a FluxOS start leaves on the router and nothing at a start holds: the
// mappings of a port test, of an app's prelaunch test and of this check itself.
const TEST_MAPPING_DESCRIPTIONS = ['Flux_UPNP_Mapping_Test', 'Flux_Test_App'];
const TEST_MAPPING_PREFIX = 'Flux_Prelaunch_App_';

/**
 * Removes the test mappings to this node that nothing here holds. Run when the
 * router refuses this check's own mapping: on a router whose table is full the
 * check fails on every start, a node on a custom api port shuts down on it, and
 * the stale mapping cleanup, which runs later, is never reached. Test mappings
 * are only ever made and removed by a test in progress, so at a start every
 * one there is left over.
 * @returns {Promise<number>} how many were removed
 */
async function removeLeftoverTestMappings() {
  const deadline = monotonicMs() + CLEANUP_SLOT_MS;
  let mappings;
  try {
    mappings = await listOwnMappings(deadline - CLEANUP_REMOVAL_RESERVE_MS, deadline);
  } catch (error) {
    log.warn(`VerifyUPNPsupport - mappings not listed: ${describeUpnpError(error)}`);
    return 0;
  }
  const leftovers = mappings.filter(({ description, public: { port } }) => typeof description === 'string'
    && (TEST_MAPPING_DESCRIPTIONS.includes(description) || description.startsWith(TEST_MAPPING_PREFIX))
    && !mappedHere.has(port));
  let removed = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const { public: { host, port }, protocol, description } of leftovers) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await toRouter(client.removeMapping({ public: { host, port }, protocol: protocol.toUpperCase() }), 'removing a test mapping');
      removed += 1;
      log.info(`VerifyUPNPsupport - left-over test mapping removed: ${protocol.toUpperCase()} ${port} (${description})`);
    } catch (error) {
      log.warn(`VerifyUPNPsupport - left-over test mapping ${protocol.toUpperCase()} ${port} not removed: ${describeUpnpError(error)}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }
  return removed;
}

/**
 * This check's own mapping. When the router refuses it: one an earlier start
 * left is this node's already, and the removal that follows ends it; else the
 * test mappings earlier starts left are removed to make room, and it is asked
 * once more.
 * @param {number} port
 * @returns {Promise<void>}
 */
async function createVerifyMapping(port) {
  const mapping = {
    public: port,
    private: port,
    ttl: 0,
    description: 'Flux_UPNP_Mapping_Test',
  };
  try {
    await toRouter(client.createMapping(mapping), 'creating the test mapping');
  } catch (error) {
    log.warn(`VerifyUPNPsupport - test mapping refused: ${describeUpnpError(error)}`);
    await serviceHelper.delay(500);
    if (await mappingOwner(port, 'TCP') === 'here') return;
    if (!await removeLeftoverTestMappings()) throw error;
    await toRouter(client.createMapping(mapping), 'creating the test mapping');
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
    log.error(`VerifyUPNPsupport - Failed get public ip: ${describeUpnpError(error)}`);
    upnpMachine = false;
    return false;
  }
  try {
    await client.getGateway();

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(`VerifyUPNPsupport - Failed get Gateway: ${describeUpnpError(error)}`);
    upnpMachine = false;
    return false;
  }
  // held while the test runs: a cleanup pass taking it between the create and
  // the remove would fail the verify, and a node with a custom api port or a
  // router IP exits on that. A test that fails leaves it held.
  mappedHere.add(+apiport + 3);
  try {
    await createVerifyMapping(+apiport + 3);

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(`VerifyUPNPsupport - Failed Create Mapping: ${describeUpnpError(error)}`);
    upnpMachine = false;
    return false;
  }
  try {
    await client.getMappings();

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(`VerifyUPNPsupport - Failed get Mappings: ${describeUpnpError(error)}`);
    upnpMachine = false;
    return false;
  }
  try {
    await client.removeMapping({
      public: +apiport + 3,
    });

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(`VerifyUPNPsupport - Failed Remove Mapping: ${describeUpnpError(error)}`);
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
  try {
    await mapCorePort(+apiport, 'Flux_Backend_API');

    await serviceHelper.delay(500);

    await mapCorePort(+apiport + 1, 'Flux_Backend_API_SSL');

    await serviceHelper.delay(500);

    await mapCorePort(+apiport - 1, 'Flux_Home_UI');

    await serviceHelper.delay(500);

    await mapCorePort(+apiport + 2, 'Flux_Syncthing');

    await serviceHelper.delay(500);

    await reconcileFluxadmMapping(apiport);

    return true;
  } catch (error) {
    log.error(`setupUPNP - ${describeUpnpError(error)}`);
    return false;
  }
}

// Why the router refused each port's last refused mapping, for an install to report.
const mapFailureReasons = new Map();

/**
 * Why the router refused the last mapping of `port`, as mapUpnpPort logged it.
 * @param {number} port
 * @returns {string}
 */
function getMapFailureReason(port) {
  return mapFailureReasons.get(+port) || '';
}

/**
 * Maps one protocol of a port. A refusal is no failure when the router already
 * maps the port here: some routers refuse to add an entry that exists, and a
 * full table refuses everything, the refresh of a mapping that works included.
 * @param {number} port
 * @param {string} protocol
 * @param {string} description
 * @returns {Promise<void>}
 */
async function mapProtocol(port, protocol, description) {
  try {
    await toRouter(client.createMapping({
      public: port,
      private: port,
      ttl: 0,
      protocol,
      description,
    }), `mapping ${protocol} ${port}`);
  } catch (error) {
    const reason = describeUpnpError(error);
    await serviceHelper.delay(500);
    if (await mappingOwner(port, protocol) === 'here') {
      log.info(`UPnP - ${protocol} ${port} refused (${reason}), but the router already maps it to this node`);
      return;
    }
    throw new Error(`UPnP - ${protocol} ${port} not mapped: ${reason}`);
  }
}

/**
 * Maps one of FluxOS's own ports, TCP: the api, its SSL port, the home UI,
 * syncthing. One the router already maps here is mapped.
 * @param {number} port
 * @param {string} description
 * @returns {Promise<void>}
 */
async function mapCorePort(port, description) {
  try {
    await toRouter(client.createMapping({
      public: port,
      private: port,
      ttl: 0, // Some routers force low ttl if 0, indefinite/default is used. Flux refreshes this every 6 blocks ~ 12 minutes
      description,
    }), `mapping ${port}`);
  } catch (error) {
    await serviceHelper.delay(500);
    if (await mappingOwner(port, 'TCP') !== 'here') throw error;
    log.info(`setupUPNP - ${port} refused (${describeUpnpError(error)}), but the router already maps it to this node`);
  }
}

/**
 * To create mappings for UPnP (Universal Plug and Play) port.
 *
 * On a failure the port is no longer held here: whatever half of it the router
 * kept is the caller's to remove, or the stale mapping cleanup's.
 * @param {number} port Port number.
 * @param {string} description Port description.
 * @returns {Promise<boolean>} True if port mappings can be created for both TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) protocols. Otherwise false.
 */
async function mapUpnpPort(port, description) {
  // held from before the router has it: the cleanup pass may list it the
  // moment it is there
  mappedHere.add(+port);
  mapFailureReasons.delete(+port);
  try {
    await mapProtocol(port, 'TCP', description);

    await serviceHelper.delay(500);

    await mapProtocol(port, 'UDP', description);

    await serviceHelper.delay(500);

    return true;
  } catch (error) {
    log.error(error.message);
    mapFailureReasons.set(+port, error.message);
    mappedHere.delete(+port);
    return false;
  }
}

/**
 * To remove TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) port mappings from UPnP (Universal Plug and Play) port.
 *
 * A router removes a mapping by port alone, whoever it points at, so each
 * protocol is looked up first: one that points at another machine - another
 * Flux node behind the same router, whose port this node failed to map - is
 * left alone, one the router does not have is skipped. Each protocol is
 * removed on its own, a refusal of one leaving the other to go.
 * @param {number} port Port number.
 * @returns {Promise<boolean>} True if port mappings have been removed for both TCP (Transmission Control Protocol) and UDP (User Datagram Protocol) protocols. Otherwise false.
 */
async function removeMapUpnpPort(port) {
  // given up even if the router refuses: what is left is the cleanup pass's
  mappedHere.delete(+port);
  let removedBoth = true;
  // eslint-disable-next-line no-restricted-syntax
  for (const protocol of ['TCP', 'UDP']) {
    // eslint-disable-next-line no-await-in-loop
    const owner = await mappingOwner(port, protocol);
    if (owner === 'other') {
      log.info(`UPnP - ${protocol} ${port} not unmapped: the router maps it to another machine`);
    } else if (owner !== 'none') {
      try {
        // eslint-disable-next-line no-await-in-loop
        await toRouter(client.removeMapping({
          public: port,
          protocol,
        }), `unmapping ${protocol} ${port}`);
      } catch (error) {
        if (!UPNP_NO_SUCH_ENTRY.includes(upnpErrorCode(error))) {
          removedBoth = false;
          log.error(`UPnP - ${protocol} ${port} not unmapped: ${describeUpnpError(error)}`);
        }
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }
  return removedBoth;
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
 * Lists the router's mappings to this node, one GetGenericPortMappingEntry per
 * index, as the library's getMappings does. The walk is this code's rather than
 * the library's so that it can stop: getMappings walks to the end of the table
 * whatever its caller has given up on, into the next node's slot. No request
 * goes out once `until` has passed (one already in flight cannot be called
 * back under nat-upnp 1.x), and what was listed by then is returned: the pass
 * only removes what it has seen.
 *
 * The router's error reply to an index past the last entry ends the table. No
 * reply at all - a request that times out, a connection refused or reset - is a
 * router in trouble, and rejects: nothing more is sent to it.
 * @param {number} until monotonic ms after which no request is sent
 * @param {number} deadline monotonic ms the whole pass ends at
 * @returns {Promise<object[]>} the mappings, in the library's getMappings shape
 */
async function listOwnMappings(until, deadline) {
  const timeout = () => Math.min(CLEANUP_REQUEST_TIMEOUT_MS, deadline - monotonicMs());
  const { gateway, address } = await withinTime(gatewayAndAddress(), timeout(), 'finding the gateway');
  const mappings = [];
  for (let index = 0; ; index += 1) {
    if (monotonicMs() >= until) {
      log.warn(`UPnP - stale mapping cleanup out of time after ${index} router entries, the rest wait for the next start`);
      return mappings;
    }
    let data;
    try {
      // eslint-disable-next-line no-await-in-loop
      data = await withinTime(gateway.run('GetGenericPortMappingEntry', [['NewPortMappingIndex', index]]), timeout(), 'listing the mappings');
    } catch (error) {
      // 1.x rejects a fault as an HTTP error, 2.x with its UPnP code
      if (error.response || UPNP_END_OF_TABLE.includes(upnpErrorCode(error))) return mappings;
      throw error;
    }
    const key = Object.keys(data || {}).find((k) => /^GetGenericPortMappingEntryResponse/.test(k));
    if (!key) throw new Error('listing the mappings: incorrect response');
    const entry = data[key];
    if (fieldText(entry.NewInternalClient) === address) {
      mappings.push({
        public: { host: fieldText(entry.NewRemoteHost), port: parseInt(fieldText(entry.NewExternalPort), 10) },
        private: { host: fieldText(entry.NewInternalClient), port: parseInt(fieldText(entry.NewInternalPort), 10) },
        protocol: fieldText(entry.NewProtocol).toLowerCase(),
        description: fieldText(entry.NewPortMappingDescription),
      });
    }
  }
}

/**
 * Removes the router's mappings to this node that this code made and nothing
 * here holds any more: an app removed while the router was unreachable, a
 * FluxOS that died between mapping and unmapping, a node reinstalled on the
 * same address without the apps it ran, an api port that moved. They are made
 * with an indefinite lease (or the router's longest, a week under IGDv2), so
 * nothing else ever takes them, and home routers hold only so many.
 *
 * One listing. Only mappings to this node's own address are looked at -
 * several nodes behind one router is an ordinary setup - and only those with a
 * description this code gives, on a port nothing here holds and mapUpnpPort has
 * not mapped since FluxOS started.
 *
 * What is held is asked for only after the router has been listed: an app's
 * record is written before its ports are mapped, so every mapping the listing
 * holds already has its app in the answer.
 *
 * Everything - the listing and each removal - happens within `budgetMs`. The
 * listing stops asking the router early enough to leave time for removals, and
 * what has not been listed or removed by the end is left for the next start. A
 * removal the router refuses is stepped past; one it does not answer ends the
 * pass, so as not to send more to a router that is not keeping up.
 * @param {function(): Promise<Iterable<number>>} heldPorts every port something on this node holds
 * @param {number} budgetMs
 * @returns {Promise<number>} how many mappings were removed
 */
async function removeStaleMappings(heldPorts, budgetMs) {
  const deadline = monotonicMs() + budgetMs;
  const left = () => deadline - monotonicMs();
  const mappings = await listOwnMappings(deadline - Math.min(CLEANUP_REMOVAL_RESERVE_MS, budgetMs / 2), deadline);
  const keep = new Set([...await heldPorts()].map(Number));
  const stale = mappings.filter((mapping) => Number.isInteger(mapping.public.port)
    && !keep.has(mapping.public.port)
    && isOwnedMappingDescription(mapping.description));
  let removed = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const [index, mapping] of stale.entries()) {
    if (left() <= 0) {
      log.warn(`UPnP - stale mapping cleanup out of time, ${stale.length - index} left for the next start`);
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
      await withinTime(client.removeMapping({ public: { host, port }, protocol }), Math.min(CLEANUP_REQUEST_TIMEOUT_MS, left()), 'removing the mapping');
      removed += 1;
      log.info(`UPnP - stale mapping removed: ${protocol} ${port} (${mapping.description})`);
    } catch (error) {
      log.warn(`UPnP - stale mapping ${protocol} ${port} (${mapping.description}) not removed: ${describeUpnpError(error)}`);
      if (error.timedOut) {
        log.warn(`UPnP - stale mapping cleanup stopped, ${stale.length - index - 1} left for the next start`);
        break;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }
  return removed;
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
  getMapFailureReason,
  describeUpnpError,
  upnpErrorCode,
  mappingOwner,
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
