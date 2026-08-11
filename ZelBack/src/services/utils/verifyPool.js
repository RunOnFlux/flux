const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const log = require('../../lib/log');

const DEFAULT_WORKER_PATH = path.join(__dirname, 'verifyWorker.js');

// A single worker's share of a batch. Oversized posts are what pin memory: the
// serialised copy of a multi-megabyte batch is not returned to the OS once the
// batch is collected, so the pool buys a bounded footprint with a few extra
// round trips.
const CHUNK_SIZE = 256;

// Signature verification is bursty - a sync response is thousands of items, then
// nothing for hours. One worker is kept between bursts and the rest are raised
// against demand and released. The pool is created on first use rather than at
// boot, so a node that never verifies anything never pays for a worker.
const RESIDENT_WORKERS = 1;

const IDLE_REAP_MS = 60000;

// A chunk that keeps killing its worker is abandoned rather than retried for
// ever, and a worker that never answers must not hold its slot for ever. Both
// failures resolve the batch as unverified: a signature we could not check is
// one we do not trust, so the messages are dropped rather than accepted.
const MAX_JOB_ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 60000;

let slots = [];
let queue = [];
let reapTimer = null;
let workerPath = DEFAULT_WORKER_PATH;

function maxWorkers() {
  return Math.max(RESIDENT_WORKERS, os.cpus().length - 1);
}

function busyCount() {
  return slots.filter((slot) => slot.job).length;
}

function abandonJob(job, reason) {
  log.error(`Verify job abandoned after ${job.attempts} attempt(s) - ${reason}; `
    + `${job.chunk.length} signature(s) treated as unverified`);
  job.resolve(new Array(job.chunk.length).fill(false));
}

/**
 * Put a job back at the head of the queue, unless it has already failed enough
 * times to look like the batch itself is the problem.
 */
function requeue(job, reason) {
  if (job.attempts >= MAX_JOB_ATTEMPTS) {
    abandonJob(job, reason);
    return;
  }
  queue.unshift(job);
}

function clearJob(slot) {
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  const { job } = slot;
  slot.job = null;
  return job;
}

/**
 * Hand queued chunks to whichever workers are free.
 */
function dispatch() {
  // A failed handover puts its job back and leaves the slot free, so a pass can
  // end with work queued and a worker idle - and every other way back into here
  // is a worker event, which cannot arrive while no worker holds anything. The
  // job would sit until the next verify() call happened to re-enter. Looping is
  // what settles it, and it terminates: the attempt is counted before the
  // handover, so a chunk that cannot be posted at all is abandoned after
  // MAX_JOB_ATTEMPTS rather than retried for ever.
  let handoverFailed = false;
  do {
    handoverFailed = false;
    for (const slot of slots) {
      if (!queue.length) return;
      if (slot.job || slot.retired) continue;

      const job = queue.shift();
      job.attempts += 1;

      try {
        slot.worker.postMessage(job.chunk);
      } catch (error) {
        // The handover never happened, so the slot is still free - claiming it
        // before posting would retire the slot for the life of the process.
        log.error(`Verify worker could not be given a batch: ${error.message}`);
        requeue(job, `could not be handed to a worker: ${error.message}`);
        handoverFailed = true;
        continue;
      }

      slot.job = job;
      slot.timer = setTimeout(() => {
        const stalled = clearJob(slot);
        log.error('Verify worker did not answer in time, replacing it');
        slot.retired = true;
        const idx = slots.indexOf(slot);
        if (idx !== -1) slots.splice(idx, 1);
        slot.worker.terminate();
        if (stalled) requeue(stalled, 'worker did not answer in time');
        // eslint-disable-next-line no-use-before-define
        ensureWorkers();
        dispatch();
      }, JOB_TIMEOUT_MS);
      if (slot.timer.unref) slot.timer.unref();
    }
  } while (handoverFailed && queue.length);
}

/**
 * Release every idle worker above the resident count. A worker holding a chunk
 * is never taken - its batch would have to be verified again.
 */
function reapIdle() {
  reapTimer = null;
  if (queue.length) return;

  for (let i = slots.length - 1; i >= 0 && slots.length > RESIDENT_WORKERS; i--) {
    const slot = slots[i];
    if (slot.job) continue;
    slot.retired = true;
    slots.splice(i, 1);
    slot.worker.terminate();
  }
}

// Armed from the reply path alone, which reads like an omission and is not: the
// only workers that can still be resident when a burst ends are the ones that
// replied. A worker that dies takes its own slot out of the pool in its exit
// handler, and one that is abandoned as unpostable never held a slot - so a burst
// ending in an exit or an abandon has nothing raised left behind to release.
function scheduleReap() {
  if (reapTimer) clearTimeout(reapTimer);
  reapTimer = setTimeout(reapIdle, IDLE_REAP_MS);
  if (reapTimer.unref) reapTimer.unref();
}

/**
 * Raise the pool to match outstanding work, never past one worker per spare core.
 */
function ensureWorkers() {
  const outstanding = queue.length + busyCount();
  const desired = Math.min(maxWorkers(), Math.max(RESIDENT_WORKERS, outstanding));

  for (let i = slots.length; i < desired; i++) {
    // eslint-disable-next-line no-use-before-define
    slots.push(createSlot());
  }
}

function createSlot() {
  const worker = new Worker(workerPath);
  const slot = {
    worker, job: null, timer: null, retired: false,
  };

  worker.on('error', (err) => log.error(`Verify worker error: ${err.message}`));

  worker.on('message', (results) => {
    const job = clearJob(slot);
    if (job) job.resolve(results);
    dispatch();
    scheduleReap();
  });

  worker.on('exit', () => {
    const idx = slots.indexOf(slot);
    if (idx !== -1) slots.splice(idx, 1);

    const job = clearJob(slot);
    if (job) {
      log.error(`Verify worker exited holding ${job.chunk.length} items, requeueing`);
      requeue(job, 'worker exited while holding the batch');
    }

    if (!slot.retired) ensureWorkers();
    dispatch();
  });

  return slot;
}

/**
 * @param {number} [poolSize] Workers to create up front.
 * @param {object} [options] Overrides.
 * @param {string} [options.workerPath] Worker script the pool runs.
 */
function start(poolSize, options = {}) {
  const { workerPath: overridePath } = options;
  if (overridePath) workerPath = overridePath;
  if (slots.length) return;

  const size = Math.min(maxWorkers(), Math.max(RESIDENT_WORKERS, poolSize ?? RESIDENT_WORKERS));
  for (let i = 0; i < size; i++) {
    slots.push(createSlot());
  }
  log.info(`Verify worker pool started: ${slots.length} resident, scales to ${maxWorkers()}`);
}

function stop() {
  if (reapTimer) {
    clearTimeout(reapTimer);
    reapTimer = null;
  }
  for (const slot of slots) {
    slot.retired = true;
    const job = clearJob(slot);
    if (job) abandonJob(job, 'pool stopped');
    slot.worker.terminate();
  }
  slots = [];
  for (const job of queue) abandonJob(job, 'pool stopped');
  queue = [];
  workerPath = DEFAULT_WORKER_PATH;
}

/**
 * Pool occupancy, for visibility into how hard the crypto path is being worked.
 * @returns {{workers: number, busy: number, queued: number, maxWorkers: number}}
 */
function stats() {
  return {
    workers: slots.length,
    busy: busyCount(),
    queued: queue.length,
    maxWorkers: maxWorkers(),
  };
}

/**
 * Verify a batch of signatures off the main thread.
 * @param {Array<{messageToVerify: string, pubKey: string, signature: string}>} items Items to verify.
 * @returns {Promise<Array<boolean>>} One result per item, in the order given.
 */
async function verify(items) {
  if (!items.length) return [];

  const jobs = [];
  for (let offset = 0; offset < items.length; offset += CHUNK_SIZE) {
    const chunk = items.slice(offset, offset + CHUNK_SIZE);
    const job = { chunk, attempts: 0, resolve: null };
    job.promise = new Promise((resolve) => { job.resolve = resolve; });
    jobs.push(job);
  }

  queue.push(...jobs);
  ensureWorkers();
  dispatch();

  const chunks = await Promise.all(jobs.map((job) => job.promise));

  const results = [];
  for (const chunk of chunks) {
    for (const result of chunk) results.push(result);
  }
  return results;
}

module.exports = {
  start, stop, verify, stats,
};
