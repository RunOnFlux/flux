// One operation per app at a time: a lease keyed by the app's name, held by a
// backup, a restore, a removal or a redeploy of that app from its start until it
// ends. A second operation on the same app finds the lease and does what its rule
// says:
//   - a removal asks a backup or restore holding the app to stop (preempt) and
//     waits for its release, since the archive of a backup and the data of a
//     restore sit on the volume the removal deletes;
//   - a redeploy waits for a backup or restore to end, since it can delete the
//     data the backup is copying or the restore is writing;
//   - a backup or restore is refused while anything holds the app.
// A lease is released by the operation that took it, in its finally, so every
// wait ends when that operation ends. In memory only: after a restart no
// operation is in progress.

class OperationPreemptedError extends Error {
  constructor(key, by) {
    super(`${key}: stopped for its ${by}`);
    this.name = 'OperationPreemptedError';
    this.key = key;
    this.by = by;
  }
}

// key -> { type, owner, token, controller, waiters }
const leases = new Map();
let nextToken = 0;

/**
 * Takes the app's lease for an operation.
 * @param {string} key The app's name.
 * @param {string} type 'backup' | 'restore' | 'remove' | 'redeploy'.
 * @param {string} owner The taking call site, for diagnostics.
 * @returns {string|null} A release token, or null when another operation holds the app.
 */
function acquire(key, type, owner) {
  if (leases.has(key)) return null;
  nextToken += 1;
  const token = `lease-${nextToken}`;
  leases.set(key, {
    type, owner, token, controller: new AbortController(), waiters: [],
  });
  return token;
}

/**
 * Releases the app's lease when `token` is the one that took it; any other token
 * releases nothing, so a call that never took the lease cannot drop another's.
 * @param {string} key
 * @param {string|null} token
 * @returns {boolean} Whether a lease was released.
 */
function release(key, token) {
  const lease = leases.get(key);
  if (!lease || !token || lease.token !== token) return false;
  leases.delete(key);
  lease.waiters.forEach((resolve) => resolve());
  return true;
}

/**
 * @param {string} key
 * @returns {{type: string, owner: string}|null} The operation holding the app, or null.
 */
function get(key) {
  const lease = leases.get(key);
  return lease ? { type: lease.type, owner: lease.owner } : null;
}

function isHeld(key) {
  return leases.has(key);
}

/**
 * @param {string} type
 * @returns {string[]} The apps an operation of this type holds.
 */
function listByType(type) {
  return [...leases.entries()].filter(([, lease]) => lease.type === type).map(([key]) => key);
}

/**
 * Resolves when the app's current lease is released; at once when none is held.
 * @param {string} key
 * @returns {Promise<void>}
 */
function whenReleased(key) {
  const lease = leases.get(key);
  if (!lease) return Promise.resolve();
  return new Promise((resolve) => { lease.waiters.push(resolve); });
}

/**
 * Asks the operation holding the app to stop: its signal aborts, with an
 * OperationPreemptedError naming `by` as the reason.
 * @param {string} key
 * @param {string} by What it stops for, e.g. 'removal'.
 * @returns {boolean} Whether an operation was asked.
 */
function preempt(key, by) {
  const lease = leases.get(key);
  if (!lease) return false;
  if (!lease.controller.signal.aborted) lease.controller.abort(new OperationPreemptedError(key, by));
  return true;
}

/**
 * The signal of the lease `token` took, aborted when the operation is asked to stop.
 * @param {string} key
 * @param {string} token
 * @returns {AbortSignal|null}
 */
function signalOf(key, token) {
  const lease = leases.get(key);
  return lease && lease.token === token ? lease.controller.signal : null;
}

/**
 * Throws the signal's reason once the operation has been asked to stop. Called
 * by a holder between its steps.
 * @param {AbortSignal|null} signal
 */
function throwIfPreempted(signal) {
  if (signal?.aborted) throw signal.reason;
}

// Drops every lease, resolving their waiters. For tests.
function clear() {
  const held = [...leases.values()];
  leases.clear();
  held.forEach((lease) => lease.waiters.forEach((resolve) => resolve()));
}

module.exports = {
  OperationPreemptedError,
  acquire,
  release,
  get,
  isHeld,
  listByType,
  whenReleased,
  preempt,
  signalOf,
  throwIfPreempted,
  clear,
};
