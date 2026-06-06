const log = require('../../lib/log');
const dockerService = require('../dockerService');
const globalState = require('../utils/globalState');
const appInspector = require('../appManagement/appInspector');

// immediate, 30s, 5m, 15m, 30m cap
const BACKOFF_DELAYS_MS = [0, 30 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
const STABLE_RUN_MS = 10 * 60 * 1000;

// containerName -> [monotonicMs, ...]
const restartHistory = new Map();

const bootQueue = [];

let eventStream = null;
let stopped = false;
let lineBuf = '';

function isFluxContainer(name) {
  return name.startsWith('flux') || name.startsWith('zel');
}

function getComponentIdentifier(containerName) {
  if (containerName.startsWith('flux')) return containerName.substring(4);
  if (containerName.startsWith('zel')) return containerName.substring(3);
  return containerName;
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function getBackoffDelay(containerName) {
  const now = nowMs();
  const history = restartHistory.get(containerName);
  if (!history || history.length === 0) return 0;

  const lastRestart = history[history.length - 1];
  if (now - lastRestart > STABLE_RUN_MS) {
    restartHistory.delete(containerName);
    return 0;
  }

  const index = Math.min(history.length, BACKOFF_DELAYS_MS.length - 1);
  return BACKOFF_DELAYS_MS[index];
}

function recordRestart(containerName) {
  const history = restartHistory.get(containerName) || [];
  history.push(nowMs());
  // only the count (capped by the backoff ladder) and the last timestamp are
  // ever read, so keep the array bounded for perpetually crashing containers
  if (history.length > BACKOFF_DELAYS_MS.length) {
    history.splice(0, history.length - BACKOFF_DELAYS_MS.length);
  }
  restartHistory.set(containerName, history);
}

async function handleContainerDie(event) {
  const containerName = event.Actor?.Attributes?.name;
  const exitCodeStr = event.Actor?.Attributes?.exitCode;
  const exitCode = parseInt(exitCodeStr, 10);

  if (!containerName || !isFluxContainer(containerName)) return;

  if (globalState.stoppingContainers.has(containerName)) {
    globalState.stoppingContainers.delete(containerName);
    log.info(`containerCrashRecovery - ${containerName} was intentionally stopped (exit ${exitCode}), skipping`);
    return;
  }

  if (!globalState.bootContainerStateSettled) {
    log.info(`containerCrashRecovery - ${containerName} died (exit ${exitCode}) during boot, queuing`);
    bootQueue.push(event);
    return;
  }

  const identifier = getComponentIdentifier(containerName);
  const delay = getBackoffDelay(containerName);

  if (delay > 0) {
    log.warn(`containerCrashRecovery - ${containerName} crashed (exit ${exitCode}), waiting ${delay / 1000}s before restarting`);
    await new Promise((resolve) => { setTimeout(resolve, delay); });
    if (stopped) return;
    const container = await dockerService.getDockerContainerOnly(identifier);
    if (!container || container.State === 'running') {
      log.info(`containerCrashRecovery - ${containerName} already handled during backoff, skipping`);
      return;
    }
  } else {
    // confirm the container still exists and is not already running before restarting.
    // covers a container stopped+removed outside the appDockerStop chokepoint (its die
    // event would otherwise trigger a doomed appDockerStart and a misleading error log).
    const container = await dockerService.getDockerContainerOnly(identifier);
    if (!container || container.State === 'running') {
      log.info(`containerCrashRecovery - ${containerName} no longer exists or already running, skipping`);
      return;
    }
    log.warn(`containerCrashRecovery - ${containerName} crashed (exit ${exitCode}), restarting as ${identifier}`);
  }

  try {
    recordRestart(containerName);
    await dockerService.appDockerStart(identifier);
    appInspector.startAppMonitoring(identifier, globalState.appsMonitored);
    log.info(`containerCrashRecovery - ${identifier} restarted successfully`);
  } catch (err) {
    log.error(`containerCrashRecovery - failed to restart ${identifier}: ${err.message}`);
  }
}

async function drainBootQueue() {
  if (bootQueue.length === 0) return;
  log.info(`containerCrashRecovery - draining ${bootQueue.length} queued event(s)`);
  while (bootQueue.length > 0) {
    const event = bootQueue.shift();
    // eslint-disable-next-line no-await-in-loop
    await handleContainerDie(event);
  }
}

async function waitForBootAndDrain() {
  await globalState.waitForBootContainerStateSettled();
  if (!stopped) await drainBootQueue();
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
  await subscribe();

  waitForBootAndDrain().catch((err) => {
    log.error(`containerCrashRecovery - boot queue drain failed: ${err.message}`);
  });
}

function stop() {
  stopped = true;
  bootQueue.splice(0);
  if (eventStream) {
    eventStream.destroy();
    eventStream = null;
  }
}

// exposed for tests: lets a test assert the backoff history stays bounded by the ladder length
function restartHistoryLength(containerName) {
  const history = restartHistory.get(containerName);
  return history ? history.length : 0;
}

module.exports = { start, stop, restartHistoryLength };
