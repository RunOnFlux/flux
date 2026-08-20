const { expect } = require('chai');
const sinon = require('sinon');
const routes = require('../../ZelBack/src/routes');
const alwaysRespond = require('../../ZelBack/src/middlewares/alwaysRespond');
const isLocal = require('../../ZelBack/src/middlewares/isLocal');
const requireHttps = require('../../ZelBack/src/middlewares/requireHttps');
const appInspector = require('../../ZelBack/src/services/appManagement/appInspector');
const appController = require('../../ZelBack/src/services/appManagement/appController');
const monitoringOrchestrator = require('../../ZelBack/src/services/appMonitoring/monitoringOrchestrator');

// Nothing else builds the routing table, so a route wired to the wrong handler, or a
// middleware that was never mounted, reaches production unopposed. Build it against a
// recording app and assert what each path actually resolves to.
describe('routes tests', () => {
  let registered;

  before(() => {
    registered = [];
    const record = (method) => (path, ...handlers) => {
      registered.push({ method, path, handlers });
    };
    routes({
      get: record('get'),
      post: record('post'),
      put: record('put'),
      delete: record('delete'),
      use: record('use'),
      ws: record('ws'),
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  function routeFor(prefix) {
    const route = registered.find((r) => r.path === prefix || r.path.startsWith(`${prefix}/:`));
    expect(route, `no route registered for ${prefix}`).to.not.be.undefined;
    return route;
  }

  function invoke(prefix, req = {}, res = {}) {
    const route = routeFor(prefix);
    return route.handlers[route.handlers.length - 1](req, res);
  }

  it('should build the routing table', () => {
    expect(registered.length).to.be.greaterThan(0);
  });

  it('should register a callable handler for every route', () => {
    const bad = registered.filter((r) => r.handlers.some((h) => typeof h !== 'function'));

    expect(bad.map((r) => r.path)).to.deep.equal([]);
  });

  describe('handler wiring', () => {
    it('should route appmonitor to the inspector handler', () => {
      const stub = sinon.stub(appInspector, 'appMonitorAPI');
      const req = {};
      const res = {};

      invoke('/apps/appmonitor', req, res);

      sinon.assert.calledOnceWithExactly(stub, req, res);
    });

    it('should route appstats to the inspector handler', () => {
      const stub = sinon.stub(appInspector, 'appStats');
      const req = {};
      const res = {};

      invoke('/apps/appstats', req, res);

      sinon.assert.calledOnceWithExactly(stub, req, res);
    });

    it('should route the monitoring control to the orchestrator', () => {
      const start = sinon.stub(monitoringOrchestrator, 'startAppMonitoringAPI');
      const stop = sinon.stub(monitoringOrchestrator, 'stopAppMonitoringAPI');

      invoke('/apps/startmonitoring');
      invoke('/apps/stopmonitoring');

      sinon.assert.calledOnce(start);
      sinon.assert.calledOnce(stop);
    });

    it('should route appstop to the controller', () => {
      const stub = sinon.stub(appController, 'appStop');
      const req = {};
      const res = {};

      invoke('/apps/appstop', req, res);

      sinon.assert.calledOnceWithExactly(stub, req, res);
    });
  });

  describe('middleware mounting', () => {
    // Repeating one of these must not collapse to a bodiless 304, or the caller cannot
    // tell whether the action ran.
    const CONTROL_ROUTES = [
      '/apps/appstart',
      '/apps/appstop',
      '/apps/apprestart',
      '/apps/apppause',
      '/apps/appunpause',
      '/apps/appremove',
      '/apps/redeploy',
      '/apps/redeploycomponent',
      // Retired, and the reason they need this most: the body is byte-identical
      // every time, so express ETags it and a revalidating caller gets an empty
      // 304 from the second call on - unable to read the deprecation notice that
      // is now the only thing these routes exist to serve.
      '/apps/startmonitoring',
      '/apps/stopmonitoring',
    ];

    CONTROL_ROUTES.forEach((prefix) => {
      it(`should answer ${prefix} in full on every call`, () => {
        expect(routeFor(prefix).handlers).to.include(alwaysRespond);
      });
    });

    it('should not mount alwaysRespond on read endpoints', () => {
      expect(routeFor('/apps/appstats').handlers).to.not.include(alwaysRespond);
      expect(routeFor('/apps/appmonitor').handlers).to.not.include(alwaysRespond);
    });

    it('should keep the arcane auth endpoints on https', () => {
      expect(routeFor('/arcane/authchallenge').handlers).to.include(requireHttps);
    });

    it('should keep the backend folder local only', () => {
      expect(routeFor('/flux/backendfolder').handlers).to.include(isLocal);
    });
  });
});
