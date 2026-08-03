/**
 * authWorkerRunner - runs one registry-auth exchange in a throwaway worker
 *
 * The cloud registry SDKs are large (the three together are ~38MB of resident
 * memory across 427 modules) and a node only needs them when it hosts an app
 * that pulls from a private registry. Loading one into the main isolate would
 * hold that memory for the life of the process, because module caches are never
 * released and freed pages are not returned to the OS.
 *
 * Each SDK therefore lives at the top of its own worker script. A worker is
 * spawned for a single exchange and terminated straight after, which is the one
 * way this memory is genuinely reclaimed.
 */

const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_DIR = path.join(__dirname, '..', 'workers');

// Token exchanges are network round trips against an identity provider; well
// past this the pull that needed them has failed anyway.
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Run a single exchange in a dedicated worker and tear it down.
 *
 * @param {string} workerName Base name of the worker script in the workers directory.
 * @param {object} payload Values the worker needs to build its client and make the call.
 * @param {number} [timeoutMs] How long to wait before abandoning the exchange.
 * @returns {Promise<*>} Whatever the worker resolved for this exchange.
 */
function runAuthWorker(workerName, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(WORKER_DIR, `${workerName}.js`));

    let settled = false;
    let timer = null;

    const settle = (action, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      worker.terminate();
      action(value);
    };

    timer = setTimeout(
      () => settle(reject, new Error(`${workerName} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    worker.on('message', (message) => {
      if (message && message.error) settle(reject, new Error(message.error));
      else settle(resolve, message ? message.result : null);
    });

    worker.on('error', (error) => settle(reject, error));

    worker.on('exit', (code) => {
      settle(reject, new Error(`${workerName} exited without answering (code ${code})`));
    });

    worker.postMessage(payload);
  });
}

module.exports = { runAuthWorker };
