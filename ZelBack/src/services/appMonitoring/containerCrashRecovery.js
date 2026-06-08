const log = require('../../lib/log');
const dockerService = require('../dockerService');
const globalState = require('../utils/globalState');
const appsRuntimeState = require('../appManagement/appsRuntimeState');
const appReconciler = require('./appReconciler');

// Bridges the Docker container 'die' event stream into the reconcile workqueue.
// All restart decisions (restart policy, exit code, backoff, operator-stop,
// in-progress operations) live in appReconciler — this only translates "a flux
// container exited" into "this component needs reconciling", and on stream
// reconnect sweeps every component to catch containers orphaned while the
// stream was down (e.g. a dockerd restart underneath a running FluxOS).

let eventStream = null;
let stopped = false;
let lineBuf = '';
let hasConnected = false;

function isFluxContainer(name) {
  return name.startsWith('flux') || name.startsWith('zel');
}

function getComponentIdentifier(containerName) {
  if (containerName.startsWith('flux')) return containerName.substring(4);
  if (containerName.startsWith('zel')) return containerName.substring(3);
  return containerName;
}

async function handleContainerDie(event) {
  const containerName = event.Actor?.Attributes?.name;
  if (!containerName || !isFluxContainer(containerName)) return;

  // A deliberate FluxOS stop (appDockerStop/Kill/Restart) marks the container in
  // stoppingContainers; its die needs no reconcile - the operation already set the
  // desired state. Consume the flag and skip, mirroring the pre-reconciler watcher.
  // This also avoids a perpetual 5s reconcile-defer loop for a stopped-and-staying-
  // stopped container, whose flag would otherwise linger until the next start.
  if (globalState.stoppingContainers.has(containerName)) {
    globalState.stoppingContainers.delete(containerName);
    return;
  }

  const exitCode = parseInt(event.Actor?.Attributes?.exitCode, 10);
  const identifier = getComponentIdentifier(containerName);

  // best-effort diagnostics; the reconciler reads the authoritative exit code
  // from Docker, so a failure here (e.g. DB not ready during boot) is harmless
  await appsRuntimeState.recordExit(identifier, Number.isNaN(exitCode) ? null : exitCode);
  appReconciler.enqueue(identifier);
}

async function subscribe() {
  if (eventStream) return;
  lineBuf = '';

  try {
    eventStream = await dockerService.dockerGetEvents({
      filters: { type: ['container'], event: ['die'] },
    });

    eventStream.on('data', (buf) => {
      if (stopped) return;
      lineBuf += buf.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          handleContainerDie(event).catch((err) => {
            log.error(`containerCrashRecovery - event handler error: ${err.message}`);
          });
        } catch (parseErr) {
          log.error(`containerCrashRecovery - failed to parse docker event: ${parseErr.message}`);
        }
      }
    });

    eventStream.on('error', (err) => {
      log.error(`containerCrashRecovery - event stream error: ${err.message}`);
      eventStream = null;
      if (!stopped) {
        setTimeout(() => subscribe(), 10000);
      }
    });

    eventStream.on('end', () => {
      log.warn('containerCrashRecovery - event stream ended');
      eventStream = null;
      if (!stopped) {
        setTimeout(() => subscribe(), 10000);
      }
    });

    log.info('containerCrashRecovery - listening for container crash events');

    // a re-established stream may have missed die events while it was down;
    // reconcile every component from actual state to catch orphans
    if (hasConnected && globalState.bootContainerStateSettled) {
      log.info('containerCrashRecovery - stream reconnected, reconciling all components');
      appReconciler.enqueueAll('reconnect').catch((err) => {
        log.error(`containerCrashRecovery - reconnect reconcile failed: ${err.message}`);
      });
    }
    hasConnected = true;
  } catch (err) {
    log.error(`containerCrashRecovery - failed to subscribe to docker events: ${err.message}`);
    eventStream = null;
    if (!stopped) {
      setTimeout(() => subscribe(), 10000);
    }
  }
}

async function start() {
  stopped = false;
  hasConnected = false;
  await subscribe();
}

function stop() {
  stopped = true;
  if (eventStream) {
    eventStream.destroy();
    eventStream = null;
  }
}

module.exports = {
  start,
  stop,
  // exposed for tests
  handleContainerDie,
};
