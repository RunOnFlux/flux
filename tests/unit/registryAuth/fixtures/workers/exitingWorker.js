const { parentPort } = require('worker_threads');

parentPort.on('message', () => {
  process.exit(3);
});
