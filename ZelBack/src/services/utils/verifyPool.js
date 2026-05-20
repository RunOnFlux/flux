const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const log = require('../../lib/log');

const WORKER_PATH = path.join(__dirname, 'verifyWorker.js');

let slots = [];

function start(poolSize) {
  const size = poolSize ?? Math.max(1, os.cpus().length - 1);
  if (slots.length) return;
  for (let i = 0; i < size; i++) {
    const worker = new Worker(WORKER_PATH);
    const callbacks = [];
    worker.on('error', (err) => log.error(`Verify worker error: ${err.message}`));
    worker.on('message', (results) => {
      const cb = callbacks.shift();
      if (cb) cb(results);
    });
    slots.push({ worker, callbacks });
  }
  log.info(`Verify worker pool started: ${slots.length} workers`);
}

function stop() {
  for (const { worker } of slots) worker.terminate();
  slots = [];
}

function sendToWorker(slot, batch) {
  return new Promise((resolve) => {
    slot.callbacks.push(resolve);
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
