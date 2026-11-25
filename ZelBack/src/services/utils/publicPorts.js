/**
 * The node's public ports behind the front proxy.
 *
 * The proxy owns them and writes /run/flux-config/fluxos-proxy-ports.json, by rename, once nginx
 * holds them:
 *
 *   {"uiPort": 16126, "apiPort": 16127, "apiPortHttps": 16128}
 *
 * FluxOS follows that file while running and is never restarted for a change, and republishes
 * it in its own port file. Off the socket FluxOS's ports are its configured ones.
 */

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const config = require('config');

const log = require('../../lib/log');
const portFile = require('./portFile');

const PORTS_FILE = '/run/flux-config/fluxos-proxy-ports.json';

const events = new EventEmitter();

let published = null;
let watcher = null;
let firstRead = null;

function configuredApiPort() {
  return globalThis.userconfig?.initial?.apiport || config.server?.apiport;
}

/**
 * @returns {number|string} The API port the node is reached on.
 */
function getApiPort() {
  return published?.apiPort ?? configuredApiPort();
}

function publish() {
  if (!published) return Promise.resolve(false);
  return portFile.writePortFile(published);
}

function readPorts(file) {
  try {
    const { apiPort, apiPortHttps, uiPort } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if ([apiPort, apiPortHttps, uiPort].every(Number.isInteger)) return { apiPort, apiPortHttps, uiPort };
    log.error(`${file} does not hold three ports`);
  } catch (error) {
    if (error.code !== 'ENOENT') log.error(`${file} could not be read: ${error.message}`);
  }
  return null;
}

async function refresh(file) {
  const ports = readPorts(file);
  if (!ports) return;
  const previous = published;
  if (JSON.stringify(previous) !== JSON.stringify(ports)) {
    published = ports;
    await publish();
    events.emit('change', ports, previous);
  }
  firstRead?.();
}

/**
 * Follows the proxy's ports from here on, and resolves once it holds them: a node that has moved
 * has an out-of-date userconfig.js, so nothing reads the node's ports before this. A file that
 * cannot be read leaves the ports already held. Its directory comes from the image's tmpfiles.
 * It waits as long as the file takes to appear: FluxOS is not ready until it holds its ports, and
 * its unit's start timeout bounds the wait.
 * @param {{file?: string}} [options]
 * @returns {Promise<void>}
 */
async function start({ file = PORTS_FILE } = {}) {
  if (watcher) return;
  const held = new Promise((resolve) => { firstRead = resolve; });
  watcher = fs.watch(path.dirname(file), (eventType, name) => {
    if (name === path.basename(file)) refresh(file);
  });
  watcher.on('error', (error) => log.error(`${file} watch failed: ${error.message}`));
  await refresh(file);
  await held;
}

function stop() {
  watcher?.close();
  watcher = null;
  firstRead = null;
  published = null;
}

module.exports = {
  getApiPort,
  onChange: (listener) => events.on('change', listener),
  offChange: (listener) => events.off('change', listener),
  start,
  stop,
};
