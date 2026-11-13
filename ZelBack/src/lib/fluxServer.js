const nodeHttp = require('node:http');
const nodeHttps = require('node:https');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const fs = require('node:fs/promises');
const routes = require('../routes');
const serviceHelper = require('../services/serviceHelper');
const apiSocket = require('../services/utils/apiSocket');
const { analyticsMiddleware, startFlushTimer } = require('../services/analyticsService');

const { socketHandlers, admitUpgrade } = require('./socketHandlers');
const socketIoHandlers = require('./socketIoHandlers');
const { FluxWebsocketServer } = require('./socketServer');
const { FluxSocketIoServer } = require('./socketIoServer');

/**
 * Combines an http(s) server, classic websocket server, and socket.io server
 */
class FluxServer {
  static defaultMode = 'http';

  static servers = { http: nodeHttp, https: nodeHttps };

  static supportedModes = ['http', 'https'];

  static defaultMiddlewares = [
    // Behind the front proxy nginx compresses; a stream compressed twice is not one a client reads.
    compression({ filter: (req, res) => !apiSocket.socketPath() && compression.filter(req, res) }),
    morgan('combined'),
    express.json(),
    cors(),
    analyticsMiddleware,
  ];

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
    if (apiSocket.socketPath()) this.expressApp.set('trust proxy', apiSocket.TRUSTED_HOPS);
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

    // Node's default requestTimeout is 5 min, which kills large file uploads
    // (app backups) on slow connections. headersTimeout (60s default)
    // still defends against slowloris on the request line/headers, and
    // formidable caps body size at 10GB.
    server.requestTimeout = 2 * 60 * 60 * 1000;

    this.socketServer = new FluxWebsocketServer({
      routes: socketHandlers,
      admit: admitUpgrade,
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

  /**
   * The port the server is listening on, as the socket reports it; null
   * until it listens.
   * @returns {number|null}
   */
  get port() {
    return this.server.address()?.port ?? null;
  }

  /**
   * Listens on a port, or on a Unix socket given as {path, backlog, group}: a stale socket is
   * removed first, and the socket is open to its group once this resolves. The backlog matters
   * because a connect to a full Unix socket fails at once where TCP would retry, and every peer
   * reconnects together after a restart.
   * @param {number|string|{path: string, backlog: number, group: (string|undefined)}} target
   * @returns {Promise<null>}
   */
  async listen(target) {
    if (target?.path) {
      await fs.rm(target.path, { force: true });
      await this.bind({ path: target.path, backlog: target.backlog });
      if (target.group) {
        const { error } = await serviceHelper.runCommand('chgrp', { params: [target.group, target.path] });
        if (error) throw error;
      }
      await fs.chmod(target.path, apiSocket.SOCKET_MODE);
      return null;
    }
    return this.bind(target);
  }

  async bind(target) {
    return new Promise((resolve, reject) => {
      this.server
        .once('error', (err) => {
          this.server.removeAllListeners('listening');
          reject(err);
        })
        .once('listening', () => {
          this.server.removeAllListeners('error');
          startFlushTimer();
          resolve(null);
        });
      this.server.listen(target);
    });
  }

  close(callback) {
    this.server.close(callback);
  }
}

module.exports = { FluxServer };
