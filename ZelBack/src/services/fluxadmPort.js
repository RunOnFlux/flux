const config = require('config');
const fs = require('node:fs');

const isArcane = Boolean(process.env.FLUXOS_PATH);

// The maintenance sshd's systemd unit. The reconcile enables it once it has
// installed access and disables and deletes it when it removes access, so its
// enabled state is the reconcile's standing decision.
const sshdUnit = 'fluxadm-sshd.service';

// present only when systemd booted the machine as PID 1 (see sd_booted(3))
const systemdRuntimeDir = '/run/systemd/system';

/**
 * The ed25519 public keys granted maintenance access. An empty list disables
 * the feature entirely and revokes any previously installed access.
 * @returns {string[]}
 */
function getConfiguredKeys() {
  const keys = config.fluxadm.sshAuthorizedKeys;
  if (!Array.isArray(keys)) return [];
  return keys.filter((key) => typeof key === 'string' && key.trim()).map((key) => key.trim());
}

/**
 * Whether systemd is this machine's init. The maintenance sshd runs as a
 * systemd unit, so without it the feature cannot work and must not start.
 * @returns {boolean}
 */
function bootedWithSystemd() {
  return fs.existsSync(systemdRuntimeDir);
}

/**
 * The maintenance sshd's port for an api port. Same convention as ArcaneOS:
 * apiport - 5 (16122 on a default node).
 * @param {number|string} apiPort
 * @returns {number}
 */
function sshPortFor(apiPort) {
  return +apiPort - 5;
}

/**
 * Whether this node runs maintenance access at all: not ArcaneOS (which
 * provisions its own), systemd as init, and at least one key configured.
 * Says nothing about the benchmark's legacy confirmation, which only the
 * reconcile can ask.
 * @returns {boolean}
 */
function accessConfigured() {
  if (isArcane) return false;
  if (!bootedWithSystemd()) return false;
  return getConfiguredKeys().length > 0;
}

/**
 * The maintenance sshd's port for this node's current api port.
 * @returns {number}
 */
function currentSshPort() {
  const { userconfig } = globalThis;
  const apiPort = userconfig.initial.apiport || config.server.apiport;

  return sshPortFor(apiPort);
}

/**
 * The port the maintenance sshd listens on, or null when access is not
 * configured on this node.
 * @returns {number | null}
 */
function getFluxadmSshPort() {
  if (!accessConfigured()) return null;
  return currentSshPort();
}

module.exports = {
  accessConfigured,
  bootedWithSystemd,
  currentSshPort,
  getConfiguredKeys,
  getFluxadmSshPort,
  isArcane,
  sshPortFor,
  sshdUnit,
};
