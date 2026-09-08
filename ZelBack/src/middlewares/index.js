/**
 * FluxOS Express middlewares
 *
 * Entry point for the middlewares mounted on individual routes. Middlewares applied
 * to every request are registered on the server itself, in lib/fluxServer.js.
 */

const alwaysRespond = require('./alwaysRespond');
const isLocal = require('./isLocal');
const requireHttps = require('./requireHttps');

module.exports = {
  alwaysRespond,
  isLocal,
  requireHttps,
};
