/**
 * What a removal attempt did, for a caller that has to decide what to do next.
 *
 * The mirror of InstallOutcome, and for the same reason: three situations end an
 * attempt without the node having removed anything, and they demand different
 * reactions. The app was never there, the node is busy with something else, or the
 * removal got part way and threw. A caller given one value for all of them has only
 * the wording of the response stream left to tell them apart - and a caller that
 * treats "refused" as "done" leaves the app running while believing it gone.
 *
 * REMOVED and NOT_INSTALLED both mean the node does not hold the app, so both settle
 * the question a caller asked. FAILED means it may still hold it. BUSY says nothing
 * about the app at all - only about the node at that instant.
 *
 * BUSY is returned BEFORE the removal lock is acquired, so unlike the others it is
 * not a statement about the app. It is the one outcome a caller must retry rather
 * than act on.
 *
 * Internal only - nothing answers these to a client, so the values are ours as well
 * as the names. They are strings rather than booleans so a call site reads as the
 * question it is asking.
 *
 * Every value is truthy, so `if (!outcome)` is never true: compare against a named
 * value.
 */
const RemovalOutcome = Object.freeze({
  // This attempt removed the app. The node no longer holds it.
  REMOVED: 'removed',
  // The node did not hold the app, so this attempt did nothing. The app is gone, and
  // a caller waiting for the node to be rid of it has its answer.
  NOT_INSTALLED: 'notInstalled',
  // Another install or removal holds the node, so this attempt did nothing. Carries
  // no claim about the app: it is still installed as far as this call knows, and the
  // next attempt may remove it.
  BUSY: 'busy',
  // The removal got part way and threw. The node may still hold the app, whole or in
  // part, so the only safe reading is that it is still there.
  FAILED: 'failed',
});

module.exports = { RemovalOutcome };
