/**
 * Where FluxOS keeps what is not its code. On ArcaneOS the code is a read-only image, so the unit
 * names a state directory, holding userconfig.js, and a log directory. Elsewhere both are in the
 * checkout. Required by the config, so it loads nothing that reads the config.
 */

const path = require('node:path');

const CHECKOUT = path.join(__dirname, '..');

/**
 * @returns {string} The directory holding userconfig.js.
 */
function userconfigDir() {
  return process.env.FLUXOS_STATE_PATH || path.join(CHECKOUT, 'config');
}

/**
 * @returns {string} The full path of userconfig.js.
 */
function userconfigPath() {
  return path.join(userconfigDir(), 'userconfig.js');
}

/**
 * @returns {string} The directory FluxOS logs in.
 */
function logDir() {
  return process.env.FLUXOS_LOG_PATH || CHECKOUT;
}

module.exports = { logDir, userconfigDir, userconfigPath };
