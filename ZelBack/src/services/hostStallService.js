/**
 * Take a node out of service when a thread of one of its dependencies is held
 * in the kernel for good.
 *
 * WHAT COUNTS. A thread in uninterruptible sleep (state D) whose context switch
 * count is the same at two readings never ran between them, however far apart
 * they are. A thread that stays so for one whole interval holds the node back
 * from new placements; for STUCK_INTERVALS intervals, the host is broken, and
 * the node goes out of service until it reboots.
 *
 * Readings are counted rather than time measured: a VM its hypervisor paused
 * takes no readings while it is paused, so a pause cannot read as a stall.
 *
 * Out of service lasts until the machine reboots, through any number of FluxOS
 * restarts: the trip is recorded with the kernel's boot id, and a start in the
 * same boot restores it. The record is a file, not a database row, because the
 * database may be what is stuck.
 *
 * WHAT IS READ. The threads of the processes FluxOS depends on, in FluxOS's own
 * PID namespace. An app container that runs one of the same programs has its
 * own namespace and is not read. Every file read is one any account may read of
 * another's process, so a FluxOS that is not root reads the same.
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('config');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const { fluxDirPath } = require('./utils/appConstants');

const DEPENDENCIES = new Set(['mongod', 'dockerd', 'containerd', 'syncthing', 'fluxd', 'fluxbenchd']);
const READ_INTERVAL_MS = config.hostStall.readIntervalMs;
const STUCK_INTERVALS = config.hostStall.stuckIntervals;

/**
 * Every dependency thread in D at the last reading, keyed by process, thread
 * and the thread's start time so a reused id is a new thread.
 * @type {Map<string, {process: string, tid: string, wchan: string, switches: number, intervals: number}>}
 */
let tracked = new Map();
let readTimer = null;
/** Called once the node is out of service for a host stall. */
const tripListeners = [];
const DEFAULT_PATHS = {
  procRoot: '/proc',
  recordFile: path.join(fluxDirPath, 'config', 'hostStall.json'),
  bootIdPath: config.system.bootIdPath,
};
let paths = { ...DEFAULT_PATHS };

/**
 * @param {{procRoot?: string, recordFile?: string, bootIdPath?: string}} options
 *   Where /proc, the trip record and the boot id are; each one given replaces it.
 */
function usePaths(options) {
  paths = { ...paths, ...options };
}

/**
 * @param {string} file
 * @returns {Promise<string|null>} The file's text, or null when it is gone.
 */
async function readOrNull(file) {
  return fs.readFile(file, 'utf8').catch(() => null);
}

/**
 * One thread's state, start time, context switches and wait point, or null
 * when it exited while it was read.
 * @param {string} taskDir /proc/<pid>/task/<tid>
 */
async function readThread(taskDir) {
  const [stat, status, wchan] = await Promise.all(['stat', 'status', 'wchan'].map((name) => readOrNull(path.join(taskDir, name))));
  if (stat === null || status === null) return null;
  // the command name inside the parentheses may itself hold spaces or ')'
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const switches = status.split('\n')
    .filter((line) => line.startsWith('voluntary_ctxt_switches') || line.startsWith('nonvoluntary_ctxt_switches'))
    .reduce((sum, line) => sum + Number(line.split(/\s+/)[1]), 0);
  // the kernel writes 0 for a wait point it does not show this account
  const waitPoint = (wchan ?? '').trim();
  return {
    state: fields[0], startTime: fields[19], switches, wchan: waitPoint && waitPoint !== '0' ? waitPoint : 'unknown',
  };
}

/**
 * How many PID namespaces deep a process is, counted from the one this /proc
 * shows: its status names its id in each, outermost first. A process in a
 * namespace below FluxOS's has more than FluxOS; one beside it is not in this
 * /proc at all. A kernel older than 4.1 writes no NSpid, and every process on it
 * reads as one deep.
 * @param {string|null} status The process's status file.
 * @returns {number|null} Null when the status is gone.
 */
function namespaceDepth(status) {
  if (status === null) return null;
  const line = status.split('\n').find((entry) => entry.startsWith('NSpid:'));
  return line ? line.trim().split(/\s+/).length - 1 : 1;
}

/**
 * Every thread of every dependency process in this PID namespace.
 * @returns {Promise<Array<{process: string, pid: string, tid: string, state: string, startTime: string, switches: number, wchan: string}>>}
 */
async function readDependencyThreads() {
  const ownDepth = namespaceDepth(await readOrNull(path.join(paths.procRoot, 'self', 'status')));
  const pids = (await fs.readdir(paths.procRoot)).filter((entry) => /^\d+$/.test(entry));
  const threads = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const pid of pids) {
    const pidDir = path.join(paths.procRoot, pid);
    // eslint-disable-next-line no-await-in-loop
    const comm = (await readOrNull(path.join(pidDir, 'comm')))?.trim();
    // eslint-disable-next-line no-continue
    if (!DEPENDENCIES.has(comm)) continue;
    // eslint-disable-next-line no-await-in-loop
    const depth = namespaceDepth(await readOrNull(path.join(pidDir, 'status')));
    // eslint-disable-next-line no-continue
    if (depth === null || depth !== ownDepth) continue;
    // eslint-disable-next-line no-await-in-loop
    const tids = await fs.readdir(path.join(pidDir, 'task')).catch(() => []);
    // eslint-disable-next-line no-restricted-syntax
    for (const tid of tids) {
      // eslint-disable-next-line no-await-in-loop
      const thread = await readThread(path.join(pidDir, 'task', tid));
      if (thread) threads.push({ process: comm, pid, tid, ...thread });
    }
  }
  return threads;
}

/**
 * Carry each thread's count of intervals stuck from the last reading to this
 * one. A thread that ran, or left D, starts again.
 * @param {Array<object>} threads One reading.
 * @returns {Map<string, object>}
 */
function carryForward(threads) {
  const next = new Map();
  threads.filter((thread) => thread.state === 'D').forEach((thread) => {
    const key = `${thread.process}/${thread.pid}/${thread.tid}/${thread.startTime}`;
    const before = tracked.get(key);
    const intervals = before && before.switches === thread.switches ? before.intervals + 1 : 0;
    next.set(key, {
      process: thread.process, tid: thread.tid, wchan: thread.wchan, switches: thread.switches, intervals,
    });
  });
  return next;
}

/**
 * @param {{process: string, tid: string, wchan: string, intervals: number}} thread
 * @returns {string}
 */
function describe(thread) {
  const minutes = Math.round((thread.intervals * READ_INTERVAL_MS) / 60000);
  return `${thread.process} thread ${thread.tid} has been held in the kernel at ${thread.wchan} for ${minutes} minutes`;
}

/**
 * @returns {Promise<string|null>} This boot's id, or null when it cannot be read.
 */
async function currentBootId() {
  const id = (await readOrNull(paths.bootIdPath))?.trim();
  return id || null;
}

/**
 * Record the trip, so a FluxOS restart in this boot restores it.
 * @param {string} reason
 */
async function recordTrip(reason) {
  try {
    const bootId = await currentBootId();
    if (!bootId) {
      log.warn('hostStall - the boot id cannot be read; the trip lasts only as long as this process');
      return;
    }
    const staged = `${paths.recordFile}.tmp`;
    await fs.writeFile(staged, JSON.stringify({ bootId, reason }));
    await fs.rename(staged, paths.recordFile);
  } catch (error) {
    log.error(`hostStall - the trip could not be recorded: ${error.message}`);
  }
}

/** Tell every listener the node is out of service for a host stall. */
function announceTrip() {
  tripListeners.forEach((listener) => listener());
}

/**
 * Call `listener` once the node is out of service for a host stall: at once
 * when it already is, whether it tripped in this process or the trip was
 * restored at start.
 * @param {function(): void} listener
 */
function onTrip(listener) {
  tripListeners.push(listener);
  if (fluxNetworkHelper.isStickyDosHeldBy(fluxNetworkHelper.StickyDosOwner.HOST_STALL)) listener();
}

/** Restore a trip recorded in this boot, and discard one from an earlier boot. */
async function restoreTrip() {
  try {
    const text = await readOrNull(paths.recordFile);
    if (text === null) return;
    const bootId = await currentBootId();
    if (!bootId) return;
    const { bootId: recorded, reason } = JSON.parse(text);
    if (recorded !== bootId) {
      await fs.rm(paths.recordFile, { force: true });
      log.info('hostStall - the recorded trip is from an earlier boot and is discarded');
      return;
    }
    fluxNetworkHelper.setStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL, reason);
    announceTrip();
  } catch (error) {
    log.error(`hostStall - the recorded trip could not be read: ${error.message}`);
  }
}

/** Hold or release the node by the longest-stuck thread. */
async function act() {
  const longest = [...tracked.values()].reduce((worst, thread) => (!worst || thread.intervals > worst.intervals ? thread : worst), null);
  if (!longest || longest.intervals === 0) {
    fluxNetworkHelper.clearPlacementHold(fluxNetworkHelper.PlacementHoldOwner.HOST_STALL);
    return;
  }
  fluxNetworkHelper.setPlacementHold(fluxNetworkHelper.PlacementHoldOwner.HOST_STALL, describe(longest));
  if (longest.intervals >= STUCK_INTERVALS && !fluxNetworkHelper.isStickyDosHeldBy(fluxNetworkHelper.StickyDosOwner.HOST_STALL)) {
    const reason = `Host stall: ${describe(longest)}`;
    fluxNetworkHelper.setStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL, reason);
    await recordTrip(reason);
    announceTrip();
  }
}

/**
 * Take one reading and act on it.
 * @param {object} [options] Paths, as usePaths takes them.
 */
async function readOnce(options = {}) {
  usePaths(options);
  tracked = carryForward(await readDependencyThreads());
  await act();
}

async function readAndReschedule() {
  try {
    await readOnce();
  } catch (error) {
    log.error(`hostStall - reading the dependency threads failed: ${error.message}`);
  }
  if (readTimer !== null) readTimer = setTimeout(readAndReschedule, READ_INTERVAL_MS);
}

/**
 * Restore a trip recorded in this boot, then read now, and every
 * READ_INTERVAL_MS after each reading ends.
 * @param {object} [options] Paths, as usePaths takes them.
 * @returns {Promise<void>} Resolves once a recorded trip is restored.
 */
async function start(options = {}) {
  if (readTimer !== null) return;
  usePaths(options);
  readTimer = setTimeout(readAndReschedule, 0);
  await restoreTrip();
}

/** Take no more readings and forget every thread. */
function stop() {
  clearTimeout(readTimer);
  readTimer = null;
  tracked = new Map();
  paths = { ...DEFAULT_PATHS };
  tripListeners.length = 0;
}

module.exports = {
  start,
  stop,
  onTrip,
  readOnce,
};
