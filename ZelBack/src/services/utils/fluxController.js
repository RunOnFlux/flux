const { AsyncLock } = require('./asyncLock');

/**
 * What the controller is for, as opposed to what its signal is doing.
 *
 * A signal fires once and has to be replaced to run again, so it cannot also
 * carry whether the loop is meant to be running: replacing it makes "stopped"
 * stop being true while the thing is still stopping, and whatever reads it next
 * schedules another iteration. The state below is the durable answer, and the
 * signal goes back to being what it is - a cancellation for the work in flight.
 */
const ControllerState = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  STOPPING: 'stopping',
});

class FluxController {
  /**
   * Used for functions to stop work
   */
  #abortController = new AbortController();

  /**
   * How many loops has been completed
   */
  #loopCount = 0;

  /**
   * Main flux function loop timer
   */
  #loopTimeout = null;

  /**
   * Incremental Id used for each sleep request
   */
  #timeoutId = 0;

  /**
   * Keeps track of any sleeps that are running
   */
  #timeouts = new Map();

  /**
   * Whether the loop is meant to be running. The only thing that decides
   * whether an iteration schedules the next one.
   */
  #state = ControllerState.IDLE;

  /**
   * Which run a loop belongs to. An iteration that was already in flight when
   * the controller was stopped belongs to the run before this one, and must not
   * arm a timer beside the loop a later start has since begun.
   */
  #generation = 0;

  /**
   * async locks for functions to be able to tell the controller
   * that work is still being done
   */
  #locks = new Map([['default', new AsyncLock()]]);

  /**
   * Which locks a stop waits for. The default one always; a named one only if
   * it was added as a barrier.
   */
  #abortBlockers = new Set(['default']);

  get ['lock']() {
    return this.#locks.get('default');
  }

  get ['aborted']() {
    return this.#abortController.signal.aborted;
  }

  get ['locked']() {
    return this.lock.locked;
  }

  /**
   * Whether anything is here to start beside. Not idle, rather than running: a
   * controller part way through a stop is not one to start a second loop
   * against, and a caller that read a stop in progress as stopped would reset
   * its own state for a loop startLoop then refuses to begin.
   *
   * Guard a start on this. Condition a loop on `active`.
   */
  get ['running']() {
    return this.#state !== ControllerState.IDLE;
  }

  /**
   * Whether the run this work belongs to is still wanted.
   *
   * The condition for a runner that loops on its own rather than returning a
   * delay. `aborted` cannot answer it: the signal is reissued when the abort
   * finishes, so a loop that yields and re-reads it after the stop has
   * completed sees false and carries on for the life of the process. This says
   * no from the first line of `abort()` until the next `startLoop()`, whenever
   * it is asked.
   *
   * Only from INSIDE a run. It is false when no loop is running, so a function
   * that is called both as the runner and directly by something else must ask
   * `aborted` instead - "is a cancellation in flight" - or it does nothing at
   * all when nobody has started a loop.
   */
  get ['active']() {
    return this.#state === ControllerState.RUNNING;
  }

  get ['state']() {
    return this.#state;
  }

  get ['loopCount']() {
    return this.#loopCount;
  }

  get ['signal']() {
    return this.#abortController.signal;
  }

  /**
   * An interruptable sleep. If you call abort() on the controller,
   * The promise will reject immediately with { name: 'AbortError' }.
   * @param {number} ms How many milliseconds to sleep for
   * @returns {Promise<void>}
   */
  sleep(ms) {
    this.#timeoutId += 1;
    const id = this.#timeoutId;
    return new Promise((resolve, reject) => {
      this.#timeouts.set(id, [reject, setTimeout(() => {
        this.#timeouts.delete(id);
        resolve();
      }, ms)]);
    });
  }

  /**
   * Loops user provided runner function.
   *
   * Whether to run again is decided by this controller's own state and by the
   * generation this iteration belongs to - never by the abort signal, which is
   * reissued when the abort finishes and so goes false again while an iteration
   * may still be unwinding. A runner is free to hold any lock or none, to watch
   * the signal or ignore it: after a stop it is not run again.
   *
   * A runner that throws is deliberately NOT caught. Every runner this serves
   * guards its own expected failures, so a throw arriving here is a fault nobody
   * predicted - and what the node does with one of those is already decided at
   * the process level: apiServer's uncaughtException handler logs it and exits,
   * and systemd brings the node back thirty seconds later with every subsystem
   * running again. Catching it here would keep the node up and leave this loop
   * stopped for the life of the process instead, with nothing reading `running`
   * to notice and nothing that would start it again.
   *
   * @param {async function():number} runner function to be run
   * @param {number} generation the run this iteration belongs to
   * @returns {Promise<void>}
   */
  async loop(runner, generation = this.#generation) {
    const ms = await runner();

    this.#loopCount += 1;

    if (generation !== this.#generation) return;
    if (this.#state !== ControllerState.RUNNING) return;

    this.#loopTimeout = setTimeout(() => this.loop(runner, generation), ms);
  }

  /**
   * sets the loop counter back to zero.
   * @returns {void}
   */
  resetLoopCount() {
    this.#loopCount = 0;
  }

  /**
   * Clears the main loop timer and resets it.
   * @returns {void}
   */
  stopLoop() {
    clearTimeout(this.#loopTimeout);
    this.#loopTimeout = null;
    this.#loopCount = 0;
  }

  /**
   * @param {function():number} runner The function to run in a loop.
   * The runner must return the amount of ms to wait inbetween iterations.
   * @returns {Boolean} If the runner was started
   */
  startLoop(runner) {
    // Refused while stopping as well as while running: a start that overlaps a
    // stop is a second loop beside the one being torn down.
    if (this.#state !== ControllerState.IDLE) return false;

    this.#state = ControllerState.RUNNING;
    this.#generation += 1;
    this.loop(runner, this.#generation);
    return true;
  }

  /**
   * Stop the loop, cancel the work in flight, and return once it has let go.
   *
   * The state is taken first, so an iteration that finishes at any point from
   * here on finds the loop no longer wanted - which is what makes the stop
   * final, rather than the signal, which is reissued at the end of this so the
   * controller can be used again.
   *
   * @returns {Promise<void>}
   */
  async abort() {
    this.#state = ControllerState.STOPPING;
    this.#generation += 1;
    this.stopLoop();
    this.#abortController.abort();
    // eslint-disable-next-line no-restricted-syntax
    for (const [reject, timeout] of this.#timeouts.values()) {
      clearTimeout(timeout);
      reject(new Error('AbortError'));
    }
    this.#timeouts.clear();
    this.#timeoutId = 0;
    // The default lock and any named one added as a barrier - not every lock: a
    // named lock is usually a caller's own coordination, and waiting on those
    // deadlocks a stop against the work it is stopping.
    await Promise.all(
      [...this.#abortBlockers]
        .map((name) => this.#locks.get(name))
        .filter(Boolean)
        .map((lock) => lock.waitReady()),
    );
    // Reissued here rather than at the next start, because a controller's
    // signal is also handed to work that has no loop: a client rebuilt straight
    // after a stop would otherwise be born already cancelled.
    this.#abortController = new AbortController();
    this.#state = ControllerState.IDLE;
  }

  /**
   * Add a named lock.
   *
   * A named lock is the caller's own by default: `abort()` does not wait for it,
   * because what a caller uses one for is usually its own coordination -
   * networkStateManager's `fetcher` is how its readers wait for a fetch, and a
   * stop that waited on that would hang against the very thing it is stopping.
   *
   * `blocksAbort` says this one is different: work held under it is work a stop
   * waits for, like the default lock. Use it for work that must finish before
   * the controller is idle, not for work others merely watch.
   *
   * @param {string} name Name of the lock
   * @param {{blocksAbort?: boolean}} options
   * @returns {boolean} If the lock was added
   */
  addLock(name, options = {}) {
    if (this.#locks.has(name)) return false;

    this.#locks.set(name, new AsyncLock());
    if (options.blocksAbort) this.#abortBlockers.add(name);

    return true;
  }

  /**
   *
   * @param {string} name Name of the lock
   * @returns {AsyncLock | null} The lock
   */
  getLock(name) {
    const lock = this.#locks.get(name);

    return lock || null;
  }

  /**
   *
   * @param {string} name Name of the lock
   * @returns {boolean} If the lock was removed (or didn't exist)
   */
  removeLock(name) {
    if (name === 'default') return false;

    this.#locks.delete(name);
    this.#abortBlockers.delete(name);

    return true;
  }
}

module.exports = { FluxController, ControllerState };
