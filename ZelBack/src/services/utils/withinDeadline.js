/** What withinDeadline answers when the deadline passed first. */
const TIMED_OUT = 'timedOut';

/**
 * What `work` resolved, or TIMED_OUT once `ms` pass. The work itself keeps
 * running: this only stops the caller waiting for it.
 * @param {Promise<*>} work
 * @param {number} ms
 * @returns {Promise<*>}
 */
async function withinDeadline(work, ms) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, ms, TIMED_OUT); });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  TIMED_OUT,
  withinDeadline,
};
