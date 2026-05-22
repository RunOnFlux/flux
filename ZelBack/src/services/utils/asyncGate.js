class AsyncGate {
  #ready = false;

  #resolvers = [];

  get ready() {
    return this.#ready;
  }

  open() {
    this.#ready = true;
    this.#resolvers.forEach((r) => r());
    this.#resolvers = [];
  }

  close() {
    this.#ready = false;
  }

  wait() {
    if (this.#ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.#resolvers.push(resolve);
    });
  }
}

module.exports = { AsyncGate };
