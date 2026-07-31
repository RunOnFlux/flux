const express = require('express');

const PORT = parseInt(process.env.STUB_PORT || '3000', 10);
const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '3001', 10);

// The harness fleet lives in 198.18.0.0/15 (RFC 2544 benchmarking range).
const HARNESS_NET_START = (198 * 2 ** 24) + (18 * 2 ** 16);
const HARNESS_NET_END = HARNESS_NET_START + (2 * 2 ** 16) - 1;

/**
 * An iplocation artifact for the harness range.
 *
 * `domains: 1` (the default) puts the whole fleet in one organisation, which
 * is the single-fault-domain posture the tableless fallback produced - suites
 * written against that keep their meaning while now exercising the real table
 * reader rather than skipping it.
 *
 * `domains: n` with a `subnet` (`198.18.5`) assigns that /24's addresses to n
 * organisations ROUND-ROBIN, one range per address. The harness gives its
 * nodes consecutive addresses from .10, so anything coarser than per-address
 * puts the whole fleet in one bucket; interleaving is what actually splits it.
 * Everything outside that /24 stays in one organisation, so the artifact is a
 * few hundred ranges rather than a hundred thousand.
 * @param {number} domains How many organisations to split across
 * @param {string} [subnet] Dotted /24 prefix to split, e.g. '198.18.5'
 * @returns {object} artifact in format 1
 */
function buildIpLocationArtifact(domains, subnet) {
  const orgs = Array.from({ length: Math.max(domains, 1) }, (unused, i) => `harness:org-${i}`);
  const countries = ['DE', 'FR', 'NL', 'FI', 'BH'];
  const v4 = [];
  if (domains <= 1 || !subnet) {
    v4.push([HARNESS_NET_START, HARNESS_NET_END, 0, 0]);
  } else {
    const [a, b, c] = subnet.split('.').map(Number);
    const base = (a * 2 ** 24) + (b * 2 ** 16) + (c * 2 ** 8);
    if (base > HARNESS_NET_START) v4.push([HARNESS_NET_START, base - 1, 0, 0]);
    for (let octet = 0; octet < 256; octet += 1) {
      const org = octet % domains;
      v4.push([base + octet, base + octet, org, org % countries.length]);
    }
    if (base + 255 < HARNESS_NET_END) v4.push([base + 256, HARNESS_NET_END, 0, 0]);
  }
  return {
    format: 1,
    generated: '2026-07-31T00:00:00Z',
    sources: { harness: 'stub' },
    countries,
    continents: {
      DE: 'EU', FR: 'EU', NL: 'EU', FI: 'EU', BH: 'AS',
    },
    orgs,
    regions: [],
    v4,
    v6: [],
  };
}

const state = {
  blockedRepositories: [],
  vettedRepositories: [],
  whitelistedRepositories: [],
  tamperingBlocklist: [],
  latestRelease: { tag_name: 'v0.0.0', name: 'stub-release' },
  geolocation: {},
  // null serves a 404, which leaves nodes tableless on the /16 arithmetic
  ipLocation: buildIpLocationArtifact(1),
};

function defaultGeoResponse(ip) {
  return {
    status: 'success',
    continent: 'Europe',
    continentCode: 'EU',
    country: 'Germany',
    countryCode: 'DE',
    region: 'HE',
    regionName: 'Hesse',
    lat: 50.1109,
    lon: 8.6821,
    query: ip,
    org: 'Hetzner Online GmbH',
    isp: 'Hetzner Online GmbH',
    proxy: false,
    hosting: true,
  };
}

// --- HTTP endpoint server ---

const app = express();
app.use(express.json());

// Policy documents. Served at the repo root (the fluxos-network-policy layout,
// config.policy.baseUrl) and at the retired /helpers/ paths (the RunOnFlux/flux
// layout, config.github.rawBaseUrl) so one stub covers nodes from either era.
app.get(['/blockedrepositories.json', '/helpers/blockedrepositories.json'], (req, res) => {
  res.json(state.blockedRepositories);
});

app.get(['/vettedrepositories.json', '/helpers/vettedrepositories.json'], (req, res) => {
  res.json(state.vettedRepositories);
});

app.get('/helpers/repositories.json', (req, res) => {
  res.json(state.whitelistedRepositories);
});

app.get(['/tamperingblockednodes.json', '/helpers/tamperingblockednodes.json'], (req, res) => {
  res.json(state.tamperingBlocklist);
});

// The IP location artifact. Served with a strong etag so the conditional
// refresh path (If-None-Match -> 304) is exercised, not just the first fetch.
app.get('/iplocation.json', (req, res) => {
  if (!state.ipLocation) {
    res.status(404).json({ error: 'no artifact configured' });
    return;
  }
  const body = JSON.stringify(state.ipLocation);
  const etag = `"iplocation-${state.ipLocationVersion ?? 0}"`;
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type('application/json').send(body);
});

// GitHub API endpoints
app.get('/repos/:owner/:repo/releases/latest', (req, res) => {
  res.json(state.latestRelease);
});

app.get('/repos/:owner/:repo', (req, res) => {
  res.json({ full_name: `${req.params.owner}/${req.params.repo}` });
});

// Geolocation: ip-api.com format (primary)
app.get('/json/:ip', (req, res) => {
  const custom = state.geolocation[req.params.ip];
  res.json({ ...defaultGeoResponse(req.params.ip), ...custom });
});

// Geolocation: stats.runonflux.io format (fallback)
app.get('/fluxlocation/:ip', (req, res) => {
  const ip = req.params.ip;
  const custom = state.geolocation[ip];
  const geo = { ...defaultGeoResponse(ip), ...custom };
  res.json({
    status: 'success',
    data: {
      ip,
      continent: geo.continent,
      continentCode: geo.continentCode,
      country: geo.country,
      countryCode: geo.countryCode,
      region: geo.region,
      regionName: geo.regionName,
      lat: geo.lat,
      lon: geo.lon,
      org: geo.org,
      static: !geo.proxy && geo.hosting,
      dataCenter: geo.hosting,
    },
  });
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

control.post('/geolocation/:ip', (req, res) => {
  state.geolocation[req.params.ip] = req.body;
  res.json({ ok: true });
});

control.delete('/geolocation/:ip', (req, res) => {
  delete state.geolocation[req.params.ip];
  res.json({ ok: true });
});

control.post('/iplocation', (req, res) => {
  // { domains: n } serves a generated artifact splitting each /24 n ways;
  // { artifact: {...} } serves a caller-supplied one (malformed included, to
  // exercise reject-and-keep); { artifact: null } serves a 404 (tableless).
  if (Object.prototype.hasOwnProperty.call(req.body, 'artifact')) {
    state.ipLocation = req.body.artifact;
  } else {
    state.ipLocation = buildIpLocationArtifact(req.body.domains ?? 1, req.body.subnet);
  }
  state.ipLocationVersion = (state.ipLocationVersion ?? 0) + 1;
  res.json({ ok: true, ranges: state.ipLocation ? state.ipLocation.v4.length : 0 });
});

control.post('/reset', (req, res) => {
  state.blockedRepositories = [];
  state.vettedRepositories = [];
  state.whitelistedRepositories = [];
  state.tamperingBlocklist = [];
  state.latestRelease = { tag_name: 'v0.0.0', name: 'stub-release' };
  state.geolocation = {};
  state.ipLocation = buildIpLocationArtifact(1);
  state.ipLocationVersion = (state.ipLocationVersion ?? 0) + 1;
  res.json({ ok: true });
});

control.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`External HTTP stub listening on port ${PORT}`);
});

control.listen(CONTROL_PORT, () => {
  console.log(`External HTTP stub control API on port ${CONTROL_PORT}`);
});
