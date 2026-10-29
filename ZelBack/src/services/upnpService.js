const { EventEmitter } = require('node:events');
const config = require('config');
const natUpnp = require('@runonflux/nat-upnp');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');
// eslint-disable-next-line import/no-extraneous-dependencies

const log = require('../lib/log');
const fluxEventBus = require('./utils/fluxEventBus');
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
// program's, a description the router truncated - is not ours to judge. A
// description is compared as routers store it (natUpnp.canonicalDescription):
// FRITZ!Box keeps 'Flux_App_web' as 'Flux.App.web'.
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
// The protocols of each port whose latest map here created the mapping or found
// it already this node's, by port: what removeMapUpnpPort removes. A router
// refuses to map a port another machine holds, so a mapping it took is this
// node's, and one it refused never is.
const mappedProtocols = new Map();
// Ports removeMapUpnpPort has released and mapUpnpPort has not mapped since,
// outside a refresh: the app holding one is removed or being removed, and a
// refresh maps none of them again.
const releasedPorts = new Set();

// Removals of this node's own mappings the router refused, by `port/protocol`:
// each is asked again, one at a time, after config.upnp.removalRetryFirstMs,
// the wait doubling to config.upnp.removalRetryMaxMs, until the router removes
// it or holds no such entry. A port this node maps again is in use, and its
// pending removal is dropped - a test mapping's after one more ask, when what
// maps the port stays (removeHeldTestMappings).
const pendingRemovals = new Map();
let pendingRemovalTurn = Promise.resolve();

// Emits 'removalPending' when a removal becomes pending with none pending
// before, 'removalsClear' when the last pending removal goes, and
// 'mappingRefused' each time a refusal is counted in routerRefusals.
const routerEvents = new EventEmitter();

/**
 * Makes a removal pending under `key`, in place of any pending there.
 * @param {string} key `port/protocol`
 * @param {object} pending
 */
function setPendingRemoval(key, pending) {
  const wasClear = pendingRemovals.size === 0;
  clearTimeout(pendingRemovals.get(key)?.timer);
  pendingRemovals.set(key, pending);
  if (wasClear) routerEvents.emit('removalPending');
}

/**
 * Ends the pending removal under `key`, if there is one.
 * @param {string} key `port/protocol`
 */
function deletePendingRemoval(key) {
  const pending = pendingRemovals.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingRemovals.delete(key);
  if (pendingRemovals.size === 0) routerEvents.emit('removalsClear');
}

/**
 * Records whether this node's latest map of one protocol of a port left the
 * router mapping it here.
 * @param {number} port
 * @param {string} protocol 'TCP' or 'UDP'
 * @param {boolean} mapped
 */
function recordMapped(port, protocol, mapped) {
  const protocols = mappedProtocols.get(port) || new Set();
  if (mapped) protocols.add(protocol);
  else protocols.delete(protocol);
  if (protocols.size) mappedProtocols.set(port, protocols);
  else mappedProtocols.delete(port);
}
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
// A node verifying UPnP on a full table lists it at once, without waiting for
// its slot: it cannot run until it has verified. It waits its slot's number
// times this first, so siblings starting together - a power cut, a router
// restart, one update reaching them all - take turns: a router serves one
// request at a time, and six listings at once took 23 to 38 s each where one
// alone took 0.2 s.
const BOOT_LISTING_STAGGER_MS = 5 * 1000;

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

const NO_SUCH_ENTRY = 714;

// The refusals of a mapping that name the port or the request as the problem:
// invalid arguments (402), a wildcard or a pair of ports the router will not
// take (716, 724, 726, 727), a lease it will not grant (725), a port another
// machine or another mechanism holds (718, 729). Every other refusal is the
// router's own. Routers do not agree on how they refuse a mapping when their
// table is full: some answer 728 NoPortMapsAvailable, as the standard has it,
// others a generic 501 Action Failed, which some also give for every refresh
// of an entry they hold. A full table cannot be told by its code, so a refusal
// that is not the port's is taken as the router's - unless the router, asked
// after refusing, holds the port for something else: that names the port
// whatever the code, 501 and 606 included. Only 728 says the table is full in
// so many words, and counts as the router's even then.
const PORT_REFUSALS = new Set([402, 716, 718, 724, 725, 726, 727, 729]);
const NO_PORT_MAPS_AVAILABLE = 728;

// What a test leaves on the router while it runs and removes before it ends.
const TEST_MAPPING_DESCRIPTIONS = new Set(['Flux_UPNP_Mapping_Test', 'Flux_Test_App']);
const TEST_MAPPING_PREFIX = 'Flux_Prelaunch_App_';

// The refusals of a leased mapping that say nothing of the lease: the port
// held by another machine or another mechanism, and a full table. Every other
// refusal may be the router's of the lease, and the mapping is asked for once
// more without one.
const LEASE_INDEPENDENT_REFUSALS = new Set([718, 728, 729]);

// The descriptions of the mappings that stay while what they serve runs: the
// node's own ports and each app's.
const LONG_LIVED_DESCRIPTIONS = new Set(['Flux_Backend_API', 'Flux_Backend_API_SSL', 'Flux_Home_UI', 'Flux_Syncthing']);
const LONG_LIVED_PREFIX = 'Flux_App_';

// What this node has learned of its router's leases since UPnP was last
// verified, each null until it is known.
//
// `kept`: whether the router keeps a mapping's lease - read back from
// verifyUPNPsupport's test mapping; false once the router has refused a lease or
// shown a leased mapping as permanent. A test mapping is leased unless it is
// false: on such a router a test mapping is permanent, and goes only when this
// node removes it.
//
// `renews`: whether adding a held mapping again restarts its lease - learnLeaseRenewal
// looks the mapping up after its first lease would have ended. Only on such a
// router are long-lived mappings leased: on one that does not renew, a leased
// mapping lapses at its first lease's end whatever the refresh asks, and one
// that does not take an add over a held entry keeps the old lease.
//
// `generation` counts verifications, so a renewal test started before the
// latest one does not record its answer.
const routerLeases = { kept: null, renews: null, generation: 0 };

const MAPPED = Object.freeze({
  mapped: true, code: null, reason: null, routerWide: false,
});

let routerRefusalCount = 0;

/**
 * How many of this node's mappings the router has refused since FluxOS started
 * for a reason that is its own and not the port's: no answer, or any refusal
 * but those PORT_REFUSALS names for a port it does not hold for something
 * else. verifyUPNPsupport's test mapping is not counted. Only ever goes up.
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
 * Whether a mapping's description is one of a mapping that stays while what it
 * serves runs: one of the node's own ports, or an app's.
 * @param {string} description
 * @returns {boolean}
 */
function isLongLivedDescription(description) {
  return typeof description === 'string'
    && ([...LONG_LIVED_DESCRIPTIONS].some((longLived) => sameDescription(description, longLived))
      || descriptionStartsWith(description, LONG_LIVED_PREFIX));
}

/**
 * The lease a mapping with `description` is made with: a test mapping's on a
 * router not known to refuse one; a long-lived mapping's only on a router known
 * to renew a lease when the mapping is added again, as each refresh does; none
 * for every other mapping (some routers force a short one instead).
 * @param {string} description
 * @returns {number} seconds; 0 for no lease
 */
function leaseFor(description) {
  if (isTestMappingDescription(description)) {
    return routerLeases.kept !== false ? config.upnp.testMappingLeaseS : 0;
  }
  if (isLongLivedDescription(description)) {
    return routerLeases.renews === true ? config.upnp.longLivedLeaseS : 0;
  }
  return 0;
}

/**
 * Maps one protocol of a port to this node, port for port, with the lease
 * leaseFor gives it. A leased mapping the router refuses for a reason that may
 * be the lease is asked for once more without one, and when that is taken the
 * router is known to refuse leases. A refusal is no failure when the router
 * already maps the port here: some routers refuse to add an entry they hold,
 * and a full table refuses everything, the refresh of a working mapping
 * included. A router that does not answer is not asked again.
 * @param {number} port
 * @param {string} protocol 'TCP' or 'UDP'
 * @param {string} description
 * @param {object} [options]
 * @param {boolean} [options.counted] whether a refusal of the router's own counts in
 *   routerRefusals; false for verifyUPNPsupport's test mapping, a probe it
 *   resolves itself
 * @returns {Promise<{mapped: boolean, code: number|null, reason: string|null, routerWide: boolean}>}
 *   `code` is the router's UPnP error code, null when it gave none; `routerWide`
 *   whether the refusal is the router's own rather than the port's.
 */
async function mapProtocol(port, protocol, description, { counted = true } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      mapped: false, code: null, reason: `${protocol} ${port} not mapped: not a port`, routerWide: false,
    };
  }
  const create = (ttl) => client.createMapping({
    public: port,
    private: port,
    ttl,
    protocol,
    description,
  });
  const lease = leaseFor(description);
  try {
    await create(lease);
    return MAPPED;
  } catch (refusal) {
    let error = refusal;
    if (lease > 0 && error instanceof natUpnp.UpnpError && !LEASE_INDEPENDENT_REFUSALS.has(error.code)) {
      try {
        await create(0);
        if (isTestMappingDescription(description)) {
          routerLeases.kept = false;
          log.info(`UPnP - ${protocol} ${port} refused with a lease (${error.message}) and mapped without one; this router's test mappings are permanent`);
        } else {
          routerLeases.renews = false;
          log.info(`UPnP - ${protocol} ${port} refused with a lease (${error.message}) and mapped without one; this router's long-lived mappings are permanent`);
        }
        return MAPPED;
      } catch (permanentRefusal) {
        error = permanentRefusal;
      }
    }
    const answered = error instanceof natUpnp.UpnpError;
    let heldElsewhere = false;
    if (answered) {
      const held = await client.getMapping({ public: port, protocol }).catch(() => null);
      if (mapsHere(held, port)) {
        log.info(`UPnP - ${protocol} ${port} refused (${error.message}), but the router already maps it to this node`);
        return MAPPED;
      }
      heldElsewhere = held !== null;
    }
    const code = answered ? error.code : null;
    // no answer, with no code, is the router's too
    const routerWide = !PORT_REFUSALS.has(code) && !(heldElsewhere && code !== NO_PORT_MAPS_AVAILABLE);
    if (routerWide && counted) {
      routerRefusalCount += 1;
      routerEvents.emit('mappingRefused');
    }
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
  // Asked again of the router on every verify: this test mapping is the one
  // whose lease is read back, and learnLeaseRenewal follows it.
  routerLeases.kept = null;
  routerLeases.renews = null;
  routerLeases.generation += 1;
  let testMapping = await mapProtocol(+apiport + 3, 'TCP', 'Flux_UPNP_Mapping_Test', { counted: false });
  // refused for a reason of the router's own, as a full table is: until UPnP is
  // verified the stale mapping cleanup never runs, so the test mappings earlier
  // runs left are removed here to make room. A router that did not answer is
  // not listed.
  if (testMapping.routerWide && testMapping.code !== null) {
    let removed = 0;
    await serviceHelper.delay(cleanupSlotOf(apiport) * BOOT_LISTING_STAGGER_MS);
    try {
      removed = await removeLeftoverTestMappings();
    } catch (error) {
      log.warn(`VerifyUPNPsupport - left-over test mappings not removed: ${error.message}`);
    }
    if (removed > 0) testMapping = await mapProtocol(+apiport + 3, 'TCP', 'Flux_UPNP_Mapping_Test', { counted: false });
    // A full table refuses every new mapping, so a node whose router already
    // maps its api port to it runs on what it holds: every mapping refused from
    // here on counts toward the router DOS, which takes the node out of service
    // until a slot frees.
    if (!testMapping.mapped) {
      const apiMapping = await client.getMapping({ public: +apiport, protocol: 'TCP' }).catch(() => null);
      if (mapsHere(apiMapping, +apiport)) {
        log.warn(`VerifyUPNPsupport - ${testMapping.reason}, but the router maps this node's api port to it`);
        mappedHere.delete(+apiport + 3);
        upnpMachine = true;
        return true;
      }
    }
  }
  if (!testMapping.mapped) {
    log.error(`VerifyUPNPsupport - Failed Create Mapping: ${testMapping.reason}`);
    upnpMachine = false;
    return false;
  }
  recordMapped(+apiport + 3, 'TCP', true);
  await serviceHelper.delay(500);
  try {
    const mapping = await client.getMapping({ public: +apiport + 3, protocol: 'TCP' });
    if (!mapping) throw new Error(`the router holds no mapping for port ${+apiport + 3}`);
    // A router that keeps the mapping and drops its lease - by refusing it
    // (725, which the client answers by asking without one) or by ignoring it -
    // shows the mapping as permanent.
    if (routerLeases.kept === null) {
      routerLeases.kept = mapping.ttl > 0;
      log.info(`VerifyUPNPsupport - the router ${routerLeases.kept ? `keeps a test mapping's lease (${mapping.ttl} s)` : 'holds a leased test mapping as permanent'}`);
    }

    await serviceHelper.delay(500);
  } catch (error) {
    log.error(error);
    log.error('VerifyUPNPsupport - Failed get Mapping');
    upnpMachine = false;
    return false;
  }
  // UPnP works once the router has taken the mapping and shows it: a removal it
  // refuses is asked again until it goes, and fails nothing here.
  await removeMapUpnpPort(+apiport + 3, 'Flux_UPNP_Mapping_Test');

  upnpMachine = true;
  return true;
}

/**
 * Learns whether the router restarts a mapping's lease when the mapping is added
 * again, as each refresh adds it: the test port is mapped with
 * config.upnp.renewalTestLeaseS, added again halfway through that lease with the
 * same arguments, and looked up 10 s after the first lease would have ended. It
 * renews when the mapping is still this node's then and shows a lease no longer
 * than the one asked for - a router that holds every mapping for longer cannot
 * show whether it renewed. The lease a router shows cannot answer this on its
 * own: some show the asked lease without counting down whether they renew or
 * not, and only a mapping outliving its first lease shows that it did.
 *
 * Asked only of a router that keeps a lease (routerLeases.kept), after
 * verifyUPNPsupport. Anything that does not show a renewal - the mapping gone, a
 * refusal, no answer - records that it does not, which leaves long-lived
 * mappings permanent. An answer that arrives after UPnP was verified again is
 * dropped. Never rejects.
 * @param {number|string} apiport
 * @returns {Promise<boolean>} whether the router renews
 */
async function learnLeaseRenewal(apiport) {
  const { generation } = routerLeases;
  const record = (renews, why) => {
    if (routerLeases.generation !== generation) return false;
    routerLeases.renews = renews;
    fluxEventBus.publish('upnp:leaseRenewal', { renews });
    log.info(`UPnP - the router ${renews ? 'renews' : 'does not renew'} a mapping's lease when it is added again (${why}); long-lived mappings are ${renews ? `leased for ${config.upnp.longLivedLeaseS} s` : 'permanent'}`);
    return renews;
  };
  if (routerLeases.kept !== true) return record(false, 'it keeps no lease');
  const port = +apiport + 3;
  const leaseS = config.upnp.renewalTestLeaseS;
  const create = () => client.createMapping({
    public: port,
    private: port,
    ttl: leaseS,
    protocol: 'TCP',
    description: 'Flux_UPNP_Mapping_Test',
  });
  // held while the test runs, as verifyUPNPsupport holds it: a cleanup pass
  // taking it would read as a lapse
  mappedHere.add(port);
  let made = false;
  try {
    const startMs = monotonicMs();
    await create();
    made = true;
    await serviceHelper.delay(Math.max(0, startMs + (leaseS * 1000) / 2 - monotonicMs()));
    await create();
    await serviceHelper.delay(Math.max(0, startMs + (leaseS + 10) * 1000 - monotonicMs()));
    const mapping = await client.getMapping({ public: port, protocol: 'TCP' });
    if (!mapsHere(mapping, port)) return record(false, `no mapping ${leaseS + 10} s after a ${leaseS} s lease was renewed halfway`);
    if (!(mapping.ttl > 0 && mapping.ttl <= leaseS)) return record(false, `it shows a lease of ${mapping.ttl} s for one of ${leaseS} s`);
    return record(true, `held ${leaseS + 10} s after a ${leaseS} s lease was renewed halfway`);
  } catch (error) {
    return record(false, error.message);
  } finally {
    if (made) {
      recordMapped(port, 'TCP', true);
      await removeMapUpnpPort(port, 'Flux_UPNP_Mapping_Test');
    } else {
      mappedHere.delete(port);
    }
  }
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
      && sameDescription(mapping.description, FLUXADM_MAPPING_DESCRIPTION);
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
 * Removes the test mappings of a port whose removal the router refused and is
 * still to be asked again, before the port is mapped for something that stays.
 * Some routers take an add over an entry they hold without changing its lease,
 * so a mapping made over a leased test mapping would lapse with the test's
 * lease. Asked once per protocol; one the router refuses again is mapped over.
 * @param {number} port
 * @returns {Promise<void>}
 */
async function removeHeldTestMappings(port) {
  // eslint-disable-next-line no-restricted-syntax
  for (const protocol of ['TCP', 'UDP']) {
    const pending = pendingRemovals.get(`${port}/${protocol}`);
    // eslint-disable-next-line no-continue
    if (!pending || !isTestMappingDescription(pending.description)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await removeProtocol(port, protocol)) {
      log.info(`UPnP - ${protocol} ${port} (${pending.description}) unmapped before the port is mapped again`);
    } else {
      log.warn(`UPnP - ${protocol} ${port} (${pending.description}) still held before the port is mapped again; a router that keeps a held entry's lease drops the new mapping when it ends`);
    }
  }
}

/**
 * Maps a port to this node over each of `protocols` in turn, TCP and then UDP
 * unless given.
 *
 * On a failure the port is no longer held here; a protocol the router took is
 * still recorded, for removeMapUpnpPort to remove.
 * A refresh, which keeps this node's mappings alive, maps no port released and
 * not mapped since: it leaves the port alone, its pending removals with it. Any
 * other map takes the port into use again.
 * @param {number} port Port number.
 * @param {string} description Port description.
 * @param {{protocols?: string[], refresh?: boolean}} [options]
 * @returns {Promise<{mapped: boolean, code: number|null, reason: string|null, routerWide: boolean, released?: boolean}>}
 *   the first refusal, as mapProtocol gives it; mapped when every protocol is;
 *   released, and nothing asked of the router, for a refresh of a released port
 */
async function mapUpnpPort(port, description, { protocols = ['TCP', 'UDP'], refresh = false } = {}) {
  if (refresh && releasedPorts.has(+port)) {
    return {
      mapped: false, code: null, reason: `${port} released and not mapped since`, routerWide: false, released: true,
    };
  }
  releasedPorts.delete(+port);
  // held from before the router has it: the cleanup pass may list it the
  // moment it is there
  mappedHere.add(+port);
  if (!isTestMappingDescription(description)) await removeHeldTestMappings(+port);
  dropPendingRemovals(+port);
  let result = MAPPED;
  // eslint-disable-next-line no-restricted-syntax
  for (const [i, protocol] of protocols.entries()) {
    // eslint-disable-next-line no-await-in-loop
    if (i > 0) await serviceHelper.delay(500);
    // eslint-disable-next-line no-await-in-loop
    result = await mapProtocol(+port, protocol, description);
    recordMapped(+port, protocol, result.mapped);
    if (!result.mapped) break;
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
 * Removes the router's mapping of one protocol of a port.
 * @param {number} port
 * @param {string} protocol 'TCP' or 'UDP'
 * @returns {Promise<boolean>} whether the router no longer holds it
 */
async function removeProtocol(port, protocol) {
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
 * Drops the pending removals of a port.
 * @param {number} port
 */
function dropPendingRemovals(port) {
  ['TCP', 'UDP'].forEach((protocol) => deletePendingRemoval(`${port}/${protocol}`));
}

/**
 * Whether the router still maps one protocol of a port to this node.
 * @param {number} port
 * @param {string} protocol 'TCP' or 'UDP'
 * @returns {Promise<boolean|null>} null when the router did not say: a lookup
 *   it answered with a fault, or did not answer
 */
async function routerMapsHere(port, protocol) {
  try {
    return mapsHere(await client.getMapping({ public: port, protocol }), port);
  } catch (error) {
    log.error(`UPnP - ${protocol} ${port} not looked up: ${error.message}`);
    return null;
  }
}

/**
 * Asks the router once more to remove a pending removal's mapping, in turn
 * behind any other pending removal, and schedules the next ask if it refuses
 * again. The router is asked first whether the mapping is still this node's:
 * one it no longer holds, or holds for something else, ends the removal with
 * nothing sent. A lookup it does not settle leaves the mapping counted as
 * this node's, and the removal is sent.
 * @param {object} pending
 */
function askPendingRemoval(pending) {
  pendingRemovalTurn = pendingRemovalTurn.then(async () => {
    const key = `${pending.port}/${pending.protocol}`;
    if (pendingRemovals.get(key) !== pending) return;
    const held = await routerMapsHere(pending.port, pending.protocol);
    if (pendingRemovals.get(key) !== pending) return;
    if (held === false) {
      deletePendingRemoval(key);
      log.info(`UPnP - ${pending.protocol} ${pending.port} (${pending.description}) no longer this node's on the router, nothing to remove`);
      return;
    }
    if (await removeProtocol(pending.port, pending.protocol)) {
      deletePendingRemoval(key);
      log.info(`UPnP - ${pending.protocol} ${pending.port} (${pending.description}) unmapped after ${pending.refusals} refusal(s)`);
      return;
    }
    // mapped again while the router was being asked: in use, not pending
    if (pendingRemovals.get(key) === pending) schedulePendingRemoval(pending);
  });
}

/**
 * Asks the router again to remove a pending removal's mapping after a wait
 * that doubles with each refusal, up to config.upnp.removalRetryMaxMs.
 * @param {object} pending
 */
function schedulePendingRemoval(pending) {
  const { removalRetryFirstMs, removalRetryMaxMs } = config.upnp;
  const waitMs = Math.min(removalRetryFirstMs * (2 ** pending.refusals), removalRetryMaxMs);
  // eslint-disable-next-line no-param-reassign
  pending.refusals += 1;
  // eslint-disable-next-line no-param-reassign
  pending.timer = setTimeout(() => askPendingRemoval(pending), waitMs);
}

/**
 * Whether the router has yet to remove a mapping of this node it was asked to.
 * @returns {boolean}
 */
function removalPending() {
  return pendingRemovals.size > 0;
}

/**
 * Removes the protocols of a port that this node mapped, each on its own: a
 * refusal of one leaves the other to go. A router removes a mapping by its
 * external port whoever it points at, so a protocol this node's latest map did
 * not take - one another machine holds - is never asked for. A removal the
 * router refuses is pending, and asked again until it goes.
 * @param {number} port Port number.
 * @param {string} [description] the mapping's description, for the log
 * @returns {Promise<boolean>} whether the router removed every one of them now
 */
async function removeMapUpnpPort(port, description = '') {
  releasedPorts.add(+port);
  const protocols = mappedProtocols.get(+port) || new Set();
  mappedHere.delete(+port);
  mappedProtocols.delete(+port);
  let removed = true;
  // eslint-disable-next-line no-restricted-syntax
  for (const protocol of ['TCP', 'UDP']) {
    // eslint-disable-next-line no-continue
    if (!protocols.has(protocol)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (!await removeProtocol(+port, protocol)) {
      removed = false;
      const pending = {
        port: +port, protocol, description, refusals: 0, timer: null,
      };
      setPendingRemoval(`${+port}/${protocol}`, pending);
      schedulePendingRemoval(pending);
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }
  return removed;
}

/**
 * Whether a mapping's description is one this code makes.
 * @param {string} description
 * @returns {boolean}
 */
function isOwnedMappingDescription(description) {
  if (typeof description !== 'string') return false;
  if (sameDescription(description, FLUXADM_MAPPING_DESCRIPTION) && fluxadmPort.isArcane) return false;
  return [...OWNED_MAPPING_DESCRIPTIONS].some((owned) => sameDescription(description, owned))
    || OWNED_MAPPING_PREFIXES.some((prefix) => descriptionStartsWith(description, prefix));
}

/**
 * Whether two mapping descriptions are the same as a router stores them.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameDescription(a, b) {
  return natUpnp.canonicalDescription(a) === natUpnp.canonicalDescription(b);
}

/**
 * Whether a mapping description begins with a prefix, as a router stores them.
 * @param {string} description
 * @param {string} prefix
 * @returns {boolean}
 */
function descriptionStartsWith(description, prefix) {
  return natUpnp.canonicalDescription(description).startsWith(natUpnp.canonicalDescription(prefix));
}

/**
 * Whether a mapping's description is a test's.
 * @param {string} description
 * @returns {boolean}
 */
function isTestMappingDescription(description) {
  return typeof description === 'string'
    && ([...TEST_MAPPING_DESCRIPTIONS].some((test) => sameDescription(description, test))
      || descriptionStartsWith(description, TEST_MAPPING_PREFIX));
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
 * The number of this node's cleanup slot, from its api port's tens digit.
 * @param {number|string} apiport the api port this FluxOS listens on
 * @returns {number} 0 to CLEANUP_SLOT_COUNT - 1
 */
function cleanupSlotOf(apiport) {
  return Math.floor((+apiport % 100) / 10) % CLEANUP_SLOT_COUNT;
}

/**
 * Milliseconds until the next start of this node's cleanup slot.
 * @param {number|string} apiport the api port this FluxOS listens on
 * @param {number} [now] wall-clock ms
 * @returns {number}
 */
function msUntilCleanupSlot(apiport, now = Date.now()) {
  const slotStart = cleanupSlotOf(apiport) * CLEANUP_SLOT_MS;
  return (slotStart - (now % CLEANUP_CYCLE_MS) + CLEANUP_CYCLE_MS) % CLEANUP_CYCLE_MS;
}

/**
 * Milliseconds until the next start of this node's refresh slot: one of eight
 * in each cycle of `cycleMs`, half a cycle from its cleanup slot. Siblings
 * behind one router hold distinct slots, so their refreshes never meet; with
 * the cleanup's 10-minute cycle, a node's refresh never meets its own cleanup.
 * @param {number|string} apiport the api port this FluxOS listens on
 * @param {number} cycleMs the refresh cycle (config.fluxapps.portRestoreIntervalMs)
 * @param {number} [now] wall-clock ms
 * @returns {number}
 */
function msUntilRefreshSlot(apiport, cycleMs, now = Date.now()) {
  const slot = (cleanupSlotOf(apiport) + CLEANUP_SLOT_COUNT / 2) % CLEANUP_SLOT_COUNT;
  const slotStart = slot * (cycleMs / CLEANUP_SLOT_COUNT);
  return (slotStart - (now % cycleMs) + cycleMs) % cycleMs;
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
  // AbortSignal.timeout takes whole milliseconds only
  const wholeBudgetMs = Math.floor(budgetMs);
  const deadline = monotonicMs() + wholeBudgetMs;
  const left = () => deadline - monotonicMs();
  const listingMs = wholeBudgetMs - Math.min(CLEANUP_REMOVAL_RESERVE_MS, Math.floor(wholeBudgetMs / 2));
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
  learnLeaseRenewal,
  setupUPNP,
  mapUpnpPort,
  removeMapUpnpPort,
  routerRefusals,
  corePorts,
  msUntilCleanupSlot,
  msUntilRefreshSlot,
  removeStaleMappings,
  mappedHere,
  mappedProtocols,
  routerLeases,
  pendingRemovals,
  releasedPorts,
  removalPending,
  routerEvents,
  CLEANUP_SLOT_MS,
  BOOT_LISTING_STAGGER_MS,
  mapPortApi,
  removeMapPortApi,
  getMapApi,
  getIpApi,
  getGatewayApi,
  adjustFirewallForUPNP,
};
