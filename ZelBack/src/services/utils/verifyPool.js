const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const log = require('../../lib/log');

const WORKER_PATH = path.join(__dirname, 'verifyWorker.js');

// A single worker's share of a batch. Oversized posts are what pin memory: the
// serialised copy of a multi-megabyte batch is not returned to the OS once the
// batch is collected, so the pool buys a bounded footprint with a few extra
// round trips.
const CHUNK_SIZE = 256;

// Signature verification is bursty - a sync response is thousands of items, then
// nothing for hours. One worker stays resident so the path is warm and a spawn
// failure surfaces early; the rest are raised against demand and released.
const RESIDENT_WORKERS = 1;

const IDLE_REAP_MS = 60000;

let slots = [];
let queue = [];
let reapTimer = null;

function maxWorkers() {
  return Math.max(RESIDENT_WORKERS, os.cpus().length - 1);
}

function busyCount() {
  return slots.filter((slot) => slot.job).length;
}

/**
 * Hand queued chunks to whichever workers are free.
 */
function dispatch() {
  for (const slot of slots) {
    if (!queue.length) return;
    if (slot.job || slot.retired) continue;
    const job = queue.shift();
    slot.job = job;
    slot.worker.postMessage(job.chunk);
  }
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
  const worker = new Worker(WORKER_PATH);
  const slot = { worker, job: null, retired: false };

  worker.on('error', (err) => log.error(`Verify worker error: ${err.message}`));

  worker.on('message', (results) => {
    const { job } = slot;
    slot.job = null;
    if (job) job.resolve(results);
    dispatch();
    scheduleReap();
  });

  worker.on('exit', () => {
    const idx = slots.indexOf(slot);
    if (idx !== -1) slots.splice(idx, 1);

    if (slot.job) {
      log.error(`Verify worker exited holding ${slot.job.chunk.length} items, requeueing`);
      queue.unshift(slot.job);
      slot.job = null;
    }

    if (!slot.retired) ensureWorkers();
    dispatch();
  });

  return slot;
}

function start(poolSize) {
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
    slot.worker.terminate();
  }
  slots = [];
  queue = [];
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
    const job = { chunk, resolve: null };
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
