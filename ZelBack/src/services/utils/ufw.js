const fs = require('node:fs/promises');
const path = require('node:path');
const serviceHelper = require('../serviceHelper');

// How long FluxOS waits on ufw's lock. ufw's slowest ordinary hold, a reload
// of ~100 rules, is under 2 s, so a lock held this long is held by a command
// that is not ending.
const UFW_LOCK_WAIT_MS = 30000;
// The exit code of a ufw helper that found the lock held past its wait.
const UFW_LOCK_UNAVAILABLE = 75;
// The helper's exit code when ufw's library cannot be used.
const UFW_LIBRARY_UNUSABLE = 69;

// Changes ufw's rules with ufw's lock taken before the rules are read.
const UFW_HELPER = path.join(__dirname, '../../../../helpers/ufw/apply-node-firewall.py');

let previous = Promise.resolve();

/**
 * Runs a task once every ufw task FluxOS started before it has ended, so no two
 * of FluxOS's ufw commands run at once.
 * @template T
 * @param {function(): Promise<T>} task
 * @returns {Promise<T>}
 */
function oneAtATime(task) {
  const run = previous.then(task);
  previous = run.catch(() => {});
  return run;
}

/**
 * Runs one ufw command as root, through helpers/ufw/apply-node-firewall.py: it takes
 * ufw's lock before reading the rules, which the ufw command does not, so a
 * command run while another changes the rules never writes back what it read
 * before that change. The lock is waited for at most UFW_LOCK_WAIT_MS; a command
 * that ran out of the wait changed nothing and is reported as locked. Where
 * ufw's library cannot be used, the ufw command runs it.
 * @param {string[]} params The ufw command's arguments.
 * @returns {Promise<{error: (Error|null), stdout: string, stderr: string, locked: boolean}>}
 */
async function runUfw(params) {
  const { error, stdout, stderr } = await oneAtATime(async () => {
    const ran = await serviceHelper.runCommand('python3', {
      runAsRoot: true,
      logError: false,
      params: [UFW_HELPER, '--wait', String(UFW_LOCK_WAIT_MS / 1000), '--command', JSON.stringify(params)],
      timeout: 2 * UFW_LOCK_WAIT_MS,
    });
    if (ran.error?.code !== UFW_LIBRARY_UNUSABLE) return ran;
    // runCommand puts the command in front of the params it is given
    return serviceHelper.runCommand('ufw', {
      runAsRoot: true, logError: false, params: [...params], timeout: UFW_LOCK_WAIT_MS,
    });
  });
  return {
    error,
    stdout: serviceHelper.ensureString(stdout),
    stderr: serviceHelper.ensureString(stderr),
    locked: error?.code === UFW_LOCK_UNAVAILABLE || Boolean(error?.killed),
  };
}

/**
 * Runs ufw commands as one batch, through the helper: one process, with ufw's
 * lock taken once, before the rules are read, and held for all of them. A
 * command ufw refuses is reported and the rest still run. Where ufw's library
 * cannot be used, each runs as a ufw command, stopping at one that ran out of
 * the lock wait.
 * @param {string[][]} commands Each the arguments of one ufw command.
 * @returns {Promise<{failed: Array<{rule: string, error: string}>, locked: boolean}>}
 *   locked: ufw's lock was held past the wait; a batch run under the lock then
 *   changed nothing.
 */
async function runUfwCommands(commands) {
  if (!commands.length) return { failed: [], locked: false };
  return oneAtATime(async () => {
    const ran = await serviceHelper.runCommand('python3', {
      runAsRoot: true,
      logError: false,
      params: [UFW_HELPER, '--wait', String(UFW_LOCK_WAIT_MS / 1000), '--keep-outbound', '--rules', JSON.stringify(commands)],
      timeout: 2 * UFW_LOCK_WAIT_MS,
    });
    if (ran.error?.code === UFW_LOCK_UNAVAILABLE || ran.error?.killed) return { failed: [], locked: true };
    let result = null;
    try {
      result = JSON.parse(serviceHelper.ensureString(ran.stdout));
    } catch {
      result = null;
    }
    if (!ran.error && result?.applied) return { failed: result.failed, locked: false };

    const failed = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const command of commands) {
      // runCommand puts the command in front of the params it is given
      // eslint-disable-next-line no-await-in-loop
      const one = await serviceHelper.runCommand('ufw', {
        runAsRoot: true, logError: false, params: [...command], timeout: UFW_LOCK_WAIT_MS,
      });
      if (one.error?.killed) return { failed, locked: true };
      if (one.error) failed.push({ rule: command.join(' '), error: serviceHelper.ensureString(one.stderr).trim() || one.error.message });
    }
    return { failed, locked: false };
  });
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
 * Whether ufw filters IPv6, read from ufw's defaults as ufw reads them. When it
 * does not, ufw leaves IPv6 traffic alone and refuses IPv6 rules. Reading the
 * file takes no lock.
 * @returns {Promise<boolean>}
 */
async function ipv6Filtered() {
  const defaults = await fs.readFile('/etc/default/ufw', 'utf8').catch(() => '');
  return /^IPV6="?yes"?\s*$/mi.test(defaults);
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
  UFW_HELPER,
  UFW_LOCK_UNAVAILABLE,
  UFW_LOCK_WAIT_MS,
  ipv6Filtered,
  isFirewallActive,
  oneAtATime,
  runUfw,
  runUfwCommands,
  ufwEnabled,
};
