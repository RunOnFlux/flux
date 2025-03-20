const { match } = require('path-to-regexp');
const WebSocketServer = require('ws').Server;

class FluxWebsocketServer {
  static defautlErrorHandler = () => { };

  #socketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 9,
        level: 9,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      clientNoContextTakeover: false, // Allow client to decide (Fixes Firefox)
      serverNoContextTakeover: true, // Safe to enforce
      clientMaxWindowBits: false, // Allow Firefox to use default settings
      serverMaxWindowBits: false, // Let browsers negotiate (Default 15)
      concurrencyLimit: 2,
      threshold: 1024, // Avoid compressing very small messages
    },
  });

  #routes = {};

  #routeMatchers = [];

  constructor(options = {}) {
    this.#routes = options.routes || {};
    this.errorHandler = options.errorHandler || FluxWebsocketServer.defautlErrorHandler;

    this.#routeMatchers = Object.entries(this.#routes).map((entry) => {
      const [route, handler] = entry;

      const matcher = match(route, { decode: decodeURIComponent });
      return { matcher, handler };
    });

    this.#socketServer.on('connection', (ws, request) => {
      ws.on('error', (err) => this.errorHandler(err));

      const { url } = request;

      const handler = this.matchRoute(url);

      if (handler) handler(ws);
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
      // Should probably pass these as is but all handlers only
      // have one param, so easier this way for now
      return (ws) => routeHandler(ws, ...Object.values(params));
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
