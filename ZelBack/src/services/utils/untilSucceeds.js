const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

// How long a boot step waits before it runs again after a failure.
const BOOT_STEP_RETRY_MS = 15 * 1000;

/**
 * Runs `step` until it succeeds, waiting BOOT_STEP_RETRY_MS after each
 * failure. Boot holds at a database step that fails rather than starting again
 * from the top, so nothing boot already started runs twice.
 * @param {string} what Names the step in the log.
 * @param {function(): Promise<*>} step
 * @returns {Promise<*>} What the step resolved.
 */
async function untilSucceeds(what, step) {
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await step();
    } catch (error) {
      log.error(`${what} failed, running it again in ${BOOT_STEP_RETRY_MS / 1000}s: ${error.message}`);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(BOOT_STEP_RETRY_MS);
    }
  }
}

module.exports = { untilSucceeds, BOOT_STEP_RETRY_MS };
