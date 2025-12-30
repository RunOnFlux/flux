const nodeHttp = require('node:http');
const nodeHttps = require('node:https');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const config = require('config');
const routes = require('../routes');

const socketHandlers = require('./socketHandlers');
const socketIoHandlers = require('./socketIoHandlers');
const { FluxWebsocketServer } = require('./socketServer');
const { FluxSocketIoServer } = require('./socketIoServer');

/**
 * Redacts sensitive information from URLs before logging (SEC-05 fix).
 * Masks tokens, keys, signatures, and other sensitive parameters.
 * @param {string} url - The URL to redact.
 * @returns {string} - The redacted URL.
 */
function redactSensitiveUrl(url) {
  if (!url) return url;

  // Patterns to redact in URL paths (case insensitive)
  const sensitivePathPatterns = [
    // Zcash secret keys in path
    /\/(zcsecretkey|secretkey|privatekey|privkey)\/[^/]+/gi,
    // Token in path
    /\/token\/[^/]+/gi,
    // Signature in path
    /\/signature\/[^/]+/gi,
  ];

  let redactedUrl = url;

  // Redact sensitive path segments
  sensitivePathPatterns.forEach((pattern) => {
    redactedUrl = redactedUrl.replace(pattern, (match) => {
      const parts = match.split('/');
      return `/${parts[1]}/[REDACTED]`;
    });
  });

  // Redact query parameters
  try {
    const urlObj = new URL(redactedUrl, 'http://localhost');
    const sensitiveParams = ['token', 'signature', 'key', 'secret', 'password', 'apikey', 'api_key', 'auth', 'zelidauth'];
    let hasRedaction = false;

    sensitiveParams.forEach((param) => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '[REDACTED]');
        hasRedaction = true;
      }
    });

    if (hasRedaction) {
      redactedUrl = urlObj.pathname + urlObj.search;
    }
  } catch (e) {
    // If URL parsing fails, continue with path-only redaction
  }

  return redactedUrl;
}

/**
 * Custom morgan token for redacted URLs (SEC-05 fix).
 */
morgan.token('redacted-url', (req) => redactSensitiveUrl(req.originalUrl || req.url));

/**
 * Custom morgan format that redacts sensitive URL information.
 * Based on 'combined' format but uses redacted URL.
 */
const redactedCombinedFormat = ':remote-addr - :remote-user [:date[clf]] ":method :redacted-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';

/**
 * Builds CORS options from configuration (SEC-04 fix).
 * Supports both string ('*') and array of allowed origins.
 * @returns {object} - CORS options for express cors middleware.
 */
function buildCorsOptions() {
  const corsConfig = config.server.cors || {};
  const allowedOrigins = corsConfig.allowedOrigins || '*';
  const allowedMethods = corsConfig.allowedMethods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  const allowCredentials = corsConfig.allowCredentials || false;

  // If allowedOrigins is '*', use simple configuration
  if (allowedOrigins === '*') {
    return {
      origin: '*',
      methods: allowedMethods,
      credentials: allowCredentials,
    };
  }

  // If allowedOrigins is an array, use dynamic origin checking
  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      }
    },
    methods: allowedMethods,
    credentials: allowCredentials,
  };
}

/**
 * Combines an http(s) server, classic websocket server, and socket.io server
 */
class FluxServer {
  static defaultMode = 'http';

  static servers = { http: nodeHttp, https: nodeHttps };

  static supportedModes = ['http', 'https'];

  // Default middlewares now uses configured CORS (SEC-04 fix) and redacted logging (SEC-05 fix)
  static get defaultMiddlewares() {
    return [
      compression(),
      morgan(redactedCombinedFormat),
      express.json(),
      cors(buildCorsOptions()),
    ];
  }

  static defaultRouteBuilder = routes;

  static defaultErrorHandler = () => { };

  /**
   * The Flux socket io server instance
   */
  get socketIo() {
    return this.socketIoServer;
  }

  /**
   * The express app (socket connection handler)
   */
  get app() {
    return this.expressApp;
  }

  constructor(options = {}) {
    const mode = options.mode || FluxServer.defaultMode;
    const middlewares = options.middlewares || FluxServer.defaultMiddlewares;
    const routeBuilder = options.routeBuilder || FluxServer.defaultRouteBuilder;

    const key = options.key || null;
    const cert = options.cert || null;

    this.expressApp = options.expressApp || express();
    this.errorHandler = options.errorHandler || FluxServer.defaultErrorHandler;

    if (!FluxServer.supportedModes.includes(mode)) {
      throw new Error('FluxServer mode must be one of: http, https');
    }

    if (mode === 'https' && (!key || !cert)) {
      throw new Error('Key and Cert required for https server');
    }

    if (!options.expressApp) {
      middlewares.forEach((middleware) => this.expressApp.use(middleware));
      routeBuilder(this.expressApp);
    }

    // you can pass them into an http server and it ignores key / cert but
    // better to not pass in unneeded properties
    const sslConfig = key && cert ? { key, cert } : {};

    const server = FluxServer.servers[mode].createServer(
      sslConfig,
      this.expressApp,
    );

    this.socketServer = new FluxWebsocketServer({
      routes: socketHandlers,
      errorHandler: this.errorHandler,
    });

    this.socketIoServer = new FluxSocketIoServer(server, {
      handlers: socketIoHandlers,
      errorHandler: this.errorHandler,
    });

    this.socketIoServer.attachNamespaceListeners();

    // remove the socket.io listener (so we only handle upgrade once)
    server.removeAllListeners('upgrade');

    server.on('upgrade', (request, socket, head) => {
      let provider;

      // ws is the hot path
      if (request.url.startsWith('/ws/')) {
        provider = this.socketServer;
      } else if (request.url.startsWith('/socket.io/')) {
        provider = this.socketIoServer;
      } else {
        socket.destroy();
        return;
      }

      provider.handleUpgrade(request, socket, head);
    });

    /**
     * The http server
     */
    this.server = server;
  }

  get isHttps() {
    return this.server instanceof nodeHttps.Server;
  }

  async listen(port) {
    return new Promise((resolve, reject) => {
      this.server
        .once('error', (err) => {
          this.server.removeAllListeners('listening');
          reject(err);
        })
        .once('listening', () => {
          this.server.removeAllListeners('error');
          resolve(null);
        });
      this.server.listen(port);
    });
  }

  close(callback) {
    this.server.close(callback);
  }
}

module.exports = { FluxServer };
