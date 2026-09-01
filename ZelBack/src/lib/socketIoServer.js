const socketio = require('socket.io');

const log = require('./log');

// socket.io calls a listener and discards the promise it returns - dispatch()
// is `super.emitUntyped.apply` inside a process.nextTick, with no catch - so a
// listener that throws produces a rejection nobody handles, which reaches
// apiServer's uncaughtException handler and exits the node. An unauthenticated
// client emitting one malformed message was a restart of FluxOS.
//
// Every listener registered through this class answers its own client instead:
// the same bargain asyncRoute makes for a route, bounded to the one socket that
// failed, with everything else on the node untouched. Deliberately NOT the
// process-level unhandledRejection handler, which was proposed on this branch
// and rejected - that one swallows every failure everywhere and leaves the node
// running in a state nobody chose.
const LISTENER_FAILED = 'Error handling request.';

/**
 * A listener that leaves its failure through the socket rather than the process.
 * @param {object} socket The socket to answer
 * @param {string} event The event being listened for, for the log line
 * @param {Function} listener The listener as written
 * @returns {Function} the listener to register
 */
function answeringItsOwnClient(socket, event, listener) {
  const answer = (error) => {
    log.error(`socketIoServer: '${event}' listener failed: ${error.message}`);
    socket.emit('error', LISTENER_FAILED);
  };

  return function guarded(...args) {
    let result;
    try {
      result = listener(...args);
    } catch (error) {
      return answer(error);
    }
    // Returned as it was when it is not a promise: socket.io ignores what a
    // listener returns, and a caller inside this process may not.
    return typeof result?.then === 'function' ? result.catch(answer) : result;
  };
}

/**
 * The socket a handler is given, with every listener it registers guarded.
 *
 * The socket itself is mutated rather than replaced by a facade: a handler
 * reads handshake, emits, joins rooms, reads `connected` and disconnects, and a
 * facade that forgot one of those would fail a long way from here. socket.io
 * registers its own listeners in the Socket constructor, which has already run
 * by the time 'connection' is emitted, so none of them pass through this.
 *
 * The wrapper is a different function from the listener, so removal by identity
 * has to be translated or it silently removes nothing. A WeakMap, so an entry
 * lasts exactly as long as the listener it belongs to.
 *
 * Safe to apply twice - two listeners on one namespace are handed the same
 * socket - because the inner guard answers first and the outer one never sees
 * the failure, and a removal translates through both maps in turn.
 * @param {object} socket The connected socket
 * @returns {object} the same socket
 */
function guardingItsListeners(socket) {
  const wrappers = new WeakMap();
  const register = { on: socket.on, once: socket.once };
  const remove = { off: socket.off, removeListener: socket.removeListener };

  Object.keys(register).forEach((method) => {
    socket[method] = function guardedRegister(event, listener) {
      const wrapper = answeringItsOwnClient(socket, event, listener);
      wrappers.set(listener, wrapper);
      return register[method].call(this, event, wrapper);
    };
  });

  Object.keys(remove).forEach((method) => {
    socket[method] = function guardedRemove(event, listener) {
      return remove[method].call(this, event, wrappers.get(listener) || listener);
    };
  });

  return socket;
}

class FluxSocketIoServer {
  static defaultErrorHandler = () => { };

  static defaultTransports = ['websocket', 'polling', 'flashsocket'];

  static defaultCors = { origin: '*', methods: ['GET', 'POST'] };

  constructor(httpServer, options = {}) {
    this.handlers = options.handlers || {};

    const transports = options.transports || FluxSocketIoServer.defaultTransports;
    const cors = options.cors || FluxSocketIoServer.defaultCors;

    const errorHandler = options.errorHandler || FluxSocketIoServer.defaultErrorHandler;

    this.io = new socketio.Server(httpServer, {
      allowEIO3: true,
      transports,
      cors,
    });

    this.io.on('error', (err) => errorHandler(err));
  }

  addListener(event, listener, options = {}) {
    const namespace = `/${options.namespace}` || '/';
    // A namespace emits its socket as the first argument, so the connection
    // handler is guarded against the socket it was handed - and that socket
    // guards everything the handler goes on to register on it.
    this.io.of(namespace).on(event, (socket, ...rest) => (
      answeringItsOwnClient(socket, event, listener)(guardingItsListeners(socket), ...rest)
    ));
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
