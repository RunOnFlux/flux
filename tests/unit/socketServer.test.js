const { expect } = require('chai');
const sinon = require('sinon');
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
    const fakeSocket = () => ({ write: sinon.stub(), destroy: sinon.stub() });

    it('answers with the status and never completes the handshake', () => {
      const admit = sinon.stub().returns({ status: 503, message: 'Service Unavailable', reason: 'node-not-accepting-connections' });
      const server = new socketServer.FluxWebsocketServer({ routes, admit });
      const socket = fakeSocket();
      const request = { url: '/ws/flux/16127', headers: {} };
      const onConnection = sinon.stub();
      server.wsServer.on('connection', onConnection);

      server.handleUpgrade(request, socket, Buffer.alloc(0));

      const written = socket.write.firstCall.args[0];
      expect(written).to.match(/^HTTP\/1\.1 503 Service Unavailable\r\n/);
      expect(written).to.include('X-Flux-Refusal: node-not-accepting-connections');
      expect(written).to.include('Content-Length: 0');
      expect(socket.destroy.calledOnce, 'the socket was left open').to.equal(true);
      expect(onConnection.called, 'the handshake completed anyway').to.equal(false);
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
