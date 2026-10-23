/**
 * Kill every process of an app through its cgroups, without docker or the
 * database, and say whether any of them can still run.
 *
 * An app's containers live in its slice (appSlice), found from the kernel alone.
 * A container created before the slice existed lives in its runtime's scope,
 * `docker-<id>.scope`, outside any app's slice, and which app it belongs to is
 * read from the runtime's own records on disk (readContainers), which stay
 * readable while docker does not answer but not while its disk does not. The
 * records are read once and passed to every call here; null stands for records
 * that could not be read. Then no container outside the slices can be named, so
 * those containers are killed and checked together (killOutsideSlices,
 * stillRunnableOutsideSlices), and an app can be said to be unable to run only
 * once none of them can. Where the records are is read from docker at boot; until
 * then it is docker's default for the node's kind. Where each cgroup is, systemd
 * says (appSlice.controlGroup).
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
const { getAppIdentifier } = require('../dockerService');
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

// The name FluxOS gives an app's containers carries the flux or zel prefix
// (dockerService.getAppIdentifier).
const APP_PREFIX = /^(flux|zel)/;

/**
 * The app a container belongs to: its runonflux.app label, which FluxOS sets on
 * every container it creates; for a container made before the label, read from
 * its name, `<flux|zel><component>_<app>` or `flux<app>`. A label-less container
 * of an app whose own name starts with flux reads as the name without it.
 * @param {{name: string, app: string|null}} container
 * @returns {string|null} Null for a container that is not an app's.
 */
function appOf({ name, app }) {
  if (app) return app;
  if (!APP_PREFIX.test(name)) return null;
  if (name.includes('_')) return name.slice(name.indexOf('_') + 1);
  return name.startsWith('flux') ? name.slice('flux'.length) : name;
}

/**
 * @param {{name: string, app: string|null}} container
 * @param {string} appName
 */
function belongsTo({ name, app }, appName) {
  if (app) return app === appName;
  return name === getAppIdentifier(appName) || (APP_PREFIX.test(name) && name.endsWith(`_${appName}`));
}

/**
 * @typedef {{id: string, name: string, app: string|null}} ContainerRecord
 *   The name without its leading '/', and the app its runonflux.app label names.
 */

/**
 * Every container docker has a record of, read from its records on disk. Nothing
 * bounds the read: on a disk that does not answer it never returns.
 * @returns {Promise<ContainerRecord[]|null>} Null when the records cannot be listed.
 */
async function readContainers() {
  const listing = await serviceHelper.runCommand('ls', { runAsRoot: true, params: ['-1', path.join(paths.dockerRoot, 'containers')] });
  if (listing.error) return null;
  const ids = listing.stdout.split('\n').map((line) => line.trim()).filter((id) => /^[0-9a-f]{64}$/.test(id));
  const containers = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const text = await readAsRoot(path.join(paths.dockerRoot, 'containers', id, 'config.v2.json'));
    let parsed = null;
    try {
      parsed = JSON.parse(text ?? 'null');
    } catch {
      parsed = null;
    }
    const name = parsed?.Name;
    const app = parsed?.Config?.Labels?.['runonflux.app'];
    if (typeof name === 'string') containers.push({ id, name: name.replace(/^\//, ''), app: typeof app === 'string' && app ? app : null });
  }
  return containers;
}

/**
 * @param {string} appName
 * @param {ContainerRecord[]|null} containers readContainers
 * @returns {ContainerRecord[]} Empty when the records could not be read.
 */
function recordsOf(appName, containers) {
  return (containers ?? []).filter((container) => belongsTo(container, appName));
}

/**
 * The names of the app's containers.
 * @param {string} appName
 * @param {ContainerRecord[]|null} containers readContainers
 * @returns {string[]} Empty when the records could not be read.
 */
function containersOf(appName, containers) {
  return recordsOf(appName, containers).map(({ name }) => name);
}

/**
 * The scope of every container outside the app slices: directly under
 * system.slice, where the runtime puts a container with no slice of its own.
 *
 * Such a container was created before FluxOS gave every app a slice
 * (dockerService sets each container's CgroupParent); FluxOS creates none
 * outside one. Once no node holds one, this, and the part docker's records play
 * in finding an app's processes, can go.
 * @returns {Promise<string[]|null>} Their unit names; null when systemd does not answer.
 */
async function scopesOutsideSlices() {
  const parent = await appSlice.controlGroup('system.slice');
  if (!parent) return null;
  const entries = await fs.readdir(parent).catch(() => null);
  return entries === null ? null : entries.filter((entry) => /^docker-[0-9a-f]{64}\.scope$/.test(entry));
}

/**
 * The cgroups of the named units that exist now, each once: a scope inside a slice
 * also named is read and killed with the slice.
 * @param {string[]} units
 * @returns {Promise<string[]>}
 */
async function existingCgroups(units) {
  const found = (await Promise.all(units.map(appSlice.controlGroup))).filter(Boolean);
  const outermost = [...new Set(found)].filter((dir, _, all) => !all.some((other) => dir.startsWith(`${other}/`)));
  const present = await Promise.all(outermost.map((dir) => fs.access(path.join(dir, 'cgroup.procs')).then(() => dir, () => null)));
  return present.filter(Boolean);
}

/**
 * Every cgroup that holds a container of the app and exists now: its slice, and
 * the scope of each of its containers the records name.
 * @param {string} appName
 * @param {ContainerRecord[]|null} containers readContainers
 * @returns {Promise<string[]>}
 */
async function cgroupsOf(appName, containers) {
  const unit = appSlice.sliceName(appName);
  const scopes = recordsOf(appName, containers).map(({ id }) => `docker-${id}.scope`);
  return existingCgroups([...(unit ? [unit] : []), ...scopes]);
}

/**
 * The cgroup of every container outside the app slices that exists now.
 * @returns {Promise<string[]|null>} null when systemd does not answer.
 */
async function outsideSliceCgroups() {
  const scopes = await scopesOutsideSlices();
  return scopes === null ? null : existingCgroups(scopes);
}

/**
 * Send SIGKILL to every process in each cgroup.
 * @param {string} owner What the cgroups hold, for the log.
 * @param {string[]} cgroups
 */
async function killIn(owner, cgroups) {
  // eslint-disable-next-line no-restricted-syntax
  for (const dir of cgroups) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await serviceHelper.runCommand('sh', { runAsRoot: true, params: ['-c', 'echo 1 > "$1"', 'sh', path.join(dir, 'cgroup.kill')] });
    if (error) log.error(`appKill - ${owner}: the kill could not be sent to ${dir}: ${error.message}`);
  }
}

/**
 * Send SIGKILL to every process of the app.
 * @param {string} appName
 * @param {ContainerRecord[]|null} containers readContainers
 * @returns {Promise<string[]>} The cgroups it was sent to.
 */
async function kill(appName, containers) {
  const cgroups = await cgroupsOf(appName, containers);
  await killIn(appName, cgroups);
  return cgroups;
}

/**
 * Send SIGKILL to every process of every container outside the app slices.
 * @returns {Promise<string[]|null>} The cgroups it was sent to; null when systemd
 *   does not say which containers are outside the slices.
 */
async function killOutsideSlices() {
  const cgroups = await outsideSliceCgroups();
  if (cgroups !== null) await killIn('containers outside the app slices', cgroups);
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
 * Every process in a cgroup and the cgroups below it. A process lives only in a
 * leaf, so an app's processes are in the scopes under its slice, not the slice.
 * @param {string} dir
 * @returns {Promise<string[]>} Their pids.
 */
async function processesUnder(dir) {
  const own = (await fs.readFile(path.join(dir, 'cgroup.procs'), 'utf8').catch(() => ''))
    .split('\n').map((line) => line.trim()).filter(Boolean);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const below = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => processesUnder(path.join(dir, entry.name))));
  return [...own, ...below.flat()];
}

/**
 * Every process in the cgroups that is neither gone nor has SIGKILL pending.
 * @param {string[]} cgroups
 * @returns {Promise<string[]>} Their pids.
 */
async function runnableIn(cgroups) {
  const pids = (await Promise.all(cgroups.map(processesUnder))).flat();
  const settled = await Promise.all(pids.map(killPendingOrGone));
  return pids.filter((pid, i) => !settled[i]);
}

/**
 * Which processes of the containers outside the app slices could still run.
 * @returns {Promise<string[]|null>} Their pids; null when systemd does not say
 *   which containers are outside the slices.
 */
async function stillRunnableOutsideSlices() {
  const cgroups = await outsideSliceCgroups();
  return cgroups === null ? null : runnableIn(cgroups);
}

/**
 * Which of the app's processes could still run its code: every one that is
 * neither gone nor has SIGKILL pending.
 * @param {string} appName
 * @param {ContainerRecord[]|null} containers readContainers
 * @returns {Promise<string[]|null>} Their pids; empty when the app can never run
 *   again; null when none was found, the records could not be read, and a
 *   container outside the slices, which may be the app's, can still run or
 *   cannot be found.
 */
async function stillRunnable(appName, containers) {
  const runnable = await runnableIn(await cgroupsOf(appName, containers));
  if (runnable.length || containers) return runnable;
  return (await stillRunnableOutsideSlices())?.length === 0 ? [] : null;
}

/**
 * Every app with a slice or a container record on this node, found without
 * docker or the database.
 * @param {ContainerRecord[]|null} containers readContainers
 * @returns {Promise<string[]>}
 */
async function appsOnDisk(containers) {
  const names = new Set();
  const parent = await appSlice.controlGroup('flux.slice');
  const slices = parent ? await fs.readdir(parent).catch(() => []) : [];
  slices.filter((entry) => /^flux-.+\.slice$/.test(entry))
    .forEach((entry) => names.add(entry.slice('flux-'.length, -'.slice'.length).replace(/\\x2d/g, '-')));
  (containers ?? []).map(appOf).filter(Boolean).forEach((name) => names.add(name));
  return [...names];
}

/** Restore the default paths. */
function reset() {
  usePaths(DEFAULT_PATHS);
}

module.exports = {
  readContainers,
  containersOf,
  kill,
  killOutsideSlices,
  stillRunnable,
  stillRunnableOutsideSlices,
  appsOnDisk,
  usePaths,
  reset,
};
