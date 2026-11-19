// A manager per app: every operation on an app - an install, a removal, a
// redeploy, a backup, a restore, an owner's start, stop or restart - is sent to
// the app's manager with submit(), which runs them one at a time and releases the
// app when each ends, on every exit. Nothing is released on a timer. When the app
// is busy, the arriving operation's rule decides:
//   - a removal stops the running operation at its next step (preempt), refuses
//     what is pending, and runs next; a removal of the same target (the app, or
//     one component) arriving while one is pending or running gets that removal's
//     outcome, and one of another target runs after it;
//   - a redeploy or an install waits in the app's manager and runs once the app
//     is free; a pending one of the same type takes the newest, and every caller
//     gets its outcome; refused while a removal is pending or running, and while
//     the app is busy when its caller asks not to wait;
//   - a backup, a restore or an owner action is taken now or refused.
// A wait is the app's own: a caller that needs no outcome sends and moves on, so
// one app's wait never holds another. A step of an operation - a redeploy's
// removal and install - runs under that operation, passed as `parent`. In memory
// only: after a restart no operation is in progress.

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

// key -> { type, owner, token, controller }
const leases = new Map();
// key -> the operations waiting for the app, in the order they run
const queues = new Map();
// key -> [{ target, promise }], the removals pending or running on the app
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
    type, owner, token, controller: new AbortController(),
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
  // eslint-disable-next-line no-use-before-define
  startNext(key);
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
 * Runs `entry` holding the app: takes the app now, calls the entry's newest `fn`
 * once the take is done, and settles the entry with what it returns.
 * @param {string} key
 * @param {object} entry
 */
function start(key, entry) {
  const token = acquire(key, entry.type, entry.owner);
  const op = {
    key, type: entry.type, token, signal: signalOf(key, token),
  };
  (async () => {
    try {
      await null;
      entry.resolve(await entry.fn(op));
    } catch (error) {
      entry.reject(error);
    } finally {
      release(key, token);
    }
  })();
}

/**
 * Starts the app's next waiting operation, when the app is free.
 * @param {string} key
 */
function startNext(key) {
  if (leases.has(key)) return;
  const queue = queues.get(key);
  const next = queue?.shift();
  if (!queue?.length) queues.delete(key);
  if (next) start(key, next);
}

function entryFor(type, fn, owner) {
  const entry = { type, fn, owner };
  entry.promise = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
  });
  // A caller that sends and moves on reads no outcome; one that awaits still
  // receives the rejection.
  entry.promise.catch(() => {});
  return entry;
}

/**
 * Sends an operation to the app's manager.
 * @param {string} key The app's name.
 * @param {string} type 'install' | 'remove' | 'redeploy' | 'backup' | 'restore' | 'control'.
 * @param {function({key: string, type: string, token: string, signal: AbortSignal}): Promise<*>} fn
 *   The operation. Its `signal` aborts when a removal stops it; it checks
 *   `throwIfPreempted(op.signal)` between its steps.
 * @param {object} [options]
 * @param {string} [options.owner] The calling site, for diagnostics.
 * @param {string} [options.target] What a removal removes - the app, or one of
 *   its components; the app when not given.
 * @param {object} [options.parent] The operation this one is a step of: `fn`
 *   runs under the parent's hold, with the parent's op.
 * @param {boolean} [options.wait] For a redeploy or install: false refuses it
 *   while the app is busy, for a caller whose next round asks again.
 * @param {function({holder: string}): void} [options.onWait] Told when the
 *   operation waits for the app, before it waits.
 * @returns {Promise<*>} What `fn` returns - for a joined removal or a coalesced
 *   redeploy or install, what the operation that ran returns. Rejects with
 *   OperationRefusedError when the rule refuses, and with what `fn` throws.
 */
function submit(key, type, fn, {
  owner = type, target = key, parent = null, onWait = null, wait = true,
} = {}) {
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
  const removing = removals.get(key);
  if (removing && type !== 'remove') return Promise.reject(new OperationRefusedError(key, 'remove'));
  const holder = leases.get(key)?.type;

  if (type === 'remove') {
    const same = removing?.find((removal) => removal.target === target);
    if (same) return same.promise;
    const entry = entryFor(type, fn, owner);
    const removal = { target, promise: entry.promise };
    const forget = () => {
      const left = (removals.get(key) || []).filter((each) => each !== removal);
      if (left.length) removals.set(key, left);
      else removals.delete(key);
    };
    entry.promise.then(forget, forget);
    if (removing) {
      // after the removals already sent, which nothing else waits behind
      removing.push(removal);
      queues.set(key, [...(queues.get(key) || []), entry]);
      if (holder && onWait) onWait({ holder });
      startNext(key);
      return entry.promise;
    }
    (queues.get(key) || []).forEach((waiting) => waiting.reject(new OperationRefusedError(key, 'remove')));
    queues.set(key, [entry]);
    removals.set(key, [removal]);
    if (holder) {
      preempt(key, OPERATION_NAMES.remove);
      if (onWait) onWait({ holder });
    }
    startNext(key);
    return entry.promise;
  }

  if (type === 'redeploy' || type === 'install') {
    const queue = queues.get(key) || [];
    if (!wait && holder) return Promise.reject(new OperationRefusedError(key, holder));
    const pending = queue.find((waiting) => waiting.type === type);
    if (pending) {
      pending.fn = fn;
      return pending.promise;
    }
    const entry = entryFor(type, fn, owner);
    queues.set(key, [...queue, entry]);
    if (holder && onWait) onWait({ holder });
    startNext(key);
    return entry.promise;
  }

  if (holder) return Promise.reject(new OperationRefusedError(key, holder));
  const entry = entryFor(type, fn, owner);
  start(key, entry);
  return entry.promise;
}

// Drops every lease and every operation waiting. For tests.
function clear() {
  removals.clear();
  queues.clear();
  leases.clear();
}

module.exports = {
  OPERATION_NAMES,
  OperationPreemptedError,
  OperationRefusedError,
  submit,
  acquire,
  release,
  get,
  isHeld,
  listByType,
  preempt,
  signalOf,
  throwIfPreempted,
  clear,
};
