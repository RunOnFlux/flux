const { match } = require('path-to-regexp');
const WebSocketServer = require('ws').Server;

const idService = require('../services/idService');
const fluxCommunication = require('../services/fluxCommunication');

class FluxSocketServer {
  static defaultRoutes = {
    '/ws/id/:loginphrase': idService.wsRespondLoginPhrase,
    '/ws/sign/:message': idService.wsRespondSignature,
    '/ws/flux/:port': fluxCommunication.handleIncomingConnection,
    '/ws/flux': fluxCommunication.handleIncomingConnection,
  };

  #socketServer = new WebSocketServer({ noServer: true });

  #routes = {};

  #routeMatchers = [];

  constructor(options = {}) {
    this.routes = options.routes || FluxSocketServer.defaultRoutes;

    this.#routeMatchers = Object.entries(this.#routes).map((route, handler) => {
      const matcher = match(route, { decode: decodeURIComponent });
      return { matcher, handler };
    });

    this.#socketServer.on('connection', (ws, request) => {
      ws.on('error', (err) => {
        console.log('SOCKET SERVER ERROR');
        console.error(err);
      });

      const { url } = request;

      console.log('REQUEST URL', url);

      this.#routeMatchers.some((routeMatcher) => {
        const { matcher, handler } = routeMatcher;

        const matched = matcher(url);

        if (!matched) return false;

        console.log('ABOUT TO RUN HANDLER');
        handler(ws, ...matched.params);

        return true;
      });
    });
  }
}

module.exports = { FluxSocketServer };
