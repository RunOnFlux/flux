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
  const daemon = await import('./daemon-control.js');
  // Advance one block manually so the explorer has something to process
  await daemon.advanceBlock();
  return waitFor(async () => {
    const explorer = await node.getExplorerHeight();
    const explorerHeight = explorer?.data?.generalScannedHeight ?? 0;
    return explorerHeight > 2100000;
  }, { timeout, interval: 1000, label: `${node.ip} explorer synced` });
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

export async function waitForBoot(env, index, timeout = 60000) {
  return waitFor(() => {
    return env.nodeHasLog(index, 'Flux Block Processing Service started');
  }, { timeout, interval: 1000, label: `node ${index} block processor ready` });
}
