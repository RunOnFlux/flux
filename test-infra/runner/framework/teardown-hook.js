import { after } from 'mocha';

/**
 * Registers a suite's teardown as its `after` hook, with no time limit of its own. Teardown is
 * cleanup rather than a test: how long it takes depends on the box, never on what the suite
 * checks, so it does not fail a suite whose tests passed. A teardown that hangs is ended by the
 * suite's own wall-clock limit (run-all.sh, E2E_SUITE_WALL_SEC).
 * @param {function(): Promise<void>} work the suite's cleanup, env.teardown() included; called
 *   with the hook's `this`
 */
export function afterTeardown(work) {
  after(async function () {
    this.timeout(0);
    await work.call(this);
  });
}
