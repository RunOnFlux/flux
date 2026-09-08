const express = require('express');

// Stub for the FDM (Flux Domain Manager) /appips election endpoint.
// The real FDM is an external service at fdm-{fn,usa,sg}-1-{index}.runonflux.io:16130
// that masterSlaveApps polls (getMasterIpFromFdm) to learn the elected primary IP
// for a g: app. There is no push channel — the node polls — so this stub just holds
// a per-app elected IP that tests drive via the control API to elect / fail over.

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
  const ip = elected.get(req.params.app);
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
  res.json({ elected: Object.fromEntries(elected), outage: outageMode });
});

// elect (or fail over) the primary for an app
control.post('/appips/:app', (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  elected.set(req.params.app, ip);
  return res.json({ ok: true, app: req.params.app, ip });
});

// clear the primary for an app (no node elected -> all standbys wait)
control.post('/clear/:app', (req, res) => {
  elected.delete(req.params.app);
  res.json({ ok: true });
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
  endOutage(() => res.json({ ok: true }));
});

control.listen(CONTROL_PORT, () => console.log(`FDM stub control API on port ${CONTROL_PORT}`));
