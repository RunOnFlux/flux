class AsyncLock {
  #waiterCount = 0;

  #lockUsers = [];

  #maxConcurrent = 1;

  constructor(maxConcurrent = 1) {
    this.#maxConcurrent = maxConcurrent;
  }

  get waiterCount() {
    return this.#waiterCount;
  }

  get locked() {
    return Boolean(this.#lockUsers.length);
  }

  get #userPromises() {
    return this.#lockUsers.map((user) => user[1]);
  }

  disable() {
    if (!this.#lockUsers.length) return;

    const [resolver] = this.#lockUsers.shift();

    resolver();
  }

  async enable() {
    const lockUser = [];

    const promise = new Promise((resolve) => {
      lockUser.push(resolve);
    });

    lockUser.push(promise);

    this.#lockUsers.push(lockUser);

    if (this.#lockUsers.length > this.#maxConcurrent) {
      this.#waiterCount += 1;
      // Wait for the holder whose slot we need to free up
      const waitIndex = this.#lockUsers.length - 1 - this.#maxConcurrent;
      await this.#lockUsers[waitIndex][1];
      this.#waiterCount -= 1;
    }
  }

  /**
   * Occupies a lock slot without waiting. Useful for registering
   * a long-running operation that should count against maxConcurrent.
   */
  register() {
    const lockUser = [];
    const promise = new Promise((resolve) => { lockUser.push(resolve); });
    lockUser.push(promise);
    this.#lockUsers.push(lockUser);
  }

  /**
   * Waits until there are no lock users. If waitAll is specified,
   * if enable is called again, we will wait for that too.
   * @param {waitAll?: boolean} options
   * @returns
   */
  async waitReady(options = {}) {
    const waitAll = options.waitAll ?? true;

    while (this.#lockUsers.length) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(this.#userPromises);

      if (!waitAll) break;
    }
  }

  /**
   * Waits for the lock to be ready, with a max wait time. This
   * will unlock lock after timeout. It will resolve any other locks
   * @param {number} ms Max milliseconds to wait
   * @returns {Promise<void>}
   */
  async unlockTimeout(ms) {
    if (!this.locked) return;
    const timeout = setTimeout(() => {
      while (this.#lockUsers.length) {
        this.disable();
      }
    }, ms);
    await this.waitReady();
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
    await Promise.race([this.waitReady(), sleep]);
    clearTimeout(timeout);
  }
}

module.exports = { AsyncLock };
