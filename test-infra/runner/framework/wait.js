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
  return node.waitForEvent('node:statusChecked', predicate, timeout);
}

export async function waitForAppSpecStored(node, appName, timeout = 120000) {
  return node.waitForEvent('app:specStored', (data) => data.name === appName, timeout);
}

export async function waitForPeers(node, { outbound = 0, inbound = 0, timeout = 120000 } = {}) {
  return waitFor(async () => {
    const res = await node.getPeerDetails();
    if (res.status !== 'success' || !Array.isArray(res.data)) return false;
    const out = res.data.filter((p) => p.direction === 'outbound').length;
    const inc = res.data.filter((p) => p.direction === 'inbound').length;
    return out >= outbound && inc >= inbound;
  }, { timeout, interval: 2000, label: `peers outbound>=${outbound} inbound>=${inbound}` });
}
