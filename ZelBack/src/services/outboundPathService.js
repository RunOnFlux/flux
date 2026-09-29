/**
 * Whether this node's calls to other Flux nodes reach them.
 *
 * A router that forwards a port by number alone - to this node, whatever the
 * destination address - also catches this node's OUTGOING calls on that port.
 * Inbound traffic is unaffected, so every reachability check passes, and the
 * node goes on talking to a machine behind its own router while filing each
 * answer under the address it meant to reach.
 *
 * The check dials an observer on another IP whose API listens on THIS node's
 * API port. A router must forward that port to this node, so a router that
 * forwards by port alone redirects that call without exception. The observer's
 * answer is judged by peerIdentityService: signed by the node listed at the
 * observer's address is a path that works; signed by another listed node is a
 * redirect proven. A timeout proves nothing and changes nothing.
 *
 * Two different observers answering as another node are required before the
 * path is called redirected, and one observer answering as itself clears it.
 *
 * The verdict is reported, and the spawner reads it to keep synced apps off a
 * node that cannot ask its partners anything. Nothing here touches the apps the
 * node already holds.
 */

const config = require('config');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const networkStateService = require('./networkStateService');
const peerIdentityService = require('./peerIdentityService');
const fluxEventBus = require('./utils/fluxEventBus');
const { extractIp, extractPort, normalizeSocketAddress } = require('./utils/socketAddressUtils');

const OutboundPath = Object.freeze({
  // Nothing learned yet.
  UNKNOWN: 'unknown',
  // An observer on another IP answered as itself.
  CLEAR: 'clear',
  // Observers on distinct IPs answered as other nodes.
  REDIRECTED: 'redirected',
});

// Distinct observer IPs that must answer as another node. Not config: it is
// what counts as evidence, not a tuning knob.
const REDIRECT_WITNESSES = 2;

const CHECK_INTERVAL_MS = config.fluxapps.outboundPathCheckIntervalMs ?? 10 * 60 * 1000;

let state = OutboundPath.UNKNOWN;
let since = null;
/**
 * Observer IP -> what it showed, for the misroutes since the path last cleared.
 * @type {Map<string, {dialled: string, answeredAs: string, at: number}>}
 */
const witnesses = new Map();
let port = null;
let timerHandle = null;
let checking = false;

/**
 * @returns {string} What an operator reads.
 */
function redirectMessage() {
  const answered = [...new Set([...witnesses.values()].map((w) => w.answeredAs))].join(', ');
  return `Outbound traffic is redirected: calls from this node to other Flux nodes on port ${port} `
    + `are answered by ${answered}. The router is forwarding this node's outgoing connections back into `
    + 'its own network; port forwarding must apply only to traffic arriving at this node\'s public address.';
}

/**
 * An observer answered as itself: calls on this port leave the network.
 * @param {string} observer
 * @returns {void}
 */
function noteVerified(observer) {
  witnesses.clear();
  if (state === OutboundPath.CLEAR) return;
  const previous = state;
  state = OutboundPath.CLEAR;
  since = Date.now();
  if (previous === OutboundPath.REDIRECTED) {
    log.info(`outboundPath - ${observer} answered as itself; this node's outbound calls on port ${port} reach other nodes again`);
  }
  fluxEventBus.publish('outboundPath:clear', { observer, port, previous });
}

/**
 * An observer's address was answered by another listed node.
 * @param {string} observer
 * @param {string} answeredAs
 * @returns {void}
 */
function noteMisrouted(observer, answeredAs) {
  witnesses.set(extractIp(observer), { dialled: observer, answeredAs, at: Date.now() });
  if (witnesses.size < REDIRECT_WITNESSES) return;
  if (state !== OutboundPath.REDIRECTED) {
    state = OutboundPath.REDIRECTED;
    since = Date.now();
    log.error(`outboundPath - ${redirectMessage()}`);
    fluxEventBus.publish('outboundPath:redirected', {
      port,
      witnesses: [...witnesses.values()].map(({ dialled, answeredAs: by }) => ({ dialled, answeredAs: by })),
    });
  }
}

/**
 * Dial one observer and record what its answer shows.
 * @returns {Promise<object|null>} The identity verdict, or null when nobody could be asked.
 */
async function checkOnce() {
  const local = await fluxNetworkHelper.getLocalSocketAddress();
  if (!local) return null;
  port = extractPort(local);

  // Until the redirect is proven, a second witness has to be a different IP.
  const exclude = state === OutboundPath.REDIRECTED ? [] : [...witnesses.values()].map((w) => w.dialled);
  const observer = normalizeSocketAddress(await networkStateService.getRandomExternalObserver(local, { port, exclude }));
  if (!observer) {
    fluxEventBus.count('outboundPath:check', 'noObserver');
    return null;
  }

  const result = await peerIdentityService.verifyPeer(observer, { fresh: true });
  fluxEventBus.count('outboundPath:check', result.verdict);
  if (result.verdict === peerIdentityService.IdentityVerdict.VERIFIED) noteVerified(observer);
  else if (result.verdict === peerIdentityService.IdentityVerdict.MISROUTED) noteMisrouted(observer, result.answeredAs);
  return result;
}

/**
 * One scheduled pass. Never overlaps itself and never throws.
 * @returns {Promise<void>}
 */
async function runCheck() {
  if (checking) return;
  checking = true;
  try {
    await checkOnce();
  } catch (error) {
    log.error(`outboundPath - check failed: ${error.message}`);
  } finally {
    checking = false;
  }
}

/**
 * @returns {boolean} True while this node's calls to other nodes are proven redirected.
 */
function isRedirected() {
  return state === OutboundPath.REDIRECTED;
}

/**
 * @returns {{state: string, since: string|null, port: number|null, witnesses: object[]}}
 */
function getStatus() {
  return {
    state,
    since: since === null ? null : new Date(since).toISOString(),
    port,
    witnesses: [...witnesses.values()].map(({ dialled, answeredAs, at }) => ({
      dialled, answeredAs, at: new Date(at).toISOString(),
    })),
  };
}

/**
 * GET /flux/outboundpath
 * @param {object} _req Request.
 * @param {object} res Response.
 * @returns {object}
 */
function outboundPathAPI(_req, res) {
  return res.json(messageHelper.createDataMessage(getStatus()));
}

/**
 * @returns {void}
 */
function start() {
  if (timerHandle) return;
  timerHandle = setInterval(runCheck, CHECK_INTERVAL_MS);
  runCheck();
  log.info(`outboundPath - checking every ${CHECK_INTERVAL_MS / 1000}s that calls to other nodes reach them`);
}

/**
 * The verdict stands: a node going down has not fixed its router by doing so.
 * @returns {void}
 */
function stop() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

/**
 * Back to nothing learned. For tests.
 * @returns {void}
 */
function reset() {
  stop();
  state = OutboundPath.UNKNOWN;
  since = null;
  port = null;
  witnesses.clear();
  checking = false;
}

module.exports = {
  OutboundPath,
  REDIRECT_WITNESSES,
  checkOnce,
  getStatus,
  isRedirected,
  outboundPathAPI,
  reset,
  runCheck,
  start,
  stop,
};
