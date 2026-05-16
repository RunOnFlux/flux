const express = require('express');

const PORT = parseInt(process.env.GITHUB_STUB_PORT || '3000', 10);
const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '3001', 10);

const state = {
  blockedRepositories: [],
  vettedRepositories: [],
  whitelistedRepositories: [],
  tamperingBlocklist: [],
  latestRelease: { tag_name: 'v0.0.0', name: 'stub-release' },
};

// --- GitHub content/API server ---

const app = express();
app.use(express.json());

app.get('/helpers/blockedrepositories.json', (req, res) => {
  res.json(state.blockedRepositories);
});

app.get('/helpers/vettedrepositories.json', (req, res) => {
  res.json(state.vettedRepositories);
});

app.get('/helpers/repositories.json', (req, res) => {
  res.json(state.whitelistedRepositories);
});

app.get('/helpers/tamperingblockednodes.json', (req, res) => {
  res.json(state.tamperingBlocklist);
});

app.get('/repos/:owner/:repo/releases/latest', (req, res) => {
  res.json(state.latestRelease);
});

app.get('/repos/:owner/:repo', (req, res) => {
  res.json({ full_name: `${req.params.owner}/${req.params.repo}` });
});

// --- Control API ---

const control = express();
control.use(express.json());

control.get('/state', (req, res) => {
  res.json(state);
});

control.post('/blocked-repos', (req, res) => {
  state.blockedRepositories = req.body;
  res.json({ ok: true });
});

control.post('/vetted-repos', (req, res) => {
  state.vettedRepositories = req.body;
  res.json({ ok: true });
});

control.post('/whitelisted-repos', (req, res) => {
  state.whitelistedRepositories = req.body;
  res.json({ ok: true });
});

control.post('/tampering-blocklist', (req, res) => {
  state.tamperingBlocklist = req.body;
  res.json({ ok: true });
});

control.post('/latest-release', (req, res) => {
  state.latestRelease = req.body;
  res.json({ ok: true });
});

control.post('/reset', (req, res) => {
  state.blockedRepositories = [];
  state.vettedRepositories = [];
  state.whitelistedRepositories = [];
  state.tamperingBlocklist = [];
  state.latestRelease = { tag_name: 'v0.0.0', name: 'stub-release' };
  res.json({ ok: true });
});

control.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`GitHub stub listening on port ${PORT}`);
});

control.listen(CONTROL_PORT, () => {
  console.log(`GitHub stub control API on port ${CONTROL_PORT}`);
});
