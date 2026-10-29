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
const {
  client,
  routerEvents,
  routerLeases,
  routerRefusals,
  mapsHere,
  sameDescription,
  descriptionStartsWith,
  isTestMappingDescription,
} = require('./upnpRouter');
const portReconciler = require('./portReconciler');

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
  // Held for this verify alone: a cleanup pass taking it between the create and
  // the remove would fail the verify, and a node with a custom api port or a
  // router IP exits on that. A verify that fails leaves it held. A verify
  // started since takes the port over, and this one's release then leaves it
  // to that one.
  const holder = {};
  const testPort = +apiport + 3;
  const mapTestPort = () => portReconciler.want(testPort, 'Flux_UPNP_Mapping_Test', {
    protocols: ['TCP'], counted: false, logged: false, holder,
  });
  // Asked again of the router on every verify: this test mapping is the one
  // whose lease is read back, and learnLeaseRenewal follows it.
  routerLeases.kept = null;
  routerLeases.renews = null;
  routerLeases.generation += 1;
  let testMapping = await mapTestPort();
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
    if (removed > 0) testMapping = await mapTestPort();
    // A full table refuses every new mapping, so a node whose router already
    // maps its api port to it runs on what it holds: every mapping refused from
    // here on counts toward the router DOS, which takes the node out of service
    // until a slot frees.
    if (!testMapping.mapped) {
      const apiMapping = await portReconciler.onRouter(() => client.getMapping({ public: +apiport, protocol: 'TCP' }).catch(() => null));
      if (mapsHere(apiMapping, +apiport)) {
        log.warn(`VerifyUPNPsupport - ${testMapping.reason}, but the router maps this node's api port to it`);
        await portReconciler.release(testPort, 'Flux_UPNP_Mapping_Test', { holder });
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
  try {
    const mapping = await portReconciler.onRouter(() => client.getMapping({ public: testPort, protocol: 'TCP' }));
    if (!mapping) throw new Error(`the router holds no mapping for port ${testPort}`);
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
  await portReconciler.release(testPort, 'Flux_UPNP_Mapping_Test', { holder });

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
  // Held while the test runs, as verifyUPNPsupport holds it: a cleanup pass
  // taking it would read as a lapse. A verify started since takes the port
  // over, and this test then asks the router nothing more.
  const holder = {};
  const asHolder = (request) => portReconciler.onRouter(() => {
    if (!portReconciler.holds(port, holder)) throw new Error(`port ${port} taken over by a later verification`);
    return request();
  });
  const create = () => asHolder(async () => {
    await client.createMapping({
      public: port,
      private: port,
      ttl: leaseS,
      protocol: 'TCP',
      description: 'Flux_UPNP_Mapping_Test',
    });
    portReconciler.recordMapped(port, 'TCP', true);
  });
  await portReconciler.hold(port, 'Flux_UPNP_Mapping_Test', holder);
  try {
    const startMs = monotonicMs();
    await create();
    await serviceHelper.delay(Math.max(0, startMs + (leaseS * 1000) / 2 - monotonicMs()));
    await create();
    await serviceHelper.delay(Math.max(0, startMs + (leaseS + 10) * 1000 - monotonicMs()));
    const mapping = await asHolder(() => client.getMapping({ public: port, protocol: 'TCP' }));
    if (!mapsHere(mapping, port)) return record(false, `no mapping ${leaseS + 10} s after a ${leaseS} s lease was renewed halfway`);
    if (!(mapping.ttl > 0 && mapping.ttl <= leaseS)) return record(false, `it shows a lease of ${mapping.ttl} s for one of ${leaseS} s`);
    return record(true, `held ${leaseS + 10} s after a ${leaseS} s lease was renewed halfway`);
  } catch (error) {
    return record(false, error.message);
  } finally {
    await portReconciler.release(port, 'Flux_UPNP_Mapping_Test', { holder });
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
    await portReconciler.onRouter(() => matchFluxadmMapping(port, serviceHelper.ensureString(unitState).trim() === 'enabled'));
  } catch (error) {
    log.error(`fluxadm access - UPnP mapping for port ${port} failed: ${error.message}`);
  }
}

/**
 * The turn of reconcileFluxadmMapping: maps the maintenance sshd's port when
 * its socket is enabled, and otherwise removes a mapping of it this code made.
 * @param {number} port
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
async function matchFluxadmMapping(port, enabled) {
  if (enabled) {
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
      const result = await portReconciler.want(port, description, { protocols: ['TCP'], logged: false });
      if (!result.mapped) {
        log.error(`setupUPNP - ${result.reason}`);
        return false;
      }
    }

    await reconcileFluxadmMapping(apiport);

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
  if (sameDescription(description, FLUXADM_MAPPING_DESCRIPTION) && fluxadmPort.isArcane) return false;
  return [...OWNED_MAPPING_DESCRIPTIONS].some((owned) => sameDescription(description, owned))
    || OWNED_MAPPING_PREFIXES.some((prefix) => descriptionStartsWith(description, prefix));
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
 * nodes behind one router is an ordinary setup. A port wanted here when its
 * removal's turn comes (portReconciler.isWanted) is never removed.
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
    // eslint-disable-next-line no-await-in-loop
    const outcome = await portReconciler.onRouter(() => removeListedMapping(mapping, left, what), { upkeep: true });
    if (outcome === 'late') {
      log.warn(`UPnP - ${what} cleanup out of time, ${chosen.length - index} left for the next start`);
      break;
    }
    if (outcome === 'removed') removed += 1;
    if (outcome === 'stopped') {
      log.warn(`UPnP - ${what} cleanup stopped, ${chosen.length - index - 1} left for the next start`);
      break;
    }
  }
  return removed;
}

/**
 * The turn of one removal of removeOwnMappings. A port wanted here is in use -
 * a test or an install can map it while the pass is still working through the
 * ones before it - and is left alone.
 * @param {object} mapping as the listing gives it
 * @param {function(): number} left milliseconds left of the pass's budget
 * @param {string} what the mappings' name in the log
 * @returns {Promise<'late'|'held'|'removed'|'refused'|'stopped'>} out of time;
 *   wanted here; removed; refused with a UPnP error; or any other failure
 */
async function removeListedMapping(mapping, left, what) {
  if (left() <= 0) return 'late';
  const { host, port } = mapping.public;
  if (portReconciler.isWanted(port)) return 'held';
  const protocol = mapping.protocol.toUpperCase();
  let outcome = 'removed';
  try {
    await client.removeMapping({ public: { host, port }, protocol, signal: AbortSignal.timeout(left()) });
    log.info(`UPnP - ${what} removed: ${protocol} ${port} (${mapping.description})`);
  } catch (error) {
    log.warn(`UPnP - ${what} ${protocol} ${port} (${mapping.description}) not removed: ${error.message}`);
    if (!(error instanceof natUpnp.UpnpError)) return 'stopped';
    outcome = 'refused';
  }
  await serviceHelper.delay(500);
  return outcome;
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
 * The turn of mapPortApi: maps both protocols of the operator's port, with no
 * lease.
 * @param {number} port
 * @returns {Promise<void>}
 */
async function mapManualEntry(port) {
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
}

/**
 * The turn of removeMapPortApi: removes both protocols of the operator's port.
 * @param {number} port
 * @returns {Promise<void>}
 */
async function unmapManualEntry(port) {
  await client.removeMapping({
    public: port,
    protocol: 'TCP',
  });
  await client.removeMapping({
    public: port,
    protocol: 'UDP',
  });
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
      await portReconciler.onRouter(() => mapManualEntry(port));
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
      await portReconciler.onRouter(() => unmapManualEntry(port));
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
  routerRefusals,
  corePorts,
  msUntilCleanupSlot,
  msUntilRefreshSlot,
  removeStaleMappings,
  routerLeases,
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
