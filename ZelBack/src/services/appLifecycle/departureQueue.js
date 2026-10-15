// Whose turn it is to give up an app, when several holders want to.
//
// The safety gate (appEvacuationSafety) answers for one node at a time: is there
// a complete copy elsewhere, is the app at strength. Two holders that ask in the
// same pass both see the other as that complete copy, and both are told yes. The
// queue is what separates them: a node may act on an app only once it has seen
// that app at full strength for base + position * step, so holders leave one
// after another, and a departure - which takes the app below strength - restarts
// every other holder's wait until the spawner has filled the gap.
//
// A queue is per reason for leaving. Its observations mean "seen whole while
// wanting to leave for this reason", and a node that stops wanting to leave for
// one reason has not been watching on behalf of another.

const config = require('config');
const { compareInstanceSeniority } = require('../utils/instanceOrdering');
const { socketAddressesMatch } = require('../utils/socketAddressUtils');

// Position in the shared instance order is a DELAY, never a veto: a rule of
// "only the most junior may leave" deadlocks, because the replacement is itself
// the most junior and does not want to leave.
const QUEUE_BASE_MS = config.fluxapps.residentialQueueBaseMs;
const QUEUE_STEP_MS = config.fluxapps.residentialQueueStepMs;
// The ticket is served against an UNINTERRUPTED observation - the wait means
// nothing if it can be accumulated across periods this node was not watching -
// and this is what counts as the interruption. A gap longer than this means at
// least one whole give-up pass went by without this node evaluating the app, so
// the observation starts again rather than carrying over. A caller that holds a
// node back above the queue therefore restarts its tickets simply by not asking.
//
// Derived from the step rather than written as its own number, because the step
// is ALREADY required to outlast the pass: that inequality is asserted against
// production's config in the unit tests and re-derived per fleet by
// test-infra's coupled knobs.
//
// TWICE the step, not once. A gap has to mean "a pass did not happen", and one
// step is 1.82 passes - so a single pass running late trips it. The harness
// compresses the same ratio to about 30 seconds, where six fleets booting at
// once make a late pass ordinary, and a ticket restarting every few passes never
// matures at all. Two steps is ~3.6 passes: a pass has to be missed outright,
// not merely be slow.
const MAX_TICKET_GAP_MS = QUEUE_STEP_MS * 2;

/**
 * Monotonic milliseconds. A ticket is an elapsed time inside one process, and
 * the wall clock can be stepped by the node's own operator.
 * @returns {number} Milliseconds since an arbitrary fixed origin.
 */
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * How long this node must have seen an app whole before it may act on it.
 * @param {object[]} locations Instance locations, any order.
 * @param {string} localSocketAddr This node's socket address.
 * @returns {number} Milliseconds.
 */
function queueDelayMs(locations, localSocketAddr) {
  // Junior end first - the same order reasonToGiveUpApp ranks SURPLUS by, and
  // for the same reason: the newest copy stands aside and the senior one goes
  // on holding the data. Ranking the senior end first also put the ONE case
  // that cannot simply leave at the front of the queue, because the elected
  // primary is the senior instance: the node needing a stand-down was asked to
  // go before any of the nodes that could just go, and every node behind it
  // waited out its step while it negotiated. Senior last is both orders
  // agreeing and the cheap departures happening first.
  const ordered = [...locations].sort((a, b) => compareInstanceSeniority(b, a));
  const index = ordered.findIndex((entry) => socketAddressesMatch(entry.ip, localSocketAddr));
  // An instance this node cannot find in the list waits longest. For an EMPTY
  // list `ordered.length` is 0, which is the front of the queue - the shortest
  // wait of all, inverting the rule. An empty list is the ordinary result of
  // expired location records, so it is not an exotic input.
  const position = index < 0 ? Math.max(ordered.length, 1) : index;
  return QUEUE_BASE_MS + (position * QUEUE_STEP_MS);
}

/**
 * A queue for one reason for leaving.
 * @returns {{mayDepart: Function, forget: Function, retainOnly: Function, clear: Function}}
 */
function createDepartureQueue() {
  // Two fields rather than one, because the ticket is an uninterrupted
  // observation and not an elapsed time. `since` is what the wait is measured
  // from; `lastSeenAt` is the only way an interruption can be detected at all -
  // without it a node that stopped looking, or one that was not allowed to act,
  // goes on accruing credit for time it never spent watching.
  const wholeObservation = new Map();

  /**
   * Whether this node's turn to give up this app has come.
   * @param {string} appName Global app name.
   * @param {object[]} locations Instance locations for the app.
   * @param {string} localSocketAddr This node's socket address.
   * @param {number} minInstances How many instances this app is meant to have.
   *   The LOCAL record's count; appEvacuationSafety re-derives from the global
   *   spec, which is the authority at the moment of removal. They can differ
   *   while an owner's instance-count change propagates, and either way round
   *   is safe: too low here lets a ticket run that the safety gate then refuses
   *   as short, and too high only makes the turn wait longer.
   * @param {number} [now] Monotonic ms, injectable for tests.
   * @returns {{ok: boolean, code: string, reason: string}} `code` is
   *   BELOW_INSTANCE_COUNT, AWAITING_TURN or READY. BELOW_INSTANCE_COUNT is
   *   deliberately the name appEvacuationSafety uses for the same fact, because
   *   it IS the same fact asked one layer earlier.
   */
  function mayDepart(appName, locations, localSocketAddr, minInstances, now = monotonicMs()) {
    const previous = wholeObservation.get(appName);
    const gap = previous ? now - previous.lastSeenAt : Infinity;
    // Strength is tested HERE, where the clock is stamped, rather than left to
    // the safety gate. The wait is "seen at full strength for base + position x
    // step"; a clock that starts on the first ASK measures something else, and an
    // app short of its count is one the spawner is part way through replacing.
    // Time spent watching that is not time spent watching it whole.
    const whole = locations.length >= minInstances;
    const since = (!whole || gap > MAX_TICKET_GAP_MS) ? now : previous.since;
    wholeObservation.set(appName, { since, lastSeenAt: now });
    if (!whole) {
      return {
        ok: false,
        code: 'BELOW_INSTANCE_COUNT',
        reason: `app is below its instance count (${locations.length}/${minInstances}); its turn starts again`,
      };
    }
    const wait = queueDelayMs(locations, localSocketAddr);
    const observed = now - since;
    if (observed < wait) {
      return { ok: false, code: 'AWAITING_TURN', reason: `its turn is in ${Math.round((wait - observed) / 60000)}m` };
    }
    return { ok: true, code: 'READY', reason: 'ready' };
  }

  /**
   * Forget an app's observation: it has gone, or it stopped being safe to give
   * up, and the next wait is served from scratch.
   * @param {string} appName Global app name.
   */
  function forget(appName) {
    wholeObservation.delete(appName);
  }

  /**
   * Forget every app not in `names`: one that left by a route the caller never
   * saw holds an observation nothing will ask about again.
   * @param {Set<string>} names Apps still held.
   */
  function retainOnly(names) {
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of wholeObservation.keys()) {
      if (!names.has(appName)) wholeObservation.delete(appName);
    }
  }

  function clear() {
    wholeObservation.clear();
  }

  return {
    mayDepart, forget, retainOnly, clear,
  };
}

module.exports = {
  createDepartureQueue,
  queueDelayMs,
  QUEUE_BASE_MS,
  QUEUE_STEP_MS,
  MAX_TICKET_GAP_MS,
};
