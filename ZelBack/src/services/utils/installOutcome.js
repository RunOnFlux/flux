/**
 * What an install attempt did, for a caller that has to decide what to do next.
 *
 * Four different situations end an attempt without it installing the app, and they
 * demand four different reactions: the app is already there, the node is busy with
 * something else, the node will not take the app, or the install got part way and
 * tore it down. A caller given one value for all of them has only the wording of
 * the response stream left to tell them apart.
 *
 * INSTALLED and ALREADY_INSTALLED both mean the node holds the app. DECLINED and
 * FAILED both mean it does not. BUSY says nothing about the app at all - only about
 * the node at that instant.
 *
 * Every outcome except BUSY is returned after the install hold is acquired, so each
 * is a true statement about the app whoever asked for it: concurrent attempts are
 * serialised, and the ones that lose get BUSY. BUSY is therefore the only outcome a
 * caller must keep waiting through rather than act on.
 *
 * Internal only - nothing answers these to a client, so unlike Privilege the values
 * are ours as well as the names. They are strings rather than booleans so a call
 * site reads as the question it is asking.
 *
 * Every value is truthy, so `if (!outcome)` is never true: compare against a named
 * value.
 */
const InstallOutcome = Object.freeze({
  // This attempt installed the app, and it is running.
  INSTALLED: 'installed',
  // The node already held the app, so this attempt did nothing. The app is there,
  // and a caller waiting for the node to hold it has its answer.
  ALREADY_INSTALLED: 'alreadyInstalled',
  // Another install or removal holds the node, so this attempt did nothing. Carries
  // no claim about the app: the operation in the way may be an install of this very
  // app, and the next attempt may install it.
  BUSY: 'busy',
  // The node will not take this app, and nothing was touched. Whatever was running
  // before is still running.
  DECLINED: 'declined',
  // The install got part way and cleaned up after itself, so the app is no longer on
  // this node. The only outcome that justifies a caller acting on the loss.
  FAILED: 'failed',
});

module.exports = { InstallOutcome };
