// The unit runner's stall watchdog, on a worker thread of its own (stallWatch.js
// starts it). It reads the main thread's heartbeat from shared memory every
// BEAT_MS. A heartbeat older than STALL_MS is a stall:
//   - the watchdog itself on time means the main thread is busy, and its stack is
//     captured through the inspector: paused, read and resumed;
//   - the watchdog late too means the whole process was held, by the host.
// Each stall is reported once it ends, on fd 2 directly, so a stuck main thread
// cannot hold the report back.
const fs = require('fs');
const os = require('os');
const inspector = require('inspector');
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

/**
 * The main thread's stack now, read by pausing it through the inspector.
 * @returns {Promise<string[]>}
 */
function mainThreadStack() {
  return new Promise((resolve) => {
    const session = new inspector.Session();
    let done = false;
    const finish = (frames) => {
      if (done) return;
      done = true;
      try { session.post('Debugger.resume'); } catch { /* not paused */ }
      try { session.disconnect(); } catch { /* already gone */ }
      resolve(frames);
    };
    // Enabling the debugger names every script already loaded; a frame names
    // only its script's id.
    const scripts = new Map();
    try {
      session.connectToMainThread();
      session.on('Debugger.scriptParsed', ({ params }) => { scripts.set(params.scriptId, params.url); });
      session.on('Debugger.paused', ({ params }) => {
        finish(params.callFrames.slice(0, 12).map((frame) => {
          const url = (frame.url || scripts.get(frame.location.scriptId) || '').replace(/^file:\/\//, '');
          return `${frame.functionName || '<anonymous>'} (${url}:${frame.location.lineNumber + 1})`;
        }));
      });
      session.post('Debugger.enable', () => {
        if (done) return;
        try { session.post('Debugger.pause'); } catch (error) { finish([`<no stack: ${error.message}>`]); }
      });
      setTimeout(() => finish(['<the main thread did not pause>']), 2000);
    } catch (error) {
      finish([`<no stack: ${error.message}>`]);
    }
  });
}

let lastTick = now();
// The stall being watched: { since, test, watchdogLateMs, stack }.
let stall = null;

setInterval(async () => {
  const tick = now();
  const watchdogLateMs = ms(tick - lastTick) - BEAT_MS;
  lastTick = tick;
  const mainAgeMs = ms(tick - Atomics.load(beat, 0));

  if (!stall && mainAgeMs >= STALL_MS) {
    stall = {
      since: Atomics.load(beat, 0), test: currentTest(), watchdogLateMs, stack: null,
    };
    if (watchdogLateMs < STALL_MS / 2) stall.stack = await mainThreadStack();
    return;
  }
  if (stall && Atomics.load(beat, 0) > stall.since) {
    const heldMs = ms(Atomics.load(beat, 0) - stall.since);
    if (stall.stack) {
      report(`the main thread was busy ${heldMs} ms during "${stall.test}", at:\n    ${stall.stack.join('\n    ')}\n `);
    } else {
      report(`the whole process was held ${heldMs} ms during "${stall.test}" (this watchdog's own timer ran ${stall.watchdogLateMs} ms late)`);
    }
    stall = null;
  }
}, BEAT_MS);
