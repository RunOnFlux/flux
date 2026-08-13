const { match } = require('path-to-regexp');
const WebSocketServer = require('ws').Server;
const log = require('./log');
const { FLUX_VERSION, FLUX_CAPABILITIES } = require('../services/utils/FluxPeerSocket');

class FluxWebsocketServer {
  static defautlErrorHandler = () => { };

  #socketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        // No-context-takeover resets the stream after every message, so the
        // window can never carry history between messages and only ever matches
        // within one. Gossip messages are a few KB, so an 8KB window and this
        // hash table compress them to the same bytes a 32KB window does, on a
        // third of the memory - and every peer socket holds a context.
        memLevel: 8,
        level: 9,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      // Both stay as the peer's choice. Pinning a number here rejects the
      // handshake outright - with a 400, not a fallback to uncompressed - for
      // any client that offers a smaller window than ours, and browsers reach
      // this server too (/ws/id, /ws/sign, /ws/payment). Peers running this
      // build offer 13 themselves, so negotiation still settles there.
      clientMaxWindowBits: true,
      serverMaxWindowBits: true,
      concurrencyLimit: 2,
      threshold: 128,
    },
  });

  #routes = {};

  #routeMatchers = [];

  constructor(options = {}) {
    this.#routes = options.routes || {};
    this.errorHandler = options.errorHandler || FluxWebsocketServer.defautlErrorHandler;

    this.#routeMatchers = Object.entries(this.#routes).map((entry) => {
      const [route, handler] = entry;

      try {
        const matcher = match(route, { decode: decodeURIComponent });
        return { matcher, handler };
      } catch (error) {
        log.error('ERROR: Failed to create matcher for route:', JSON.stringify(route), 'Error:', error.message);
        throw error;
      }
    });

    // Add our capabilities and clock offset to every WS upgrade response header.
    // Old nodes silently ignore unknown headers.
    this.#socketServer.on('headers', (headers) => {
      headers.push(`X-Flux-Capabilities: ${FLUX_CAPABILITIES.join(',')}`);
      headers.push(`X-Flux-Version: ${FLUX_VERSION}`);
      headers.push(`X-Flux-Uptime: ${Math.floor(process.uptime())}`);
      // Lazy require to avoid circular deps at module load time
      const fluxNetworkHelper = require('../services/fluxNetworkHelper');
      const offsetMs = fluxNetworkHelper.getLocalClockOffsetMs();
      if (offsetMs !== null) {
        headers.push(`X-Flux-Clock-Offset: ${offsetMs}`);
      }
    });

    this.#socketServer.on('connection', (ws, request) => {
      ws.on('error', (err) => this.errorHandler(err));

      const { url } = request;

      const handler = this.matchRoute(url);

      if (handler) handler(ws, request);
    });
  }

  get routeMatchers() {
    return this.#routeMatchers.slice();
  }

  matchRoute(url) {
    let routeHandler = null;
    let params = {};

    this.#routeMatchers.some((routeMatcher) => {
      const { matcher, handler } = routeMatcher;

      const matched = matcher(url);

      if (!matched) return false;

      routeHandler = handler;
      ({ params } = matched);

      return true;
    });

    if (routeHandler) {
      return (ws, request) => routeHandler(ws, ...Object.values(params), request);
    }

    return null;
  }

  handleUpgrade(request, socket, head) {
    this.#socketServer.handleUpgrade(request, socket, head, (ws) => {
      this.#socketServer.emit('connection', ws, request);
    });
  }
}

module.exports = { FluxWebsocketServer };
