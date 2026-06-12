// Syncthing Monitor - Constants

const config = require('config');

// Timeout values (milliseconds)
const DEVICE_ID_REQUEST_TIMEOUT_MS = 5000;
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

// Folder states in which syncthing is actively working: flat bytes are healthy
// here (e.g. a long sync-preparing phase on a large folder)
const ACTIVE_FOLDER_STATES = ['syncing', 'sync-preparing', 'sync-waiting', 'scanning', 'scan-waiting', 'cleaning', 'clean-waiting'];

const CLOCK_SKEW_TOLERANCE_MS = 5000; // 5 seconds tolerance for timestamp comparison
// Consecutive cycles a node must observe itself as the designated leader before
// acting on it, so a single transient drop of a peer's running-location doesn't
// flip a follower into self-promoting (and starting the app). Tunable for tests.
const LEADER_CONFIRM_COUNT = config.syncthing.leaderConfirmCount ?? 2;

// Sync completion thresholds
const SYNC_COMPLETE_PERCENTAGE = 100;

// Health monitoring thresholds (milliseconds). The health watchdog alerts and
// nudges only - it never stops containers, restarts syncthing or removes apps
const HEALTH_WARNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - log warning
const HEALTH_NUDGE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes - device pause/resume nudge (and min interval between nudges)
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - how often to run health checks

module.exports = {
  DEVICE_ID_REQUEST_TIMEOUT_MS,
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
  ACTIVE_FOLDER_STATES,
  CLOCK_SKEW_TOLERANCE_MS,
  LEADER_CONFIRM_COUNT,
  SYNC_COMPLETE_PERCENTAGE,
  HEALTH_NUDGE_THRESHOLD_MS,
  HEALTH_WARNING_THRESHOLD_MS,
  HEALTH_CHECK_INTERVAL_MS,
};
