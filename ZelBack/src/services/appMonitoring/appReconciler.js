const config = require('config');
const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');
const dbHelper = require('../dbHelper');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
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

// Components a decider has committed to running but has not started yet, because
// its pre-start data-safety work is still in flight. Read by the peer probe: a
// node that answers only with running containers withholds an intent it already
// holds, and the asking node starts a second writer. In-memory for the same
// reason as controllerDesired - a claim must not survive the process that made it.
const startingClaims = new Set();

// brief settle between the stop and the rm -rf so the container has fully released
// its appdata mount before the wipe (mirrors the sync layer's prior 500ms delay).
const DATA_CLEAR_SETTLE_MS = 500;

// id -> promise of the pass (or intent write) currently holding this key. A Map
// rather than a Set so a caller can WAIT for the holder: applyIntent below needs
// to know when a pass has finished, not merely that one is running.
const inFlight = new Map(); // per-key single-flight
const dirty = new Set(); // ids re-requested while in flight -> reconcile again
const bootPending = new Set(); // ids enqueued before the boot gate opened
const backoffTimers = new Map(); // id -> scheduled retry timeout
const unhandledFailures = new Map(); // id -> consecutive passes that threw

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

// How many consecutive passes may throw before the component is left to the
// hourly sweep. A pass that throws is by definition one whose failure nobody
// anticipated: every failure this file expects returns after deciding either to
// pace a retry (a transient fault) or deliberately not to (an invalid spec, which
// no retry can fix). An unhandled throw made neither decision, so it reached the
// sweep - and with the operator's stop now actuated here rather than inline, a
// container could keep running for an hour after a stop reported success.
// Retrying is safe because a pass is level-based: it re-derives desired against
// actual rather than resuming half-finished work. The bound is what keeps a
// permanent fault from becoming a five-second log loop forever.
const UNHANDLED_FAILURE_RETRIES = 3;

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
// not restore published host ports). The remove is destructive, so it is guarded:
//
//   - Confirmed in-pass: on first sight of the detached state we settle, then
//     re-inspect, and only act if it is still detached. Counting observations
//     across reconciles would not do this - two reconciles can run back-to-back
//     (a die event lands while the sweep's pass is in flight, and the workqueue
//     re-runs the id immediately), so both "observations" can come from the same
//     instant. A settle + re-read guarantees the time separation the confirmation
//     is for: a transient inspect (dockerd mid-restart, the brief pre-IP window)
//     never destroys a healthy container.
//   - Paced, not capped: heal attempts walk their own durable ladder in
//     appsRuntimeState (same shape as the crash backoff, up to a 30m cap, but a
//     SEPARATE history - sharing one would let a heal's attempts hold down the
//     very container it just recreated, and would block the heal of a container
//     that happens to be crash-looping). A hard attempt cap would park the heal in
//     a terminal state until the FluxOS process restarts, which is not level-based
//     - a reconciler keeps trying at a bounded rate.
//     Retrying forever is also convergent at the network level: while the
//     container is broken or absent this node stops advertising it in apprunning,
//     its location record expires on TTL and the app is re-placed elsewhere, all
//     without destroying this node's bind-mounted data.
//   - Never uninstalls: unlike the vanished path, a failed heal recreate does not
//     escalate to removeAppLocally. The spec and image are fine; only the host
//     networking hit a conflict.
//
// The one fact that must survive a FluxOS restart is "I removed this container on
// purpose" (otherwise a restart between the remove and the recreate makes the next
// reconcile read the absence as tampering and, on a failed recreate, uninstall the
// app). That lives in appsRuntimeState.networkHealRemoval, not here.
const NETWORK_DETACH_CONFIRM_MS = 3000;
// ...and the detach must ALSO have persisted for this long since we first saw it.
// A dockerd restart with live-restore can answer an inspect before libnetwork has
// re-populated endpoint IPs on running containers - and the event-stream reconnect
// sweep enqueues every component at exactly that moment, so a short confirm alone
// would rebuild every container on the node. This is wall-clock since the first
// sighting, NOT a count of reconcile passes (two passes can land in the same
// instant), so it is a real settle window whatever the trigger cadence.
const DETACHED_PERSIST_MS = 60 * 1000;
// id -> ms epoch of the first detached sighting of the current episode
const detachedSince = new Map();
// One container detached is a stale endpoint. Several at once is the daemon, not
// the containers - refuse to force-remove the whole node's workload on that read.
const DETACH_STORM_THRESHOLD = 3;
// a pruned network cannot be repaired by recreating the container - re-check on a
// slow pace so a restored network is picked up without an hour's wait
const NETWORK_PRUNED_RETRY_MS = 5 * 60 * 1000;
// a container is normally verified attached only on the reconcile after its start,
// i.e. the hourly sweep. But this pathology is BORN at start time, so re-check
// shortly after every start/recreate we perform: detached-at-boot then heals in
// under a minute, with the sweep as the backstop. (Docker network events cannot
// cover this: a container born detached never emits a disconnect.)
const POST_START_VERIFY_MS = 30 * 1000;

// identifiers whose detach/prune was already recorded as a tampering event, so the
// paced retries record it once per episode rather than once per attempt (the count
// feeds a node-level signal). Cleared once the container is seen attached.
const networkDetachedNoted = new Set();
const networkPrunedNoted = new Set();

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
  const { readable: [decryptedSpec] } = await appQueryService
    .decryptEnterpriseApps([appSpec], { formatSpecs: false });
  if (!decryptedSpec) {
    // Decryption failed (e.g. the enterprise key isn't loaded yet at boot). Never
    // proceed on still-encrypted data: containerData would be unreadable, so we'd
    // misclassify g:/r: or start a container on garbage. Treat as transient like a
    // DB read failure so reconcile defers and retries once the key is available.
    const error = new Error(`failed to decrypt enterprise spec for ${identifier}`);
    error.transient = true;
    throw error;
  }
  appSpec = decryptedSpec;

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
      // A PAUSED container reports Running: true - docker freezes the processes
      // and leaves the record saying they are up. Reading that as running is how
      // a frozen container became invisible to everything: this function said
      // "healthy, nothing to do", the sampler skipped it so its charts flatlined
      // with no explanation, and FDM went on routing traffic to something that
      // would never answer.
      //
      // It also put this function at odds with appStartupManager, which
      // enumerates boot candidates from the LISTING's State (where paused is not
      // 'running'). Boot handed the container over saying it needed starting and
      // this said it was already up - every boot, forever. The two now agree.
      running: !!(info.State && info.State.Running) && !info.State.Paused,
      paused: !!(info.State && info.State.Paused),
      exitCode: everRan ? (info.State.ExitCode ?? null) : null,
      // the kernel's verdict, not the entrypoint's: an image that swallows its
      // payload's status still cannot hide this one
      oomKilled: !!(info.State && info.State.OOMKilled),
      finishedAt,
      // classified from THIS inspect so the running-branch network check needs no
      // second docker call (and no TOCTOU between two inspects).
      attachment: dockerService.classifyContainerNetworkAttachment(info),
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

/**
 * What this component should be doing, why, and - when the answer is an operator
 * stop - whether that operator asked for a hard kill.
 *
 * The lock and the force flag are fields of one document, so they come from one
 * read. The stop branch used to re-read the same document for the flag alone,
 * and getState returns null for a read failure exactly as it does for "no
 * record" - so a second read that failed turned "kill now" into a drain. One
 * read is a window that cannot open, and one round-trip fewer on every stop.
 *
 * @returns {Promise<{desired: boolean|null, reason: string, force: boolean}>}
 */
async function effectiveDesiredRunning(identifier, spec, exitCode) {
  const operatorStop = await appsRuntimeState.operatorStopState(identifier);
  if (operatorStop.stopped) return { desired: false, reason: 'operatorStopped', force: operatorStop.force };
  if (spec.isG || spec.isR) {
    const cd = controllerDesired.get(identifier) ?? null;
    // No controller opinion yet. controllerDesired is in-memory, so a FluxOS
    // restart wipes it while the container keeps running (Docker is independent of
    // the FluxOS process). Take no action - leave the container as-is until the
    // masterSlave/syncthing decider re-derives intent. Treating "unset" as "stop"
    // here would bounce every running syncthing app on every FluxOS restart.
    if (cd === null) return { desired: null, reason: 'awaitingController', force: false };
    if (cd !== 'running') return { desired: false, reason: 'controllerDesired', force: false };
  }
  const desired = policyAllowsRun(getRestartPolicy(spec), exitCode);
  // Only an operator asks for a hard kill; every other stop reason is a drain.
  return { desired, reason: desired ? 'running' : 'policy', force: false };
}

/**
 * The run state the reconciler would converge this component to right now, and
 * why — the same spec read, docker probe and policy a reconcile pass uses, so a
 * caller reporting on an operator command never re-derives the decision.
 *
 * `desired` is null for a g:/r: component whose decider has not spoken: the
 * reconciler takes no action, which is neither running nor stopped.
 *
 * Throws what getLocalComponentSpec throws — a transient spec read is not an
 * answer, and reporting one as "not running" would tell an operator their app
 * is held when nothing has decided anything.
 *
 * @param {string} rawIdentifier
 * @returns {Promise<{desired: boolean|null, reason: string, force: boolean}>}
 */
async function desiredRunState(rawIdentifier) {
  const identifier = canonical(rawIdentifier);
  const spec = await getLocalComponentSpec(identifier);
  if (!spec) return { desired: false, reason: 'notInstalled', force: false };
  if (spec.invalidSpec) return { desired: false, reason: 'invalidSpec', force: false };
  const actual = await dockerActual(identifier);
  return effectiveDesiredRunning(identifier, spec, actual.exitCode);
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
    appInspector.startAppMonitoring(identifier);
    log.info(`appReconciler - recreated missing container ${identifier}`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'recreated' });
    notifyContainerStarted(identifier);
    scheduleRetry(identifier, POST_START_VERIFY_MS); // verify it came up attached
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
 * conflict, not tampering). On failure we just re-arm a retry; the next pass
 * paces it on the heal ladder. For a g: component recreateMissingContainers
 * creates but does not start - the normal reconcile flow starts it on a later
 * pass. The durable heal-removal flag is NOT cleared here: only seeing the
 * container back proves the heal worked.
 */
async function recreateForNetworkHeal(identifier) {
  const mainAppName = identifier.split('_')[1] || identifier;
  try {
    // softOnly: a hard install would REFORMAT the app's data volume (createAppVolume
    // fallocates + mke2fs). We removed a live container whose data was intact, so a
    // recreate that cannot verify the volume must fail and be retried - never wipe it.
    await containerHealthMonitor.recreateMissingContainers(identifier, { softOnly: true });
    appInspector.startAppMonitoring(identifier);
    log.info(`appReconciler - recreated ${identifier} to clear a detached network endpoint`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'recreated', reason: 'networkDetached' });
    notifyContainerStarted(identifier);
    scheduleRetry(identifier, POST_START_VERIFY_MS); // verify it came up attached
  } catch (err) {
    // Same diagnostics the vanished path emits - minus the uninstall escalation.
    // Without these a heal-removed container whose recreate keeps failing (e.g. its
    // network was pruned in the meantime) would loop with no operator-visible signal.
    log.error(`appReconciler - failed to recreate ${identifier} after network detach: ${err.message}; will retry (app NOT uninstalled)`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkHealRecreateFailed', reason: err.message });
    await appTamperingDetectionService.recordEvent(mainAppName, 'recreation_failed', `Container recreation failure after network detach: ${err.message}`).catch(() => {});
    if (appTamperingDetectionService.isNetworkMissingError(err.message) && !networkPrunedNoted.has(identifier)) {
      networkPrunedNoted.add(identifier);
      await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Docker network missing while recreating ${identifier}: ${err.message}`).catch(() => {});
    }
    scheduleRetry(identifier, MANAGED_RETRY_MS);
  }
}

/**
 * Drops all bookkeeping for a healthy container: the in-memory episode markers and
 * the durable heal state (the "I removed this on purpose" flag and the heal ladder).
 * Called whenever the container is seen to EXIST and not be detached - existing is
 * what makes the removal flag stale, so this must not be gated on `running`, or the
 * flag would leak on every path that leaves the container stopped (a g: component
 * awaiting its controller, an operator stop) and would then divert a later, genuine
 * disappearance away from the vanished path forever.
 */
async function clearNetworkHealState(identifier) {
  networkDetachedNoted.delete(identifier);
  networkPrunedNoted.delete(identifier);
  detachedSince.delete(identifier);
  await appsRuntimeState.clearNetworkHeal(identifier);
}

/**
 * Whether a detached container can actually be recreated after we destroy it.
 * The heal removes FIRST and recreates second, so every precondition of the
 * recreate must hold BEFORE the remove - otherwise we turn a partially-alive
 * container into a permanently gone one. Returns null when it is safe to proceed,
 * or a reason string.
 */
async function networkHealBlocker(identifier, spec) {
  // recreateMissingContainers throws unconditionally on a spec with no compose
  // array (v1-3 apps, which getLocalComponentSpec explicitly supports). Removing
  // such a container destroys it forever: the recreate can never succeed, and the
  // heal - by design - never escalates to an uninstall that would re-place the app.
  if (!(spec.appSpec.version >= 4 && Array.isArray(spec.appSpec.compose) && spec.appSpec.compose.length)) {
    return 'the app has no compose spec, so its container cannot be recreated';
  }
  // The recreate refuses to reformat (softOnly), so an unverifiable volume means it
  // would fail AFTER we destroyed the container. Check the same thing the recreate
  // checks, before committing.
  const mainAppName = identifier.split('_')[1] || identifier;
  const componentName = identifier.split('_')[0];
  const isComponent = identifier.includes('_');
  const volumeMounted = await volumeService
    .verifyAppVolumeMount(mainAppName, true, isComponent ? componentName : spec.comp.name)
    .catch(() => false);
  if (!volumeMounted) {
    return 'its data volume cannot be verified as mounted, so the recreate would fail';
  }
  return null;
}

/**
 * Heals a container that looks running-but-detached from its own docker network:
 * confirm it (settle + re-inspect), require its network to still exist, then
 * force-remove (keeping bind-mounted data) and recreate with a fresh endpoint.
 * Force-remove is required because the recreate path (appDockerCreate) 409s on an
 * existing container name; `docker network connect` on a live container does not
 * restore published host ports, so only a recreate fully heals it.
 */
async function healDetachedNetwork(identifier, mainAppName, spec) {
  // Confirm in-pass: a detached read can be transient (dockerd mid-restart, the
  // brief window before an endpoint gets its IP). Settle, then look again, and
  // only destroy on a state that survived the gap.
  log.warn(`appReconciler - ${identifier} appears detached from its docker network; confirming before acting`);
  await serviceHelper.delay(NETWORK_DETACH_CONFIRM_MS);
  const confirmed = await dockerActual(identifier);
  if (!confirmed.reachable || confirmed.indeterminate || !confirmed.exists || !confirmed.running) {
    // docker went unhappy, or the container is no longer running: nothing here can
    // be justified on this read. The next pass reconciles whatever it actually is.
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }
  if (!dockerService.isContainerDetachedFromNetwork(confirmed.attachment)) {
    log.info(`appReconciler - ${identifier} is attached after all; no heal needed`);
    await clearNetworkHealState(identifier);
    return;
  }
  const { networkMode } = confirmed.attachment;

  // The detach must also have PERSISTED. A dockerd restart (live-restore) can serve
  // a successful inspect before libnetwork has re-populated endpoint IPs, and the
  // reconnect sweep enqueues everything at that moment - without a real settle
  // window we would rebuild every container on the node.
  if (!detachedSince.has(identifier)) {
    detachedSince.set(identifier, Date.now());
    log.warn(`appReconciler - ${identifier} detached; waiting for it to persist before healing`);
    scheduleRetry(identifier, DETACHED_PERSIST_MS);
    return;
  }
  const detachedFor = Date.now() - detachedSince.get(identifier);
  if (detachedFor < DETACHED_PERSIST_MS) {
    scheduleRetry(identifier, DETACHED_PERSIST_MS - detachedFor);
    return;
  }

  // Several containers detached at once is a daemon-level fault, not N stale
  // endpoints. Force-removing the node's whole workload on that read is never the
  // right answer - say so loudly and wait for the daemon to settle instead.
  if (detachedSince.size >= DETACH_STORM_THRESHOLD) {
    log.error(`appReconciler - ${detachedSince.size} containers look detached at once; treating this as a docker-level fault and NOT recreating any of them (including ${identifier})`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkDetachStorm', count: detachedSince.size });
    scheduleRetry(identifier, NETWORK_PRUNED_RETRY_MS);
    return;
  }

  // Only a stale endpoint (network present, container not attached) is heal-able.
  // If the network itself is gone the recreate would fail on a missing NetworkMode,
  // so removing the container would only take it from partially-alive to removed-
  // and-unrecreatable. And absence must be PROVEN: a failed network read is not
  // evidence of a missing network, and acting on it destroys a container we then
  // cannot bring back.
  const networkState = await dockerService.dockerNetworkState(networkMode);
  if (networkState === 'unknown') {
    log.warn(`appReconciler - cannot determine whether ${networkMode} exists; deferring the heal of ${identifier}`);
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }
  if (networkState === 'absent') {
    if (!networkPrunedNoted.has(identifier)) {
      networkPrunedNoted.add(identifier);
      log.error(`appReconciler - ${identifier} detached because its network ${networkMode} is missing; not recreating (needs network restore, app NOT touched)`);
      await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Network ${networkMode} missing while ${identifier} runs detached`);
      fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkPruned' });
    }
    scheduleRetry(identifier, NETWORK_PRUNED_RETRY_MS); // keep watching for a restored network
    return;
  }
  networkPrunedNoted.delete(identifier);

  // Never destroy what we cannot rebuild: every precondition of the recreate must
  // hold BEFORE the remove, or the heal turns a half-alive container into a gone one.
  const blocker = await networkHealBlocker(identifier, spec);
  if (blocker) {
    log.error(`appReconciler - ${identifier} runs detached but must NOT be recreated: ${blocker}; leaving the container in place (app NOT touched)`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkHealBlocked', reason: blocker });
    scheduleRetry(identifier, NETWORK_PRUNED_RETRY_MS);
    return;
  }

  // Paced on its OWN durable ladder (0, 30s, 5m, 15m, 30m cap), not the crash one:
  // a container that keeps coming back detached is retried forever but at a decaying
  // rate, without holding down (or being held down by) the restart backoff.
  const wait = await appsRuntimeState.networkHealWaitMs(identifier);
  if (wait > 0) {
    log.warn(`appReconciler - ${identifier} still detached, backing off ${Math.round(wait / 1000)}s before the next heal attempt`);
    scheduleRetry(identifier, wait);
    return;
  }

  // The ONLY ownership sample was at reconcile entry, and everything above this
  // point - the settle, two inspects, the network probe, the volume check - has
  // taken seconds. A redeploy/backup/uninstall may have taken the container over in
  // the meantime, and force-removing it from under them is exactly what
  // isManagedElsewhere exists to prevent. Re-check at actuation time (the same
  // re-read-before-acting discipline the controller verdict and recreateMissing use).
  if (isManagedElsewhere(identifier)) {
    log.info(`appReconciler - ${identifier} was taken over by another operation during the heal confirmation; aborting the recreate`);
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }

  log.warn(`appReconciler - ${identifier} running but not attached to its docker network; clearing the stale endpoint`);
  fluxEventBus.publish('reconciler:actuated', { identifier, action: 'networkDetached' });

  try {
    // Record the anomaly (once per episode) and the durable "I removed this on
    // purpose" flag BEFORE the remove: if FluxOS restarts in the window between the
    // remove and the recreate, the flag is the only thing that tells the next process
    // the absence was ours - without it, the vanished path records a false tampering
    // event and can uninstall the whole app on a failed recreate. The marker is only
    // set AFTER a successful record, so a failed write does not suppress the event.
    if (!networkDetachedNoted.has(identifier)) {
      await appTamperingDetectionService.recordEvent(mainAppName, 'network_detached', `Container ${identifier} running with no network endpoint on its own network`);
      networkDetachedNoted.add(identifier);
    }
    await appsRuntimeState.recordNetworkHealAttempt(identifier);
    await appsRuntimeState.setNetworkHealRemoval(identifier, true);
  } catch (err) {
    // These writes are what make the remove safe and paced, so a failure must abort
    // it - and must re-arm a retry, or the container stays broken until the hourly
    // sweep (every other failure path here paces its own retry).
    log.error(`appReconciler - cannot record the network heal of ${identifier} (${err.message}); not removing the container, will retry`);
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }

  // Stop the per-minute stats monitor before removing the container (mirrors the
  // uninstaller). Otherwise its interval runs against a gone container, leaking and
  // error-spamming. The recreate re-establishes it via startAppMonitoring.
  appInspector.stopAppMonitoring(identifier, true);
  try {
    // v=false: Flux data lives on bind mounts; the recreate reuses them via a soft
    // install (enforced: recreateForNetworkHeal passes softOnly).
    await dockerService.appDockerForceRemove(identifier, false);
  } catch (err) {
    // The container is still there (or partially removed): put monitoring back so a
    // container we did NOT manage to remove is not left unmonitored. The heal flag
    // stays set on purpose - the remove may have partially succeeded, and a stale
    // flag only keeps us on the recreate path (never the uninstall one).
    appInspector.startAppMonitoring(identifier);
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
    // drop the in-memory heal markers for a gone app (its durable runtime-state doc
    // is dropped by the uninstaller via appsRuntimeState.remove)
    networkDetachedNoted.delete(identifier);
    networkPrunedNoted.delete(identifier);
    detachedSince.delete(identifier);
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
    //
    // Paused counts: dockerActual reports a paused container as not running,
    // and this branch returns before the paused normalisation below is ever
    // reached - skipping the stop here would leave a frozen container over the
    // missing volume with nothing left to release it. docker stop works on a
    // paused container.
    // The operator's stop counts here for the same reason the controller's does,
    // and is the more urgent of the two: a volume that will not mount is the state
    // support reaches for a stop IN, so a stop that waits for the mount to come
    // back is a stop that never arrives when it is wanted. It outranks the
    // controller everywhere else in this pass (see effectiveDesiredRunning) and
    // reading only the controller here was the one place it did not.
    const operatorStop = await appsRuntimeState.operatorStopState(identifier);
    if (operatorStop.stopped || controllerDesired.get(identifier) === 'stopped') {
      try {
        const actualNow = await dockerActual(identifier);
        if (actualNow.reachable && !actualNow.indeterminate && (actualNow.running || actualNow.paused)) {
          // Only an operator asks for a hard kill; every other stop reason is a
          // drain. Carried through here too, or an appkill against an unmounted
          // volume quietly becomes a graceful stop.
          const forceKill = operatorStop.stopped && operatorStop.force === true;
          const reason = operatorStop.stopped ? 'operatorStopped' : 'controllerDesired';
          log.info(`appReconciler - ${identifier} data volume unavailable but a stop is desired; ${forceKill ? 'killing' : 'stopping'} the container`);
          if (forceKill) {
            await dockerService.appDockerKill(identifier);
          } else {
            await dockerService.appDockerStop(identifier);
          }
          appInspector.stopAppMonitoring(identifier, false);
          fluxEventBus.publish('reconciler:actuated', {
            identifier, action: 'stopped', reason, forced: forceKill,
          });
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

  // NORMALISE A PAUSED CONTAINER BEFORE DECIDING ANYTHING ELSE.
  //
  // Paused is a state nothing downstream can act on. It is not startable -
  // docker refuses with "cannot start a paused container, try unpause instead" -
  // and appDockerUnpause was retired with the rest of pause, so no primitive
  // remains that releases one directly. Left alone it is invisible and permanent.
  //
  // Stopping it converts an unrecognised state into a known one: docker stop
  // works on a paused container and leaves it exited. From there this function
  // needs no special case at all - the branches below start it on the normal path
  // (with the backoff pacing, the mount-path recreation, the controller re-read
  // and the CFS burst reapplication that appDockerStart owns), or leave it
  // stopped if that is what is wanted. Handled ahead of the desired-state branch
  // deliberately, so it is correct in both directions rather than only when the
  // component is meant to be running.
  //
  // Nothing can create a paused container from here on - pause is retired - so
  // this exists for the ones that already are, and for those a node that has not
  // upgraded yet can still make during the rollout. A daemon or host restart
  // clears them too (they come back exited), but a FluxOS restart does not, and
  // that is the one an upgrade performs.
  if (actual.paused) {
    log.warn(`appReconciler - ${identifier} is paused, which nothing can act on; stopping it so it can be reconciled normally`);
    try {
      await dockerService.appDockerStop(identifier);
      appInspector.stopAppMonitoring(identifier, false);
      fluxEventBus.publish('reconciler:actuated', { identifier, action: 'unpaused' });
    } catch (err) {
      log.error(`appReconciler - failed to stop the paused ${identifier}: ${err.message}; retrying. No FluxOS primitive releases a paused container - manual remedy on the node: docker unpause ${dockerService.getAppIdentifier(identifier)}`);
      scheduleRetry(identifier, MANAGED_RETRY_MS);
      return;
    }
    // The container is exited now, so what was sampled at entry is stale in the
    // one field the branches below read. Re-enqueue rather than reason from it.
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }

  // The heal state says "this container is absent because I removed it". The moment
  // the container exists and is not detached, that is stale - whatever its run state,
  // and whatever the desired state below turns out to be. Clearing here (rather than
  // only on the running+attached path) is what stops the flag leaking on every branch
  // that leaves a container stopped (awaiting-controller g:, operator stop), which
  // would otherwise divert a later, genuine disappearance away from the vanished path.
  if (actual.exists && !dockerService.isContainerDetachedFromNetwork(actual.attachment)) {
    await clearNetworkHealState(identifier);
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
        appInspector.stopAppMonitoring(identifier, false);
        fluxEventBus.publish('reconciler:actuated', { identifier, action: 'stopped', reason: 'dataClear' });
      }
      await serviceHelper.delay(DATA_CLEAR_SETTLE_MS);
      await volumeService.clearAppVolumeData(identifier);
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

  const { desired, reason, force } = await effectiveDesiredRunning(identifier, spec, actual.exitCode);

  // null = no controller opinion yet for a g:/r: component: neither start nor stop,
  // leave the container in its current state until the decider speaks.
  if (desired === null) return;

  if (!desired) {
    if (actual.running) {
      // A hard kill skips the graceful shutdown window, and only an operator asks
      // for one - every other stop reason is a drain. The flag arrives with the
      // decision that read it, from the same document and the same read as the
      // lock itself, so there is no second read here to disagree with the first.
      const forceKill = force === true;
      log.info(`appReconciler - ${identifier} desired stopped, ${forceKill ? 'killing' : 'stopping'}`);
      if (forceKill) {
        await dockerService.appDockerKill(identifier);
      } else {
        await dockerService.appDockerStop(identifier);
      }
      // Monitoring follows the container. The per-minute sampler otherwise runs
      // against a stopped container, logging an error a minute until something
      // else happens to stop it.
      appInspector.stopAppMonitoring(identifier, false);
      fluxEventBus.publish('reconciler:actuated', {
        identifier, action: 'stopped', reason, forced: forceKill,
      });
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
    // trusting "running"; heal by recreating, confirmed in-pass and paced.
    if (!dockerService.isContainerDetachedFromNetwork(actual.attachment)) {
      // An operator restart is a level, not an action: it raises a generation and
      // this bounces the container once the generation passes the one already
      // actuated. Not paced by the backoff ladder - a deliberate bounce is not
      // crash recovery, and pacing it is what made six restarts look like an app
      // that could not stay up.
      const restartState = await appsRuntimeState.getState(identifier);
      const desiredGeneration = (restartState && restartState.restartGeneration) || 0;
      const actuatedGeneration = (restartState && restartState.actuatedRestartGeneration) || 0;
      if (desiredGeneration > actuatedGeneration) {
        log.info(`appReconciler - ${identifier} restart requested (generation ${desiredGeneration}); restarting`);
        try {
          await dockerService.appDockerRestart(identifier);
        } catch (err) {
          log.error(`appReconciler - failed to restart ${identifier} on request: ${err.message}; retrying`);
          fluxEventBus.publish('reconciler:actuated', { identifier, action: 'restartRequestFailed', reason: err.message });
          scheduleRetry(identifier, MANAGED_RETRY_MS);
          return;
        }
        fluxEventBus.publish('reconciler:actuated', { identifier, action: 'restarted', reason: 'operatorRequested' });
        notifyContainerStarted(identifier);
        // A restart is a start, so it can come up on a stale endpoint the same way.
        scheduleRetry(identifier, POST_START_VERIFY_MS);
        // Last, because it throws. The bounce above already happened, so a write
        // failure must not also cost the event, the peer notification and the
        // attachment check a successful restart is owed - it is the record that
        // failed, not the restart.
        //
        // The throw reaches the pass-level retry, which PACES it - a rate, not a
        // bound, and the difference matters. UNHANDLED_FAILURE_RETRIES clears only
        // on a pass that succeeds, so a database that reads but cannot write never
        // records the generation: four bounces over fifteen seconds, then one per
        // hourly sweep for as long as the condition holds. Bounding it needs that
        // condition to be something the node observes centrally rather than each
        // write site discovering it alone, which is its own change.
        await appsRuntimeState.recordRestartGeneration(identifier, desiredGeneration);
        return;
      }
      // The container is where it should be; monitoring may not be. A stop turns
      // it off, and a stop docker never carried out leaves a running container
      // unmonitored with no later pass to notice.
      appInspector.ensureAppMonitoring(identifier);
      return; // running and properly attached (heal state was cleared above)
    }
    await healDetachedNetwork(identifier, mainAppName, spec);
    return;
  }

  if (!actual.exists) {
    // Durable, so it survives a FluxOS restart mid-heal: if WE removed this
    // container to clear a stale endpoint, its absence is not tampering. Keep
    // recreating it - paced on the heal ladder, never escalating to the vanished
    // path's uninstall-on-failure. Only a container that vanished by other means
    // takes that path.
    let healRemoved;
    try {
      healRemoved = await appsRuntimeState.isNetworkHealRemoval(identifier);
    } catch (err) {
      // We cannot tell whether we removed this container ourselves. Guessing "no" is
      // the destructive guess: it records a false tampering event and can uninstall
      // the whole app on a failed recreate. Defer until the state is readable.
      log.warn(`appReconciler - cannot read the heal state of the missing ${identifier} (${err.message}); deferring rather than treating it as vanished`);
      scheduleRetry(identifier, MANAGED_RETRY_MS);
      return;
    }
    if (healRemoved) {
      const wait = await appsRuntimeState.networkHealWaitMs(identifier);
      if (wait > 0) {
        log.warn(`appReconciler - ${identifier} awaiting recreation after a network heal, backing off ${Math.round(wait / 1000)}s`);
        scheduleRetry(identifier, wait);
        return;
      }
      try {
        await appsRuntimeState.recordNetworkHealAttempt(identifier);
      } catch (err) {
        // unpaced retries would hammer the recreate; defer instead
        log.error(`appReconciler - cannot pace the heal recreate of ${identifier} (${err.message}); will retry`);
        scheduleRetry(identifier, MANAGED_RETRY_MS);
        return;
      }
      await recreateForNetworkHeal(identifier);
      return;
    }
    await recreateMissing(identifier);
    return;
  }

  // exists but stopped, should run -> restart, paced by the ladder only when the
  // stop carries evidence of a fault (no sleeping; the worker re-enqueues when
  // the backoff window elapses). A clean exit goes back immediately: it is an
  // operator restarting their own app far more often than it is a crash, and
  // pacing that turns a deliberate restart into what looks like an outage.
  // exitCode null is a container that has never run - an initial start, not a death.
  const crashed = !!actual.oomKilled || (actual.exitCode !== null && actual.exitCode !== 0);
  const wait = await appsRuntimeState.restartWaitMs(identifier, actual.finishedAt);
  if (wait > 0) {
    // name which of the two put it here: a reported fault, or restarts arriving
    // fast enough to be one whatever the exit code said. Support cannot tell
    // these apart from the outside, and the difference decides what they do next.
    const cause = crashed
      ? `exit ${actual.exitCode}${actual.oomKilled ? ' (OOM-killed)' : ''}`
      : 'restarting too fast to be healthy';
    // How far up the ladder this is. waitMs alone cannot say: it is what REMAINS
    // of the rung, and the worker re-enqueues during a wait, so one rung reports
    // several times, each smaller than the last. Two backoffs cannot be compared
    // without it - which is how far a component has escalated, and whether it
    // ever went backwards. Read on the backoff path only, which is a paced
    // restart and therefore cold.
    const backoffState = await appsRuntimeState.getState(identifier);
    const rung = ((backoffState && backoffState.restartHistory) || []).length;
    log.warn(`appReconciler - ${identifier} stopped, ${cause}; backing off ${Math.round(wait / 1000)}s before restart (rung ${rung})`);
    fluxEventBus.publish('reconciler:actuated', {
      identifier, action: 'backoff', waitMs: wait, rung, crashed,
    });
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

  await appsRuntimeState.recordRestart(identifier, crashed);
  try {
    await dockerService.appDockerStart(identifier);
  } catch (err) {
    // No die event fires for a failed start (the container never ran), so a
    // dropped throw here leaves the component down until the hourly sweep.
    // Schedule our own retry. A start that never ran carries no exit code, so it
    // is not a fault and does not walk the ladder directly - it reaches the
    // ladder by filling the burst window, which these retries do comfortably
    // (restartBurstCount x MANAGED_RETRY_MS against restartBurstWindowMs). That
    // relationship is what bounds a permanently failing start, and the config
    // comment on the window is where it is stated.
    log.error(`appReconciler - failed to start ${identifier}: ${err.message}; retrying`);
    fluxEventBus.publish('reconciler:actuated', { identifier, action: 'startFailed', reason: err.message });
    scheduleRetry(identifier, MANAGED_RETRY_MS);
    return;
  }
  appInspector.startAppMonitoring(identifier);
  // A restart of a container that was already stopped IS this start, so the
  // request is satisfied here. Left pending, the pass that next finds it running
  // would bounce a container the operator has just watched come up.
  const startedState = await appsRuntimeState.getState(identifier);
  const pendingGeneration = (startedState && startedState.restartGeneration) || 0;
  const satisfiesRestart = pendingGeneration > ((startedState && startedState.actuatedRestartGeneration) || 0);
  log.info(`appReconciler - ${identifier} restarted`);
  fluxEventBus.publish('reconciler:actuated', { identifier, action: 'started', exitCode: actual.exitCode });
  notifyContainerStarted(identifier);
  // A start is exactly when a container can come up attached to no network (a stale
  // endpoint left by an earlier failed start). The attachment we hold was sampled
  // BEFORE this start, so verify the new one shortly - otherwise a detached-at-boot
  // container waits for the hourly sweep.
  scheduleRetry(identifier, POST_START_VERIFY_MS);
  // Last, because it throws - the start above already happened, and the record
  // failing must not cost the bookkeeping that start is owed.
  if (satisfiesRestart) {
    await appsRuntimeState.recordRestartGeneration(identifier, pendingGeneration);
  }
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
  const pass = reconcile(identifier)
    .then(() => {
      // A pass that got through is the only evidence the fault has cleared.
      unhandledFailures.delete(identifier);
    })
    .catch((err) => {
      const attempt = (unhandledFailures.get(identifier) || 0) + 1;
      unhandledFailures.set(identifier, attempt);
      const retrying = attempt <= UNHANDLED_FAILURE_RETRIES;
      log.error(
        `appReconciler - reconcile ${identifier} failed: ${err.message}`
        + (retrying
          ? `; retrying (${attempt}/${UNHANDLED_FAILURE_RETRIES})`
          : `; ${attempt} consecutive failures, leaving it to the hourly sweep`),
      );
      // Published for every unhandled failure rather than at each throw site: the
      // sites that can throw are the ones nobody thought to guard, so an event
      // added per site would miss exactly the same ones the retry did.
      fluxEventBus.publish('reconciler:actuated', {
        identifier, action: 'reconcileFailed', reason: err.message, attempt, retrying,
      });
      if (retrying) scheduleRetry(identifier, MANAGED_RETRY_MS);
    })
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
  // Registered synchronously: promise callbacks are microtasks, so the finally
  // above cannot run before this line and clear an entry that is not there yet.
  inFlight.set(identifier, pass);
  return pass;
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
    return null;
  }
  if (inFlight.has(identifier)) {
    dirty.add(identifier);
    // The pass already running was started against state older than whatever
    // just changed, so it is NOT the pass a caller wanting actuation should
    // wait on. The re-run this marks dirty is, and it has no promise yet.
    return null;
  }
  return runReconcile(identifier);
}

/**
 * Change what a component is supposed to be doing, without racing a pass that is
 * deciding what to do about it.
 *
 * A reconcile reads the desired state, then acts on that answer some
 * milliseconds later once docker has answered. An intent written in that gap is
 * not seen: the pass starts a container an operator has just stopped, and the
 * next pass stops it again. The lock is written correctly and early - the
 * problem is that the check and the action are not atomic against a concurrent
 * writer, so narrowing the gap with a second check before acting would leave the
 * same defect with a smaller window.
 *
 * Instead the write takes the same per-key slot a pass takes. It waits out a
 * pass already deciding, holds the key while it writes so `enqueue` marks the
 * key dirty rather than starting one, and enqueues on release so the next pass
 * reads the intent it just wrote. The two can no longer interleave because they
 * are mutually exclusive by construction.
 *
 * The wait is one pass of ONE component - a docker probe and at most one action -
 * so an operator's command is never behind unrelated work. That is a BOUND only
 * while passes terminate, and the docker calls a pass makes carry no timeout of
 * their own: a daemon that HANGS rather than fails leaves the pass unfinished and
 * this wait with nothing to wake it.
 *
 * What that costs is durability, not correctness: nothing wrong is recorded, and
 * the caller's request hangs on a wedged daemon regardless. What is lost is a
 * FluxOS restart during the hang - the write has not landed, so the intent does
 * not survive one.
 *
 * Bounding THIS wait is not the repair - giving up on it and writing anyway
 * restores the interleave described above, which is the defect this exists to
 * fix. Bounding the docker calls is, and that is fleet-wide work rather than
 * something this function can do alone.
 * @param {string} rawIdentifier Component identifier.
 * @param {Function} mutate Writes the new intent. Awaited while the key is held.
 * @param {object} [opts]
 * @param {boolean} [opts.awaitPass] Wait for the reconcile that follows, so a
 *   caller can report what was DONE rather than what was asked for. The pass is
 *   awaited to completion, actuated or deferred - it never throws here, since
 *   runReconcile absorbs its own failures.
 * @returns {Promise<boolean>} True when a pass ran to completion. False when the
 *   intent is durable but nothing has acted on it yet - the boot gate is shut,
 *   or another pass is mid-flight and the re-run has not started. Callers that
 *   report to a user must not present false as success.
 */
async function applyIntent(rawIdentifier, mutate, { awaitPass = false } = {}) {
  const identifier = canonical(rawIdentifier);

  // A loop, not a single await: releasing the key lets a queued pass start
  // before this continues, and that pass would be reading the state we are
  // about to replace.
  // eslint-disable-next-line no-await-in-loop
  while (inFlight.has(identifier)) await inFlight.get(identifier).catch(() => {});

  let release;
  const held = new Promise((resolve) => { release = resolve; });
  inFlight.set(identifier, held);
  try {
    await mutate();
  } finally {
    inFlight.delete(identifier);
    release();
  }

  const pass = enqueue(identifier);
  if (!awaitPass) return Boolean(pass);
  if (!pass) return false;
  await pass;
  return true;
}

/**
 * The component identifiers of a set of installed apps.
 *
 * Enterprise specs are stored encrypted (compose: []) and the component names
 * live INSIDE the blob, so the set is decrypted first - leniently: one app
 * failing to decrypt must not cost the rest their components. An app that stays
 * encrypted is enumerated from the containers docker is already holding for it,
 * matched on the `_<appname>` suffix, so it is never silently skipped. That
 * source can only see components that EXIST, which is the most that can be known
 * about such an app anyway: a vanished component of one cannot be recreated
 * either, because recreating it needs the spec.
 *
 * The listing is taken once for the whole set, and only if something failed to
 * decrypt.
 *
 * @param {Array<object>} installed Records from appQueryService.installedApps().
 * @returns {Promise<string[]>} Bare component identifiers (`<component>_<app>`,
 *   or `<app>` for v1-3) across every app given - one spelling whichever source
 *   they came from.
 */
async function componentIdsOf(installed) {
  const { readable, unreadable } = await appQueryService.decryptEnterpriseApps(installed, { formatSpecs: false });
  const ids = [];

  readable.forEach((app) => {
    if (app.version >= 4 && Array.isArray(app.compose)) {
      app.compose.forEach((c) => ids.push(`${c.name}_${app.name}`));
    } else {
      ids.push(app.name);
    }
  });

  if (!unreadable.length) return ids;

  let dockerNames;
  try {
    const containers = await dockerService.dockerListContainers(true);
    dockerNames = containers.map((c) => (c.Names && c.Names[0] ? c.Names[0].slice(1) : ''));
  } catch (err) {
    log.warn(`appReconciler - cannot list containers for undecryptable apps: ${err.message}`);
    return ids;
  }
  unreadable.forEach((app) => {
    const suffix = `_${app.name}`;
    // Docker holds the namespaced name (`flux<component>_<app>`); the readable
    // branch above produces the bare one. One list carries one spelling, so a
    // consumer that compares it against a component name an operator typed
    // matches it, rather than refusing every component of an app whose spec
    // will not decrypt. The consumers that canonicalise on ingest cannot tell
    // the two apart, which is why they coexisted unnoticed.
    dockerNames.filter((name) => name.endsWith(suffix)).forEach((name) => ids.push(canonical(name)));
  });
  return ids;
}

/**
 * Enqueue every installed component (hourly tick / reconnect / boot drift).
 */
async function enqueueAll(reason = 'resync') {
  const res = await appQueryService.installedApps();
  if (!res || res.status !== 'success') return;
  const ids = await componentIdsOf(res.data);
  // canonicalised to the bare component identifier by enqueue
  ids.forEach((id) => enqueue(id));
  fluxEventBus.publish('reconciler:swept', { reason, count: ids.length });
}

/**
 * Ask every component of these apps to restart, and let the normal machinery
 * carry it out.
 *
 * For a caller that knows the node has changed underneath its apps - the address
 * moved, so the containers have to come up on the new one - and knows nothing
 * else about them. Everything an app is made of is worked out here rather than by
 * the caller: which components it has, whether its specs can be read, and what a
 * restart request even is.
 *
 * Durable and paced, deliberately. A generation survives a FluxOS restart part
 * way through, where a docker call issued from the caller is simply lost, and it
 * queues behind the same slot as every other intent instead of racing it. Each
 * request is independent: one component that cannot be recorded must not cost the
 * others theirs.
 *
 * @param {Array<object>} installed Records from appQueryService.installedApps().
 * @param {string} reason Why, for the log.
 * @returns {Promise<number>} How many components were asked.
 */
async function requestRestartOf(installed, reason) {
  const ids = await componentIdsOf(installed);
  let asked = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await applyIntent(id, async () => {
      await appsRuntimeState.requestRestart(id);
    }).then(() => { asked += 1; })
      .catch((err) => log.error(`appReconciler - could not request restart of ${id} (${reason}): ${err.message}`));
  }
  log.info(`appReconciler - restart requested for ${asked}/${ids.length} components (${reason})`);
  return asked;
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

/**
 * Retract the controller's opinion about whether this component should run,
 * leaving every other desired input standing.
 *
 * A pending data clear is NOT an opinion about running - it is the sync layer's
 * finding that the local appdata must not be trusted - so it survives. It has
 * to: the sync layer marks a component processed BEFORE asking, so a request
 * dropped here is never made again and the component eventually starts on the
 * data the clear existed to remove. The reconciler resolves a pending clear
 * ahead of any run decision, so one left standing on a stopped component simply
 * waits.
 */
function clearControllerDesired(rawIdentifier) {
  const identifier = canonical(rawIdentifier);
  controllerDesired.delete(identifier);
}

/**
 * Forget every desired input for a component - it is gone, and nothing about it
 * is worth acting on. Removal only: for anything short of that, retract the
 * specific opinion.
 */
function forgetDesiredState(rawIdentifier) {
  const identifier = canonical(rawIdentifier);
  controllerDesired.delete(identifier);
  dataDesired.delete(identifier);
  // A removed component keeps no failure history: the map is keyed by identifier
  // and a reinstall under the same name would otherwise start part-way up the
  // count and reach the sweep sooner than a first failure should.
  unhandledFailures.delete(identifier);
}

/**
 * A decider has committed to running this component but cannot start it yet -
 * the masterSlave primary path fixes ownership on the persistent data first,
 * which takes long enough that a peer asking "is anyone running this?" gets a
 * truthful no and starts a second writer. Held from the decision, released when
 * the attempt ends: a start that succeeds is covered by controllerDesired from
 * then on, and one that fails is correctly no longer a claim.
 *
 * Deliberately not time-bounded. The claimant knows when it has finished, so
 * there is nothing to guess at, and the state is process-local - a crash or a
 * FluxOS restart drops it with no way for a stale claim to outlive its owner.
 */
function claimStarting(rawIdentifier) {
  startingClaims.add(canonical(rawIdentifier));
}

function releaseStarting(rawIdentifier) {
  startingClaims.delete(canonical(rawIdentifier));
}

/**
 * Component identifiers this node runs or is committed to running, from its own
 * state alone. The running containers are the caller's to add - this is the part
 * Docker cannot answer.
 * @returns {string[]}
 */
function committedIdentifiers() {
  const ids = new Set(startingClaims);
  controllerDesired.forEach((state, identifier) => {
    if (state === 'running') ids.add(identifier);
  });
  return [...ids];
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
  unhandledFailures.clear();
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
  applyIntent,
  enqueueAll,
  requestRestartOf,
  setControllerDesired,
  clearControllerDesired,
  forgetDesiredState,
  claimStarting,
  releaseStarting,
  committedIdentifiers,
  requestStopAndClearData,
  setOnContainerStarted,
  waitForBootDrainSettled: () => bootDrainGate.wait(),
  start,
  stop,
  // The one answer to "what is this container actually doing" - it probes the
  // daemon rather than pattern-matching an inspect error, so it can tell docker
  // being unreachable from the container being gone. Anything that acts on a
  // container's run state needs that distinction, not just the reconciler.
  dockerActual,
  // What the reconciler would do with this component now, for a caller that has
  // to report an operator command's outcome truthfully.
  desiredRunState,
  // What an app is actually made of. Enterprise specs keep their component names
  // inside an encrypted blob, so reading `compose` off a stored spec yields an
  // empty list and silently addresses nothing - which is why every caller that
  // needs an app's components asks here rather than working it out again.
  componentIdsOf,
  // exposed for tests
  reconcile,
  policyAllowsRun,
  getRestartPolicy,
};
