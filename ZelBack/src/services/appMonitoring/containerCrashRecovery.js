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
let subscribing = false; // a subscribe is mid-await (its stream not yet assigned)
let resubscribeTimer = null; // exactly one pending resubscribe, however many signals fired
let lineBuf = '';
let hasConnected = false;

const RESUBSCRIBE_DELAY_MS = 10000;

// Every way a stream can die ('error', 'end', a raw 'close', or a failed
// subscribe) funnels here, and the timer guard collapses them: one outage
// produces exactly one new stream. Unguarded, error+end firing together
// doubled the stream - and every die event was then handled twice.
function scheduleResubscribe(reason) {
  if (stopped || resubscribeTimer || eventStream) return;
  log.warn(`containerCrashRecovery - event stream ${reason}; resubscribing in ${RESUBSCRIBE_DELAY_MS / 1000}s`);
  resubscribeTimer = setTimeout(() => {
    resubscribeTimer = null;
    // eslint-disable-next-line no-use-before-define
    subscribe();
  }, RESUBSCRIBE_DELAY_MS);
}

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
  // stoppingContainers for the duration of the operation; its die needs no
  // reconcile - the operation already recorded the desired state before acting.
  // Skip to avoid churn. Best-effort only: the flag is cleared by the operation
  // itself when it settles (never by this event), so a die that arrives after
  // the operation resolved simply falls through to a desired-state no-op.
  if (globalState.stoppingContainers.has(containerName)) {
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
  if (eventStream || subscribing) return;
  subscribing = true;
  lineBuf = '';

  try {
    const stream = await dockerService.dockerGetEvents({
      filters: { type: ['container'], event: ['die'] },
    });
    eventStream = stream;

    // handlers are scoped to THIS stream: a late signal from an already
    // replaced stream must not retire its healthy successor
    const onGone = (reason) => {
      if (eventStream === stream) eventStream = null;
      scheduleResubscribe(reason);
    };

    stream.on('data', (buf) => {
      if (stopped || eventStream !== stream) return;
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

    stream.on('error', (err) => {
      log.error(`containerCrashRecovery - event stream error: ${err.message}`);
      onGone('errored');
    });
    stream.on('end', () => onGone('ended'));
    // a raw socket teardown can emit 'close' without 'error' or 'end'
    stream.on('close', () => onGone('closed'));

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
    scheduleResubscribe('subscribe failed');
  } finally {
    subscribing = false;
  }
}

async function start() {
  stopped = false;
  hasConnected = false;
  await subscribe();
}

function stop() {
  stopped = true;
  if (resubscribeTimer) {
    clearTimeout(resubscribeTimer);
    resubscribeTimer = null;
  }
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
