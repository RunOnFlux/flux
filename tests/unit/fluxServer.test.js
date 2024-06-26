const { expect } = require('chai');
const sinon = require('sinon');

const nodeHttp = require('node:http');
const nodeHttps = require('node:https');

const proxyquire = require('proxyquire');

const useStub = sinon.stub();
const noop = () => { };
const expressApp = { use: useStub, get: noop, post: noop };
const expressFunc = sinon.stub().returns(expressApp);

// we have to use proxyquire here as the default export for express is a function
const fluxServer = proxyquire('../../ZelBack/src/lib/fluxServer', { express: expressFunc });

describe('FluxServer tests', () => {
  const createHttpServer = Object.create(nodeHttp.Server.prototype);
  Object.assign(createHttpServer, { on: sinon.stub(), removeAllListeners: sinon.stub() });

  const createHttpsServer = Object.create(nodeHttps.Server.prototype);
  Object.assign(createHttpsServer, { on: sinon.stub(), removeAllListeners: sinon.stub() });

  beforeEach(async () => {
    sinon.stub(nodeHttp, 'createServer').returns(createHttpServer);
    sinon.stub(nodeHttps, 'createServer').returns(createHttpsServer);
  });

  afterEach(() => {
    sinon.restore();
    // restore doesn't reset the stub when using proxyquire for some reason
    useStub.reset();
  });

  it('should set default mode to http server', () => {
    const server = new fluxServer.FluxServer();
    expect(server.isHttps).to.equal(false);
  });

  it('should throw if mode is not http or https', () => {
    const mode = 'unknownmode';

    expect(() => new fluxServer.FluxServer({ mode })).to.throw(
      'FluxServer mode must be one of: http, https',
    );
  });

  it('should throw if mode is https without cert or key', () => {
    const mode = 'https';
    const calls = [{ key: 'mykey' }, { cert: 'mycert' }, {}];

    calls.forEach((call) => {
      expect(() => new fluxServer.FluxServer({ mode, ...call })).to.throw(
        'Key and Cert required for https server',
      );
    });
  });

  it('should not throw if mode is https and cert + key is present', () => {
    const options = { mode: 'https', key: 'mykey', cert: 'mycert' };

    expect(() => new fluxServer.FluxServer(options)).to.not.throw();
  });

  it('should create a new express app and add middlewares / routes if expressApp option not present', () => {
    const routeBuilder = sinon.stub();
    const testMiddleware = noop;
    const middlewares = [testMiddleware];

    const options = { routeBuilder, middlewares };

    const server = new fluxServer.FluxServer(options);

    expect(server.expressApp === expressApp).to.equal(true);
    sinon.assert.calledWithExactly(useStub, testMiddleware);
    sinon.assert.calledWithExactly(routeBuilder, expressApp);
  });

  it('should use existing express app and skip middlewares / routes if expressApp option present', () => {
    const routeBuilder = sinon.stub();
    const testMiddleware = noop;
    const middlewares = [testMiddleware];

    const localExpressApp = { use: useStub, get: noop, post: noop };

    const options = { routeBuilder, middlewares, expressApp: localExpressApp };

    const server = new fluxServer.FluxServer(options);

    expect(server.expressApp === localExpressApp).to.equal(true);
    sinon.assert.neverCalledWith(useStub);
    sinon.assert.notCalled(routeBuilder);
  });
});
