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
const { rejectQueryParameters } = require('../../ZelBack/src/services/utils/routeGuards');

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
});
