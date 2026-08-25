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
  locationTtlS: 7500,
  sigtermExpiryS: 420,
});

// What one node boot costs, measured: a suite-19 fixture pinning 300s of
// downtime was read by the node as 316s, on cindy under a MAXN=6 gate - so this
// is a loaded figure, not an idle-box one. Any window a fixture has to be
// measured INSIDE must clear it with room, because the boot lands in the middle
// of the measurement and no ratio shrinks it.
export const BOOT_DRIFT_MS = 16000;

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
// How many queue steps a ticket tolerates going unobserved before it starts
// again. Mirrors MAX_TICKET_GAP_MS in residentialNodeDosService: a gap has to
// mean a pass was MISSED, and one step is only 1.82 passes - so at one step a
// single late pass restarts the ticket. Production hardly notices; the harness
// compresses the same ratio to about 30 seconds, where six fleets booting at
// once make a late pass ordinary, and the ticket then never matures at all.
// Absolute jitter does not compress with the clocks.
export const TICKET_GAP_STEPS = 2;

export function derivedQueueStepMs(fluxapps) {
  const pass = giveUpPassMs(fluxapps, harnessBlockCostMs(fluxapps));
  return Math.ceil((pass * productionQueueRatio()) / 1000) * 1000;
}

/**
 * The departure interval a suite should use, derived rather than chosen.
 *
 * A node inside its departure interval records nothing against its queue
 * tickets, so the block has to read afterwards as a gap the ticket will not
 * carry across - otherwise a departure stops restarting the queue and position
 * separates the first departure and nothing after it. Bounded by what it must
 * OUTLIVE rather than by production's ratio, the same way the boot-drift rule
 * below is: the ticket's tolerance is MAX_TICKET_GAP_MS, which IS the queue
 * step. One extra pass on top, so the restart cannot land ambiguously on the
 * pass grid.
 * @param {{removeFluxAppsPeriod: number, explorerPollIntervalMs: number, residentialQueueStepMs: number}} fluxapps
 * @returns {number} residentialEvacuationIntervalMs, in milliseconds.
 */
export function derivedEvacuationIntervalMs(fluxapps) {
  const pass = giveUpPassMs(fluxapps, harnessBlockCostMs(fluxapps));
  const step = fluxapps.residentialQueueStepMs ?? derivedQueueStepMs(fluxapps);
  return Math.ceil(((step * TICKET_GAP_STEPS) + pass) / 1000) * 1000;
}

/**
 * How long ONE departure takes end to end, for a suite that has to wait for it.
 *
 * A departure is not just the removal. The node serves its departure interval,
 * and then serves its queue ticket AGAIN from scratch - the interval reads as a
 * gap and restarts it, which is the point of the interval - and the ticket is
 * base plus position times step, the worst position being one short of the
 * instance count.
 *
 * Derived because it MOVED. Suite 55's waits were four minutes against a
 * four-second interval; the interval is now tens of seconds, and a hand-typed
 * four minutes quietly stopped covering a single departure. A wait is as coupled
 * to the pacing as the step is to the pass, and belongs here for the same reason.
 * @param {object} fluxapps Effective fluxapps config for the fleet.
 * @param {number} instances How many instances the app under test carries.
 * @returns {number} Milliseconds one departure can take, at the worst position.
 */
export function departureCycleMs(fluxapps, instances) {
  const step = fluxapps.residentialQueueStepMs ?? derivedQueueStepMs(fluxapps);
  const base = fluxapps.residentialQueueBaseMs ?? PRODUCTION.residentialQueueBaseMs;
  const interval = fluxapps.residentialEvacuationIntervalMs ?? derivedEvacuationIntervalMs(fluxapps);
  return interval + base + (Math.max(instances - 1, 0) * step);
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
export function assertSigtermOrdering(fluxapps) {
  const sigtermMs = (fluxapps.sigtermExpiryS ?? PRODUCTION.sigtermExpiryS) * 1000;
  const runningMs = (fluxapps.locationTtlS ?? PRODUCTION.locationTtlS) * 1000;

  // appStartupManager: (cleanShutdown && downtime > sigterm) || downtime >
  // running. Above the running expiry this window is unreachable and a clean
  // shutdown gets no grace, which is the opposite of what it is for. Production
  // holds 420s under 7500s.
  if (sigtermMs >= runningMs) {
    throw new Error(
      'coupled-knobs: sigtermExpiryS is not below locationTtlS.\n'
      + `  sigterm ${sigtermMs}ms, running ${runningMs}ms\n`
      + '  appStartupManager expires on (cleanShutdown && downtime > sigterm) || downtime >\n'
      + '  running, so at this ordering the running expiry fires first and the clean-shutdown\n'
      + '  grace can never be reached.',
    );
  }

  // A fixture asserting "within the window" is measured across a node boot, and
  // the boot lands inside the measurement. A window at or under the drift can
  // never be tested from the inside, whatever the fixture pins.
  if (sigtermMs <= BOOT_DRIFT_MS) {
    throw new Error(
      'coupled-knobs: sigtermExpiryS is at or below one node boot.\n'
      + `  sigterm ${sigtermMs}ms, measured boot drift ${BOOT_DRIFT_MS}ms\n`
      + '  A fixture pinning any downtime is read by the node as that downtime PLUS a boot,\n'
      + '  so nothing can land inside this window. It is bounded by what it must outlive,\n'
      + '  not by production\'s ratio - a boot is not a compressed clock.',
    );
  }
}

/**
 * Refuse to boot a fleet whose departure interval is shorter than the gap its
 * queue tickets tolerate.
 *
 * mayEvacuateApp records nothing while the interval gate is refusing, so the
 * block is meant to read afterwards as one long gap and restart every ticket.
 * That is what keeps position binding on the SECOND departure and every one
 * after it. Compress the interval below the step and the block stops looking
 * like a gap: tickets carry straight across it, every app is instantly ready
 * the moment the block clears, and two holders whose blocks expire in the same
 * pass hand back the same app together - the same defect a too-short step
 * causes, through the other door, and just as invisible to a green suite.
 *
 * Production holds 6h against a 40min step, ~9x. The bound here is 1x plus a
 * pass, because this pair is fixed by what it must outlive rather than by a
 * ratio anyone reasoned about.
 * @param {object} fluxapps Effective fluxapps config for the fleet.
 * @throws {Error} When the interval does not outlive the ticket gap.
 */
export function assertDepartureOutlivesTicket(fluxapps) {
  const interval = fluxapps.residentialEvacuationIntervalMs;
  if (!interval) return;
  const required = derivedEvacuationIntervalMs(fluxapps);
  if (interval >= required) return;
  throw new Error(
    'coupled-knobs: residentialEvacuationIntervalMs does not outlive the queue ticket.\n'
    + `  interval ${interval}ms\n`
    + `  step     ${fluxapps.residentialQueueStepMs}ms  x ${TICKET_GAP_STEPS} = the ticket's gap tolerance\n`
    + `  needed   ${required}ms  -> that tolerance plus one give-up pass\n`
    + '  Below this a departure no longer restarts the other holders\' tickets, so position\n'
    + '  separates the first departure and nothing after it. Use\n'
    + '  derivedEvacuationIntervalMs(fluxapps) rather than a literal.',
  );
}

/**
 * Every coupled-knob rule this harness enforces, in one call.
 * @param {object} fluxapps Effective fluxapps config for the fleet.
 * @throws {Error} When any relationship does not hold.
 */
export function assertCoupledRatios(fluxapps) {
  if (!fluxapps) return;
  assertSigtermOrdering(fluxapps);
  if (!fluxapps.residentialQueueStepMs) return;
  assertDepartureOutlivesTicket(fluxapps);
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
