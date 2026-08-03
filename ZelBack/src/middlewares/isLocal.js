/**
 * Express middleware restricting a route to callers on the node itself.
 *
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {Function} next - Next middleware
 * @returns {void}
 */
function isLocal(req, res, next) {
  const remote = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.headers['x-forwarded-for'];
  if (remote === 'localhost' || remote === '127.0.0.1' || remote === '::ffff:127.0.0.1' || remote === '::1') return next();
  return res.status(401).send('Access denied');
}

module.exports = isLocal;
