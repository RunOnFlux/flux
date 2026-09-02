const http = require('node:http');

/**
 * The response header the secret travels in.
 *
 * At the FRONT of the answer, and in an answer this file writes in full, both on
 * purpose. A peer asked to read a port relays a BOUNDED PREFIX of what it found -
 * bounded because the port may be forwarded to a neighbour at the same public
 * address, so those can be a stranger's bytes - and the requester's only evidence
 * is finding its secret inside that prefix.
 *
 * So proof that sits at the END of the stream is proof the bound can cut. It did
 * sit there: the token rode in the body and finished 48 bytes short of the cap,
 * and almost none of what preceded it was ours. Node emits Date, Connection and
 * the transfer framing itself, and takes Connection from what the READING peer
 * sent - so the margin was set by a request string in another service and moved
 * between 20 and 80 bytes with it. Losing the token refuses an install while
 * reporting that a neighbour holds the port, identically on every peer, which is
 * the one shape the two-witness rule corroborates rather than catches.
 *
 * Hence every header below, including the three Node would otherwise append on
 * its own: the reply is the same 187 bytes and the token ends at byte 67 whatever
 * the peer asks for and whatever Node would have chosen.
 */
const TOKEN_HEADER = 'X-Flux-Port-Test';

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
      // Nothing about this answer is left to Node: no Date, an explicit length
      // so there is no chunked framing, and our own Connection rather than the
      // one it would mirror back from the request. What this file says is what
      // goes on the wire.
      res.sendDate = false;

      if (!this.#token) {
        res.writeHead(204, { Connection: 'close' });
        res.end();
        return;
      }

      // The token is not in here. It is a header, and this says only what the
      // port is, for whoever reaches it with a browser.
      const body = JSON.stringify({ status: 'success', data: { portTest: true } });

      res.writeHead(200, {
        [TOKEN_HEADER]: this.#token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'close',
      });
      res.end(body);
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

module.exports = { FluxHttpTestServer, TOKEN_HEADER };
