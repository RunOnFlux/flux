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
 * takes no readings while it is paused, so a pause cannot read as a stall. A
 * reading counts only when one interval has passed, by the machine's uptime,
 * since the reading the thread's count last moved at: FluxOS takes a reading as
 * it starts, and a start soon after another adds nothing.
 *
 * Out of service lasts until the machine reboots, through any number of FluxOS
 * restarts, and so does the count of readings toward it. Both are kept in
 * /run/fluxos, on the tmpfs every Linux mounts at /run at boot: memory, so
 * reading it cannot stall with a disk, and emptied by a reboot. Only root and
 * FluxOS's own account may write there. Not a database row, because the database
 * may be what is stuck. The file is written only when what it holds changes.
 *
 * WHAT IS READ. The threads of the processes FluxOS depends on, in FluxOS's own
 * PID namespace. An app container that runs one of the same programs has its
 * own namespace and is not read. Every file read is one any account may read of
 * another's process, so a FluxOS that is not root reads the same.
 */

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const config = require('config');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');

const DEPENDENCIES = new Set(['mongod', 'dockerd', 'containerd', 'syncthing', 'fluxd', 'fluxbenchd']);
const READ_INTERVAL_MS = config.hostStall.readIntervalMs;
const STUCK_INTERVALS = config.hostStall.stuckIntervals;
// /proc/uptime is written in hundredths of a second.
const UPTIME_RESOLUTION_MS = 10;

/**
 * Every dependency thread in D at the last reading, keyed by process, thread
 * and the thread's start time so a reused id is a new thread, with its count
 * and the uptime its count last moved at.
 * @type {Map<string, {process: string, tid: string, wchan: string, switches: number, intervals: number, countedAtMs: number}>}
 */
let tracked = new Map();
/** Why the node is out of service for a host stall, once it is. */
let tripReason = null;
let running = false;
let readTimer = null;
// Advanced by stop(), so a reading still under way when the service stops
// neither keeps what it read nor acts on it.
let generation = 0;
/** The state being kept, which stop() lets its caller wait for. */
let keeping = Promise.resolve();
/** Called once the node is out of service for a host stall. */
const tripListeners = [];
const DEFAULT_PATHS = {
  procRoot: '/proc',
  stateFile: '/run/fluxos/host-stall.json',
};
let paths = { ...DEFAULT_PATHS };
// What the state file holds with nothing stuck and no trip.
const NOTHING_KEPT = JSON.stringify({ trip: null, threads: [] });
/** What the state file holds, as this process last wrote or found it; null when unknown. */
let keptText = NOTHING_KEPT;
/** What the state file is to hold once the write asked for last has landed; null when none is waiting. */
let queuedText = null;

/**
 * @param {{procRoot?: string, stateFile?: string}} options
 *   Where /proc and the kept state are; each one given replaces it.
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
 * @param {string} procRoot The /proc this reading reads, fixed when it starts.
 * @returns {Promise<Array<{process: string, pid: string, tid: string, state: string, startTime: string, switches: number, wchan: string}>>}
 */
async function readDependencyThreads(procRoot) {
  const ownDepth = namespaceDepth(await readOrNull(path.join(procRoot, 'self', 'status')));
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
 * The machine's uptime, which runs on through FluxOS restarts and starts again
 * only at a boot.
 * @param {string} procRoot
 * @returns {Promise<number|null>} Milliseconds, or null when it cannot be read.
 */
async function readUptimeMs(procRoot) {
  const seconds = Number((await readOrNull(path.join(procRoot, 'uptime')))?.split(' ')[0]);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * Carry each thread's count of intervals stuck from the last reading to this
 * one. A thread that did not run adds one once an interval has passed since its
 * count last moved, and keeps its count before then. A thread that ran, or left
 * D, starts again.
 * @param {Array<object>} threads One reading.
 * @param {number} nowMs The uptime the reading was taken at.
 * @returns {Map<string, object>}
 */
function carryForward(threads, nowMs) {
  const next = new Map();
  threads.filter((thread) => thread.state === 'D').forEach((thread) => {
    const key = `${thread.process}/${thread.pid}/${thread.tid}/${thread.startTime}`;
    const before = tracked.get(key);
    let intervals = 0;
    let countedAtMs = nowMs;
    if (before && before.switches === thread.switches) {
      const intervalPassed = nowMs - before.countedAtMs + UPTIME_RESOLUTION_MS >= READ_INTERVAL_MS;
      intervals = intervalPassed ? before.intervals + 1 : before.intervals;
      countedAtMs = intervalPassed ? nowMs : before.countedAtMs;
    }
    next.set(key, {
      process: thread.process, tid: thread.tid, wchan: thread.wchan, switches: thread.switches, intervals, countedAtMs,
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
 * Make the state file's directory. /run is root's: a FluxOS that is not root
 * makes it through sudo, owned by its own account, and writes in it directly.
 * @param {string} dir
 */
async function makeStateDirectory(dir) {
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o755 });
    return;
  } catch (error) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
  }
  const { uid, gid } = os.userInfo();
  const { error } = await serviceHelper.runCommand('install', {
    runAsRoot: true,
    params: ['-d', '-m', '755', '-o', String(uid), '-g', String(gid), dir],
  });
  if (error) throw error;
}

/**
 * Write the state file, once every write asked for before has ended.
 * @param {string} text
 * @param {string} stateFile The file as it was when the write was asked for.
 */
async function writeState(text, stateFile) {
  const staged = `${stateFile}.tmp`;
  try {
    await makeStateDirectory(path.dirname(stateFile));
    await fs.writeFile(staged, text);
    await fs.rename(staged, stateFile);
    keptText = text;
  } catch (error) {
    log.error(`hostStall - the state could not be kept: ${error.message}`);
  } finally {
    if (queuedText === text) queuedText = null;
  }
}

/**
 * Keep the trip and every thread's count, so a FluxOS restart before the next
 * reboot carries both on. Nothing is written when the file already holds them, or
 * a write waiting to land does. Writes land one at a time and in order, and no
 * reading waits for one.
 */
function keepState() {
  const trip = fluxNetworkHelper.isStickyDosHeldBy(fluxNetworkHelper.StickyDosOwner.HOST_STALL) ? tripReason : null;
  const text = JSON.stringify({ trip, threads: [...tracked] });
  if (text === (queuedText ?? keptText)) return;
  queuedText = text;
  const { stateFile } = paths;
  keeping = keeping.then(() => writeState(text, stateFile));
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

/** Restore what an earlier FluxOS in this boot kept: the trip, and every thread's count. */
async function restoreState() {
  const text = await readOrNull(paths.stateFile);
  keptText = text === null ? NOTHING_KEPT : null;
  if (text === null) return;
  try {
    const { trip, threads } = JSON.parse(text);
    tracked = new Map(threads);
    keptText = text;
    if (trip) {
      tripReason = trip;
      fluxNetworkHelper.setStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL, trip);
      announceTrip();
    }
  } catch (error) {
    log.error(`hostStall - the kept state could not be read: ${error.message}`);
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
    tripReason = `Host stall: ${describe(longest)}`;
    fluxNetworkHelper.setStickyDos(fluxNetworkHelper.StickyDosOwner.HOST_STALL, tripReason);
    announceTrip();
  }
}

/** Take one reading, act on it, and ask for what it found to be kept. */
async function takeReading() {
  const startedIn = generation;
  const nowMs = await readUptimeMs(paths.procRoot);
  if (nowMs === null) {
    log.error('hostStall - the uptime could not be read; this reading is not taken');
    return;
  }
  const threads = await readDependencyThreads(paths.procRoot);
  if (startedIn !== generation) return;
  tracked = carryForward(threads, nowMs);
  await act();
  keepState();
}

/**
 * Take one reading and act on it.
 * @param {object} [options] Paths, as usePaths takes them.
 * @returns {Promise<void>} Resolves once what it found is kept.
 */
async function readOnce(options = {}) {
  usePaths(options);
  await takeReading();
  await keeping;
}

async function readAndReschedule() {
  try {
    await takeReading();
  } catch (error) {
    log.error(`hostStall - reading the dependency threads failed: ${error.message}`);
  }
  if (running) readTimer = setTimeout(readAndReschedule, READ_INTERVAL_MS);
}

/**
 * Restore what an earlier FluxOS in this boot kept, then read now, and every
 * READ_INTERVAL_MS after each reading ends.
 * @param {object} [options] Paths, as usePaths takes them.
 * @returns {Promise<void>} Resolves once the kept state is restored and the first
 *   reading has acted; the write of what it found goes on without it.
 */
async function start(options = {}) {
  if (running) return;
  running = true;
  usePaths(options);
  await restoreState();
  await readAndReschedule();
}

/**
 * Take no more readings and forget every thread.
 * @returns {Promise<void>} Resolves once the state being kept, if any, is written.
 */
function stop() {
  generation += 1;
  running = false;
  clearTimeout(readTimer);
  readTimer = null;
  tracked = new Map();
  tripReason = null;
  keptText = NOTHING_KEPT;
  queuedText = null;
  paths = { ...DEFAULT_PATHS };
  tripListeners.length = 0;
  return keeping;
}

module.exports = {
  start,
  stop,
  onTrip,
  readOnce,
};
