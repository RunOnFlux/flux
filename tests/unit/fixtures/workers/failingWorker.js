const { parentPort } = require('worker_threads');

parentPort.on('message', () => {
  parentPort.postMessage({ ok: false, error: 'service principal rejected' });
});
