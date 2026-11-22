/**
 * What a removal attempt did, for a caller that has to decide what to do next.
 *
 * The app was removed, was never there, the removal got part way and threw, or the
 * removal waits behind another operation on the app. A caller given one value for
 * all of them has only the wording of the response stream left to tell them apart.
 *
 * REMOVED and NOT_INSTALLED both mean the node does not hold the app, so both settle
 * the question a caller asked. FAILED and PENDING mean it still holds it.
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
  // The removal got part way and threw. The node may still hold the app, whole or in
  // part, so the only safe reading is that it is still there.
  FAILED: 'failed',
  // Another operation holds the app. The removal has asked it to stop and runs once
  // the app is free; a removal of the same app sent meanwhile joins it.
  PENDING: 'pending',
});

module.exports = { RemovalOutcome };
