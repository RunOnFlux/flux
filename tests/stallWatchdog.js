// The unit runner's stall watchdog, on a worker thread of its own (stallWatch.js
// starts it). It reads the main thread's heartbeat from shared memory every
// BEAT_MS. A heartbeat older than STALL_MS is a stall:
//   - the watchdog itself on time means the main thread was busy;
//   - the watchdog late too means the whole process was held, by the host.
// Each stall is reported once it ends, on fd 2 directly, so a stuck main thread
// cannot hold the report back. The watchdog never touches the main thread, so a
// stall it reports takes no longer for being watched.
const fs = require('fs');
const os = require('os');
const { workerData } = require('worker_threads');

const { shared, BEAT_MS, STALL_MS } = workerData;
const beat = new BigInt64Array(shared, 0, 1);
const titleBytes = new Uint8Array(shared, 8);
const decoder = new TextDecoder();

const now = () => process.hrtime.bigint();
const ms = (ns) => Number(ns / 1000000n);

function currentTest() {
  const end = titleBytes.indexOf(0);
  return decoder.decode(titleBytes.slice(0, end === -1 ? titleBytes.length : end));
}

function report(line) {
  const { rss } = process.memoryUsage();
  fs.writeSync(2, `run-unit: ${line}; load ${os.loadavg().map((l) => l.toFixed(2)).join(' ')}, rss ${Math.round(rss / 1048576)} MB\n`);
}

let lastTick = now();
// The stall being watched: { since, test, watchdogLateMs }.
let stall = null;

setInterval(() => {
  const tick = now();
  const watchdogLateMs = ms(tick - lastTick) - BEAT_MS;
  lastTick = tick;
  const mainAgeMs = ms(tick - Atomics.load(beat, 0));

  if (!stall && mainAgeMs >= STALL_MS) {
    stall = { since: Atomics.load(beat, 0), test: currentTest(), watchdogLateMs };
    return;
  }
  if (stall && Atomics.load(beat, 0) > stall.since) {
    const heldMs = ms(Atomics.load(beat, 0) - stall.since);
    if (stall.watchdogLateMs < STALL_MS / 2) {
      report(`the main thread was busy ${heldMs} ms during "${stall.test}"`);
    } else {
      report(`the whole process was held ${heldMs} ms during "${stall.test}" (this watchdog's own timer ran ${stall.watchdogLateMs} ms late)`);
    }
    stall = null;
  }
}, BEAT_MS);
