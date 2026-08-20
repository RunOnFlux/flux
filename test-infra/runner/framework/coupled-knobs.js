// Harness knobs that only mean anything RELATIVE to another knob.
//
// A compressed harness is a set of ratios, not a set of numbers. Compress two
// coupled knobs by different factors and the property between them does not get
// faster - it inverts, and the suite that was written to prove it goes green
// while proving the opposite.
//
// That is not hypothetical here. residentialQueueStepMs was set to 15s against
// a pass the comment beside it called "about 4s", giving an apparent 3.75x
// margin. The pass is a function of explorerPollIntervalMs - a block costs one
// poll - and when that moved 250ms -> 833ms the pass moved with it to ~16s.
// Nothing re-derived the step, so the harness ended up at 0.94x, BELOW one,
// while production sits at 1.8x. Two nodes then matured on the same pass and
// both handed the same app back - the exact defect production's own 15-minute
// step had, which was a merge blocker on this branch.
//
// So the numbers below are derived from production's ratios and checked at
// fleet boot, for every suite, against whatever that suite overrode.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED_PATH = path.join(HERE, '../../config/shared.js');

/**
 * config/shared.js is CJS text inside a package declaring "type": "module", so
 * it can be neither imported nor required - it is evaluated.
 * @returns {object} The shared harness config.
 */
export function loadSharedConfig() {
  const sandbox = { module: { exports: {} }, exports: null };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(fs.readFileSync(SHARED_PATH, 'utf8'), sandbox);
  return sandbox.module.exports;
}

// Production's side of every ratio here. Held as constants rather than read
// from ZelBack/config/default.js because that file requires the gitignored
// config/userconfig.js; tests/unit/coupledKnobs.test.js asserts they still
// match the fleet's, so drift fails a test rather than silently weakening the
// check.
export const PRODUCTION = Object.freeze({
  blockMs: 30000, // post-PON; stated in-repo at fluxService.js:1774
  removeFluxAppsPeriod: 11,
  residentialQueueBaseMs: 30 * 60 * 1000,
  residentialQueueStepMs: 40 * 60 * 1000,
});

// explorerService.js:610. Applies to both sides, so it cancels out of the
// ratio - named anyway, because the pass interval is not readable without it.
export const PON_SPEED_MULTIPLIER = 4;

// A block costs at least one poll, and in practice more: processing, the
// database write and the maintenance hung off it all land between polls.
// Measured on cindy 2026-08-20 at explorerPollIntervalMs 833 - modelled pass
// 13.3s, observed 15.9s over nine consecutive give-up passes. Applied so the
// model is not optimistic, because optimism here derives a step that is too
// SHORT, which is the direction that loses the property.
export const BLOCK_COST_OVERHEAD = 1.2;

/**
 * How long between two runs of the give-up pass.
 *
 * The pass runs every removeFluxAppsPeriod * PON_SPEED_MULTIPLIER blocks. What a
 * block COSTS is the only part that differs between production and the harness:
 * production waits out a real 30s block, the harness drives its own and pays one
 * explorer poll for each.
 * @param {{removeFluxAppsPeriod: number}} fluxapps Effective app config.
 * @param {number} blockCostMs What one block costs to reach and process.
 * @returns {number} Milliseconds between passes.
 */
export function giveUpPassMs(fluxapps, blockCostMs) {
  return fluxapps.removeFluxAppsPeriod * PON_SPEED_MULTIPLIER * blockCostMs;
}

/** What one block costs the harness: a poll, plus what processing adds. */
export function harnessBlockCostMs(fluxapps) {
  return fluxapps.explorerPollIntervalMs * BLOCK_COST_OVERHEAD;
}

/**
 * The ratio the queue step has to hold against the pass, taken from production.
 *
 * Above 1 is the property; production's specific margin is what the fleet has
 * been reasoned about, so the harness matches it rather than merely clearing 1.
 * @returns {number}
 */
export function productionQueueRatio() {
  const pass = giveUpPassMs(PRODUCTION, PRODUCTION.blockMs);
  return PRODUCTION.residentialQueueStepMs / pass;
}

/**
 * The queue step a suite should use, derived rather than chosen.
 *
 * Call this instead of writing a number: it moves when explorerPollIntervalMs
 * or removeFluxAppsPeriod moves, which is the whole failure this file exists
 * for.
 * @param {{removeFluxAppsPeriod: number, explorerPollIntervalMs: number}} fluxapps
 * @returns {number} residentialQueueStepMs, in milliseconds.
 */
export function derivedQueueStepMs(fluxapps) {
  const pass = giveUpPassMs(fluxapps, harnessBlockCostMs(fluxapps));
  return Math.ceil((pass * productionQueueRatio()) / 1000) * 1000;
}

/**
 * Refuse to boot a fleet whose coupled knobs do not hold production's ratios.
 *
 * Runs on the EFFECTIVE config - shared.js plus whatever the suite overrode -
 * because the override is where this went wrong, not the shared file. Throws
 * rather than warning: a fleet configured this way produces a green suite that
 * has stopped testing its property, which is worse than no run.
 *
 * Over production's ratio is fine and is not flagged. A suite may deliberately
 * leave a knob uncompressed, and a step longer than it needs only costs time.
 * UNDER is the failure, because that is where the property inverts.
 * @param {object} fluxapps Effective fluxapps config for the fleet.
 * @throws {Error} When a ratio is below production's.
 */
export function assertCoupledRatios(fluxapps) {
  if (!fluxapps || !fluxapps.residentialQueueStepMs) return;
  const blockCost = harnessBlockCostMs(fluxapps);
  const pass = giveUpPassMs(fluxapps, blockCost);
  const ratio = fluxapps.residentialQueueStepMs / pass;
  const required = productionQueueRatio();
  if (ratio >= required) return;
  throw new Error(
    'coupled-knobs: residentialQueueStepMs is too short for this fleet\'s give-up pass.\n'
    + `  pass    ${Math.round(pass)}ms  (removeFluxAppsPeriod ${fluxapps.removeFluxAppsPeriod}`
    + ` x ${PON_SPEED_MULTIPLIER} blocks, each costing ${Math.round(blockCost)}ms`
    + ` at explorerPollIntervalMs ${fluxapps.explorerPollIntervalMs})\n`
    + `  step    ${fluxapps.residentialQueueStepMs}ms  -> ratio ${ratio.toFixed(2)}\n`
    + `  needed  ${Math.round(pass * required)}ms  -> production's ratio ${required.toFixed(2)}\n`
    + '  Two holders of one app mature on the same pass at this ratio and both hand it\n'
    + '  back. Use derivedQueueStepMs(fluxapps) rather than a literal.',
  );
}
