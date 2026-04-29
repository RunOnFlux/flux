const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = Number(process.env.SYNCTHING_PORT) || 8384;
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 8385;
const DEVICE_ID = process.env.SYNCTHING_DEVICE_ID
  || 'STUBDEV-STUBDEV-STUBDEV-STUBDEV-STUBDEV-STUBDEV-STUBDEV-STUBDEV';
const API_KEY = process.env.SYNCTHING_API_KEY || 'stub-syncthing-api-key';

const folders = new Map();
const devices = new Map();
let restartRequired = false;

devices.set(DEVICE_ID, {
  deviceID: DEVICE_ID,
  name: 'stub-node',
  addresses: ['dynamic'],
  compression: 'metadata',
  introducer: false,
  paused: false,
});

// -- Health & Meta --

app.get('/meta.js', (req, res) => {
  res.type('application/javascript');
  res.send(`var metadata = {"deviceID":"${DEVICE_ID}"};`);
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
    myID: DEVICE_ID,
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
  restartRequired = false;
  res.json({ ok: 'restarting' });
});

app.post('/rest/system/shutdown', (req, res) => {
  res.json({ ok: 'shutting down' });
});

app.post('/rest/system/pause', (req, res) => {
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
  res.json({
    version: 37,
    folders: Array.from(folders.values()),
    devices: Array.from(devices.values()),
    gui: { enabled: true, address: `0.0.0.0:${PORT}`, apikey: API_KEY, theme: 'default' },
    ldap: {},
    options: { listenAddresses: ['default'], globalAnnEnabled: false, localAnnEnabled: false, relaysEnabled: false },
    defaults: { folder: {}, device: {}, ignores: {} },
  });
});

app.put('/rest/config', (req, res) => {
  if (req.body.folders) {
    folders.clear();
    req.body.folders.forEach((f) => folders.set(f.id, f));
  }
  if (req.body.devices) {
    devices.clear();
    req.body.devices.forEach((d) => devices.set(d.deviceID, d));
  }
  restartRequired = true;
  res.json({});
});

app.get('/rest/config/restart-required', (req, res) => {
  res.json({ requiresRestart: restartRequired });
});

// -- Config Folders --

app.get('/rest/config/folders', (req, res) => {
  res.json(Array.from(folders.values()));
});

app.get('/rest/config/folders/:id', (req, res) => {
  const folder = folders.get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'not found' });
  return res.json(folder);
});

app.put('/rest/config/folders/:id', (req, res) => {
  folders.set(req.params.id, { ...req.body, id: req.params.id });
  restartRequired = true;
  res.json({});
});

app.patch('/rest/config/folders/:id', (req, res) => {
  const existing = folders.get(req.params.id) || { id: req.params.id };
  folders.set(req.params.id, { ...existing, ...req.body });
  restartRequired = true;
  res.json({});
});

app.delete('/rest/config/folders/:id', (req, res) => {
  folders.delete(req.params.id);
  restartRequired = true;
  res.json({});
});

// -- Config Devices --

app.get('/rest/config/devices', (req, res) => {
  res.json(Array.from(devices.values()));
});

app.get('/rest/config/devices/:id', (req, res) => {
  const device = devices.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'not found' });
  return res.json(device);
});

app.put('/rest/config/devices/:id', (req, res) => {
  devices.set(req.params.id, { ...req.body, deviceID: req.params.id });
  restartRequired = true;
  res.json({});
});

app.patch('/rest/config/devices/:id', (req, res) => {
  const existing = devices.get(req.params.id) || { deviceID: req.params.id };
  devices.set(req.params.id, { ...existing, ...req.body });
  restartRequired = true;
  res.json({});
});

app.delete('/rest/config/devices/:id', (req, res) => {
  devices.delete(req.params.id);
  restartRequired = true;
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
  res.json({ completion: 100, globalBytes: 0, needBytes: 0, globalItems: 0, needItems: 0, needDeletes: 0 });
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
  res.json({
    errors: 0,
    globalBytes: 0,
    globalDeleted: 0,
    globalDirectories: 0,
    globalFiles: 0,
    globalSymlinks: 0,
    globalTotalItems: 0,
    ignorePatterns: false,
    inSyncBytes: 0,
    inSyncFiles: 0,
    invalid: '',
    localBytes: 0,
    localDeleted: 0,
    localDirectories: 0,
    localFiles: 0,
    localSymlinks: 0,
    localTotalItems: 0,
    needBytes: 0,
    needDeletes: 0,
    needDirectories: 0,
    needFiles: 0,
    needSymlinks: 0,
    needTotalItems: 0,
    pullErrors: 0,
    receiveOnlyChangedBytes: 0,
    receiveOnlyChangedDeletes: 0,
    receiveOnlyChangedDirectories: 0,
    receiveOnlyChangedFiles: 0,
    receiveOnlyChangedSymlinks: 0,
    receiveOnlyTotalItems: 0,
    sequence: 0,
    state: 'idle',
    stateChanged: new Date().toISOString(),
    version: 0,
    folder: folderId || '',
  });
});

app.post('/rest/db/override', (req, res) => res.json({}));
app.post('/rest/db/prio', (req, res) => res.json({}));
app.post('/rest/db/revert', (req, res) => res.json({}));
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
  devices.forEach((d) => {
    stats[d.deviceID] = { lastSeen: new Date().toISOString(), lastConnectionDurationS: 3600 };
  });
  res.json(stats);
});

app.get('/rest/stats/folder', (req, res) => {
  const stats = {};
  folders.forEach((f) => {
    stats[f.id] = { lastFile: { at: new Date().toISOString(), filename: '', deleted: false }, lastScan: new Date().toISOString() };
  });
  res.json(stats);
});

// -- Events --

app.get('/rest/events', (req, res) => {
  res.json([]);
});

app.get('/rest/events/disk', (req, res) => {
  res.json([]);
});

// -- SVC --

app.get('/rest/svc/deviceid', (req, res) => {
  res.json({ id: DEVICE_ID });
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

control.get('/state', (req, res) => {
  res.json({
    deviceId: DEVICE_ID,
    apiKey: API_KEY,
    folders: Array.from(folders.values()),
    devices: Array.from(devices.values()),
    restartRequired,
  });
});

control.post('/add-folder', (req, res) => {
  const folder = req.body;
  folders.set(folder.id, folder);
  res.json({ ok: true, folderCount: folders.size });
});

control.post('/add-device', (req, res) => {
  const device = req.body;
  devices.set(device.deviceID, device);
  res.json({ ok: true, deviceCount: devices.size });
});

control.delete('/folders', (req, res) => {
  folders.clear();
  res.json({ ok: true });
});

control.delete('/devices', (req, res) => {
  devices.clear();
  devices.set(DEVICE_ID, { deviceID: DEVICE_ID, name: 'stub-node', addresses: ['dynamic'] });
  res.json({ ok: true });
});

control.listen(CONTROL_PORT, () => console.log(`Syncthing stub control API on port ${CONTROL_PORT}`));
