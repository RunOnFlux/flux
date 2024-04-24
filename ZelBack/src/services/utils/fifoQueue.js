/**
 * A reusable implementation of a First In First Out queue.
 * You can pass in a worker, then whenever you pass in at item,
 * it will be run by the worker. If there are already items running,
 * they will queue up.
 */
class FifoQueue {
  list = [];
  working = false;

  /**
   *
   * @param {{worker?: () => Promise<void>, retries?: number, retryDelay?: number}} options
   */
  constructor(options = {}) {
    this.worker = options.worker || null;
    this.retries = options.retries ?? 5;
    this.retryDelay = options.retryDelay ?? 10 * 1000; // 10s
  }

  /**
   * If there is work to be done
   * @returns {Boolean}
   */
  get workAvailable() {
    return Boolean(this.list.length);
  }

  /**
   * Setter for worker
   * @param {() => Promise<void>} worker
   */
  addWorker(worker) {
    if (this.worker) return;

    this.worker = worker;
    if (this.workAvailable) this.work();
  }

  /**
   * @param {Boolean} wait If we should wait for the work to be finished
   * @param {Object} payload The properties to pass to the worker
   * @return {Promise<Any>}
   */
  async push(wait, payload) {
    return new Promise((resolve) => {
      this.list.push([payload, resolve]);
      if (this.worker) this.work();
      if (!wait) resolve({ error: null });
    })
  }

  /**
   *  Same as Array shift
   * @returns {Any}
   */
  shift() {
    return this.list.length ? this.list.shift() : null;
  }

  /**
   *  Same as Array pop
   * @returns {Any}
   */
  pop() {
    return this.list.length ? this.list.pop() : null;
  }

  /**
   *
   * @param {number} index The Array index to return
   * @returns {Any}
   */
  at(index) {
    return this.list.length > index ? this.list[index] : null;
  }

  /**
   *
   * @param {Object} props The items to pass to the worker
   */
  async runWorker(props) {
    const [options, resolve] = props;

    const { workerOptions, ...commandOptions } = options;

    // nullish coalescing to allow for zero
    let retriesRemaining = workerOptions.retries ?? this.retries;
    const retryDelay = workerOptions.retryDelay ?? this.retryDelay;

    // we add one for the initial attempt
    retriesRemaining += 1;

    while (retriesRemaining) {
      retriesRemaining -= 1;
      try {
        const res = await this.worker(commandOptions);
        resolve(res);
        return;
      } catch (error) {
        if (!retriesRemaining) resolve({ error });
        // wait default 10 seconds between retries
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }
  }

  async work() {
    if (this.working) return;

    try {
      while (this.workAvailable) {
        this.working = true;
        const props = this.shift();

        if (!Object.keys(props).length) return;

        await this.runWorker(props)
      }
    } finally {
      this.working = false;
    }
  }
}

module.exports = { FifoQueue }
