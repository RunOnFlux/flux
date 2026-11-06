// Harness knobs that only mean anything RELATIVE to another knob.
//
// A compressed harness is a set of ratios, not a set of numbers. Compress two
// coupled knobs by different factors and the property between them does not get
// faster - it inverts, and the suite that was written to prove it goes green
// while proving the opposite.
//
// The give-up pass is a function of explorerPollIntervalMs - a block costs one
// poll - so a knob written against "the pass" as a literal stops tracking it the
// moment the poll moves.
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
  residentialTurnMs: 60 * 60 * 1000,
  locationTtlS: 7500,
  sigtermExpiryS: 420,
  // The peer-flap DOS: how far back the tally looks, and how often the sweep
  // that releases it runs. One decision at two scales - a suite that shortens
  // the window without shortening the tick is measuring the tick.
  peerSetDipWindowMinutes: 120,
  peerSetDipEvaluateMs: 60 * 1000,
  // How many consecutive missed pongs kill a socket, and how often the ping that
  // can miss goes out. Only the product of the two means anything.
  wsMaxMissedPongs: 3,
  wsPingIntervalMs: 15000,
  // The g: election's cycle, and the per-place wait a standby serves before it
  // may take a primary FDM names nobody for.
  masterSlaveIntervalMs: 30000,
  masterSlaveStaggerMs: 180000,
});

/**
 * The location expiries of a fleet whose node is judged across its own restart:
 * production's. The harness does not compress a restart, and a node measures its
 * downtime across one, so under the shared compressed windows a restart on a
 * loaded box outlasts them and the node's own location rows have expired when
 * its boot reads them. A fleet whose apps must survive a restart, or whose node
 * must expire its locations exactly when a real node would, runs on these.
 */
export const PRODUCTION_LOCATION_EXPIRIES = Object.freeze({
  sigtermExpiryS: PRODUCTION.sigtermExpiryS,
  locationTtlS: PRODUCTION.locationTtlS,
});

/**
 * How many election passes one place of stagger spans in production. A standby
 * reads the order and the peers it probes once a pass, so a stagger of fewer
 * passes than this gives it fewer looks at the candidate ahead than production
 * gives it before its turn comes.
 * @returns {number}
 */
export function staggerPassesPerPlace() {
  return PRODUCTION.masterSlaveStaggerMs / PRODUCTION.masterSlaveIntervalMs;
}

/**
 * Refuse a fleet whose stagger spans fewer election passes than production's.
 * @param {object} fluxapps Effective fluxapps config for the fleet.
 * @throws {Error} When one place of stagger is fewer passes than production's.
 */
export function assertStaggerSpansElectionPasses(fluxapps) {
  const stagger = fluxapps.masterSlaveStaggerMs;
  const pass = fluxapps.masterSlaveIntervalMs;
  if (typeof stagger !== 'number' || typeof pass !== 'number') return;
  const required = staggerPassesPerPlace();
  if (stagger / pass >= required) return;
  throw new Error(
    'coupled-knobs: masterSlaveStaggerMs spans too few election passes.\n'
    + `  stagger ${stagger}ms, election pass ${pass}ms  -> ${(stagger / pass).toFixed(1)} passes\n`
    + `  needed  ${required} passes, production's ${PRODUCTION.masterSlaveStaggerMs}ms over ${PRODUCTION.masterSlaveIntervalMs}ms\n`
    + '  A standby looks at the candidate ahead of it once a pass; below this it takes the\n'
    + '  primary having looked fewer times than production does.',
  );
}

/**
 * How long before a node notices a peer that was UNPLUGGED rather than
 * disconnected - the wait behind every DEGRADED and every partition.
 *
 * A missed pong per interval, dead after wsMaxMissedPongs of them, plus up to one
 * more interval because the ping timer is not aligned to the moment the peer
 * vanished. Held here rather than in a suite because it is the same derivation
 * for all of them, and a suite computing it from the SHARED config while running
 * its own override silently budgets for a fleet it is not on.
 *
 * BOTH values are required and there is NO production fallback, deliberately.
 * Production's pair gives 15000 * (3+1) = 60s; the shared harness fleet gives
 * 2000 * (2+1) = 6s. So a production default is not a safe approximation here,
 * it is wrong by ten times - and wrong in the direction that never fails, since
 * an over-long budget only makes the wait more tolerant. A caller that omits
 * either half has made a mistake, and this is the only place it can be seen.
 * @param {object} peers The EFFECTIVE peers config - the suite's override if it
 *   has one, otherwise the shared fleet's.
 * @returns {number} Milliseconds.
 */
export function peerDeathMs(peers) {
  const interval = peers?.wsPingIntervalMs;
  const misses = peers?.wsMaxMissedPongs;
  if (typeof interval !== 'number' || typeof misses !== 'number') {
    throw new Error(
      'peerDeathMs needs both wsPingIntervalMs and wsMaxMissedPongs from the '
      + `EFFECTIVE peers config, got ${JSON.stringify(peers)} - pass the suite's `
      + 'override if it has one, else loadSharedConfig().peers.',
    );
  }
  return interval * (misses + 1);
}

/**
 * The peers config for a suite that PARTITIONS.
 *
 * partitionGroups returns only once the cross-group sockets are gone, and that
 * wait is peer liveness: wsPingIntervalMs x wsMaxMissedPongs. The shared fleet
 * config compresses BOTH halves - 2000ms and 2 misses - because most suites want
 * a dead peer noticed in ~4s rather than production's ~45s.
 *
 * A partitioning suite wants the opposite of fast on the MISS COUNT. Three
 * consecutive misses is a far safer signal on a loaded box than one slow round
 * trip, which is production's reason for 3; at two, a node that stalls for two
 * ping periods under parallel-gate load has its peers declared dead and the
 * suite measures the stall instead of the partition.
 *
 * Stated as a PAIR because overriding only the interval silently keeps the
 * shared 2 - the suite reads as "I left the miss count at production's 3" while
 * running at two thirds of the margin it asked for. That is what five suites did.
 */
export const PARTITION_PEERS = Object.freeze({
  wsPingIntervalMs: 3000,
  wsMaxMissedPongs: PRODUCTION.wsMaxMissedPongs,
});

/**
 * How many sweeps fit in one window. Production's ratio, which a compressed
 * fleet has to keep.
 * @returns {number}
 */
export function peerSetSweepsPerWindow() {
  return (PRODUCTION.peerSetDipWindowMinutes * 60 * 1000) / PRODUCTION.peerSetDipEvaluateMs;
}

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
 * How many give-up passes one handback turn spans in production.
 *
 * A holder acts only on the second pass of a turn it owns, so a turn holding
 * fewer than two is lost to its owner; production's margin over two is what the
 * fleet has been reasoned about, so the harness matches it.
 * @returns {number}
 */
export function productionTurnRatio() {
  const pass = giveUpPassMs(PRODUCTION, PRODUCTION.blockMs);
  return PRODUCTION.residentialTurnMs / pass;
}

// WHAT A DEPARTURE COSTS between the holder committing to it and the other
// holders being able to see it: stopping the container, removing the app, and
// the announcement reaching them. Named for the honest case - an image that
// HANDLES SIGTERM and exits on it - because that is the only case a fleet may
// be sized against. Measured at ~430ms of removal and announcement on chud
// (2026-09-06); carried at 1500 so the bound is not sitting on the measurement.
//
// An image that ignores the signal does not cost a little more, it costs
// docker's whole stop grace - ten seconds by default, and unavoidably so for a
// PID 1 with no handler, since Linux discards unhandled signals there. That is
// not a number to widen this constant to. It is an image to replace.
export const DEPARTURE_ANNOUNCE_MS = 1500;

// appConstants.js: a node announces ANNOUNCES_PER_EXPIRY times per location
// lifetime, less ANNOUNCE_SLACK. Held here for the same reason PRODUCTION is;
// tests/unit/coupledKnobs.test.js pins them to the product's.
export const ANNOUNCES_PER_EXPIRY = 2;
export const ANNOUNCE_SLACK = 0.04;

/**
 * How long a holder's announcement still has to run at the moment it is renewed.
 * @param {number} locationTtlS
 * @returns {number} Milliseconds.
 */
export function announcementLeftAtRenewalMs(locationTtlS) {
  const expiryMs = locationTtlS * 1000;
  const intervalMs = Math.floor((expiryMs * (1 - ANNOUNCE_SLACK)) / ANNOUNCES_PER_EXPIRY / 1000) * 1000;
  return expiryMs - intervalMs;
}

/**
 * The handback turn a suite should use, derived rather than chosen: production's
 * passes per turn at this fleet's pass.
 * @param {{removeFluxAppsPeriod: number, explorerPollIntervalMs: number}} fluxapps
 * @returns {number} residentialTurnMs, in milliseconds.
 */
export function derivedTurnMs(fluxapps) {
  const pass = giveUpPassMs(fluxapps, harnessBlockCostMs(fluxapps));
  return Math.ceil((pass * productionTurnRatio()) / 1000) * 1000;
}

/**
 * Refuse a fleet whose turn does not hold production's passes, whose pass does
 * not outlast a departure's announcement, or whose holders' announcements do not
 * outlast a turn.
 *
 *   turn / pass >= production's      a turn holds its owner's second pass
 *   pass > DEPARTURE_ANNOUNCE_MS     one pass separates two holders acting, so a
 *                                    departure is visible before the next decides
 *   turn < announcement left at renewal
 *                                    a holder refuses a turn its own announcement
 *                                    lapses inside, so at or above this no holder
 *                                    ever acts
 * @param {object} fluxapps Effective fluxapps config for the fleet.
 * @throws {Error} When any of the three does not hold.
 */
export function assertTurnPacing(fluxapps) {
  const turn = fluxapps.residentialTurnMs;
  if (!turn) return;
  const blockCost = harnessBlockCostMs(fluxapps);
  const pass = giveUpPassMs(fluxapps, blockCost);
  const required = productionTurnRatio();
  if (turn / pass < required) {
    throw new Error(
      'coupled-knobs: residentialTurnMs holds too few give-up passes.\n'
      + `  pass    ${Math.round(pass)}ms  (removeFluxAppsPeriod ${fluxapps.removeFluxAppsPeriod}`
      + ` x ${PON_SPEED_MULTIPLIER} blocks, each costing ${Math.round(blockCost)}ms`
      + ` at explorerPollIntervalMs ${fluxapps.explorerPollIntervalMs})\n`
      + `  turn    ${turn}ms  -> ${(turn / pass).toFixed(2)} passes\n`
      + `  needed  ${Math.round(pass * required)}ms  -> production's ${required.toFixed(2)} passes\n`
      + '  A holder acts only on the second pass of its turn. Use derivedTurnMs(fluxapps).',
    );
  }
  if (pass <= DEPARTURE_ANNOUNCE_MS) {
    throw new Error(
      'coupled-knobs: a departure cannot be announced before the next holder decides.\n'
      + `  pass    ${Math.round(pass)}ms, a departure costs ${DEPARTURE_ANNOUNCE_MS}ms to become visible\n`
      + '  One pass separates two holders acting. Raise removeFluxAppsPeriod.\n'
      + '  If the pacing already clears this and two holders still depart together, the cost\n'
      + '  is in the IMAGE: a container that ignores SIGTERM pays docker\'s full stop grace\n'
      + '  (ten seconds, and always, for a PID 1 with no handler) instead of the value above.\n'
      + '  Seed it with pushTestApp, which installs a handler, rather than pushImage.',
    );
  }
  const ttlS = fluxapps.locationTtlS ?? PRODUCTION.locationTtlS;
  const left = announcementLeftAtRenewalMs(ttlS);
  if (turn >= left) {
    throw new Error(
      'coupled-knobs: residentialTurnMs outlasts a renewed announcement.\n'
      + `  turn    ${turn}ms, announcement left at renewal ${left}ms (locationTtlS ${ttlS})\n`
      + '  A holder refuses a turn its own announcement lapses inside, so no holder would act.',
    );
  }
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
 * Every coupled-knob rule this harness enforces, in one call.
 * @param {object} fluxapps Effective fluxapps config for the fleet.
 * @throws {Error} When any relationship does not hold.
 */
export function assertCoupledRatios(fluxapps) {
  if (!fluxapps) return;
  assertSigtermOrdering(fluxapps);
  assertStaggerSpansElectionPasses(fluxapps);
  assertTurnPacing(fluxapps);
}
