const { match } = require('path-to-regexp');
const WebSocketServer = require('ws').Server;

const idService = require('../services/idService');
const fluxCommunication = require('../services/fluxCommunication');

class FluxSocketServer {
  // these need to be most specific first
  static defaultRoutes = {
    '/ws/id/:loginphrase': idService.wsRespondLoginPhrase,
    '/ws/sign/:message': idService.wsRespondSignature,
    '/ws/flux/:port': fluxCommunication.handleIncomingConnection,
    '/ws/flux': fluxCommunication.handleIncomingConnection,
  };

  #socketServer = new WebSocketServer({ noServer: true });

  #routes = {};

  #routeMatchers = [];

  get routeMatchers() {
    return this.#routeMatchers.slice();
  }

  constructor(options = {}) {
    this.#routes = options.routes || FluxSocketServer.defaultRoutes;

    this.#routeMatchers = Object.entries(this.#routes).map((entry) => {
      const [route, handler] = entry;

      const matcher = match(route, { decode: decodeURIComponent });
      return { matcher, handler };
    });

    this.#socketServer.on('connection', (ws, request) => {
      ws.on('error', (err) => {
        console.log('SOCKET SERVER ERROR');
        console.error(err);
      });

      const { url } = request;

      console.log('REQUEST URL IN CONNECTION HANDLER', url);

      this.#routeMatchers.some((routeMatcher) => {
        const { matcher, handler } = routeMatcher;

        const matched = matcher(url);

        if (!matched) return false;

        console.log('ABOUT TO RUN HANDLER');
        // Should probably pass these as is but all handlers only
        // have one param, so easier this way for now
        handler(ws, ...Object.values(matched.params));

        return true;
      });
    });
  }

  handleUpgrade(request, socket, head) {
    this.#socketServer.handleUpgrade(request, socket, head, (ws) => {
      console.log('IN HANDLE UPGRADE CALLBACK');
      this.#socketServer.emit('connection', ws, request);
    });
  }
}

if (require.main === module) {
  const server = new FluxSocketServer();
  console.log(server.routeMatchers);
}

module.exports = { FluxSocketServer };
