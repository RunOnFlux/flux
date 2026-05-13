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
