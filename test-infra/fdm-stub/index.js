const express = require('express');

// Stub for the FDM (Flux Domain Manager) /appips election endpoint.
// The real FDM is an external service at fdm-{fn,usa,sg}-1-{index}.runonflux.io:16130
// that masterSlaveApps polls (getMasterIpFromFdm) to learn the elected primary IP
// for a g: app. There is no push channel — the node polls. An app's primary is
// either ELECTED, set by the test through the control API, or FOLLOWED, decided
// by the stub from what the nodes report, the way FDM decides it.

const PORT = parseInt(process.env.FDM_PORT || '16130', 10);
const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '16131', 10);

// appName -> elected primary IP (bare, e.g. "198.18.1.0"). Absent => no primary,
// which mirrors the real FDM returning an empty ips array (the node waits).
const elected = new Map();

// Whether FDM is answering at all. Electing and clearing are both FDM giving a
// verdict, so neither reaches the node's third state — "FDM did not answer" —
// which is the one the election stands down on. That state needs the service to
// stop producing verdicts:
//   'refuse'      the listening socket is closed, so the node gets ECONNREFUSED.
//                 This is the production outage signature: the error carries no
//                 response at all.
//   'unavailable' 503, FDM reachable but declining to answer because it reports
//                 itself as still starting up.
// null => answering normally.
let outageMode = null;
let server = null;

// appName -> the state of an app whose primary is FOLLOWED rather than set: the
// stub decides it from what the nodes report, by the rules of FDM's
// selectGPrimaries (fdm domainService.js), on a compressed clock the suite
// supplies. A followed app cannot also be elected by hand.
const followed = new Map();
let followTimer = null;
let followGeneration = 0;

const ProbeState = Object.freeze({
  RUNNING: 'running',
  NOT_RUNNING: 'notRunning',
  UNKNOWN: 'unknown',
});

// What one node reports on a route, as bare container names. Anything but a
// readable list is UNKNOWN: a node that cannot say has not said "none".
async function fetchNames(socketAddress, route, timeoutMs) {
  try {
    const res = await fetch(`http://${socketAddress}${route}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const payload = (await res.json())?.data;
    if (!Array.isArray(payload)) return null;
    return new Set(payload
      .map((entry) => (typeof entry === 'string' ? entry : entry?.Names?.[0]))
      .filter((raw) => typeof raw === 'string')
      .map((raw) => raw.replace(/^\//, '')));
  } catch {
    return null;
  }
}

async function probe(state, socketAddress, route) {
  const names = await fetchNames(socketAddress, route, state.timing.probeTimeoutMs);
  if (!names) return ProbeState.UNKNOWN;
  return state.gNames.some((name) => names.has(name)) ? ProbeState.RUNNING : ProbeState.NOT_RUNNING;
}

// FDM's candidate order: lowest sum of the address's digits, then the address.
function digitSum(socketAddress) {
  return socketAddress.split(':')[0].split('.').reduce((sum, part) => sum + parseInt(part, 10), 0);
}

function orderedCandidates(addresses, sticky) {
  return addresses.filter((a) => a !== sticky)
    .sort((a, b) => digitSum(a) - digitSum(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// The app's instances, as the network lists them: FDM chooses only among them,
// and an instance leaving the list releases it. Asked of the first node that
// answers; the previous list stands when none does.
async function locationsOf(appName, state) {
  for (const node of state.nodes) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`http://${node}/apps/location/${appName}`, { signal: AbortSignal.timeout(state.timing.probeTimeoutMs) });
      // eslint-disable-next-line no-await-in-loop
      const rows = res.ok ? (await res.json())?.data : null;
      if (Array.isArray(rows)) return rows.map((row) => row.ip).filter(Boolean);
    } catch {
      // the next node is asked
    }
  }
  return state.locations;
}

// One FDM pass for one app: the remembered primary while it runs or is within
// its grace, else the first candidate running it, else - nothing running it
// anywhere - a node holding it (operator-stopped).
async function decide(appName, state) {
  const now = Date.now();
  const { timing } = state;
  state.locations = await locationsOf(appName, state);
  const ips = state.locations;
  if (!ips.length) return null;

  const { sticky } = state;
  if (sticky && ips.includes(sticky)) {
    if (await probe(state, sticky, '/apps/listrunningapps') === ProbeState.RUNNING) {
      state.lastHealthy = now;
      state.failures = 0;
      return sticky;
    }
    state.failures += 1;
    const established = state.lastHealthy > 0;
    const withinGrace = established && now - state.lastHealthy < timing.graceMs;
    const tooFewChecks = established && state.failures < timing.confirmations;
    if (withinGrace || tooFewChecks) return sticky;
  }

  for (const candidate of orderedCandidates(ips, sticky)) {
    // eslint-disable-next-line no-await-in-loop
    if (await probe(state, candidate, '/apps/listrunningapps') === ProbeState.RUNNING) {
      state.sticky = candidate;
      state.lastHealthy = now;
      state.failures = 0;
      return candidate;
    }
  }

  if (sticky && ips.includes(sticky)) {
    const held = await probe(state, sticky, '/apps/heldcomponents');
    if (held === ProbeState.RUNNING) {
      state.lastHeld = now;
      return sticky;
    }
    if (held === ProbeState.NOT_RUNNING) state.lastHeld = 0;
    if (held === ProbeState.UNKNOWN && state.lastHeld > 0 && now - state.lastHeld < timing.graceMs) return sticky;
  }
  for (const candidate of orderedCandidates(ips, sticky)) {
    // eslint-disable-next-line no-await-in-loop
    if (await probe(state, candidate, '/apps/heldcomponents') === ProbeState.RUNNING) {
      state.sticky = candidate;
      state.lastHeld = now;
      state.lastHealthy = 0;
      state.failures = 0;
      return candidate;
    }
  }
  return null;
}

// Passes start no closer together than the shortest followed passMs, measured
// start to start, and never overlap: FDM's cadence is max(its floor, how long
// the pass took).
async function followPass(generation) {
  if (generation !== followGeneration) return;
  const startedAt = Date.now();
  await Promise.all([...followed].map(async ([appName, state]) => {
    try {
      const chosen = await decide(appName, state);
      state.chosen = chosen ? chosen.split(':')[0] : null;
    } catch (error) {
      console.log(`FDM follow pass for ${appName} failed: ${error.message}`);
    }
  }));
  if (generation !== followGeneration) return;
  if (!followed.size) {
    followTimer = null;
    return;
  }
  const floor = Math.min(...[...followed.values()].map((s) => s.timing.passMs));
  followTimer = setTimeout(followPass, Math.max(0, floor - (Date.now() - startedAt)), generation);
}

function startFollowing() {
  if (followTimer === null) followTimer = setTimeout(followPass, 0, followGeneration);
}

// Ends every loop, including a pass still in flight: it finds its generation
// gone and schedules nothing.
function stopFollowingAll() {
  followGeneration += 1;
  if (followTimer !== null) clearTimeout(followTimer);
  followTimer = null;
  followed.clear();
}

// The answer /appips gives for a followed app: FDM serves it through a response
// cache, so a new decision reaches a node only once the cached one has aged out.
function followedAnswer(state) {
  const now = Date.now();
  if (!state.served || now - state.served.at >= state.timing.cacheMs) {
    state.served = { ip: state.chosen, at: now };
  }
  return state.served.ip;
}

// --- FDM API (what the FluxOS node polls) ---

const app = express();
app.use(express.json());

// getMasterIpFromFdm reads response.data.status === 'success' && response.data.data,
// then data.ips[0] (passed through extractIp, which splits on ':' — bare IP is fine).
// An empty ips array is the "no primary set" path: the node keeps waiting.
app.get('/appips/:app', (req, res) => {
  if (outageMode === 'unavailable') {
    res.status(503).json({ status: 'error', data: 'FDM starting up' });
    return;
  }
  const state = followed.get(req.params.app);
  const ip = state ? followedAnswer(state) : elected.get(req.params.app);
  res.json({ status: 'success', data: { ips: ip ? [ip] : [] } });
});

app.all('*', (req, res) => {
  console.log(`Unhandled FDM request: ${req.method} ${req.path}`);
  if (outageMode === 'unavailable') {
    res.status(503).json({ status: 'error', data: 'FDM starting up' });
    return;
  }
  res.json({ status: 'success', data: { ips: [] } });
});

function listen(done) {
  server = app.listen(PORT, () => {
    console.log(`FDM stub listening on port ${PORT}`);
    if (done) done();
  });
}

listen();

// --- Test harness control API ---

const control = express();
control.use(express.json());

control.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

control.get('/state', (req, res) => {
  const following = Object.fromEntries([...followed].map(([name, s]) => [name, {
    chosen: s.chosen, served: s.served?.ip ?? null, sticky: s.sticky, failures: s.failures,
  }]));
  res.json({ elected: Object.fromEntries(elected), following, outage: outageMode });
});

// elect (or fail over) the primary for an app
control.post('/appips/:app', (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  if (followed.has(req.params.app)) return res.status(409).json({ error: `${req.params.app} is followed, not elected` });
  elected.set(req.params.app, ip);
  return res.json({ ok: true, app: req.params.app, ip });
});

// clear the primary for an app (no node elected -> all standbys wait)
control.post('/clear/:app', (req, res) => {
  elected.delete(req.params.app);
  followed.delete(req.params.app);
  res.json({ ok: true });
});

// Follow an app's primary instead of electing it.
//   nodes   socket addresses ('ip:port') to ask for the app's locations
//   gNames  the docker names of its g: components, without the leading slash
//   timing  { passMs, graceMs, confirmations, cacheMs, probeTimeoutMs }
control.post('/follow/:app', (req, res) => {
  const { nodes, gNames, timing } = req.body || {};
  const keys = ['passMs', 'graceMs', 'confirmations', 'cacheMs', 'probeTimeoutMs'];
  if (!Array.isArray(nodes) || !nodes.length || !Array.isArray(gNames) || !gNames.length
    || !timing || !keys.every((k) => Number.isFinite(timing[k]) && timing[k] > 0)) {
    return res.status(400).json({ error: `nodes, gNames and timing { ${keys.join(', ')} } required` });
  }
  elected.delete(req.params.app);
  followed.set(req.params.app, {
    nodes, gNames, timing, locations: [], sticky: null, lastHealthy: 0, failures: 0, lastHeld: 0, chosen: null, served: null,
  });
  startFollowing();
  return res.json({ ok: true, app: req.params.app });
});

// Stop answering. The control API is a second server on its own port, so it
// stays reachable to end the outage again.
function beginOutage(mode, done) {
  outageMode = mode;
  if (mode !== 'refuse' || !server) {
    done();
    return;
  }
  // close() only stops new connections being accepted; a keep-alive socket the
  // node already holds would go on being answered, so the poll has to lose the
  // connection it has rather than read a stale success off it.
  if (server.closeAllConnections) server.closeAllConnections();
  server.close(() => {
    server = null;
    done();
  });
}

function endOutage(done) {
  const wasRefusing = outageMode === 'refuse';
  outageMode = null;
  if (!wasRefusing || server) {
    done();
    return;
  }
  listen(done);
}

control.post('/outage', (req, res) => {
  const mode = (req.body && req.body.mode) || 'refuse';
  if (mode !== 'refuse' && mode !== 'unavailable') {
    return res.status(400).json({ error: "mode must be 'refuse' or 'unavailable'" });
  }
  return beginOutage(mode, () => res.json({ ok: true, outage: mode }));
});

control.post('/recover', (req, res) => {
  endOutage(() => res.json({ ok: true, outage: null }));
});

// Suites reset in both setup and teardown, so this has to put every piece of
// stub state back - an outage left behind would answer for the next suite.
control.post('/reset', (req, res) => {
  elected.clear();
  stopFollowingAll();
  endOutage(() => res.json({ ok: true }));
});

control.listen(CONTROL_PORT, () => console.log(`FDM stub control API on port ${CONTROL_PORT}`));
