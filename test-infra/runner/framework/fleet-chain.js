// The chain as a whole fleet sees it, for suites that move it themselves.
//
// A node runs its block-paced passes (expiry, reinstall, surplus trim) and promotes a payment
// only on a block that is still the tip when it fetches it. A block mined before every node has
// processed the one before it reaches some of them as a burst, and they skip those passes for
// every block but the last. So a suite that drives the chain with the ticker stopped mines one
// block at a time and waits for the fleet between blocks.
import { advanceBlock, getState } from './daemon-control.js';
import { dbClient } from './db-client.js';
import { waitFor } from './wait.js';

/**
 * The indices of the nodes running now: a deferred node not yet started has no client.
 * @param {object} env
 * @returns {number[]}
 */
export function liveIndices(env) {
  return env.clients.map((client, i) => (client ? i : null)).filter((i) => i !== null);
}

/**
 * Whether every node named has scanned the daemon's current height.
 * @param {object} env
 * @param {{indices?: number[]}} [options] env.clients indices; every running node by default
 * @returns {Promise<boolean>}
 */
export async function fleetAtTip(env, { indices = liveIndices(env) } = {}) {
  const { currentHeight } = await getState();
  const heights = await Promise.all(indices.map((i) => dbClient(i + 1).explorerHeight()));
  return heights.every((h) => h >= currentHeight);
}

/**
 * Mines one block and waits until every node named has processed it.
 * @param {object} env
 * @param {{indices?: number[], label?: string}} [options]
 */
export async function mineFleetBlock(env, { indices = liveIndices(env), label = 'a block' } = {}) {
  await advanceBlock();
  await waitFor(() => fleetAtTip(env, { indices }), { timeout: 150000, interval: 1000, label: `every node processes the block (${label})` });
}

/**
 * Mines one block at a time, each once every node named has processed the one before, until the
 * condition holds. Budgeted in blocks, or in time for a wait on a timer.
 * @param {object} env
 * @param {() => Promise<boolean>} condition
 * @param {{blocks?: number, timeoutMs?: number, indices?: number[], label: string}} options
 */
export async function driveFleetUntil(env, condition, {
  blocks = Infinity, timeoutMs = Infinity, indices = liveIndices(env), label,
}) {
  const deadline = Date.now() + timeoutMs;
  for (let mined = 0; mined < blocks && Date.now() < deadline; mined += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await condition()) return;
    // eslint-disable-next-line no-await-in-loop
    await mineFleetBlock(env, { indices, label });
  }
  if (!await condition()) throw new Error(`${label}: not reached within ${blocks} blocks / ${timeoutMs} ms`);
}

/**
 * Whether every node named holds a submitted message in its temporary store.
 * @param {object} env
 * @param {string} hash the message hash
 * @param {{indices?: number[]}} [options]
 * @returns {Promise<boolean>}
 */
export async function relayedToFleet(env, hash, { indices = liveIndices(env) } = {}) {
  const held = await Promise.all(indices.map(async (i) => (await env.clients[i].getTempMessages(hash)).data?.length > 0));
  return held.every(Boolean);
}
