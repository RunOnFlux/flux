const {
  asyncRoute,
  cache,
  limitConcurrent,
  rejectQueryParameters,
  requireAppStateReady,
  requireBootSettled,
  requireDatabase,
  requirePolicyReady,
  requireRegistryReady,
} = require('./services/utils/routeGuards');
const { alwaysRespond, isLocal } = require('./middlewares');
const { refuseBannedCaller } = require('./services/appSecurity/clientBans');

/**
 * Registers a route table on an express app or router.
 *
 * A route is data: its method and path, its guards by name, its cache, its
 * limit by name, and its handler as a service module and the name of the
 * function in it. Each route is registered as its guards in order, then the
 * cache, then the limit, then the handler, so a cached answer is served without
 * taking a place under the limit.
 *
 * The handler is read from its module on every request, so what the module
 * exports at that moment answers. Registration refuses a route whose guard or
 * limit is unknown or whose module has no such function.
 */

const GUARDS = Object.freeze({
  alwaysRespond,
  isLocal,
  refuseBannedCaller,
  rejectQueryParameters,
  requireAppStateReady,
  requireBootSettled,
  requireDatabase,
  requirePolicyReady,
  requireRegistryReady,
});

/**
 * Whether a permanent message lookup names no message hash. One that does reads a single message;
 * one that does not reads the whole log, or every message of an owner or an app name.
 * @param {object} req Request
 * @returns {boolean}
 */
function withoutMessageHash(req) {
  return !(req.params.hash || req.query.hash);
}

const LIMITS = Object.freeze({
  // A permanent message lookup without a hash builds its whole answer in memory, so a node builds
  // one at a time.
  permanentMessageQuery: limitConcurrent(1, 'This node is already answering a permanent message query', { limited: withoutMessageHash }),
  // Each message log being served keeps a processor core compressing it for its whole transfer. One
  // caller is served one log at a time, so one caller cannot hold every place.
  permanentMessageLog: limitConcurrent(4, 'This node is already serving as many message logs as it allows', { perCaller: 1 }),
});

/**
 * The name a route is reported by.
 * @param {object} route a route table entry
 * @returns {string}
 */
function routeName(route) {
  return `${String(route.method).toUpperCase()} ${route.path}`;
}

/**
 * The handler a route names, read from its module on each request.
 * @param {object} route a route table entry
 * @returns {function(import('express').Request, import('express').Response): *}
 */
function handlerFor(route) {
  if (!route.module || typeof route.module[route.fn] !== 'function') {
    throw new Error(`route ${routeName(route)} names ${route.fn}, which its module does not export as a function`);
  }
  return function routeHandler(req, res) {
    return route.module[route.fn](req, res);
  };
}

/**
 * The middleware chain a route registers, in order.
 * @param {object} route a route table entry
 * @returns {Function[]}
 */
function chainFor(route) {
  const chain = (route.guards || []).map((name) => {
    const guard = GUARDS[name];
    if (!guard) throw new Error(`route ${routeName(route)} names unknown guard ${name}`);
    return guard;
  });
  if (route.cache) chain.push(cache(route.cache));
  if (route.limit) {
    const limit = LIMITS[route.limit];
    if (!limit) throw new Error(`route ${routeName(route)} names unknown limit ${route.limit}`);
    chain.push(limit);
  }
  chain.push(asyncRoute(handlerFor(route)));
  return chain;
}

/**
 * Registers every route of a table.
 * @param {object} app express app or router
 * @param {object[]} table
 */
function registerRoutes(app, table) {
  table.forEach((route) => {
    app[route.method](route.path, ...chainFor(route));
  });
}

module.exports = {
  GUARDS,
  LIMITS,
  chainFor,
  handlerFor,
  registerRoutes,
};
