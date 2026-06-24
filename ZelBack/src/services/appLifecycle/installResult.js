/**
 * The outcome of a local app (re)install attempt (registerAppLocally / softRegisterAppLocally)
 * as a 3-state enum, NOT a boolean. A DEFERRED is a transient state (a removal/install is in
 * progress, a same-name teardown is still owed, or the node tier is not yet resolved) and must
 * be RETRIED; a FAILED is a real failure (the app is already installed, or the install threw and
 * was cleaned up). The spawner retries a DEFERRED WITHOUT poisoning its 7-day spawn-error cache,
 * but may 7-day-cache a FAILED - so the two cannot be the same value.
 *
 * Object.freeze'd so the literal set cannot drift, and to kill the boolean-era truthy trap:
 * every member is a string, so `if (result)` is never a valid check (DEFERRED/FAILED are both
 * truthy) - callers MUST compare against a named member.
 */
const InstallResult = Object.freeze({
  INSTALLED: 'installed', // success: the app's containers were created + started
  DEFERRED: 'deferred', // transient: retry, do NOT cache as a failure
  FAILED: 'failed', // real failure: the spawner may 7-day-cache the hash
});

module.exports = InstallResult;
