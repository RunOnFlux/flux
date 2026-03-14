const { match } = require('path-to-regexp');
const WebSocketServer = require('ws').Server;
const log = require('./log');

const LOCAL_CAPABILITIES = ['transmissionTimestamps'];

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
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      clientMaxWindowBits: true, // Allow Firefox to use default settings
      serverMaxWindowBits: true, // Let browsers negotiate (Default 15)
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
      headers.push(`X-Flux-Capabilities: ${LOCAL_CAPABILITIES.join(',')}`);
      // Lazy require to avoid circular deps at module load time
      const fluxNetworkHelper = require('../services/fluxNetworkHelper');
      const offsetMs = fluxNetworkHelper.getLocalClockOffsetMs();
      if (offsetMs !== null) {
        headers.push(`X-Flux-Clock-Offset: ${offsetMs}`);
      }
    });

    this.#socketServer.on('connection', (ws, request) => {
      ws.on('error', (err) => this.errorHandler(err));

      // Parse remote capabilities and clock offset from the upgrade request header.
      // Old nodes won't send these headers.
      const capHeader = request.headers['x-flux-capabilities'];
      if (capHeader) {
        ws._remoteCapabilities = capHeader.split(',').map((s) => s.trim()).filter(Boolean);
      }
      const clockHeader = request.headers['x-flux-clock-offset'];
      if (clockHeader !== undefined) {
        ws._remoteClockOffsetMs = Number(clockHeader);
      }

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
