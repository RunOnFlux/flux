/**
 * What an install attempt did, for a caller that has to decide what to clean up.
 *
 * A boolean cannot carry this. `false` meant both "another operation holds the
 * node, I touched nothing" and "I got part way, it failed, and I have already
 * torn the app down" - and a redeploy reading the first as the second answered a
 * five-second scheduling collision by force-uninstalling a running application
 * and broadcasting its removal to the network.
 *
 * The distinction is the whole point: REFUSED means the app is exactly as it was,
 * FAILED means it is gone.
 *
 * Internal only - nothing answers these to a client, so unlike Privilege the
 * values are ours as well as the names. They are strings rather than booleans so
 * a call site reads as the question it is asking.
 *
 * All three are truthy, so a caller left on `if (!outcome)` reads a refusal as a
 * success. That is why every call site was changed with the return type rather
 * than left to be found later.
 */
const InstallOutcome = Object.freeze({
  // The app is installed and running.
  INSTALLED: 'installed',
  // Nothing was touched. Another operation holds the node, or the app is already
  // installed. Whatever was running before is still running, and the caller has
  // nothing to undo.
  REFUSED: 'refused',
  // The install got part way and cleaned up after itself, so the app is no longer
  // on this node. The only outcome that justifies a caller acting on the loss.
  FAILED: 'failed',
});

module.exports = { InstallOutcome };
