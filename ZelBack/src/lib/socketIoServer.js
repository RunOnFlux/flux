const socketio = require('socket.io');
const handlers = require('./socketIoHandlers');

class SocketIoServer {
  constructor(httpServer, options = {}) {
    const transports = options.transports || ['websocket', 'polling', 'flashsocket'];
    const cors = options.cors || { origin: '*', methods: ['GET', 'POST'] };

    this.io = new socketio.Server(httpServer, {
      allowEIO3: true,
      transports,
      cors,
    });

    this.io.on('error', (err) => console.log(err));
  }

  addListener(event, listener, options = {}) {
    const namespace = `/${options.namespace}` || '/';
    // console.log('ADDING LISTENER FOR NAMESPACE', namespace);
    this.io.of(namespace).on(event, listener);
  }

  listen() {
    this.addListener('connection', () => { console.log('ahhhhhhhhh'); });
    // console.log('ADDING LISTENERS');
    Object.entries(handlers).forEach((entry) => {
      const [namespace, listener] = entry;
      // console.log('ADDING FOR', namespace);
      this.addListener('connection', listener, { namespace });
    });
  }

  getRoom(room, options = {}) {
    const namespace = `/${options.namespace}` || '/';
    // console.log('GETTING ROOM', room, 'FOR NAMESPACE', namespace);
    return this.io.of(namespace).to(room);
  }

  getNamespace(namespace) {
    return this.io.of(`/${namespace}`);
  }

  getAdapter(namespace) {
    return this.getNamespace(namespace).adapter;
  }

  getSocketById(namespace, id) {
    return this.getNamespace(namespace).sockets.get(id);
  }
}

module.exports = { SocketIoServer };
