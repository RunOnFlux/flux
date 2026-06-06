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

// --- FDM API (what the FluxOS node polls) ---

const app = express();
app.use(express.json());

// getMasterIpFromFdm reads response.data.status === 'success' && response.data.data,
// then data.ips[0] (passed through extractIp, which splits on ':' — bare IP is fine).
// An empty ips array is the "no primary set" path: the node keeps waiting.
app.get('/appips/:app', (req, res) => {
  const ip = elected.get(req.params.app);
  res.json({ status: 'success', data: { ips: ip ? [ip] : [] } });
});

app.all('*', (req, res) => {
  console.log(`Unhandled FDM request: ${req.method} ${req.path}`);
  res.json({ status: 'success', data: { ips: [] } });
});

app.listen(PORT, () => console.log(`FDM stub listening on port ${PORT}`));

// --- Test harness control API ---

const control = express();
control.use(express.json());

control.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

control.get('/state', (req, res) => {
  res.json({ elected: Object.fromEntries(elected) });
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

control.post('/reset', (req, res) => {
  elected.clear();
  res.json({ ok: true });
});

control.listen(CONTROL_PORT, () => console.log(`FDM stub control API on port ${CONTROL_PORT}`));
