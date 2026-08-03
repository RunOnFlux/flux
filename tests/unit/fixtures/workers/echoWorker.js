const { parentPort } = require('worker_threads');

parentPort.on('message', (payload) => {
  parentPort.postMessage({ result: { echoed: payload } });
});
