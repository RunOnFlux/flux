const socketio = require('socket.io');
const handlers = require('./socketIoHandlers');

class SocketIoServer {
  constructor(httpServer, options = {}) {
    const transports = options.transports || ['websocket', 'polling', 'flashsocket'];
    const cors = options.cors || { origin: '*', methods: ['GET', 'POST'] };

    this.io = socketio(httpServer, {
      transports,
      cors,
    });
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
}

module.exports = { SocketIoServer };
