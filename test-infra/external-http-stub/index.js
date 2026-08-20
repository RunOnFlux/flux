const zlib = require('zlib');
const dgram = require('dgram');
const fs = require('fs');
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
// The class codes the artifact carries, and the only two a reader knows. Named
// here so a suite says 'residential' and the wire value stays the publisher's
// business - fluxos-network-policy's scripts/orgclasses.js is the definition.
const NETWORK_CLASS_CODES = { residential: 1, hosting: 2 };

// The artifact's country and region vocabularies, index-aligned: regions[k] is
// a region OF countries[k]. The split gives organisation k country k, so the
// region it may carry is the one belonging to that same country - a row whose
// region contradicts its country would describe a geography no real build
// publishes.
const GEO_COUNTRIES = ['DE', 'FR', 'NL', 'FI', 'BH'];
const GEO_REGIONS = ['DE-HE', 'FR-IDF', 'NL-NH', 'FI-18', 'BH-13'];
// The region-name vocabulary a real build publishes alongside the codes, keyed
// '<CC>|<name>'. An app may name its region the way ip-api does rather than by
// code, and this is what lets a node answer such an entry at region granularity
// instead of falling back to the whole country. Index-aligned with the two
// tables above: GEO_REGION_NAMES[k] names GEO_REGIONS[k] in GEO_COUNTRIES[k].
const GEO_REGION_NAMES = ['Hesse', 'Ile-de-France', 'North Holland', 'Uusimaa', 'Capital'];

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
    // the name each published region also answers to, so a suite can pin with
    // the vocabulary an app actually carries rather than the code
    names: Object.fromEntries(GEO_REGIONS.map((code, k) => [code, GEO_REGION_NAMES[k]])),
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
 *
 * `networkClasses` says which of the organisations run access networks and
 * which sell hosting - `{ 0: 'residential', 1: 'hosting' }` keyed by
 * organisation INDEX, since that is what a caller controls. Omitted, the
 * artifact carries no orgClasses section at all, which is what a real build
 * carrying no verdicts publishes and what every suite that does not care about
 * classification should see: an organisation with no verdict is one nothing
 * enforces against.
 * @param {number} domains How many organisations to split across
 * @param {string} [subnet] Dotted /24 prefix to split, e.g. '198.18.5'
 * @param {boolean} [withRegions] Whether rows carry a region
 * @param {object} [networkClasses] Organisation index -> 'residential'|'hosting'
 * @returns {object} artifact in format 1
 */
function buildIpLocationArtifact(domains, subnet, withRegions = false, networkClasses = null) {
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
    regionNames: Object.fromEntries(
      GEO_REGIONS.map((code, k) => [`${GEO_COUNTRIES[k]}|${GEO_REGION_NAMES[k]}`, code]),
    ),
    // Keyed by organisation TOKEN, which is what the header carries and what a
    // reader looks up - the caller names an index because that is what it
    // controls, and the two are joined here rather than in the suite.
    ...(networkClasses ? {
      orgClasses: Object.fromEntries(
        Object.entries(networkClasses)
          .filter(([index]) => orgs[Number(index)])
          .map(([index, klass]) => [orgs[Number(index)], NETWORK_CLASS_CODES[klass]]),
      ),
    } : {}),
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
 * it presents as well-formed and are not - with one deliberate exception,
 * `pad: false`. The padded artifact is the one every suite wants: it meets the
 * reader's truncation floor (>= 1,500,000 rows), which is a fleet-integrity
 * invariant rather than a knob. `pad: false` drops the filler section and
 * publishes the fleet rows alone - a structurally valid artifact whose row
 * count is a few hundred, i.e. FLOOR BAIT BY DESIGN, and the only way a
 * harness fleet can exercise the floor at all. Everything else about the two
 * encodings is identical, header included: the filler organisations still lead
 * the orgs table, so fleet row indices do not move and the padded encoding is
 * byte-identical to what a caller that never passes `pad` has always been served.
 * @param {object} artifact Format-1 artifact
 * @param {{pad?: boolean}} [options] pad: false omits the filler rows
 * @returns {Buffer} gzipped format-2 bytes
 */
function encodeGeoTable(artifact, { pad = true } = {}) {
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
    // omitted when the artifact carries no regions, so a suite can publish the
    // pre-vocabulary artifact a node held before the section existed
    ...(regions.length ? { regionNames: artifact.regionNames ?? {} } : {}),
    // omitted when nothing is classified, for the same reason: a build carrying
    // no verdicts is a state the reader already handles, and it must stay
    // distinguishable from one that carries them
    ...(artifact.orgClasses && Object.keys(artifact.orgClasses).length
      ? { orgClasses: artifact.orgClasses } : {}),
  }), 'utf8');
  const preamble = Buffer.alloc(GEO_MAGIC.length + 1 + 4);
  preamble.write(GEO_MAGIC, 0, 'ascii');
  preamble.writeUInt8(GEO_FORMAT, GEO_MAGIC.length);
  preamble.writeUInt32LE(header.length, GEO_MAGIC.length + 1);
  const rowCount = Buffer.alloc(4);
  rowCount.writeUInt32LE((pad ? GEO_FILLER_ROWS : 0) + v4.length, 0);
  const rows = [];
  let previousEnd = pad ? GEO_FILLER_END : -1;
  v4.forEach(([start, end, org, cc, region], i) => {
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || start <= previousEnd) {
      throw new Error(`row ${i}: bounds unsorted, overlapping, below the rows already written or not integers`);
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
  const sections = [preamble, header, rowCount];
  if (pad) sections.push(fillerBytes());
  sections.push(Buffer.from(rows));
  return zlib.gzipSync(Buffer.concat(sections));
}

/**
 * The wire artifact for whatever is being served, and the row count its header
 * claims. A caller-supplied malformed artifact (the reject-and-keep suites) has
 * no valid format-2 encoding, so the binary route serves its gzipped JSON:
 * bytes that fetch cleanly and fail the reader exactly like their JSON
 * counterpart - and no row count, because those bytes carry none.
 * @param {object|null} artifact Format-1 artifact, or null for no artifact
 * @param {{pad?: boolean}} [options] pad: false omits the filler rows
 * @returns {{bytes: Buffer|null, rowCount: number|null}}
 */
function encodeIpLocationBinary(artifact, { pad = true } = {}) {
  if (!artifact) return { bytes: null, rowCount: null };
  try {
    return {
      bytes: encodeGeoTable(artifact, { pad }),
      rowCount: (pad ? GEO_FILLER_ROWS : 0) + artifact.v4.length,
    };
  } catch {
    return { bytes: zlib.gzipSync(Buffer.from(JSON.stringify(artifact), 'utf8')), rowCount: null };
  }
}

/**
 * Fetch counters for one artifact route, from zero. Both representations are
 * counted separately: the two node lineages sharing this stub fetch different
 * ones, and a suite asserting "this node did not download the artifact again"
 * must not have its answer moved by the other route.
 * @returns {{total: number, ok: number, notModified: number, missing: number}}
 */
function newRouteCounters() {
  return { total: 0, ok: 0, notModified: 0, missing: 0 };
}

const IPLOCATION_JSON_ROUTE = '/iplocation.json';
const IPLOCATION_BINARY_ROUTE = '/iplocation.bin.gz';

// The apt repository copied out of the node image at build time, served to the fleet
// so a legacy node installs its packages from here instead of from the internet. It is
// the same tree the image seeded itself from, so a node that purges and reinstalls gets
// the file it started with.
const APT_REPO_DIR = '/repo';

/**
 * The syncthing version the node image ships, recorded by the repository build.
 * Absent only if the stub image was built against a node image without one, which is
 * a build-ordering fault worth failing loudly on rather than papering over with a
 * default that would quietly make the minimum-version check meaningless.
 */
function imageSyncthingVersion() {
  const recorded = fs.readFileSync(`${APT_REPO_DIR}/syncthing.version`, 'utf8').trim();
  if (!recorded) throw new Error(`${APT_REPO_DIR}/syncthing.version is empty`);
  return recorded;
}

const state = {
  blockedRepositories: [],
  vettedRepositories: [],
  whitelistedRepositories: [],
  tamperingBlocklist: [],
  latestRelease: { tag_name: 'v0.0.0', name: 'stub-release' },
  geolocation: {},
  // The syncthing the node image ships, read from the repository the image was built
  // with rather than restated here. Serving the version the fleet already has is what
  // makes the boot-time check a no-op; a suite that wants the upgrade path raises this
  // instead of reaching syncthing's own service. A restated version goes stale silently:
  // it moves whenever the image is rebuilt, and a minimum every node exceeds asserts
  // nothing at all.
  moduleMinimumVersions: { syncthing: imageSyncthingVersion(), docker: '26.1.2' },
  marketplaceApps: [],
  appSpecsUsdPrice: [],
  // Fixed rates, so a price assertion is arithmetic rather than a bet on the market.
  // usdPerBtc * btcPerFlux is what the caller multiplies out, and it must equal usdPerFlux
  // so the coingecko fallback cannot change an answer.
  usdPerBtc: 100000,
  btcPerFlux: 0.000002,
  usdPerFlux: 0.2,
  // published below; null in either representation serves a 404, which leaves
  // nodes tableless on the /16 arithmetic
  ipLocation: null,
  ipLocationBinary: null,
  ipLocationVersion: 0,
  // the row count the served binary's header claims; null when the served bytes
  // are not a format-2 artifact at all
  ipLocationRowCount: null,
  // per-route fetch counters SINCE THE CURRENT ARTIFACT WAS PUBLISHED. A
  // publication is the only thing that resets them, so a suite reads them as
  // "what the fleet did about THIS artifact": which nodes downloaded it (ok),
  // which found their copy current (notModified) and which found none at all
  // (missing, a 404). The lifecycle suites assert against these rather than
  // inferring a refetch from a node's own logs.
  ipLocationFetches: {
    [IPLOCATION_JSON_ROUTE]: newRouteCounters(),
    [IPLOCATION_BINARY_ROUTE]: newRouteCounters(),
  },
};

/**
 * Count one artifact fetch.
 * @param {string} route Which representation was fetched
 * @param {'ok'|'notModified'|'missing'} outcome What it was answered with
 */
function countIpLocationFetch(route, outcome) {
  const counters = state.ipLocationFetches[route];
  counters.total += 1;
  counters[outcome] += 1;
}

/**
 * Publish one artifact in both representations. Both bodies and the version
 * their etags carry move in a single synchronous step, so no fetch can catch
 * the stub serving a JSON artifact and a binary from different splits.
 * @param {object|null} artifact Format-1 artifact, or null to serve 404s
 * @param {{pad?: boolean}} [options] pad: false publishes the binary without
 *   the filler rows - below the reader's truncation floor by design
 */
function serveIpLocation(artifact, { pad = true } = {}) {
  const { bytes, rowCount } = encodeIpLocationBinary(artifact, { pad });
  state.ipLocation = artifact;
  state.ipLocationBinary = bytes;
  state.ipLocationRowCount = rowCount;
  state.ipLocationVersion += 1;
  // a new artifact is a new question for the fleet: count the answers to it
  state.ipLocationFetches = {
    [IPLOCATION_JSON_ROUTE]: newRouteCounters(),
    [IPLOCATION_BINARY_ROUTE]: newRouteCounters(),
  };
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
    as: 'AS24940 Hetzner Online GmbH',
    proxy: false,
    hosting: true,
    mobile: false,
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
app.get(IPLOCATION_JSON_ROUTE, (req, res) => {
  if (!state.ipLocation) {
    countIpLocationFetch(IPLOCATION_JSON_ROUTE, 'missing');
    res.status(404).json({ error: 'no artifact configured' });
    return;
  }
  const body = JSON.stringify(state.ipLocation);
  const etag = `"iplocation-${state.ipLocationVersion}"`;
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    countIpLocationFetch(IPLOCATION_JSON_ROUTE, 'notModified');
    res.status(304).end();
    return;
  }
  countIpLocationFetch(IPLOCATION_JSON_ROUTE, 'ok');
  res.type('application/json').send(body);
});

// The same artifact in the format-2 wire encoding. Both routes stay served:
// the two node lineages sharing this stub fetch different ones. Content-Encoding
// is deliberately not set - the gzip is the artifact's own framing rather than a
// transfer encoding, and a client that transparently inflated it would hand the
// reader the wrong bytes.
app.get(IPLOCATION_BINARY_ROUTE, (req, res) => {
  if (!state.ipLocationBinary) {
    countIpLocationFetch(IPLOCATION_BINARY_ROUTE, 'missing');
    res.status(404).json({ error: 'no artifact configured' });
    return;
  }
  const etag = `"iplocationbin-${state.ipLocationVersion}"`;
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    countIpLocationFetch(IPLOCATION_BINARY_ROUTE, 'notModified');
    res.status(304).end();
    return;
  }
  countIpLocationFetch(IPLOCATION_BINARY_ROUTE, 'ok');
  res.type('application/octet-stream').send(state.ipLocationBinary);
});

// GitHub API endpoints
app.get('/repos/:owner/:repo/releases/latest', (req, res) => {
  res.json(state.latestRelease);
});

app.get('/repos/:owner/:repo', (req, res) => {
  res.json({ full_name: `${req.params.owner}/${req.params.repo}` });
});

// UPnP: a device description with no WANIPConnection service. upnpService is pointed here
// so its client stops searching for a gateway by SSDP multicast; support verification then
// fails on the missing service, which is the same verdict a node reaches today, so no node
// changes its mind about having UPnP.
app.get('/upnp/device.xml', (req, res) => {
  res.type('text/xml').send(
    '<?xml version="1.0"?>'
    + '<root xmlns="urn:schemas-upnp-org:device-1-0">'
    + '<device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>'
    + '<friendlyName>flux-e2e-stub-gateway</friendlyName><serviceList /></device>'
    + '</root>',
  );
});

// The apt repository a legacy node installs syncthing from. FluxOS writes this source
// itself (systemService addSyncthingRepository) from config.syncthing.aptSourceUrl, and
// fetches the keyring from config.syncthing.releaseKeyUrl, so both are pointed here and
// the keyring fetch, the source write, apt's HTTP transport and signature verification
// all run exactly as they do on a node - against a repository that never leaves the
// fleet network.
app.use('/apt', express.static(APT_REPO_DIR, { fallthrough: false }));

// Stats: the minimum module versions a node checks its own syncthing against at boot.
// The harness names the version its image ships, so the check is satisfied and no upgrade
// is attempted; a suite exercising the upgrade path raises it through the control port.
app.get('/getmodulesminimumversions', (req, res) => {
  res.json({ status: 'success', data: state.moduleMinimumVersions });
});

// Stats: marketplace listings. Empty by default - a suite that needs a listed app puts one
// in through the control port rather than depending on what the live marketplace holds.
app.get('/marketplace/listapps', (req, res) => {
  res.json({ status: 'success', data: state.marketplaceApps });
});

app.get('/marketplace/listdevapps', (req, res) => {
  res.json({ status: 'success', data: state.marketplaceApps });
});

// Stats: per-spec USD pricing.
app.get('/apps/getappspecsusdprice', (req, res) => {
  res.json({ status: 'success', data: state.appSpecsUsdPrice });
});

// Pricing: viprates.runonflux.io/rates. The real service answers a two-element array -
// [fiatRates, coinRates] - and the caller reads USD from the first and FLUX from the second.
app.get('/rates', (req, res) => {
  res.json([[{ code: 'USD', rate: state.usdPerBtc }], { FLUX: state.btcPerFlux }]);
});

// Pricing: the coingecko fallback, reached only when /rates above is unavailable.
app.get('/api/v3/simple/price', (req, res) => {
  res.json({ zelcash: { usd: state.usdPerFlux } });
});

// Geolocation: ip-api.com format (primary)
app.get('/json/:ip', (req, res) => {
  const custom = state.geolocation[req.params.ip];
  res.json({ ...defaultGeoResponse(req.params.ip), ...custom });
});

// Geolocation: stats.runonflux.io format (fallback)
//
// LOCATION ONLY, and deliberately so. The real service builds this collection
// by batch-querying ip-api itself for every IP on the deterministic node list,
// asking for `status,continent,continentCode,country,countryCode,region,
// regionName,lat,lon,query,org,isp` - no hosting, no proxy, no mobile, no `as`
// - and its /fluxlocation/:ip handler then projects to exactly the ten fields
// below. It has never carried `static` or `dataCenter`; this stub used to
// synthesise both from the ip-api fixture, which made the fallback look richer
// here than it is on a real node and put the one path where the classifier
// loses its contradiction signals beyond anything a suite could observe.
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
    },
  });
});

// Arbitrary bytes a node can fetch over real HTTP. The restore suites need an
// archive that actually arrives down the wire from inside the subnet, because
// the whole remote path - the download, the content-length comparison, the file
// landing in backup/remote - has no other way to be exercised.
const artifacts = new Map();

// HEAD is answered separately because the size a downloader is PROMISED and the
// bytes it actually receives have to be able to disagree - that disagreement is
// the whole subject of the short-download check, and FluxOS learns the promise
// from a HEAD (IOUtils.getRemoteFileSize).
app.head('/artifact/:name', (req, res) => {
  const artifact = artifacts.get(req.params.name);
  if (!artifact) return res.status(404).end();
  res.setHeader('content-type', 'application/gzip');
  res.setHeader('content-length', String(artifact.declaredLength ?? artifact.body.length));
  return res.end();
});

app.get('/artifact/:name', (req, res) => {
  const artifact = artifacts.get(req.params.name);
  if (!artifact) return res.status(404).json({ error: 'no such artifact' });
  res.setHeader('content-type', 'application/gzip');
  if (artifact.declaredLength == null) {
    res.setHeader('content-length', String(artifact.body.length));
    return res.end(artifact.body);
  }
  // With a declared length the body is sent chunked and the connection closes
  // cleanly: the transfer SUCCEEDS and the file on disk is simply shorter than
  // HEAD promised, which is the case the received-vs-expected comparison exists
  // for. Sending a content-length that contradicts the body instead leaves the
  // client waiting for bytes that never come - that is a timeout, not a short
  // download, and it takes the suite's whole budget to find out.
  return res.end(artifact.body);
});

// --- Control API ---

const control = express();
control.use(express.json());

control.get('/state', (req, res) => {
  // the wire artifact is opaque bytes; its size, its claimed row count and the
  // per-route fetch counters (ipLocationFetches) are the readable parts
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
  // Adding { pad: false } publishes the binary WITHOUT the filler rows, i.e.
  // below the reader's truncation floor - floor bait, and the only artifact
  // here a healthy node is expected to refuse.
  // Whichever it is, both /iplocation.json and /iplocation.bin.gz follow it,
  // and the fetch counters start again from zero.
  const pad = req.body.pad !== false;
  let regions = null; // a caller-supplied artifact has no assignment to report
  if (Object.prototype.hasOwnProperty.call(req.body, 'artifact')) {
    serveIpLocation(req.body.artifact, { pad });
  } else {
    const domains = req.body.domains ?? 1;
    const withRegions = req.body.regions === true;
    // { classes: { 0: 'residential' } } publishes a verdict for organisation 0.
    // Absent, the artifact carries no orgClasses section, so every node falls
    // back to deciding its own address - which is what the reader does with a
    // build that classified nothing.
    serveIpLocation(
      buildIpLocationArtifact(domains, req.body.subnet, withRegions, req.body.classes ?? null),
      { pad },
    );
    regions = regionAssignment(domains, withRegions);
  }
  res.json({
    ok: true,
    ranges: state.ipLocation?.v4?.length ?? 0,
    // what the served binary's header claims, filler included - null when the
    // bytes are not a format-2 artifact
    rowCount: state.ipLocationRowCount,
    padded: pad,
    bytes: state.ipLocationBinary?.length ?? 0,
    regions,
    orgClasses: state.ipLocation?.orgClasses ?? null,
  });
});

control.post('/artifact', (req, res) => {
  const { name, base64, declaredLength = null } = req.body || {};
  if (!name || typeof base64 !== 'string') {
    return res.status(400).json({ error: 'name and base64 are required' });
  }
  const body = Buffer.from(base64, 'base64');
  artifacts.set(name, { body, declaredLength });
  return res.json({ ok: true, name, bytes: body.length, declaredLength });
});

control.post('/reset', (req, res) => {
  state.blockedRepositories = [];
  state.vettedRepositories = [];
  state.whitelistedRepositories = [];
  state.tamperingBlocklist = [];
  state.latestRelease = { tag_name: 'v0.0.0', name: 'stub-release' };
  state.geolocation = {};
  artifacts.clear();
  serveIpLocation(buildIpLocationArtifact(1));
  res.json({ ok: true });
});

control.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Every name a node asked for that nothing on the fleet could answer, with the
// node that asked. A suite asserts this is empty; when it is not, the failure
// names the host and the node instead of describing itself as slow.
control.get('/dns-attempts', (req, res) => {
  res.json({ attempts: dnsAttempts });
});

control.post('/dns-attempts/reset', (req, res) => {
  dnsAttempts.length = 0;
  res.json({ ok: true });
});

// The fleet's resolver.
//
// Blocking a network is not the same as failing loudly on it: a blocked packet
// surfaces as a timeout, and a timeout reads as slowness rather than as a node
// reaching somewhere it should not. So the nodes resolve here instead, and a name
// the fleet cannot answer comes back NXDOMAIN at once, recorded against the node
// that asked for it.
//
// Fleet names still resolve, because this relays to its own embedded Docker
// resolver at 127.0.0.11 - the same one that knows every container alias on this
// network. Relaying rather than answering means aliases need no list here and
// cannot drift from the ones the runner actually creates.
const dnsAttempts = [];

function questionName(query) {
  // QNAME begins after the 12-byte header, as length-prefixed labels ending in 0.
  let offset = 12;
  const labels = [];
  while (offset < query.length) {
    const len = query[offset];
    if (len === 0 || len > 63) break;
    labels.push(query.subarray(offset + 1, offset + 1 + len).toString('ascii'));
    offset += len + 1;
  }
  return labels.join('.');
}

function startResolver() {
  const server = dgram.createSocket('udp4');

  server.on('message', (query, rinfo) => {
    const name = questionName(query);
    const upstream = dgram.createSocket('udp4');
    let settled = false;

    const answer = (response, resolved) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // answer() also runs as the upstream's own error handler, and close()
      // throws on a socket that never bound - from inside an error handler
      // nothing catches, so one unlucky query would take the resolver down for
      // the whole run. An uncloseable socket is left to the garbage collector.
      try {
        upstream.close();
      } catch {
        // nothing to close
      }
      if (!resolved) dnsAttempts.push({ name, node: rinfo.address, at: new Date().toISOString() });
      server.send(response, rinfo.port, rinfo.address);
    };

    // NXDOMAIN built from the query: same id and question, QR and RCODE 3 set.
    const refuse = () => {
      const response = Buffer.from(query);
      response[2] |= 0x80;
      response[3] = (response[3] & 0xf0) | 0x03;
      answer(response, false);
    };

    // Short, because this is the whole point: an unanswerable name must fail now
    // rather than at whatever deadline the caller happens to carry.
    const timer = setTimeout(refuse, 300);

    upstream.on('error', refuse);
    upstream.on('message', (response) => {
      const rcode = response[3] & 0x0f;
      if (rcode === 0) answer(response, true);
      else refuse();
    });

    upstream.send(query, 53, '127.0.0.11');
  });

  // A dgram socket with no 'error' listener turns any failure into an uncaught
  // exception. The failure that actually happens is the bind - port 53 already
  // held, usually by the previous run's container on its way out - and without a
  // listener the stub dies on a stack trace that mentions neither DNS nor the
  // port, while every node in the fleet silently fails to resolve anything. That
  // reads as a fleet-wide product fault and is nothing of the kind.
  //
  // Fatal on purpose: a resolver that never bound is not a resolver, and the run
  // should say so at startup rather than eighty suites later. Errors after the
  // bind cost one query and are logged, which this handler covers for free.
  let bound = false;
  server.on('error', (error) => {
    if (!bound) {
      console.error(`External HTTP stub resolver could not bind to 53: ${error.message}`);
      process.exit(1);
    }
    console.error(`External HTTP stub resolver socket error: ${error.message}`);
  });

  server.bind(53, () => {
    bound = true;
    console.log('External HTTP stub resolver on port 53');
  });
}

startResolver();

app.listen(PORT, () => {
  console.log(`External HTTP stub listening on port ${PORT}`);
});

control.listen(CONTROL_PORT, () => {
  console.log(`External HTTP stub control API on port ${CONTROL_PORT}`);
});
