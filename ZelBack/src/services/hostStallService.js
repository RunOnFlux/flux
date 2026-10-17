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
 * WHAT IS READ. The threads of the processes FluxOS depends on, in FluxOS's own
 * PID namespace. An app container that runs one of the same programs has its
 * own namespace and is not read.
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('config');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');

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
let procRoot = '/proc';

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
  return {
    state: fields[0], startTime: fields[19], switches, wchan: (wchan ?? '').trim() || 'unknown',
  };
}

/**
 * Every thread of every dependency process in this PID namespace.
 * @returns {Promise<Array<{process: string, pid: string, tid: string, state: string, startTime: string, switches: number, wchan: string}>>}
 */
async function readDependencyThreads() {
  const ownNamespace = await fs.readlink(path.join(procRoot, 'self', 'ns', 'pid')).catch(() => null);
  const pids = (await fs.readdir(procRoot)).filter((entry) => /^\d+$/.test(entry));
  const threads = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const pid of pids) {
    const pidDir = path.join(procRoot, pid);
    // eslint-disable-next-line no-await-in-loop
    const comm = (await readOrNull(path.join(pidDir, 'comm')))?.trim();
    // eslint-disable-next-line no-continue
    if (!DEPENDENCIES.has(comm)) continue;
    // eslint-disable-next-line no-await-in-loop
    const namespace = await fs.readlink(path.join(pidDir, 'ns', 'pid')).catch(() => null);
    // eslint-disable-next-line no-continue
    if (namespace !== ownNamespace) continue;
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

/** Hold or release the node by the longest-stuck thread. */
function act() {
  const longest = [...tracked.values()].reduce((worst, thread) => (!worst || thread.intervals > worst.intervals ? thread : worst), null);
  if (!longest || longest.intervals === 0) {
    fluxNetworkHelper.clearPlacementHold(fluxNetworkHelper.PlacementHoldOwner.HOST_STALL);
    return;
  }
  fluxNetworkHelper.setPlacementHold(fluxNetworkHelper.PlacementHoldOwner.HOST_STALL, describe(longest));
  if (longest.intervals >= STUCK_INTERVALS && !fluxNetworkHelper.isStickyDosHeldBy(fluxNetworkHelper.StickyDosOwner.HOST_STALL)) {
    fluxNetworkHelper.setStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL, `Host stall: ${describe(longest)}`);
  }
}

/**
 * Take one reading and act on it.
 * @param {{procRoot?: string}} [options] Where /proc is.
 */
async function readOnce(options = {}) {
  procRoot = options.procRoot ?? procRoot;
  tracked = carryForward(await readDependencyThreads());
  act();
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
 * Read now, and every READ_INTERVAL_MS after each reading ends.
 * @param {{procRoot?: string}} [options] Where /proc is.
 */
function start(options = {}) {
  if (readTimer !== null) return;
  procRoot = options.procRoot ?? procRoot;
  readTimer = setTimeout(readAndReschedule, 0);
}

/** Take no more readings and forget every thread. */
function stop() {
  clearTimeout(readTimer);
  readTimer = null;
  tracked = new Map();
  procRoot = '/proc';
}

module.exports = {
  start,
  stop,
  readOnce,
};
