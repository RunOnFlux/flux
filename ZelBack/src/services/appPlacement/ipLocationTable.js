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
 * Validate one row list and convert it to columnar form, verifying sort order
 * and non-overlap. Bounds are Uint32Array for v4 and plain BigInt arrays for
 * v6; the org/cc/region indexes are Int32Array with -1 for "none". Typed
 * columns keep the resident footprint at a few MB where boxed values cost
 * tens - this table lives in every node's memory for the process lifetime.
 * @param {Array} rows Raw artifact rows
 * @param {6|4} version IP version of the rows
 * @param {object} artifact The full artifact, for index bounds
 * @returns {object} Columnar representation
 */
function buildColumns(rows, version, artifact) {
  const starts = version === 4 ? new Uint32Array(rows.length) : [];
  const ends = version === 4 ? new Uint32Array(rows.length) : [];
  const orgIdx = new Int32Array(rows.length);
  const ccIdx = new Int32Array(rows.length);
  const regionIdx = new Int32Array(rows.length);
  let previousEnd = -1n;
  rows.forEach((row, i) => {
    if (!Array.isArray(row) || row.length < 4) {
      throw new Error(`iplocation artifact: malformed v${version} row ${i}`);
    }
    let start;
    let end;
    if (version === 4) {
      if (!Number.isInteger(row[0]) || !Number.isInteger(row[1]) || row[0] < 0 || row[1] > 0xFFFFFFFF) {
        throw new Error(`iplocation artifact: invalid v4 bounds at row ${i}`);
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
    if (version === 4) {
      starts[i] = row[0];
      ends[i] = row[1];
    } else {
      starts.push(start);
      ends.push(end);
    }
    orgIdx[i] = org ?? -1;
    ccIdx[i] = cc ?? -1;
    regionIdx[i] = region ?? -1;
  });
  return { starts, ends, orgIdx, ccIdx, regionIdx, version };
}

/**
 * The org list is stored as one UTF-8 buffer plus offsets rather than an array
 * of strings: a hundred thousand tiny string objects cost megabytes of heap
 * where the buffer form costs well under one. Tokens decode on demand for log
 * lines and API responses.
 * @param {string[]} orgs Artifact org tokens
 * @returns {{orgBlob: Buffer, orgOffsets: Uint32Array}}
 */
function orgColumns(orgs) {
  const parts = orgs.map((org) => Buffer.from(org, 'utf8'));
  const orgOffsets = new Uint32Array(parts.length + 1);
  parts.forEach((part, i) => { orgOffsets[i + 1] = orgOffsets[i] + part.length; });
  return { orgBlob: Buffer.concat(parts), orgOffsets };
}

/**
 * Decode one org token from the loaded table's buffer.
 * @param {number} i Org index
 * @returns {string}
 */
function orgAt(i) {
  return table.orgBlob.toString('utf8', table.orgOffsets[i], table.orgOffsets[i + 1]);
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
    ...orgColumns(artifact.orgs),
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
 * Continent code for an ISO 3166-1 country code, from the loaded table's
 * country -> continent map.
 * @param {string} countryCode ISO 3166-1 alpha-2 code
 * @returns {string | null} null when no table is loaded or the country is unknown
 */
function continentForCountry(countryCode) {
  if (!table) return null;
  return table.continents[countryCode] ?? null;
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
  const needle = parsed.version === 4 ? Number(parsed.value) : parsed.value;
  const { starts, ends } = columns;
  let lo = 0;
  let hi = starts.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1; // eslint-disable-line no-bitwise
    if (starts[mid] <= needle) {
      hit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (hit === -1 || ends[hit] < needle) return null;
  const cc = columns.ccIdx[hit] >= 0 ? table.countries[columns.ccIdx[hit]] : null;
  return {
    org: columns.orgIdx[hit] >= 0 ? orgAt(columns.orgIdx[hit]) : null,
    block: `${cidrUtils.formatIp(BigInt(starts[hit]), parsed.version)}-${cidrUtils.formatIp(BigInt(ends[hit]), parsed.version)}`,
    countryCode: cc,
    continentCode: cc !== null ? (table.continents[cc] ?? null) : null,
    region: columns.regionIdx[hit] >= 0 ? table.regions[columns.regionIdx[hit]] : null,
  };
}

module.exports = {
  setArtifact,
  hasTable,
  tableInfo,
  clear,
  continentForCountry,
  lookup,
};
