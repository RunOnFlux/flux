const { expect } = require('chai');
const sinon = require('sinon');

const { Server } = require('node:http');
const { EventEmitter } = require('node:events');

const handlerA = sinon.stub();
const handlerB = sinon.stub();
const handlers = { a: handlerA, b: handlerB };

const io = require('../../ZelBack/src/lib/socketIoServer');

// Stands in for a connected socket. Registration and removal go through a real
// emitter, so what the guard does to a listener is visible in what the emitter
// then holds; `emit` is a stub because it is what a refused caller is told.
const makeSocket = () => {
  const events = new EventEmitter();
  return {
    on: (event, fn) => events.on(event, fn),
    once: (event, fn) => events.once(event, fn),
    off: (event, fn) => events.off(event, fn),
    removeListener: (event, fn) => events.removeListener(event, fn),
    listeners: (event) => events.listeners(event),
    // Calls the registered listeners directly, so what one returns is visible -
    // which is how the guard's pass-through is asserted.
    fire: (event, ...args) => events.listeners(event).map((fn) => fn(...args)),
    // Goes through the emitter, which is what performs a once listener's own
    // removal. fire() above never would, and the listener would look retained.
    dispatch: (event, ...args) => events.emit(event, ...args),
    emit: sinon.stub(),
  };
};

// The handler a namespace was given, as it is actually registered.
const connectionListenerFor = (ioServer, namespace) => {
  ioServer.attachNamespaceListeners();
  return ioServer.getListenersByNamespace(namespace)[0];
};

describe('FluxSocketServer tests', () => {
  beforeEach(async () => {
    handlerA.resetHistory();
    handlerB.resetHistory();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should set correct default properties when no parameters used', () => {
    const httpServer = new Server();
    const ioServer = new io.FluxSocketIoServer(httpServer);
    const errorHandlers = ioServer.io.listeners('error');

    expect(ioServer.io.opts.transports).to.deep.equal(['websocket', 'polling', 'flashsocket']);
    expect(ioServer.io.opts.cors).to.deep.equal({ origin: '*', methods: ['GET', 'POST'] });
    expect(errorHandlers.length).to.equal(1);
  });

  it('should set correct properties when parameters used', () => {
    let logged = false;
    const errorHandler = () => { logged = true; };

    const httpServer = new Server();
    const ioServer = new io.FluxSocketIoServer(httpServer, { transports: ['websocket'], cors: { origin: '/test', methods: ['GET'] }, errorHandler });
    const errorHandlers = ioServer.io.listeners('error');

    expect(ioServer.io.opts.transports).to.deep.equal(['websocket']);
    expect(ioServer.io.opts.cors).to.deep.equal({ origin: '/test', methods: ['GET'] });

    // this would be a lot easier to test if the error event called the handler direclty
    errorHandlers[0]();
    expect(logged).to.equal(true);
  });

  it('should add all handlers from socketIoHandlers', () => {
    const httpServer = new Server();
    const ioServer = new io.FluxSocketIoServer(httpServer, { handlers });

    ioServer.attachNamespaceListeners();

    const aListeners = ioServer.getListenersByNamespace('a');
    const bListeners = ioServer.getListenersByNamespace('b');

    expect(aListeners.length).to.equal(1);
    expect(bListeners.length).to.equal(1);

    // What is registered is the guard, not the handler, so this asserts the
    // handler is reached rather than that it is the same function object.
    const socketA = makeSocket();
    aListeners[0](socketA);
    sinon.assert.calledOnce(handlerA);
    expect(handlerA.firstCall.args[0]).to.equal(socketA);
    sinon.assert.notCalled(handlerB);
  });

  // socket.io calls a listener and throws its promise away, so a listener that
  // fails is an unhandled rejection, apiServer's uncaughtException handler, and
  // process.exit. Proven by removing the guard: each of these took the run down
  // with the error it was given instead of answering with it.
  describe('a listener that fails', () => {
    const failing = new Error('listener exploded');

    const serverWith = (handler) => new io.FluxSocketIoServer(new Server(), { handlers: { a: handler } });

    it('answers the client when the connection handler throws', () => {
      const listener = connectionListenerFor(serverWith(() => { throw failing; }), 'a');
      const socket = makeSocket();

      listener(socket);

      sinon.assert.calledOnceWithExactly(socket.emit, 'error', 'Error handling request.');
    });

    it('answers the client when the connection handler rejects', async () => {
      const listener = connectionListenerFor(serverWith(async () => { throw failing; }), 'a');
      const socket = makeSocket();

      await listener(socket);

      sinon.assert.calledOnceWithExactly(socket.emit, 'error', 'Error handling request.');
    });

    it('answers the client when an event listener the handler registered throws', () => {
      const listener = connectionListenerFor(serverWith((socket) => {
        socket.on('exec', () => { throw failing; });
      }), 'a');
      const socket = makeSocket();
      listener(socket);

      socket.fire('exec');

      sinon.assert.calledOnceWithExactly(socket.emit, 'error', 'Error handling request.');
    });

    it('answers the client when an event listener the handler registered rejects', async () => {
      const listener = connectionListenerFor(serverWith((socket) => {
        socket.on('exec', async () => { throw failing; });
      }), 'a');
      const socket = makeSocket();
      listener(socket);

      await Promise.all(socket.fire('exec'));

      sinon.assert.calledOnceWithExactly(socket.emit, 'error', 'Error handling request.');
    });

    // The control: a guard that answered every call would pass all four above.
    it('leaves a listener that succeeds alone, and what it returns', () => {
      let seen;
      const listener = connectionListenerFor(serverWith((socket) => {
        socket.on('exec', (arg) => { seen = arg; return 'answered'; });
      }), 'a');
      const socket = makeSocket();
      listener(socket);

      const [returned] = socket.fire('exec', 'an argument');

      expect(seen).to.equal('an argument');
      expect(returned).to.equal('answered');
      sinon.assert.notCalled(socket.emit);
    });
  });

  // The guard registers a different function from the one it was handed, so a
  // socket that outlives its listeners has to be able to lose them: removal by
  // identity silently removes nothing otherwise, and the listener goes on
  // firing for as long as the socket is open.
  describe('the listeners a handler leaves behind', () => {
    const serverWith = (handler) => new io.FluxSocketIoServer(new Server(), { handlers: { a: handler } });

    it('registers one listener per on, not two', () => {
      const listener = connectionListenerFor(serverWith((socket) => {
        socket.on('exec', () => {});
      }), 'a');
      const socket = makeSocket();

      listener(socket);

      expect(socket.listeners('exec')).to.have.lengthOf(1);
    });

    it('removes the one it registered when the handler removes its own', () => {
      const registered = sinon.stub();
      const listener = connectionListenerFor(serverWith((socket) => {
        socket.on('exec', registered);
        socket.off('exec', registered);
      }), 'a');
      const socket = makeSocket();

      listener(socket);
      socket.fire('exec');

      expect(socket.listeners('exec'), 'the wrapper outlived the listener it wraps').to.have.lengthOf(0);
      sinon.assert.notCalled(registered);
    });

    it('removes it through removeListener too', () => {
      const registered = sinon.stub();
      const listener = connectionListenerFor(serverWith((socket) => {
        socket.on('exec', registered);
        socket.removeListener('exec', registered);
      }), 'a');
      const socket = makeSocket();

      listener(socket);

      expect(socket.listeners('exec')).to.have.lengthOf(0);
    });

    it('guards a once listener, and it still fires only once', () => {
      const calls = [];
      const listener = connectionListenerFor(serverWith((socket) => {
        socket.once('exec', () => { calls.push(1); throw new Error('after the first'); });
      }), 'a');
      const socket = makeSocket();
      listener(socket);

      socket.dispatch('exec');

      expect(calls).to.have.lengthOf(1);
      expect(socket.listeners('exec'), 'a once listener stayed registered').to.have.lengthOf(0);
      sinon.assert.calledOnceWithExactly(socket.emit, 'error', 'Error handling request.');
    });
  });
});
