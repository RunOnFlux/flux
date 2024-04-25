const EventEmitter = require('node:events');

/**
 * A reusable implementation of a First In First Out queue.
 * You can pass in a worker, then whenever you pass in at item,
 * it will be run by the worker. If there are already items running,
 * they will queue up.
 */
class FifoQueue extends EventEmitter {
  /**
   * The main queue
   */
  #list = [];
  /**
   * If the queue is being processed
   */
  working = false;
  /**
   * If work has been halted due to error
   */
  halted = false;

  /**
   * An awaitable for the queue to clear
   */
  empty = Promise.resolve();

  /**
   *
   * @param {{worker?: () => Promise<void>, retries?: number, retryDelay?: number, maxSize?: number}} options
   */
  constructor(options = {}) {
    super();

    this.worker = options.worker || null;
    this.retries = options.retries ?? 5;
    this.retryDelay = options.retryDelay ?? 10 * 1000; // 10s
    this.maxSize = options.maxSize ?? 10; // 0 infinite
  }

  /**
   * If there is work to be done
   * @returns {Boolean}
   */
  get workAvailable() {
    return Boolean(this.#list.length);
  }

  get length() {
    return this.#list.length
  }

  get queueFull() {
    return Boolean(this.maxSize && this.#list.length >= this.maxSize);
  }

  /**
   * The items as passed in by the user.
   */
  get list() {
    return this.#list.map(x => x[0]);
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
   * Stop any work on the queue
   */
  halt() {
    this.halted = true;
  }

  /**
   * Resumes any work on the queue (if any)
   */
  resume() {
    this.halted = false;
    this.work();
  }

  /**
   * @param {Object} payload The properties to pass to the worker
   * @param {Boolean} wait If we should wait for the work to be finished
   * @return {Promise<Any>}
   */
  async push(payload, wait = false) {
    return new Promise((resolve) => {
      // oldest items get torched if the queue is full.
      // Maybe it would be better to reject. Or configurable?
      if (this.queueFull) this.#list.shift();

      this.#list.push([payload, resolve]);

      if (this.worker && !this.working) this.work();
      if (!wait) resolve({ error: null });
    })
  }

  /**
   *  Same as Array shift
   * @returns {Any}
   */
  shift() {
    return this.#list.length ? this.#list.shift() : null;
  }

  /**
   *  Same as Array pop
   * @returns {Any}
   */
  pop() {
    return this.#list.length ? this.#list.pop() : null;
  }

  /**
   *
   * @param {number} index The Array index to return
   * @returns {Any}
   */
  at(index) {
    return this.#list.length > index ? this.#list[index] : null;
  }

  /**
   *
   * @param {Object} props The items to pass to the worker
   */
  async runWorker(props) {
    const [options, resolve] = props;

    let { workerOptions, commandOptions } = options;

    // If the commandOptions object wasn't passed in, we just pass the
    // entire options to the command
    if (!commandOptions) commandOptions = options;
    if (!workerOptions) workerOptions = {};

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
        if (!retriesRemaining) {
          // the emit callback runs before the resolve (resolve is awaited)
          resolve({ error });
          this.emit('failed', { options, error });
          this.halted = true;
        }
        // Can get halted externally too.
        // we put this task back at the start of the queue and bail.
        if (this.halted) {
          this.#list.unshift(props);
          break;
        }

        // wait default 10 seconds between retries
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }
  }

  /**
   * Loops through any work until the queue is halted or there is
   * no more work. Also sets an empty awaitable, so you can wait for
   * the work to finish.
   * @returns {Promise<void>}
   */
  async work() {
    if (this.working) return;
    this.working = true;
    this.empty = new Promise(async (resolve) => {
      try {
        while (this.workAvailable && !this.halted) {
          const props = this.shift();

          if (!Object.keys(props).length) return;

          await this.runWorker(props)
        }
      } finally {
        this.working = false;
        resolve();
      }
    });
  }
}

module.exports = { FifoQueue }
