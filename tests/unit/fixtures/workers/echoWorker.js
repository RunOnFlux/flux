const { parentPort } = require('worker_threads');

parentPort.on('message', (payload) => {
  parentPort.postMessage({ ok: true, result: { echoed: payload } });
});
