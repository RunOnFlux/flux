const { match } = require('path-to-regexp');
const websocket = require('ws');

const idService = require('../services/idService');
const fluxCommunication = require('../services/fluxCommunication');

class SocketServer {
  static defaultRoutes = {
    '/ws/id/:loginphrase': idService.wsRespondLoginPhrase,
    '/ws/sign/:message': idService.wsRespondSignature,
    '/ws/flux/:port': fluxCommunication.handleIncomingConnection,
    '/ws/flux': fluxCommunication.handleIncomingConnection,
  };

  #socketServer = new websocket.WebSocketServer({ noServer: true });

  #routes = {};

  #routeMatchers = [];

  constructor(options = {}) {
    this.routes = options.routes || SocketServer.defaultRoutes;

    this.#routeMatchers = Object.entries(this.#routes).map((route, handler) => {
      const matcher = match(route, { decode: decodeURIComponent });
      return { matcher, handler };
    });

    this.#socketServer.on('connection', (ws, request) => {
      ws.on('error', console.error);

      const { url } = request;

      this.#routeMatchers.some((routeMatcher) => {
        const { matcher, handler } = routeMatcher;

        const matched = matcher(url);

        if (!matched) return false;

        handler(ws, ...matched.params);

        return true;
      });
    });
  }
}

module.exports = { SocketServer };
