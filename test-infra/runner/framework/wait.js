export async function waitFor(condition, { timeout = 60000, interval = 2000, label = '' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout after ${timeout}ms waiting for: ${label || 'condition'}`);
}

export async function waitForPeers(node, minCount, timeout = 60000) {
  return waitFor(async () => {
    const res = await node.getPeers();
    return res.status === 'success' && res.data.length >= minCount;
  }, { timeout, label: `${node.ip} to have ${minCount}+ peers` });
}

export async function waitForExplorerSynced(node, timeout = 50000) {
  const { getState } = await import('./daemon-control.js');
  return waitFor(async () => {
    const [explorer, daemon] = await Promise.all([
      node.getExplorerHeight(),
      getState(),
    ]);
    const explorerHeight = explorer?.data?.generalScannedHeight ?? 0;
    return explorerHeight > 0 && daemon.currentHeight - explorerHeight <= 2;
  }, { timeout, label: `${node.ip} explorer synced` });
}

export async function waitForApi(node, timeout = 60000) {
  return waitFor(async () => {
    try {
      const res = await node.getVersion();
      return res.status === 'success';
    } catch {
      return false;
    }
  }, { timeout, interval: 1000, label: `${node.ip} API ready` });
}
