const { match } = require('path-to-regexp');
const WebSocketServer = require('ws').Server;

class FluxWebsocketServer {
  #socketServer = new WebSocketServer({ noServer: true });

  #routes = {};

  #routeMatchers = [];

  get routeMatchers() {
    return this.#routeMatchers.slice();
  }

  constructor(options = {}) {
    this.#routes = options.routes || {};

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

module.exports = { FluxWebsocketServer };
