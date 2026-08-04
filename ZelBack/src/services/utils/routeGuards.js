// Guards that run before a route's response cache.
//
// The cache keys on the full request URL, so anything a caller puts in the query
// string becomes part of the key whether or not the handler reads it. On an
// endpoint that reads none, that turns the cache from a bound on the work into a
// way of multiplying it: every novel parameter is a guaranteed miss that
// recomputes the answer and retains another copy of it for the cache window.
//
// These run BEFORE the cache middleware, so a refused request never reaches the
// store.

const messageHelper = require('../messageHelper');

/**
 * Refuse a query string on an endpoint that reads none.
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

module.exports = { rejectQueryParameters };
