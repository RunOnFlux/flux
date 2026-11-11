const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');

// A rule that counts what happened to this node over a window of blocks and
// holds the node for a number of blocks. Counted in blocks, every window and hold
// is the chain's: neither a restart nor the node's clock moves it.
//
// A rule's state is stored by the rule, and judged at the chain's height: on
// every change the rule makes, and at every height the daemon reports. An event
// recorded, or a hold started, while no height is known has a null height, and
// is given the first height known. A hold is `{ fromHeight, blocks }` and stands
// while no height is known, or none was when it started.

/**
 * @param {Array<number|null>} heights
 * @param {number} height The chain's height now; 0 when unknown.
 * @param {number} windowBlocks
 * @returns {Array<number|null>} The heights inside the window. A null height is
 * taken as `height`, and is kept as null while no height is known.
 */
function inWindow(heights, height, windowBlocks) {
  if (!height) return heights;
  return heights.map((at) => at ?? height).filter((at) => height - at < windowBlocks);
}

/**
 * @param {{fromHeight: number|null, blocks: number}|null} hold
 * @param {number} height The chain's height now; 0 when unknown.
 * @returns {boolean} Whether the hold has run its course at `height`.
 */
function holdEnded(hold, height) {
  return Boolean(hold) && hold.fromHeight !== null && height > 0 && height - hold.fromHeight >= hold.blocks;
}

/**
 * @param {{fromHeight: number|null, blocks: number}|null} hold
 * @param {number} height The chain's height now; 0 when unknown.
 * @returns {{fromHeight: number|null, blocks: number}|null} The hold with a
 * known start, or null once it has run its course.
 */
function judgeHold(hold, height) {
  if (!hold) return null;
  const started = hold.fromHeight === null && height ? { ...hold, fromHeight: height } : hold;
  return holdEnded(started, height) ? null : started;
}

/**
 * @param {{fromHeight: number|null, blocks: number}} hold
 * @returns {string} When the hold ends, for an operator.
 */
function untilText(hold) {
  return hold.fromHeight === null ? 'a chain height is known' : `block ${hold.fromHeight + hold.blocks}`;
}

/**
 * One rule's passes. Each pass reads the stored state, makes the change it was
 * asked for, judges the result at the chain's height, stores it and holds the
 * node by it. Passes run one after another in the order asked. A store that
 * finds the stored state changed since it was read reads it again.
 * @param {object} rule
 * @param {function(): Promise<object>} rule.load The stored state.
 * @param {function(object, object): Promise<boolean>} rule.save Stores the second
 *   state in place of the first; false when the stored state is no longer the first.
 * @param {function(object, number): object} rule.judge The state at a height (0 when unknown).
 * @param {function(object): void} rule.apply Holds the node as the state says.
 * @returns {{pass: function(function(object, number): object=): Promise<object>, watch: function(function(Error): void): function(): void}}
 */
function blockWindowRule({
  load, save, judge, apply,
}) {
  let passes = Promise.resolve();

  async function passOnce(change) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const height = daemonServiceMiscRpcs.chainHeight();
      // eslint-disable-next-line no-await-in-loop
      const before = await load();
      const after = judge(change ? change(structuredClone(before), height) : structuredClone(before), height);
      // eslint-disable-next-line no-await-in-loop
      if (await save(before, after)) {
        apply(after);
        return after;
      }
    }
    throw new Error('the stored state changed under every pass');
  }

  /**
   * Runs one pass after every pass asked for before it.
   * @param {function(object, number): object} [change] Called with a copy of the
   *   stored state and the chain's height; returns the state to judge.
   * @returns {Promise<object>} The state the pass stored.
   */
  function pass(change) {
    const run = passes.then(() => passOnce(change));
    passes = run.catch(() => {});
    return run;
  }

  /**
   * Runs a pass now and at every height the daemon reports.
   * @param {function(Error): void} onError Told of a pass that failed.
   * @returns {function(): void} Stops the passes at new heights.
   */
  function watch(onError) {
    const judgeNow = () => pass().catch(onError);
    const stop = daemonServiceMiscRpcs.onDaemonHeight(judgeNow);
    judgeNow();
    return stop;
  }

  return { pass, watch };
}

module.exports = {
  blockWindowRule,
  holdEnded,
  inWindow,
  judgeHold,
  untilText,
};
