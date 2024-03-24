const { AsyncLock } = require('./asyncLock');

class FluxController {
  #timeoutId = 0;
  #timeouts = new Map();
  #abortController = new AbortController()

  lock = new AsyncLock();

  get ['aborted']() {
    return this.#abortController.signal.aborted;
  }

  get ['locked']() {
    return this.lock.locked;
  }

  /**
   * An interruptable sleep. If you call abort() on the controller,
   * The promise will reject immediately with { name: 'AbortError' }.
   * @param {number} ms How many milliseconds to sleep for
   * @returns {Promise<void>}
   */
  sleep(ms) {
    const id = ++this.#timeoutId;
    return new Promise((resolve, reject) => {
      this.#timeouts.set(id, [reject, setTimeout(() => {
        this.#timeouts.delete(id);
        resolve();
      }, ms)]);
    });
  }

  /**
   * Sets AbortController signal, Interrupts any sleeps that are running,
   * awaits the lock and creates a new AbortController
   */
  async abort() {
    this.#abortController.abort();
    // eslint-disable-next-line no-restricted-syntax
    for (const [reject, timeout] of this.#timeouts.values()) {
      clearTimeout(timeout);
      reject(new Error('AbortError'));
    }
    this.#timeouts.clear();
    this.#timeoutId = 0;
    await this.lock.ready;
    this.#abortController = new AbortController();
  }
}

module.exports = { FluxController };
