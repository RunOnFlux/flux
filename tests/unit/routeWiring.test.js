// A guard is worth exactly what it is wired to.
//
// rejectQueryParameters had a full suite of its own, all green, while
// /apps/heldcomponents ran cached and unguarded: the guard was never applied to
// the route. apicache keys on the request URL, so an anonymous caller varying a
// parameter missed the cache every time and got one docker call per request -
// under a comment promising a bound of one a second.
//
// A test of the guard cannot catch that, because nothing about the guard was
// wrong. So this reads the real route table instead: routes.js registers against
// a recording stand-in for express, and the assertions are made against the
// middleware chain it actually built.

const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const apicache = require('apicache');

const registerRoutes = require('../../ZelBack/src/routes');
const { asyncRoute, rejectQueryParameters, requireBootSettled } = require('../../ZelBack/src/services/utils/routeGuards');

/**
 * The route table routes.js builds, as a list of {method, path, chain}.
 * @returns {Array<{method: string, path: string, chain: Function[]}>}
 */
function recordRouteTable() {
  const routes = [];
  // routes.js also calls app.use and the websocket helpers; a proxy answers
  // whatever it reaches for and returns itself, so chained calls keep working.
  const recorder = new Proxy({}, {
    get: (_target, method) => (...args) => {
      const [path, ...chain] = args;
      // app.get doubles as express's settings reader - a lone string is a
      // setting being read, not a route being declared
      if (typeof path === 'string' && chain.length) {
        routes.push({ method, path, chain });
      }
      return recorder;
    },
  });
  registerRoutes(recorder);
  return routes;
}

/**
 * apicache's middleware factory returns a function named cache carrying its own
 * .options - which is how a chain entry is identified as the cache rather than by
 * position, since routes carry other middleware too.
 * @param {Function} fn - a middleware from a route's chain
 * @returns {boolean}
 */
function isApicache(fn) {
  return typeof fn === 'function' && fn.name === 'cache' && typeof fn.options === 'function';
}

describe('route wiring', () => {
  let table;

  before(() => {
    table = recordRouteTable();
  });

  it('registers a route table at all, so an empty one cannot pass every assertion below', () => {
    expect(table.length).to.be.greaterThan(100);
  });

  describe('endpoints that take no query parameters', () => {
    // Unauthenticated, read by peers mid-election, and each one either does
    // backend work per request or sits beside one that does.
    const guarded = [
      '/apps/heldcomponents',
      '/apps/promotedfolders',
      '/apps/placementlocations',
    ];

    guarded.forEach((path) => {
      it(`${path} rejects query parameters`, () => {
        const route = table.find((entry) => entry.path === path && entry.method === 'get');
        expect(route, `${path} is not registered as a GET`).to.not.equal(undefined);
        expect(route.chain).to.include(rejectQueryParameters);
      });

      it(`${path} rejects them before anything caches the response`, () => {
        const route = table.find((entry) => entry.path === path && entry.method === 'get');
        const guardAt = route.chain.indexOf(rejectQueryParameters);
        const cacheAt = route.chain.findIndex((fn) => fn && fn.name === 'cache');
        // A route with no cache has nothing to order against, and the guard
        // still has to be there - asserted above.
        if (cacheAt !== -1) expect(guardAt).to.be.lessThan(cacheAt);
      });
    });
  });

  describe('endpoints held until boot settles', () => {
    // The boot gate is worth exactly what it is wired to, and the file-operation
    // endpoints were the half it missed: ten legacy commands carried
    // requireBootSettled while eight endpoints that also create a container - the
    // four object operations, the upload, and create/rename/remove - ran
    // unguarded, which is what left boot recovery able to race a live operation.
    const bootGated = [
      { method: 'get', path: '/apps/appstart/:appname?/:global?' },
      { method: 'get', path: '/apps/appstop/:appname?/:global?' },
      { method: 'get', path: '/apps/apprestart/:appname?/:global?' },
      { method: 'get', path: '/apps/appkill/:appname?' },
      { method: 'get', path: '/apps/apppause/:appname?/:global?' },
      { method: 'get', path: '/apps/appunpause/:appname?/:global?' },
      { method: 'get', path: '/apps/appremove/:appname?/:force?/:global?' },
      { method: 'get', path: '/apps/installapplocally/:appname?' },
      { method: 'get', path: '/apps/testappinstall/:appname?' },
      { method: 'get', path: '/apps/redeploy/:appname?/:force?/:global?' },
      { method: 'get', path: '/apps/redeploycomponent/:appname?/:component?/:force?' },
      { method: 'post', path: '/ioutils/fileupload/:type?/:appname?/:component?/:folder?/:filename?' },
      { method: 'get', path: '/apps/createfolder/:appname?/:component?/:folder?' },
      { method: 'get', path: '/apps/renameobject/:appname?/:component?/:oldpath?/:newname?' },
      { method: 'get', path: '/apps/removeobject/:appname?/:component?/:object?' },
      { method: 'post', path: '/apps/moveobject' },
      { method: 'post', path: '/apps/copyobject' },
      { method: 'post', path: '/apps/compressobject' },
      { method: 'post', path: '/apps/extractobject' },
    ];

    bootGated.forEach(({ method, path }) => {
      it(`${method.toUpperCase()} ${path} is held until boot settles`, () => {
        const route = table.find((entry) => entry.path === path && entry.method === method);
        expect(route, `${path} is not registered as a ${method.toUpperCase()}`).to.not.equal(undefined);
        expect(route.chain).to.include(requireBootSettled);
      });
    });
  });
  // Every route hands its failures to express, which answers 500 - so a failure
  // is a response now, and apicache stores whatever a handler produced. Without
  // a bound on what may be stored, one transient rejection is served to every
  // later caller for the whole window, up to a day on the longest of these, and
  // only a restart clears it.
  //
  // Asserted through a real express stack rather than by reading the option
  // back: the property is that a failure is not remembered, and the option is
  // only the mechanism that currently delivers it. Requiring routes.js above is
  // what applies it.
  describe('what a cache is allowed to remember', () => {
    let app;
    let calls;

    beforeEach(() => {
      apicache.clear();
      calls = { boom: 0, fine: 0 };
      app = express();
      app.get('/boom', apicache.middleware('30 seconds'), asyncRoute(async () => {
        calls.boom += 1;
        throw new Error('transient');
      }));
      app.get('/fine', apicache.middleware('30 seconds'), asyncRoute(async (req, res) => {
        calls.fine += 1;
        res.json({ status: 'success', data: 42 });
      }));
    });

    afterEach(() => {
      apicache.clear();
    });

    it('does not answer a later caller from a handler that failed', async () => {
      const first = await request(app).get('/boom');
      const second = await request(app).get('/boom');

      expect(first.status).to.equal(500);
      expect(second.status).to.equal(500);
      expect(calls.boom, 'the second caller was served the first one\'s failure').to.equal(2);
    });

    // The control: without it the assertion above passes on a cache that is
    // simply not working at all.
    it('still answers a later caller from a handler that succeeded', async () => {
      await request(app).get('/fine');
      const second = await request(app).get('/fine');

      expect(second.status).to.equal(200);
      expect(second.body).to.deep.equal({ status: 'success', data: 42 });
      expect(calls.fine, 'the cache did not serve the second caller').to.equal(1);
    });
  });

  describe('endpoints that decide who is asking', () => {
    // apicache answers from its store BEFORE the handler runs, and keys an entry on
    // the request URL alone - nothing about the caller. So the privilege check
    // inside the handler never runs for the second caller, who is handed the first
    // caller's response, and whatever the handler would have DONE never happens.
    //
    // Both halves were staged against a node: one user's session row, login phrase
    // included, was served to a different user, and a second user's logout was
    // answered from the first user's cached success while their session stayed
    // live. A cache in front of any of these is wrong however cheap the route is.
    //
    // The list is explicit because the route table alone cannot say which handler
    // checks a privilege - that lives in the service module behind it. Add a path
    // here when a route gains a privilege check.
    const decidesByCaller = [
      '/apps/listappsimages',
      '/daemon/getinfo',
      '/daemon/validateaddress/:fluxaddress?',
      '/flux/restart',
      '/flux/peerhistory',
      '/flux/currentbranch',
      '/flux/currentcommitid',
      '/daemon/prioritisetransaction/:txid?/:prioritydelta?/:feedelta?',
      '/daemon/submitblock/:hexdata?/:jsonparametersobject?',
      '/id/loggedsessions',
      '/id/logoutcurrentsession',
      '/id/logoutallsessions',
      '/zelid/loggedsessions',
      '/zelid/logoutcurrentsession',
      '/zelid/logoutallsessions',
      '/syncthing/system/browse/:current?',
      '/syncthing/system/debug/:enable?/:disable?',
      '/syncthing/system/discovery/:device?/:addr?',
      '/syncthing/system/error/clear',
      '/syncthing/system/error/:message?',
      '/syncthing/system/log/:since?',
      '/syncthing/system/logtxt/:since?',
      '/syncthing/system/paths',
      '/syncthing/system/pause/:device?',
      '/syncthing/system/reset/:folder?',
      '/syncthing/system/restart',
      '/syncthing/system/resume/:device?',
      '/syncthing/system/shutdown',
      '/syncthing/system/upgrade',
      '/syncthing/config',
      '/syncthing/config/gui',
      '/syncthing/events/disk',
      '/syncthing/events/:events?/:since?/:limit?/:timeout?',
      '/syncthing/svc/random/string/:length?',
      '/syncthing/debug/peercompletion',
      '/syncthing/debug/httpmetrics',
      '/syncthing/debug/cpuprof',
      '/syncthing/debug/heapprof',
      '/syncthing/debug/support',
      '/syncthing/debug/file',
      '/syncthing/metrics',
      '/syncthing/metrics/health',
      '/syncthing/metrics/history/:limit?',
      '/syncthing/peer/diagnostics',
    ];

    // Without this, a renamed or mistyped path would make every assertion below
    // pass on a route that no longer exists.
    it('names paths that are all really registered', () => {
      const missing = decidesByCaller.filter((path) => !table.some((entry) => entry.path === path));
      expect(missing, 'these paths are not in the route table').to.deep.equal([]);
    });

    it('are answered by their handler, never from a cache', () => {
      const cached = decidesByCaller.filter((path) => table
        .filter((entry) => entry.path === path)
        .some((entry) => entry.chain.some(isApicache)));
      expect(cached, 'these check a privilege behind a cache that answers first').to.deep.equal([]);
    });
  });
});
