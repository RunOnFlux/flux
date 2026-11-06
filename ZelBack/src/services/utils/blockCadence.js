/**
 * When work paced by the chain is due: a job that runs every `period` blocks runs once for each
 * multiple of `period` the chain passes, on the first block it is asked about at or past that
 * multiple. Blocks the node processes back to back while catching up are not asked about, so a
 * multiple passed during a catch-up is run once, on the block that reaches the tip - never lost,
 * and never run once for each block of the burst.
 *
 * A job asked about for the first time counts from the first block this node processed, so the
 * multiples passed while it was catching up after a start are run once too.
 */
class BlockCadence {
  /** @type {Map<string, number>} the height each job was last asked about at */
  #askedAt = new Map();

  /** @type {number|null} */
  #firstProcessed = null;

  /**
   * Records a processed block. The first one fixes where every job's count starts.
   * @param {number} height
   */
  processed(height) {
    if (this.#firstProcessed === null) this.#firstProcessed = height;
  }

  /**
   * Whether `job` is due at this block, and records that it was asked.
   * @param {string} job
   * @param {number} height the block being processed at the tip
   * @param {number} period blocks between runs
   * @returns {boolean}
   */
  due(job, height, period) {
    const since = this.#askedAt.get(job) ?? (this.#firstProcessed ?? height) - 1;
    this.#askedAt.set(job, height);
    return Math.floor(height / period) > Math.floor(since / period);
  }
}

module.exports = { BlockCadence };
