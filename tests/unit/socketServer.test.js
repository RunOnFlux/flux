const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire').noCallThru();

const handlerA = sinon.stub();
const handlerB = sinon.stub();
const routes = { '/ws/flux/:port': handlerA, '/ws/flux': handlerA, '/ws/testendpoint': handlerB };

const socketServer = require('../../ZelBack/src/lib/socketServer');

describe('FluxSocketServer tests', () => {
  beforeEach(async () => { });

  afterEach(() => {
    sinon.restore();
  });

  it('should build route matchers from route parameters', () => {
    const server = new socketServer.FluxWebsocketServer({ routes });
    expect(server.routeMatchers.length).to.be.equal(Object.keys(routes).length);
  });

  it('should call the correct handler for the supplied route', () => {
    const testUrls = ['/ws/flux/3333/', '/ws/flux/', '/ws/testendpoint'];
    const testHandlers = [handlerA, handlerA, handlerB];
    const testParams = [['3333'], [], []];

    const server = new socketServer.FluxWebsocketServer({ routes });
    const fakeRequest = { headers: {}, url: '/test' };

    testUrls.forEach((url, index) => {
      const handler = server.matchRoute(url);
      const sock = `testwebsocket_${index}`;

      expect(handler).to.be.a('function');

      handler(sock, fakeRequest);

      sinon.assert.calledWithExactly(testHandlers[index], sock, ...testParams[index], fakeRequest);
    });
  });

  it('should return no handler if the route does not match', () => {
    const testUrl = '/doesnotexist';

    const server = new socketServer.FluxWebsocketServer({ routes });

    const handler = server.matchRoute(testUrl);

    expect(handler).to.equal(null);
  });

  // A handshake that completes is already a connection: the peer reads our
  // capabilities out of the 101's headers, builds a peer object, counts it and
  // writes to it before this side has run a line of its own. Closing afterwards
  // leaves it holding something it believes in and loses what it wrote. So a
  // refusal has to be answered instead of the handshake, not after it.
  describe('refusing an upgrade', () => {
    // A real upgrade socket is an EventEmitter, and the difference this cares
    // about - a queued write surviving to be flushed - is only visible on one.
    const fakeSocket = () => {
      const socket = new EventEmitter();
      socket.write = sinon.stub();
      socket.destroy = sinon.stub();
      socket.end = sinon.stub().callsFake(() => socket.emit('finish'));
      return socket;
    };

    it('answers with the status and never completes the handshake', () => {
      const admit = sinon.stub().returns({ status: 503, message: 'Service Unavailable', reason: 'node-not-accepting-connections' });
      const server = new socketServer.FluxWebsocketServer({ routes, admit });
      const socket = fakeSocket();
      const request = { url: '/ws/flux/16127', headers: {} };
      const onConnection = sinon.stub();
      server.wsServer.on('connection', onConnection);

      server.handleUpgrade(request, socket, Buffer.alloc(0));

      const written = socket.end.firstCall.args[0];
      expect(written).to.match(/^HTTP\/1\.1 503 Service Unavailable\r\n/);
      expect(written).to.include('X-Flux-Refusal: node-not-accepting-connections');
      expect(written).to.include('Content-Length: 0');
      expect(socket.destroy.calledOnce, 'the socket was left open').to.equal(true);
      expect(onConnection.called, 'the handshake completed anyway').to.equal(false);
    });

    // destroy() does not wait for a queued write. Answering with end() is what
    // makes the status reach the dialler rather than being discarded with the
    // socket that was carrying it, which would leave it a bare reset.
    it('flushes the refusal before closing, rather than closing over it', () => {
      const admit = sinon.stub().returns({ status: 503, message: 'Service Unavailable', reason: 'node-not-accepting-connections' });
      const server = new socketServer.FluxWebsocketServer({ routes, admit });
      const socket = fakeSocket();
      const destroyedBeforeFlush = [];
      socket.end = sinon.stub().callsFake(() => {
        destroyedBeforeFlush.push(socket.destroy.called);
        socket.emit('finish');
      });

      server.handleUpgrade({ url: '/ws/flux/16127', headers: {} }, socket, Buffer.alloc(0));

      expect(socket.end.calledOnce, 'the refusal was not sent through end()').to.equal(true);
      expect(socket.write.called, 'the refusal was written where it could be discarded').to.equal(false);
      expect(destroyedBeforeFlush, 'the socket was destroyed before the status left it').to.deep.equal([false]);
      expect(socket.destroy.calledOnce, 'the socket was not closed after the flush').to.equal(true);
    });

    // http removes its own error listener before handing the socket over, so an
    // error here has nowhere to go - and node throws those, which apiServer
    // turns into an exit. This path only runs during a boot.
    it('handles an error on the refused socket instead of letting it exit the node', () => {
      const admit = sinon.stub().returns({ status: 503, message: 'Service Unavailable', reason: 'node-not-accepting-connections' });
      const server = new socketServer.FluxWebsocketServer({ routes, admit });
      const socket = fakeSocket();

      server.handleUpgrade({ url: '/ws/flux/16127', headers: {} }, socket, Buffer.alloc(0));

      expect(socket.listenerCount('error'), 'nothing was listening for an error on our own socket').to.be.greaterThan(0);
      expect(() => socket.emit('error', new Error('ECONNRESET')), 'an error on the refused socket was left to the process').to.not.throw();
    });

    it('completes the handshake when admission returns nothing', () => {
      const admit = sinon.stub().returns(null);
      const server = new socketServer.FluxWebsocketServer({ routes, admit });
      const socket = fakeSocket();
      const upgrade = sinon.stub(server.wsServer, 'handleUpgrade');

      server.handleUpgrade({ url: '/ws/flux/16127', headers: {} }, socket, Buffer.alloc(0));

      expect(upgrade.calledOnce, 'an admitted upgrade was not handed to ws').to.equal(true);
      expect(socket.write.called, 'an admitted upgrade was answered with a status').to.equal(false);
      expect(socket.destroy.called).to.equal(false);
    });

    it('admits everything when no admission function is supplied', () => {
      const server = new socketServer.FluxWebsocketServer({ routes });
      const socket = fakeSocket();
      const upgrade = sinon.stub(server.wsServer, 'handleUpgrade');

      server.handleUpgrade({ url: '/ws/flux/16127', headers: {} }, socket, Buffer.alloc(0));

      expect(upgrade.calledOnce).to.equal(true);
      expect(socket.destroy.called).to.equal(false);
    });
  });

  // The capability is a wire contract: a peer reads it off this header and uses
  // it to decide whether we can be asked for app state without an uptime bar.
  // Declaring it in the list and never sending it would leave every current
  // build being treated as one that cannot refuse.
  describe('the upgrade response advertises what this build speaks', () => {
    const headersOf = () => {
      const server = new socketServer.FluxWebsocketServer({ routes });
      const headers = [];
      server.wsServer.emit('headers', headers, { headers: {}, url: '/ws/flux' });
      return headers;
    };

    it('says it can refuse a state-sync request', () => {
      const capabilities = headersOf().find((h) => h.startsWith('X-Flux-Capabilities:'));

      expect(capabilities, 'no capabilities header was sent at all').to.be.a('string');
      expect(capabilities.split(':')[1].split(',').map((c) => c.trim()))
        .to.include('appStateSyncRefusal');
    });

    it('still says it speaks the state sync at all', () => {
      const capabilities = headersOf().find((h) => h.startsWith('X-Flux-Capabilities:'));

      expect(capabilities.split(':')[1].split(',').map((c) => c.trim()))
        .to.include('appStateSync');
    });
  });

  describe('admitUpgrade', () => {
    const load = (acceptingConnections) => proxyquire('../../ZelBack/src/lib/socketHandlers', {
      '../services/idService': { wsRespondLoginPhrase: sinon.stub(), wsRespondSignature: sinon.stub() },
      '../services/paymentService': { wsRespondPayment: sinon.stub() },
      '../services/utils/peerState': {
        peerManager: { acceptingConnections, validateAndAddInbound: sinon.stub() },
      },
    }).admitUpgrade;

    it('refuses a peer upgrade while the node is not accepting connections', () => {
      const admitUpgrade = load(false);

      expect(admitUpgrade({ url: '/ws/flux' })).to.deep.equal({
        status: 503, message: 'Service Unavailable', reason: 'node-not-accepting-connections',
      });
      expect(admitUpgrade({ url: '/ws/flux/16127' })).to.not.equal(null);
    });

    it('admits a peer upgrade once the node is accepting connections', () => {
      const admitUpgrade = load(true);

      expect(admitUpgrade({ url: '/ws/flux' })).to.equal(null);
      expect(admitUpgrade({ url: '/ws/flux/16127' })).to.equal(null);
    });

    // Browsers reach these, and whether this node has peers yet has nothing to
    // do with signing a login phrase.
    it('admits the browser routes while the node is not accepting connections', () => {
      const admitUpgrade = load(false);

      expect(admitUpgrade({ url: '/ws/id/somephrase' })).to.equal(null);
      expect(admitUpgrade({ url: '/ws/sign/somemessage' })).to.equal(null);
      expect(admitUpgrade({ url: '/ws/payment/someid' })).to.equal(null);
      expect(admitUpgrade({ url: '/ws/fluxsomethingelse' }), 'matched a route by prefix alone').to.equal(null);
    });
  });
});
