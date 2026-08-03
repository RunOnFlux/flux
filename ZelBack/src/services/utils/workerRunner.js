/**
 * workerRunner - runs one job in a throwaway worker
 *
 * Some dependencies are large and rarely needed: the three cloud registry SDKs
 * total ~38MB across 427 modules, and openpgp holds ~19MB. Loading one into the main isolate holds that memory for the life of the process, because module caches are never
 * released and freed pages are not returned to the OS.
 *
 * Each therefore lives at the top of its own worker script. A worker is
 * spawned for a single exchange and terminated straight after, which is the one
 * way this memory is genuinely reclaimed.
 */

const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_DIR = path.join(__dirname, '..', 'workers');

// // Jobs are short: a token exchange or a crypto operation. Well past this,
// whatever needed the answer has failed anyway.
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Run a single exchange in a dedicated worker and tear it down.
 *
 * @param {string} workerName Base name of the worker script in the workers directory.
 * @param {object} payload Values the worker needs to build its client and make the call.
 * @param {object} [options] Overrides.
 * @param {number} [options.timeoutMs] How long to wait before abandoning the exchange.
 * @param {string} [options.workerDir] Directory holding the worker scripts.
 * @returns {Promise<*>} Whatever the worker resolved for this exchange.
 */
function runInWorker(workerName, payload, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, workerDir = WORKER_DIR } = options;

  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(workerDir, `${workerName}.js`));

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

module.exports = { runInWorker };
