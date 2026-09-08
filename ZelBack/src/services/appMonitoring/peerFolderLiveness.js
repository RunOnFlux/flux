// One answer per peer per monitor pass to "are you there, and which folders do
// you hold?"
//
// Both promotion decisions ask that of the same peers on the same endpoint, and
// the reply carries the peer's whole folder list - so the question is per PEER,
// and only its interpretation is per folder. Asked inside the folder loop it
// became per folder as well: the loop is sequential, an unreachable peer costs
// the full timeout, and a node recovering nine synced folders paid that timeout
// nine times. Past three the pass outruns its own 30s interval and the monitor
// drops whole cycles, so promotions, stall detection and error draining stop for
// every folder on the node, not just the slow one.
//
// Answers live exactly as long as the pass that created them. A peer's liveness
// is the one thing here that must not be remembered: carried into the next pass
// it would report a recovered holder as dead, or a dead one as serving, which is
// the judgement this whole path exists to make.
const axios = require('axios');
const log = require('../../lib/log');
const fluxCommunication = require('../fluxCommunication');
const syncthingService = require('../syncthingService');
const globalState = require('../utils/globalState');
const { extractIp, extractPort } = require('../utils/socketAddressUtils');

// Bounded because this runs on the pass a node is about to promote, and a slow
// peer must not hold the promotion open.
const PROBE_TIMEOUT_MS = 10 * 1000;

// What proportion of this node's peers must still be answering before it will
// conclude that an unreachable holder is dead rather than that it is itself cut
// off. A proportion, not a count: an absolute floor is a fleet size in disguise,
// and a node holding two peers could never clear one written for a node holding
// twelve - trading a two-hour stall for a permanent one.
//
// This detects total isolation, which is what it claims. It does NOT establish
// that this node is on the majority side of a partial split; no local count can,
// and pretending otherwise is how the second writer gets made.
const MIN_RESPONDING_PEER_FRACTION = 0.5;

/**
 * Ask one peer what it is holding.
 *
 * Three outcomes, because the callers need to tell them apart:
 *
 *   REACHABLE AND ANSWERABLE - the peer replied with an answer. `ready` and
 *   `folders` carry it.
 *
 *   REACHABLE BUT NOT ANSWERABLE - the peer replied with an error status. It is
 *   alive, and that is the half that matters most: a peer that answered anything
 *   is not a peer that has died, and treating it as dead drops a live holder out
 *   of the election. It cannot answer THIS question - the endpoint is new, so
 *   every node that has not been upgraded yet replies 404 - and that is not the
 *   same as "has not looked yet": an older peer will never grow the endpoint, so
 *   it never resolves the way an unready peer does.
 *
 *   NOT REACHABLE - no reply at all. Whether the peer is dead or this node is cut
 *   off is the question its callers then have to answer.
 *
 * @param {string} socketAddr Peer socket address
 * @returns {Promise<{reachable: boolean, answerable: boolean, ready: boolean, folders: string[]}>}
 */
async function probePeer(socketAddr) {
  const ip = extractIp(socketAddr);
  const port = extractPort(socketAddr);
  try {
    const response = await axios.get(`http://${ip}:${port}/apps/promotedfolders`, { timeout: PROBE_TIMEOUT_MS });
    const answer = response.data?.data;
    // A peer that has not completed its first monitor pass cannot tell "I hold
    // nothing" from "I have not looked", so its empty list is not a clearance.
    const ready = answer?.ready === true;
    const folders = Array.isArray(answer?.folders) ? answer.folders : [];
    return { reachable: true, answerable: true, ready, folders };
  } catch (error) {
    // error.response exists only when the peer sent one, so this separates a
    // reply we cannot use from no reply at all.
    if (error.response) {
      log.info(`peerFolderLiveness - ${ip} answered ${error.response.status} and cannot say which folders it holds`);
      return { reachable: true, answerable: false, ready: false, folders: [] };
    }
    log.info(`peerFolderLiveness - could not read ${ip}: ${error.message}`);
    return { reachable: false, answerable: false, ready: false, folders: [] };
  }
}

/**
 * A pass's view of its peers. Every peer is asked at most once; `prewarm` asks a
 * whole set at once so the pass pays one timeout rather than one per folder, and
 * `read` answers from that set or asks on demand for a peer it did not cover.
 * Both share one map of in-flight requests, so a peer is never asked twice even
 * when the two paths race.
 * @returns {{read: Function, prewarm: Function, localConnectivity: Function}}
 */
function createPeerFolderLiveness() {
  const answers = new Map();
  let connectivity = null;

  const read = (socketAddr) => {
    if (!answers.has(socketAddr)) answers.set(socketAddr, probePeer(socketAddr));
    return answers.get(socketAddr);
  };

  return {
    read,

    /**
     * Ask every given peer at once. Duplicates collapse, and a peer already read
     * is not asked again.
     * @param {Iterable<string>} socketAddrs Peer socket addresses
     * @returns {Promise<void>}
     */
    async prewarm(socketAddrs) {
      await Promise.all([...new Set(socketAddrs)].map((addr) => read(addr)));
    },

    /**
     * Whether this node can still see the fleet, decided once for the pass. Two
     * folders in one pass must not reach opposite conclusions about whether the
     * silence is a peer's or this node's own.
     * @returns {{connected: boolean, responding: number, total: number}}
     */
    localConnectivity() {
      if (connectivity === null) {
        const { responding, total } = fluxCommunication.peerResponsiveness();
        // No peers at all is not evidence of health: this node holds an app whose
        // other holders exist, so having nobody to talk to is itself the isolation
        // case.
        const connected = total > 0 && responding >= Math.ceil(total * MIN_RESPONDING_PEER_FRACTION);
        connectivity = { connected, responding, total };
      }
      return connectivity;
    },
  };
}

const PeerConnection = Object.freeze({
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  UNKNOWN: 'unknown',
});

/**
 * Why this node cannot hear a peer. `GONE` is the only answer that authorises
 * acting on the silence; the other three are reasons to leave the peer alone.
 */
const SilenceVerdict = Object.freeze({
  GONE: 'gone',
  CONNECTION_ALIVE: 'connectionAlive',
  NO_EVIDENCE: 'noEvidence',
  LOCALLY_ISOLATED: 'locallyIsolated',
});

/**
 * The syncthing device id this node knows the peer by, or null.
 *
 * @param {string} peerIp
 * @returns {Promise<string|null>}
 */
async function peerDeviceId(peerIp) {
  const name = `${extractIp(peerIp)}:${extractPort(peerIp)}`;
  const cached = globalState.syncthingDevicesIDCache.get(name);
  if (cached) return cached;

  // That cache is in-memory and is filled by asking the PEER, so it is empty for
  // exactly the peer this matters for: one that died while this node's own process
  // was restarting, and can no longer be asked anything. This node's syncthing
  // holds the answer on disk - the monitor configured the device under this same
  // name while the peer was still up, and that config outlives both processes.
  // Left unread, the node with a perfectly good local record would report itself
  // ignorant and hold a start for as long as the dead peer's location record lives.
  const devices = await syncthingService.getConfigDevices().catch(() => null);
  if (!Array.isArray(devices)) return null;
  return devices.find((device) => device.name === name)?.deviceID ?? null;
}

/**
 * This node's syncthing's view of its own connection to a peer, for one
 * folder: PeerConnection.CONNECTED, DISCONNECTED, or UNKNOWN.
 *
 * FluxOS and syncthing are separate processes on that peer and fail
 * independently, so silence from its API is not evidence that it has stopped
 * writing - a FluxOS restart takes the API away for tens of seconds while
 * syncthing and the container carry on. A live sync connection IS evidence:
 * syncthing reports remoteState 'valid' only for a device whose connection is
 * open, and clears it the moment the connection closes.
 *
 * The three answers are kept apart because a silence may be acted on only with
 * evidence. 'disconnected' is an answer - this node's syncthing was asked
 * about the device and does not consider it connected. 'unknown' is the
 * absence of one - the peer's device is in neither this node's cache nor its
 * syncthing's own device config, or this node's syncthing did not answer.
 * Collapsing 'unknown' into 'disconnected' would let the one node with the
 * least knowledge authorise a second writer.
 *
 * The peer's own syncthing API is not reachable - it binds to localhost - and
 * does not need to be. This is local state, maintained by the connection
 * itself.
 *
 * @param {string} folderId Folder id, always passed explicitly: the completion
 *   endpoint's aggregate form never sets remoteState and reports 'unknown'.
 * @param {string} peerIp
 * @returns {Promise<string>} One of PeerConnection
 */
async function peerSyncthingConnection(folderId, peerIp) {
  const deviceId = await peerDeviceId(peerIp);
  if (!deviceId) return PeerConnection.UNKNOWN;

  const completion = await syncthingService.getDbCompletion({
    folder: folderId,
    device: deviceId,
  }).catch(() => null);

  if (!completion) return PeerConnection.UNKNOWN;
  return completion.remoteState === 'valid' ? PeerConnection.CONNECTED : PeerConnection.DISCONNECTED;
}

/**
 * What a peer's silence is worth as evidence that it has stopped: one of
 * SilenceVerdict. The caller has already established the silence - this
 * answers only whether it may be acted on.
 *
 * Two decisions rest on this and they ask it identically: dropping a dead
 * holder out of the election, and starting a container a peer may still be
 * running. Both turn a silence into an action over a shared volume, so both
 * owe the same proof.
 *
 * Silence alone is never enough. The verdict needs this node's own syncthing
 * to have been asked about the peer's device and to have answered that it is
 * not connected, AND this node to still be able to see the fleet - a node
 * whose peers have all gone quiet is the one that fell over, and the peer is
 * very likely still serving on the other side of the split.
 *
 * @param {string} folderId
 * @param {string} peerIp
 * @param {Object} liveness This pass's peer view
 * @returns {Promise<string>} One of SilenceVerdict
 */
async function silenceVerdict(folderId, peerIp, liveness) {
  const connection = await peerSyncthingConnection(folderId, peerIp);
  if (connection === PeerConnection.CONNECTED) return SilenceVerdict.CONNECTION_ALIVE;
  if (connection === PeerConnection.UNKNOWN) return SilenceVerdict.NO_EVIDENCE;
  if (!liveness.localConnectivity().connected) return SilenceVerdict.LOCALLY_ISOLATED;
  return SilenceVerdict.GONE;
}

module.exports = {
  createPeerFolderLiveness,
  silenceVerdict,
  SilenceVerdict,
  PROBE_TIMEOUT_MS,
  MIN_RESPONDING_PEER_FRACTION,
};
