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
  ip = '*', folder, state = 'idle', globalBytes = 0, inSyncBytes = 0, receiveOnlyChangedFiles = 0,
}) {
  return post('/sync-state', {
    ip, folder, state, globalBytes, inSyncBytes, receiveOnlyChangedFiles,
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

// Stalled: IDLE with frozen inSyncBytes - no blocks arriving and syncthing not
// working. (An ACTIVE state with flat bytes is healthy under the stall ladder -
// e.g. a long sync-preparing phase - so 'syncing' would never stall.) The
// override is sticky, so every poll returns the same bytes; the ladder nudges
// after stallNudgeAfterMs and escalates from there.
export async function setStalled({ ip = '*', folder, percent = 50 }) {
  return setSyncState({
    ip, folder, state: 'idle', globalBytes: GLOBAL_BYTES, inSyncBytes: Math.round((GLOBAL_BYTES * percent) / 100),
  });
}

// Active-but-flat: syncthing reports it is WORKING (sync-preparing) while bytes
// stay frozen - the shape that must NEVER count toward the stall verdict.
export async function setActiveFlat({ ip = '*', folder, percent = 50 }) {
  return setSyncState({
    ip, folder, state: 'sync-preparing', globalBytes: GLOBAL_BYTES, inSyncBytes: Math.round((GLOBAL_BYTES * percent) / 100),
  });
}

// Local foreign files in a receiveonly folder (invisible to completion metrics;
// the promotion gate must revert them before flipping to sendreceive).
export async function setLocalChanges({ ip = '*', folder, files = 1 }) {
  return setSyncState({
    ip, folder, state: 'idle', globalBytes: GLOBAL_BYTES, inSyncBytes: GLOBAL_BYTES, receiveOnlyChangedFiles: files,
  });
}

// Raw setter for /rest/db/completion (a peer's view of the folder).
// remoteState 'valid' (default) = connected peer; 'unknown' = disconnected peer
// whose last-known index still reports the completion (the production trust
// rule must not believe it).
export async function setPeerCompletion({
  ip = '*', folder, device = '*', completion, remoteState,
}) {
  return post('/peer-completion', {
    ip, folder, device, completion, remoteState,
  });
}

// No peer holds the full data (every peer < 100%).
export async function setNoPeerData({ ip = '*', folder }) {
  return setPeerCompletion({ ip, folder, completion: 0 });
}

// A peer holds the full data (100%) and is CONNECTED (trusted source).
export async function setPeerHasData({ ip = '*', folder }) {
  return setPeerCompletion({
    ip, folder, completion: 100, remoteState: 'valid',
  });
}

// A peer reports 100% from its last-known index but is DISCONNECTED - the
// source-offline shape (stale completion must not bless nudges or removal).
export async function setPeerDisconnected({ ip = '*', folder }) {
  return setPeerCompletion({
    ip, folder, completion: 100, remoteState: 'unknown',
  });
}

// Device pause/resume calls the node has issued (the stall ladder's nudge).
export async function getNudges(ip) {
  return get(`/nudges${ip ? `?ip=${ip}` : ''}`);
}

// Inject an event into a node's /rest/events buffer (edge accelerator input).
export async function injectSyncthingEvent({ ip = '*', type, data = {} }) {
  return post('/events-inject', { ip, type, data });
}

// Reset a node's event-id counter to 1 (the id half of a syncthing restart).
// Note: a consumer holding a stale high `since` observes NOTHING after a bare
// id reset (the API never returns events below `since`) - the observable shape
// of a restart is the outage window (setEventsOutage).
export async function resetSyncthingEventIds(ip) {
  return post('/events-reset-ids', { ip });
}

// Take a node's /rest/events endpoint down/up - the long-poll dies with
// transport errors for the duration, exactly how a syncthing restart looks
// from the consumer's side.
export async function setEventsOutage({ ip = '*', enabled = true }) {
  return post('/events-outage', { ip, enabled });
}

// The folder status endpoint errors for this folder - the node can verify
// NOTHING (post-redesign contract: never remove without evidence; wait).
export async function setStatusUnreadable({ ip = '*', folder }) {
  return post('/sync-state', {
    ip, folder, statusUnreadable: true,
  });
}

export async function clearStatusUnreadable({ ip = '*', folder }) {
  return post('/sync-state', { ip, folder }); // plain override, readable again
}

export async function resetSyncState() {
  return post('/sync-reset');
}
