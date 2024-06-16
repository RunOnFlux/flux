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
   */
  storeRequest(request) {
    const url = RequestHistory.parseUrl(request.url);

    if (!url) {
      this.emit('parseError', url);
      return;
    }

    const id = crypto.randomUUID();

    // this is a bit messed up. Originally thought origin was origin + pathname.
    // so origin is coded everywhere. Really it should be updated

    const { origin: host, pathname, searchParams } = url;
    const { verb, timeout, timestamp } = request;

    const params = Object.fromEntries(searchParams);
    const origin = `${host}${pathname}`;

    const requestData = {
      params, verb, timeout, timestamp, id,
    };

    const formatted = {
      origin,
      requestData,
    };

    if (!this.#requests.has(origin)) {
      this.#requests.set(origin, {});
      this.emit('originAdded', origin);
    }

    const dataStore = this.#requests.get(origin);

    dataStore[id] = requestData;
    this.emit('requestAdded', formatted);

    this.#timers.set(id, setTimeout(() => {
      this.#timers.delete(id);
      delete dataStore[id];
      this.emit('requestRemoved', { origin, id });

      if (!Object.keys(dataStore).length) {
        this.#requests.delete(origin);
        this.emit('originRemoved', origin);
      }
    }, this.maxAge));
  }

  clear() {
    this.#timers.values.forEach((timer) => { clearTimeout(timer); });
    this.#timers.clear();
    this.#requests.clear();
    this.emit('cleared');
  }
}

module.exports = { RequestHistory };
