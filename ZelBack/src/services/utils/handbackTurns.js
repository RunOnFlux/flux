// Whose turn it is to hand an app back. Turns are cut from block time, and a
// turn belongs to the holder with the lowest hash of the turn number and its
// signing key: inputs every node reads the same and no holder can move.
//
// A turn is the app's, whatever the holder's reason for leaving: holders
// leaving for different reasons take turns with each other, so one turn
// releases at most one holder of an app.
//
// Free of config so the harness computes turns with this same rule.

const crypto = require('crypto');

/**
 * The turn a block time falls in.
 * @param {number} timeMs Block time, epoch ms.
 * @param {number} turnMs Length of a turn.
 * @returns {number}
 */
function turnOf(timeMs, turnMs) {
  return Math.floor(timeMs / turnMs);
}

/**
 * The holder that owns a turn: the lowest hash of the turn and its key.
 * @param {string[]} holderKeys Signing keys of the app's holders.
 * @param {number} turn
 * @returns {string|null} Null when there are no holders.
 */
function turnOwner(holderKeys, turn) {
  let owner = null;
  let lowest = null;
  holderKeys.forEach((key) => {
    const score = crypto.createHash('sha256').update(`${turn}:${key}`).digest('hex');
    if (lowest === null || score < lowest) {
      lowest = score;
      owner = key;
    }
  });
  return owner;
}

/**
 * Whether a holder has owned a whole turn strictly between two turns: one that
 * stood down in `sinceTurn` and has since had a turn of its own to leave in.
 * @param {string[]} holderKeys Signing keys of the app's holders.
 * @param {string} ownKey The holder's signing key.
 * @param {number} sinceTurn
 * @param {number} atTurn
 * @returns {boolean}
 */
function ownedTurnSince(holderKeys, ownKey, sinceTurn, atTurn) {
  for (let turn = sinceTurn + 1; turn < atTurn; turn += 1) {
    if (turnOwner(holderKeys, turn) === ownKey) return true;
  }
  return false;
}

/**
 * May this holder hand this app back on this pass, by the turn rule alone?
 *
 * The pacing half of the decision; it says nothing about safety, which the
 * give-up-an-app pass asks appEvacuationSafety separately.
 * @param {Array<{key: string, expireAt: Date}>} holders The app's holders by
 *   their signed announcements (registryManager.signedHoldersOf).
 * @param {string} ownKey This node's signing key.
 * @param {number} minInstances How many instances this app is meant to have.
 * @param {{timeMs: number, previousTimeMs: number}} pass The give-up pass
 *   asking: its due block's time, and the time of the due block of the pass
 *   before it.
 * @param {number} turnMs Length of a turn.
 * @returns {{ok: boolean, code: string, reason: string}} `code` is the
 *   machine-readable half. BELOW_INSTANCE_COUNT is the name appEvacuationSafety
 *   uses for the same fact.
 */
function mayHandBack(holders, ownKey, minInstances, pass, turnMs) {
  const holderKeys = holders.map((holder) => holder.key);
  // An app short of its count is one the spawner is part way through
  // replacing.
  if (holderKeys.length < minInstances) {
    return {
      ok: false,
      code: 'BELOW_INSTANCE_COUNT',
      reason: `app is below its instance count (${holderKeys.length}/${minInstances})`,
    };
  }
  // Exactly the count, never above it. Two holders that each fail to count the
  // other compare different sets and can both own a turn; above the count, one
  // missing holder still leaves each at strength, and both would leave. At the
  // count, a holder missing from either view leaves that view short. A spare
  // copy is the surplus trim's to remove.
  if (holderKeys.length > minInstances) {
    return {
      ok: false,
      code: 'ABOVE_INSTANCE_COUNT',
      reason: `app is above its instance count (${holderKeys.length}/${minInstances}); the surplus trim takes the spare copy first`,
    };
  }
  const own = holders.find((holder) => holder.key === ownKey);
  if (!own) {
    return { ok: false, code: 'NOT_LISTED', reason: 'no signed announcement of this node holding the app is standing, so it has no turn' };
  }
  // Another holder judging this turn late reads the records standing when it
  // reads them. One that lapses inside the turn can be gone from that holder's
  // count while this node still counts itself, and the two would compare
  // different sets.
  if (new Date(own.expireAt).getTime() <= pass.timeMs + turnMs) {
    return { ok: false, code: 'ANNOUNCEMENT_LAPSING', reason: 'this node\'s own announcement of the app lapses within a turn' };
  }
  const turn = turnOf(pass.timeMs, turnMs);
  if (turnOwner(holderKeys, turn) !== ownKey) {
    return { ok: false, code: 'AWAITING_TURN', reason: 'another holder owns this turn' };
  }
  if (turnOf(pass.previousTimeMs, turnMs) !== turn) {
    return { ok: false, code: 'AWAITING_TURN', reason: 'first pass of its turn; it acts on the next' };
  }
  return { ok: true, code: 'READY', reason: 'ready' };
}

module.exports = {
  turnOf, turnOwner, ownedTurnSince, mayHandBack,
};
