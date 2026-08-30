const http = require('node:http');

class FluxHttpTestServer extends http.Server {
  /**
   * Identity token echoed to any GET during a pre-install port test.
   *
   * A bare TCP connect proves only that SOMETHING answers on ip:port — not that it is us. Where
   * several Flux nodes sit behind one public IP (a common multi-node setup), the router forwards
   * the port to exactly one of them, so a peer probing our public IP can be talking to a sibling
   * node's already-installed app while our own test server sits unreachable behind the same NAT.
   * The probe passes, the install proceeds, and the app is born unreachable.
   *
   * Echoing a per-test nonce turns "the port is open" into "the port reaches ME", which is the
   * property the caller actually needs.
   */
  #token = null;
  /**
   * The reason this class is necessary is because we allow old nodeJS versions.
   * Anything after v18.2.0 we could just use closeAllConnections(), and this
   * class wouldn't be necessary.
   *
   * When the sockets are destroyed, the close handler is called.
   */
  #connections = {};

  #currentConnectionId = 0;

  constructor(token = null) {
    super((req, res) => {
      // Older peers do a bare TCP connect and never send a request; they are unaffected by this.
      if (!this.#token) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('flux');
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
