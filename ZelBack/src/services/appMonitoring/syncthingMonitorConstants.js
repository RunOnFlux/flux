// Syncthing Monitor - Constants

const config = require('config');

// Timeout values (milliseconds)
const DEVICE_ID_REQUEST_TIMEOUT_MS = 5000;
// How long a peer's device id is trusted before it is read from the peer again.
const DEVICE_ID_REFRESH_MS = config.syncthing.deviceIdRefreshMs ?? 60 * 60 * 1000;
// Tunable for tests via config.syncthing (see ZelBack/config/default.js); the
// literal is the production default when the key is absent.
const MONITOR_INTERVAL_MS = config.syncthing.monitorIntervalMs ?? 30 * 1000; // 30 seconds
const OPERATION_DELAY_MS = 500;
const ERROR_RETRY_DELAY_MS = 5 * 1000; // 5 seconds
const SYNC_STATE_LOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Syncthing configuration
const SYNCTHING_RESCAN_INTERVAL_SECONDS = 900; // 15 minutes
const SYNCTHING_MAX_CONFLICTS = 0;

// Stall ladder (receive-only convergence). Flat inSyncBytes while the folder is
// IDLE means no blocks are arriving (byte accounting is block-granular on the
// fleet's syncthing v2.0.x). The responses, in order of evidence:
//   wait STALL_NUDGE_AFTER_MS -> nudge (device pause/resume forces a reconnect +
//   index re-exchange, re-arming a dormant puller), repeated with doubling backoff
//   capped at STALL_NUDGE_MAX_INTERVAL_MS -> removal, only after
//   STALL_REMOVE_MIN_NUDGES nudges over at least STALL_REMOVE_MIN_WINDOW_MS with
//   zero progress AND a connected synced peer holding the data.
// Tunable for tests via config.syncthing; literals are the production defaults.
const STALL_NUDGE_AFTER_MS = config.syncthing.stallNudgeAfterMs ?? 3 * 60 * 1000;
const STALL_NUDGE_MAX_INTERVAL_MS = config.syncthing.stallNudgeMaxIntervalMs ?? 15 * 60 * 1000;
const STALL_REMOVE_MIN_WINDOW_MS = config.syncthing.stallRemoveMinWindowMs ?? 20 * 60 * 1000;
const STALL_REMOVE_MIN_NUDGES = config.syncthing.stallRemoveMinNudges ?? 3;

// A replica that has received nothing, while a live peer serves the writable copy and
// this node's syncthing is not connected to any such peer, is given this long to make
// the connection. Past it the replica is not a replica: it holds no bytes, so it cannot
// take over, yet it fills an instance slot and wins the election the moment the holder
// goes quiet - which then seeds an empty folder over the owner's data. Removing it loses
// nothing (it holds nothing) and hands the slot to a node that can sync.
// A healthy join connects within seconds, so this only has to outlast a slow start.
const JOIN_CONNECT_DEADLINE_MS = config.syncthing.joinConnectDeadlineMs ?? 30 * 60 * 1000;
// The most one monitor pass can add to that count, so a stalled pass or a suspended
// process is not taken for half an hour of watching the join fail.
const JOIN_STEP_CAP_MS = 5 * 60 * 1000;
// How long a replica that failed to leave waits before trying again.
const JOIN_REMOVAL_RETRY_MS = 5 * 60 * 1000;

// Folder states in which syncthing is actively working: flat bytes are healthy
// here (e.g. a long sync-preparing phase on a large folder)
const ACTIVE_FOLDER_STATES = ['syncing', 'sync-preparing', 'sync-waiting', 'scanning', 'scan-waiting', 'cleaning', 'clean-waiting'];

const CLOCK_SKEW_TOLERANCE_MS = 5000; // 5 seconds tolerance for timestamp comparison
// Consecutive cycles a node must observe itself as the designated leader before
// acting on it, so a single transient drop of a peer's running-location doesn't
// flip a follower into self-promoting (and starting the app). Tunable for tests.
const LEADER_CONFIRM_COUNT = config.syncthing.leaderConfirmCount ?? 2;

// Edge-accelerator pacing: event bursts coalesce for the debounce window, and
// early runs keep a minimum gap from the last completed pass so a continuous
// event stream cannot drive back-to-back full passes. Tunable for tests.
const EARLY_EVAL_DEBOUNCE_MS = config.syncthing.earlyEvalDebounceMs ?? 2 * 1000;
const EARLY_EVAL_MIN_GAP_MS = config.syncthing.earlyEvalMinGapMs ?? 10 * 1000;

// Sync completion thresholds
const SYNC_COMPLETE_PERCENTAGE = 100;

// Health monitoring thresholds (milliseconds). The health watchdog alerts and
// nudges only - it never stops containers, restarts syncthing or removes apps
const HEALTH_WARNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - log warning
const HEALTH_NUDGE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes - device pause/resume nudge (and min interval between nudges)
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - how often to run health checks

module.exports = {
  DEVICE_ID_REQUEST_TIMEOUT_MS,
  DEVICE_ID_REFRESH_MS,
  MONITOR_INTERVAL_MS,
  OPERATION_DELAY_MS,
  ERROR_RETRY_DELAY_MS,
  SYNC_STATE_LOG_INTERVAL_MS,
  SYNCTHING_RESCAN_INTERVAL_SECONDS,
  SYNCTHING_MAX_CONFLICTS,
  STALL_NUDGE_AFTER_MS,
  STALL_NUDGE_MAX_INTERVAL_MS,
  STALL_REMOVE_MIN_WINDOW_MS,
  STALL_REMOVE_MIN_NUDGES,
  JOIN_CONNECT_DEADLINE_MS,
  JOIN_STEP_CAP_MS,
  JOIN_REMOVAL_RETRY_MS,
  ACTIVE_FOLDER_STATES,
  CLOCK_SKEW_TOLERANCE_MS,
  EARLY_EVAL_DEBOUNCE_MS,
  EARLY_EVAL_MIN_GAP_MS,
  LEADER_CONFIRM_COUNT,
  SYNC_COMPLETE_PERCENTAGE,
  HEALTH_NUDGE_THRESHOLD_MS,
  HEALTH_WARNING_THRESHOLD_MS,
  HEALTH_CHECK_INTERVAL_MS,
};
