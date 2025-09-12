const { expect } = require('chai');
const sinon = require('sinon');

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

    testUrls.forEach((url, index) => {
      const handler = server.matchRoute(url);
      const sock = `testwebsocket_${index}`;

      expect(handler).to.be.a('function');

      handler(sock);

      sinon.assert.calledWithExactly(testHandlers[index], sock, ...testParams[index]);
    });
  });

  it('should return no handler if the route does not match', () => {
    const testUrl = '/doesnotexist';

    const server = new socketServer.FluxWebsocketServer({ routes });

    const handler = server.matchRoute(testUrl);

    expect(handler).to.equal(null);
  });
});
