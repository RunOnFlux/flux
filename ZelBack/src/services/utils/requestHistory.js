const { EventEmitter } = require('node:events');

class RequestHistory extends EventEmitter {
  static defaultMaxAge = 1_800_000;

  #requests = new Map();

  #timers = new Map();

  constructor(options = {}) {
    super();

    this.maxAge = options.maxAge || RequestHistory.defaultMaxAge;
  }

  /**
   * Once we move to > nodeJS 18.17.0, we can just use
   * canParse()
   * @param {string} url
   * @returns {URL | null}
   */
  static parseUrl(url) {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  /**
   * Returns all records, formatted as required by frontend
   * @returns {object}
   */
  get allHistory() {
    const history = Object.fromEntries(this.#requests);

    Object.keys(history).forEach((key) => {
      history[key] = Object.values(history[key]).sort((a, b) => a.timestamp <= b.timestamp);
    });

    return history;
  }

  /**
   * Adds the request to the history
   *
   * @param {{url: string, verb: "get" | "post", timeout: number, timestamp: number}} request
   * @returns {string | null}
   */
  storeRequest(request) {
    const url = RequestHistory.parseUrl(request.url);

    if (!url) {
      this.emit('parseError', url);
      return null;
    }

    const id = crypto.randomUUID();

    const { origin, pathname, searchParams } = url;
    const { verb, timeout, timestamp } = request;

    const params = Object.fromEntries(searchParams);
    const target = `${origin}${pathname}`;

    const requestData = {
      params, verb, timeout, timestamp, id,
    };

    const formatted = {
      target,
      requestData,
    };

    if (!this.#requests.has(target)) {
      this.#requests.set(target, {});
      this.emit('targetAdded', target);
    }

    const dataStore = this.#requests.get(target);

    dataStore[id] = requestData;
    this.emit('requestAdded', formatted);

    this.#timers.set(id, setTimeout(() => {
      this.#timers.delete(id);
      delete dataStore[id];
      this.emit('requestRemoved', { target, id });

      if (!Object.keys(dataStore).length) {
        this.#requests.delete(target);
        this.emit('targetRemoved', target);
      }
    }, this.maxAge));

    return id;
  }

  /**
   * Removes all records / targets, and clears all timers
   */
  clear() {
    Array.from(this.#timers.values()).forEach((timer) => { clearTimeout(timer); });
    this.#timers.clear();
    this.#requests.clear();
    this.emit('cleared');
  }
}

module.exports = { RequestHistory };
