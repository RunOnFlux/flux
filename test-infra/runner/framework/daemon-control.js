const CONTROL = process.env.DAEMON_CONTROL || 'http://198.18.0.3:18232';

async function post(path, body) {
  const res = await fetch(`${CONTROL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function del(path) {
  const res = await fetch(`${CONTROL}${path}`, { method: 'DELETE' });
  return res.json();
}

async function get(path) {
  const res = await fetch(`${CONTROL}${path}`);
  return res.json();
}

export async function getState() {
  return get('/state');
}

// -- Ticker --

export async function startTicker() {
  return post('/ticker/start');
}

export async function stopTicker() {
  return post('/ticker/stop');
}

// -- Block control --

export async function advanceBlock(appHash) {
  return post('/advance-block', appHash ? { appHash } : {});
}

export async function advanceBlocks(count) {
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop
    await advanceBlock();
  }
}

export async function setHeight(height) {
  return post('/set-height', { height });
}

export async function queueAppTx(appHash) {
  return post('/queue-app-tx', { appHash });
}

// -- Per-node status --

export async function setNodeStatus(ip, status) {
  return post(`/node-status/${ip}`, { status });
}

export async function clearNodeStatus(ip) {
  return del(`/node-status/${ip}`);
}

export async function setAllNodeStatus(status) {
  return post('/node-status/all', { status });
}

export async function clearAllNodeStatus() {
  return del('/node-status/all');
}

export async function getNodeStatusOverrides() {
  return get('/node-status');
}

// -- Deterministic list --

export async function removeFromNodeList(ip) {
  return post(`/node-list/remove/${ip}`);
}

export async function restoreToNodeList(ip) {
  return post(`/node-list/restore/${ip}`);
}

export async function resetNodeList() {
  return post('/node-list/reset');
}

// -- Node tier --

export async function setNodeTier(ip, tier) {
  return post(`/node-tier/${ip}`, { tier });
}

// -- RPC failure --

export async function enableRpcFailure(ip) {
  return post(`/rpc-fail/${ip}`);
}

export async function disableRpcFailure(ip) {
  return del(`/rpc-fail/${ip}`);
}

export async function enableAllRpcFailure() {
  return post('/rpc-fail/all');
}

export async function disableAllRpcFailure() {
  return del('/rpc-fail/all');
}

// -- Request journal --

export async function getJournal({ method, sourceIp } = {}) {
  const params = new URLSearchParams();
  if (method) params.set('method', method);
  if (sourceIp) params.set('sourceIp', sourceIp);
  return get(`/journal?${params}`);
}

export async function clearJournal() {
  return del('/journal');
}

// -- Reset --

export async function resetAll() {
  return post('/reset');
}
