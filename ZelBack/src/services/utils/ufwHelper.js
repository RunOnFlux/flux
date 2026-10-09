const fs = require('node:fs/promises');
const path = require('node:path');
const serviceHelper = require('../serviceHelper');
const log = require('../../lib/log');

// The helper that changes ufw's rules with ufw's lock taken before the rules
// are read, as FluxOS ships it, and the root-owned copy root runs.
const UFW_HELPER_SOURCE = path.join(__dirname, '../../../../helpers/ufw/apply-node-firewall.py');
const UFW_HELPER_DIR = '/usr/local/lib/fluxos';
const UFW_HELPER = path.join(UFW_HELPER_DIR, 'apply-node-firewall.py');

/**
 * The helper root runs: a root-owned copy of the one FluxOS ships, outside the
 * FluxOS tree, so root never runs a file the node's FluxOS user owns, and ufw,
 * which checks the owner of the program it runs under, prints no warning. The
 * copy is installed, with its directory, whenever it is missing or differs from
 * the shipped helper, so it is the shipped helper every time it runs. When it
 * cannot be installed, the shipped helper is run.
 * Call inside ufw.oneAtATime, so no helper is running while the copy is replaced.
 * @returns {Promise<string>} The path to run.
 */
async function helperPath() {
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
    log.error(`ufw helper not installed at ${UFW_HELPER}, running ${UFW_HELPER_SOURCE}: ${error.message}`);
    return UFW_HELPER_SOURCE;
  }
  return UFW_HELPER;
}

module.exports = {
  UFW_HELPER,
  UFW_HELPER_DIR,
  UFW_HELPER_SOURCE,
  path: helperPath,
};
