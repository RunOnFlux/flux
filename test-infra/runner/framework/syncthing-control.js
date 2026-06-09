// Drives the syncthing stub's per-(node ip, folder) sync state. The stub serves
// every node, keyed by the node's source IP, so `ip` targets one node; omit it
// (or pass '*') to drive every node's view of that folder. `folder` is the
// syncthing folder id FluxOS assigns to the component (== the reconciler
// identifier); read it from getSyncthingState() if unsure.
import { getSubnetConfig } from './subnet-config.js';

const CONTROL = process.env.SYNCTHING_CONTROL || `http://${getSubnetConfig().syncthing}:8385`;

const GLOBAL_BYTES = 100000;

async function post(path, body) {
  const res = await fetch(`${CONTROL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function get(path) {
  const res = await fetch(`${CONTROL}${path}`);
  return res.json();
}

export async function getSyncthingState() {
  return get('/state');
}

// Raw setter for /rest/db/status.
export async function setSyncState({
  ip = '*', folder, state = 'idle', globalBytes = 0, inSyncBytes = 0,
}) {
  return post('/sync-state', {
    ip, folder, state, globalBytes, inSyncBytes,
  });
}

// Fully synced (reads as 100% -> safe to start).
export async function setSynced({ ip = '*', folder }) {
  return setSyncState({
    ip, folder, state: 'idle', globalBytes: GLOBAL_BYTES, inSyncBytes: GLOBAL_BYTES,
  });
}

// Actively syncing, not yet complete (reads as <100%, still progressing).
export async function setSyncing({ ip = '*', folder, percent = 50 }) {
  return setSyncState({
    ip, folder, state: 'syncing', globalBytes: GLOBAL_BYTES, inSyncBytes: Math.round((GLOBAL_BYTES * percent) / 100),
  });
}

// Stalled: state 'syncing' with frozen inSyncBytes. Because the override is
// sticky, every poll returns the same bytes, so the production stall detector
// trips after stalledSyncCheckCount unchanged samples.
export async function setStalled({ ip = '*', folder, percent = 50 }) {
  return setSyncState({
    ip, folder, state: 'syncing', globalBytes: GLOBAL_BYTES, inSyncBytes: Math.round((GLOBAL_BYTES * percent) / 100),
  });
}

// Raw setter for /rest/db/completion (a peer's view of the folder).
export async function setPeerCompletion({
  ip = '*', folder, device = '*', completion,
}) {
  return post('/peer-completion', {
    ip, folder, device, completion,
  });
}

// No peer holds the full data (every peer < 100%).
export async function setNoPeerData({ ip = '*', folder }) {
  return setPeerCompletion({ ip, folder, completion: 0 });
}

// A peer holds the full data (100%).
export async function setPeerHasData({ ip = '*', folder }) {
  return setPeerCompletion({ ip, folder, completion: 100 });
}

export async function resetSyncState() {
  return post('/sync-reset');
}
