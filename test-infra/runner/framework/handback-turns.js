// Whose turn it is to hand an app back, by the product's own rule, so a suite
// knows when an evacuating holder will act rather than guessing a timeout.
import { createRequire } from 'node:module';
import { nodeKey } from './keys.js';

const require = createRequire(import.meta.url);
const { turnOf, turnOwner } = require('../../../ZelBack/src/services/utils/handbackTurns.js');

export { turnOf, turnOwner };

/** The signing keys of fleet nodes, 1-based, in the order given. */
export function keysOf(nodes) {
  return nodes.map((node) => nodeKey(node).pubkey);
}

/**
 * The first turn from `fromMs` on that one of `owners` owns, among `holders`.
 * @param {object} opts
 * @param {string[]} opts.holders Signing keys of the app's holders.
 * @param {string[]} opts.owners Keys whose turn is waited for.
 * @param {number} opts.turnMs
 * @param {number} opts.fromMs Block time to search from.
 * @returns {{turn: number, owner: string, startMs: number}}
 */
export function nextOwnedTurn({
  holders, owners, turnMs, fromMs,
}) {
  for (let turn = turnOf(fromMs, turnMs); ; turn += 1) {
    const owner = turnOwner(holders, turn);
    if (owners.includes(owner)) return { turn, owner, startMs: turn * turnMs };
  }
}

/**
 * How long until one of `owners` can have handed the app back: to the end of
 * the first turn from `fromMs` on that one of them owns. A holder acts on the
 * second pass of its turn, which falls inside that turn.
 * @param {object} opts See nextOwnedTurn.
 * @returns {number} Milliseconds from now.
 */
export function untilOwnedTurnEndsMs(opts) {
  const { startMs } = nextOwnedTurn(opts);
  return Math.max(0, startMs + opts.turnMs - Date.now());
}
