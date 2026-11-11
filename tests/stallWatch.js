// The unit runner's stall watch, on the main thread. It writes a heartbeat to
// memory shared with stallWatchdog.js every BEAT_MS, with the title of the test
// running, and reports each garbage collection that paused the thread for
// STALL_MS or more. The clock and the timer are taken when this loads, before
// any test fakes either.
const path = require('path');
const { PerformanceObserver } = require('perf_hooks');
const { Worker } = require('worker_threads');

const BEAT_MS = 50;
const STALL_MS = 500;
const TITLE_BYTES = 512;

const realSetInterval = setInterval;
const realHrtime = process.hrtime.bigint.bind(process.hrtime);
const shared = new SharedArrayBuffer(8 + TITLE_BYTES);
const beat = new BigInt64Array(shared, 0, 1);
const titleBytes = new Uint8Array(shared, 8);
const encoder = new TextEncoder();

Atomics.store(beat, 0, realHrtime());
titleBytes.set(encoder.encode('loading the test files'));
realSetInterval(() => { Atomics.store(beat, 0, realHrtime()); }, BEAT_MS).unref();

new Worker(path.join(__dirname, 'stallWatchdog.js'), { workerData: { shared, BEAT_MS, STALL_MS } }).unref();

let currentTest = 'loading the test files';
new PerformanceObserver((list) => {
  list.getEntries().filter((entry) => entry.duration >= STALL_MS).forEach((entry) => {
    process.stderr.write(`run-unit: a garbage collection paused the main thread ${Math.round(entry.duration)} ms during "${currentTest}"\n`);
  });
}).observe({ entryTypes: ['gc'] });

/**
 * Names the test now running, for a stall's report.
 * @param {string} title
 */
function testStarted(title) {
  currentTest = title;
  titleBytes.fill(0);
  titleBytes.set(encoder.encode(title).slice(0, TITLE_BYTES - 1));
}

module.exports = { testStarted };
