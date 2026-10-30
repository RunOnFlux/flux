const config = require('config');
const serviceHelper = require('./serviceHelper');
const log = require('../lib/log');
const {
  client,
  routerEvents,
  MAPPED,
  leaseFor,
  mapProtocol,
  removeProtocol,
  routerMapsHere,
  isTestMappingDescription,
} = require('./upnpRouter');

// The one owner of this node's UPnP mappings, and the only way to the router:
// every request this node makes of it runs as a turn on one lane (onRouter),
// which alone hands out the client. No other turn reaches the router until it
// settles, so what a turn reads of this module's state still holds when it
// acts on it, and the router answers one request of this node at a time.

// Ports wanted mapped to this node, by port: { description, holder }. A port
// mapped here is in use - a test port mid-test, an app installing - whatever the
// app table says so far. `holder` is the test holding the port, or null.
const wanted = new Map();
// The protocols of each port whose latest map here created the mapping or found
// it already this node's, by port: what a release removes. A router refuses to
// map a port another machine holds, so a mapping it took is this node's, and
// one it refused never is.
const mappedProtocols = new Map();
// Ports released and not wanted since: the app holding one is removed or being
// removed, and keep maps none of them again.
const releasedPorts = new Set();
// Ports want mapped, by port: { description, lease, atMs }, the lease the router
// took and when. keep leaves one alone for a refresh cycle
// (config.fluxapps.portRestoreIntervalMs) while its lease is still the one
// leaseFor gives, so a refresh never repeats a mapping made since the last one.
// keep's own maps are never recorded: a refresh renews every mapping it made a
// cycle earlier.
const wantedMaps = new Map();

// Removals of this node's own mappings the router refused, by `port/protocol`:
// each is asked again after config.upnp.removalRetryFirstMs, the wait doubling
// to config.upnp.removalRetryMaxMs, until the router removes it or holds no
// such entry. A port wanted again is in use, and its pending removal is dropped
// - a test mapping's after one more ask, when what maps the port stays
// (removeHeldTestMappings).
const pendingRemovals = new Map();

// Turns waiting for the lane, oldest first: those a caller waits on, then
// upkeep.
const intentTurns = [];
const upkeepTurns = [];
let laneRunning = false;

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

/**
 * Runs the waiting turns one at a time until none is left: a turn a caller
 * waits on before any upkeep that has not started.
 * @returns {Promise<void>}
 */
async function runLane() {
  laneRunning = true;
  while (intentTurns.length || upkeepTurns.length) {
    const turn = intentTurns.shift() ?? upkeepTurns.shift();
    try {
      // eslint-disable-next-line no-await-in-loop
      turn.resolve(await turn.work(client));
    } catch (error) {
      turn.reject(error);
    }
  }
  laneRunning = false;
}

/**
 * Runs `work` as a turn on the router, handing it the router's client: nothing
 * else of this node reaches the router until it settles. Upkeep waits behind
 * every turn a caller waits on that has not started. `work` never waits on
 * another turn: that turn would wait on it.
 * @template T
 * @param {function(object): (T|Promise<T>)} work given the router's client
 * @param {{upkeep?: boolean}} [options] upkeep: keeping mappings as they are,
 *   with no caller waiting
 * @returns {Promise<T>} what `work` settles with
 */
function onRouter(work, { upkeep = false } = {}) {
  const turn = { work };
  const settled = new Promise((resolve, reject) => {
    turn.resolve = resolve;
    turn.reject = reject;
  });
  (upkeep ? upkeepTurns : intentTurns).push(turn);
  if (!laneRunning) runLane();
  return settled;
}

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
 * Drops the pending removals of a port.
 * @param {number} port
 */
function dropPendingRemovals(port) {
  ['TCP', 'UDP'].forEach((protocol) => deletePendingRemoval(`${port}/${protocol}`));
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
 * The turn of want: the port is wanted, then mapped over each protocol in turn.
 * A port wanted with no holder - an installation's - stays so when a holder
 * wants it too: a test never takes over a port something installed holds. On a
 * failure the port is no longer wanted unless a holder holds it, which keeps it
 * until its own release; a protocol the router took is still recorded, for a
 * release to remove.
 * @param {number} port
 * @param {string} description
 * @param {{protocols: string[], counted: boolean, logged: boolean, holder: object|null, upkeep: boolean}} options
 *   upkeep: keep's map, which wantedMaps does not record
 * @returns {Promise<{mapped: boolean, code: number|null, reason: string|null, routerWide: boolean}>}
 */
async function mapPort(port, description, {
  protocols, counted, logged, holder, upkeep,
}) {
  const current = wanted.get(port);
  const heldFor = current && current.holder === null ? null : holder;
  releasedPorts.delete(port);
  wanted.set(port, { description, holder: heldFor });
  wantedMaps.delete(port);
  if (!isTestMappingDescription(description)) await removeHeldTestMappings(port);
  dropPendingRemovals(port);
  let result = MAPPED;
  // eslint-disable-next-line no-restricted-syntax
  for (const [i, protocol] of protocols.entries()) {
    // eslint-disable-next-line no-await-in-loop
    if (i > 0) await serviceHelper.delay(500);
    // eslint-disable-next-line no-await-in-loop
    result = await mapProtocol(port, protocol, description, { counted });
    recordMapped(port, protocol, result.mapped);
    if (!result.mapped) break;
  }
  if (!result.mapped) {
    if (logged) log.error(`UPnP - ${result.reason}`);
    if (heldFor === null) wanted.delete(port);
    return result;
  }
  // leaseFor after the map: a router that refused the lease has the mapping
  // permanent, and leaseFor gives no lease from then on
  if (!upkeep) wantedMaps.set(port, { description, lease: leaseFor(description), atMs: monotonicMs() });
  await serviceHelper.delay(500);
  return result;
}

/**
 * Whether want mapped a port, over each of `protocols`, less than a refresh
 * cycle ago and with the lease leaseFor gives it now.
 * @param {number} port
 * @param {string} description
 * @param {string[]} protocols
 * @returns {boolean}
 */
function mappedThisCycle(port, description, protocols) {
  const made = wantedMaps.get(port);
  if (!made || made.description !== description || made.lease !== leaseFor(description)) return false;
  if (monotonicMs() - made.atMs >= config.fluxapps.portRestoreIntervalMs) return false;
  const mapped = mappedProtocols.get(port);
  return protocols.every((protocol) => mapped?.has(protocol));
}

/**
 * The turn of keep: a released port is left alone, its pending removals with
 * it; a port want mapped this refresh cycle is left as it is (mappedThisCycle);
 * any other is mapped as want maps it.
 * @param {number} port
 * @param {string} description
 * @param {string[]} protocols
 * @returns {Promise<{mapped: boolean, code: number|null, reason: string|null, routerWide: boolean, released?: boolean}>}
 */
async function keepPort(port, description, protocols) {
  if (releasedPorts.has(port)) {
    return {
      mapped: false, code: null, reason: `${port} released and not mapped since`, routerWide: false, released: true,
    };
  }
  if (mappedThisCycle(port, description, protocols)) return MAPPED;
  return mapPort(port, description, {
    protocols, counted: true, logged: true, holder: null, upkeep: true,
  });
}

/**
 * Asks the router again after a wait that doubles with each refusal, up to
 * config.upnp.removalRetryMaxMs, to remove a pending removal's mapping.
 * @param {object} pending
 */
function schedulePendingRemoval(pending) {
  const { removalRetryFirstMs, removalRetryMaxMs } = config.upnp;
  const waitMs = Math.min(removalRetryFirstMs * (2 ** pending.refusals), removalRetryMaxMs);
  // eslint-disable-next-line no-param-reassign
  pending.refusals += 1;
  // eslint-disable-next-line no-use-before-define, no-param-reassign
  pending.timer = setTimeout(() => askPendingRemoval(pending), waitMs);
}

/**
 * The turn of a pending removal's retry. The router is asked first whether the
 * mapping is still this node's: one it no longer holds, or holds for something
 * else, ends the removal with nothing sent. A lookup it does not settle leaves
 * the mapping counted as this node's, and the removal is sent. A refusal
 * schedules the next ask.
 * @param {object} pending
 * @returns {Promise<void>}
 */
async function retryRemoval(pending) {
  const key = `${pending.port}/${pending.protocol}`;
  if (pendingRemovals.get(key) !== pending) return;
  const held = await routerMapsHere(pending.port, pending.protocol);
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
  schedulePendingRemoval(pending);
}

/**
 * Asks the router once more, as upkeep, to remove a pending removal's mapping.
 * @param {object} pending
 */
function askPendingRemoval(pending) {
  onRouter(() => retryRemoval(pending), { upkeep: true });
}

/**
 * The turn of release. A port another holder has taken since is left to it.
 * Otherwise the port is released, and each protocol this node mapped is removed
 * on its own: a refusal of one leaves the other to go. A router removes a
 * mapping by its external port whoever it points at, so a protocol this node's
 * latest map did not take - one another machine holds - is never asked for. A
 * removal the router refuses is pending, and asked again until it goes.
 * @param {number} port
 * @param {string} description
 * @param {object|null} holder
 * @returns {Promise<boolean>} whether nothing of this release is left on the router
 */
async function releasePort(port, description, holder) {
  const current = wanted.get(port);
  if (holder !== null && current && current.holder !== holder) return true;
  releasedPorts.add(port);
  wanted.delete(port);
  wantedMaps.delete(port);
  const protocols = mappedProtocols.get(port) || new Set();
  mappedProtocols.delete(port);
  let removed = true;
  // eslint-disable-next-line no-restricted-syntax
  for (const protocol of ['TCP', 'UDP']) {
    // eslint-disable-next-line no-continue
    if (!protocols.has(protocol)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (!await removeProtocol(port, protocol)) {
      removed = false;
      const pending = {
        port, protocol, description, refusals: 0, timer: null,
      };
      setPendingRemoval(`${port}/${protocol}`, pending);
      schedulePendingRemoval(pending);
    }
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }
  return removed;
}

/**
 * The turn of hold: the port is wanted for `holder`, which makes its own
 * requests for it in turns of its own.
 * @param {number} port
 * @param {string} description
 * @param {object} holder
 */
function holdPort(port, description, holder) {
  releasedPorts.delete(port);
  wanted.set(port, { description, holder });
  dropPendingRemovals(port);
}

/**
 * Wants a port mapped to this node and maps it, over each of `protocols` in
 * turn, TCP and then UDP unless given.
 * @param {number|string} port
 * @param {string} description
 * @param {{protocols?: string[], counted?: boolean, logged?: boolean, holder?: object|null}} [options]
 *   counted: whether a refusal of the router's own counts in routerRefusals;
 *   logged: whether a refusal is logged here, for a caller that logs its own;
 *   holder: the test the port is held for, which a release by another holder
 *   leaves holding it
 * @returns {Promise<{mapped: boolean, code: number|null, reason: string|null, routerWide: boolean}>}
 *   the first refusal, as mapProtocol gives it; mapped when every protocol is
 */
function want(port, description, {
  protocols = ['TCP', 'UDP'], counted = true, logged = true, holder = null,
} = {}) {
  return onRouter(() => mapPort(+port, description, {
    protocols, counted, logged, holder, upkeep: false,
  }));
}

/**
 * Keeps a port mapped to this node, as upkeep: maps it as want does unless it
 * was released and not wanted since.
 * @param {number|string} port
 * @param {string} description
 * @param {{protocols?: string[]}} [options]
 * @returns {Promise<{mapped: boolean, code: number|null, reason: string|null, routerWide: boolean, released?: boolean}>}
 *   released, and nothing asked of the router, for a released port
 */
function keep(port, description, { protocols = ['TCP', 'UDP'] } = {}) {
  return onRouter(() => keepPort(+port, description, protocols), { upkeep: true });
}

/**
 * Releases a port and removes what this node mapped of it.
 * @param {number|string} port
 * @param {string} [description] the mapping's description, for the log
 * @param {{holder?: object|null}} [options] holder: the test releasing it; a
 *   port another holder has taken since is left to that holder
 * @returns {Promise<boolean>} whether nothing of this release is left on the router
 */
function release(port, description = '', { holder = null } = {}) {
  return onRouter(() => releasePort(+port, description, holder));
}

/**
 * Wants a port for `holder` without mapping it: the holder makes its own
 * requests for the port, each in a turn (onRouter) that checks it still holds
 * it, and releases it with its holder.
 * @param {number|string} port
 * @param {string} description
 * @param {object} holder
 * @returns {Promise<void>}
 */
function hold(port, description, holder) {
  return onRouter(() => holdPort(+port, description, holder));
}

/**
 * Whether `holder` holds the port. Read in a turn, it holds for the turn.
 * @param {number|string} port
 * @param {object} holder
 * @returns {boolean}
 */
function holds(port, holder) {
  return wanted.get(+port)?.holder === holder;
}

/**
 * Whether the port is wanted mapped to this node. Read in a turn, it holds for
 * the turn.
 * @param {number|string} port
 * @returns {boolean}
 */
function isWanted(port) {
  return wanted.has(+port);
}

/**
 * Whether the router has yet to remove a mapping of this node it was asked to.
 * @returns {boolean}
 */
function removalPending() {
  return pendingRemovals.size > 0;
}

module.exports = {
  onRouter,
  want,
  keep,
  release,
  hold,
  holds,
  isWanted,
  recordMapped,
  removalPending,
  wanted,
  mappedProtocols,
  releasedPorts,
  wantedMaps,
  pendingRemovals,
};
