// Entry point of every worker thread created by networkDefaults.createWorker(): applies the
// outbound connection defaults in this thread, then loads the worker script it was given.

const { workerData } = require('node:worker_threads');
const { applyNetworkDefaults } = require('./networkDefaults');

applyNetworkDefaults();

// eslint-disable-next-line import/no-dynamic-require
require(workerData.script);
