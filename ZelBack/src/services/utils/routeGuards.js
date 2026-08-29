// Guards that answer a request before it reaches a handler.

const messageHelper = require('../messageHelper');
const globalState = require('./globalState');

// What a caller turned away during boot is told to wait. The boot chain is
// bounded by its own daemon and sync timeouts rather than by this number, so it
// is a pacing hint and not a deadline: short enough that a dashboard retry feels
// responsive, long enough that a client polling through a slow boot is not
// making a request a second.
const BOOT_RETRY_AFTER_SECONDS = 15;

/**
 * Refuse a call that would create or destroy a container before boot
 * reconciliation has decided which applications this node is keeping.
 *
 * That decision runs behind daemon readiness, node confirmation and DB sync, so
 * it lands well after the API starts answering. Until it has, a container this
 * node did not know about when it booted is one reconciliation may still remove:
 * it keeps an app whose location record says this node is running it, and a
 * container created moments ago has no such record, because a record is written
 * from the running broadcast an app only makes once it has run.
 *
 * The internal actors already wait for the same gate - the reconciler queues
 * into bootPending rather than actuating, and crash recovery holds off. This is
 * the same rule at the front door.
 *
 * A refusal rather than a wait: the boot chain can run to its daemon timeout, and
 * holding a request open that long serves the caller worse than telling them when
 * to come back.
 * @param {object} req Request
 * @param {object} res Response
 * @param {Function} next Next handler
 * @returns {*} next(), or a 503 carrying a Retry-After
 */
function requireBootSettled(req, res, next) {
  if (globalState.bootContainerStateSettled) return next();
  res.setHeader('Retry-After', String(BOOT_RETRY_AFTER_SECONDS));
  const errMessage = messageHelper.createErrorMessage(
    'Node is still reconciling its applications after boot',
    'ServiceUnavailable',
    503,
  );
  return res.status(503).json(errMessage);
}

/**
 * Refuse a query string on an endpoint that reads none.
 *
 * The cache keys on the full request URL, so anything a caller puts in the query
 * string becomes part of the key whether or not the handler reads it. On an
 * endpoint that reads none, that turns the cache from a bound on the work into a
 * way of multiplying it: every novel parameter is a guaranteed miss that
 * recomputes the answer and retains another copy of it for the cache window.
 *
 * This runs BEFORE the cache middleware, so a refused request never reaches the
 * store.
 *
 * Decided on the RAW url, not on req.query, because the raw url is what the
 * cache keys on and parsing does not preserve it: express resolves '?=1' to an
 * empty query object, so a guard reading req.query waves it through while the
 * cache still files it under a key of its own. Anything that can vary the key
 * has to be answered here, whether or not it survives parsing.
 *
 * A trailing '?' with nothing after it carries no parameter and is allowed.
 *
 * Rejecting rather than ignoring is the point. A caller sending parameters an
 * endpoint does not accept has made a mistake, and quietly serving them an
 * answer hides it - while still costing a cache entry apiece.
 * @param {object} req Request
 * @param {object} res Response
 * @param {Function} next Next handler
 * @returns {*} next(), or a 400
 */
function rejectQueryParameters(req, res, next) {
  const url = req.originalUrl ?? req.url ?? '';
  const queryStart = url.indexOf('?');
  if (queryStart === -1 || queryStart === url.length - 1) return next();
  const errMessage = messageHelper.createErrorMessage(
    'This endpoint takes no query parameters',
    'BadRequest',
    400,
  );
  return res.status(400).json(errMessage);
}

/**
 * Hand a route handler's promise to express.
 *
 * Registering `(req, res) => handler(req, res)` drops it, so a rejection is
 * unhandled: node raises it to the uncaughtException handler in apiServer,
 * which exits the process. The caller gets no response at all, and the node
 * restarts - once per request. Routed through here a rejection reaches
 * express's error handler and answers 500, which is what a caller can act on
 * and what leaves the node serving everyone else.
 * @param {Function} handler Route handler taking (req, res)
 * @returns {Function} express handler
 */
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

module.exports = { asyncRoute, rejectQueryParameters, requireBootSettled };
