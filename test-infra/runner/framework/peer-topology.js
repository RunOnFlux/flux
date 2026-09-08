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

// A stub holds an index in the sorted node list, so the ring routes through it,
// but it never dials and never answers addoutgoingpeer - it cannot supply a
// connection in either direction.
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
  const arc = ringArc(dialers);
  // What a node can actually hold: its two arcs, less any stub that falls inside
  // one. A stub answers neither a dial nor an addoutgoingpeer request, so the
  // nodes whose arcs reach it are short by one and no waiting changes that. It
  // is the nodes at the START of the list that pay, because index 0's backward
  // arc is the one that wraps onto the stub's end of the ring.
  //
  // Conservative on both counts: ringArc is the disjoint arc, so a suite that
  // overrode minOutgoing higher only ever holds MORE than this expects, and the
  // stub subtraction assumes every stub lands inside the arc.
  const reachable = Math.max(1, Math.min(dialers - 1, (2 * arc) - stubCount));
  // The suite's own ask is the target when the fleet can carry it. When it
  // cannot, the fleet's shape is the binding constraint and no request changes
  // it - so take what is reachable rather than waiting out the budget proving
  // arithmetic. Capping is the correct answer here, not an error: the suite
  // asked for a sensible number and the fleet's stub is what makes it
  // unreachable, which is not something a suite should have to reason about.
  return Math.max(1, Math.min(outboundTarget + inboundTarget, reachable));
}
