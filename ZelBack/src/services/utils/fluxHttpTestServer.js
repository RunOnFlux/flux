const http = require('node:http');
const { bareIp } = require('./socketAddressUtils');

class FluxHttpTestServer extends http.Server {
  /**
   * The reason this class is necessary is because we allow old nodeJS versions.
   * Anything after v18.2.0 we could just use closeAllConnections(), and this
   * class wouldn't be necessary.
   *
   * When the sockets are destroyed, the close handler is called.
   */
  #connections = {};

  #currentConnectionId = 0;

  /**
   * The addresses that have reached this server, by bare IP.
   *
   * A peer asked to test a port reports whether something answered at our public
   * address. Where several Flux nodes share one address the router forwards each
   * port to exactly one of them, so "something answered" can be a sibling's
   * application while this server sat unreached - and the answer to the question
   * actually being asked, "does this port reach ME", is held here rather than in
   * the peer's reply.
   *
   * Recorded per connection, so a probe that opens and closes still counts. Kept
   * for the life of the server, which is one port test.
   */
  #callers = new Set();

  /**
   * Callers waiting on an address that has not arrived yet: bare IP -> the
   * resolve functions to call when it does.
   */
  #waiters = new Map();

  constructor() {
    super(() => { });

    this.addListener('connection', (socket) => this.#handleConnection(socket));
  }

  #handleConnection(socket) {
    const connectionid = this.#currentConnectionId;
    this.#connections[connectionid] = socket;
    this.#currentConnectionId += 1;

    const caller = bareIp(socket.remoteAddress);
    if (caller) {
      this.#callers.add(caller);
      const waiting = this.#waiters.get(caller);
      if (waiting) {
        this.#waiters.delete(caller);
        waiting.forEach((resolve) => resolve(true));
      }
    }

    socket.on('close', () => {
      delete this.#connections[connectionid];
    });
  }

  /**
   * Whether this address reached this server.
   *
   * Asked of the peer we sent to a port, so an unrelated caller arriving during
   * the test window is not read as proof the port is ours.
   *
   * @param {string} address - an IP, or a socket's remoteAddress
   * @returns {boolean}
   */
  reachedBy(address) {
    const caller = bareIp(address);

    return Boolean(caller) && this.#callers.has(caller);
  }

  /**
   * Waits until this address reaches this server, or the wait expires.
   *
   * The arrival and the question about it are concurrent, and asking for a
   * snapshot loses that race: a peer resolves its probe on its own `connect`
   * and answers immediately, while the accept it caused surfaces here on a
   * later turn of THIS process's event loop. Read once, a busy node refuses an
   * install for a connection that did arrive - a port collision reported where
   * there is none. So the arrival is awaited rather than sampled.
   *
   * Already here resolves at once. Otherwise the connection handler resolves
   * it, and nothing polls.
   *
   * A wait that expires is the answer in the case this exists to catch: where
   * a sibling at the same address holds the port, the connection never arrives
   * at all.
   *
   * @param {string} address - an IP, or a socket's remoteAddress
   * @param {number} timeoutMs - how long to wait for it
   * @returns {Promise<boolean>} true if it reached us, false if the wait expired
   */
  reachedByWithin(address, timeoutMs) {
    const caller = bareIp(address);
    if (!caller) return Promise.resolve(false);
    if (this.#callers.has(caller)) return Promise.resolve(true);

    return new Promise((resolve) => {
      const waiting = this.#waiters.get(caller) || [];
      let settled = false;
      const settle = (reached) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(reached);
      };
      const timer = setTimeout(() => settle(false), timeoutMs);
      // Never hold the process open for a wait that is only ever about a
      // connection somebody else has already made.
      if (timer.unref) timer.unref();
      waiting.push(settle);
      this.#waiters.set(caller, waiting);
    });
  }

  close(callback) {
    super.close(callback);

    Object.keys(this.#connections).forEach((key) => {
      const socket = this.#connections[key];
      socket.destroy();
    });
  }
}

module.exports = { FluxHttpTestServer };
