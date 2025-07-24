const http = require('node:http');

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

  constructor() {
    super(() => { });

    this.addListener('connection', (socket) => this.#handleConnection(socket));
  }

  #handleConnection(socket) {
    const connectionid = this.#currentConnectionId;
    this.#connections[connectionid] = socket;
    this.#currentConnectionId += 1;

    socket.on('close', () => {
      delete this.#connections[connectionid];
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
