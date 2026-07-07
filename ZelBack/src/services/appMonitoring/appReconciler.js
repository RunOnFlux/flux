const config = require('config');
const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const dockerOperations = require('../appManagement/dockerOperations');
const volumeService = require('../utils/volumeService');
const mountParser = require('../utils/mountParser');
const globalState = require('../utils/globalState');
const appInspector = require('../appManagement/appInspector');
const appsRuntimeState = require('../appManagement/appsRuntimeState');
const appQueryService = require('../appQuery/appQueryService');
const containerHealthMonitor = require('./containerHealthMonitor');
const appUninstaller = require('../appLifecycle/appUninstaller');
const appTamperingDetectionService = require('../appTamperingDetectionService');
const { localAppsInformation } = require('../utils/appConstants');
const { AsyncGate } = require('../utils/asyncGate');

// The single, level-based actuator for app containers. Every trigger (docker
// die event, stream reconnect, hourly tick, boot, post-install, and the
// masterSlave/syncthing deciders) just enqueues a component identifier; one
// reconcile per identifier drives the actual Docker state toward the desired
// state. This is the ONLY place that calls appDockerStart/appDockerStop. It also
// force-removes and recreates a container that came up detached from its own
// docker network (a stale libnetwork endpoint), which a start alone cannot fix.
//
// Desired state inputs:
//   operatorStopped (durable, appsRuntimeState) - user lock, wins over all.
//   controllerDesired (in-memory, below)        - election/sync output for g:/r:.
//   dataDesired       (in-memory, below)        - sync layer's local-appdata reset.
//   restart policy + actual exit code           - Docker-like restart policy.

// id -> 'running' | 'stopped'. In-memory: re-derived from live truth (FDM
// election + real syncthing sync state) by the deciders each cycle, so it is
// intentionally NOT persisted (a stale election after a reboot must not act).
const controllerDesired = new Map();

// id -> 'clear'. In-memory peer of controllerDesired: a pending request from the
// sync layer to wipe the component's local appdata before it next runs (the
// first-run / new-app reset). Also NOT persisted - a stale wipe intent surviving
// a restart could delete the only good copy (the same data-loss direction B1
// guards). The reconciler actuates the wipe inside its per-key single-flight, so
// a start can never race it.
const dataDesired = new Map();

// brief settle between the stop and the rm -rf so the container has fully released
// its appdata mount before the wipe (mirrors the sync layer's prior 500ms delay).
const DATA_CLEAR_SETTLE_MS = 500;

const inFlight = new Set(); // ids currently reconciling (per-key single-flight)
const dirty = new Set(); // ids re-requested while in flight -> reconcile again
const bootPending = new Set(); // ids enqueued before the boot gate opened
const backoffTimers = new Map(); // id -> scheduled retry timeout

// The boot-drain gate: opens once every boot-held component has completed ONE
// reconcile pass (started, backoff-deferred, awaiting-controller, or failed
// loudly) - NOT "all containers running". The first apprunning broadcast waits
// on it so the snapshot doesn't race the boot starts (rows the snapshot misses
// expire on the ~7min sigterm TTL and the app respawns elsewhere). Capped so a
// wedged reconcile can never suppress the node's network presence.
const BOOT_DRAIN_SETTLE_CAP_MS = 2 * 60 * 1000;
const bootDrainGate = new AsyncGate();
const bootDraining = new Set(); // boot-held ids still on their first pass
let bootDrainCapTimer = null;

function settleBootDrain(reason) {
  if (bootDrainGate.ready) return;
  if (bootDrainCapTimer) {
    clearTimeout(bootDrainCapTimer);
    bootDrainCapTimer = null;
  }
  bootDraining.clear();
  bootDrainGate.open();
  log.info(`appReconciler - boot drain settled (${reason})`);
}

// A container start is information the network wants immediately: a backoff
// straggler that starts minutes after boot must refresh its appsLocations row
// inside the sigterm TTL window, not at the next hourly broadcast.
// serviceManager wires this to the peer broadcast (which coalesces bursts),
// mirroring appInstaller.setOnInstallComplete.
let onContainerStarted = null;

function setOnContainerStarted(callback) {
  onContainerStarted = callback;
}

function notifyContainerStarted(identifier) {
  if (!onContainerStarted) return;
  try {
    onContainerStarted(identifier);
  } catch (err) {
    log.error(`appReconciler - onContainerStarted callback failed for ${identifier}: ${err.message}`);
  }
}

// while an install/remove/redeploy/backup/restore or a deliberate stop owns a
// container, defer and re-check shortly (the operation also re-enqueues on
// completion, so this is just a backstop)
const MANAGED_RETRY_MS = 5000;

// an unmountable volume usually means its host filesystem is still coming up
// (e.g. the encrypted data partition after a reboot) - retry on a pace that
// won't spam, and keep deferring until it mounts
const VOLUME_MOUNT_RETRY_MS = 30 * 1000;

// identifiers whose missing backing image was already recorded as a tampering
// event, so the paced retries don't re-record it every cycle
const volumeMissingNoted = new Set();

// A running container attached to NO network (a stale libnetwork endpoint left
// by an earlier failed start) is healed by recreating it (force-remove + fresh
// create; a plain start reuses the broken endpoint, and `network connect` does
// not restore published host ports). This is destructive, so it is guarded:
//   - DETACHED_CONFIRM_OBSERVATIONS: require the detached state on N consecutive
//     reconciles before acting, so a transient inspect (e.g. dockerd mid-restart)
//     never destroys a healthy container.
//   - MAX_NETWORK_HEAL_ATTEMPTS: cap recreate attempts so a recreate that keeps
//     landing detached (e.g. a still-held host port) can't loop forever.
// Per-id state {obs, tries, gaveUp}; cleared once the container is seen attached.
// Unlike the vanished path, a heal recreate failure NEVER uninstalls the app -
// the component's spec/image are fine; only its host networking hit a transient
// conflict, so we keep retrying (bounded) and otherwise leave it for a human.
const DETACHED_CONFIRM_OBSERVATIONS = 2;
const MAX_NETWORK_HEAL_ATTEMPTS = 3;
const networkHealState = new Map();

// The reconciler's canonical id is the bare component identifier
// (`{component}_{app}`). Deciders disagree on the form they pass — masterSlave
// uses the bare identifier, the syncthing flow passes the flux-prefixed docker
// name — so we normalise every inbound id here, at the boundary, the same way
// dockerService normalises to the prefixed form for docker calls. This keeps the
// spec lookup and all in-memory state (controllerDesired/backoff/runtime) keyed
// consistently no matter which decider triggered the reconcile.
const canonical = (id) => dockerService.getBaseAppName(id);

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
    // A DB read failure is transient, not "not installed". Throw a tagged error so
    // reconcile defers + retries rather than silently dropping the recovery.
    const error = new Error(`failed to read local spec for ${identifier}: ${err.message}`);
    error.transient = true;
    throw error;
  }
  if (!appSpec) return null;
  try {
    [appSpec] = await appQueryService.decryptEnterpriseApps([appSpec], { formatSpecs: false, throwOnError: true });
  } catch (err) {
    // Decryption failed (e.g. the enterprise key isn't loaded yet at boot). Never
    // proceed on still-encrypted data: containerData would be unreadable, so we'd
    // misclassify g:/r: or start a container on garbage. Treat as transient like a
    // DB read failure so reconcile defers and retries once the key is available.
    const error = new Error(`failed to decrypt enterprise spec for ${identifier}: ${err.message}`);
    error.transient = true;
    throw error;
  }

  let comp;
  if (appSpec.version >= 4 && Array.isArray(appSpec.compose)) {
    const componentName = identifier.split('_')[0];
    comp = appSpec.compose.find((c) => c.name === componentName);
    if (!comp) return null;
  } else {
    comp = appSpec; // v1-3: the app itself is the single component
  }

  // Classify via the canonical parser (sync flags are valid only on the primary
  // mount), NOT a loose substring: `'/data|g:/db'.includes('g:')` is true but the
  // g: is in an invalid non-primary position, so it is NOT a g: component. Also flag
  // an unparseable spec so reconcile can fail loud instead of looping (the container
  // could never be created — volume construction would throw on the same spec).
  const cd = comp.containerData || '';
  const syncMode = mountParser.getComponentSyncMode(cd);
  let invalidSpec = false;
  let invalidReason = null;
  if (cd) {
    try {
      mountParser.parseContainerData(cd);
    } catch (err) {
      invalidSpec = true;
      invalidReason = err.message;
    }
  }
  return {
    appSpec, comp, isG: syncMode === 'g', isR: syncMode === 'r', invalidSpec, invalidReason,
  };
}

/**
 * Reads the container's actual state from Docker. exitCode is null when the
 * container has never run (state 'created') so restart policies treat it as an
 * initial start.
 *
 * An inspect failure is ambiguous: the container may be genuinely gone, docker
 * may be unreachable (mid dockerd-restart), or the single inspect call failed
 * transiently while docker is fine. These surface as different,
 * version-dependent errors, so rather than pattern-match the error we probe
 * the daemon with a list call and use its ANSWER, not just its success:
 *   - list throws            -> docker is down: defer (reachable false)
 *   - container IS listed    -> the inspect failure was transient; the
 *                               container exists (indeterminate run-state):
 *                               defer, the next inspect succeeds. Treating it
 *                               as vanished here would falsely record
 *                               tampering, then recreate -> 409 -> uninstall a
 *                               healthy app.
 *   - container NOT listed   -> docker itself confirms absence: vanished.
 */
async function dockerActual(identifier) {
  try {
    const info = await dockerService.dockerContainerInspect(identifier);
    const everRan = info.State && info.State.Status !== 'created';
    // docker's record of the last death - the truth even when the die event was
    // missed (reboot, FluxOS restart, stream gap). Zero value (0001-01-01) means
    // the container never finished.
    const finishedParsed = Date.parse(info.State?.FinishedAt ?? '');
    const finishedAt = Number.isFinite(finishedParsed) && finishedParsed > 0 ? finishedParsed : null;
    return {
      reachable: true,
      exists: true,
      running: !!(info.State && info.State.Running),
      exitCode: everRan ? (info.State.ExitCode ?? null) : null,
      finishedAt,
      // classified from THIS inspect so the running-branch network check needs no
      // second docker call (and no TOCTOU between two inspects).
      attachment: dockerService.parseContainerNetworkAttachment(info),
    };
  } catch (err) {
    let containers;
    try {
      containers = await dockerService.dockerListContainers(true);
    } catch (probeErr) {
      return { reachable: false, exists: false, running: false, exitCode: null };
    }
    const dockerName = dockerService.getAppDockerNameIdentifier(identifier);
    const listed = containers.some((c) => Array.isArray(c.Names) && c.Names.includes(dockerName));
    if (listed) {
      return {
        reachable: true, exists: true, running: false, exitCode: null, indeterminate: true,
      };
    }
    return { reachable: true, exists: false, running: false, exitCode: null };
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
  // backup/restore hold a lease on the WHOLE app under its bare main name
  // (appendBackupTask pushes req.appname), so a component reconcile must ask
  // with the main app name, not the component identifier.
  const mainAppName = identifier.split('_')[1] || identifier;
  const backup = globalState.backupInProgress || [];
  const restore = globalState.restoreInProgress || [];
  if (backup.includes(mainAppName) || restore.includes(mainAppName)) return true;
  if (globalState.stoppingContainers.has(dockerService.getAppIdentifier(identifier))) return true;
  return false;
}

async function effectiveDesiredRunning(identifier, spec, exitCode) {
  if (await appsRuntimeState.isOperatorStopped(identifier)) return { desired: false, reason: 'operatorStopped' };
  if (spec.isG || spec.isR) {
    const cd = controllerDesired.get(identifier) ?? null;
    // No controller opinion yet. controllerDesired is in-memory, so a FluxOS
    // restart wipes it while the container keeps running (Docker is independent of
    // the FluxOS process). Take no action - leave the container as-is until the
    // masterSlave/syncthing decider re-derives intent. Treating "unset" as "stop"
    // here would bounce every running syncthing app on every FluxOS restart.
    if (cd === null) return { desired: null, reason: 'awaitingController' };
    if (cd !== 'running') return { desired: false, reason: 'controllerDesired' };
  }
  const desired = policyAllowsRun(getRestartPolicy(spec), exitCode);
  return { desired, reason: desired ? 'running' : 'policy' };
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
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'recreated' });
    notifyContainerStarted(identifier);
  } catch (err) {
    // Removal must be justified by the state of the world NOW, not at
    // classification time: a whole recreate attempt (image pull - up to
    // minutes) sits between them, during which a redeploy can legitimately
    // create the container (isManagedElsewhere is only sampled at reconcile
    // entry), or our own recreate can fail AFTER creating it (start/network
    // step). If the container exists, the failure is moot: no tamper events,
    // no removal - retry shortly and converge on the actual state.
    const containerExistsNow = await dockerService.getDockerContainerOnly(identifier).catch(() => undefined);
    if (containerExistsNow) {
      log.info(`appReconciler - recreate of ${identifier} failed (${err.message}) but the container now exists; skipping removal`);
      scheduleRetry(identifier, MANAGED_RETRY_MS);
      return;
    }
    log.error(`appReconciler - failed to recreate ${identifier}: ${err.message}`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'recreateFailed', reason: err.message });
    await appTamperingDetectionService.recordEvent(mainAppName, 'recreation_failed', `Container recreation failure: ${err.message}`);
    if (appTamperingDetectionService.isNetworkMissingError(err.message)) {
      await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Docker network missing during recreation: ${err.message}`);
    }
    log.warn(`REMOVAL REASON: Container recreation failure - ${mainAppName} (appReconciler)`);
    await appUninstaller.removeAppLocally(mainAppName, null, false, true, true);
  }
}

/**
 * Recreate a container that was removed to clear a detached network endpoint.
 * Deliberately NOT recreateMissing: a failure here must not escalate to
 * uninstalling the whole app (the trigger is a transient host-networking
 * conflict, not tampering). On failure we just re-arm a paced retry; the caller's
 * attempt cap bounds it. For a g: component recreateMissingContainers creates but
 * does not start - the normal reconcile flow starts it on a later pass.
 */
async function recreateForNetworkHeal(identifier) {
  try {
    await containerHealthMonitor.recreateMissingContainers(identifier);
    appInspector.startAppMonitoring(identifier, globalState.appsMonitored);
    log.info(`appReconciler - recreated ${identifier} to clear a detached network endpoint`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'recreated', reason: 'networkDetached' });
    notifyContainerStarted(identifier);
  } catch (err) {
    log.error(`appReconciler - failed to recreate ${identifier} after network detach: ${err.message}; will retry (app NOT uninstalled)`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkHealRecreateFailed', reason: err.message });
    scheduleRetry(identifier, MANAGED_RETRY_MS);
  }
}

/**
 * One heal cycle for a running-but-detached container: force-remove the broken
 * container (keeping bind-mounted data), then recreate it with a fresh endpoint.
 * Force-remove is required because the recreate path (appDockerCreate) 409s on an
 * existing container name. The durable network_detached signal is recorded once
 * per episode by the caller, not here (this runs up to MAX times per episode).
 */
async function attemptNetworkHeal(identifier) {
  fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkDetached' });
  // Stop the per-minute stats monitor before removing the container (mirrors the
  // uninstaller). Otherwise its interval runs against a gone container - and, if
  // the recreate then fails/gives up, leaks and error-spams forever. The recreate
  // re-establishes monitoring via startAppMonitoring on success.
  appInspector.stopAppMonitoring(identifier, true, globalState.appsMonitored);
  try {
    // v=false: Flux data lives on bind mounts, so nothing is lost; the recreate
    // reuses it via a soft install.
    await dockerService.appDockerForceRemove(identifier, false);
  } catch (err) {
    log.error(`appReconciler - failed to remove detached ${identifier}: ${err.message}; will retry`);
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }
  await recreateForNetworkHeal(identifier);
}

// --- the reconcile -------------------------------------------------------

async function reconcile(rawIdentifier) {
  const identifier = canonical(rawIdentifier);
  if (isManagedElsewhere(identifier)) {
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }

  let spec;
  try {
    spec = await getLocalComponentSpec(identifier);
  } catch (err) {
    // transient failure reading the local spec (e.g. a momentary DB blip): defer and
    // retry rather than dropping the component's recovery as if it were uninstalled.
    log.warn(`appReconciler - ${identifier} spec read failed, deferring: ${err.message}`);
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }
  if (!spec) { // not installed here - nothing to enforce
    networkHealState.delete(identifier); // drop any heal bookkeeping for a gone app
    return;
  }

  // Invalid containerData (e.g. a sync flag on a non-primary mount, or an index-ref
  // primary): the spec can never be actuated — volume construction would throw — so
  // fail loud and stop. Do NOT scheduleRetry (retrying cannot fix an invalid spec)
  // and do NOT attempt a start. The hourly sweep re-surfaces it, so it stays visible
  // rather than silently looping "not ready".
  if (spec.invalidSpec) {
    log.error(`appReconciler - ${identifier} has invalid containerData, not reconciling: ${spec.invalidReason}`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'invalidSpec', reason: spec.invalidReason });
    return;
  }

  const mainAppName = identifier.split('_')[1] || identifier;

  // The component's data volume is level-based desired state owned HERE, not by
  // a @reboot crontab (unreconciled - its silent loss left volumes unmounted
  // after reboot). It must be mounted before ANY actuation touches the app dir:
  // a data wipe, mount-path creation or container start against the bare
  // mountpoint writes to the host filesystem instead of the volume. It matters
  // even while the container stays stopped - a g:/r: component's syncthing
  // folder lives on it. An app whose volume cannot be mounted stays inert.
  const volumeMount = await volumeService.ensureAppVolumeMounted(identifier);
  if (!volumeMount.mounted) {
    // A stop takes nothing from the app dir, and deferring it would leave the
    // container running over a missing volume with the mount-safety hold
    // unenforceable - the incident's app kept running through the gutted
    // window exactly this way. Honor a pending stop; defer everything else.
    if (controllerDesired.get(identifier) === 'stopped') {
      try {
        const actualNow = await dockerActual(identifier);
        if (actualNow.reachable && !actualNow.indeterminate && actualNow.running) {
          log.info(`appReconciler - ${identifier} data volume unavailable but a stop is desired; stopping the container`);
          await dockerService.appDockerStop(identifier);
          fluxEventBus.publish('reconciler:actuated', { identifier, action: 'stopped', reason: 'controllerDesired' });
        }
      } catch (err) {
        log.error(`appReconciler - ${identifier} stop under unavailable volume failed: ${err.message}`);
      }
    }
    log.error(`appReconciler - ${identifier} data volume not mounted (${volumeMount.reason}); deferring all actuation`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'volumeUnavailable', reason: volumeMount.reason });
    if (volumeMount.reason === 'volume_file_missing' && !volumeMissingNoted.has(identifier)) {
      volumeMissingNoted.add(identifier);
      await appTamperingDetectionService.recordEvent(mainAppName, 'volume_missing', `Backing volume image for ${identifier} not found on disk`);
    }
    scheduleRetry(identifier, VOLUME_MOUNT_RETRY_MS);
    return;
  }
  volumeMissingNoted.delete(identifier);
  if (!volumeMount.alreadyMounted) {
    log.info(`appReconciler - mounted data volume for ${identifier}`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'volumeMounted' });
  }

  const actual = await dockerActual(identifier);

  // docker unreachable (e.g. dockerd restarting): defer rather than misread the
  // container as vanished and recreate/uninstall it. A reconnect sweep and this
  // retry both re-reconcile once docker is back.
  if (!actual.reachable) {
    log.warn(`appReconciler - docker unreachable for ${identifier}, deferring reconcile`);
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }

  // inspect failed but docker's own list shows the container exists: transient
  // inspect failure - defer, the next inspect succeeds (its run-state is
  // unknown right now, so neither start nor stop can be justified)
  if (actual.indeterminate) {
    log.warn(`appReconciler - ${identifier} inspect failed but the container exists, deferring reconcile`);
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }

  // Pending data wipe: the sync layer flagged this component's local appdata as
  // stale/to-be-reset and to be cleared before it runs again. This is the highest-
  // priority data action and is resolved here, inside the per-key single-flight and
  // BEFORE the run decision below, so a start can never race the wipe (the S1 data-
  // loss window). Stop first - an rm -rf under a live container corrupts it - then
  // wipe, then drop the flag. The wipe path is keyed by the on-disk (flux-prefixed)
  // folder name, while the stop takes the bare id (dockerService re-prefixes).
  if (dataDesired.get(identifier) === 'clear') {
    try {
      if (actual.running) {
        log.info(`appReconciler - ${identifier} stopping before local appdata clear`);
        await dockerService.appDockerStop(identifier);
        fluxEventBus.publish('reconciler:actuated', { identifier, action: 'stopped', reason: 'dataClear' });
      }
      await serviceHelper.delay(DATA_CLEAR_SETTLE_MS);
      await dockerOperations.appDeleteDataInMountPoint(dockerService.getAppIdentifier(identifier));
    } catch (err) {
      // A failed stop/wipe is the only actuation path here that would otherwise drop
      // to the hourly sweep (~1h down). Leave dataDesired 'clear' - so the retried
      // reconcile re-runs the idempotent wipe AND a start can never proceed onto
      // un-wiped data (this block still wins the next pass) - and arm our own paced
      // retry, mirroring the failed-start path below.
      log.error(`appReconciler - failed to clear local appdata for ${identifier}: ${err.message}; retrying`);
      fluxEventBus.publish('reconciler:actuated', { identifier, action: 'dataClearFailed', reason: err.message });
      scheduleRetry(identifier, MANAGED_RETRY_MS);
      return;
    }
    dataDesired.delete(identifier);
    log.info(`appReconciler - ${identifier} local appdata cleared`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'dataCleared' });
    // the sync layer flips controllerDesired to 'running' once a synced source is
    // confirmed; re-enqueue so we converge promptly if it already has.
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }

  const { desired, reason } = await effectiveDesiredRunning(identifier, spec, actual.exitCode);

  // null = no controller opinion yet for a g:/r: component: neither start nor stop,
  // leave the container in its current state until the decider speaks.
  if (desired === null) return;

  if (!desired) {
    if (actual.running) {
      log.info(`appReconciler - ${identifier} desired stopped, stopping`);
      await dockerService.appDockerStop(identifier);
      fluxEventBus.publish('reconciler:actuated', { identifier, action: 'stopped', reason });
    }
    return;
  }

  if (actual.running) {
    // A running container is normally "already where we want it" - but a start
    // can succeed while leaving the container attached to NO network when
    // libnetwork holds a stale endpoint from an earlier failed "programming
    // external connectivity" (e.g. a host-port bind conflict on a restart after
    // an unclean reboot). It then runs with no IP, no embedded DNS (cannot
    // resolve sibling components by name) and no published ports, and no future
    // `docker start` repairs it - only a recreate clears the stale endpoint.
    // Verify the attachment (from the inspect dockerActual already did) before
    // trusting "running"; heal by recreating, debounced and bounded.
    if (!dockerService.isContainerDetachedFromNetwork(actual.attachment)) {
      networkHealState.delete(identifier);
      return; // running and properly attached - already where we want it
    }
    const st = networkHealState.get(identifier) || { obs: 0, tries: 0, gaveUp: false };
    st.obs += 1;
    if (st.obs < DETACHED_CONFIRM_OBSERVATIONS) {
      // first sighting - confirm on the next pass before doing anything
      // destructive, so a transient read never recreates a healthy container.
      networkHealState.set(identifier, st);
      log.warn(`appReconciler - ${identifier} appears detached from its docker network; confirming before acting`);
      scheduleRetry(identifier, MANAGED_RETRY_MS);
      return;
    }
    if (st.tries >= MAX_NETWORK_HEAL_ATTEMPTS) {
      if (!st.gaveUp) {
        st.gaveUp = true;
        networkHealState.set(identifier, st);
        log.error(`appReconciler - ${identifier} still detached from its docker network after ${st.tries} recreate attempt(s); leaving it running for manual intervention (app NOT uninstalled)`);
        fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkHealGaveUp' });
      }
      return;
    }
    // Only heal a stale endpoint (network present, container not attached). If the
    // network itself is gone, a recreate would fail on a missing NetworkMode, so
    // removing the container would only take it from partially-alive to removed-
    // and-unrecreatable. That is a different fault (network restore) - record it
    // and leave the container in place rather than destroying it.
    if (!(await dockerService.dockerNetworkExists(actual.attachment.networkMode))) {
      if (!st.gaveUp) {
        st.gaveUp = true;
        networkHealState.set(identifier, st);
        log.error(`appReconciler - ${identifier} detached because its network ${actual.attachment.networkMode} is missing; not recreating (needs network restore, app NOT touched)`);
        await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Network ${actual.attachment.networkMode} missing while ${identifier} runs detached`);
        fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkPruned' });
      }
      return;
    }
    st.tries += 1;
    networkHealState.set(identifier, st);
    // Record the durable anomaly signal ONCE per episode (first attempt), not on
    // every retry - it feeds a node-level tampering-event count, so a per-retry
    // record would inflate it 3x for a single detachment.
    if (st.tries === 1) {
      await appTamperingDetectionService.recordEvent(mainAppName, 'network_detached', `Container ${identifier} running with no network endpoint on its own network`);
    }
    log.warn(`appReconciler - ${identifier} running but not attached to its docker network (recreate ${st.tries}/${MAX_NETWORK_HEAL_ATTEMPTS}); clearing the stale endpoint`);
    await attemptNetworkHeal(identifier);
    return;
  }

  if (!actual.exists) {
    // If we removed this container for a network-detach heal (tries > 0) and the
    // recreate has not yet brought it back, keep retrying the recreate WITHOUT the
    // vanished path's uninstall-on-failure escalation - the trigger was transient
    // host networking, not tampering, so a whole-app uninstall is wrong. Once the
    // cap is hit we give up and, crucially, keep steering AWAY from recreateMissing
    // so a heal never turns into an uninstall. Only a container that vanished by
    // other means (no heal in flight) takes the tested vanished path.
    const st = networkHealState.get(identifier);
    if (st && st.tries > 0) {
      if (st.gaveUp) return; // gave up earlier; leave removed, never uninstall
      if (st.tries >= MAX_NETWORK_HEAL_ATTEMPTS) {
        st.gaveUp = true;
        networkHealState.set(identifier, st);
        log.error(`appReconciler - ${identifier} still cannot be recreated after ${st.tries} network-heal attempt(s); leaving it removed for manual intervention (app NOT uninstalled)`);
        fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkHealGaveUp' });
        return;
      }
      st.tries += 1;
      networkHealState.set(identifier, st);
      await recreateForNetworkHeal(identifier);
      return;
    }
    await recreateMissing(identifier);
    return;
  }

  // exists but stopped, should run -> backoff-paced restart (no sleeping; the
  // worker re-enqueues when the backoff window elapses)
  const wait = await appsRuntimeState.restartWaitMs(identifier, actual.finishedAt);
  if (wait > 0) {
    log.warn(`appReconciler - ${identifier} stopped, backing off ${Math.round(wait / 1000)}s before restart`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'backoff', waitMs: wait });
    scheduleRetry(identifier, wait);
    return;
  }

  // Recreate any bind-mount paths removed while the container was stopped (e.g.
  // Syncthing cleanup of a g:/r: data folder) before starting — otherwise the
  // start fails on a missing mount source and the app backoff-loops forever.
  const isComponent = spec.appSpec.version >= 4 && Array.isArray(spec.appSpec.compose);
  await volumeService.ensureMountPathsExist(spec.comp, mainAppName, isComponent, isComponent ? spec.appSpec : null);

  // The controller verdict was sampled at reconcile entry, but the syncthing
  // decider's stop wrapper runs OUTSIDE this single-flight and may have flipped
  // it (stop + data wipe) during the awaits above. Re-read at actuation time:
  // starting onto a folder mid-wipe corrupts the fresh sync. The decider's own
  // enqueue drives the follow-up reconcile, so aborting here needs no retry.
  if ((spec.isG || spec.isR) && controllerDesired.get(identifier) !== 'running') {
    log.info(`appReconciler - ${identifier} controller verdict changed during reconcile, aborting start`);
    return;
  }

  await appsRuntimeState.recordRestart(identifier);
  try {
    await dockerService.appDockerStart(identifier);
  } catch (err) {
    // No die event fires for a failed start (the container never ran), so a
    // dropped throw here leaves the component down until the hourly sweep.
    // Schedule our own retry; pacing is free - the attempt was recorded above,
    // so a persistent failure walks the backoff ladder instead of hammering.
    log.error(`appReconciler - failed to start ${identifier}: ${err.message}; retrying`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'startFailed', reason: err.message });
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }
  appInspector.startAppMonitoring(identifier, globalState.appsMonitored);
  log.info(`appReconciler - ${identifier} restarted`);
  fluxEventBus.publish('reconciler:actuated', { identifier, action: 'started', exitCode: actual.exitCode });
  notifyContainerStarted(identifier);
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
      // one completed pass (actuated or deferred) is all the boot drain needs
      if (bootDraining.delete(identifier) && bootDraining.size === 0) {
        settleBootDrain('all boot reconciles completed a pass');
      }
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
function enqueue(rawIdentifier) {
  const identifier = canonical(rawIdentifier);
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
 * Enterprise specs are stored encrypted (compose: []), so the sweep decrypts
 * to enumerate components — leniently: one app failing to decrypt must not
 * abort the sweep for the rest. An app that stays encrypted is still covered
 * via its existing docker containers (see below); never silently skipped.
 */
async function enqueueAll(reason = 'resync') {
  const res = await appQueryService.installedApps();
  if (!res || res.status !== 'success') return;
  const apps = await appQueryService.decryptEnterpriseApps(res.data, { formatSpecs: false });
  let count = 0;
  let dockerNames = null; // fetched once, only if some app failed to decrypt
  for (const app of apps) {
    const stillEncrypted = app.version >= 8 && app.enterprise
      && (!Array.isArray(app.compose) || app.compose.length === 0);
    if (stillEncrypted) {
      // Decryption failed (already logged by decryptEnterpriseApps). The component
      // names live inside the blob, so enumerate the app's EXISTING docker
      // containers instead: their reconciles defer on the same decrypt failure
      // and converge the moment fluxbenchd answers again. A vanished container of
      // an undecryptable app cannot be recovered anyway (recreation needs the
      // spec); the next sweep retries, so coverage resumes with decryption.
      if (dockerNames === null) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const containers = await dockerService.dockerListContainers(true);
          dockerNames = containers.map((c) => (c.Names && c.Names[0] ? c.Names[0].slice(1) : ''));
        } catch (err) {
          log.warn(`appReconciler - enqueueAll cannot list containers for undecryptable apps: ${err.message}`);
          dockerNames = [];
        }
      }
      const suffix = `_${app.name}`;
      dockerNames.filter((name) => name.endsWith(suffix)).forEach((name) => {
        enqueue(name); // canonicalised to the bare component identifier by enqueue
        count += 1;
      });
    } else if (app.version >= 4 && Array.isArray(app.compose)) {
      app.compose.forEach((c) => { enqueue(`${c.name}_${app.name}`); count += 1; });
    } else {
      enqueue(app.name);
      count += 1;
    }
  }
  fluxEventBus.publish('reconciler:swept', { reason, count });
}

// --- controllerDesired seam (written by masterSlave/syncthing deciders) ---

/**
 * A decider (masterSlave election / syncthing readiness) declares the desired
 * run-state of a g:/r: component and triggers enforcement. The decider does its
 * own synchronous data-safety steps (stop+wipe, permission-fix) first; this
 * only records intent and enqueues.
 */
function setControllerDesired(rawIdentifier, state, reason) {
  const identifier = canonical(rawIdentifier);
  controllerDesired.set(identifier, state);
  log.info(`appReconciler - controllerDesired[${identifier}] = ${state} (${reason})`);
  fluxEventBus.publish('reconciler:desiredChanged', { identifier, state, reason });
  enqueue(identifier);
}

/**
 * Declare that a g:/r: component must be stopped and its local appdata cleared
 * before it next runs - the sync layer's first-run / new-app reset. Sets both
 * desired inputs and enqueues ONE reconcile: the reconciler (the sole container
 * and data actuator) performs the stop-then-wipe inside its per-key single-flight,
 * so a start can never race the wipe. Replaces the sync layer's prior imperative
 * stop+rm-rf, which ran outside the single-flight (the S1 data-loss window).
 */
function requestStopAndClearData(rawIdentifier, reason) {
  const identifier = canonical(rawIdentifier);
  controllerDesired.set(identifier, 'stopped');
  dataDesired.set(identifier, 'clear');
  log.info(`appReconciler - requesting stop + local appdata clear for ${identifier} (${reason})`);
  fluxEventBus.publish('reconciler:desiredChanged', { identifier, state: 'stopped', reason });
  fluxEventBus.publish('reconciler:dataClearRequested', { identifier, reason });
  enqueue(identifier);
}

function clearControllerDesired(rawIdentifier) {
  const identifier = canonical(rawIdentifier);
  controllerDesired.delete(identifier);
  dataDesired.delete(identifier);
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
  if (pending.length === 0) {
    settleBootDrain('nothing to drain');
    return;
  }
  pending.forEach((id) => bootDraining.add(id));
  bootDrainCapTimer = setTimeout(() => {
    log.warn(`appReconciler - boot drain cap reached with ${bootDraining.size} reconcile(s) still in flight: ${[...bootDraining].join(', ')}`);
    settleBootDrain('cap reached');
  }, BOOT_DRAIN_SETTLE_CAP_MS);
  if (bootDrainCapTimer.unref) bootDrainCapTimer.unref();
  pending.forEach((id) => enqueue(id));
}

function stop() {
  started = false;
  backoffTimers.forEach((t) => clearTimeout(t));
  backoffTimers.clear();
  if (bootDrainCapTimer) {
    clearTimeout(bootDrainCapTimer);
    bootDrainCapTimer = null;
  }
  bootDraining.clear();
  inFlight.clear();
  dirty.clear();
  bootPending.clear();
}

module.exports = {
  enqueue,
  enqueueAll,
  setControllerDesired,
  clearControllerDesired,
  requestStopAndClearData,
  setOnContainerStarted,
  waitForBootDrainSettled: () => bootDrainGate.wait(),
  start,
  stop,
  // exposed for tests
  reconcile,
  policyAllowsRun,
  getRestartPolicy,
};
