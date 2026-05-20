const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const log = require('../../lib/log');

const WORKER_PATH = path.join(__dirname, 'verifyWorker.js');

let workers = [];

function start(poolSize) {
  const size = poolSize ?? Math.max(1, os.cpus().length - 1);
  if (workers.length) return;
  for (let i = 0; i < size; i++) {
    const w = new Worker(WORKER_PATH);
    w.on('error', (err) => log.error(`Verify worker error: ${err.message}`));
    workers.push(w);
  }
  log.info(`Verify worker pool started: ${workers.length} workers`);
}

function stop() {
  for (const w of workers) w.terminate();
  workers = [];
}

function sendToWorker(worker, batch) {
  return new Promise((resolve) => {
    worker.once('message', resolve);
    worker.postMessage(batch);
  });
}

async function verify(items) {
  if (!workers.length) start();

  const n = workers.length;
  const chunkSize = Math.ceil(items.length / n);
  const promises = [];
  for (let i = 0; i < n; i++) {
    const slice = items.slice(i * chunkSize, (i + 1) * chunkSize);
    if (slice.length > 0) {
      promises.push(sendToWorker(workers[i], slice));
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
