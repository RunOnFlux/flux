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


  /**
   * The secret this server answers with, for this port test only.
   *
   * A peer asked to test a port reports whether something answered at our
   * public address. Where several Flux nodes share that address the router
   * forwards each port to exactly one of them, so what answered can be a
   * neighbour's application - and the peer cannot tell, because from outside
   * there is nothing to tell.
   *
   * Answering with a secret the requester never handed out makes it tellable:
   * only the thing the requester started can produce it. The neighbour's
   * application has never seen it.
   */
  #token = null;

  constructor(token = null) {
    super((req, res) => {
      if (!this.#token) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { token: this.#token } }));
    });

    this.#token = token;

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
