const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * How FluxOS reaches fluxd, and where the node key comes from.
 *
 * On an ArcaneOS image whose fluxos.service passes the node key as the systemd
 * credential `node-key`, FluxOS never opens flux.conf: it logs in to fluxd with
 * the cookie fluxd writes at each start, takes the node key from the credential,
 * and asks fluxd for its indexes and ZMQ notifications. Everywhere else -
 * legacy nodes and earlier ArcaneOS images - flux.conf holds all of it.
 */

const NODE_KEY_CREDENTIAL = 'node-key';
const RPC_COOKIE_FILE = '/run/fluxd/rpc.cookie';

/**
 * The node key systemd passes as a credential.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string|null>} The key, or null when the unit passes none.
 */
async function readNodeKeyCredential(env = process.env) {
  const dir = env.CREDENTIALS_DIRECTORY;
  if (!dir) return null;
  try {
    const key = (await fs.readFile(path.join(dir, NODE_KEY_CREDENTIAL), 'utf8')).trim();
    if (!key) throw new Error(`the ${NODE_KEY_CREDENTIAL} credential is empty`);
    return key;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Splits a cookie, `user:password`, at its first colon.
 * @param {string} text
 * @returns {{username: string, password: string}|null}
 */
function parseCookie(text) {
  const line = text.split('\n', 1)[0].trim();
  const colon = line.indexOf(':');
  if (colon <= 0 || colon === line.length - 1) return null;
  return { username: line.slice(0, colon), password: line.slice(colon + 1) };
}

/**
 * The RPC login fluxd wrote at its last start.
 * @param {string} file
 * @returns {Promise<{username: string, password: string}|null>} Null while fluxd
 *   has written none, which is while it is not running.
 */
async function readRpcCookie(file = RPC_COOKIE_FILE) {
  const text = await fs.readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return text === null ? null : parseCookie(text);
}

module.exports = {
  NODE_KEY_CREDENTIAL,
  RPC_COOKIE_FILE,
  parseCookie,
  readNodeKeyCredential,
  readRpcCookie,
};
