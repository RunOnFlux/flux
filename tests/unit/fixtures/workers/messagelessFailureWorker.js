const { parentPort } = require('worker_threads');

// a throw that carries no message - previously indistinguishable from success
parentPort.on('message', () => {
  parentPort.postMessage({ ok: false, error: undefined });
});
