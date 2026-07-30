// In-memory reader for the IP location table published in
// RunOnFlux/fluxos-network-policy (iplocation.json, format 1).
//
// The table maps every allocated IP range to the organisation that holds it,
// the registry allocation block it belongs to, and the country it is located
// in (registry data corrected by RFC 8805 geofeeds). It is the input that
// makes placement fault domains computable locally - see placementFeasibility.
//
// This module holds no fetch logic. The artifact arrives via setArtifact()
// from whatever distribution layer feeds it (the policy store); absence of a
// table is a valid state every consumer must handle.
//
// Artifact shape (format 1):
// {
//   format: 1,
//   generated: ISO timestamp,
//   sources: { <registry>: serial, ... },
//   countries: ['BH', ...],                 ISO 3166-1 alpha-2
//   continents: { BH: 'AS', ... },          country -> continent code
//   orgs: ['ripencc:<opaque-id>', ...],     registry-scoped organisation ids
//   regions: ['FI-18', ...],                ISO 3166-2, geofeed-supplied
//   v4: [[startInt, endInt, orgIdx|null, ccIdx|null, regionIdx?], ...],
//   v6: [[startIp, endIp, orgIdx|null, ccIdx|null, regionIdx?], ...],
// }
// Rows are sorted by start and never overlap; v6 range bounds are IP strings.

const log = require('../../lib/log');
const cidrUtils = require('../utils/cidrUtils');

const SUPPORTED_FORMAT = 1;

let table = null;

/**
 * Validate one row list and convert it to {starts, ends, orgIdx, ccIdx, regionIdx}
 * columnar form with BigInt bounds, verifying sort order and non-overlap.
 * @param {Array} rows Raw artifact rows
 * @param {6|4} version IP version of the rows
 * @param {object} artifact The full artifact, for index bounds
 * @returns {object} Columnar representation
 */
function buildColumns(rows, version, artifact) {
  const starts = [];
  const ends = [];
  const orgIdx = [];
  const ccIdx = [];
  const regionIdx = [];
  let previousEnd = -1n;
  rows.forEach((row, i) => {
    if (!Array.isArray(row) || row.length < 4) {
      throw new Error(`iplocation artifact: malformed v${version} row ${i}`);
    }
    let start;
    let end;
    if (version === 4) {
      if (!Number.isInteger(row[0]) || !Number.isInteger(row[1])) {
        throw new Error(`iplocation artifact: non-integer v4 bounds at row ${i}`);
      }
      start = BigInt(row[0]);
      end = BigInt(row[1]);
    } else {
      start = cidrUtils.parseIp(row[0])?.value;
      end = cidrUtils.parseIp(row[1])?.value;
      if (start === undefined || end === undefined) {
        throw new Error(`iplocation artifact: unparseable v6 bounds at row ${i}`);
      }
    }
    if (end < start || start <= previousEnd) {
      throw new Error(`iplocation artifact: v${version} rows unsorted or overlapping at row ${i}`);
    }
    previousEnd = end;
    const org = row[2];
    const cc = row[3];
    const region = row.length >= 5 ? row[4] : null;
    if (org !== null && (!Number.isInteger(org) || org < 0 || org >= artifact.orgs.length)) {
      throw new Error(`iplocation artifact: org index out of range at v${version} row ${i}`);
    }
    if (cc !== null && (!Number.isInteger(cc) || cc < 0 || cc >= artifact.countries.length)) {
      throw new Error(`iplocation artifact: country index out of range at v${version} row ${i}`);
    }
    if (region !== null && (!Number.isInteger(region) || region < 0 || region >= (artifact.regions ?? []).length)) {
      throw new Error(`iplocation artifact: region index out of range at v${version} row ${i}`);
    }
    starts.push(start);
    ends.push(end);
    orgIdx.push(org);
    ccIdx.push(cc);
    regionIdx.push(region);
  });
  return { starts, ends, orgIdx, ccIdx, regionIdx, version };
}

/**
 * Install a new table artifact, replacing any previous one.
 * Throws on a malformed artifact and leaves the previous table in place.
 * @param {object|string|Buffer} rawArtifact Parsed artifact object, or its JSON text
 */
function setArtifact(rawArtifact) {
  const artifact = (typeof rawArtifact === 'string' || Buffer.isBuffer(rawArtifact))
    ? JSON.parse(rawArtifact.toString())
    : rawArtifact;
  if (!artifact || artifact.format !== SUPPORTED_FORMAT) {
    throw new Error(`iplocation artifact: unsupported format ${artifact?.format}`);
  }
  if (!Array.isArray(artifact.countries) || !Array.isArray(artifact.orgs)
    || !Array.isArray(artifact.v4) || !Array.isArray(artifact.v6)
    || typeof artifact.continents !== 'object' || artifact.continents === null) {
    throw new Error('iplocation artifact: missing required sections');
  }
  const next = {
    generated: artifact.generated ?? null,
    sources: artifact.sources ?? {},
    countries: artifact.countries,
    continents: artifact.continents,
    orgs: artifact.orgs,
    regions: artifact.regions ?? [],
    v4: buildColumns(artifact.v4, 4, artifact),
    v6: buildColumns(artifact.v6, 6, artifact),
  };
  table = next;
  log.info(`iplocation table loaded: ${next.v4.starts.length} v4 + ${next.v6.starts.length} v6 ranges, generated ${next.generated}`);
}

/**
 * Whether a table is currently loaded.
 * @returns {boolean}
 */
function hasTable() {
  return table !== null;
}

/**
 * Metadata of the loaded table, for diagnostics and API responses.
 * @returns {{generated: string|null, sources: object, v4Ranges: number, v6Ranges: number} | null}
 */
function tableInfo() {
  if (!table) return null;
  return {
    generated: table.generated,
    sources: table.sources,
    v4Ranges: table.v4.starts.length,
    v6Ranges: table.v6.starts.length,
  };
}

/**
 * Drop the loaded table. Test support.
 */
function clear() {
  table = null;
}

/**
 * Locate an IP in the table.
 * @param {string} ip Bare IP address (no port)
 * @returns {{org: string|null, block: string, countryCode: string|null,
 *   continentCode: string|null, region: string|null} | null}
 *   null when no table is loaded, the IP does not parse, or no range covers it
 */
function lookup(ip) {
  if (!table) return null;
  const parsed = cidrUtils.parseIp(ip);
  if (!parsed) return null;
  const columns = parsed.version === 4 ? table.v4 : table.v6;
  const { starts, ends } = columns;
  let lo = 0;
  let hi = starts.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1; // eslint-disable-line no-bitwise
    if (starts[mid] <= parsed.value) {
      hit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (hit === -1 || ends[hit] < parsed.value) return null;
  const cc = columns.ccIdx[hit] !== null ? table.countries[columns.ccIdx[hit]] : null;
  return {
    org: columns.orgIdx[hit] !== null ? table.orgs[columns.orgIdx[hit]] : null,
    block: `${cidrUtils.formatIp(starts[hit], parsed.version)}-${cidrUtils.formatIp(ends[hit], parsed.version)}`,
    countryCode: cc,
    continentCode: cc !== null ? (table.continents[cc] ?? null) : null,
    region: columns.regionIdx[hit] !== null ? table.regions[columns.regionIdx[hit]] : null,
  };
}

module.exports = {
  setArtifact,
  hasTable,
  tableInfo,
  clear,
  lookup,
};
