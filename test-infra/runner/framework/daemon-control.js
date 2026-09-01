import { getSubnetConfig } from './subnet-config.js';

const CONTROL = process.env.DAEMON_CONTROL || `http://${getSubnetConfig().daemon}:18232`;

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

// -- Where the network believes a node is --

/**
 * Move a node's address as the whole network sees it: what benchmark tells the
 * node about itself (which is where it learns its address changed), what
 * getpublicip answers, its node status, and its entry in the deterministic list.
 *
 * The container is untouched. `node` is where it really is - the address its
 * requests arrive from - and that never moves, so the fleet stays reachable and
 * every other node keeps talking to it exactly as before.
 *
 * A bare address keeps the node's own api port.
 *
 * `scope: 'all'` (default) moves every answer at once - an address change already
 * settled. `scope: 'publicip'` moves only benchmark's public-IP probe, leaving the
 * node listed and reporting itself where it was: the state a node is in the moment
 * its address moves, and the only one in which it can notice.
 *
 * @param {string} node Where the node really is.
 * @param {string} reported The address the network should now carry for it.
 */
export async function setNodeAddress(node, reported, { scope = 'all' } = {}) {
  return post(`/node-address/${String(node).split(':')[0]}`, { reported, scope });
}

/**
 * Hide a node from its peers' view of the network, so they answer "not available"
 * for it without probing anything.
 *
 * A peer asked whether it can reach a node consults its node list first and answers
 * outright when the address is not in it. That is an answer, not a timeout, so it
 * arrives inside the asker's budget every time - which is what makes an unreachable
 * node a deterministic fixture rather than a race.
 *
 * The node keeps seeing itself: it has its own confirmed-list gate to pass before it
 * will run the availability check at all.
 */
export async function hideNodeFromPeers(node) {
  return post(`/node-visibility/${String(node).split(':')[0]}`, { hidden: true });
}

/** Put a node back into its peers' view. */
export async function revealNodeToPeers(node) {
  return post(`/node-visibility/${String(node).split(':')[0]}`, { hidden: false });
}

/** Put a node's address back to where it really is. */
export async function clearNodeAddress(node) {
  return post(`/node-address/${String(node).split(':')[0]}`, {});
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

// Seed the stub's node list with a known set (each entry needs at least an `ip`),
// updating the restore/reset baseline too — mirrors the harness's setup POST. Use
// in nodes:0 suites that exercise the node-list endpoints, which otherwise start
// from an empty list.
export async function setNodeList(nodes) {
  return post('/set-node-list', { nodes });
}

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

// -- Seeded RPC data --

export async function seedAddressDeltas(deltas) {
  return post('/seed-address-deltas', { deltas });
}

export async function seedAddressTxids(txids) {
  return post('/seed-address-txids', { txids });
}

export async function seedTransaction(txid, tx) {
  return post('/seed-transaction', { txid, tx });
}

export async function clearSeededData() {
  return del('/seed-data');
}

// -- Reset --

export async function resetAll() {
  return post('/reset');
}
