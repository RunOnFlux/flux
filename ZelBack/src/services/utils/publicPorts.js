/**
 * The node's public ports behind the front proxy.
 *
 * The proxy owns them and writes /run/fluxos-proxy/ports.json, by rename, once nginx holds them:
 *
 *   {"uiPort": 16126, "apiPort": 16127, "apiPortHttps": 16128, "alsoServing": []}
 *
 * alsoServing holds the API ports kept through a move, until the chain lists the new one. FluxOS
 * follows that file while running and is never restarted for a change, and republishes it
 * in its own port file with confirmedApiPort, the API port the chain lists for this node, which
 * tells configd when a port kept through a move can go. Off the socket FluxOS's ports are its
 * configured ones.
 */

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const config = require('config');

const log = require('../../lib/log');
const portFile = require('./portFile');
const { socketPath } = require('./apiSocket');

const PORTS_FILE = '/run/fluxos-proxy/ports.json';
const WATCH_RETRY_MS = 5000;

const events = new EventEmitter();

let published = null;
let confirmedApiPort;
let watcher = null;
let retry = null;

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
  return portFile.writePortFile({ ...published, confirmedApiPort });
}

/**
 * @returns {number[]} The API ports kept through a move.
 */
function getAlsoServing() {
  return published?.alsoServing ?? [];
}

/**
 * Records the API port the chain lists for this node.
 * @param {number} port
 * @returns {Promise<void>}
 */
async function setConfirmedApiPort(port) {
  if (!socketPath() || Number(port) === confirmedApiPort) return;
  confirmedApiPort = Number(port);
  await publish();
}

function readPorts(file) {
  try {
    const {
      apiPort, apiPortHttps, uiPort, alsoServing = [],
    } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if ([apiPort, apiPortHttps, uiPort, ...alsoServing].every(Number.isInteger)) {
      return {
        apiPort, apiPortHttps, uiPort, alsoServing,
      };
    }
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
  if (JSON.stringify(previous) === JSON.stringify(ports)) return;
  published = ports;
  await publish();
  events.emit('change', ports, previous);
}

/**
 * Follows the proxy's ports from here on. The proxy may not have started yet, and its directory
 * appears with it, so the watch is retried until that directory exists.
 * @param {{file?: string}} [options]
 * @returns {Promise<void>}
 */
async function start({ file = PORTS_FILE } = {}) {
  if (watcher) return;
  try {
    watcher = fs.watch(path.dirname(file), (eventType, name) => {
      if (name === path.basename(file)) refresh(file);
    });
    watcher.on('error', (error) => log.error(`${file} watch failed: ${error.message}`));
    await refresh(file);
  } catch (error) {
    if (error.code !== 'ENOENT') log.error(`${file} could not be watched: ${error.message}`);
    retry = setTimeout(() => start({ file }), WATCH_RETRY_MS);
    retry.unref();
  }
}

function stop() {
  watcher?.close();
  watcher = null;
  clearTimeout(retry);
  published = null;
  confirmedApiPort = undefined;
}

module.exports = {
  getAlsoServing,
  getApiPort,
  onChange: (listener) => events.on('change', listener),
  offChange: (listener) => events.off('change', listener),
  setConfirmedApiPort,
  start,
  stop,
};
