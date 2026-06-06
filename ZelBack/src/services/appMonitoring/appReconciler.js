const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const dockerService = require('../dockerService');
const globalState = require('../utils/globalState');
const appInspector = require('../appManagement/appInspector');
const appsRuntimeState = require('../appManagement/appsRuntimeState');
const appQueryService = require('../appQuery/appQueryService');
const containerHealthMonitor = require('./containerHealthMonitor');
const appUninstaller = require('../appLifecycle/appUninstaller');
const appTamperingDetectionService = require('../appTamperingDetectionService');
const { localAppsInformation } = require('../utils/appConstants');

// The single, level-based actuator for app containers. Every trigger (docker
// die event, stream reconnect, hourly tick, boot, post-install, and the
// masterSlave/syncthing deciders) just enqueues a component identifier; one
// reconcile per identifier drives the actual Docker state toward the desired
// state. This is the ONLY place that calls appDockerStart/appDockerStop.
//
// Desired state inputs:
//   operatorStopped (durable, appsRuntimeState) - user lock, wins over all.
//   controllerDesired (in-memory, below)        - election/sync output for g:/r:.
//   restart policy + actual exit code           - Docker-like restart policy.

// id -> 'running' | 'stopped'. In-memory: re-derived from live truth (FDM
// election + real syncthing sync state) by the deciders each cycle, so it is
// intentionally NOT persisted (a stale election after a reboot must not act).
const controllerDesired = new Map();

const inFlight = new Set(); // ids currently reconciling (per-key single-flight)
const dirty = new Set(); // ids re-requested while in flight -> reconcile again
const bootPending = new Set(); // ids enqueued before the boot gate opened
const backoffTimers = new Map(); // id -> scheduled retry timeout

// while an install/remove/redeploy/backup/restore or a deliberate stop owns a
// container, defer and re-check shortly (the operation also re-enqueues on
// completion, so this is just a backstop)
const MANAGED_RETRY_MS = 5000;

// --- restart policy ------------------------------------------------------
// getRestartPolicy is the ONLY place the policy source lives. Today it returns
// the constant 'always' (restores the pre-FluxOS Docker `restart: always`
// behavior). v9: return spec.comp.restartPolicy ?? 'always'.
// eslint-disable-next-line no-unused-vars
function getRestartPolicy(spec) {
  return 'always';
}

/**
 * Whether a stopped container should be (re)started under the given policy and
 * its actual last exit code. exitCode === null means the container has never
 * run (Docker state 'created'), i.e. an initial start.
 */
function policyAllowsRun(policy, exitCode) {
  switch (policy) {
    case 'on-failure': return exitCode === null || exitCode !== 0;
    case 'no': return exitCode === null;
    default: return true; // always / unless-stopped
  }
}

// --- desired/actual state ------------------------------------------------

/**
 * Resolves a component identifier to its local installed spec, or null if the
 * app is not installed on this node. Returns the component, plus g:/r: flags.
 */
async function getLocalComponentSpec(identifier) {
  const mainAppName = identifier.split('_')[1] || identifier;
  let appSpec;
  try {
    const database = dbHelper.databaseConnection().db(config.database.appslocal.database);
    appSpec = await dbHelper.findOneInDatabase(database, localAppsInformation, { name: mainAppName }, { projection: { _id: 0 } });
  } catch (err) {
    log.error(`appReconciler - failed to read local spec for ${identifier}: ${err.message}`);
    return null;
  }
  if (!appSpec) return null;
  try {
    [appSpec] = await appQueryService.decryptEnterpriseApps([appSpec], { formatSpecs: false });
  } catch (err) {
    log.warn(`appReconciler - could not decrypt spec for ${identifier}: ${err.message}`);
  }

  let comp;
  if (appSpec.version >= 4 && Array.isArray(appSpec.compose)) {
    const componentName = identifier.split('_')[0];
    comp = appSpec.compose.find((c) => c.name === componentName);
    if (!comp) return null;
  } else {
    comp = appSpec; // v1-3: the app itself is the single component
  }

  const cd = comp.containerData || '';
  return { appSpec, comp, isG: cd.includes('g:'), isR: cd.includes('r:') };
}

/**
 * Reads the container's actual state from Docker. exitCode is null when the
 * container has never run (state 'created') so restart policies treat it as an
 * initial start.
 */
async function dockerActual(identifier) {
  try {
    const info = await dockerService.dockerContainerInspect(identifier);
    const everRan = info.State && info.State.Status !== 'created';
    return {
      exists: true,
      running: !!(info.State && info.State.Running),
      exitCode: everRan ? (info.State.ExitCode ?? null) : null,
    };
  } catch (err) {
    return { exists: false, running: false, exitCode: null };
  }
}

/**
 * Whether another subsystem currently owns this container — a global
 * install/remove/redeploy, a per-component backup/restore, or the transient
 * window of a deliberate stop/restart/kill (tracked in stoppingContainers).
 * The reconciler must not actuate while one of these is in flight.
 */
function isManagedElsewhere(identifier) {
  if (globalState.isOperationInProgress && globalState.isOperationInProgress()) return true;
  const backup = globalState.backupInProgress || [];
  const restore = globalState.restoreInProgress || [];
  if (backup.includes(identifier) || restore.includes(identifier)) return true;
  if (globalState.stoppingContainers.has(dockerService.getAppIdentifier(identifier))) return true;
  return false;
}

async function effectiveDesiredRunning(identifier, spec, exitCode) {
  if (await appsRuntimeState.isOperatorStopped(identifier)) return false;
  if (spec.isG || spec.isR) {
    if (controllerDesired.get(identifier) !== 'running') return false;
  }
  return policyAllowsRun(getRestartPolicy(spec), exitCode);
}

/**
 * Recreates a vanished container (no Docker event fires for absence), recording
 * the tampering signals and falling back to local removal on failure — the
 * behavior previously in containerHealthMonitor.monitorAndRecoverApps.
 */
async function recreateMissing(identifier) {
  const mainAppName = identifier.split('_')[1] || identifier;

  await appTamperingDetectionService.recordEvent(mainAppName, 'container_vanished', `Container ${identifier} missing, not found in Docker`);
  try {
    await containerHealthMonitor.recreateMissingContainers(identifier);
    appInspector.startAppMonitoring(identifier, globalState.appsMonitored);
    log.info(`appReconciler - recreated missing container ${identifier}`);
  } catch (err) {
    log.error(`appReconciler - failed to recreate ${identifier}: ${err.message}`);
    await appTamperingDetectionService.recordEvent(mainAppName, 'recreation_failed', `Container recreation failure: ${err.message}`);
    if (appTamperingDetectionService.isNetworkMissingError(err.message)) {
      await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Docker network missing during recreation: ${err.message}`);
    }
    log.warn(`REMOVAL REASON: Container recreation failure - ${mainAppName} (appReconciler)`);
    await appUninstaller.removeAppLocally(mainAppName, null, false, true, true);
  }
}

// --- the reconcile -------------------------------------------------------

async function reconcile(identifier) {
  if (isManagedElsewhere(identifier)) {
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }

  const spec = await getLocalComponentSpec(identifier);
  if (!spec) return; // not installed here - nothing to enforce

  const actual = await dockerActual(identifier);
  const desired = await effectiveDesiredRunning(identifier, spec, actual.exitCode);

  if (!desired) {
    if (actual.running) {
      log.info(`appReconciler - ${identifier} desired stopped, stopping`);
      await dockerService.appDockerStop(identifier);
    }
    return;
  }

  if (actual.running) return; // already where we want it

  if (!actual.exists) {
    await recreateMissing(identifier);
    return;
  }

  // exists but stopped, should run -> backoff-paced restart (no sleeping; the
  // worker re-enqueues when the backoff window elapses)
  const wait = await appsRuntimeState.restartWaitMs(identifier);
  if (wait > 0) {
    log.warn(`appReconciler - ${identifier} stopped, backing off ${Math.round(wait / 1000)}s before restart`);
    scheduleRetry(identifier, wait);
    return;
  }

  await appsRuntimeState.recordRestart(identifier);
  await dockerService.appDockerStart(identifier);
  appInspector.startAppMonitoring(identifier, globalState.appsMonitored);
  log.info(`appReconciler - ${identifier} restarted`);
}

// --- workqueue (per-key single-flight, boot-gated) -----------------------

function scheduleRetry(identifier, delayMs) {
  if (backoffTimers.has(identifier)) clearTimeout(backoffTimers.get(identifier));
  const timer = setTimeout(() => {
    backoffTimers.delete(identifier);
    enqueue(identifier);
  }, delayMs);
  if (timer.unref) timer.unref();
  backoffTimers.set(identifier, timer);
}

function runReconcile(identifier) {
  reconcile(identifier)
    .catch((err) => log.error(`appReconciler - reconcile ${identifier} failed: ${err.message}`))
    .finally(() => {
      inFlight.delete(identifier);
      if (dirty.has(identifier)) {
        dirty.delete(identifier);
        setImmediate(() => enqueue(identifier));
      }
    });
}

/**
 * Schedule a reconcile of one component. Coalesces: if a reconcile for the
 * same identifier is in flight, it re-runs once when that finishes. Held until
 * the boot gate opens so nothing actuates before daemon/DB are ready.
 */
function enqueue(identifier) {
  if (!globalState.bootContainerStateSettled) {
    bootPending.add(identifier);
    return;
  }
  if (inFlight.has(identifier)) {
    dirty.add(identifier);
    return;
  }
  inFlight.add(identifier);
  runReconcile(identifier);
}

/**
 * Enqueue every installed component (hourly tick / reconnect / boot drift).
 */
async function enqueueAll() {
  const res = await appQueryService.installedApps();
  if (!res || res.status !== 'success') return;
  for (const app of res.data) {
    if (app.version >= 4 && Array.isArray(app.compose)) {
      app.compose.forEach((c) => enqueue(`${c.name}_${app.name}`));
    } else {
      enqueue(app.name);
    }
  }
}

// --- controllerDesired seam (written by masterSlave/syncthing deciders) ---

/**
 * A decider (masterSlave election / syncthing readiness) declares the desired
 * run-state of a g:/r: component and triggers enforcement. The decider does its
 * own synchronous data-safety steps (stop+wipe, permission-fix) first; this
 * only records intent and enqueues.
 */
function setControllerDesired(identifier, state, reason) {
  controllerDesired.set(identifier, state);
  log.info(`appReconciler - controllerDesired[${identifier}] = ${state} (${reason})`);
  enqueue(identifier);
}

function clearControllerDesired(identifier) {
  controllerDesired.delete(identifier);
}

// --- lifecycle -----------------------------------------------------------

let started = false;

async function start() {
  if (started) return;
  started = true;
  await globalState.waitForBootContainerStateSettled();
  // drain everything enqueued during boot now that daemon/DB are ready
  const pending = [...bootPending];
  bootPending.clear();
  pending.forEach((id) => enqueue(id));
}

function stop() {
  started = false;
  backoffTimers.forEach((t) => clearTimeout(t));
  backoffTimers.clear();
  inFlight.clear();
  dirty.clear();
  bootPending.clear();
}

module.exports = {
  enqueue,
  enqueueAll,
  setControllerDesired,
  clearControllerDesired,
  start,
  stop,
  // exposed for tests
  reconcile,
  policyAllowsRun,
  getRestartPolicy,
};
