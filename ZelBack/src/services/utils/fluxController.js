const { AsyncLock } = require('./asyncLock');

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
   * If the main runner loop is active
   */
  #running = false;

  /**
   * async locks for functions to be able to tell the controller
   * that work is still being done
   */
  #locks = new Map([['default', new AsyncLock()]]);

  get ['lock']() {
    return this.#locks.get('default');
  }

  get ['aborted']() {
    return this.#abortController.signal.aborted;
  }

  get ['locked']() {
    return this.lock.locked;
  }

  get ['running']() {
    return this.#running;
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
   * Loops user provided runner function
   * @param {async function():number} runner function to be run
   * @returns {Promise<void>}
   */
  async loop(runner) {
    const ms = await runner();

    this.#loopCount += 1;

    if (this.aborted) return;

    this.#loopTimeout = setTimeout(() => this.loop(runner), ms);
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
    if (this.#running) return false;

    this.#running = true;
    this.loop(runner);
    return true;
  }

  /**
   * Sets AbortController signal, Interrupts any sleeps that are running,
   * awaits the lock and creates a new AbortController
   * @returns {Promise<void>}
   */
  async abort() {
    this.stopLoop();
    this.#abortController.abort();
    // eslint-disable-next-line no-restricted-syntax
    for (const [reject, timeout] of this.#timeouts.values()) {
      clearTimeout(timeout);
      reject(new Error('AbortError'));
    }
    this.#timeouts.clear();
    this.#timeoutId = 0;
    await this.lock.waitReady();
    this.#abortController = new AbortController();
    this.#running = false;
  }

  /**
   *
   * @param {string} name Name of the lock
   * @returns {boolean} If the lock was added
   */
  addLock(name) {
    if (this.#locks.has(name)) return false;

    this.#locks.set(name, new AsyncLock());

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

    return true;
  }
}

module.exports = { FluxController };
