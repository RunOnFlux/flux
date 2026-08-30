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

const fs = require('node:fs');
const path = require('node:path');

const { expect } = require('chai');
const espree = require('espree');
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
  // Read from the sources rather than from a list. A list of paths is only ever
  // as good as the last person to update it: it caught a cache put back on a
  // route it named and was blind to a new route added with one, which is the
  // direction this will actually be broken from. The route table alone cannot
  // say which handler checks a privilege - that lives in the service module
  // behind the route, and by the time a test sees the route it is a closure - so
  // the route file and those modules are parsed instead.
  describe('endpoints that decide who is asking', () => {
    const SRC_DIR = path.join(__dirname, '../../ZelBack/src');
    const parse = (src) => espree.parse(src, { ecmaVersion: 2022, sourceType: 'script', range: true });

    const walk = (node, visit, state) => {
      if (!node || typeof node.type !== 'string') return;
      const next = visit(node, state);
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) value.forEach((child) => walk(child, visit, next));
        else if (value && typeof value.type === 'string') walk(value, visit, next);
      }
    };

    /** Local name -> module path, from routes.js's own requires. */
    const requiredModules = (ast) => {
      const found = new Map();
      walk(ast, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
            && node.init && node.init.type === 'CallExpression'
            && node.init.callee.name === 'require'
            && typeof node.init.arguments[0]?.value === 'string') {
          found.set(node.id.name, node.init.arguments[0].value);
        }
        return null;
      });
      return found;
    };

    /**
     * The functions in one module that reach a privilege check, directly or
     * through another function of the same module - which is the shape the Api
     * halves use, the check in one and the work in the one beside it.
     */
    const checkersIn = (() => {
      const memo = new Map();

      return (modulePath) => {
        if (memo.has(modulePath)) return memo.get(modulePath);
        const file = path.join(SRC_DIR, `${modulePath.replace(/^\.\//, '')}.js`);
        if (!fs.existsSync(file)) { memo.set(modulePath, null); return null; }

        const ast = parse(fs.readFileSync(file, 'utf8'));
        const reaches = new Set();
        const calls = new Map();

        walk(ast, (node, enclosing) => {
          const here = (node.type === 'FunctionDeclaration' && node.id) ? node.id.name : enclosing;
          if (node.type === 'CallExpression' && here) {
            const { callee } = node;
            if (callee.type === 'MemberExpression' && callee.property.name === 'verifyPrivilege') reaches.add(here);
            if (callee.type === 'Identifier') {
              if (!calls.has(here)) calls.set(here, new Set());
              calls.get(here).add(callee.name);
            }
          }
          return here;
        }, null);

        for (let grew = true; grew;) {
          grew = false;
          for (const [fn, callees] of calls) {
            if (reaches.has(fn)) continue;
            if ([...callees].some((callee) => reaches.has(callee))) { reaches.add(fn); grew = true; }
          }
        }

        memo.set(modulePath, reaches);
        return reaches;
      };
    })();

    const METHODS = new Set(['get', 'post', 'put', 'delete', 'ws', 'use']);
    let registrations;

    before(() => {
      const ast = parse(fs.readFileSync(path.join(SRC_DIR, 'routes.js'), 'utf8'));
      const modules = requiredModules(ast);
      registrations = [];

      walk(ast, (node) => {
        if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return null;
        if (node.callee.object.name !== 'app' || !METHODS.has(node.callee.property.name)) return null;
        if (typeof node.arguments[0]?.value !== 'string' || node.arguments.length < 2) return null;

        const chain = node.arguments.slice(1);
        const handlers = [];
        chain.forEach((arg) => walk(arg, (inner) => {
          if (inner.type === 'MemberExpression' && inner.object.type === 'Identifier'
              && modules.has(inner.object.name) && inner.property.type === 'Identifier') {
            handlers.push({ module: modules.get(inner.object.name), fn: inner.property.name });
          }
          return null;
        }));

        registrations.push({
          method: node.callee.property.name,
          path: node.arguments[0].value,
          cached: chain.some((arg) => arg.type === 'CallExpression' && arg.callee.name === 'cache'),
          handlers,
        });
        return null;
      });
    });

    // Everything below reads a handler out of a registration, so a registration
    // whose handler cannot be read is not a route this covers - and would be
    // silently exempt from the assertion that matters.
    it('resolves every route to exactly one handler', () => {
      const unresolved = registrations
        .filter((route) => route.handlers.length !== 1)
        .map((route) => `${route.method} ${route.path} (${route.handlers.length} handlers)`);

      expect(unresolved, 'these routes could not be read').to.deep.equal([]);
    });

    it('reads every module a route hands off to', () => {
      const unreadable = [...new Set(registrations
        .filter((route) => route.handlers.length === 1)
        .map((route) => route.handlers[0].module)
        .filter((modulePath) => checkersIn(modulePath) === null))];

      expect(unreadable, 'these modules could not be parsed').to.deep.equal([]);
    });

    // Without this the assertion below passes on an analysis that resolved
    // nothing at all.
    it('finds the privilege checks it is looking for', () => {
      const checked = registrations.filter((route) => route.handlers.length === 1
        && (checkersIn(route.handlers[0].module) || new Set()).has(route.handlers[0].fn));

      expect(checked.length).to.be.greaterThan(200);
    });

    it('are answered by their handler, never from a cache', () => {
      const cached = registrations
        .filter((route) => route.cached && route.handlers.length === 1)
        .filter((route) => (checkersIn(route.handlers[0].module) || new Set()).has(route.handlers[0].fn))
        .map((route) => `${route.method} ${route.path} -> ${route.handlers[0].fn}`);

      expect(cached, 'these check a privilege behind a cache that answers first').to.deep.equal([]);
    });
  });
});
