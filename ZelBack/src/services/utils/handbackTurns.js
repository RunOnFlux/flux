// Whose turn it is to hand an app back. Turns are cut from block time, and a
// turn belongs to the holder with the lowest hash of the turn number and its
// signing key: inputs every node reads the same and no holder can move.
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

module.exports = { turnOf, turnOwner };
