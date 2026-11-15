const path = require('path');
const timers = require('timers');

// Root hooks for the unit suite (mocha --require, beside databaseLeftovers.js).
//
// A file stops every timer it starts before its own after hooks finish. A timer
// left pending fires during later files, and a later file that fakes the clock
// for the whole process takes over a timer that re-arms there, so ticking that
// clock ahead fires it again and again. Counted are the timers started through
// setTimeout and setInterval, global or from 'timers': every timer our code and
// its libraries start, and the ones a fake clock replaces. Node's own timers
// (AbortSignal.timeout, the HTTP date cache, socket timeouts) are not started
// through them and are not counted. After each file's own after hooks, a timer
// it left pending is cancelled and the file named; the run fails at the end with
// every such file and where each timer was started.

const realSetTimeout = timers.setTimeout;
const realSetInterval = timers.setInterval;
const realClearTimeout = timers.clearTimeout;
const realClearInterval = timers.clearInterval;

const started = new Map(); // timer -> { file, site }
let currentFile = null;
const leftPending = [];

function startedFrom() {
  const holder = {};
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 4;
  Error.captureStackTrace(holder, startedFrom);
  Error.stackTraceLimit = stackTraceLimit;
  const frames = holder.stack.split('\n').slice(2).map((line) => line.trim().replace(/^at /, ''));
  return frames.map((frame) => frame.replace(`${process.cwd()}/`, '')).join(' <- ');
}

// The wrapper keeps the original's own properties, util.promisify.custom among them.
function counted(start) {
  function startCounted(...args) {
    const timer = start.apply(this, args);
    if (currentFile) started.set(timer, { file: currentFile, site: startedFrom() });
    return timer;
  }
  Object.defineProperties(startCounted, Object.getOwnPropertyDescriptors(start));
  return startCounted;
}

function forgetting(clear) {
  return function clearCounted(timer) {
    started.delete(timer);
    return clear.call(this, timer);
  };
}

function isPending(timer) {
  // eslint-disable-next-line no-underscore-dangle
  return !timer._destroyed && timer._idleTimeout >= 0;
}

timers.setTimeout = counted(realSetTimeout);
timers.setInterval = counted(realSetInterval);
timers.clearTimeout = forgetting(realClearTimeout);
timers.clearInterval = forgetting(realClearInterval);
global.setTimeout = timers.setTimeout;
global.setInterval = timers.setInterval;
global.clearTimeout = timers.clearTimeout;
global.clearInterval = timers.clearInterval;

function cancelWhatTheFileLeft(file) {
  started.forEach(({ file: owner, site }, timer) => {
    if (!isPending(timer)) {
      started.delete(timer);
      return;
    }
    if (owner !== file) return;
    leftPending.push(`${file}: ${site}`);
    realClearTimeout(timer);
    started.delete(timer);
  });
}

exports.mochaHooks = {
  beforeAll() {
    // The count runs as the last after hook of each file's last top-level suite.
    const firstSuiteOfFile = new Map();
    const lastSuiteOfFile = new Map();
    this.test.parent.suites.forEach((suite) => {
      if (!firstSuiteOfFile.has(suite.file)) firstSuiteOfFile.set(suite.file, suite);
      lastSuiteOfFile.set(suite.file, suite);
    });
    firstSuiteOfFile.forEach((suite, file) => suite.beforeAll(() => { currentFile = path.relative(process.cwd(), file); }));
    lastSuiteOfFile.forEach((suite, file) => suite.afterAll(() => cancelWhatTheFileLeft(path.relative(process.cwd(), file))));
  },
  afterAll() {
    if (leftPending.length) {
      throw new Error(`these files left timers pending (stop them in the file's after hooks):\n${leftPending.join('\n')}`);
    }
  },
};
