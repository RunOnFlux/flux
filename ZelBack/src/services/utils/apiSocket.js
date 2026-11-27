/**
 * FluxOS behind the front proxy.
 *
 * With FLUXOS_API_SOCKET set, FluxOS serves plain HTTP on that Unix socket only. nginx owns the
 * public ports and is the socket's one client, so it is the one hop to trust: it sets
 * X-Forwarded-For to the connection it accepted, overwriting whatever the caller sent, and passes
 * what the caller sent as X-Upstream-Forwarded-For. A socket peer has no address, so a caller's
 * address is read through these functions and never from the connection.
 */

const proxyAddr = require('proxy-addr');

const SOCKET_BACKLOG = 4096;
const SOCKET_MODE = 0o660;
const TRUSTED_HOPS = 1;

/**
 * @returns {string|undefined} The Unix socket FluxOS serves on, when it serves behind the proxy.
 */
function socketPath() {
  return process.env.FLUXOS_API_SOCKET || undefined;
}

/**
 * @returns {string|undefined} The group allowed to connect to the socket.
 */
function socketGroup() {
  return process.env.FLUXOS_API_SOCKET_GROUP || undefined;
}

/**
 * The address of the caller of a request or an upgrade. Upgrade requests do not pass through
 * Express, so behind the proxy this reads them as Express reads a request.
 * @param {object} req - an Express request, or the http.IncomingMessage of an upgrade
 * @returns {string|undefined} The address, undefined when there is none.
 */
function callerAddress(req) {
  if (socketPath()) return proxyAddr(req, (address, hop) => hop < TRUSTED_HOPS);
  return req.ip || req.socket?.remoteAddress;
}

/**
 * The chain a balancer reported, for the one reader that may believe it.
 * @param {object} headers - the request headers
 * @returns {string|string[]|undefined} The chain as the header carries it.
 */
function forwardedChain(headers) {
  return headers?.[socketPath() ? 'x-upstream-forwarded-for' : 'x-forwarded-for'];
}

module.exports = {
  SOCKET_BACKLOG,
  SOCKET_MODE,
  TRUSTED_HOPS,
  callerAddress,
  forwardedChain,
  socketGroup,
  socketPath,
};
