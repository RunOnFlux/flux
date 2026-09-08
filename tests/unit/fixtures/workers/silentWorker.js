const { parentPort } = require('worker_threads');

// never answers - stands in for an exchange that hangs against the identity provider
parentPort.on('message', () => {});
