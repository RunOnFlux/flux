// Syncthing Events Consumer - the EDGE half of the level-triggered architecture.
//
// The periodic monitor poll is the ground truth (level); this consumer holds one
// persistent filtered subscription to syncthing's events API purely to ACCELERATE
// reaction (edge). Events never carry decisions: on folder activity we only ask
// the monitor to evaluate that folder's state now, through exactly the same logic
// the poll runs. Every failure mode of the stream therefore costs latency, never
// correctness:
//   - the events buffer is finite, so an id gap means events were lost past us
//     -> signal a full resync and carry on;
//   - a dead long-poll (socket teardown, API down, syncthing restarting) is the
//     ONLY observable shape of a syncthing restart: ids reset on restart but the
//     API never returns events below a stale `since` (lib/events Since() just
//     waits for the counter to catch up) -> the stream position is untrustworthy
//     after ANY poll failure. Re-anchor at "now" (since=0), backoff, and announce
//     one resync when the stream is healthy again - the blind window belongs to
//     the level loop.
// A filtered subscription starts from "now" (a fresh `since=0` query returns no
// buffered history) - that is fine here, the poll owns history.
//
// FolderErrors events are additionally kept as the durable per-folder error
// record: the polled /rest/folder/errors and pullErrors are wiped by the next
// scan (verified live), so the event stream is the only place pull failures
// survive long enough to be diagnosed.
const log = require('../../lib/log');
const syncthingService = require('../syncthingService');
const fluxEventBus = require('../utils/fluxEventBus');
const { FluxController } = require('../utils/fluxController');

// long-poll timeout (server side) and the retry delay after a failed poll
const EVENTS_LONGPOLL_TIMEOUT_S = 55;
const EVENTS_RETRY_DELAY_MS = 5 * 1000;
// pacing floor: a real long-poll holds the request for the timeout, but a
// fast-returning server (misconfiguration) must not turn this loop into a
// tight spin - an iteration that completes faster than this is padded out
const EVENTS_MIN_POLL_INTERVAL_MS = 1000;

const SUBSCRIBED_EVENTS = 'FolderSummary,FolderCompletion,FolderErrors,StateChanged';

let since = 0;
// set when a poll fails: the next SUCCESSFUL poll announces a single resync
let recoveryPending = false;
let callbacks = {};
// Owns the lifecycle: an abort signal that interrupts the in-flight long-poll,
// cancellable sleeps for the inter-poll waits, and a lock stop() awaits so it
// returns only once the loop has truly finished its current iteration. This is
// why start()/stop() are a correct idempotent pair - stop() actually stops.
const controller = new FluxController();

// folderId -> { time, errors } from the last FolderErrors event
const folderErrorsByFolder = new Map();

// folder ids seen in FolderErrors since the last drain - the monitor pass
// drains this to mount-verify exactly the flagged folders (targeted reaction,
// never a steady-state sweep)
const erroredFolderIdsSinceLastDrain = new Set();

/**
 * One long-poll iteration: fetch events after `since`, detect lost-events
 * conditions, surface folder activity to the monitor.
 */
async function pollOnce() {
  const response = await syncthingService.getEvents({
    params: {},
    query: { since, events: SUBSCRIBED_EVENTS, timeout: EVENTS_LONGPOLL_TIMEOUT_S },
    signal: controller.signal,
  }, null);

  if (!response || response.status !== 'success' || !Array.isArray(response.data)) {
    throw new Error('syncthing events endpoint unavailable');
  }

  if (recoveryPending) {
    recoveryPending = false;
    log.warn('syncthingEventsConsumer - stream recovered after an outage; requesting full resync (the blind window belongs to the level loop)');
    fluxEventBus.publish('syncthing:eventsResync', { reason: 'streamOutage', since });
    if (callbacks.onResync) callbacks.onResync();
  }

  const events = response.data;
  if (events.length === 0) return; // long-poll timeout with nothing new

  const firstId = events[0].id;
  const lastId = events[events.length - 1].id;

  // Lost events: id regression (syncthing restarted, ids reset) or a gap (the
  // finite buffer overflowed past us). Either way some changes were never seen -
  // hand the problem to the level loop (full evaluation) and continue from the
  // stream's current position.
  if (since > 0 && (lastId < since || firstId > since + 1)) {
    log.warn(`syncthingEventsConsumer - event stream discontinuity (since ${since}, got ${firstId}..${lastId}); requesting full resync`);
    fluxEventBus.publish('syncthing:eventsResync', { since, firstId, lastId });
    since = lastId;
    if (callbacks.onResync) callbacks.onResync();
    return;
  }
  since = lastId;

  // eslint-disable-next-line no-restricted-syntax
  for (const event of events) {
    const folder = event.data?.folder;
    if (!folder) {
      // eslint-disable-next-line no-continue
      continue;
    }
    if (event.type === 'FolderErrors') {
      folderErrorsByFolder.set(folder, { time: event.time, errors: event.data.errors || [] });
      erroredFolderIdsSinceLastDrain.add(folder);
      fluxEventBus.publish('syncthing:folderErrors', { folder, time: event.time, errors: event.data.errors || [] });
    }
    if (callbacks.onFolderActivity) callbacks.onFolderActivity(folder, event.type);
  }
}

// The loop runs as a single long-lived runner under the controller. It holds the
// controller's lock for each iteration so stop() (controller.abort()) returns only
// after the in-flight iteration finishes; the long-poll is aborted via the signal
// and every inter-poll wait is a cancellable controller.sleep, so stop() is prompt.
async function runLoop() {
  while (!controller.aborted) {
    const startedAt = Date.now();
    // eslint-disable-next-line no-await-in-loop
    await controller.lock.enable();
    try {
      // eslint-disable-next-line no-await-in-loop
      await pollOnce();
      const elapsed = Date.now() - startedAt;
      if (elapsed < EVENTS_MIN_POLL_INTERVAL_MS) {
        // eslint-disable-next-line no-await-in-loop
        await controller.sleep(EVENTS_MIN_POLL_INTERVAL_MS - elapsed);
      }
    } catch (error) {
      // a deliberate stop() aborts the in-flight long-poll (or the sleep above),
      // which surfaces here - exit rather than re-anchoring and backing off
      if (controller.aborted) break;
      log.warn(`syncthingEventsConsumer - poll failed (${error.message}); retrying in ${EVENTS_RETRY_DELAY_MS / 1000}s (the periodic poll keeps covering meanwhile)`);
      // a syncthing restart resets the event ids, and the API never returns
      // events below a stale `since` - after any failure the position is
      // untrustworthy, so start over from "now" and resync on recovery
      since = 0;
      recoveryPending = true;
      // eslint-disable-next-line no-await-in-loop
      await controller.sleep(EVENTS_RETRY_DELAY_MS).catch(() => {});
    } finally {
      controller.lock.disable();
    }
  }
}

/**
 * Start the consumer. Idempotent: a no-op if already running.
 * @param {Object} handlers
 * @param {Function} handlers.onFolderActivity - (folderId, eventType) called per folder event
 * @param {Function} handlers.onResync - called when events were lost and a full evaluation is needed
 */
function start(handlers = {}) {
  if (controller.running) return;
  since = 0;
  recoveryPending = false;
  callbacks = handlers;
  controller.startLoop(runLoop);
}

/**
 * Stop the consumer. Idempotent and awaitable: aborts the in-flight long-poll,
 * waits for the current iteration to unwind, and resets the controller so a later
 * start() begins one clean loop (never a second loop racing the first).
 */
async function stop() {
  await controller.abort();
}

function isRunning() {
  return controller.running;
}

/**
 * Durable per-folder pull-error record (last FolderErrors event).
 * @param {string} folderId
 * @returns {{time: string, errors: Array}|undefined}
 */
function getFolderErrors(folderId) {
  return folderErrorsByFolder.get(folderId);
}

/**
 * Folder ids flagged by FolderErrors since the last drain; draining clears
 * the accumulator. Consumed by the monitor pass for targeted mount verifies.
 * @returns {string[]} Folder ids
 */
function drainErroredFolderIds() {
  const ids = [...erroredFolderIdsSinceLastDrain];
  erroredFolderIdsSinceLastDrain.clear();
  return ids;
}

module.exports = {
  start,
  stop,
  isRunning,
  getFolderErrors,
  drainErroredFolderIds,
};
