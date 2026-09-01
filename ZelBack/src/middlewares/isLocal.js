/**
 * Express middleware restricting a route to callers on the node itself.
 *
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {Function} next - Next middleware
 * @returns {void}
 */
function isLocal(req, res, next) {
  // Only addresses the socket vouches for. X-Forwarded-For is the caller's own
  // claim, and a localhost check that ever believes it is deciding "local" on
  // an attacker-controlled header.
  const remote = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  if (remote === 'localhost' || remote === '127.0.0.1' || remote === '::ffff:127.0.0.1' || remote === '::1') return next();
  return res.status(401).send('Access denied');
}

module.exports = isLocal;
