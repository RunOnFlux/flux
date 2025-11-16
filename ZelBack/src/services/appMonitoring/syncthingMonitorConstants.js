// Syncthing Monitor - Constants

// Timeout values (milliseconds)
const DEVICE_ID_REQUEST_TIMEOUT_MS = 5000;
const MONITOR_INTERVAL_MS = 30 * 1000; // 30 seconds
const OPERATION_DELAY_MS = 500;
const ERROR_RETRY_DELAY_MS = 5 * 1000; // 5 seconds
const SYNC_STATE_LOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Syncthing configuration
const SYNCTHING_RESCAN_INTERVAL_SECONDS = 900; // 15 minutes
const SYNCTHING_MAX_CONFLICTS = 0;

// Sync monitoring
const MAX_SYNC_WAIT_EXECUTIONS = 120; // ~1 hour at 30s intervals
const STALLED_SYNC_CHECK_COUNT = 10; // Number of checks with no progress before considering sync stalled (~5 minutes)
const CLOCK_SKEW_TOLERANCE_MS = 5000; // 5 seconds tolerance for timestamp comparison
const LEADER_ELECTION_MIN_EXECUTIONS = 2;
const LEADER_ELECTION_EXECUTIONS_PER_INDEX = 10;

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
  MAX_SYNC_WAIT_EXECUTIONS,
  STALLED_SYNC_CHECK_COUNT,
  CLOCK_SKEW_TOLERANCE_MS,
  LEADER_ELECTION_MIN_EXECUTIONS,
  LEADER_ELECTION_EXECUTIONS_PER_INDEX,
  SYNC_COMPLETE_PERCENTAGE,
  HEALTH_STOP_THRESHOLD_MS,
  HEALTH_RESTART_SYNCTHING_THRESHOLD_MS,
  HEALTH_REMOVE_THRESHOLD_MS,
  HEALTH_WARNING_THRESHOLD_MS,
  HEALTH_PEERS_BEHIND_THRESHOLD_MS,
  HEALTH_CHECK_INTERVAL_MS,
};
