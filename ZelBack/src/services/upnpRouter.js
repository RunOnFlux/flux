const { AsyncLocalStorage } = require('node:async_hooks');
const { EventEmitter } = require('node:events');
const config = require('config');
const natUpnp = require('@runonflux/nat-upnp');
const log = require('../lib/log');
const upnpMappingRecord = require('./upnpMappingRecord');

// A removal's answers that end a mapping's record besides success: no such
// entry, and the router refusing to remove a mapping that is not this node's.
const RECORD_ENDING_FAULTS = new Set([606, 714]);

// The signal of the lane turn a call is made in (portReconciler.onRouter): every
// request the client sends in that turn is aborted with it.
const turnSignal = new AsyncLocalStorage();

/**
 * Runs `work` as part of the lane turn `signal` belongs to.
 * @template T
 * @param {AbortSignal} signal aborts once the turn is over
 * @param {function(): T} work
 * @returns {T}
 */
function inTurn(signal, work) {
  return turnSignal.run(signal, work);
}

const portOf = (value) => (typeof value === 'object' && value !== null ? value.port : value);

/**
 * The router's client, keeping upnpMappingRecord: an add is recorded before it
 * is sent, and a removal ends the record once the router holds no mapping of
 * this node's on the port.
 */
class RecordingClient extends natUpnp.Client {
  async createMapping(options) {
    await upnpMappingRecord.mapping(+portOf(options.public), options.protocol || 'TCP', options.description || '');
    return super.createMapping(options);
  }

  async removeMapping(options) {
    const port = +portOf(options.public);
    const protocol = options.protocol || 'TCP';
    let answer;
    try {
      answer = await super.removeMapping(options);
    } catch (error) {
      if (error instanceof natUpnp.UpnpError && RECORD_ENDING_FAULTS.has(error.code)) {
        await upnpMappingRecord.removed(port, protocol);
      }
      throw error;
    }
    await upnpMappingRecord.removed(port, protocol);
    return answer;
  }
}

// config.upnp.gatewayUrl names the router's device description, used in place
// of discovering the router; the node's address is then config.upnp.nodeIp.
// A discovered router is kept between calls, and found again when it stops
// answering where it was.
const recordingClient = config.upnp.gatewayUrl
  ? new RecordingClient({ url: config.upnp.gatewayUrl, localAddress: config.upnp.nodeIp || '127.0.0.1' })
  : new RecordingClient({ cacheGateway: true });

// The router's client. A call made in a lane turn carries the turn's signal in
// its options, so its requests are aborted when the turn is over, and a call
// made after that is refused before anything is sent.
const client = new Proxy(recordingClient, {
  get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== 'function') return value;
    return (options, ...rest) => {
      const turn = turnSignal.getStore();
      const takesOptions = options === undefined || (typeof options === 'object' && options !== null);
      if (!turn || !takesOptions) return value.call(target, options, ...rest);
      if (turn.aborted) return Promise.reject(turn.reason);
      const signal = options?.signal ? AbortSignal.any([options.signal, turn]) : turn;
      return value.call(target, { ...options, signal }, ...rest);
    };
  },
});

// Emits 'removalPending' when a removal becomes pending with none pending
// before, 'removalsClear' when the last pending removal goes, and
// 'mappingRefused' each time a refusal is counted in routerRefusals.
const routerEvents = new EventEmitter();

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

module.exports = {
  client,
  inTurn,
  routerEvents,
  routerLeases,
  routerRefusals,
  MAPPED,
  mapsHere,
  leaseFor,
  mapProtocol,
  removeProtocol,
  routerMapsHere,
  sameDescription,
  descriptionStartsWith,
  isTestMappingDescription,
};
