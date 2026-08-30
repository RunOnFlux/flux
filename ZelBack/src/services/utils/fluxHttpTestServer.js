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

  constructor() {
    super(() => { });

    this.addListener('connection', (socket) => this.#handleConnection(socket));
  }

  #handleConnection(socket) {
    const connectionid = this.#currentConnectionId;
    this.#connections[connectionid] = socket;
    this.#currentConnectionId += 1;

    const caller = bareIp(socket.remoteAddress);
    if (caller) this.#callers.add(caller);

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

  close(callback) {
    super.close(callback);

    Object.keys(this.#connections).forEach((key) => {
      const socket = this.#connections[key];
      socket.destroy();
    });
  }
}

module.exports = { FluxHttpTestServer };
