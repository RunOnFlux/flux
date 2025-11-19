# Syncthing Health Monitor Service

## Overview

The Syncthing Health Monitor Service (`syncthingHealthMonitor.js`) provides automated health monitoring and corrective actions for Syncthing-based distributed application data synchronization in the Flux network. It monitors folder health across nodes and takes escalating actions when connectivity or synchronization issues persist.

## Table of Contents

1. [Purpose and Goals](#purpose-and-goals)
2. [Core Workflow](#core-workflow)
3. [Health Status Tracking](#health-status-tracking)
4. [Issue Detection](#issue-detection)
5. [Stall Detection Logic](#stall-detection-logic)
6. [Escalating Actions](#escalating-actions)
7. [Integration with App Lifecycle](#integration-with-app-lifecycle)
8. [API Reference](#api-reference)
9. [Configuration](#configuration)
10. [Detailed Scenarios](#detailed-scenarios)
11. [Logging](#logging)
12. [Error Handling](#error-handling)
13. [Best Practices](#best-practices)

---

## Purpose and Goals

The health monitor service addresses several critical scenarios:

1. **Node Isolation** - Detect when a node loses all peer connections
2. **Sync Failures** - Identify folders that cannot synchronize data
3. **Stale Data** - Detect when local data falls behind peers
4. **Stalled Syncs** - Identify when sync claims to be active but makes no progress
5. **Automatic Recovery** - Take corrective actions to restore healthy state
6. **Graceful Degradation** - Prevent problematic apps from affecting the network

### Key Principle: Only Monitor Ready Apps

The service **only monitors apps that have completed their initial installation/synchronization process**. This is tracked via the `receiveOnlySyncthingAppsCache` Map where:

```javascript
// App is ready for health monitoring when:
const appCache = receiveOnlySyncthingAppsCache.get(appId);
if (appCache && appCache.restarted === true) {
  // Safe to monitor this app's folders
}
```

This prevents false positives during initial sync where temporary issues are expected.

---

## Core Workflow

### Main Monitoring Loop

The health monitor runs as part of the main syncthing monitoring cycle:

```
Every 5 minutes (HEALTH_CHECK_INTERVAL_MS):
│
├─ 1. Check pre-conditions
│   ├─ Skip if installation in progress
│   ├─ Skip if removal in progress
│   ├─ Skip if soft redeploy in progress
│   ├─ Skip if hard redeploy in progress
│   ├─ Skip if backup in progress
│   └─ Skip if restore in progress
│
├─ 2. Get peer sync diagnostics from Syncthing API
│
├─ 3. For each configured folder:
│   │
│   ├─ 3a. Extract app name from folder ID
│   │   └─ fluxmyapp → myapp
│   │   └─ fluxweb_myapp → myapp (compose app)
│   │
│   ├─ 3b. Check if app is ready (restarted === true)
│   │   └─ Skip if not ready
│   │
│   ├─ 3c. Get/create health status for folder
│   │
│   ├─ 3d. Detect issues:
│   │   ├─ Global isolation (no peers connected)
│   │   ├─ Cannot sync (all folder peers disconnected)
│   │   └─ Peers behind + not syncing OR stalled
│   │
│   ├─ 3e. Determine action based on issue duration
│   │
│   ├─ 3f. Execute corrective action if needed
│   │
│   └─ 3g. Auto-restart if issues resolved
│
├─ 4. Clean up cache for deleted folders
│
└─ 5. Return results summary
```

### Execution Flow

```javascript
// Called from syncthingMonitor.js
if (now - state.lastHealthCheckTime >= HEALTH_CHECK_INTERVAL_MS) {
  const healthResults = await monitorFolderHealth({
    foldersConfiguration,
    folderHealthCache: state.folderHealthCache,
    appDockerStopFn,
    appDockerStartFn: dockerService.appDockerStart,
    removeAppLocallyFn,
    state,
    receiveOnlySyncthingAppsCache: state.receiveOnlySyncthingAppsCache,
  });
  state.lastHealthCheckTime = now;
}
```

---

## Health Status Tracking

### FolderHealthStatus Object

Each monitored folder maintains a health status:

```javascript
{
  isolatedSince: number | null,      // Timestamp when node became isolated (no peers)
  cannotSyncSince: number | null,    // Timestamp when folder lost ability to sync
  peersBehindSince: number | null,   // Timestamp when local data fell behind peers
  lastHealthyTimestamp: number,      // Last time folder was completely healthy
  lastAction: string,                // Last corrective action taken: 'none', 'warning', 'stopped', 'restarted_syncthing', 'removed'
  appWasStopped: boolean,            // Track if app was stopped for auto-restart
  lastSyncPercentage: number | null  // Track sync progress for stall detection
}
```

### Health Cache Lifecycle

```javascript
// 1. Creation: First time folder is monitored
getOrCreateHealthStatus(cache, folderId);

// 2. Issue detection: Timestamps set when issues occur
healthStatus.cannotSyncSince = Date.now();

// 3. Issue resolution: Timestamps cleared
healthStatus.cannotSyncSince = null;

// 4. Health reset: When all issues clear
resetHealthStatus(healthStatus);
// Clears: isolatedSince, cannotSyncSince, peersBehindSince, lastAction, appWasStopped
// Preserves: lastSyncPercentage (for stall detection continuity)

// 5. Cleanup: When folder no longer exists
folderHealthCache.delete(folderId);
```

---

## Issue Detection

### Issue Detection Decision Tree

```
For each folder:
│
├─ ISSUE 1: Global Isolation
│   └─ Condition: summary.connectedPeers.length === 0 && totalFolders > 0
│   └─ Action: Log warnings only (no corrective actions - too risky)
│
├─ ISSUE 2: Cannot Sync
│   └─ Condition: !folderDiag.canSync && peerStatuses.length > 0
│   └─ Meaning: Folder has peers configured but all are disconnected
│   └─ Action: Escalating corrective actions
│
└─ ISSUE 3: Peers Behind
    ├─ Check 1: peersAreMoreUpdated === true
    ├─ Check 2: syncPercentage < 100
    ├─ Check 3: NOT actively syncing OR sync is stalled
    │   ├─ Active sync: state === 'syncing' || state === 'sync-preparing'
    │   └─ Stalled: percentage same as last check
    └─ Action: Escalating corrective actions
```

### Issue State Transitions

```
HEALTHY → ISSUE DETECTED → WARNING → STOPPED → SYNCTHING RESTARTED → REMOVED
   ↑
   └────────────────── AUTO-RESTART (issues resolved) ──────────────────────┘
```

---

## Stall Detection Logic

### The Problem

A sync might report `state: 'syncing'` but actually be stuck (no progress). This would fool a simple state check.

### The Solution

Compare sync percentage between health checks (every 5 minutes):

```javascript
// Each health check
const currentSyncPercentage = folderDiag.localStatus?.syncPercentage || 0;
const isActivelySyncing = folderState === 'syncing' || folderState === 'sync-preparing';

let isSyncStalled = false;
if (isActivelySyncing && folderDiag.peersAreMoreUpdated && currentSyncPercentage < 100) {
  // Compare with previous check
  if (healthStatus.lastSyncPercentage !== null &&
      currentSyncPercentage === healthStatus.lastSyncPercentage) {
    isSyncStalled = true; // No progress since last check!
  }
}

// Always update for next comparison
healthStatus.lastSyncPercentage = currentSyncPercentage;
```

### Stall Detection Scenarios

| Check # | Time | State | Percentage | Previous | Result |
|---------|------|-------|------------|----------|--------|
| 1 | 0:00 | syncing | 50% | null | HEALTHY (first check) |
| 2 | 0:05 | syncing | 55% | 50% | HEALTHY (progress) |
| 3 | 0:10 | syncing | 55% | 55% | **STALLED** (no progress) |
| 4 | 0:15 | syncing | 60% | 55% | HEALTHY (progress resumes) |
| 5 | 0:20 | idle | 60% | 60% | **ISSUE** (not syncing) |

### First Check Grace Period

On the first check for a folder (`lastSyncPercentage === null`), the sync is NOT flagged as stalled even if behind. This gives new syncs a grace period.

---

## Escalating Actions

### Action Timeline

The service uses time-based escalation based on issue duration:

| Duration | Action | Description | Code |
|----------|--------|-------------|------|
| 0-5 min | None | Grace period for transient issues | - |
| 5-10 min | **Warning** | Log warning, continue monitoring | `lastAction = 'warning'` |
| 10-15 min | **Stop** | Stop container to prevent serving stale data | `appDockerStopFn(folderId)` |
| 15-30 min | **Restart Syncthing** | Restart Syncthing service to re-establish connections | `syncthingService.systemRestart()` |
| 150+ min (2h30) | **Remove** | Remove app locally to force reinstallation | `removeAppLocallyFn(appName)` |

### Action Priority Logic

```javascript
function determineAction(issueSince, currentAction) {
  const duration = Date.now() - issueSince;

  // Priority: remove > restart_syncthing > stop > warning
  if (duration >= HEALTH_REMOVE_THRESHOLD_MS) {
    return 'remove';
  }
  if (duration >= HEALTH_RESTART_SYNCTHING_THRESHOLD_MS &&
      currentAction !== 'restarted_syncthing' && currentAction !== 'removed') {
    return 'restart_syncthing';
  }
  if (duration >= HEALTH_STOP_THRESHOLD_MS &&
      !['stopped', 'restarted_syncthing', 'removed'].includes(currentAction)) {
    return 'stop';
  }
  if (duration >= HEALTH_WARNING_THRESHOLD_MS && currentAction === 'none') {
    return 'warning';
  }
  return 'none';
}
```

### Automatic Recovery

When all issues resolve, the system automatically restarts stopped apps:

```javascript
if (!hasIssue) {
  if (healthStatus.appWasStopped) {
    log.info(`Issues resolved for ${folderId}, restarting app`);
    await appDockerStartFn(folderId);
    results.actions.push({ action: 'restart_app', reason: 'issues_resolved' });
  }
  resetHealthStatus(healthStatus);
}
```

---

## Integration with App Lifecycle

### Pre-Monitoring Check

```javascript
// Extract app name from folder ID
const appName = extractAppNameFromFolderId(folderId);
// fluxmyapp → myapp
// fluxweb_myapp → myapp

// Check if app completed initial process
const appCache = receiveOnlySyncthingAppsCache.get(appName);
if (!appCache || appCache.restarted !== true) {
  log.debug(`Skipping ${folderId}, initial process not completed`);
  continue; // Skip this folder
}
```

### When Apps Are Marked Ready

Apps are marked ready (`restarted: true`) in `syncthingFolderStateMachine.js` after:

1. **First Run Completion** - Initial Syncthing setup complete
2. **Leader Election** - Node becomes designated leader in sendreceive mode
3. **Sync Completion** - Folder reaches 100% synchronization
4. **Timeout Fallback** - Maximum execution count reached

Also set during soft/hard redeploys in `advancedWorkflows.js`.

### Skip Conditions (Prevents Race Conditions)

```javascript
if (state.installationInProgress ||
    state.removalInProgress ||
    state.softRedeployInProgress ||
    state.hardRedeployInProgress) {
  log.info('Skipping health check, other operations in progress');
  return { checked: false, actions: [] };
}

// Skip if backup or restore in progress
if ((state.backupInProgress && state.backupInProgress.length > 0) ||
    (state.restoreInProgress && state.restoreInProgress.length > 0)) {
  log.info('Skipping health check, backup or restore in progress');
  return { checked: false, actions: [] };
}
```

---

## API Reference

### monitorFolderHealth(params)

Main monitoring function that checks all configured folders.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `foldersConfiguration` | Array | Array of Syncthing folder config objects |
| `folderHealthCache` | Map | Cache for health tracking (key: folderId) |
| `appDockerStopFn` | Function | Stop container function |
| `appDockerStartFn` | Function | Start container function |
| `removeAppLocallyFn` | Function | Remove app function |
| `state` | Object | Global state object |
| `receiveOnlySyncthingAppsCache` | Map | Cache tracking app initialization |

**Returns:**

```javascript
{
  checked: boolean,           // Whether check was performed
  timestamp: number,          // When check occurred
  actions: Array<{            // Actions taken
    folderId: string,
    appName?: string,         // Only for remove action
    action: string,           // 'warning', 'stop', 'restart_syncthing', 'remove', 'restart_app'
    reason: string,           // 'cannot_sync', 'peers_behind', 'issues_resolved'
    durationMinutes: number   // How long issue persisted
  }>,
  diagnostics: Object,        // Raw peer sync diagnostics
  foldersHealthy: number,     // Count of healthy folders
  foldersWithIssues: number,  // Count of folders with issues
  error?: string              // Error message if failed
}
```

### extractAppNameFromFolderId(folderId)

Extract app name from Syncthing folder ID.

```javascript
extractAppNameFromFolderId('fluxmyapp');           // Returns: 'myapp'
extractAppNameFromFolderId('fluxweb_myapp');       // Returns: 'myapp'
extractAppNameFromFolderId('fluxdb_my_app_name');  // Returns: 'my_app_name'
extractAppNameFromFolderId('flux');                // Returns: ''
```

### shouldRemoveFolder(folderId, folderHealthCache)

Quick check if a folder should be removed.

```javascript
const shouldRemove = shouldRemoveFolder('fluxmyapp', healthCache);
// Returns true if cannotSyncSince or peersBehindSince exceeds HEALTH_REMOVE_THRESHOLD_MS
```

### getHealthSummary(folderHealthCache)

Get summary statistics of all monitored folders.

```javascript
const summary = getHealthSummary(healthCache);
// Returns:
{
  totalFolders: number,
  healthy: number,
  warning: number,
  stopped: number,
  removed: number,
  issues: Array<{
    folderId: string,
    isolatedSince: number | null,
    cannotSyncSince: number | null,
    peersBehindSince: number | null,
    lastAction: string
  }>
}
```

### getOrCreateHealthStatus(folderHealthCache, folderId)

Get or initialize health status for a folder.

### resetHealthStatus(healthStatus)

Reset health status when folder becomes healthy (preserves lastSyncPercentage).

---

## Configuration

### Threshold Configuration

Defined in `syncthingMonitorConstants.js`:

```javascript
// How often health checks run
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;          // 5 minutes

// Issue duration thresholds for actions
const HEALTH_WARNING_THRESHOLD_MS = 5 * 60 * 1000;       // 5 minutes - log warning
const HEALTH_STOP_THRESHOLD_MS = 10 * 60 * 1000;         // 10 minutes - stop container
const HEALTH_RESTART_SYNCTHING_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes - restart syncthing
const HEALTH_REMOVE_THRESHOLD_MS = 2.5 * 60 * 60 * 1000; // 2h30 - remove app

// Note: Stall detection has no separate threshold
// It compares percentage between checks (implicit 5-minute window)
```

### Customizing Thresholds

To adjust thresholds, modify `syncthingMonitorConstants.js`. Consider:

- **Longer thresholds**: More tolerant of temporary issues, less aggressive
- **Shorter thresholds**: Faster response, but risk of false positives
- **HEALTH_CHECK_INTERVAL_MS**: Affects stall detection sensitivity (smaller = more sensitive)

---

## Detailed Scenarios

### Scenario 1: Normal Operation

```
Time 0:00 - Health Check
├─ Folder: fluxmyapp
├─ App cache: { restarted: true }
├─ Diagnostics: { canSync: true, peersAreMoreUpdated: false, syncPercentage: 100 }
├─ Result: HEALTHY
└─ Actions: None
```

### Scenario 2: Temporary Connectivity Loss (Self-Healing)

```
Time 0:00 - Health Check
├─ Diagnostics: { canSync: false } // Peer disconnected
├─ cannotSyncSince: 0:00
└─ Result: ISSUE DETECTED

Time 0:05 - Health Check
├─ Diagnostics: { canSync: false }
├─ Duration: 5 minutes
├─ Action: WARNING logged
└─ lastAction: 'warning'

Time 0:10 - Health Check
├─ Diagnostics: { canSync: true } // Peer reconnected!
├─ cannotSyncSince: null (cleared)
├─ Action: None needed
└─ Result: HEALTHY (auto-healed)
```

### Scenario 3: Persistent Issue Escalation

```
Time 0:00 - cannotSyncSince set
Time 0:05 - WARNING logged
Time 0:10 - Container STOPPED
Time 0:15 - Syncthing RESTARTED
Time 2:30 - App REMOVED (cluster rebalancing)
```

### Scenario 4: Stalled Sync Detection

```
Time 0:00 - Health Check
├─ State: syncing, Percentage: 50%
├─ lastSyncPercentage: null (first check)
├─ Result: HEALTHY (grace period)
└─ Updated: lastSyncPercentage = 50%

Time 0:05 - Health Check
├─ State: syncing, Percentage: 50%
├─ lastSyncPercentage: 50% (same!)
├─ Result: STALLED → peersBehindSince set
└─ Updated: lastSyncPercentage = 50%

Time 0:10 - Health Check
├─ State: syncing, Percentage: 50%
├─ Duration: 5 minutes
└─ Action: WARNING logged

Time 0:15 - Health Check
├─ State: syncing, Percentage: 55% (progress!)
├─ Result: HEALTHY (cleared peersBehindSince)
└─ Updated: lastSyncPercentage = 55%
```

### Scenario 5: App Not Ready (Skipped)

```
Time 0:00 - Health Check
├─ Folder: fluxnewapp
├─ App cache: { restarted: false } // Still in initial sync
├─ Result: SKIPPED
└─ Log: "Skipping fluxnewapp, initial process not completed"
```

### Scenario 6: Multiple Folders

```
Time 0:00 - Health Check
├─ fluxapp1: HEALTHY (100%, idle)
├─ fluxapp2: ISSUE (canSync: false)
├─ fluxapp3: HEALTHY (75%, syncing with progress)
└─ Results: { foldersHealthy: 2, foldersWithIssues: 1 }
```

### Scenario 7: Global Isolation

```
Time 0:00 - Health Check
├─ summary.connectedPeers: []
├─ All folders marked as isolated
├─ Action: Log warnings ONLY (no stop/remove)
└─ Reason: Global isolation too risky for automatic actions
```

---

## Logging

The service provides detailed logging for monitoring and debugging:

### Log Levels

**INFO** - Normal operations
```
monitorFolderHealth - Health check complete: 5 healthy, 1 with issues
monitorFolderHealth - Folder fluxmyapp connectivity restored
monitorFolderHealth - Folder fluxmyapp is now actively syncing, clearing peers behind issue
monitorFolderHealth - Issues resolved for fluxmyapp, restarting app
```

**WARN** - Issues detected
```
monitorFolderHealth - Node is ISOLATED: No peers connected, 3 folders configured
monitorFolderHealth - Folder fluxmyapp cannot sync: Peer disconnected
monitorFolderHealth - Folder fluxmyapp peers have more updated data but not syncing (local: 80.00%, state: idle)
monitorFolderHealth - Folder fluxmyapp sync appears STALLED: stuck at 50.00% (same as last check)
monitorFolderHealth - WARNING: fluxmyapp has cannot_sync issue for 6 minutes
monitorFolderHealth - STOPPING fluxmyapp due to cannot_sync for 11 minutes
monitorFolderHealth - RESTARTING SYNCTHING for fluxmyapp due to cannot_sync for 21 minutes
```

**ERROR** - Critical actions
```
monitorFolderHealth - REMOVING app myapp (folder fluxmyapp) due to cannot_sync for 151 minutes
monitorFolderHealth - Failed to stop fluxmyapp: Container not found
monitorFolderHealth - Error: Network error
```

**DEBUG** - Skipped operations
```
monitorFolderHealth - Skipping fluxmyapp (app myapp), initial process not completed
```

---

## Error Handling

### Graceful Error Recovery

The service handles errors without crashing:

```javascript
// Top-level error handling
try {
  const diagnostics = await syncthingService.getPeerSyncDiagnostics();
  // ... monitoring logic
} catch (error) {
  log.error(`monitorFolderHealth - Error: ${error.message}`);
  results.error = error.message;
  return results; // Return partial results, don't crash
}

// Per-action error handling
try {
  await removeAppLocallyFn(appName, null, true, false, false);
  healthStatus.lastAction = 'removed';
} catch (error) {
  log.error(`Failed to remove ${appName}: ${error.message}`);
  // Continue monitoring other folders
}
```

### Error Scenarios

1. **Syncthing API unavailable**: Returns `{ checked: true, error: 'message' }`
2. **Docker operation fails**: Logs error, continues to next folder
3. **App removal fails**: Logs error, lastAction NOT updated (will retry)
4. **Invalid diagnostics**: Logs warning, skips folder

---

## Best Practices

### For Operators

1. **Monitor logs** - Watch for escalating actions that indicate persistent problems
2. **Review thresholds** - Adjust timing thresholds based on network conditions
3. **Check global isolation** - May indicate network issues, not app problems
4. **Verify app readiness** - Ensure apps have `restarted: true` before expecting monitoring

### For Developers

1. **Don't bypass initialization check** - Always ensure apps complete initial sync
2. **Test recovery paths** - Verify automatic recovery works after issues resolve
3. **Consider edge cases** - Stalled syncs, component naming, multiple folders
4. **Handle cache cleanup** - Ensure cache doesn't grow unbounded

### Monitoring Recommendations

1. **Set up alerting** for ERROR level logs (app removals)
2. **Track metrics** like `foldersWithIssues` over time
3. **Monitor action frequency** - High frequency may indicate systemic issues
4. **Review stall detection** - Adjust HEALTH_CHECK_INTERVAL_MS if needed

---

## Testing

The service has comprehensive unit tests covering:

- **46 test cases** in `tests/unit/syncthingHealthMonitor.test.js`
- Helper functions (extractAppNameFromFolderId, getOrCreateHealthStatus, resetHealthStatus)
- Query functions (shouldRemoveFolder, getHealthSummary)
- Issue detection (isolation, cannot sync, peers behind, stalled sync)
- Escalating actions (warning, stop, restart syncthing, remove)
- Automatic recovery
- Edge cases (first check, component names, multiple folders, error handling)
- Skip conditions (installation, removal, redeploy, backup, restore in progress)
- Backwards compatibility

Run tests:
```bash
npx mocha tests/unit/syncthingHealthMonitor.test.js --require ./tests/init
```

---

## Future Enhancements

1. **Metrics Export** - Export health metrics for Prometheus/Grafana
2. **Notification System** - Alert operators when critical actions are taken
3. **Configurable Per-App Thresholds** - Different apps may need different tolerances
4. **Machine Learning** - Predict failures based on historical patterns
5. **Granular Peer Analysis** - More detailed peer-by-peer health tracking
6. **Health Dashboard** - Visual representation of cluster health
