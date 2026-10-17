/**
 * Kill every process of an app through its cgroups, without docker or the
 * database, and say whether any of them can still run.
 *
 * An app's containers live in its slice (appSlice). A container created before
 * the slice existed lives in its runtime's scope, `system.slice/docker-<id>.scope`,
 * and the container's name is read from the runtime's own record on disk, which
 * stays readable while docker does not answer. Where those records are is read
 * from docker at boot; until then it is docker's default for the node's kind.
 *
 * A process held in the kernel is not removed by a kill: it keeps the kill
 * pending and dies the moment the kernel lets it go, without running the app's
 * code again. So a cgroup whose every process has SIGKILL pending is as safe as
 * an empty one.
 */

const fs = require('fs').promises;
const path = require('path');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const appSlice = require('./appSlice');
const { isArcane } = require('../utils/appConstants');

const SIGKILL_MASK = 1n << 8n;

const DEFAULT_PATHS = {
  cgroupRoot: '/sys/fs/cgroup',
  procRoot: '/proc',
  dockerRoot: isArcane ? '/dat/var/lib/docker' : '/var/lib/docker',
};
let paths = { ...DEFAULT_PATHS };

/**
 * @param {{cgroupRoot?: string, procRoot?: string, dockerRoot?: string}} options
 *   Where the cgroup filesystem, /proc and docker's data are; each one given replaces it.
 */
function usePaths(options) {
  paths = { ...paths, ...options };
  appSlice.useCgroupRoot(paths.cgroupRoot);
}

/**
 * A file only root may read, read through sudo where FluxOS does not run as root.
 * @param {string} file
 * @returns {Promise<string|null>}
 */
async function readAsRoot(file) {
  const { stdout, error } = await serviceHelper.runCommand('cat', { runAsRoot: true, params: [file] });
  return error ? null : stdout;
}

/**
 * The app a container belongs to: `flux<app>` for a single container,
 * `flux<component>_<app>` for a component.
 * @param {string} name The container's name.
 * @returns {string|null} Null for a container that is not an app's.
 */
function appOf(name) {
  if (!name.startsWith('flux')) return null;
  return name.includes('_') ? name.slice(name.indexOf('_') + 1) : name.slice('flux'.length);
}

/**
 * @param {string} name The container's name.
 * @param {string} appName
 */
function belongsTo(name, appName) {
  return appOf(name) === appName;
}

/**
 * Every container docker has a record of, read from its records on disk.
 * @returns {Promise<Array<{id: string, name: string}>>} Names without the leading '/'.
 */
async function containersOnDisk() {
  const listing = await serviceHelper.runCommand('ls', { runAsRoot: true, params: ['-1', path.join(paths.dockerRoot, 'containers')] });
  if (listing.error) return [];
  const ids = listing.stdout.split('\n').map((line) => line.trim()).filter((id) => /^[0-9a-f]{64}$/.test(id));
  const containers = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const text = await readAsRoot(path.join(paths.dockerRoot, 'containers', id, 'config.v2.json'));
    let name = null;
    try {
      ({ Name: name } = JSON.parse(text ?? 'null') ?? {});
    } catch {
      name = null;
    }
    if (typeof name === 'string') containers.push({ id, name: name.replace(/^\//, '') });
  }
  return containers;
}

/**
 * The scopes of the app's containers that live outside its slice.
 * @param {string} appName
 * @returns {Promise<string[]>} Cgroup directories.
 */
async function legacyScopes(appName) {
  return (await containersOnDisk())
    .filter(({ name }) => belongsTo(name, appName))
    .map(({ id }) => path.join(paths.cgroupRoot, 'system.slice', `docker-${id}.scope`));
}

/**
 * Every cgroup that holds a container of the app and exists now.
 * @param {string} appName
 * @returns {Promise<string[]>}
 */
async function cgroupsOf(appName) {
  const unit = appSlice.sliceName(appName);
  const candidates = [...(unit ? [appSlice.cgroupOf(unit)] : []), ...await legacyScopes(appName)];
  const present = await Promise.all(candidates.map((dir) => fs.access(path.join(dir, 'cgroup.procs')).then(() => dir, () => null)));
  return present.filter(Boolean);
}

/**
 * Send SIGKILL to every process of the app.
 * @param {string} appName
 * @returns {Promise<string[]>} The cgroups it was sent to.
 */
async function kill(appName) {
  const cgroups = await cgroupsOf(appName);
  // eslint-disable-next-line no-restricted-syntax
  for (const dir of cgroups) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await serviceHelper.runCommand('sh', { runAsRoot: true, params: ['-c', 'echo 1 > "$1"', 'sh', path.join(dir, 'cgroup.kill')] });
    if (error) log.error(`appKill - ${appName}: the kill could not be sent to ${dir}: ${error.message}`);
  }
  return cgroups;
}

/**
 * @param {string} pid
 * @returns {Promise<boolean>} Whether the process has SIGKILL pending, or is gone.
 */
async function killPendingOrGone(pid) {
  const status = await fs.readFile(path.join(paths.procRoot, pid, 'status'), 'utf8').catch(() => null);
  if (status === null) return true;
  return ['SigPnd', 'ShdPnd'].some((field) => {
    const match = status.match(new RegExp(`^${field}:\\s*([0-9a-f]+)$`, 'm'));
    return match ? (BigInt(`0x${match[1]}`) & SIGKILL_MASK) !== 0n : false;
  });
}

/**
 * Which of the app's processes could still run its code: every one that is
 * neither gone nor has SIGKILL pending.
 * @param {string} appName
 * @returns {Promise<string[]>} Their pids; empty when the app can never run again.
 */
async function stillRunnable(appName) {
  const cgroups = await cgroupsOf(appName);
  const pids = (await Promise.all(cgroups.map((dir) => fs.readFile(path.join(dir, 'cgroup.procs'), 'utf8').catch(() => ''))))
    .flatMap((text) => text.split('\n').map((line) => line.trim()).filter(Boolean));
  const settled = await Promise.all(pids.map(killPendingOrGone));
  return pids.filter((pid, i) => !settled[i]);
}

/**
 * Every app with a slice or a container on this node, found without docker or
 * the database.
 * @returns {Promise<string[]>}
 */
async function appsOnDisk() {
  const names = new Set();
  const slices = await fs.readdir(path.join(paths.cgroupRoot, 'flux.slice')).catch(() => []);
  slices.filter((entry) => /^flux-.+\.slice$/.test(entry))
    .forEach((entry) => names.add(entry.slice('flux-'.length, -'.slice'.length).replace(/\\x2d/g, '-')));
  (await containersOnDisk()).map(({ name }) => appOf(name)).filter(Boolean).forEach((name) => names.add(name));
  return [...names];
}

/** Restore the default paths. */
function reset() {
  usePaths(DEFAULT_PATHS);
}

module.exports = {
  kill,
  stillRunnable,
  appsOnDisk,
  usePaths,
  reset,
};
