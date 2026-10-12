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

const client = new natUpnp.Client();

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
  // held while the test runs: a cleanup pass taking it between the create and
  // the remove would fail the verify, and a node with a custom api port or a
  // router IP exits on that. A test that fails leaves it held.
  mappedHere.add(+apiport + 3);
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
  // held from before the router has it: the cleanup pass may list it the
  // moment it is there
  mappedHere.add(+port);
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
  // given up even if the router refuses: what is left is the cleanup pass's
  mappedHere.delete(+port);
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
  const { gateway, address } = await withinTime(client.getGateway(), timeout(), 'finding the gateway');
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
      if (error.response) return mappings;
      throw error;
    }
    const key = Object.keys(data || {}).find((k) => /^GetGenericPortMappingEntryResponse/.test(k));
    if (!key) throw new Error('listing the mappings: incorrect response');
    const entry = data[key];
    if (entry.NewInternalClient === address) {
      mappings.push({
        public: { host: (typeof entry.NewRemoteHost === 'string' && entry.NewRemoteHost) || '', port: parseInt(entry.NewExternalPort, 10) },
        private: { host: entry.NewInternalClient, port: parseInt(entry.NewInternalPort, 10) },
        protocol: String(entry.NewProtocol).toLowerCase(),
        description: entry.NewPortMappingDescription,
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
      log.warn(`UPnP - stale mapping ${protocol} ${port} (${mapping.description}) not removed: ${error.message}`);
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
