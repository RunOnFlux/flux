/**
 * Express middleware for endpoints that act on every call.
 *
 * Express fingerprints each response with an ETag. App control endpoints answer with the
 * same body every time, so a client replaying its stored ETag receives a bodiless 304 and
 * cannot tell whether the action ran — even though the handler executed in full. Removing
 * the request validator opts these routes out of conditional-GET handling, and no-store
 * keeps the client from caching the answer for next time.
 *
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {Function} next - Next middleware
 * @returns {void}
 */
function alwaysRespond(req, res, next) {
  delete req.headers['if-none-match'];
  res.set('Cache-Control', 'no-store');
  return next();
}

module.exports = alwaysRespond;
