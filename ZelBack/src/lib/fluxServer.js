const nodeHttp = require('node:http');
const nodeHttps = require('node:https');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const routes = require('../routes');

const socketHandlers = require('./socketHandlers');
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
    compression(),
    morgan('combined'),
    express.json(),
    cors(),
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

    const server = FluxServer.servers[mode].createServer(this.expressApp, {
      key,
      cert,
    });

    this.socketServer = new FluxWebsocketServer({
      routes: socketHandlers,
      errorHandler: this.errorHandler,
    });

    this.socketIoServer = new FluxSocketIoServer(server, {
      handlers: socketIoHandlers,
      errorHandler: this.errorHandler,
    });

    this.socketIoServer.attachNamespaceListeners();

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

    this.server = server;
  }

  async listen(port) {
    return new Promise((resolve, reject) => {
      this.server
        .once('error', (err) => {
          this.server
            .listeners('listening')
            .forEach((l) => this.server.removeListener('listening', l));
          reject(err);
        })
        .once('listening', () => {
          this.server
            .listeners('error')
            .forEach((l) => this.server.removeListener('error', l));
          resolve();
        });
      this.server.listen(port);
    });
  }
}

module.exports = { FluxServer };
