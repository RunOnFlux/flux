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
}

module.exports = { AsyncLock };
