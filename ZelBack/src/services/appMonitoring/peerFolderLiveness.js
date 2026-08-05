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
 * @param {string} socketAddr Peer socket address
 * @returns {Promise<{reachable: boolean, ready: boolean, folders: string[]}>}
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
    return { reachable: true, ready, folders };
  } catch (error) {
    log.info(`peerFolderLiveness - could not read ${ip}: ${error.message}`);
    return { reachable: false, ready: false, folders: [] };
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

module.exports = {
  createPeerFolderLiveness,
  PROBE_TIMEOUT_MS,
  MIN_RESPONDING_PEER_FRACTION,
};
