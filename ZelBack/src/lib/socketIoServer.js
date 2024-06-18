const socketio = require('socket.io');
const handlers = require('./socketIoHandlers');

class SocketIoServer {
  static defaultErrorHandler = (err) => { console.log(err); };

  constructor(httpServer, options = {}) {
    const transports = options.transports || ['websocket', 'polling', 'flashsocket'];
    const cors = options.cors || { origin: '*', methods: ['GET', 'POST'] };

    const errorHandler = options.errorHandler || SocketIoServer.defaultErrorHandler;

    this.io = new socketio.Server(httpServer, {
      allowEIO3: true,
      transports,
      cors,
    });

    this.io.on('error', (err) => errorHandler(err));
  }

  addListener(event, listener, options = {}) {
    const namespace = `/${options.namespace}` || '/';
    this.io.of(namespace).on(event, listener);
  }

  listen() {
    Object.entries(handlers).forEach((entry) => {
      const [namespace, listener] = entry;
      this.addListener('connection', listener, { namespace });
    });
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

module.exports = { SocketIoServer };
