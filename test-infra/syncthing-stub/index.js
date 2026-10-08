const express = require('express');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const app = express();
app.use(express.json());

const PORT = Number(process.env.SYNCTHING_PORT) || 8384;
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 8385;
const API_KEY = process.env.SYNCTHING_API_KEY || 'stub-syncthing-api-key';

// the node's source IP as Docker presents it (strip the IPv4-mapped ::ffff: form)
function clientIp(req) {
  const raw = req.socket.remoteAddress || '';
  return raw.replace(/^::ffff:/, '');
}

// --- per-node syncthing identity + config --------------------------------
// One stub container serves every node, but each node connects directly so the
// stub sees the node's source IP. We key all syncthing identity and config by
// that IP, so each node behaves as its own syncthing instance: a unique, stable
// device ID and its own folders/devices. This is what real syncthing looks like
// — and it's required for peer logic to work (a node must be able to tell a
// peer's device ID apart from its own; with a single shared ID every peer looks
// like "self" and folder peer-device lists come out empty).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Deterministic, syncthing-shaped device ID derived from the node IP: 8 groups
// of 7 base32 chars (matches FluxOS's id charset). Stable across requests.
function deviceIdForIp(ip) {
  const a = crypto.createHash('sha256').update(`fluxstub|${ip}`).digest();
  const b = crypto.createHash('sha256').update(a).digest();
  const buf = Buffer.concat([a, b]);
  let out = '';
  for (let i = 0; i < 56; i += 1) out += B32[buf[i] & 31];
  return out.match(/.{1,7}/g).join('-');
}

// ip -> { deviceID, folders: Map, devices: Map, restartRequired, folderWrites: [] }
const nodeStates = new Map();

// Folder config is kept as current state, so a change and its reversal leave no
// trace: a folder paused for an operation and resumed afterwards reads exactly
// like one that was never touched. Record each write in order so a test can ask
// what was done to WHICH folder - the whole question for a composed app, whose
// folders are per component and whose app name addresses none of them.
//
// Scans are recorded in their own list, numbered from the same sequence as the
// writes, so a suite can ask whether a folder was scanned before it was changed
// without a scan reading as a config write.
//
// `arrivedSeq` and `arrivedAt` are taken when the request arrives,
// `appliedSeq` when the change is in the config - what a read, and the next
// PATCH, sees - and `seq` and `at` once it has taken effect, the folder
// restarted. The sequence is shared by writes and scans, so a suite can ask
// whether one call arrived before another was applied. A write that has
// arrived and not yet taken effect is listed in `pendingFolderWrites`.
let folderCallSeq = 0;
function nextSeq() {
  folderCallSeq += 1;
  return folderCallSeq;
}
function arrive(state, method, id, body) {
  const pending = {
    method, id, body: body ?? null, arrivedSeq: nextSeq(), arrivedAt: Date.now(),
  };
  state.pendingFolderWrites.push(pending);
  return pending;
}
function recordFolderWrite(state, pending) {
  state.pendingFolderWrites.splice(state.pendingFolderWrites.indexOf(pending), 1);
  state.folderWrites.push({ ...pending, seq: nextSeq(), at: Date.now() });
}
function recordFolderScan(state, id, arrivedSeq, arrivedAt) {
  const pending = state.pendingFolderScans.findIndex((scan) => scan.arrivedSeq === arrivedSeq);
  if (pending >= 0) state.pendingFolderScans.splice(pending, 1);
  state.folderScans.push({
    id, arrivedSeq, arrivedAt, seq: nextSeq(), at: Date.now(),
  });
}

function nodeState(ip) {
  let state = nodeStates.get(ip);
  if (!state) {
    const deviceID = deviceIdForIp(ip);
    state = {
      deviceID,
      // When this node's syncthing started: reported as startTime, and what a
      // device's lastSeen is compared against. Reset by a restart.
      startedAt: new Date().toISOString(),
      folders: new Map(),
      devices: new Map(),
      ignores: new Map(),
      restartRequired: false,
      folderWrites: [],
      pendingFolderWrites: [],
      folderScans: [],
      // scans asked for and not yet answered: { id, arrivedSeq, arrivedAt }
      pendingFolderScans: [],
      // folder id -> when its restart after a config change ends
      restartingUntil: new Map(),
      // settles when the config change this node applied last has taken effect
      configQueue: Promise.resolve(),
    };
    // every node knows itself as a configured device
    state.devices.set(deviceID, {
      deviceID, name: `node-${ip}`, addresses: ['dynamic'], compression: 'metadata', introducer: false, paused: false,
    });
    nodeStates.set(ip, state);
  }
  return state;
}

// state for the node making this request
function reqState(req) {
  return nodeState(clientIp(req));
}

// syncthing's default folder. A PUT starts each folder it is sent from a copy of
// this and applies the body over it, so a field the body leaves out takes the
// default - not the folder's current value. A PATCH applies the body over the
// folder as it is.
const DEFAULT_FOLDER = Object.freeze({
  type: 'sendreceive',
  paused: false,
  devices: [],
  rescanIntervalS: 3600,
  maxConflicts: 10,
  syncOwnership: false,
});

// syncthing's default device, which a device PUT starts from the same way.
const DEFAULT_DEVICE = Object.freeze({
  addresses: ['dynamic'],
  compression: 'metadata',
  introducer: false,
  paused: false,
});

// --- config changes, applied the way syncthing applies them ----------------
// Syncthing applies one config change at a time. Each is prepared (below) and
// takes effect before the next is applied, and the request is answered once it
// has: a change to a folder restarts that folder, and the answer waits for the
// restart. A PATCH reads the folder when the request arrives, so a PATCH queued
// behind another change writes the folder back as it was when it arrived.

// How long a folder takes to restart after its config changes. While it
// restarts it is not running: a scan of it fails.
const DEFAULT_FOLDER_RESTART_MS = 250;
let folderRestartMs = DEFAULT_FOLDER_RESTART_MS;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Every config write prepares the whole config: a folder keeps only the
// devices the device list holds, each once, and always this node's own, sorted
// by device ID and in syncthing's full shape.
function prepareConfig(state) {
  state.folders.forEach((folder, id) => {
    const byId = new Map();
    (folder.devices || []).forEach((d) => {
      if (d?.deviceID && state.devices.has(d.deviceID) && !byId.has(d.deviceID)) byId.set(d.deviceID, d);
    });
    if (!byId.has(state.deviceID)) byId.set(state.deviceID, { deviceID: state.deviceID });
    const devices = [...byId.values()]
      .map((d) => ({ deviceID: d.deviceID, introducedBy: d.introducedBy ?? '', encryptionPassword: d.encryptionPassword ?? '' }))
      .sort((x, y) => (x.deviceID < y.deviceID ? -1 : 1));
    state.folders.set(id, { ...folder, devices });
  });
}

function folderRunning(state, id) {
  const folder = state.folders.get(id);
  if (!folder) return 'no such folder';
  if (folder.paused) return 'folder is paused';
  if ((state.restartingUntil.get(id) ?? 0) > Date.now()) return 'folder is not running';
  return null;
}

/**
 * Queues a config change on a node. `change` runs in its turn and returns the
 * ids of the folders whose config it changed; the promise settles once those
 * folders have restarted.
 */
function applyConfigChange(state, change) {
  const turn = state.configQueue.then(async () => {
    const before = new Map([...state.folders].map(([id, f]) => [id, JSON.stringify(f)]));
    await change();
    prepareConfig(state);
    const restarted = [...state.folders.keys()].filter((id) => before.get(id) !== JSON.stringify(state.folders.get(id)));
    if (restarted.length && folderRestartMs > 0) {
      const until = Date.now() + folderRestartMs;
      restarted.forEach((id) => state.restartingUntil.set(id, until));
      await sleep(folderRestartMs);
    }
  });
  // eslint-disable-next-line no-param-reassign
  state.configQueue = turn.catch(() => {});
  return turn;
}

// `${ip}|${folder}` ('*' for either) -> how long a scan of that folder takes
const scanDurations = new Map();
function scanDuration(ip, folder) {
  return scanDurations.get(`${ip}|${folder}`) ?? scanDurations.get(`${ip}|*`)
    ?? scanDurations.get(`*|${folder}`) ?? scanDurations.get('*|*') ?? 0;
}

// ip (or '*') -> milliseconds a folder PATCH takes to apply on that node. It is
// applied in the node's turn, so it holds every config change queued behind it.
const folderPatchDelay = new Map();
// Wakes parked PATCHes when a delay is cleared; unbounded listeners because
// every held request registers one.
const patchDelayWaker = new EventEmitter();
patchDelayWaker.setMaxListeners(0);

// --- drivable sync state -------------------------------------------------
// Tests drive these via the control API; the defaults (below) reproduce the
// original always-synced/empty behaviour so existing suites are unaffected.
//
//   syncOverrides:       `${ip}|${folder}`          -> { state, globalBytes, inSyncBytes,
//                                                         localChanged }
//     localChanged is the entry list a receiveonly folder holds that the cluster's index
//     does not, and db/status's receiveOnlyChanged* counts are DERIVED from it. One
//     declaration, because a real daemon's count is the length of that list and cannot
//     disagree with it. db/revert clears the entries for the same reason.
//   completionOverrides: `${ip}|${folder}|${device}`-> completion (0-100)
//                        or { completion, remoteState, globalBytes }
// ip may be '*' (any node) and device may be '*' (any peer); exact keys win.
// With no declaration at all, db/status reads empty and db/completion reads
// "no evidence" (completion 0, remoteState unknown) - an undeclared cluster
// must never testify to a synced peer.
const syncOverrides = new Map();
const completionOverrides = new Map(); // value: number (completion) or { completion, remoteState }
// completionOverrides key -> when the connection it testified to closed. A
// device's lastSeen is derived from these, as a real syncthing's is from its
// connections: now while connected, the moment it closed once it has, and
// never for a device it was never connected to.
const connectionClosedAt = new Map();

// Whether a declared completion testifies to a live connection: remoteState
// 'valid', which a declaration carries unless it says otherwise.
function testifiesConnected(value) {
  if (value === undefined) return false;
  return ((typeof value === 'object' ? value?.remoteState : undefined) ?? 'valid') === 'valid';
}

function declareCompletion(key, value) {
  if (testifiesConnected(completionOverrides.get(key)) && !testifiesConnected(value)) {
    connectionClosedAt.set(key, new Date().toISOString());
  }
  if (testifiesConnected(value)) connectionClosedAt.delete(key);
  completionOverrides.set(key, value);
}

// device pause/resume calls per node ip - the production "nudge" (device
// pause/resume forces an index re-exchange) is observable through this log
const nudgeLogs = new Map(); // ip -> [{ action, device, at }]
function nudgeLog(ip) {
  let l = nudgeLogs.get(ip);
  if (!l) { l = []; nudgeLogs.set(ip, l); }
  return l;
}

// injectable /rest/events buffer per node ip (long-poll served below).
// resetIds simulates the id reset of a syncthing restart; the OBSERVABLE shape
// of a restart is the events-outage window (transport errors) - the real API
// never returns events below a stale `since` (lib/events Since() just waits).
const eventsBuffers = new Map(); // ip -> { nextId, events: [{id,time,type,data}] }
function eventsBuffer(ip) {
  let b = eventsBuffers.get(ip);
  if (!b) { b = { nextId: 1, events: [] }; eventsBuffers.set(ip, b); }
  return b;
}
// ips whose /rest/events endpoint is "down" (syncthing restarting); '*' = all
const eventsOutages = new Set();

// Nodes whose /rest/config/devices answers 500 while every other endpoint keeps
// working. Syncthing's device configuration and its folder configuration are two
// reads, and a node that got the folders has what it needs to tell peers which
// it holds writable - so failing only the second is how a suite proves the pass
// does not withhold the first.
const deviceConfigOutages = new Set();

// How many device reads this stub has actually REFUSED, by caller. A suite that
// takes the read down needs to know the node reached it and was turned away -
// an outage that silently failed to apply reads exactly like the behaviour under
// test working. Counted here rather than read from the node's log, because a
// suite that restarts a node loses its container log stream and would be
// asserting on something it can no longer see.
const deviceConfigRefusals = new Map();

function deviceConfigDown(ip) {
  return deviceConfigOutages.has(ip) || deviceConfigOutages.has('*');
}

function lookupSync(ip, folder) {
  return syncOverrides.get(`${ip}|${folder}`) ?? syncOverrides.get(`*|${folder}`);
}

// The declaration db/completion reads for a (node, folder, peer): exact keys win.
function completionKey(ip, folder, device) {
  return [`${ip}|${folder}|${device}`, `${ip}|${folder}|*`, `*|${folder}|${device}`, `*|${folder}|*`]
    .find((key) => completionOverrides.has(key));
}

function lookupCompletion(ip, folder, device) {
  const key = completionKey(ip, folder, device);
  return key === undefined ? undefined : completionOverrides.get(key);
}

// What a node's syncthing reports as lastSeen for a device, from the
// connections its declared completions testify to across every folder.
function derivedLastSeen(ip, deviceID) {
  const folders = new Set([...completionOverrides.keys()].map((key) => key.split('|')[1]));
  let closed = null;
  for (const folder of folders) {
    const key = completionKey(ip, folder, deviceID);
    if (key !== undefined) {
      if (testifiesConnected(completionOverrides.get(key))) return new Date().toISOString();
      const at = connectionClosedAt.get(key);
      if (at && (!closed || at > closed)) closed = at;
    }
  }
  return closed;
}

// -- Health & Meta --

app.get('/meta.js', (req, res) => {
  res.type('application/javascript');
  res.send(`var metadata = {"deviceID":"${reqState(req).deviceID}"};\n`);
});

app.get('/rest/noauth/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/rest/system/ping', (req, res) => {
  res.json({ ping: 'pong' });
});

app.get('/rest/system/version', (req, res) => {
  res.json({
    arch: 'amd64',
    codename: 'Fermium Flea',
    container: false,
    isBeta: false,
    longVersion: 'syncthing v2.0.10 "Fermium Flea" (go1.22.0 linux-amd64) stub@testing 2024-01-01 00:00:00 UTC',
    os: 'linux',
    stamp: '2024-01-01T00:00:00Z',
    tags: ['purego'],
    user: 'stub',
    version: 'v2.0.10',
  });
});

app.get('/rest/system/status', (req, res) => {
  res.json({
    alloc: 50000000,
    connectionServiceStatus: {},
    cpuPercent: 0.5,
    discoveryEnabled: true,
    discoveryErrors: {},
    discoveryMethods: 0,
    goroutines: 50,
    guiAddressOverridden: false,
    guiAddressUsed: `0.0.0.0:${PORT}`,
    lastDialStatus: {},
    myID: reqState(req).deviceID,
    pathSeparator: '/',
    startTime: reqState(req).startedAt,
    sys: 100000000,
    tilde: '/root',
    uptime: Math.floor(process.uptime()),
    urVersionMax: 3,
  });
});

app.get('/rest/system/connections', (req, res) => {
  res.json({ connections: {}, total: { at: new Date().toISOString(), inBytesTotal: 0, outBytesTotal: 0 } });
});

app.get('/rest/system/paths', (req, res) => {
  res.json({
    auditLog: '/var/lib/syncthing/audit.log',
    baseDir: '/var/lib/syncthing',
    certFile: '/var/lib/syncthing/cert.pem',
    config: '/var/lib/syncthing/config.xml',
    csrfTokens: '/var/lib/syncthing/csrftokens.txt',
    database: '/var/lib/syncthing/index-v0.14.0.db',
    defFolder: '/var/lib/syncthing/Sync',
    guiAssets: '/var/lib/syncthing/gui',
    httpsCertFile: '/var/lib/syncthing/https-cert.pem',
    httpsKeyFile: '/var/lib/syncthing/https-key.pem',
    keyFile: '/var/lib/syncthing/key.pem',
    logFile: '/var/lib/syncthing/syncthing.log',
    panicLog: '/var/lib/syncthing/panic-latest.log',
  });
});

app.get('/rest/system/upgrade', (req, res) => {
  res.json({ latest: 'v2.0.10', majorNewer: false, newer: false, running: 'v2.0.10' });
});

app.get('/rest/system/log', (req, res) => {
  res.json({ messages: [] });
});

app.get('/rest/system/log.txt', (req, res) => {
  res.type('text/plain').send('');
});

app.get('/rest/system/error', (req, res) => {
  res.json({ errors: [] });
});

app.get('/rest/system/debug', (req, res) => {
  res.json({ enabled: {}, facilities: {} });
});

app.get('/rest/system/discovery', (req, res) => {
  res.json({});
});

app.get('/rest/system/browse', (req, res) => {
  res.json([]);
});

// -- System Control --

app.post('/rest/system/restart', (req, res) => {
  // recorded so suites can assert the ladder NUDGED instead of restarting
  nudgeLog(clientIp(req)).push({ action: 'restart', device: '*', at: Date.now() });
  reqState(req).restartRequired = false;
  reqState(req).startedAt = new Date().toISOString();
  res.json({ ok: 'restarting' });
});

app.post('/rest/system/shutdown', (req, res) => {
  res.json({ ok: 'shutting down' });
});

app.post('/rest/system/pause', (req, res) => {
  nudgeLog(clientIp(req)).push({ action: 'pause', device: req.query.device || '*', at: Date.now() });
  res.json({});
});

app.post('/rest/system/resume', (req, res) => {
  nudgeLog(clientIp(req)).push({ action: 'resume', device: req.query.device || '*', at: Date.now() });
  res.json({});
});

app.post('/rest/system/reset', (req, res) => {
  res.json({});
});

app.post('/rest/system/error', (req, res) => {
  res.json({});
});

// -- Config --

app.get('/rest/config', (req, res) => {
  const state = reqState(req);
  res.json({
    version: 37,
    folders: Array.from(state.folders.values()),
    devices: Array.from(state.devices.values()),
    gui: { enabled: true, address: `0.0.0.0:${PORT}`, apikey: API_KEY, theme: 'default' },
    ldap: {},
    options: { listenAddresses: ['default'], globalAnnEnabled: false, localAnnEnabled: false, relaysEnabled: false },
    defaults: { folder: DEFAULT_FOLDER, device: {}, ignores: {} },
  });
});

app.put('/rest/config', async (req, res) => {
  const state = reqState(req);
  await applyConfigChange(state, () => {
    if (req.body.devices) {
      state.devices.clear();
      req.body.devices.forEach((d) => state.devices.set(d.deviceID, { ...DEFAULT_DEVICE, ...d }));
      if (!state.devices.has(state.deviceID)) state.devices.set(state.deviceID, { ...DEFAULT_DEVICE, deviceID: state.deviceID });
    }
    if (req.body.folders) {
      state.folders.clear();
      req.body.folders.forEach((f) => state.folders.set(f.id, { ...DEFAULT_FOLDER, ...f }));
    }
  });
  res.json({});
});

// syncthing v2 applies folder/device/config changes live, so config mutations
// never flip this flag here — a true would make FluxOS's config-apply path
// restart syncthing during install, polluting the nudge logs with restarts
// that real v2 never produces.
app.get('/rest/config/restart-required', (req, res) => {
  res.json({ requiresRestart: reqState(req).restartRequired });
});

// -- Config Folders --

app.get('/rest/config/folders', (req, res) => {
  res.json(Array.from(reqState(req).folders.values()));
});

// Collection PUT (no id): the folders sent replace those with the same id,
// starting from the default folder; folders not sent are kept.
app.put('/rest/config/folders', async (req, res) => {
  const state = reqState(req);
  const arr = Array.isArray(req.body) ? req.body : [req.body];
  const pending = arr.map((f) => arrive(state, 'put', f.id, f));
  await applyConfigChange(state, () => {
    arr.forEach((f) => state.folders.set(f.id, { ...DEFAULT_FOLDER, ...f }));
    const appliedSeq = nextSeq();
    pending.forEach((write) => { Object.assign(write, { appliedSeq }); });
  });
  pending.forEach((write) => recordFolderWrite(state, write));
  res.json({});
});

app.get('/rest/config/folders/:id', (req, res) => {
  const folder = reqState(req).folders.get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'not found' });
  return res.json(folder);
});

app.put('/rest/config/folders/:id', async (req, res) => {
  const state = reqState(req);
  const pending = arrive(state, 'put', req.params.id, req.body);
  await applyConfigChange(state, () => {
    state.folders.set(req.params.id, { ...DEFAULT_FOLDER, ...req.body, id: req.params.id });
    pending.appliedSeq = nextSeq();
  });
  recordFolderWrite(state, pending);
  res.json({});
});

// PATCH modifies an existing folder and 404s an unknown id (PUT is the upsert).
// The folder is read when the request arrives and written back whole, with the
// body over it, in the node's turn.
app.patch('/rest/config/folders/:id', async (req, res) => {
  const state = reqState(req);
  const existing = state.folders.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const pending = arrive(state, 'patch', req.params.id, req.body);
  const delayMs = folderPatchDelay.get(clientIp(req)) ?? folderPatchDelay.get('*') ?? 0;
  await applyConfigChange(state, async () => {
    if (delayMs > 0) {
      // Interruptible: clearing the delay wakes every change parked in it.
      await new Promise((resolve) => {
        let timer;
        const done = () => { clearTimeout(timer); patchDelayWaker.off('wake', done); resolve(); };
        timer = setTimeout(done, delayMs);
        patchDelayWaker.on('wake', done);
      });
    }
    state.folders.set(req.params.id, { ...existing, ...req.body });
    pending.appliedSeq = nextSeq();
  });
  recordFolderWrite(state, pending);
  return res.json({});
});

// Deleting a folder syncthing does not have succeeds.
app.delete('/rest/config/folders/:id', async (req, res) => {
  const state = reqState(req);
  const pending = arrive(state, 'delete', req.params.id, null);
  await applyConfigChange(state, () => {
    state.folders.delete(req.params.id);
    pending.appliedSeq = nextSeq();
  });
  recordFolderWrite(state, pending);
  res.json({});
});

// -- Config Devices --

app.get('/rest/config/devices', (req, res) => {
  if (deviceConfigDown(clientIp(req))) {
    const ip = clientIp(req);
    deviceConfigRefusals.set(ip, (deviceConfigRefusals.get(ip) ?? 0) + 1);
    return res.status(500).json({ error: 'simulated unreadable device configuration' });
  }
  return res.json(Array.from(reqState(req).devices.values()));
});

// Collection PUT (no id): the devices sent replace those with the same id,
// starting from the default device; devices not sent are kept.
app.put('/rest/config/devices', async (req, res) => {
  const state = reqState(req);
  const arr = Array.isArray(req.body) ? req.body : [req.body];
  await applyConfigChange(state, () => {
    arr.forEach((d) => state.devices.set(d.deviceID, { ...DEFAULT_DEVICE, ...d }));
  });
  res.json({});
});

app.get('/rest/config/devices/:id', (req, res) => {
  const device = reqState(req).devices.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'not found' });
  return res.json(device);
});

app.put('/rest/config/devices/:id', async (req, res) => {
  const state = reqState(req);
  await applyConfigChange(state, () => {
    state.devices.set(req.params.id, { ...DEFAULT_DEVICE, ...req.body, deviceID: req.params.id });
  });
  res.json({});
});

app.patch('/rest/config/devices/:id', async (req, res) => {
  const state = reqState(req);
  const existing = state.devices.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No device with given ID' });
  await applyConfigChange(state, () => {
    state.devices.set(req.params.id, { ...existing, ...req.body });
  });
  return res.json({});
});

// A folder shared with the removed device stops listing it: every change
// prepares the whole config.
app.delete('/rest/config/devices/:id', async (req, res) => {
  const state = reqState(req);
  await applyConfigChange(state, () => { state.devices.delete(req.params.id); });
  res.json({});
});

// -- Config Defaults --

app.get('/rest/config/defaults/folder', (req, res) => {
  res.json({ id: '', label: '', path: '~', type: 'sendreceive', devices: [], rescanIntervalS: 3600 });
});

app.get('/rest/config/defaults/device', (req, res) => {
  res.json({ deviceID: '', name: '', addresses: ['dynamic'], compression: 'metadata' });
});

app.get('/rest/config/defaults/ignores', (req, res) => {
  res.json({ lines: [] });
});

app.get('/rest/config/options', (req, res) => {
  res.json({ listenAddresses: ['default'], globalAnnEnabled: false, localAnnEnabled: false, relaysEnabled: false });
});

app.get('/rest/config/gui', (req, res) => {
  res.json({ enabled: true, address: `0.0.0.0:${PORT}`, apikey: API_KEY });
});

app.get('/rest/config/ldap', (req, res) => {
  res.json({});
});

// PUT/PATCH for defaults, options, gui, ldap
['defaults/folder', 'defaults/device', 'defaults/ignores', 'options', 'gui', 'ldap'].forEach((p) => {
  app.put(`/rest/config/${p}`, (req, res) => res.json({}));
  app.patch(`/rest/config/${p}`, (req, res) => res.json({}));
});

// -- Cluster Pending --

app.get('/rest/cluster/pending/devices', (req, res) => res.json({}));
app.get('/rest/cluster/pending/folders', (req, res) => res.json({}));

['devices', 'folders'].forEach((t) => {
  app.put(`/rest/cluster/pending/${t}/:id`, (req, res) => res.json({}));
  app.patch(`/rest/cluster/pending/${t}/:id`, (req, res) => res.json({}));
  app.delete(`/rest/cluster/pending/${t}/:id`, (req, res) => res.json({}));
});

// -- Database --

app.get('/rest/db/browse', (req, res) => {
  res.json([]);
});

app.get('/rest/db/completion', (req, res) => {
  const override = lookupCompletion(clientIp(req), req.query.folder || '', req.query.device || '');
  // No declared cluster state = NO evidence of a synced peer. The old default
  // (completion 100, remoteState valid, 100000 bytes) paired with the local
  // db/status default (empty) is a state real syncthing cannot produce - a
  // connected synced peer whose index never arrived locally - and it is
  // exactly the cannot-ingest signature the folder state machine self-evicts
  // on: both instances of a spawner-path app once removed themselves in the
  // same cycle, each pointing at the other's accidental testimony. Peer
  // evidence now comes only from declared state: /sync-state (the declaring
  // node becomes the folder's source) or /peer-completion.
  const completion = (typeof override === 'object' ? override?.completion : override) ?? 0;
  // 'valid' = connected peer (the production trust rule only believes those);
  // overridable to 'unknown' to model a disconnected peer's stale index
  const remoteState = (typeof override === 'object' ? override?.remoteState : undefined)
    ?? (override !== undefined ? 'valid' : 'unknown');
  const globalBytes = (typeof override === 'object' ? override?.globalBytes : undefined)
    ?? (override !== undefined ? 100000 : 0);
  const needBytes = Math.round((globalBytes * (100 - completion)) / 100);
  res.json({
    completion, globalBytes, needBytes, globalItems: 0, needItems: 0, needDeletes: 0, remoteState, sequence: 1,
  });
});

app.get('/rest/db/file', (req, res) => {
  res.json({ availability: [], global: {}, local: {} });
});

// Ignores are stateful so a GET reflects a prior POST, as real syncthing does:
// real syncthing serves GET + POST here (lib/api/api.go), and FluxOS sets a
// folder's ignores by POSTing the full pattern set. PUT is kept as an alias for
// any legacy caller.
app.get('/rest/db/ignores', (req, res) => {
  const state = reqState(req);
  const ignore = state.ignores.get(req.query.folder) || [];
  res.json({ ignore, expanded: ignore });
});

function setIgnores(req, res) {
  const state = reqState(req);
  const ignore = Array.isArray(req.body && req.body.ignore) ? req.body.ignore : [];
  state.ignores.set(req.query.folder, ignore);
  res.json({ ignore, expanded: ignore });
}

app.post('/rest/db/ignores', setIgnores);
app.put('/rest/db/ignores', setIgnores);

app.get('/rest/db/need', (req, res) => {
  res.json({ progress: [], queued: [], rest: [], total: 0, page: 1, perpage: 65536 });
});

app.get('/rest/db/remoteneed', (req, res) => {
  res.json({ progress: [], queued: [], rest: [], total: 0, page: 1, perpage: 65536 });
});

// Only ever populated for a receiveonly folder - syncthing reports nothing here for a
// sendreceive one whatever is on disk (folder_summary.go), because the entries ARE the
// files a receive-only folder holds that the cluster's index does not.
app.get('/rest/db/localchanged', (req, res) => {
  const ov = lookupSync(clientIp(req), req.query.folder || '');
  if (ov?.statusUnreadable) return res.status(500).json({ error: 'simulated unreadable folder status' });
  const folderCfg = reqState(req).folders.get(req.query.folder || '');
  const isReceiveOnly = !folderCfg || folderCfg.type === 'receiveonly';
  const files = isReceiveOnly && Array.isArray(ov?.localChanged) ? ov.localChanged : [];
  return res.json({ files, page: 1, perpage: 65536 });
});

app.get('/rest/db/status', (req, res) => {
  const folderId = req.query.folder;
  const ov = lookupSync(clientIp(req), folderId || '');
  if (ov?.statusUnreadable) return res.status(500).json({ error: 'simulated unreadable folder status' });
  const globalBytes = ov?.globalBytes ?? 0;
  // How many of the indexed entries are FILES. This stub reports no directories,
  // so bytes it reports are bytes in files, and at least one file carries them -
  // see /sync-state.
  const globalFiles = ov?.globalFiles ?? 0;
  const inSyncBytes = ov?.inSyncBytes ?? 0;
  const state = ov?.state ?? 'idle';
  // Derived, never declared separately - see the /sync-state comment.
  const localChanged = Array.isArray(ov?.localChanged) ? ov.localChanged : [];
  const changedFiles = localChanged.filter((entry) => entry.type === 'FILE_INFO_TYPE_FILE' && !entry.deleted);
  const receiveOnlyChangedFiles = changedFiles.length;
  const receiveOnlyChangedDirectories = localChanged.filter((entry) => entry.type === 'FILE_INFO_TYPE_DIRECTORY').length;
  const receiveOnlyChangedBytesDerived = localChanged
    .reduce((total, entry) => total + (Number(entry.size) || 0), 0);
  const needBytes = Math.max(0, globalBytes - inSyncBytes);
  res.json({
    errors: 0,
    globalBytes,
    globalDeleted: 0,
    globalDirectories: 0,
    globalFiles,
    globalSymlinks: 0,
    globalTotalItems: 0,
    ignorePatterns: false,
    inSyncBytes,
    inSyncFiles: 0,
    invalid: '',
    localBytes: inSyncBytes,
    localDeleted: 0,
    localDirectories: 0,
    localFiles: 0,
    localSymlinks: 0,
    localTotalItems: 0,
    needBytes,
    needDeletes: 0,
    needDirectories: 0,
    needFiles: 0,
    needSymlinks: 0,
    needTotalItems: 0,
    pullErrors: 0,
    receiveOnlyChangedBytes: receiveOnlyChangedBytesDerived,
    receiveOnlyChangedDeletes: 0,
    receiveOnlyChangedDirectories,
    receiveOnlyChangedFiles,
    receiveOnlyChangedSymlinks: 0,
    receiveOnlyTotalItems: 0,
    sequence: 0,
    state,
    stateChanged: new Date().toISOString(),
    version: 0,
    folder: folderId || '',
  });
});

app.post('/rest/db/override', (req, res) => res.json({}));
app.post('/rest/db/prio', (req, res) => res.json({}));
app.post('/rest/db/revert', (req, res) => {
  // revert undoes local changes in a receiveonly folder: drop the declared entries so
  // the next status reads clean. The ENTRIES are the state - clearing a separate count
  // would leave the file list still describing them, and db/status now derives the
  // count from that list, so the folder would never read clean and the promotion the
  // revert exists to unblock would never come.
  const folder = req.query.folder || '';
  const ip = clientIp(req);
  nudgeLog(ip).push({ action: 'revert', device: folder, at: Date.now() });
  [`${ip}|${folder}`, `*|${folder}`].forEach((key) => {
    const ov = syncOverrides.get(key);
    if (ov && Array.isArray(ov.localChanged) && ov.localChanged.length > 0) {
      syncOverrides.set(key, { ...ov, localChanged: [] });
    }
  });
  res.json({});
});
// A scan is answered once it has finished, and refused while the folder is
// missing, paused or restarting.
app.post('/rest/db/scan', async (req, res) => {
  const state = reqState(req);
  const folder = req.query.folder || '';
  const notRunning = folderRunning(state, folder);
  if (notRunning) return res.status(500).type('text/plain').send(notRunning);
  const arrivedSeq = nextSeq();
  const arrivedAt = Date.now();
  state.pendingFolderScans.push({ id: folder, arrivedSeq, arrivedAt });
  const ms = scanDuration(clientIp(req), folder);
  if (ms > 0) await sleep(ms);
  recordFolderScan(state, folder, arrivedSeq, arrivedAt);
  return res.json({});
});

// -- Folder --

app.get('/rest/folder/errors', (req, res) => {
  res.json({ errors: [], folder: req.query.folder || '', page: 1, perpage: 65536 });
});

app.get('/rest/folder/versions', (req, res) => {
  res.json({ versions: {} });
});

app.post('/rest/folder/versions', (req, res) => res.json({}));

// -- Stats --

// `<viewer ip>|<device>` or `*|<device>` -> the lastSeen a node reports for a
// device, or null for a device it has never been connected to. Unset, it is
// derived from the node's declared connections (derivedLastSeen).
const deviceLastSeen = new Map();
// What syncthing reports as lastSeen for a device it has never been connected to.
const NEVER_SEEN = '1970-01-01T00:00:00Z';

app.get('/rest/stats/device', (req, res) => {
  const ip = clientIp(req);
  const stats = {};
  reqState(req).devices.forEach((d) => {
    const key = [`${ip}|${d.deviceID}`, `*|${d.deviceID}`].find((k) => deviceLastSeen.has(k));
    const declared = key ? deviceLastSeen.get(key) : undefined;
    const seen = declared === undefined ? derivedLastSeen(ip, d.deviceID) : declared;
    stats[d.deviceID] = { lastSeen: seen ?? NEVER_SEEN, lastConnectionDurationS: seen ? 3600 : 0 };
  });
  res.json(stats);
});

app.get('/rest/stats/folder', (req, res) => {
  const stats = {};
  reqState(req).folders.forEach((f) => {
    stats[f.id] = { lastFile: { at: new Date().toISOString(), filename: '', deleted: false }, lastScan: new Date().toISOString() };
  });
  res.json(stats);
});

// -- Events --

app.get('/rest/events', (req, res) => {
  // long-poll like the real API: respond immediately when events newer than
  // `since` exist, otherwise hold the request until one arrives or the timeout
  // lapses (capped below the client's HTTP timeout). Type filtering matches the
  // real filtered-subscription behaviour closely enough for the consumer.
  const ip = clientIp(req);
  if (eventsOutages.has(ip) || eventsOutages.has('*')) {
    return res.status(503).json({ error: 'syncthing is restarting' });
  }
  const since = Number(req.query.since) || 0;
  const types = req.query.events ? String(req.query.events).split(',') : null;
  const timeoutS = Math.min(Number(req.query.timeout) || 60, 25);
  const deadline = Date.now() + timeoutS * 1000;

  // a FILTERED subscription with since=0 anchors at "now" (no backlog) - the
  // live-verified v2 behaviour; only later events are delivered
  const effSince = types && since === 0 ? eventsBuffer(ip).nextId - 1 : since;
  const pending = () => eventsBuffer(ip).events.filter((e) => e.id > effSince && (!types || types.includes(e.type)));

  const attempt = () => {
    // an outage kills HELD polls too - a real restart tears down open connections
    if (eventsOutages.has(ip) || eventsOutages.has('*')) {
      return res.status(503).json({ error: 'syncthing is restarting' });
    }
    const matched = pending();
    if (matched.length > 0) return res.json(matched);
    if (Date.now() >= deadline) return res.json([]);
    return setTimeout(attempt, 250);
  };
  attempt();
});

app.get('/rest/events/disk', (req, res) => {
  res.json([]);
});

// -- SVC --

app.get('/rest/svc/deviceid', (req, res) => {
  res.json({ id: reqState(req).deviceID });
});

app.get('/rest/svc/random/string', (req, res) => {
  const length = Number(req.query.length) || 32;
  res.json({ random: crypto.randomBytes(length).toString('hex').slice(0, length) });
});

app.get('/rest/svc/report', (req, res) => {
  res.json({});
});

// -- Debug --

app.get('/rest/debug/peerCompletion', (req, res) => res.json({}));
app.get('/rest/debug/httpmetrics', (req, res) => res.json({}));
app.get('/rest/debug/support', (req, res) => res.json({}));
app.get('/rest/debug/file', (req, res) => res.json({}));

// -- Catch-all for unhandled endpoints --

app.all('*', (req, res) => {
  console.log(`Unhandled syncthing request: ${req.method} ${req.path}`);
  res.json({});
});

app.listen(PORT, () => console.log(`Syncthing stub listening on port ${PORT}`));

// -- Test harness control API --

const control = express();
control.use(express.json());

// Per-node config is keyed by the node's source IP and mutated by the node's own
// syncthing API calls, so the control surface here is read-only: report every
// node's identity and config for debugging.
control.get('/state', (req, res) => {
  res.json({
    apiKey: API_KEY,
    nodes: Array.from(nodeStates.entries()).map(([ip, s]) => ({
      ip,
      deviceId: s.deviceID,
      folders: Array.from(s.folders.values()),
      devices: Array.from(s.devices.values()),
      restartRequired: s.restartRequired,
      // ordered history of folder config writes, and of scans - see recordFolderWrite
      folderWrites: s.folderWrites,
      pendingFolderWrites: s.pendingFolderWrites,
      folderScans: s.folderScans,
      pendingFolderScans: s.pendingFolderScans,
    })),
  });
});

// Make this node's folder PATCHes take `ms` to apply, as a syncthing slow to
// apply a change would; every config change queued behind one waits for it.
// Omit ip to target every node; 0 clears.
control.post('/folder-patch-delay', (req, res) => {
  const { ip = '*', ms = 0 } = req.body;
  if (ms > 0) {
    folderPatchDelay.set(ip, ms);
  } else {
    folderPatchDelay.delete(ip);
    patchDelayWaker.emit('wake');
  }
  return res.json({ ok: true, ip, ms });
});

// --- drivable sync-state control ---
// Set what /rest/db/status returns for a (node ip, folder). Omit ip to target
// every node ('*'). A folder reporting globalBytes>0 with inSyncBytes<globalBytes
// reads as "not synced"; with state:'syncing' and frozen bytes across polls it
// reads as a stall (the production stall detector needs N unchanged samples).
control.post('/sync-state', (req, res) => {
  const {
    ip = '*', folder, state = 'idle', globalBytes = 0, globalFiles: declaredFiles, inSyncBytes = 0,
    receiveOnlyChangedFiles = 0, localChanged = null, statusUnreadable = false, onDisk = true,
  } = req.body;
  if (!folder) return res.status(400).json({ error: 'folder required' });
  // This stub reports no directories, so declared bytes are bytes in files, and a
  // real index carrying them lists at least one file. A suite may still state the
  // count; left out, it is the one file the bytes need.
  const globalFiles = declaredFiles ?? (globalBytes > 0 ? 1 : 0);
  console.log(`[write] sync-state from=${clientIp(req)} ip=${ip} folder=${folder} state=${state} bytes=${inSyncBytes}/${globalBytes} unreadable=${statusUnreadable}`);
  // The ENTRIES are the declaration; the count is derived from them. A real daemon
  // cannot report a receiveOnlyChangedFiles that disagrees with what db/localchanged
  // lists - the count IS the length of that list - so a stub that lets a suite set the
  // two independently can describe a folder syncthing could never produce. That is the
  // shape that let a cold-start suite pass against a node whose volume held data the
  // count denied. A suite that only says how MANY still gets entries synthesised, so
  // the two endpoints agree whichever way it declares.
  const entries = Array.isArray(localChanged)
    ? localChanged
    : Array.from({ length: receiveOnlyChangedFiles }, (unused, index) => ({
      name: `declared-local-${index}`, size: 1024, type: 'FILE_INFO_TYPE_FILE', deleted: false,
      modified: new Date().toISOString(),
    }));
  // A WILDCARD WRITE IS "THIS IS THE STATE EVERYWHERE", so it has to clear the
  // per-node ones it is replacing. lookupSync prefers `<ip>|<folder>` over
  // `*|<folder>`, so without this a node that was ever described specifically
  // stops hearing the suite: seedSyncthingApp declares what it seeded on that
  // node, and every later setSynced({ folder }) - which is how nearly every
  // suite drives sync - writes a wildcard that node never reads. The suite
  // believes it drove the folder to 100% while the node still sees 0/0, and
  // then reports whatever the node did instead as a product failure.
  //
  // Found in suite 36: the subject sat at `100.00% (0/0 bytes)` while its peer
  // read 100000/100000, ran the stall ladder it should never have reached, and
  // had the app REMOVED after three nudges.
  if (ip === '*') {
    for (const key of [...syncOverrides.keys()]) {
      if (key.endsWith(`|${folder}`) && !key.startsWith('*|')) syncOverrides.delete(key);
    }
  }
  // onDisk: the node's volume holds the bytes it reports in sync, as a real sync
  // leaves them. The harness writes them there (synced-data-keeper.js); a suite
  // describing an index the disk contradicts - a stale index over a wiped volume -
  // declares onDisk: false.
  syncOverrides.set(`${ip}|${folder}`, {
    state, globalBytes, globalFiles, inSyncBytes, localChanged: entries, statusUnreadable, onDisk: onDisk !== false,
  });
  // A declared sync state is also the folder's peer evidence: when OTHER
  // nodes ask db/completion about this folder, the declaring node is a
  // connected source at exactly the declared progress (setSynced -> a valid
  // 100% source, setSyncing 40 -> a valid 40% one). Without this, peer
  // evidence could only come from the old always-synced default - an
  // accidental witness no real cluster produces (see /rest/db/completion).
  // An unreadable-status declaration testifies to nothing, and neither does
  // an EMPTY one: a 0/0 clean-slate declaration is the absence of data, and
  // stamping its declarer 'valid' makes every cold-start fixture a phantom
  // connected source - the exact witness class this gate exists to kill.
  if (!statusUnreadable && globalBytes > 0) {
    const sourceDevice = ip === '*' ? '*' : nodeState(ip).deviceID;
    declareCompletion(`*|${folder}|${sourceDevice}`, {
      completion: globalBytes > 0 ? Math.round((inSyncBytes / globalBytes) * 100) : 0,
      remoteState: 'valid',
      globalBytes,
    });
  }
  return res.json({ ok: true });
});

// claims: the bytes each node's volume should hold for each folder - what its declared
// state reports in sync, unless the declaration says the disk does not hold it. Keyed
// as the overrides are; '*' applies to every node without one of its own.
// paused: each folder a node's config has paused. A paused folder moves no data, so
// whatever its volume holds is left as it is.
control.get('/disk-claims', (req, res) => {
  const claims = Array.from(syncOverrides.entries()).map(([key, ov]) => {
    const sep = key.indexOf('|');
    return {
      ip: key.slice(0, sep),
      folder: key.slice(sep + 1),
      bytes: ov.onDisk && !ov.statusUnreadable ? Math.max(0, Number(ov.inSyncBytes) || 0) : 0,
    };
  });
  const paused = Array.from(nodeStates.entries()).flatMap(([ip, state]) => Array.from(state.folders.entries())
    .filter(([, folder]) => folder.paused)
    .map(([id]) => ({ ip, folder: id })));
  res.json({ claims, paused });
});

// Set what /rest/db/completion returns for a (node ip, folder, peer device).
// Omit device to cover every peer ('*'). completion < 100 => "no peer has the data".
control.post('/peer-completion', (req, res) => {
  const {
    ip = '*', folder, device = '*', completion, remoteState,
  } = req.body;
  if (!folder || completion == null) return res.status(400).json({ error: 'folder and completion required' });
  // remoteState 'valid' (default) = connected peer; 'unknown' models a
  // disconnected peer whose last-known index still reports the completion
  console.log(`[write] peer-completion from=${clientIp(req)} key=${ip}|${folder}|${device} completion=${completion} remoteState=${remoteState}`);
  declareCompletion(`${ip}|${folder}|${device}`, remoteState !== undefined ? { completion, remoteState } : completion);
  return res.json({ ok: true });
});

// Device pause/resume calls observed for a node ip - how suites assert that the
// stall ladder NUDGED (and did not restart syncthing or stop the container).
control.get('/nudges', (req, res) => {
  const ip = req.query.ip;
  if (ip) return res.json({ nudges: nudgeLogs.get(ip) || [] });
  return res.json({ nudges: Object.fromEntries(Array.from(nudgeLogs.entries())) });
});

// Inject an event into a node's /rest/events buffer (ip '*' = every known node).
control.post('/events-inject', (req, res) => {
  const { ip = '*', type, data = {} } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });
  const targets = ip === '*' ? Array.from(new Set([...nodeStates.keys(), ...eventsBuffers.keys()])) : [ip];
  targets.forEach((target) => {
    const buf = eventsBuffer(target);
    buf.events.push({
      id: buf.nextId, globalID: buf.nextId, time: new Date().toISOString(), type, data,
    });
    buf.nextId += 1;
    if (buf.events.length > 500) buf.events.splice(0, buf.events.length - 500);
  });
  return res.json({ ok: true });
});

// Simulate the id reset of a syncthing restart: event ids start again from 1.
// Note a restart's OBSERVABLE shape is the outage window below - a consumer
// with a stale high `since` simply sees nothing after a bare id reset.
control.post('/events-reset-ids', (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  eventsBuffers.set(ip, { nextId: 1, events: [] });
  return res.json({ ok: true });
});

// Take a node's /rest/events endpoint down/up (syncthing restarting - the
// long-poll dies with transport errors for the duration).
control.post('/events-outage', (req, res) => {
  const { ip = '*', enabled = true } = req.body || {};
  if (enabled) eventsOutages.add(ip); else eventsOutages.delete(ip);
  return res.json({ ok: true });
});

// Take a node's /rest/config/devices down/up, leaving /rest/config/folders
// answering. The two are separate reads on the same pass, and a node that read
// its folders still knows which it holds writable.
control.post('/device-config-outage', (req, res) => {
  const { ip = '*', enabled = true } = req.body || {};
  if (enabled) deviceConfigOutages.add(ip); else deviceConfigOutages.delete(ip);
  return res.json({ ok: true });
});

control.get('/device-config-refusals', (req, res) => {
  const { ip } = req.query;
  return res.json({ refusals: ip ? (deviceConfigRefusals.get(ip) ?? 0) : Object.fromEntries(deviceConfigRefusals) });
});

// Set what one node's /rest/stats/device reports as lastSeen for a device: an
// ISO time, or null for a device it has never been connected to. Omit ip to
// set it for every viewer; omit lastSeen to go back to "seen now".
control.post('/device-last-seen', (req, res) => {
  const { ip = '*', device } = req.body || {};
  if (!device) return res.status(400).json({ error: 'device required' });
  const key = `${ip}|${device}`;
  if (!('lastSeen' in (req.body || {}))) deviceLastSeen.delete(key);
  else deviceLastSeen.set(key, req.body.lastSeen);
  return res.json({ ok: true, key, lastSeen: deviceLastSeen.get(key) });
});

// Back to default always-synced/empty behaviour.
control.post('/sync-reset', (req, res) => {
  console.log(`[write] sync-reset from=${clientIp(req)}`);
  syncOverrides.clear();
  completionOverrides.clear();
  connectionClosedAt.clear();
  deviceConfigOutages.clear();
  deviceConfigRefusals.clear();
  nudgeLogs.clear();
  eventsBuffers.clear();
  eventsOutages.clear();
  folderPatchDelay.clear();
  patchDelayWaker.emit('wake');
  scanDurations.clear();
  folderRestartMs = DEFAULT_FOLDER_RESTART_MS;
  deviceLastSeen.clear();
  res.json({ ok: true });
});

// How long a scan of a folder takes on a node. Omit ip or folder for every one;
// 0 clears.
control.post('/scan-duration', (req, res) => {
  const { ip = '*', folder = '*', ms = 0 } = req.body || {};
  if (ms > 0) scanDurations.set(`${ip}|${folder}`, ms);
  else scanDurations.delete(`${ip}|${folder}`);
  return res.json({ ok: true, ip, folder, ms });
});

// How long a folder takes to restart after its config changes, on every node.
control.post('/folder-restart-ms', (req, res) => {
  const { ms = DEFAULT_FOLDER_RESTART_MS } = req.body || {};
  folderRestartMs = ms;
  return res.json({ ok: true, ms });
});

// Change fields of a node's folder config directly, as something other than
// FluxOS would, prepared like any config change. Not recorded as a folder
// write. 404 for an unknown folder.
control.post('/folder-config', (req, res) => {
  const { ip, id, fields = {} } = req.body || {};
  const state = nodeStates.get(ip);
  const existing = state?.folders.get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  state.folders.set(id, { ...existing, ...fields });
  prepareConfig(state);
  return res.json({ ok: true });
});

// Drop the recorded folder-write and scan history, leaving the folder config itself
// alone: a test that asks "what did THIS operation do" needs a mark it can
// measure from, and the monitor writes folder config continuously.
control.post('/folder-writes-reset', (req, res) => {
  const { ip = '*' } = req.body || {};
  const targets = ip === '*' ? Array.from(nodeStates.keys()) : [ip];
  targets.forEach((target) => {
    const state = nodeStates.get(target);
    if (state) {
      state.folderWrites.length = 0;
      state.folderScans.length = 0;
    }
  });
  res.json({ ok: true });
});

control.listen(CONTROL_PORT, () => console.log(`Syncthing stub control API on port ${CONTROL_PORT}`));
