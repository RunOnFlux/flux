import { getAppContainerStatus } from './container.js';

export async function waitFor(condition, { timeout = 60000, interval = 2000, label = '' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout after ${timeout}ms waiting for: ${label || 'condition'}`);
}

// Container-state wait helpers (docker-level, via the node's DinD)
export async function waitForUp(client, appName, label, { timeout = 120000, interval = 2000 } = {}) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName);
    return !!(status && status.status.startsWith('Up'));
  }, { timeout, interval, label });
}

export async function waitForDown(client, appName, label, { timeout = 60000, interval = 2000 } = {}) {
  await waitFor(async () => {
    const status = await getAppContainerStatus(client.container, appName, { all: true });
    return !!(status && !status.status.startsWith('Up'));
  }, { timeout, interval, label });
}

// Event-based wait helpers (use SSE event stream)
// All accept an optional `opts` object passed through to waitForEvent (e.g. { afterId })

export async function waitForDaemonPolled(node, predicate = () => true, timeout = 30000, opts) {
  return node.waitForEvent('daemon:polled', predicate, timeout, opts);
}

export async function waitForDaemonReady(node, timeout = 60000, opts) {
  return node.waitForEvent('daemon:polled', () => true, timeout, opts);
}

export async function waitForBlockProcessed(node, predicate = () => true, timeout = 30000, opts) {
  return node.waitForEvent('block:processed', predicate, timeout, opts);
}

export async function waitForDosChanged(node, predicate = () => true, timeout = 30000, opts) {
  return node.waitForEvent('dos:changed', predicate, timeout, opts);
}

export async function waitForAppInstalled(node, appName, timeout = 60000, opts) {
  return node.waitForEvent('app:installed', (data) => data.name === appName, timeout, opts);
}

export async function waitForAppRemoved(node, appName, timeout = 60000, opts) {
  return node.waitForEvent('app:removed', (data) => data.name === appName, timeout, opts);
}

export async function waitForNodeStatus(node, predicate, timeout = 30000, opts) {
  return node.waitForEvent('confirmation:changed', predicate, timeout, opts);
}

export async function waitForAppSpecStored(node, appName, timeout = 120000, opts) {
  return node.waitForEvent('app:specStored', (data) => data.name === appName, timeout, opts);
}

export async function waitForDaemonUnreachable(node, timeout = 30000, opts) {
  return node.waitForEvent('daemon:unreachable', () => true, timeout, opts);
}

export async function waitForDaemonRecovered(node, timeout = 30000, opts) {
  return node.waitForEvent('daemon:recovered', () => true, timeout, opts);
}

export async function waitForExplorerReady(node, timeout = 120000, opts) {
  return node.waitForEvent('explorer:ready', () => true, timeout, opts);
}

export async function waitForMessageCapabilityChanged(node, capable, timeout = 30000, opts) {
  return node.waitForEvent('messageCapability:changed', (d) => d.capable === capable, timeout, opts);
}

export async function waitForOrchestratorStarted(node, timeout = 120000, opts) {
  return node.waitForEvent('orchestrator:started', () => true, timeout, opts);
}

export async function waitForOrchestratorState(node, state, timeout = 60000, opts) {
  return node.waitForEvent('orchestrator:stateChanged', (d) => d.to === state, timeout, opts);
}

export async function waitForPeerThreshold(node, timeout = 120000, opts) {
  return node.waitForEvent('peers:thresholdReached', () => true, timeout, opts);
}

export async function waitForBootSettled(node, timeout = 120000, opts) {
  return node.waitForEvent('boot:settled', () => true, timeout, opts);
}

// Boot anchor for log-asserting suites: the boot:settled EVENT is the
// behavioural bound, but it is published one statement BEFORE the settle log
// line is written (appStartupManager's finally block), and the SSE push beats
// the docker log pipeline (container stdout → dockerd → attach stream →
// collector) by tens of ms. Awaiting the settle LINE as well gives a pipeline
// sync point: the log stream is FIFO, so once that line has arrived every line
// written before it has too — instant nodeHasLog asserts (including absence
// asserts) made after this anchor are race-free. Call it from a block's
// before() so every test in the block is order-independent.
export async function waitForBootSettledAndLogged(env, index = 0, { timeout = 50000 } = {}) {
  await waitForBootSettled(env.clients[index], timeout);
  await waitFor(
    () => env.nodeHasLog(index, 'Boot container state settled'),
    { timeout: 10000, interval: 250, label: 'settled log line' },
  );
}

export async function waitForPeersBelowThreshold(node, timeout = 30000, opts) {
  return node.waitForEvent('peers:belowThreshold', () => true, timeout, opts);
}

export async function waitForSpawnerPaused(node, timeout = 30000, opts) {
  return node.waitForEvent('spawner:paused', () => true, timeout, opts);
}

export async function waitForSpawnerResumed(node, timeout = 60000, opts) {
  return node.waitForEvent('spawner:resumed', () => true, timeout, opts);
}

export async function waitForSpawnerBlocked(node, reason, timeout = 30000, opts) {
  return node.waitForEvent('spawner:blocked', (d) => d.reason === reason, timeout, opts);
}

export async function waitForImageUpdateChecked(node, timeout = 60000, opts) {
  return node.waitForEvent('imageUpdate:checked', () => true, timeout, opts);
}

export async function waitForImageUpdateRedeploy(node, appName, timeout = 120000, opts) {
  return node.waitForEvent('imageUpdate:redeployTriggered', (d) => d.appName === appName, timeout, opts);
}

export async function waitForImageUpdateRedeployComplete(node, appName, timeout = 120000) {
  return node.waitForEvent('imageUpdate:redeployComplete', (d) => d.appName === appName, timeout);
}

export async function waitForSpawnerDeferred(node, appName, reason, timeout = 60000) {
  const entry = await node.waitForEvent('spawner:deferred', (d) => d.appName === appName && (!reason || d.reason === reason), timeout);
  return entry.data;
}

export async function waitForAppRunning(node, appName, timeout = 60000) {
  return node.waitForEvent('app:running', (d) => d.apps?.some((a) => a.name === appName), timeout);
}

export async function waitForPeersRemoved(node, predicate = () => true, timeout = 30000) {
  return node.waitForEvent('peers:removed', predicate, timeout);
}

// --- reconciler (appReconciler) ---

// action: 'started' | 'stopped' | 'backoff' | 'recreated' | 'recreateFailed' (omit to match any)
export async function waitForReconcileActuated(node, identifier, action, timeout = 60000, opts) {
  return node.waitForEvent(
    'reconciler:actuated',
    (d) => d.identifier === identifier && (!action || d.action === action),
    timeout,
    opts,
  );
}

// state: 'running' | 'stopped' (omit to match any)
export async function waitForReconcilerDesiredChanged(node, identifier, state, timeout = 60000, opts) {
  return node.waitForEvent(
    'reconciler:desiredChanged',
    (d) => d.identifier === identifier && (!state || d.state === state),
    timeout,
    opts,
  );
}

// reason: 'reconnect' | 'hourly' | 'boot' | 'resync' (omit to match any)
export async function waitForReconcileSwept(node, reason, timeout = 60000, opts) {
  return node.waitForEvent(
    'reconciler:swept',
    (d) => !reason || d.reason === reason,
    timeout,
    opts,
  );
}

/**
 * Negative assertion: wait `windowMs` and assert that NO event named `name`
 * matching `predicate` arrived in that window. Captures the current last-seen
 * event id up front so events already buffered before the call are ignored.
 * Use for "the reconciler must NOT start this container" (e.g. syncthing S10).
 */
export async function assertNoEvent(node, name, predicate = () => true, windowMs = 5000) {
  const afterId = node.getLastEventId();
  await new Promise((r) => setTimeout(r, windowMs));
  const match = node.getEventBuffer().find(
    (e) => e.event === name && e.id > afterId && predicate(e.data),
  );
  if (match) {
    throw new Error(`Expected no '${name}' event within ${windowMs}ms but got: ${JSON.stringify(match.data)}`);
  }
}
