const log = require('../../lib/log');
const dockerService = require('../dockerService');
const globalState = require('../utils/globalState');
const appInspector = require('../appManagement/appInspector');

const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;

// containerName -> [timestampMs, ...]
const restartHistory = new Map();

let eventStream = null;
let stopped = false;

function isFluxContainer(name) {
  return name.startsWith('flux') || name.startsWith('zel');
}

function getComponentIdentifier(containerName) {
  if (containerName.startsWith('flux')) return containerName.substring(4);
  if (containerName.startsWith('zel')) return containerName.substring(3);
  return containerName;
}

function isCrashLooping(containerName) {
  const now = Date.now();
  const history = restartHistory.get(containerName);
  if (!history) return false;
  const recent = history.filter((ts) => now - ts < RESTART_WINDOW_MS);
  restartHistory.set(containerName, recent);
  return recent.length >= MAX_RESTARTS;
}

function recordRestart(containerName) {
  const history = restartHistory.get(containerName) || [];
  history.push(Date.now());
  restartHistory.set(containerName, history);
}

async function handleContainerDie(event) {
  const containerName = event.Actor?.Attributes?.name;
  const exitCodeStr = event.Actor?.Attributes?.exitCode;
  const exitCode = parseInt(exitCodeStr, 10);

  if (!containerName || !isFluxContainer(containerName)) return;

  if (exitCode === 0) {
    log.info(`containerCrashRecovery - ${containerName} exited cleanly (0), no action`);
    return;
  }

  if (!globalState.bootContainerStateSettled) {
    log.info(`containerCrashRecovery - ${containerName} died (exit ${exitCode}) but boot not settled, skipping`);
    return;
  }

  if (isCrashLooping(containerName)) {
    log.warn(`containerCrashRecovery - ${containerName} crash-looping (${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS / 1000}s), not restarting`);
    return;
  }

  const identifier = getComponentIdentifier(containerName);
  log.warn(`containerCrashRecovery - ${containerName} crashed (exit ${exitCode}), restarting as ${identifier}`);

  try {
    recordRestart(containerName);
    await dockerService.appDockerStart(identifier);
    appInspector.startAppMonitoring(identifier, globalState.appsMonitored);
    log.info(`containerCrashRecovery - ${identifier} restarted successfully`);
  } catch (err) {
    log.error(`containerCrashRecovery - failed to restart ${identifier}: ${err.message}`);
  }
}

async function start() {
  if (eventStream) return;
  stopped = false;

  try {
    eventStream = await dockerService.dockerGetEvents({
      filters: { type: ['container'], event: ['die'] },
    });

    eventStream.on('data', (buf) => {
      if (stopped) return;
      try {
        const event = JSON.parse(buf.toString());
        handleContainerDie(event).catch((err) => {
          log.error(`containerCrashRecovery - event handler error: ${err.message}`);
        });
      } catch (parseErr) {
        log.error(`containerCrashRecovery - failed to parse docker event: ${parseErr.message}`);
      }
    });

    eventStream.on('error', (err) => {
      log.error(`containerCrashRecovery - event stream error: ${err.message}`);
      eventStream = null;
      if (!stopped) {
        setTimeout(() => start(), 10000);
      }
    });

    eventStream.on('end', () => {
      log.warn('containerCrashRecovery - event stream ended');
      eventStream = null;
      if (!stopped) {
        setTimeout(() => start(), 10000);
      }
    });

    log.info('containerCrashRecovery - listening for container crash events');
  } catch (err) {
    log.error(`containerCrashRecovery - failed to subscribe to docker events: ${err.message}`);
    eventStream = null;
    if (!stopped) {
      setTimeout(() => start(), 10000);
    }
  }
}

function stop() {
  stopped = true;
  if (eventStream) {
    eventStream.destroy();
    eventStream = null;
  }
}

module.exports = { start, stop };
