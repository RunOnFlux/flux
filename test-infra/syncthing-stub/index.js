const express = require('express');
const crypto = require('crypto');

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

// ip -> { deviceID, folders: Map, devices: Map, restartRequired }
const nodeStates = new Map();

function nodeState(ip) {
  let state = nodeStates.get(ip);
  if (!state) {
    const deviceID = deviceIdForIp(ip);
    state = {
      deviceID, folders: new Map(), devices: new Map(), restartRequired: false,
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

// --- drivable sync state -------------------------------------------------
// Tests drive these via the control API; the defaults (below) reproduce the
// original always-synced/empty behaviour so existing suites are unaffected.
//
//   syncOverrides:       `${ip}|${folder}`          -> { state, globalBytes, inSyncBytes }
//   completionOverrides: `${ip}|${folder}|${device}`-> completion (0-100)
// ip may be '*' (any node) and device may be '*' (any peer); exact keys win.
const syncOverrides = new Map();
const completionOverrides = new Map(); // value: number (completion) or { completion, remoteState }

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

function lookupSync(ip, folder) {
  return syncOverrides.get(`${ip}|${folder}`) ?? syncOverrides.get(`*|${folder}`);
}

function lookupCompletion(ip, folder, device) {
  return completionOverrides.get(`${ip}|${folder}|${device}`)
    ?? completionOverrides.get(`${ip}|${folder}|*`)
    ?? completionOverrides.get(`*|${folder}|*`);
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
    startTime: new Date().toISOString(),
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
    defaults: { folder: {}, device: {}, ignores: {} },
  });
});

app.put('/rest/config', (req, res) => {
  const state = reqState(req);
  if (req.body.folders) {
    state.folders.clear();
    req.body.folders.forEach((f) => state.folders.set(f.id, f));
  }
  if (req.body.devices) {
    state.devices.clear();
    req.body.devices.forEach((d) => state.devices.set(d.deviceID, d));
  }
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

// Collection PUT (no id): the syncthing monitor writes folder config as an array
// of the folders that changed. Upsert by id (don't replace the whole set) so
// unrelated folders survive — matching how the monitor uses it.
app.put('/rest/config/folders', (req, res) => {
  const state = reqState(req);
  const arr = Array.isArray(req.body) ? req.body : [req.body];
  arr.forEach((f) => state.folders.set(f.id, f));
  res.json({});
});

app.get('/rest/config/folders/:id', (req, res) => {
  const folder = reqState(req).folders.get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'not found' });
  return res.json(folder);
});

app.put('/rest/config/folders/:id', (req, res) => {
  const state = reqState(req);
  state.folders.set(req.params.id, { ...req.body, id: req.params.id });
  res.json({});
});

app.patch('/rest/config/folders/:id', (req, res) => {
  const state = reqState(req);
  const existing = state.folders.get(req.params.id) || { id: req.params.id };
  state.folders.set(req.params.id, { ...existing, ...req.body });
  res.json({});
});

app.delete('/rest/config/folders/:id', (req, res) => {
  const state = reqState(req);
  state.folders.delete(req.params.id);
  res.json({});
});

// -- Config Devices --

app.get('/rest/config/devices', (req, res) => {
  res.json(Array.from(reqState(req).devices.values()));
});

// Collection PUT (no id): upsert each device by deviceID (see folders above).
app.put('/rest/config/devices', (req, res) => {
  const state = reqState(req);
  const arr = Array.isArray(req.body) ? req.body : [req.body];
  arr.forEach((d) => state.devices.set(d.deviceID, d));
  res.json({});
});

app.get('/rest/config/devices/:id', (req, res) => {
  const device = reqState(req).devices.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'not found' });
  return res.json(device);
});

app.put('/rest/config/devices/:id', (req, res) => {
  const state = reqState(req);
  state.devices.set(req.params.id, { ...req.body, deviceID: req.params.id });
  res.json({});
});

app.patch('/rest/config/devices/:id', (req, res) => {
  const state = reqState(req);
  const existing = state.devices.get(req.params.id) || { deviceID: req.params.id };
  state.devices.set(req.params.id, { ...existing, ...req.body });
  res.json({});
});

app.delete('/rest/config/devices/:id', (req, res) => {
  const state = reqState(req);
  state.devices.delete(req.params.id);
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
  const completion = (typeof override === 'object' ? override?.completion : override) ?? 100;
  // 'valid' = connected peer (the production trust rule only believes those);
  // overridable to 'unknown' to model a disconnected peer's stale index
  const remoteState = (typeof override === 'object' ? override?.remoteState : undefined) ?? 'valid';
  const globalBytes = 100000;
  const needBytes = Math.round((globalBytes * (100 - completion)) / 100);
  res.json({
    completion, globalBytes, needBytes, globalItems: 0, needItems: 0, needDeletes: 0, remoteState, sequence: 1,
  });
});

app.get('/rest/db/file', (req, res) => {
  res.json({ availability: [], global: {}, local: {} });
});

app.get('/rest/db/ignores', (req, res) => {
  res.json({ ignore: [], expanded: [] });
});

app.put('/rest/db/ignores', (req, res) => {
  res.json({});
});

app.get('/rest/db/localchanged', (req, res) => {
  res.json({ files: [], folders: [], symlinks: [], deletes: [], total: 0 });
});

app.get('/rest/db/need', (req, res) => {
  res.json({ progress: [], queued: [], rest: [], total: 0, page: 1, perpage: 65536 });
});

app.get('/rest/db/remoteneed', (req, res) => {
  res.json({ progress: [], queued: [], rest: [], total: 0, page: 1, perpage: 65536 });
});

app.get('/rest/db/status', (req, res) => {
  const folderId = req.query.folder;
  const ov = lookupSync(clientIp(req), folderId || '');
  if (ov?.statusUnreadable) return res.status(500).json({ error: 'simulated unreadable folder status' });
  const globalBytes = ov?.globalBytes ?? 0;
  const inSyncBytes = ov?.inSyncBytes ?? 0;
  const state = ov?.state ?? 'idle';
  const receiveOnlyChangedFiles = ov?.receiveOnlyChangedFiles ?? 0;
  const needBytes = Math.max(0, globalBytes - inSyncBytes);
  res.json({
    errors: 0,
    globalBytes,
    globalDeleted: 0,
    globalDirectories: 0,
    globalFiles: 0,
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
    receiveOnlyChangedBytes: receiveOnlyChangedFiles > 0 ? 1024 : 0,
    receiveOnlyChangedDeletes: 0,
    receiveOnlyChangedDirectories: 0,
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
  // revert undoes local changes in a receiveonly folder: clear the
  // receiveOnlyChangedFiles override so the next status reads clean
  const folder = req.query.folder || '';
  const ip = clientIp(req);
  nudgeLog(ip).push({ action: 'revert', device: folder, at: Date.now() });
  [`${ip}|${folder}`, `*|${folder}`].forEach((key) => {
    const ov = syncOverrides.get(key);
    if (ov && ov.receiveOnlyChangedFiles) syncOverrides.set(key, { ...ov, receiveOnlyChangedFiles: 0 });
  });
  res.json({});
});
app.post('/rest/db/scan', (req, res) => res.json({}));

// -- Folder --

app.get('/rest/folder/errors', (req, res) => {
  res.json({ errors: [], folder: req.query.folder || '', page: 1, perpage: 65536 });
});

app.get('/rest/folder/versions', (req, res) => {
  res.json({ versions: {} });
});

app.post('/rest/folder/versions', (req, res) => res.json({}));

// -- Stats --

app.get('/rest/stats/device', (req, res) => {
  const stats = {};
  reqState(req).devices.forEach((d) => {
    stats[d.deviceID] = { lastSeen: new Date().toISOString(), lastConnectionDurationS: 3600 };
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
    })),
  });
});

// --- drivable sync-state control ---
// Set what /rest/db/status returns for a (node ip, folder). Omit ip to target
// every node ('*'). A folder reporting globalBytes>0 with inSyncBytes<globalBytes
// reads as "not synced"; with state:'syncing' and frozen bytes across polls it
// reads as a stall (the production stall detector needs N unchanged samples).
control.post('/sync-state', (req, res) => {
  const {
    ip = '*', folder, state = 'idle', globalBytes = 0, inSyncBytes = 0, receiveOnlyChangedFiles = 0, statusUnreadable = false,
  } = req.body;
  if (!folder) return res.status(400).json({ error: 'folder required' });
  syncOverrides.set(`${ip}|${folder}`, {
    state, globalBytes, inSyncBytes, receiveOnlyChangedFiles, statusUnreadable,
  });
  return res.json({ ok: true });
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
  completionOverrides.set(`${ip}|${folder}|${device}`, remoteState !== undefined ? { completion, remoteState } : completion);
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

// Back to default always-synced/empty behaviour.
control.post('/sync-reset', (req, res) => {
  syncOverrides.clear();
  completionOverrides.clear();
  nudgeLogs.clear();
  eventsBuffers.clear();
  eventsOutages.clear();
  res.json({ ok: true });
});

control.listen(CONTROL_PORT, () => console.log(`Syncthing stub control API on port ${CONTROL_PORT}`));
