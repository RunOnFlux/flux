export async function waitFor(condition, { timeout = 60000, interval = 2000, label = '' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout after ${timeout}ms waiting for: ${label || 'condition'}`);
}

// Event-based wait helpers (use SSE event stream)

export async function waitForDaemonPolled(node, predicate = () => true, timeout = 30000) {
  return node.waitForEvent('daemon:polled', predicate, timeout);
}

export async function waitForDaemonReady(node, timeout = 60000) {
  return node.waitForEvent('daemon:polled', () => true, timeout);
}

export async function waitForBlockProcessed(node, predicate = () => true, timeout = 30000) {
  return node.waitForEvent('block:processed', predicate, timeout);
}

export async function waitForDosChanged(node, predicate = () => true, timeout = 30000) {
  return node.waitForEvent('dos:changed', predicate, timeout);
}

export async function waitForAppInstalled(node, appName, timeout = 60000) {
  return node.waitForEvent('app:installed', (data) => data.name === appName, timeout);
}

export async function waitForAppRemoved(node, appName, timeout = 60000) {
  return node.waitForEvent('app:removed', (data) => data.name === appName, timeout);
}

export async function waitForNodeStatus(node, predicate, timeout = 30000) {
  return node.waitForEvent('confirmation:changed', predicate, timeout);
}

export async function waitForAppSpecStored(node, appName, timeout = 120000) {
  return node.waitForEvent('app:specStored', (data) => data.name === appName, timeout);
}

export async function waitForDaemonUnreachable(node, timeout = 30000) {
  return node.waitForEvent('daemon:unreachable', () => true, timeout);
}

export async function waitForDaemonRecovered(node, timeout = 30000) {
  return node.waitForEvent('daemon:recovered', () => true, timeout);
}

export async function waitForExplorerReady(node, timeout = 120000) {
  return node.waitForEvent('explorer:ready', () => true, timeout);
}

export async function waitForMessageCapabilityChanged(node, capable, timeout = 30000) {
  return node.waitForEvent('messageCapability:changed', (d) => d.capable === capable, timeout);
}

export async function waitForOrchestratorStarted(node, timeout = 120000) {
  return node.waitForEvent('orchestrator:started', () => true, timeout);
}

export async function waitForOrchestratorState(node, state, timeout = 60000) {
  return node.waitForEvent('orchestrator:stateChanged', (d) => d.to === state, timeout);
}

export async function waitForPeerThreshold(node, timeout = 120000) {
  return node.waitForEvent('peers:thresholdReached', () => true, timeout);
}

export async function waitForBootSettled(node, timeout = 120000) {
  return node.waitForEvent('boot:settled', () => true, timeout);
}

export async function waitForPeersBelowThreshold(node, timeout = 30000) {
  return node.waitForEvent('peers:belowThreshold', () => true, timeout);
}

export async function waitForSpawnerPaused(node, timeout = 30000) {
  return node.waitForEvent('spawner:paused', () => true, timeout);
}

export async function waitForSpawnerResumed(node, timeout = 60000) {
  return node.waitForEvent('spawner:resumed', () => true, timeout);
}

export async function waitForSpawnerBlocked(node, reason, timeout = 30000) {
  return node.waitForEvent('spawner:blocked', (d) => d.reason === reason, timeout);
}

export async function waitForImageUpdateChecked(node, timeout = 60000) {
  return node.waitForEvent('imageUpdate:checked', () => true, timeout);
}

export async function waitForImageUpdateRedeploy(node, appName, timeout = 120000) {
  return node.waitForEvent('imageUpdate:redeployTriggered', (d) => d.appName === appName, timeout);
}

export async function waitForImageUpdateRedeployComplete(node, appName, timeout = 120000) {
  return node.waitForEvent('imageUpdate:redeployComplete', (d) => d.appName === appName, timeout);
}

export async function waitForAppRunning(node, appName, timeout = 60000) {
  return node.waitForEvent('app:running', (d) => d.apps?.some((a) => a.name === appName), timeout);
}
