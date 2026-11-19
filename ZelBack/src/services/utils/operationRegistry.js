// One owner for every operation on an app: a lease keyed by the app's name, held
// by an install, a removal, a redeploy, a backup, a restore or an owner's start,
// stop or restart of that app from its start until it ends. run() takes the app
// for an operation; when another holds it, the arriving operation's rule decides:
//   - a removal stops the holder at its next step (preempt) and runs once it is
//     released; a removal arriving while one is pending or running gets that
//     removal's outcome;
//   - a backup, a restore or an owner action is refused;
//   - a redeploy or an install runs once the holder is released, and is refused
//     while a removal is pending or running.
// A step of an operation - a redeploy's removal and install - runs under that
// operation, passed as `parent`, never as a second operation. The app is released
// when its operation ends, on every exit, and every wait ends on that release;
// nothing is released on a timer. In memory only: after a restart no operation is
// in progress.

// What each operation is called in a refusal.
const OPERATION_NAMES = Object.freeze({
  install: 'installation',
  remove: 'removal',
  redeploy: 'redeploy',
  backup: 'backup',
  restore: 'restore',
  control: 'start, stop or restart',
});

class OperationPreemptedError extends Error {
  constructor(key, by) {
    super(`${key}: stopped for its ${by}`);
    this.name = 'OperationPreemptedError';
    this.key = key;
    this.by = by;
  }
}

class OperationRefusedError extends Error {
  constructor(key, holder) {
    super(`Refused: a ${OPERATION_NAMES[holder] || holder} of ${key} is in progress`);
    this.name = 'OperationRefusedError';
    this.key = key;
    this.holder = holder;
  }
}

// key -> { type, owner, token, controller, waiters }
const leases = new Map();
// key -> the outcome of the removal pending or running on the app
const removals = new Map();
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

/**
 * What an arriving operation does when another holds the app. A removal pending
 * or running refuses every other operation before this is asked.
 * @param {string} type The arriving operation.
 * @returns {'preempt'|'wait'|'refuse'}
 */
function ruleFor(type) {
  if (type === 'remove') return 'preempt';
  if (type === 'redeploy' || type === 'install') return 'wait';
  return 'refuse';
}

/**
 * Takes the app, runs `fn` holding it, and releases it when `fn` settles.
 * @param {string} key The app's name.
 * @param {string} type 'install' | 'remove' | 'redeploy' | 'backup' | 'restore' | 'control'.
 * @param {function({key: string, type: string, token: string, signal: AbortSignal}): Promise<*>} fn
 *   The operation. Its `signal` aborts when a removal stops it; it checks
 *   `throwIfPreempted(op.signal)` between its steps.
 * @param {object} [options]
 * @param {string} [options.owner] The calling site, for diagnostics.
 * @param {object} [options.parent] The operation this one is a step of: `fn`
 *   runs under the parent's hold, with the parent's op.
 * @param {function({holder: string, preempted: boolean}): void} [options.onWait]
 *   Told each time the operation waits on a holder, before it waits.
 * @returns {Promise<*>} What `fn` returns. Rejects with OperationRefusedError
 *   when the rule refuses, and with what `fn` throws.
 */
function run(key, type, fn, { owner = type, parent = null, onWait = null } = {}) {
  if (parent) {
    const lease = leases.get(key);
    if (!lease || lease.token !== parent.token) {
      return Promise.reject(new Error(`${key}: a ${type} step of an operation that does not hold the app`));
    }
    try {
      throwIfPreempted(parent.signal);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve().then(() => fn(parent));
  }
  if (type === 'remove' && removals.has(key)) return removals.get(key);
  if (type !== 'remove' && removals.has(key)) return Promise.reject(new OperationRefusedError(key, 'remove'));

  const admitted = (async () => {
    let lease = leases.get(key);
    while (lease) {
      const rule = ruleFor(type);
      if (rule === 'refuse') throw new OperationRefusedError(key, lease.type);
      if (rule === 'preempt') preempt(key, OPERATION_NAMES[type]);
      if (onWait) onWait({ holder: lease.type, preempted: rule === 'preempt' });
      // eslint-disable-next-line no-await-in-loop
      await whenReleased(key);
      if (type !== 'remove' && removals.has(key)) throw new OperationRefusedError(key, 'remove');
      lease = leases.get(key);
    }
    const token = acquire(key, type, owner);
    const op = {
      key, type, token, signal: signalOf(key, token),
    };
    try {
      return await fn(op);
    } finally {
      release(key, token);
    }
  })();
  if (type === 'remove') {
    removals.set(key, admitted);
    const forget = () => { if (removals.get(key) === admitted) removals.delete(key); };
    admitted.then(forget, forget);
  }
  return admitted;
}

// Drops every lease, resolving their waiters. For tests.
function clear() {
  removals.clear();
  const held = [...leases.values()];
  leases.clear();
  held.forEach((lease) => lease.waiters.forEach((resolve) => resolve()));
}

module.exports = {
  OPERATION_NAMES,
  OperationPreemptedError,
  OperationRefusedError,
  run,
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
