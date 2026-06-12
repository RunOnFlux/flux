// Syncthing Events Consumer - the EDGE half of the level-triggered architecture.
//
// The periodic monitor poll is the ground truth (level); this consumer holds one
// persistent filtered subscription to syncthing's events API purely to ACCELERATE
// reaction (edge). Events never carry decisions: on folder activity we only ask
// the monitor to evaluate that folder's state now, through exactly the same logic
// the poll runs. Every failure mode of the stream therefore costs latency, never
// correctness:
//   - the events buffer is finite and ids RESET when syncthing restarts, so an id
//     gap or regression means events were lost -> signal a full resync and carry on;
//   - a dead long-poll (socket teardown, API down) -> backoff and re-subscribe,
//     behavior degrades to the poll cadence meanwhile.
// A filtered subscription starts from "now" (a fresh `since=0` query returns no
// buffered history) - that is fine here, the poll owns history.
//
// FolderErrors events are additionally kept as the durable per-folder error
// record: the polled /rest/folder/errors and pullErrors are wiped by the next
// scan (verified live), so the event stream is the only place pull failures
// survive long enough to be diagnosed.
const log = require('../../lib/log');
const syncthingService = require('../syncthingService');
const serviceHelper = require('../serviceHelper');
const fluxEventBus = require('../utils/fluxEventBus');

// long-poll timeout (server side) and the retry delay after a failed poll
const EVENTS_LONGPOLL_TIMEOUT_S = 55;
const EVENTS_RETRY_DELAY_MS = 5 * 1000;

const SUBSCRIBED_EVENTS = 'FolderSummary,FolderCompletion,FolderErrors,StateChanged';

let running = false;
let stopRequested = false;
let since = 0;
let callbacks = {};

// folderId -> { time, errors } from the last FolderErrors event
const folderErrorsByFolder = new Map();

/**
 * One long-poll iteration: fetch events after `since`, detect lost-events
 * conditions, surface folder activity to the monitor.
 */
async function pollOnce() {
  const response = await syncthingService.getEvents({
    params: {},
    query: { since, events: SUBSCRIBED_EVENTS, timeout: EVENTS_LONGPOLL_TIMEOUT_S },
  }, null);

  if (!response || response.status !== 'success' || !Array.isArray(response.data)) {
    throw new Error('syncthing events endpoint unavailable');
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
      fluxEventBus.publish('syncthing:folderErrors', { folder, time: event.time, errors: event.data.errors || [] });
    }
    if (callbacks.onFolderActivity) callbacks.onFolderActivity(folder, event.type);
  }
}

async function runLoop() {
  while (!stopRequested) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await pollOnce();
    } catch (error) {
      log.warn(`syncthingEventsConsumer - poll failed (${error.message}); retrying in ${EVENTS_RETRY_DELAY_MS / 1000}s (the periodic poll keeps covering meanwhile)`);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(EVENTS_RETRY_DELAY_MS);
    }
  }
  running = false;
}

/**
 * Start the consumer.
 * @param {Object} handlers
 * @param {Function} handlers.onFolderActivity - (folderId, eventType) called per folder event
 * @param {Function} handlers.onResync - called when events were lost and a full evaluation is needed
 */
function start(handlers = {}) {
  if (running) return;
  running = true;
  stopRequested = false;
  since = 0;
  callbacks = handlers;
  runLoop();
}

/** Stop the consumer. The loop may be parked inside a long-poll; it is not
 * awaited - the stopRequested flag retires it on its next iteration. */
async function stop() {
  stopRequested = true;
  running = false;
}

function isRunning() {
  return running;
}

/**
 * Durable per-folder pull-error record (last FolderErrors event).
 * @param {string} folderId
 * @returns {{time: string, errors: Array}|undefined}
 */
function getFolderErrors(folderId) {
  return folderErrorsByFolder.get(folderId);
}

module.exports = {
  start,
  stop,
  isRunning,
  getFolderErrors,
};
