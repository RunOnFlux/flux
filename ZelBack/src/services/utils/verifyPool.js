const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const log = require('../../lib/log');

const WORKER_PATH = path.join(__dirname, 'verifyWorker.js');

let slots = [];

function createSlot() {
  const worker = new Worker(WORKER_PATH);
  const pending = [];
  worker.on('error', (err) => log.error(`Verify worker error: ${err.message}`));
  worker.on('message', (results) => {
    const entry = pending.shift();
    if (entry) entry.resolve(results);
  });
  worker.on('exit', (code) => {
    const idx = slots.findIndex((s) => s.worker === worker);
    if (idx !== -1) {
      slots[idx] = createSlot();
      if (code !== 0) {
        log.error(`Verify worker exited with code ${code}, respawning and resubmitting ${pending.length} batches`);
        const replacement = slots[idx];
        while (pending.length) {
          const entry = pending.shift();
          replacement.pending.push(entry);
          replacement.worker.postMessage(entry.batch);
        }
      }
    }
  });
  return { worker, pending };
}

function start(poolSize) {
  const size = poolSize ?? Math.max(1, os.cpus().length - 1);
  if (slots.length) return;
  for (let i = 0; i < size; i++) {
    slots.push(createSlot());
  }
  log.info(`Verify worker pool started: ${slots.length} workers`);
}

function stop() {
  for (const { worker } of slots) worker.terminate();
  slots = [];
}

function sendToWorker(slot, batch) {
  return new Promise((resolve) => {
    slot.pending.push({ batch, resolve });
    slot.worker.postMessage(batch);
  });
}

async function verify(items) {
  if (!slots.length) start();

  const n = slots.length;
  const chunkSize = Math.ceil(items.length / n);
  const promises = [];
  for (let i = 0; i < n; i++) {
    const slice = items.slice(i * chunkSize, (i + 1) * chunkSize);
    if (slice.length > 0) {
      promises.push(sendToWorker(slots[i], slice));
    }
  }

  const chunks = await Promise.all(promises);
  const results = [];
  for (const chunk of chunks) {
    for (const r of chunk) results.push(r);
  }
  return results;
}

module.exports = { start, stop, verify };
