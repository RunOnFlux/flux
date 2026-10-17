/**
 * Every app's containers live in their own systemd slice, under flux.slice, so
 * the app's processes are found and killed from its name alone, without docker
 * or the database. Under contention the apps together share the machine
 * against the system services as one group, so they cannot starve FluxOS's own
 * dependencies.
 *
 * A slice outlives its last container until it is stopped. Removing an app
 * stops its slice, and boot stops every slice left empty.
 */

const fs = require('fs').promises;
const path = require('path');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

const PARENT = 'flux.slice';
const APP_NAME = /^[A-Za-z0-9-]+$/;

let cgroupRoot = '/sys/fs/cgroup';

/**
 * @param {string} root Where the cgroup filesystem is mounted.
 */
function useCgroupRoot(root) {
  cgroupRoot = root;
}

/**
 * The app's slice unit. systemd reads each '-' in a slice name as one level of
 * nesting, so the name escapes it the way systemd-escape does: unescaped,
 * `my-app` would land inside `my`'s slice.
 * @param {string} appName
 * @returns {string|null} Null for a name no app can have.
 */
function sliceName(appName) {
  if (typeof appName !== 'string' || !APP_NAME.test(appName)) return null;
  return `flux-${appName.replace(/-/g, '\\x2d')}.slice`;
}

/**
 * @param {string} unit A slice under flux.slice.
 * @returns {string} Its cgroup directory.
 */
function cgroupOf(unit) {
  return path.join(cgroupRoot, PARENT, unit);
}

/**
 * @param {string} unit
 * @returns {Promise<boolean|null>} Whether any process lives in the slice, or
 *   null when the slice does not exist.
 */
async function isPopulated(unit) {
  const events = await fs.readFile(path.join(cgroupOf(unit), 'cgroup.events'), 'utf8').catch(() => null);
  if (events === null) return null;
  return /^populated 1$/m.test(events);
}

/**
 * Stop a slice that holds no process. A slice in use is left alone.
 * @param {string} unit
 * @returns {Promise<boolean>} True when the slice was stopped.
 */
async function stopIfEmpty(unit) {
  if (await isPopulated(unit) !== false) return false;
  const { error } = await serviceHelper.runCommand('systemctl', { runAsRoot: true, params: ['stop', unit] });
  if (error) {
    log.error(`appSlice - ${unit} could not be stopped: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Stop the app's slice, once its containers are gone.
 * @param {string} appName
 */
async function release(appName) {
  const unit = sliceName(appName);
  if (unit) await stopIfEmpty(unit);
}

/**
 * Stop every app slice that holds no process: those whose app was removed
 * while FluxOS was not running to stop them.
 * @returns {Promise<number>} How many were stopped.
 */
async function stopEmptySlices() {
  const entries = await fs.readdir(path.join(cgroupRoot, PARENT)).catch(() => []);
  const slices = entries.filter((entry) => entry.startsWith('flux-') && entry.endsWith('.slice'));
  let stopped = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const unit of slices) {
    // eslint-disable-next-line no-await-in-loop
    if (await stopIfEmpty(unit)) stopped += 1;
  }
  if (stopped) log.info(`appSlice - stopped ${stopped} empty app slice(s)`);
  return stopped;
}

module.exports = {
  sliceName,
  cgroupOf,
  release,
  stopEmptySlices,
  useCgroupRoot,
};
