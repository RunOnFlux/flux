class AsyncLock {
  ready = Promise.resolve();

  locked = false;

  constructor() {
    /**
     * A synchronous disable method. Meaning that it can be called,
     * and any further sync code can be run, before any code
     * waiting on the promise will resolve.
     */
    this.disable = () => { };
  }

  async enable() {
    if (this.locked) await this.ready;
    this.ready = new Promise((resolve) => {
      this.locked = true;
      this.disable = () => {
        this.reset();
        resolve();
      };
    });
  }

  reset() {
    this.disable = () => { };
    this.ready = Promise.resolve();
    this.locked = false;
  }

  /**
   * Waits for the lock to be ready, with a max wait time. This
   * will unlock lock after timeout
   * @param {number} ms Max milliseconds to wait
   * @returns {Promise<void>}
   */
  async unlockTimeout(ms) {
    if (!this.locked) return;
    const timeout = setTimeout(() => {
      this.disable();
    }, ms);
    await this.ready;
    clearTimeout(timeout);
  }

  /**
   * Similar to unlockTimeout, waits for the lock to be ready,
   * with a max wait time. Does not unlock the lock after the timeout
   * @param {number} ms Max milliseconds to wait
   * @returns {Promise<void>}
   */
  async readyTimeout(ms) {
    if (!this.locked) return;

    let timeout;
    const sleep = new Promise((r) => { timeout = setTimeout(r, ms); });
    await Promise.race([this.ready, sleep]);
    clearTimeout(timeout);
  }
}

module.exports = { AsyncLock };
