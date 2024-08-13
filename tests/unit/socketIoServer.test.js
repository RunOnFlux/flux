const { expect } = require('chai');
const sinon = require('sinon');

const { Server } = require('node:http');

const handlerA = sinon.stub();
const handlerB = sinon.stub();
const handlers = { a: handlerA, b: handlerB };

const io = require('../../ZelBack/src/lib/socketIoServer');

describe('FluxSocketServer tests', () => {
  beforeEach(async () => { });

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

    // this would be a lot easier to test if the error event called the handler directly
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
    expect(aListeners[0]).to.be.equal(handlerA);
    expect(bListeners[0]).to.be.equal(handlerB);
  });
});
