const axios = require('axios');
const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');
const peerIdentityService = require('../peerIdentityService');
const {
  extractIp, extractPort, socketAddressesMatch, ipsMatch,
} = require('../utils/socketAddressUtils');
const { silenceVerdict, SilenceVerdict } = require('./peerFolderLiveness');

/**
 * What this node can show about a peer's copy of a g: component. UNKNOWN is not
 * a soft NOT_RUNNING: only NOT_RUNNING releases the component for a start here,
 * because starting is what puts a second writer on a shared volume.
 */
const PeerComponent = Object.freeze({
  RUNNING: 'running',
  NOT_RUNNING: 'notRunning',
  UNKNOWN: 'unknown',
});

// Bounded so a slow peer cannot hold a promotion open, and deliberately not
// shortened: a peer cut short answers UNKNOWN and holds the start, so a tighter
// budget buys nothing and costs availability.
const PEER_PROBE_TIMEOUT_MS = 10 * 1000;

// Why a silent peer was left alone, in the words an operator reading the log
// needs: each one is a different thing to go and look at.
const SILENCE_REASONS = Object.freeze({
  [SilenceVerdict.CONNECTION_ALIVE]: "this node's syncthing still holds a live connection to it",
  [SilenceVerdict.NO_EVIDENCE]: 'this node\'s own syncthing has never been connected to it or cannot be asked',
  [SilenceVerdict.LOCALLY_ISOLATED]: 'this node cannot see the fleet either',
});

/**
 * What this node can show one peer to be doing with a component.
 *
 * The election, the surplus rule and a returning primary's stand-down ask this
 * question through the same code. Two implementations of "is that peer running
 * it" drift, and they drift towards whatever answer each caller finds
 * convenient - which for one of them is a removal.
 *
 * `label` names the peer the way its caller knows it, so a log line reads the
 * same whether the peer came from the election order, from the remembered
 * primary, or from the instance order the surplus rule ranks.
 * @param {string} peerSocketAddr The peer's socket address.
 * @param {object} ctx Everything the probe needs that is not the peer.
 * @param {string} ctx.appId Container name for the component.
 * @param {string} ctx.identifier `<component>_<app>` the election keys on.
 * @param {string} ctx.appName Global app name, for the log lines.
 * @param {object} ctx.liveness Peer folder liveness, for judging silence.
 * @param {string} ctx.label How the caller knows this peer.
 * @param {string} ctx.logPrefix Which caller is asking.
 * @returns {Promise<string>} A PeerComponent state.
 */
async function peerComponentState(peerSocketAddr, {
  appId, identifier, appName, liveness, label, logPrefix,
}) {
  // Docker reports names with a leading slash, and getAppIdentifier yields
  // exactly the container name for this component. Compare whole names: a
  // substring test also matches a longer app whose name merely begins the same
  // way - myapp against myapp2, or simplexsmp against simplexsmp1 - and a false
  // positive here means the component is never started at all.
  const peerRunsThisComponent = (appsRunning) => appsRunning.some(
    (app) => (app.Names || []).some((name) => name.replace(/^\//, '') === appId),
  );
  const ipToCheck = extractIp(peerSocketAddr);
  const portToCheck = extractPort(peerSocketAddr);

  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.MASTERSLAVE_BEFORE_PEER_PROBE, peerSocketAddr);

  const { IdentityVerdict, AnswerPurpose } = peerIdentityService;
  const silent = () => silentPeerState(peerSocketAddr, {
    appId, identifier, appName, liveness, label, logPrefix,
  });

  // "Not running" is a clearance to start a second writer, so it counts only
  // from the node at this address: the peer signs what it holds over a
  // challenge this call carries. heldcomponents, not listrunningapps: a peer
  // part-way through its own pre-start ownership fix has committed but has no
  // container, and answering from containers alone reports the component free.
  const asked = await peerIdentityService.askSigned(
    peerSocketAddr,
    '/apps/heldcomponents',
    AnswerPurpose.HELD_COMPONENTS,
    {},
    { timeout: PEER_PROBE_TIMEOUT_MS },
  );
  if (asked.verdict === IdentityVerdict.MISROUTED) {
    fluxEventBus.count('masterSlave:decision', identifier, 'peerMisrouted');
    log.info(`${logPrefix}: a call to peer node (${label}) at ${ipToCheck} was answered by ${asked.answeredAs} for app:${appName} - what it runs is unknown, will not start`);
    return PeerComponent.UNKNOWN;
  }
  if (asked.verdict === IdentityVerdict.VERIFIED) {
    const { held } = asked.answer;
    if (!Array.isArray(held)) {
      log.info(`${logPrefix}: peer node (${label}) at ${ipToCheck} signed an answer that does not list what it holds for app:${appName}, will not start`);
      return PeerComponent.UNKNOWN;
    }
    if (held.includes(appId)) {
      fluxEventBus.count('masterSlave:decision', identifier, 'heldOnPeer');
      log.info(`${logPrefix}: component:${identifier} is held on peer node (${label}) at ${ipToCheck}, will not start`);
      return PeerComponent.RUNNING;
    }
    return PeerComponent.NOT_RUNNING;
  }
  if (asked.verdict === IdentityVerdict.UNREACHABLE) return silent();
  // A reply that does not prove it came from this peer, from a peer that can
  // prove who it is, came from somewhere else.
  if (!asked.mayReadUnsigned) {
    fluxEventBus.count('masterSlave:decision', identifier, 'peerUnproven');
    log.info(`${logPrefix}: a reply from peer node (${label}) at ${ipToCheck} for app:${appName} does not prove it came from that node - what it runs is unknown, will not start`);
    return PeerComponent.UNKNOWN;
  }

  // A peer that cannot prove who it is at all is read unsigned.
  const { CancelToken } = axios;
  const source = CancelToken.source();
  // Cleared once the request settles: every probe otherwise leaves a
  // live 10s timer behind, and this runs for each peer on every pass
  // until the component is running locally.
  const cancelTimer = setTimeout(() => source.cancel('Operation canceled by timeout.'), PEER_PROBE_TIMEOUT_MS);

  try {
    // A peer too old to serve heldcomponents falls back below.
    const heldResponse = await axios.get(`http://${ipToCheck}:${portToCheck}/apps/heldcomponents`, { timeout: PEER_PROBE_TIMEOUT_MS, cancelToken: source.token })
      .catch((error) => {
        // A status is an answer: the peer is alive and merely too old
        // for this endpoint, so fall through to the container list. No
        // reply at all is the case this function exists to judge, and
        // it belongs to the handler below.
        if (!error.response) throw error;
        return null;
      });
    const held = heldResponse?.data?.data;
    if (Array.isArray(held)) {
      if (held.includes(appId)) {
        fluxEventBus.count('masterSlave:decision', identifier, 'heldOnPeer');
        log.info(`${logPrefix}: component:${identifier} is held on peer node (${label}) at ${ipToCheck}, will not start`);
        return PeerComponent.RUNNING;
      }
      return PeerComponent.NOT_RUNNING;
    }

    // The peer HAS the endpoint and it failed. FluxOS answers
    // errors in band, so this arrives as a 200 carrying an error
    // object rather than a list - indistinguishable from a peer
    // too old for the route by shape alone, which is why it is
    // separated here.
    // Falling through would answer from the container list a
    // question the peer has just said it cannot answer, and that
    // list cannot see the durable stop lock at all: a primary its
    // owner stopped to work on reads as free, and this node
    // elects itself over them. Alive and unreadable is UNKNOWN.
    if (heldResponse?.data?.status === 'error') {
      log.info(`${logPrefix}: peer node (${label}) at ${ipToCheck} could not answer what it holds for app:${appName} - alive, and cannot be ruled out, will not start`);
      return PeerComponent.UNKNOWN;
    }

    const response = await axios.get(`http://${ipToCheck}:${portToCheck}/apps/listrunningapps`, { timeout: PEER_PROBE_TIMEOUT_MS, cancelToken: source.token });
    const appsRunning = response.data?.data;
    // A reply this node cannot read is not a clearance. The peer
    // answered, so it is alive; what it is running is simply unknown.
    if (!Array.isArray(appsRunning)) {
      log.info(`${logPrefix}: peer node (${label}) at ${ipToCheck} is alive but did not list what it runs for app:${appName}, will not start`);
      return PeerComponent.UNKNOWN;
    }
    // Match on the g: component identifier, not the app name: non-g siblings
    // (e.g. a DB cluster component) run on every node and must not be mistaken
    // for the master/slave component being active there.
    if (peerRunsThisComponent(appsRunning)) {
      log.info(`${logPrefix}: component:${identifier} is running on peer node (${label}) at ${ipToCheck}, will not start`);
      return PeerComponent.RUNNING;
    }
    return PeerComponent.NOT_RUNNING;
  } catch (error) {
    if (error.response) {
      log.info(`${logPrefix}: peer node (${label}) at ${ipToCheck} answered ${error.response.status} for app:${appName} - alive, and cannot be ruled out, will not start`);
      return PeerComponent.UNKNOWN;
    }
    return silent();
  } finally {
    clearTimeout(cancelTimer);
  }
}

/**
 * What a peer that did not reply at all can be shown to be doing with a
 * component: free only when this node's own syncthing shows the peer's
 * connection to the folder gone.
 * @param {string} peerSocketAddr The peer's socket address.
 * @param {object} ctx As peerComponentState.
 * @returns {Promise<string>} NOT_RUNNING or UNKNOWN.
 */
async function silentPeerState(peerSocketAddr, {
  appId, identifier, appName, liveness, label, logPrefix,
}) {
  const ipToCheck = extractIp(peerSocketAddr);
  const verdict = await silenceVerdict(appId, peerSocketAddr, liveness);
  fluxEventBus.count('peer:silenceVerdict', identifier, verdict);
  if (verdict === SilenceVerdict.GONE) {
    log.info(`${logPrefix}: peer node (${label}) at ${ipToCheck} is silent and this node's syncthing shows its connection for ${appId} gone - the component is free there`);
    return PeerComponent.NOT_RUNNING;
  }
  log.info(`${logPrefix}: peer node (${label}) at ${ipToCheck} is silent for app:${appName} and ${SILENCE_REASONS[verdict]}, will not start`);
  return PeerComponent.UNKNOWN;
}

/**
 * What this node can show the other holders of a component to be doing with it,
 * taken together. One peer that cannot be ruled out decides on its own: every
 * other peer answering "not me" says nothing about that one.
 * @param {Array<{ip: string, label: string}>} peers The other holders.
 * @param {object} ctx As peerComponentState, without `label`.
 * @returns {Promise<string>} RUNNING when any peer runs it, else UNKNOWN when any
 *   peer cannot be ruled out, else NOT_RUNNING - also when there is no one to ask.
 */
async function componentStateOnPeers(peers, ctx) {
  const states = await Promise.all(
    peers.map(({ ip, label }) => peerComponentState(ip, { ...ctx, label })),
  );
  if (states.includes(PeerComponent.RUNNING)) return PeerComponent.RUNNING;
  if (states.includes(PeerComponent.UNKNOWN)) return PeerComponent.UNKNOWN;
  return PeerComponent.NOT_RUNNING;
}

/**
 * What every other holder of a component is doing with it, read from its app
 * locations: the one question a primary returning paused asks before its unsent
 * changes go out or are discarded, whichever pass reaches the folder first.
 * @param {(appName: string) => Promise<Array<{ip: string}>>} readLocations
 * @param {string} localSocketAddr This node, never asked.
 * @param {object} ctx As peerComponentState, without `label`.
 * @param {object} [options]
 * @param {string[]} [options.also] Nodes asked as well when no location shares
 *   their IP - the node FDM names, by IP alone, which can run the component
 *   before its location reaches this node. Asked at the default port.
 * @returns {Promise<string>} As componentStateOnPeers; UNKNOWN when the
 *   locations cannot be read.
 */
async function componentStateOnOtherHolders(readLocations, localSocketAddr, ctx, { also = [] } = {}) {
  let locations;
  try {
    locations = await readLocations(ctx.appName);
  } catch (error) {
    log.warn(`${ctx.logPrefix} - ${ctx.appId}: the other holders cannot be read: ${error.message}`);
    return PeerComponent.UNKNOWN;
  }
  const peers = (locations || [])
    .filter((location) => location?.ip && !socketAddressesMatch(location.ip, localSocketAddr))
    .map((location) => ({ ip: location.ip, label: 'holder' }));
  also
    .filter((ip) => !ipsMatch(ip, localSocketAddr) && !peers.some((peer) => ipsMatch(peer.ip, ip)))
    .forEach((ip) => peers.push({ ip: `${extractIp(ip)}:${extractPort(ip)}`, label: 'FDM primary' }));
  return componentStateOnPeers(peers, ctx);
}

module.exports = {
  PeerComponent,
  peerComponentState,
  componentStateOnPeers,
  componentStateOnOtherHolders,
};
