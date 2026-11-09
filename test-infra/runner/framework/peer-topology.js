import { execInContainer } from './container.js';

// What a fleet's peering can be waited on, derived from its shape.
//
// Discovery builds a deterministic ring in two halves (fluxCommunication.js):
//   forward   i dials i+1..i+k directly                  -> k OUTBOUND for i
//   backward  i asks i-1..i-k to dial it back, over
//             /flux/addoutgoingpeer                      -> k INBOUND for i
//
// Both halves are guarded by shouldAttemptConnection, which is direction-blind:
// it refuses as soon as the peer is known at all. So the arcs must be DISJOINT,
// or a peer that appears in both is claimed by whichever half reaches it first
// and the other half silently skips it. That is the whole content of the
// 2k+1 rule - it is the disjointness condition, not a heuristic:
//
//   arc sets are disjoint  <=>  2k < dialers  <=>  dialers >= 2k+1
//
// Disjoint, every node ends on exactly k outbound and k inbound, decided by the
// ring rather than by timing. Overlapping, the split is a race the fleet runs
// against itself, and a wait on either direction is a wait on a coin toss.
// Measured on a 7-node fleet carrying k=4 (suite 78, needing 9):
//   totals  5 5 6 6 6 6            <- still set by the ring
//   splits  4/1 3/2 3/3 3/3 2/4 4/2   <- set by the race
//
// The inbound half is not decoration: a peer can only dial you if your address
// is genuinely reachable, so inbound is a node's proof it is not sitting behind
// NAT on a private address. It cannot be substituted with a total.

// The production value in test-infra/config/shared.js. A fleet too small to
// carry it derives lower; if the two ever diverge this only caps further down,
// which is the safe direction.
const RING_ARC = 4;

/**
 * `asker` asks `dialer` to dial it, as the backward half of discovery does: a
 * node dials only the address the ask comes from, so it is sent from inside the
 * asker's container. Throws unless the dialer took it or is already connected
 * to the asker. Taking it is not connecting: an asker not yet accepting peers
 * (peers:accepting) refuses the dial.
 * @param {object} asker A node client (its container and ip).
 * @param {object} dialer A node client.
 * @param {number} [port] The api port both answer on.
 * @returns {Promise<void>}
 */
export async function askToBeDialed(asker, dialer, port = 16127) {
  const url = `http://${dialer.ip}:${port}/flux/addoutgoingpeer/${asker.ip}:${port}`;
  const { output } = await execInContainer(asker.container, `curl -s ${url}`);
  if (!/"status":"success"/.test(output) && !/Already connected to/.test(output)) {
    throw new Error(`askToBeDialed: ${dialer.ip} did not take ${asker.ip}'s ask to be dialed: ${output}`);
  }
}

/**
 * Whether a node holds a connection to an address, in either direction. Both
 * routes are cached for 30 seconds, so each read names a fresh URL.
 * @param {object} client A node client.
 * @param {string} ip The other end's address.
 * @returns {Promise<boolean>}
 */
export async function isPeeredWith(client, ip) {
  const lists = await Promise.all(['/flux/connectedpeers', '/flux/incomingconnections']
    .map((route) => client.request('GET', `${route}?_=${Date.now()}`)));
  return lists.some(({ data }) => Array.isArray(data?.data) && data.data.includes(ip));
}

// A stub holds an index in the sorted node list, so the ring routes through it,
// but it never dials and never answers addoutgoingpeer. A node's own dial reaches
// it; nothing else connects them.
export function dialerCount(nodeCount, stubCount = 0) {
  return Math.max(nodeCount - stubCount, 1);
}

/**
 * The largest ring arc whose forward and backward halves stay disjoint, so that
 * every node's outbound and inbound counts are decided by the ring instead of
 * by whichever half won a race.
 *
 * @param {number} dialers
 * @returns {number}
 */
export function ringArc(dialers) {
  return Math.max(1, Math.min(RING_ARC, Math.floor((dialers - 1) / 2)));
}

/**
 * The peer thresholds a fleet of this shape can actually satisfy. Injected as
 * the fleet's config so no suite has to know the arithmetic; a suite that is
 * TESTING a threshold sets its own and that wins.
 *
 * @param {number} nodeCount
 * @param {number} stubCount
 */
export function derivePeerThresholds(nodeCount, stubCount = 0) {
  const arc = ringArc(dialerCount(nodeCount, stubCount));
  // Each is capped by BOTH the production value and the arc, so a fleet large
  // enough to carry production comes out byte-identical to it and only a fleet
  // that cannot gets something smaller. The ratios are production's, not ours.
  return {
    minOutgoing: arc,
    minIncoming: Math.min(2, arc),
    minUniqueIpsOutgoing: Math.min(3, arc),
    minUniqueIpsIncoming: Math.min(2, arc),
  };
}

// Production's readiness thresholds (ZelBack/config/default.js,
// fluxapps.appSyncPeerThreshold and appSyncDegradedThreshold) and what a production
// node actually carries: 26 peers at the tenth percentile, measured over 228 fleet
// nodes and ~20,700 node-hours on 2026-09-12 - the measurement default.js records
// above the peer-set dip settings. tests/unit/peerTopology.test.js asserts the two
// thresholds still match the fleet's.
export const PRODUCTION_READINESS = Object.freeze({
  peerThreshold: 12,
  degradedThreshold: 4,
  carriedP10: 26,
});

/**
 * The peers each node of a fleet of this shape carries once its ring has closed:
 * both arcs, and never more than the fleet has to offer.
 * @param {number} nodeCount
 * @param {number} stubCount
 * @returns {number}
 */
export function carriedPeers(nodeCount, stubCount = 0) {
  if (nodeCount <= 1) return 0;
  return Math.min(nodeCount - 1, 2 * ringArc(dialerCount(nodeCount, stubCount)));
}

/**
 * The readiness thresholds that give a fleet of this shape production's margin.
 *
 * A node announces the apps it runs only once it is ready, and it is ready only
 * while it holds appSyncPeerThreshold peers. Production asks for 12 of the 26 peers
 * even a tenth-percentile node carries, so a node that loses connections - to a
 * restart, to a peer leaving - is ready again long before its locations lapse. A
 * harness ring carries exactly 2 * arc, and asked for the shared threshold a small
 * fleet has no margin: a node one connection short stays silent until the ring
 * closes again, its locations lapse after locationTtlS, and its standbys are right
 * to take its apps - a state a production node does not reach.
 *
 * So each threshold is the share of what a node carries that production's is: at
 * least 1, since a node with no peers is never ready, and never above the shared
 * value it compresses, so a fleet large enough to carry that comes out unchanged.
 * The degraded threshold is never above the ready one. Injected as the fleet's
 * config like derivePeerThresholds; a suite that is TESTING a threshold sets its
 * own and that wins.
 * @param {number} nodeCount
 * @param {number} stubCount
 * @param {{appSyncPeerThreshold: number, appSyncDegradedThreshold: number}} shared
 *   the shared fleet's values
 * @returns {{appSyncPeerThreshold: number, appSyncDegradedThreshold: number}}
 */
export function deriveReadinessThresholds(nodeCount, stubCount, shared) {
  const carried = carriedPeers(nodeCount, stubCount);
  const shareOf = (production, cap) => Math.min(
    cap,
    Math.max(1, Math.floor((carried * production) / PRODUCTION_READINESS.carriedP10)),
  );
  const appSyncPeerThreshold = shareOf(PRODUCTION_READINESS.peerThreshold, shared.appSyncPeerThreshold);
  return {
    appSyncPeerThreshold,
    appSyncDegradedThreshold: Math.min(
      appSyncPeerThreshold,
      shareOf(PRODUCTION_READINESS.degradedThreshold, shared.appSyncDegradedThreshold),
    ),
  };
}

// Production's admissionQuorum and admissionLinkTarget (ZelBack/config/default.js);
// tests/unit/peerTopology.test.js holds them together.
export const PRODUCTION_ADMISSION_QUORUM = 3;
export const PRODUCTION_ADMISSION_LINK_TARGET = 5;

/**
 * The admission quorum a fleet of this shape can meet. A node admits an unpaid
 * app message only while it holds admissionQuorum authenticated links on distinct
 * IPs, and only an Arcane node listed at its own address authenticates, so the
 * quorum is what the node that fares worst can count: reachablePeers, less every
 * node no link authenticates with, since one may sit in any arc, less the margin production keeps above its quorum
 * (admissionLinkTarget - admissionQuorum), so a peer or two can be away and a
 * registration still goes through. A fleet that carries production's links keeps
 * production's quorum; a smaller one gets what it carries past the margin, and a
 * node with nothing past it admits on its own. Injected as the fleet's config like
 * the thresholds above; a suite TESTING the quorum sets its own and that wins.
 * @param {number} nodeCount
 * @param {number} absentCount Stubs and deferred nodes.
 * @param {number} unlinkableCount Dialing nodes no link authenticates with:
 *   legacy nodes, and nodes not listed at their own address.
 * @returns {number}
 */
export function deriveAdmissionQuorum(nodeCount, absentCount, unlinkableCount) {
  const reachable = reachablePeers(dialerCount(nodeCount, absentCount), absentCount);
  const margin = PRODUCTION_ADMISSION_LINK_TARGET - PRODUCTION_ADMISSION_QUORUM;
  return Math.min(PRODUCTION_ADMISSION_QUORUM, Math.max(0, reachable - unlinkableCount - margin));
}

/**
 * The peers the worst-placed node of a ring can hold once it has closed: its two
 * arcs, less any slot in one that nothing answers on. A stub or a deferred node
 * answers neither a dial nor an addoutgoingpeer request, so the nodes whose arcs
 * reach it are short by one and no waiting changes that. It is the nodes at the
 * START of the list that pay, because index 0's backward arc is the one that
 * wraps onto the absent end of the ring.
 *
 * Conservative on both counts: ringArc is the disjoint arc, so a suite that
 * overrode minOutgoing higher only ever holds MORE than this, and the
 * subtraction assumes every absent slot lands inside the arc.
 * @param {number} dialers
 * @param {number} absentCount Stubs and deferred nodes.
 * @returns {number}
 */
export function reachablePeers(dialers, absentCount = 0) {
  return Math.max(0, Math.min(dialers - 1, (2 * ringArc(dialers)) - absentCount));
}

/**
 * What a node holds in each direction once the ring has closed, against the door's
 * floors. It dials the slots ahead of it and is dialled from the slots behind it.
 * A slot nothing answers on supplies neither, a stub only takes a dial, and a peer
 * in both arcs ends up in whichever direction connects first, so it counts in
 * neither.
 *
 * @param {number} index The node.
 * @param {number[]} ring Every listed index, in list order.
 * @param {object} shape
 * @param {number} shape.minOutgoing
 * @param {number} shape.minIncoming
 * @param {number[]} [shape.absent] Listed indices nothing answers on.
 * @param {number[]} [shape.stubs] Listed indices that take a dial and never make one.
 * @returns {{outbound: number, inbound: number}}
 */
export function ringPeerFloors(index, ring, {
  minOutgoing, minIncoming, absent = [], stubs = [],
}) {
  const size = ring.length;
  const position = ring.indexOf(index);
  const arc = (step) => Array.from(
    { length: Math.min(size, minOutgoing) },
    (_unused, i) => ring[(((position + (step * (i + 1))) % size) + size) % size],
  ).filter((peer) => peer !== index && !absent.includes(peer));
  const ahead = arc(1);
  const behind = arc(-1);
  return {
    outbound: Math.min(minOutgoing, ahead.filter((peer) => !behind.includes(peer)).length),
    inbound: Math.min(minIncoming, behind.filter((peer) => !ahead.includes(peer) && !stubs.includes(peer)).length),
  };
}

/**
 * The peer total each node reaches once the ring has closed. Used for the boot
 * wait: it is the same demand expressed as a sum, which is robust even if a
 * suite has overridden the arc into an overlapping shape.
 *
 * @param {number} outboundTarget
 * @param {number} inboundTarget
 * @param {number} dialers
 */
export function expectedPeerTotal(outboundTarget, inboundTarget, dialers, stubCount = 0) {
  const reachable = Math.max(1, reachablePeers(dialers, stubCount));
  // The suite's own ask is the target when the fleet can carry it. When it
  // cannot, the fleet's shape is the binding constraint and no request changes
  // it - so take what is reachable rather than waiting out the budget proving
  // arithmetic. Capping is the correct answer here, not an error: the suite
  // asked for a sensible number and the fleet's stub is what makes it
  // unreachable, which is not something a suite should have to reason about.
  return Math.max(1, Math.min(outboundTarget + inboundTarget, reachable));
}
