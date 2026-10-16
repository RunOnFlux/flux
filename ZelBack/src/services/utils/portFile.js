/**
 * The port file: where FluxOS publishes the ports it is serving on.
 *
 * Once its listeners are bound FluxOS writes /run/fluxos/fluxos.json,
 *
 *   {"apiPort": 16127, "apiPortHttps": 16128, "uiPort": 16126, "pid": 12345}
 *
 * holding the ports the servers report after listening and FluxOS's process
 * id, and removes it on a clean stop, so the file means "FluxOS is serving
 * here". A crash leaves the file until the next start rewrites it; a reader
 * that needs to know the file is current checks that the process exists. fluxd and fluxbench
 * read it, as other users, so it is world-readable. It is written to a
 * temporary file in the same directory and renamed over the final name, so a
 * reader sees the old file or the new one, never a partial one.
 *
 * On ArcaneOS the unit's RuntimeDirectory makes /run/fluxos. A legacy node runs
 * FluxOS unprivileged with passwordless sudo, and /run is root's: there FluxOS
 * makes the directory, owned by its own account, through sudo when it cannot
 * write it.
 *
 * Neither writing nor removing ever throws: FluxOS serves without the file.
 */

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

const isArcane = Boolean(process.env.FLUXOS_PATH);

const PORT_FILE_DIR = '/run/fluxos';
const PORT_FILE_NAME = 'fluxos.json';
const DIR_MODE = 0o755;
const FILE_MODE = 0o644;

/**
 * Make dir, mode DIR_MODE. On a legacy node a directory this process may not
 * make, or may not set the mode of because another account owns it, is made
 * through sudo, owned by this process's account.
 * @param {string} dir - the directory
 * @returns {Promise<void>} Rejects when the directory cannot be made.
 */
async function makeDirectory(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.chmod(dir, DIR_MODE);
  } catch (error) {
    if (isArcane || (error.code !== 'EACCES' && error.code !== 'EPERM')) throw error;
    const { uid, gid } = os.userInfo();
    const { error: sudoError } = await serviceHelper.runCommand('install', {
      runAsRoot: true,
      params: ['-d', '-m', DIR_MODE.toString(8), '-o', String(uid), '-g', String(gid), dir],
    });
    if (sudoError) throw new Error(`${error.message}; sudo install -d failed: ${sudoError.message || sudoError}`);
  }
}

/**
 * Write the port file, with this process's id. Never rejects.
 * @param {{apiPort: number, apiPortHttps: number, uiPort?: number}} ports - the bound ports
 * @param {{dir?: string}} [options] - the directory the file is written in
 * @returns {Promise<boolean>} True when the file was written.
 */
async function writePortFile(ports, { dir = PORT_FILE_DIR } = {}) {
  const file = path.join(dir, PORT_FILE_NAME);
  const tmp = path.join(dir, `.${PORT_FILE_NAME}.${process.pid}.tmp`);
  const content = JSON.stringify({
    apiPort: ports.apiPort,
    apiPortHttps: ports.apiPortHttps,
    uiPort: ports.uiPort,
    pid: process.pid,
  });
  try {
    // Explicit modes: the process umask applies to mkdir and to a file's creation.
    await makeDirectory(dir);
    await fs.writeFile(tmp, `${content}\n`, { mode: FILE_MODE });
    await fs.chmod(tmp, FILE_MODE);
    await fs.rename(tmp, file);
  } catch (error) {
    log.error(`Port file ${file} could not be written: ${error.message}`);
    await fs.rm(tmp, { force: true }).catch(() => {});
    return false;
  }
  log.info(`Port file ${file} written: ${content}`);
  return true;
}

/**
 * Remove the port file. Synchronous, so it completes before a process.exit
 * that follows it; an unlink is a single system call and does not hold the
 * stop. Never throws.
 * @param {{dir?: string}} [options] - the directory the file is in
 * @returns {boolean} True when a file was removed.
 */
function removePortFile({ dir = PORT_FILE_DIR } = {}) {
  const file = path.join(dir, PORT_FILE_NAME);
  try {
    fsSync.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') log.warn(`Port file ${file} could not be removed: ${error.message}`);
    return false;
  }
  log.info(`Port file ${file} removed`);
  return true;
}

module.exports = {
  PORT_FILE_DIR,
  PORT_FILE_NAME,
  removePortFile,
  writePortFile,
};
