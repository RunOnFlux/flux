const socketio = require('socket.io');
const config = require('config');

/**
 * Builds Socket.IO CORS options from configuration (SEC-04 fix).
 * @returns {object} - CORS options for Socket.IO.
 */
function buildSocketIoCorsOptions() {
  const corsConfig = config.server.cors || {};
  const allowedOrigins = corsConfig.allowedOrigins || '*';
  const allowedMethods = corsConfig.allowedMethods || ['GET', 'POST'];

  return {
    origin: allowedOrigins,
    methods: allowedMethods,
  };
}

class FluxSocketIoServer {
  static defaultErrorHandler = () => { };

  static defaultTransports = ['websocket', 'polling', 'flashsocket'];

  // Default CORS now uses configuration (SEC-04 fix)
  static get defaultCors() {
    return buildSocketIoCorsOptions();
  }

  constructor(httpServer, options = {}) {
    this.handlers = options.handlers || {};

    const transports = options.transports || FluxSocketIoServer.defaultTransports;
    const corsOptions = options.cors || FluxSocketIoServer.defaultCors;

    const errorHandler = options.errorHandler || FluxSocketIoServer.defaultErrorHandler;

    this.io = new socketio.Server(httpServer, {
      allowEIO3: true,
      transports,
      cors: corsOptions,
    });

    this.io.on('error', (err) => errorHandler(err));
  }

  addListener(event, listener, options = {}) {
    const namespace = `/${options.namespace}` || '/';
    this.io.of(namespace).on(event, listener);
  }

  attachNamespaceListeners() {
    Object.entries(this.handlers).forEach((entry) => {
      const [namespace, listener] = entry;
      this.addListener('connection', listener, { namespace });
    });
  }

  handleUpgrade(request, socket, head) {
    this.io.engine.handleUpgrade(request, socket, head);
  }

  getRoom(room, options = {}) {
    const namespace = `/${options.namespace}` || '/';
    return this.io.of(namespace).to(room);
  }

  getNamespace(namespace) {
    return this.io.of(`/${namespace}`);
  }

  getAdapter(namespace) {
    return this.getNamespace(namespace).adapter;
  }

  getListenersByNamespace(namespace, event = 'connection') {
    return this.getNamespace(namespace).listeners(event);
  }

  getSocketById(namespace, id) {
    return this.getNamespace(namespace).sockets.get(id);
  }
}

module.exports = { FluxSocketIoServer };
