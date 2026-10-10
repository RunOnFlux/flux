const fs = require('node:fs/promises');
const path = require('node:path');
const serviceHelper = require('../serviceHelper');
const log = require('../../lib/log');

// The helper that changes ufw's rules with ufw's lock taken before the rules
// are read, as FluxOS ships it, and the root-owned copy root runs.
const UFW_HELPER_SOURCE = path.join(__dirname, '../../../../helpers/ufw/apply-node-firewall.py');
const UFW_HELPER_DIR = '/usr/local/lib/fluxos';
const UFW_HELPER = path.join(UFW_HELPER_DIR, 'apply-node-firewall.py');

let installing = null;

/**
 * Installs the copy, with its directory, when it is missing or differs from the
 * shipped helper, and answers which helper to run: the copy, or the shipped
 * helper when the copy cannot be installed.
 * @returns {Promise<string>}
 */
async function installCopy() {
  const [shipped, installed] = await Promise.all([
    fs.readFile(UFW_HELPER_SOURCE),
    fs.readFile(UFW_HELPER).catch(() => null),
  ]);
  if (installed && installed.equals(shipped)) return UFW_HELPER;
  const { error: dirError } = await serviceHelper.runCommand('install', {
    runAsRoot: true, logError: false, params: ['-d', '-o', 'root', '-g', 'root', '-m', '0755', UFW_HELPER_DIR],
  });
  const { error } = dirError ? { error: dirError } : await serviceHelper.runCommand('install', {
    runAsRoot: true, logError: false, params: ['-o', 'root', '-g', 'root', '-m', '0755', UFW_HELPER_SOURCE, UFW_HELPER],
  });
  if (error) {
    log.error(`ufw helper not installed at ${UFW_HELPER}, running ${UFW_HELPER_SOURCE} until FluxOS restarts: ${error.message}`);
    return UFW_HELPER_SOURCE;
  }
  log.info(`ufw helper installed at ${UFW_HELPER}`);
  return UFW_HELPER;
}

/**
 * The helper root runs: a root-owned copy of the one FluxOS ships, outside the
 * FluxOS tree, so root never runs a file the node's FluxOS user owns, and ufw,
 * which checks the owner of the program it runs under, prints no warning.
 *
 * The copy is installed once per FluxOS start, the first time this is called;
 * startup calls it before anything changes the firewall. The shipped helper
 * changes only when FluxOS is updated, which restarts FluxOS. When the copy
 * cannot be installed, the shipped helper is run until the next start.
 * @returns {Promise<string>} The path to run.
 */
function helperPath() {
  installing ??= installCopy();
  return installing;
}

module.exports = {
  UFW_HELPER,
  UFW_HELPER_DIR,
  UFW_HELPER_SOURCE,
  install: installCopy,
  path: helperPath,
};
