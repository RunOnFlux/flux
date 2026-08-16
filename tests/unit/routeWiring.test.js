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

const registerRoutes = require('../../ZelBack/src/routes');
const { rejectQueryParameters, requireBootSettled } = require('../../ZelBack/src/services/utils/routeGuards');

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
});
