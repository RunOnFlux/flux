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

// Sync monitoring
const STALLED_SYNC_CHECK_COUNT = config.syncthing.stalledSyncCheckCount ?? 10; // no-progress checks before sync is "stalled" (~5 minutes)
const CLOCK_SKEW_TOLERANCE_MS = 5000; // 5 seconds tolerance for timestamp comparison
// Consecutive cycles a node must observe itself as the designated leader before
// acting on it, so a single transient drop of a peer's running-location doesn't
// flip a follower into self-promoting (and starting the app). Tunable for tests.
const LEADER_CONFIRM_COUNT = config.syncthing.leaderConfirmCount ?? 2;

// Sync completion thresholds
const SYNC_COMPLETE_PERCENTAGE = 100;

// Health monitoring thresholds (milliseconds)
const HEALTH_WARNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - log warning
const HEALTH_STOP_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes - stop app container
const HEALTH_RESTART_SYNCTHING_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes - restart syncthing service
const HEALTH_REMOVE_THRESHOLD_MS = 2.5 * 60 * 60 * 1000; // 2h30 - remove app for cluster rebalancing
const HEALTH_PEERS_BEHIND_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes - if peers have more data but node not syncing (reserved)
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - how often to run health checks

module.exports = {
  DEVICE_ID_REQUEST_TIMEOUT_MS,
  MONITOR_INTERVAL_MS,
  OPERATION_DELAY_MS,
  ERROR_RETRY_DELAY_MS,
  SYNC_STATE_LOG_INTERVAL_MS,
  SYNCTHING_RESCAN_INTERVAL_SECONDS,
  SYNCTHING_MAX_CONFLICTS,
  STALLED_SYNC_CHECK_COUNT,
  CLOCK_SKEW_TOLERANCE_MS,
  LEADER_CONFIRM_COUNT,
  SYNC_COMPLETE_PERCENTAGE,
  HEALTH_STOP_THRESHOLD_MS,
  HEALTH_RESTART_SYNCTHING_THRESHOLD_MS,
  HEALTH_REMOVE_THRESHOLD_MS,
  HEALTH_WARNING_THRESHOLD_MS,
  HEALTH_PEERS_BEHIND_THRESHOLD_MS,
  HEALTH_CHECK_INTERVAL_MS,
};
