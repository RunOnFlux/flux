const { match } = require('path-to-regexp');
const log = require('./log');
const WebSocketServer = require('ws').Server;

class FluxWebsocketServer {
  static defautlErrorHandler = () => { };

  #socketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: true,
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
      log.info(JSON.stringify(ws));
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
