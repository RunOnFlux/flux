class AsyncLock {
  ready = Promise.resolve();

  locked = false;

  constructor() {
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
