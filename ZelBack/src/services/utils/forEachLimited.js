/**
 * Runs `task` once per item, at most `limit` at a time.
 * @param {Array} items
 * @param {number} limit
 * @param {function(*): Promise<void>} task
 * @returns {Promise<void>}
 */
async function forEachLimited(items, limit, task) {
  const queue = [...items];
  async function worker() {
    while (queue.length) {
      // eslint-disable-next-line no-await-in-loop
      await task(queue.shift());
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

module.exports = { forEachLimited };
