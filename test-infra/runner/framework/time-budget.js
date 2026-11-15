// A test's time budget, counted from now.
//
// Mocha holds a test to its timeout twice: a watchdog that fires that long after
// the timeout was last set, and a check when the test finishes that its WHOLE
// duration is within it. `this.timeout(waitMs + slack)` part way through a test
// passes the first and can fail the second: a test that has already spent
// minutes reaching that line fails as a timeout the moment it succeeds.
//
// allowFromNow sets the timeout to the time the test has already taken plus the
// budget, which satisfies both. The watchdog is then that much later than the
// budget alone, which is the only form mocha offers; a wait that needs a tight
// bound carries its own (driveUntil's timeoutMs, waitFor's timeout).
import { beforeEach } from 'mocha';

const startedAt = new WeakMap();

// A root hook in every suite file that imports this module.
beforeEach(function noteTestStart() {
  startedAt.set(this.currentTest, Date.now());
});

/**
 * Let the running test take `ms` more from now, however long it has already run.
 * @param {object} ctx The test's mocha context (`this` inside `it`).
 * @param {number} ms Milliseconds from now.
 * @returns {void}
 */
export function allowFromNow(ctx, ms) {
  const started = startedAt.get(ctx.test);
  if (started === undefined) {
    throw new Error('allowFromNow: no start recorded for this test; call it from inside an it() in a suite that imports time-budget.js');
  }
  ctx.timeout((Date.now() - started) + ms);
}
