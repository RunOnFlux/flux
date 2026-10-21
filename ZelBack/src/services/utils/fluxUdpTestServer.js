const dgram = require('node:dgram');
const { once } = require('node:events');

/**
 * Every probe a peer sends to a UDP port under test starts with this, and every
 * reply from a test server starts with it too.
 */
const UDP_PROBE_MAGIC = 'FLUXPT';

/**
 * The size of every probe. A reply is never larger: the test server answers a
 * stranger who spoofs a peer's address, so it must not amplify what it is sent.
 */
const UDP_PROBE_BYTES = 64;

/**
 * The most replies a test server sends to one asked peer. A peer sends a
 * handful of datagrams per port per attempt; this bounds what a flood of
 * probes forged from the asked peer's address can make the server send, and
 * a flood forged from one peer's address leaves the next peer its own replies.
 */
const MAX_REPLIES = 32;

function noop() {}

/**
 * The reply the test server sends for a token.
 * @param {string} token
 * @returns {Buffer}
 */
function udpReply(token) {
  return Buffer.from(`${UDP_PROBE_MAGIC} ${token}`);
}

/**
 * The UDP half of a port test: bound on the port under test while the test
 * runs, and answering a peer's probe with the run's secret token.
 *
 * It answers only the peer this node is asking at the moment, set with
 * `allow`. A UDP reply goes wherever the probe claims it came from, so
 * answering anyone would make every port under test a reflector.
 */
class FluxUdpTestServer {
  #socket = dgram.createSocket('udp4');

  #reply = null;

  #allowed = null;

  #replies = 0;

  /**
   * @param {string} token The secret this run's test servers answer with.
   */
  constructor(token) {
    this.#reply = udpReply(token);
    if (this.#reply.length > UDP_PROBE_BYTES) {
      throw new Error(`A UDP test token of ${token.length} characters does not fit a ${UDP_PROBE_BYTES} byte probe`);
    }
    this.#socket.on('message', (message, rinfo) => this.#answer(message, rinfo));
    // A bind error rejects listen(); a send that fails costs that one reply.
    // Neither may reach the process as an unhandled 'error'.
    this.#socket.on('error', noop);
  }

  /**
   * The peer whose probes this server answers from now on, with a fresh reply
   * cap; null answers nobody.
   * @param {string|null} ip
   */
  allow(ip) {
    this.#allowed = ip ? ip.replace(/^::ffff:/i, '') : null;
    this.#replies = 0;
  }

  /**
   * Binds the port. Rejects with the bind error, EADDRINUSE among them.
   * @param {number} port
   * @param {string} [address]
   * @returns {Promise<void>}
   */
  async listen(port, address) {
    const bound = once(this.#socket, 'listening');
    this.#socket.bind(port, address);
    await bound;
  }

  /** @returns {{address: string, port: number}} */
  address() {
    return this.#socket.address();
  }

  /** Unbinds the port. Safe to call on a server that never bound or already closed. */
  close() {
    try {
      this.#socket.close();
    } catch {
      // ERR_SOCKET_DGRAM_NOT_RUNNING: closed already
    }
  }

  #answer(message, rinfo) {
    if (this.#replies >= MAX_REPLIES) return;
    if (!this.#allowed || rinfo.address.replace(/^::ffff:/i, '') !== this.#allowed) return;
    if (message.length < UDP_PROBE_BYTES) return;
    if (message.subarray(0, UDP_PROBE_MAGIC.length).toString('latin1') !== UDP_PROBE_MAGIC) return;

    this.#replies += 1;
    this.#socket.send(this.#reply, rinfo.port, rinfo.address, noop);
  }
}

module.exports = {
  FluxUdpTestServer,
  UDP_PROBE_MAGIC,
  UDP_PROBE_BYTES,
  MAX_REPLIES,
  udpReply,
};
