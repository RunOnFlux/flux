// A node on a residential connection is only fit to serve the network when it
// runs ArcaneOS. This service moves such a node off the network in three stages:
//
//   HOLD   it stops accepting NEW apps. Immediate, and it deletes nothing.
//   EVACUATE  it gives up one app at a time, and only ones another host
//          demonstrably holds. Each departure leaves the app one short, the
//          spawner replaces it on a node that is not held, and that is what
//          releases the next holder. The removing is done by the single
//          give-up-an-app pass in advancedWorkflows; this service owns only the
//          policy and the pacing.
//   DOS    once the node runs nothing, the sticky DOS goes on. By then
//          removeAllAppsLocally has nothing to find.
//
// DOS >= 100 is not a mark: it makes nodeStatusMonitor and appStartupManager
// `rm -rf` every app directory and volume on the box. Reaching that state only
// on an empty node is the whole point of the staging.
//
// Nothing here enforces against a node that is not PROVABLY residential.
// geolocationService's classification is four-state and only RESIDENTIAL acts:
// CONFLICTED and UNKNOWN are left alone, as is a node whose bench cannot be read.

const config = require('config');
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const geolocationService = require('./geolocationService');
const benchmarkService = require('./benchmarkService');
const { CLASSIFICATION } = require('./utils/networkClassifier');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('./utils/appSyncEvents');
const globalState = require('./utils/globalState');
const { compareInstanceSeniority } = require('./utils/instanceOrdering');
const { socketAddressesMatch } = require('./utils/socketAddressUtils');
const fluxEventBus = require('./utils/fluxEventBus');

const DOS_MESSAGE_PREFIX = 'Residential node not running ArcaneOS';
const HOLD_REASON = 'residential node not running ArcaneOS';

const CHECK_INTERVAL_MS = config.fluxapps.residentialCheckIntervalMs;
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// Before the first app is given up, the verdict must have held this long.
// The placement hold deletes nothing and needs no window; this paces only the
// part that moves customer data, so a momentary misread can correct itself.
const SETTLE_MS = config.fluxapps.residentialSettleMs;
// The window counts time this node OBSERVED the verdict, not time that passed.
// A tick that cannot decide - an unreadable bench, a table that will not load -
// returns without touching state, so measuring from the first verdict alone let
// two evaluations 24h apart satisfy a window meant to prove the verdict held
// throughout. Silence is not agreement, and the node that cannot read its own
// hardware is the one to be most careful with.
//
// Each confirming tick credits the time since the last one, capped at a single
// check interval so a long-ish gap cannot buy more than a tick's worth, and
// credited as nothing at all once the gap is long enough that this node
// plainly stopped watching. Derived from the check cadence rather than written
// as its own number, so it holds the same proportion at any scale the harness
// compresses that cadence to.
const MAX_CONFIRMATION_GAP_MS = CHECK_INTERVAL_MS * 2;
// A node may act on an app only once it has seen that app at full strength for
// base + position * step. Position in the shared instance order is a DELAY,
// never a veto: a rule of "only the most junior may leave" deadlocks, because
// the replacement is itself the most junior and does not want to leave.
const QUEUE_BASE_MS = config.fluxapps.residentialQueueBaseMs;
const QUEUE_STEP_MS = config.fluxapps.residentialQueueStepMs;
// The ticket is served against an UNINTERRUPTED observation - the wait means
// nothing if it can be accumulated across periods this node was not watching -
// and this is what counts as the interruption. A gap longer than one queue step
// means at least one whole give-up pass went by without this node evaluating
// the app, so the observation starts again rather than carrying over.
//
// It is what stops the departure interval leaking into the queue. A node inside
// its interval returns ABOVE the accounting below, so it records nothing for
// the whole block; the first pass after the block clears sees one six-hour gap
// and every ticket starts again. Without that, position separates the FIRST
// departure and nothing after it: every ticket matures untouched during the
// block, and the node is instantly ready for all of them the moment it clears.
// Two nodes whose blocks expire in the same pass then hand back the same app
// together, which is the defect the step was widened to 40 minutes to close -
// reached by the other door.
//
// Derived from the step rather than written as its own number, because the step
// is ALREADY required to outlast the pass: that inequality is asserted against
// production's config in the unit tests and re-derived per fleet by
// test-infra's coupled knobs. A literal here would be a third place that has to
// be kept in step with the block time, and the last hand-written number in this
// neighbourhood inverted the property it was meant to enforce.
//
// TWICE the step, not once. A gap has to mean "a pass did not happen", and one
// step is 1.82 passes - so a single pass running late trips it. Production
// hardly notices that (40 minutes of lateness on a 22-minute pass is an
// incident in itself), but the harness compresses the same ratio to about 30
// seconds, where six fleets booting at once make a late pass ordinary. The
// ticket then restarts every few passes and never matures at all: on chud it
// counted 2m, 1m, 0m, and jumped back to 2m, three times over, and the suite
// waiting on it timed out.
//
// The ABSOLUTE jitter does not compress with the clocks, which is why a ratio
// that is comfortable at production scale is not comfortable at harness scale.
// Two steps is ~3.6 passes: a pass has to be missed outright, not merely be
// slow. The departure interval is what must still exceed it - see the coupled
// knob that enforces exactly that.
const MAX_TICKET_GAP_MS = QUEUE_STEP_MS * 2;
// Minimum gap between this node's departures. The give-up-an-app pass runs every
// 11 blocks (~22 min), which unpaced would empty the busiest node in the fleet in
// about four hours; there is no deadline here and slower is strictly safer.
const EVACUATION_INTERVAL_MS = config.fluxapps.residentialEvacuationIntervalMs;

const startupCollection = config.database.local.collections.nodeStartupTracker;
const SETTLE_MARKER_KEY = 'residentialDos';

let timerHandle = null;
let started = false;
let stopping = false;
let ourDosActive = false;
let inconclusiveStreak = 0;
// appName -> { since, lastSeenAt } on the MONOTONIC clock, for an app this node
// has seen at full strength on every pass since `since`. Process lifetime only:
// losing it costs a queue wait, never a premature removal.
//
// Two fields rather than one, because the ticket is an uninterrupted observation
// and not an elapsed time. `since` is what the wait is measured from;
// `lastSeenAt` is the only way an interruption can be detected at all - without
// it a node that stopped looking, or one that was not allowed to act, goes on
// accruing credit for time it never spent watching.
const wholeObservation = new Map();
// Whether the settling window has elapsed and departures may begin.
let evacuating = false;
// What /flux/info reports, and DELIBERATELY not derived from `evacuating`.
//
// `evacuating` is a per-tick permission for the give-up pass: any tick that
// cannot read something turns it off, correctly, because a node that cannot
// establish its own state must not hand an app back. It is not a description of
// how far through the staging the node is, and reporting it as one would show
// the node moving BACKWARDS through a staging it never moved backwards through.
//
// The window is what actually progresses. `observedWindowMs` only ever grows
// while the verdict holds - a tick that cannot decide leaves it alone rather
// than resetting it - and both are cleared together the moment the node stops
// being enforced, which is the one transition that really is a reversal.
let enforcing = false;
let observedWindowMs = 0;
// The network verdict behind the most recent isResidential(), carried into the
// decision event so a consumer can tell the three nulls apart.
let lastVerdict = { classification: null, source: null };
// Paces departures, on the MONOTONIC clock, and PERSISTED in the settle marker
// rather than held for the process lifetime. Same reasoning as the settling
// clock - a counter a restart resets makes restarting the way to go faster: a
// node restarting on a cron, crash-looping, or taking the ~4h auto-update shed
// an app every queue wait instead of every departure interval, and the busiest
// node in the fleet finished in hours rather than the three days the cadence is
// set for.
//
// `null`, not 0, for "no departure recorded". The gate used to read `now - 0`
// and get about 1.7e12 ms, which is open by arithmetic - but 0 on the monotonic
// clock is the start of THIS process, so the same expression would hold the
// gate SHUT on a freshly booted node for the first six hours. The state is
// named rather than encoded in a magic origin.
let lastEvacuationAt = null;

// Whether this node yet knows what it is running. Starts false and is only
// raised by the orchestrator's own signal - the same one appSpawner waits on.
// globalState.spawnerPaused is NOT this signal: it initialises to false, so
// reading it would report a freshly booted node as ready, and an app list read
// then is not evidence of an empty node.
let nodeReady = false;
appSyncEvents.on(SYNC_EVENTS.SPAWNER_READY, () => { nodeReady = true; });
appSyncEvents.on(SYNC_EVENTS.READINESS_LOST, () => { nodeReady = false; });

/**
 * Milliseconds on the monotonic clock. Every elapsed-time decision the queue
 * ticket makes reads this rather than the wall clock, so an NTP step cannot
 * mature a ticket against time this node never spent watching. The backward
 * step matters too, and more here than in most places: this runs on a box its
 * own operator administers, and the operator has an incentive to stall the
 * drain.
 *
 * Only values that must survive a restart stay on the wall clock, because a
 * monotonic reading means nothing to the next process.
 * @returns {number} Milliseconds since an arbitrary fixed origin.
 */
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * True when the current sticky DOS message was set by this service.
 * Identified by the DOS_MESSAGE_PREFIX we always prepend when we set it.
 */
function isOurStickyDos() {
  const msg = fluxNetworkHelper.getStickyDosMessage();
  return typeof msg === 'string' && msg.startsWith(DOS_MESSAGE_PREFIX);
}

/**
 * Three-state ArcaneOS check via fluxbenchd.
 *   true  - confirmed ArcaneOS, nothing to enforce
 *   false - confirmed NOT ArcaneOS
 *   null  - fluxbenchd unreachable or malformed, decide nothing
 *
 * Read from bench rather than `process.env.FLUXOS_PATH` because the env var is
 * set by whoever launches FluxOS, and this check is exactly what a residential
 * operator has an incentive to fake.
 * @returns {Promise<boolean|null>}
 */
async function isArcaneOs() {
  try {
    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (!benchmarkResponse || benchmarkResponse.status !== 'success' || !benchmarkResponse.data) {
      return null;
    }
    const { systemsecure } = benchmarkResponse.data;
    if (typeof systemsecure !== 'boolean') return null;
    return systemsecure;
  } catch (error) {
    log.warn(`residentialNodeDos - benchmark check failed: ${error.message}`);
    return null;
  }
}

/**
 * Three-state residential check.
 *   true  - RESIDENTIAL: positive evidence with no contradiction
 *   false - DATACENTER
 *   null  - decide nothing. Either CONFLICTED/UNKNOWN, or there is no verdict
 *           to be had: nothing observed yet, or no published location table has
 *           been consulted. A node that has not read the table does not know
 *           what kind of network it is on, and enforcing on its own reading
 *           alone is what this whole staging exists to avoid.
 *
 * Awaiting getNodeGeolocation() first is what restores the observations from the
 * db after a restart.
 * @returns {Promise<boolean|null>}
 */
async function isResidential() {
  try {
    await geolocationService.getNodeGeolocation();
    const verdict = await geolocationService.getNetworkClassification();
    // Kept for the decision event. The boolean below collapses CONFLICTED,
    // UNKNOWN and no-table-consulted into one null, which is right for the
    // enforcement decision and useless to anything trying to understand it - a
    // node declining a published verdict about its own address and a node that
    // has not read the table yet are the same answer here and nothing alike.
    lastVerdict = verdict
      ? { classification: verdict.classification, source: verdict.source }
      : { classification: null, source: null };
    if (!verdict) return null;
    if (verdict.classification === CLASSIFICATION.RESIDENTIAL) return true;
    if (verdict.classification === CLASSIFICATION.DATACENTER) return false;
    return null;
  } catch (error) {
    lastVerdict = { classification: null, source: null };
    log.warn(`residentialNodeDos - geolocation check failed: ${error.message}`);
    return null;
  }
}

/**
 * The settling marker as stored, or null when it cannot be read.
 *
 * Persisted rather than held in memory: a counter of consecutive evaluations in
 * memory is reset by restarting FluxOS, which would make restarting on a timer a
 * way to postpone the drain indefinitely.
 * @returns {Promise<object|null>} The marker document, or null.
 */
async function getSettleMarker() {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return null;
    const database = db.db(config.database.local.database);
    const marker = await dbHelper.findOneInDatabase(database, startupCollection, { _id: SETTLE_MARKER_KEY });
    return marker || null;
  } catch (error) {
    log.warn(`residentialNodeDos - could not read settle marker: ${error.message}`);
    return null;
  }
}

/**
 * A finite number, or null.
 *
 * Everything the window is computed from comes off a stored document, and a
 * value that is not a finite number poisons every comparison downstream: NaN is
 * neither `< SETTLE_MS` nor `>= SETTLE_MS`, so a gate written the obvious way
 * around falls through to draining on it. Rejected at the read instead, where
 * the alternative is "we have no record", which starts the window rather than
 * ending it.
 * @param {*} value The stored value.
 * @returns {number|null} The number, or null.
 */
function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * How much of the gap since the last confirmation counts towards the window.
 *
 * Nothing once the gap is long enough that this node plainly stopped watching -
 * that is the whole point, and it is what stops a day of silence reading as a
 * day of agreement. Otherwise the gap itself, capped at one check interval so a
 * long-ish gap cannot buy more than a tick's worth of credit.
 * @param {number} gapMs Time since the last confirmation.
 * @returns {number} Milliseconds to credit.
 */
function creditForGap(gapMs) {
  if (gapMs > MAX_CONFIRMATION_GAP_MS) return 0;
  return Math.min(gapMs, CHECK_INTERVAL_MS);
}

/**
 * Record that this tick confirmed the verdict, and return the observed time the
 * verdict has now held for.
 *
 * Keyed on the VERDICT, not on the address: residential lines get dynamic
 * addresses, so restarting the clock on an IP change would make power-cycling
 * the router the way to postpone enforcement.
 * @param {number} now Epoch ms.
 * @returns {Promise<number|null>} Observed milliseconds, or null when the marker
 *   cannot be written.
 */
async function noteVerdictConfirmed(now) {
  const marker = await getSettleMarker();
  // A marker written before this node kept an observed total has no record of
  // what was watched, only of when the clock started - and that is exactly the
  // measure being replaced. It starts accumulating from here rather than being
  // credited for time nobody can vouch for.
  const previousConfirmedAt = numberOrNull(marker && marker.lastConfirmedAt);
  const observedMs = numberOrNull(marker && marker.observedMs) ?? 0;
  // Restored here rather than at boot: this is the pass that reads the marker,
  // and it runs before any departure can be considered.
  //
  // CONVERTED, not read. The marker holds wall-clock ms and the gate runs on the
  // monotonic clock, so what survives a restart is how long AGO the last
  // departure was, not the instant it happened. A marker stamped in the future -
  // the clock moved back between processes - would otherwise restore an origin
  // ahead of now and hold the gate shut; it is floored at no elapsed time
  // instead, which is the same answer as a departure that just happened.
  const persistedEvacuation = numberOrNull(marker && marker.lastEvacuationAt);
  if (persistedEvacuation) {
    const restored = monotonicMs() - Math.max(0, now - persistedEvacuation);
    if (lastEvacuationAt === null || restored > lastEvacuationAt) {
      lastEvacuationAt = restored;
    }
  }
  const credited = previousConfirmedAt ? creditForGap(now - previousConfirmedAt) : 0;
  const totalObservedMs = observedMs + credited;

  try {
    const db = dbHelper.databaseConnection();
    if (!db) return null;
    const database = db.db(config.database.local.database);
    await dbHelper.findOneAndUpdateInDatabase(
      database,
      startupCollection,
      { _id: SETTLE_MARKER_KEY },
      {
        $set: {
          // Kept for the operator reading the record, not for the gate: it is
          // when the verdict was FIRST seen, which is not what the window
          // measures.
          residentialSince: (marker && marker.residentialSince) || now,
          lastConfirmedAt: now,
          observedMs: totalObservedMs,
        },
      },
      { upsert: true },
    );
    if (!marker) log.info('residentialNodeDos - settling window started');
    return totalObservedMs;
  } catch (error) {
    log.warn(`residentialNodeDos - could not write settle marker: ${error.message}`);
    return null;
  }
}

/**
 * Clear the settling window. Only a verdict flip does this - the node is no
 * longer residential, or is now ArcaneOS.
 */
async function clearSettleMarker() {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return;
    const database = db.db(config.database.local.database);
    await dbHelper.findOneAndDeleteInDatabase(database, startupCollection, { _id: SETTLE_MARKER_KEY }, {});
  } catch (error) {
    log.warn(`residentialNodeDos - could not clear settle marker: ${error.message}`);
  }
}

/**
 * The apps installed on this node, or null when that cannot be established.
 *
 * The null is load-bearing. Setting the DOS on a node believed empty that is not
 * makes nodeStatusMonitor delete every app it holds - the exact outcome this
 * service exists to avoid - so "could not read" must never arrive here as an
 * empty list.
 * @param {Function} installedAppsFn Injected app lister.
 * @returns {Promise<string[]|null>}
 */
async function listInstalledApps(installedAppsFn) {
  try {
    const response = await installedAppsFn();
    if (!response || response.status !== 'success' || !Array.isArray(response.data)) return null;
    return response.data.map((app) => app.name);
  } catch (error) {
    log.warn(`residentialNodeDos - could not list installed apps: ${error.message}`);
    return null;
  }
}

/**
 * How long this node must have seen an app whole before it may act on it.
 * @param {object[]} locations Instance locations, any order.
 * @param {string} localSocketAddr This node's socket address.
 * @returns {number} Milliseconds.
 */
function queueDelayMs(locations, localSocketAddr) {
  // Junior end first - the same order reasonToGiveUpApp ranks SURPLUS by, and
  // for the same reason: the newest copy stands aside and the senior one goes
  // on holding the data. Ranking the senior end first also put the ONE case
  // that cannot simply leave at the front of the queue, because the elected
  // primary is the senior instance: the node needing a stand-down was asked to
  // go before any of the nodes that could just go, and every node behind it
  // waited out its step while it negotiated. Senior last is both orders
  // agreeing and the cheap departures happening first.
  const ordered = [...locations].sort((a, b) => compareInstanceSeniority(b, a));
  const index = ordered.findIndex((entry) => socketAddressesMatch(entry.ip, localSocketAddr));
  // An instance this node cannot find in the list waits longest. For an EMPTY
  // list `ordered.length` is 0, which is the front of the queue - the shortest
  // wait of all, inverting the rule. An empty list is the ordinary result of
  // expired location records, so it is not an exotic input.
  const position = index < 0 ? Math.max(ordered.length, 1) : index;
  return QUEUE_BASE_MS + (position * QUEUE_STEP_MS);
}

/**
 * How far this node is through being staged out of service, for /flux/info.
 *
 *   null       nothing is being enforced against this node
 *   HOLD       enforced: it takes no NEW apps, and nothing has been deleted
 *   EVACUATE   the settling window is served and it is handing apps back
 *
 * HOLD is the state worth reporting. It is the longest one - a full settling
 * window - it is the only one where the operator can still fix the node and
 * lose nothing, and without it a held node is indistinguishable from an
 * ordinary one that happens not to have been given work.
 *
 * The DOS itself is already reported beside this as `dos`, so the three stages
 * read together: HOLD with no DOS, EVACUATE with no DOS, then EVACUATE with
 * one. A node EMPTY FROM THE START reports HOLD with a DOS, having skipped the
 * window it had no data to need; one that DRAINED to empty has served the whole
 * window by the time it gets there, so it reports EVACUATE with a DOS.
 * @returns {('HOLD'|'EVACUATE'|null)}
 */
function getDosStaging() {
  if (!enforcing) return null;
  return observedWindowMs >= SETTLE_MS ? 'EVACUATE' : 'HOLD';
}

/**
 * Whether this node is currently shedding the apps it holds.
 *
 * True only once the verdict has held for the settling window - the placement
 * hold starts immediately, but nothing that moves customer data does.
 * @returns {boolean}
 */
function isEvacuating() {
  return evacuating;
}

/**
 * May this node give up this particular app right now?
 *
 * This is the pacing half of the decision and says nothing about safety; the
 * give-up-an-app pass asks appEvacuationSafety separately, and both must agree.
 * @param {string} appName Global app name.
 * @param {object[]} locations Instance locations for the app.
 * @param {string} localSocketAddr This node's socket address.
 * @param {number} minInstances How many instances this app is meant to have.
 *   Passed in rather than derived here, so the pacing half of the decision and
 *   the SURPLUS half are ranked by one number instead of two. It is the LOCAL
 *   record's count; appEvacuationSafety re-derives from the global spec, which
 *   is the authority at the moment of removal. They can differ while an owner's
 *   instance-count change propagates, and either way round is safe: too low
 *   here lets a ticket run that the safety gate then refuses as short, which
 *   restarts the observation, and too high only makes the turn wait longer.
 * @param {number} [now] Monotonic ms, injectable for tests.
 * @returns {{ok: boolean, code: string, reason: string}} `code` is the
 *   machine-readable half. A caller that has to tell "waiting its turn" from
 *   "the app is short" cannot do it by matching prose, and the difference
 *   matters: the first is this working, the second is a node that wants to
 *   leave and cannot, which is the thing worth escalating. BELOW_INSTANCE_COUNT
 *   is deliberately the name appEvacuationSafety already uses for the same
 *   fact, because it IS the same fact asked one layer earlier.
 */
function mayEvacuateApp(appName, locations, localSocketAddr, minInstances, now = monotonicMs()) {
  if (!evacuating) return { ok: false, code: 'NOT_EVACUATING', reason: 'node is not evacuating' };
  if (lastEvacuationAt !== null && now - lastEvacuationAt < EVACUATION_INTERVAL_MS) {
    const wait = Math.round((EVACUATION_INTERVAL_MS - (now - lastEvacuationAt)) / 60000);
    return { ok: false, code: 'DEPARTURE_INTERVAL', reason: `next departure in ${wait}m` };
  }

  // Everything below is the ticket, and it sits BELOW the interval gate on
  // purpose: a blocked node records nothing, so its own block reads as one long
  // gap and the ticket starts again. See MAX_TICKET_GAP_MS.
  const previous = wholeObservation.get(appName);
  const gap = previous ? now - previous.lastSeenAt : Infinity;
  // Strength is tested HERE, where the clock is stamped, rather than left to
  // the safety gate. The wait is "seen at full strength for base + position x
  // step"; a clock that starts on the first ASK measures something else, and an
  // app short of its count is one the spawner is part way through replacing.
  // Time spent watching that is not time spent watching it whole.
  const whole = locations.length >= minInstances;
  const since = (!whole || gap > MAX_TICKET_GAP_MS) ? now : previous.since;
  wholeObservation.set(appName, { since, lastSeenAt: now });
  if (!whole) {
    return {
      ok: false,
      code: 'BELOW_INSTANCE_COUNT',
      reason: `app is below its instance count (${locations.length}/${minInstances}); its turn starts again`,
    };
  }
  const wait = queueDelayMs(locations, localSocketAddr);
  const observed = now - since;
  if (observed < wait) {
    return { ok: false, code: 'AWAITING_TURN', reason: `its turn is in ${Math.round((wait - observed) / 60000)}m` };
  }
  return { ok: true, code: 'READY', reason: 'ready' };
}

/**
 * Record that this app has gone, so the interval before the next one starts.
 * @param {string} appName Global app name.
 * @param {number} [now] Epoch ms, injectable for tests.
 */
function noteEvacuated(appName, now = monotonicMs()) {
  lastEvacuationAt = now;
  wholeObservation.delete(appName);
  // Written through to the marker, so a restart does not re-open the gate. Best
  // effort: the in-memory value already paces this process, and the persisted
  // one only has to survive into the next.
  //
  // The WALL clock is what gets written. The next process cannot read this
  // one's monotonic origin, so the only thing worth recording is an instant it
  // can convert back into "how long ago".
  persistLastEvacuationAt(Date.now()).catch(() => {});
  log.info(`residentialNodeDos - ${appName} handed back; next departure no sooner than ${EVACUATION_INTERVAL_MS / 3600000}h`);
}

/**
 * Record when this node last handed an app back.
 * @param {number} now Epoch ms.
 * @returns {Promise<void>}
 */
async function persistLastEvacuationAt(now) {
  try {
    const db = dbHelper.databaseConnection();
    if (!db) return;
    const database = db.db(config.database.local.database);
    await dbHelper.findOneAndUpdateInDatabase(
      database,
      startupCollection,
      { _id: SETTLE_MARKER_KEY },
      { $set: { lastEvacuationAt: now } },
      { upsert: true },
    );
  } catch (error) {
    log.warn(`residentialNodeDos - could not record the departure time: ${error.message}`);
  }
}

/**
 * Forget an app's queue observation. Called when it stops being safe to give up,
 * so the wait is served against an uninterrupted observation rather than
 * accumulated across a gap.
 * @param {string} appName Global app name.
 */
function forgetAppObservation(appName) {
  wholeObservation.delete(appName);
}

/**
 * Give up the DOS this service is holding. The slot is only cleared when the
 * message in it is still ours: another owner may have taken it since we wrote,
 * and clearing that would drop their DOS on the floor.
 * @param {string} reason Logged context for the release.
 */
function releaseOurDos(reason) {
  if (isOurStickyDos()) {
    log.info(`residentialNodeDos - clearing sticky DOS (${reason})`);
    fluxNetworkHelper.clearStickyDosMessage();
    ourDosActive = false;
    return;
  }
  if (ourDosActive) {
    log.info(`residentialNodeDos - our DOS was replaced by another owner, releasing our claim only (${reason})`);
    ourDosActive = false;
  }
}

/**
 * Put the node fully out of service. Only ever reached once it holds no apps.
 */
function applyDos() {
  const sticky = fluxNetworkHelper.getStickyDosMessage();
  if (sticky && !isOurStickyDos()) {
    // Another owner's DOS already has this node out of service for its own
    // reason, and taking the single slot would leave it unable to recognise or
    // release its own state.
    log.info('residentialNodeDos - another sticky DOS is active, not overwriting it');
    return;
  }
  if (isOurStickyDos()) return;
  const message = `${DOS_MESSAGE_PREFIX}. Migrate this node to ArcaneOS or move it to a data center connection.`;
  fluxNetworkHelper.setStickyDosMessage(message);
  fluxNetworkHelper.setStickyDosStateValue(100);
  ourDosActive = true;
  log.error(message);
}

/**
 * What this tick concluded, whichever way it went.
 *
 * Deciding NOT to enforce leaves no trace: no placement hold, no settle marker,
 * no DOS - the outcome IS the absence of all three. So a caller with no event
 * here can only wait out a duration and infer from nothing having happened,
 * which is indistinguishable from the tick never having run. That is what the
 * harness was doing, at thirty seconds a test.
 *
 * `enforce: null` is a tick that could not decide, with `undecidedBecause`
 * naming the input that was missing. Kept apart from `false` because they are
 * opposite states: one says this node is fit to serve, the other says nobody
 * knows yet.
 *
 * fluxEventBus is inert on a real node - config.testEventStream is false - so
 * this exists for the harness and costs production nothing.
 * @param {{residential: boolean|null, arcaneOs: boolean|null,
 *   enforce: boolean|null, undecidedBecause: string|null}} verdict
 */
function publishDecision(verdict) {
  fluxEventBus.publish('residential:decided', {
    ...verdict,
    // Which network verdict produced this, and which authority reached it -
    // 'published-table' or 'node-veto'. Without these, enforce: null covers
    // CONFLICTED, UNKNOWN and "no table consulted" alike, and a suite waiting
    // on a veto cannot tell it from a node that has read nothing.
    classification: lastVerdict.classification,
    source: lastVerdict.source,
  });
}

/**
 * One evaluation of the policy.
 *
 * @param {object} deps Injected collaborators.
 * @param {Function} deps.installedAppsFn Lists apps installed on this node.
 * @returns {Promise<boolean>} True when the tick reached a decision, false when
 *   an input was unavailable and the caller should retry sooner.
 */
async function enforceResidentialPolicy(deps) {
  const { installedAppsFn } = deps;

  const [arcane, residential] = await Promise.all([isArcaneOs(), isResidential()]);

  // A tick that cannot decide stops the DRAIN but leaves the placement hold.
  // The two fail in opposite directions on purpose: holding placement costs the
  // node nothing it already has, so leaving it on through an unreadable tick is
  // safe, while continuing to hand back an app every departure interval with no
  // current verdict is not. `evacuating` was latched, so a node already draining
  // whose bench or classification became unreadable kept going for as long as
  // the input stayed unavailable.
  if (arcane === null) {
    evacuating = false;
    log.info('residentialNodeDos - benchmark unreachable, skipping this tick');
    publishDecision({ residential, arcaneOs: arcane, enforce: null, undecidedBecause: 'benchmark' });
    return false;
  }
  if (residential === null) {
    evacuating = false;
    log.info('residentialNodeDos - no network verdict to act on yet, skipping this tick');
    publishDecision({ residential, arcaneOs: arcane, enforce: null, undecidedBecause: 'classification' });
    return false;
  }

  const shouldEnforce = residential && !arcane;
  log.info(`residentialNodeDos - residential=${residential} arcaneOs=${arcane} enforce=${shouldEnforce}`);
  publishDecision({ residential, arcaneOs: arcane, enforce: shouldEnforce, undecidedBecause: null });

  if (!shouldEnforce) {
    fluxNetworkHelper.clearPlacementHold();
    releaseOurDos(`residential=${residential}, arcaneOs=${arcane}`);
    await clearSettleMarker();
    evacuating = false;
    enforcing = false;
    observedWindowMs = 0;
    wholeObservation.clear();
    return true;
  }

  // Costs the node nothing it already holds, so it needs no settling period.
  fluxNetworkHelper.setPlacementHold(HOLD_REASON);
  // Set with the hold and cleared with it: the two are the same fact, and the
  // hold is the first thing that happens to an enforced node.
  enforcing = true;

  if (!nodeReady) {
    evacuating = false;
    log.info('residentialNodeDos - node not ready yet, holding placement only this tick');
    return false;
  }

  const installed = await listInstalledApps(installedAppsFn);
  if (installed === null) {
    evacuating = false;
    log.info('residentialNodeDos - installed app list unavailable, holding placement only this tick');
    return false;
  }

  if (!installed.length) {
    // The placement hold above stops the spawner taking anything NEW, but an
    // install already running is not stopped by it - and an install is real
    // from appInstaller's installationInProgress flag, some way before its
    // database record exists for listInstalledApps to see. A tick landing in
    // that gap reads an empty node, DOSes it, and nodeStatusMonitor tears the
    // arriving app down on its next loop.
    //
    // Undecided rather than "not empty": the retry backoff re-asks in minutes
    // instead of deferring the DOS for a full check interval, and an install
    // resolves on that timescale. Bounded today by appInstaller writing its
    // database entry before creating the container, so no volume exists in the
    // window - nothing here referenced that ordering, and nothing tested it.
    if (globalState.installationInProgress) {
      log.info('residentialNodeDos - an install is in flight, not treating this node as empty yet');
      return false;
    }
    applyDos();
    return true;
  }

  const now = Date.now();
  const observedMs = await noteVerdictConfirmed(now);
  if (observedMs !== null) observedWindowMs = observedMs;
  if (observedMs === null) {
    evacuating = false;
    log.info('residentialNodeDos - settle marker unavailable, evacuation stays off');
    return false;
  }
  // Negated rather than written as `<`, so a value that is not a number refuses
  // rather than reading as elapsed. numberOrNull above is the guard that
  // actually stands between a stored value and this comparison; this form is
  // the backstop for a path that ever reaches it another way, and the two are
  // only distinguishable on an input like Infinity, which numberOrNull rejects
  // and `>=` would accept. It is reachable without malformed data: the
  // clock is Date.now(), and a node whose clock is behind when the marker is
  // written - no RTC, a VM restored from snapshot, timesyncd not yet stepped -
  // and is then corrected FORWARD reads the whole window as served. A backwards
  // step fails safe; a forward step failed toward moving customer data.
  if (!(observedMs >= SETTLE_MS)) {
    evacuating = false;
    // Hours of the verdict actually WATCHED, so a node whose checks keep coming
    // back inconclusive sees this figure stall rather than count down - which
    // is the difference the window is there to make.
    const remaining = Math.round((SETTLE_MS - observedMs) / (60 * 60 * 1000));
    log.info(`residentialNodeDos - held, evacuation begins after about ${remaining}h more of confirmed verdict (${installed.length} app(s) installed)`);
    return true;
  }

  // The give-up-an-app pass reads this and does the removing; it asks
  // mayEvacuateApp for the pacing and appEvacuationSafety for the safety.
  if (!evacuating) log.warn(`residentialNodeDos - evacuation begins, ${installed.length} app(s) to hand back`);
  evacuating = true;
  return true;
}

/**
 * Delay before the next tick. A decided tick waits out the full interval; an
 * inconclusive one comes back on the short retry, doubling each time it stays
 * inconclusive, so a node that can never decide stops saying so 288 times a day.
 * @param {boolean} decided Whether the tick reached a decision.
 * @param {number} streak Consecutive inconclusive ticks, this one included.
 * @returns {number} Milliseconds until the next tick.
 */
function nextDelay(decided, streak) {
  if (decided) return CHECK_INTERVAL_MS;
  return Math.min(RETRY_INTERVAL_MS * 2 ** (streak - 1), CHECK_INTERVAL_MS);
}

/**
 * Run one tick and schedule the next one.
 * @param {object} deps Injected collaborators, as enforceResidentialPolicy.
 */
async function tick(deps) {
  let decided = false;
  try {
    decided = await enforceResidentialPolicy(deps);
  } catch (error) {
    log.error(`residentialNodeDos - tick error: ${error.message}`);
  }
  inconclusiveStreak = decided ? 0 : inconclusiveStreak + 1;
  if (stopping) return;
  timerHandle = setTimeout(() => tick(deps), nextDelay(decided, inconclusiveStreak));
}

/**
 * Start the enforcer. Performs the first check immediately, then reschedules
 * itself. Safe to call multiple times.
 * @param {object} deps Injected collaborators, as enforceResidentialPolicy.
 */
async function start(deps) {
  // The guard is `started`, not `timerHandle`: the first tick is awaited before
  // any timer exists, so a second start() landing inside it would run a second
  // self-rescheduling chain.
  if (started) return;
  started = true;
  stopping = false;
  inconclusiveStreak = 0;
  log.info('residentialNodeDos - enforcer starting');
  await tick(deps);
}

function stop() {
  stopping = true;
  started = false;
  // Cleared with the timer: a later start() must not inherit a claim from the
  // previous run and skip the read-back that decides whether the slot is ours.
  ourDosActive = false;
  evacuating = false;
  enforcing = false;
  observedWindowMs = 0;
  wholeObservation.clear();
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
}

function isDosActive() {
  return ourDosActive;
}

module.exports = {
  start,
  stop,
  enforceResidentialPolicy,
  isArcaneOs,
  isResidential,
  isDosActive,
  queueDelayMs,
  listInstalledApps,
  isEvacuating,
  getDosStaging,
  mayEvacuateApp,
  noteEvacuated,
  forgetAppObservation,
  // Test seam for the readiness gate, which is otherwise only moved by events.
  setNodeReadyForTests: (value) => { nodeReady = value; },
  DOS_MESSAGE_PREFIX,
  HOLD_REASON,
  CHECK_INTERVAL_MS,
  RETRY_INTERVAL_MS,
  SETTLE_MS,
  QUEUE_BASE_MS,
  QUEUE_STEP_MS,
  MAX_TICKET_GAP_MS,
  EVACUATION_INTERVAL_MS,
};
