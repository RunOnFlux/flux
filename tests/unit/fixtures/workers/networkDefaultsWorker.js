const net = require('node:net');
const dns = require('node:dns');
const { parentPort } = require('worker_threads');

// Reports the outbound connection defaults in effect in this thread, in whichever reply shape
// the spawner expects: one result per item for verifyPool's batches, { ok, result } otherwise.
function seen() {
  return { attemptMs: net.getDefaultAutoSelectFamilyAttemptTimeout(), order: dns.getDefaultResultOrder() };
}

parentPort.on('message', (payload) => {
  if (Array.isArray(payload)) {
    parentPort.postMessage(payload.map(seen));
    return;
  }
  parentPort.postMessage({ ok: true, result: seen() });
});
