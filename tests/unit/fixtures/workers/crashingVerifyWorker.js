const { parentPort } = require('worker_threads');

// stands in for a batch that kills whichever worker receives it
parentPort.on('message', () => {
  process.exit(1);
});
