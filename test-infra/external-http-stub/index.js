const zlib = require('zlib');
const express = require('express');

const PORT = parseInt(process.env.STUB_PORT || '3000', 10);
const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '3001', 10);

// The harness fleet lives in 198.18.0.0/15 (RFC 2544 benchmarking range).
const HARNESS_NET_START = (198 * 2 ** 24) + (18 * 2 ** 16);
const HARNESS_NET_END = HARNESS_NET_START + (2 * 2 ** 16) - 1;

const GEO_MAGIC = 'FLXGEO';
const GEO_FORMAT = 2;

// The FluxOS store refuses any baseline below its truncation floor - a
// fleet-integrity constant, deliberately not configurable. The harness
// artifact therefore ships at real scale: this many one-address filler rows
// in space no harness fleet touches (16.0.0.0 up), alternating between two
// filler organisations so no reader could collapse them, ahead of the fleet
// rows. Only the binary artifact is padded; the format-1 JSON reader has no
// floor, and thirty megabytes of JSON per fetch would buy nothing.
const GEO_FILLER_ROWS = 1500000;
const GEO_FILLER_START = 16 * 2 ** 24;
const GEO_FILLER_END = GEO_FILLER_START + GEO_FILLER_ROWS - 1;
const GEO_FILLER_ORGS = ['harness:filler-0', 'harness:filler-1'];

// The artifact's country and region vocabularies, index-aligned: regions[k] is
// a region OF countries[k]. The split gives organisation k country k, so the
// region it may carry is the one belonging to that same country - a row whose
// region contradicts its country would describe a geography no real build
// publishes.
const GEO_COUNTRIES = ['DE', 'FR', 'NL', 'FI', 'BH'];
const GEO_REGIONS = ['DE-HE', 'FR-IDF', 'NL-NH', 'FI-18', 'BH-13'];

let fillerBytesCache = null;

/**
 * The filler section's row bytes, identical for every artifact: encoded once,
 * reused on every regeneration. Filler org indices are 0 and 1 - the two
 * filler organisations lead the combined orgs table, so these bytes never
 * depend on the fleet split being served.
 * @returns {Buffer}
 */
function fillerBytes() {
  if (fillerBytesCache) return fillerBytesCache;
  const bytes = [];
  for (let i = 0; i < GEO_FILLER_ROWS; i += 1) {
    writeVarint(bytes, i === 0 ? GEO_FILLER_START : 0); // gap (prevEnd starts at -1)
    writeVarint(bytes, 0); // single-address row
    writeVarint(bytes, (i % 2) + 1); // filler org index + 1
    writeVarint(bytes, 1); // countries[0]
    writeVarint(bytes, 0); // no region
  }
  fillerBytesCache = Buffer.from(bytes);
  return fillerBytesCache;
}

let lastGenerated = 0;

/**
 * A distinct ISO timestamp for every regeneration. Nodes key their cached
 * per-node locations on the table's `generated` and invalidate them when it
 * changes, so two artifacts published in the same millisecond must still
 * differ or the second split is never seen.
 * @returns {string} ISO timestamp
 */
function nextGenerated() {
  lastGenerated = Math.max(Date.now(), lastGenerated + 1);
  return new Date(lastGenerated).toISOString();
}

/**
 * Which region each organisation's addresses carry.
 *
 * Organisation k takes GEO_REGIONS[k % GEO_REGIONS.length] - the region of the
 * country the split already gives it - EXCEPT the last organisation, which
 * carries none. A regioned fleet therefore holds both nodes whose region the
 * table proves and nodes whose region it does not carry, which is what the
 * region-pin semantics need on both sides: a pin is satisfied only by a proven
 * region, and a region deny catches only a proven region.
 *
 * Without regions every organisation carries none, which is the artifact every
 * other suite sees.
 * @param {number} domains How many organisations the fleet is split across
 * @param {boolean} withRegions Whether to assign regions at all
 * @returns {{table: string[], assigned: object, unassigned: string[]}}
 */
function regionAssignment(domains, withRegions) {
  const orgCount = Math.max(domains, 1);
  const assigned = {};
  for (let org = 0; org < orgCount; org += 1) {
    assigned[org] = withRegions && org !== orgCount - 1
      ? GEO_REGIONS[org % GEO_REGIONS.length]
      : null;
  }
  const taken = new Set(Object.values(assigned).filter((region) => region !== null));
  return {
    table: [...GEO_REGIONS],
    assigned,
    // regions the vocabulary publishes that no address in this artifact claims
    unassigned: GEO_REGIONS.filter((region) => !taken.has(region)),
  };
}

/**
 * An iplocation artifact for the harness range. The same rows feed both served
 * representations: this object is what /iplocation.json serves, and
 * encodeGeoTable turns it into the format-2 /iplocation.bin.gz.
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
 *
 * `withRegions` additionally gives every row the region its organisation
 * carries (see regionAssignment), as the optional fifth row element. Without
 * it the rows stay four elements long and no row claims a region, so both
 * representations are byte-identical to what a caller that never asks for
 * regions has always been served.
 * @param {number} domains How many organisations to split across
 * @param {string} [subnet] Dotted /24 prefix to split, e.g. '198.18.5'
 * @param {boolean} [withRegions] Whether rows carry a region
 * @returns {object} artifact in format 1
 */
function buildIpLocationArtifact(domains, subnet, withRegions = false) {
  const orgs = Array.from({ length: Math.max(domains, 1) }, (unused, i) => `harness:org-${i}`);
  const countries = GEO_COUNTRIES;
  const { assigned } = regionAssignment(domains, withRegions);
  // a row is [start, end, orgIdx, ccIdx] and, once regions are asked for,
  // [start, end, orgIdx, ccIdx, regionIdx] with null for "no region"
  const row = (start, end, org, cc) => (withRegions
    ? [start, end, org, cc, assigned[org] === null ? null : GEO_REGIONS.indexOf(assigned[org])]
    : [start, end, org, cc]);
  const v4 = [];
  if (domains <= 1 || !subnet) {
    v4.push(row(HARNESS_NET_START, HARNESS_NET_END, 0, 0));
  } else {
    const [a, b, c] = subnet.split('.').map(Number);
    const base = (a * 2 ** 24) + (b * 2 ** 16) + (c * 2 ** 8);
    if (base > HARNESS_NET_START) v4.push(row(HARNESS_NET_START, base - 1, 0, 0));
    for (let octet = 0; octet < 256; octet += 1) {
      const org = octet % domains;
      v4.push(row(base + octet, base + octet, org, org % countries.length));
    }
    if (base + 255 < HARNESS_NET_END) v4.push(row(base + 256, HARNESS_NET_END, 0, 0));
  }
  return {
    format: 1,
    generated: nextGenerated(),
    sources: { harness: 'stub' },
    countries,
    continents: {
      DE: 'EU', FR: 'EU', NL: 'EU', FI: 'EU', BH: 'AS',
    },
    orgs,
    // the vocabulary a real build publishes; which of them any row claims is
    // regionAssignment's business
    regions: GEO_REGIONS,
    v4,
    v6: [],
  };
}

/**
 * Append one unsigned LEB128 varint. Plain arithmetic rather than shifts:
 * range bounds run past 2^31 (198.18.0.0 is 3,323,068,416), which the signed
 * 32-bit shift operators cannot carry.
 * @param {number[]} bytes Output byte list, appended in place
 * @param {number} value Non-negative integer
 */
function writeVarint(bytes, value) {
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) + 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
}

/**
 * Encode a format-1 artifact as the format-2 wire artifact iplocation.bin.gz.
 *
 * Layout, little-endian, gzipped whole: magic FLXGEO, version byte 2, u32
 * header length, the UTF-8 JSON header, u32 row count, then five unsigned
 * LEB128 varints per row - gap (start - previousEnd - 1, previousEnd starting
 * at -1), len (end - start), then org, country and region as their table index
 * PLUS ONE, with 0 meaning "none".
 *
 * Throws on anything a strict reader rejects, so the stub cannot publish bytes
 * it presents as well-formed and are not. The one reader rule it cannot meet
 * is the truncation floor (>= 1,500,000 rows): a harness fleet's table is a
 * few hundred rows, so the FluxOS store's floor has to be configurable for the
 * harness - that is the store-side change, noted here because this is where
 * the short artifact comes from.
 * @param {object} artifact Format-1 artifact
 * @returns {Buffer} gzipped format-2 bytes
 */
function encodeGeoTable(artifact) {
  const { countries, orgs, v4 } = artifact;
  const regions = artifact.regions ?? [];
  const header = Buffer.from(JSON.stringify({
    generated: artifact.generated,
    sources: artifact.sources,
    countries,
    continents: artifact.continents,
    // the two filler organisations lead, so fleet org indices shift by two
    // in the wire artifact - and by nothing anywhere else
    orgs: [...GEO_FILLER_ORGS, ...orgs],
    regions,
  }), 'utf8');
  const preamble = Buffer.alloc(GEO_MAGIC.length + 1 + 4);
  preamble.write(GEO_MAGIC, 0, 'ascii');
  preamble.writeUInt8(GEO_FORMAT, GEO_MAGIC.length);
  preamble.writeUInt32LE(header.length, GEO_MAGIC.length + 1);
  const rowCount = Buffer.alloc(4);
  rowCount.writeUInt32LE(GEO_FILLER_ROWS + v4.length, 0);
  const rows = [];
  let previousEnd = GEO_FILLER_END;
  v4.forEach(([start, end, org, cc, region], i) => {
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || start <= previousEnd) {
      throw new Error(`row ${i}: bounds unsorted, overlapping, below the filler space or not integers`);
    }
    const indexes = [org === null || org === undefined ? 0 : org + 1 + GEO_FILLER_ORGS.length, (cc ?? -1) + 1, (region ?? -1) + 1];
    const limits = [orgs.length + GEO_FILLER_ORGS.length, countries.length, regions.length];
    indexes.forEach((index, column) => {
      if (!Number.isInteger(index) || index < 0 || index > limits[column]) {
        throw new Error(`row ${i}: index out of table bounds`);
      }
    });
    writeVarint(rows, start - previousEnd - 1);
    writeVarint(rows, end - start);
    indexes.forEach((index) => writeVarint(rows, index));
    previousEnd = end;
  });
  return zlib.gzipSync(Buffer.concat([preamble, header, rowCount, fillerBytes(), Buffer.from(rows)]));
}

/**
 * The wire artifact for whatever is being served. A caller-supplied malformed
 * artifact (the reject-and-keep suites) has no valid format-2 encoding, so the
 * binary route serves its gzipped JSON: bytes that fetch cleanly and fail the
 * reader exactly like their JSON counterpart.
 * @param {object|null} artifact Format-1 artifact, or null for no artifact
 * @returns {Buffer|null}
 */
function encodeIpLocationBinary(artifact) {
  if (!artifact) return null;
  try {
    return encodeGeoTable(artifact);
  } catch {
    return zlib.gzipSync(Buffer.from(JSON.stringify(artifact), 'utf8'));
  }
}

const state = {
  blockedRepositories: [],
  vettedRepositories: [],
  whitelistedRepositories: [],
  tamperingBlocklist: [],
  latestRelease: { tag_name: 'v0.0.0', name: 'stub-release' },
  geolocation: {},
  // published below; null in either representation serves a 404, which leaves
  // nodes tableless on the /16 arithmetic
  ipLocation: null,
  ipLocationBinary: null,
  ipLocationVersion: 0,
};

/**
 * Publish one artifact in both representations. Both bodies and the version
 * their etags carry move in a single synchronous step, so no fetch can catch
 * the stub serving a JSON artifact and a binary from different splits.
 * @param {object|null} artifact Format-1 artifact, or null to serve 404s
 */
function serveIpLocation(artifact) {
  state.ipLocation = artifact;
  state.ipLocationBinary = encodeIpLocationBinary(artifact);
  state.ipLocationVersion += 1;
}

serveIpLocation(buildIpLocationArtifact(1));

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
  const etag = `"iplocation-${state.ipLocationVersion}"`;
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type('application/json').send(body);
});

// The same artifact in the format-2 wire encoding. Both routes stay served:
// the two node lineages sharing this stub fetch different ones. Content-Encoding
// is deliberately not set - the gzip is the artifact's own framing rather than a
// transfer encoding, and a client that transparently inflated it would hand the
// reader the wrong bytes.
app.get('/iplocation.bin.gz', (req, res) => {
  if (!state.ipLocationBinary) {
    res.status(404).json({ error: 'no artifact configured' });
    return;
  }
  const etag = `"iplocationbin-${state.ipLocationVersion}"`;
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type('application/octet-stream').send(state.ipLocationBinary);
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
  const { ip } = req.params;
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
  // the wire artifact is opaque bytes; its size is the readable part
  res.json({ ...state, ipLocationBinary: undefined, ipLocationBinaryBytes: state.ipLocationBinary?.length ?? 0 });
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
  // adding { regions: true } gives each split address the region of its
  // organisation, the last organisation carrying none (see regionAssignment) -
  // omit it and the artifact carries no region at all, exactly as before.
  // { artifact: {...} } serves a caller-supplied one (malformed included, to
  // exercise reject-and-keep); { artifact: null } serves a 404 (tableless).
  // Whichever it is, both /iplocation.json and /iplocation.bin.gz follow it.
  let regions = null; // a caller-supplied artifact has no assignment to report
  if (Object.prototype.hasOwnProperty.call(req.body, 'artifact')) {
    serveIpLocation(req.body.artifact);
  } else {
    const domains = req.body.domains ?? 1;
    const withRegions = req.body.regions === true;
    serveIpLocation(buildIpLocationArtifact(domains, req.body.subnet, withRegions));
    regions = regionAssignment(domains, withRegions);
  }
  res.json({
    ok: true,
    ranges: state.ipLocation?.v4?.length ?? 0,
    bytes: state.ipLocationBinary?.length ?? 0,
    regions,
  });
});

control.post('/reset', (req, res) => {
  state.blockedRepositories = [];
  state.vettedRepositories = [];
  state.whitelistedRepositories = [];
  state.tamperingBlocklist = [];
  state.latestRelease = { tag_name: 'v0.0.0', name: 'stub-release' };
  state.geolocation = {};
  serveIpLocation(buildIpLocationArtifact(1));
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
