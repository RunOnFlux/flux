const fs = require('node:fs/promises');
const serviceHelper = require('../serviceHelper');

// How long FluxOS waits on ufw's lock, which every ufw command holds for its
// whole run. ufw's slowest ordinary hold, a reload of ~100 rules, is under 2 s,
// so a lock held this long is held by a command that is not ending.
const UFW_LOCK_WAIT_MS = 30000;

/**
 * Runs one ufw command as root. ufw waits on its lock for as long as another
 * ufw command holds it; this waits at most UFW_LOCK_WAIT_MS, and a command that
 * ran out of the wait is reported as locked. A ufw command killed while waiting
 * on the lock has changed nothing.
 * @param {string[]} params The ufw command's arguments.
 * @returns {Promise<{error: (Error|null), stdout: string, stderr: string, locked: boolean}>}
 */
async function runUfw(params) {
  // runCommand puts the command in front of the params it is given
  const { error, stdout, stderr } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true, logError: false, params: [...params], timeout: UFW_LOCK_WAIT_MS,
  });
  return {
    error,
    stdout: serviceHelper.ensureString(stdout),
    stderr: serviceHelper.ensureString(stderr),
    locked: Boolean(error?.killed),
  };
}

/**
 * Whether ufw is enabled, read from ufw.conf as ufw's own boot script reads it.
 * Reading the file takes no lock.
 * @returns {Promise<boolean>}
 */
async function ufwEnabled() {
  const ufwConf = await fs.readFile('/etc/ufw/ufw.conf', 'utf8').catch(() => '');
  return /^ENABLED=yes$/m.test(ufwConf);
}

/**
 * Whether the firewall is active, as `ufw status` reports it. While another ufw
 * command holds ufw's lock past the wait, the answer is whether ufw is enabled.
 * @returns {Promise<boolean>}
 */
async function isFirewallActive() {
  const { error, stdout, locked } = await runUfw(['status']);
  if (locked) return ufwEnabled();
  if (error) return false;
  return /^Status: active$/m.test(stdout);
}

module.exports = {
  UFW_LOCK_WAIT_MS,
  isFirewallActive,
  runUfw,
  ufwEnabled,
};
