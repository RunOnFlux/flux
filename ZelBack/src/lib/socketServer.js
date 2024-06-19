const { match } = require('path-to-regexp');
const WebSocketServer = require('ws').Server;

class FluxWebsocketServer {
  static defautlErrorHandler = () => { };

  #socketServer = new WebSocketServer({ noServer: true });

  #routes = {};

  #routeMatchers = [];

  get routeMatchers() {
    return this.#routeMatchers.slice();
  }

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

      this.#routeMatchers.some((routeMatcher) => {
        const { matcher, handler } = routeMatcher;

        const matched = matcher(url);

        if (!matched) return false;

        // Should probably pass these as is but all handlers only
        // have one param, so easier this way for now
        handler(ws, ...Object.values(matched.params));

        return true;
      });
    });
  }

  handleUpgrade(request, socket, head) {
    this.#socketServer.handleUpgrade(request, socket, head, (ws) => {
      this.#socketServer.emit('connection', ws, request);
    });
  }
}

module.exports = { FluxWebsocketServer };
