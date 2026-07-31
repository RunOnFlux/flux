// Mongo-backed store for the IP location baseline published in
// RunOnFlux/fluxos-network-policy (iplocation.bin.gz, format 2).
//
// The table maps every allocated IPv4 range to the organisation that holds it,
// the registry allocation block it belongs to, and where it is located
// (DB-IP City Lite country and region over RIR allocation boundaries). It is
// the input that makes placement fault domains computable locally - see
// placementFeasibility.
//
// The rows live in mongo, not in the process: two million ranges cost more
// resident memory than a node can spare, and the covering-row query answers in
// well under a millisecond. Ingest builds a fresh collection and swaps it in
// with a single rename, so a reader sees either the whole previous table or the
// whole new one, never a partial one.
//
// Decompressed artifact layout, integers little-endian:
//   0  6  magic 'FLXGEO'
//   6  1  format version, 0x02
//   7  4  u32 header length
//   11 -  header, UTF-8 JSON: generated, sources, countries, continents, orgs, regions
//   -  4  u32 row count
//   -  -  rows, each five unsigned LEB128 varints:
//          gap (start - prevEnd - 1, prevEnd = -1 before the first row),
//          len (end - start), org/cc/region (index + 1, 0 = none)
//
// This module holds no fetch logic. The artifact arrives via setArtifact() from
// whatever distribution layer feeds it; absence of a table is a valid state
// every consumer must handle.

const zlib = require('node:zlib');
const util = require('node:util');
const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const cidrUtils = require('../utils/cidrUtils');

const gunzip = util.promisify(zlib.gunzip);

const MAGIC = 'FLXGEO';
const SUPPORTED_VERSION = 2;
// magic(6) + version(1) + u32 header length
const HEADER_OFFSET = 11;
const IPV4_MAX = 0xffffffff;
// A structurally valid but truncated generation must not replace a good table.
const MIN_ROW_COUNT = 1500000;
const INSERT_BATCH_SIZE = 10000;
const MAX_BATCHES_IN_FLIGHT = 4;
// Bounds what one artifact string can cost in a document. Not a vocabulary
// check - the vocabularies are the publisher's, and rejecting a token this
// build has not seen would take the whole fleet's table down with it.
const MAX_TOKEN_LENGTH = 64;
// A u32 needs at most five LEB128 bytes; every field of a row is a u32.
const MAX_VARINT_BYTES = 5;
const STORE_UNAVAILABLE = 'IPLOCATION_STORE_UNAVAILABLE';

const ipRangesCollection = config.database.local.collections.ipRanges;
const ipRangesNextCollection = `${ipRangesCollection}_next`;

let status = { ready: false, generated: null, rowCount: 0 };
let minimumRowCount = MIN_ROW_COUNT;

/**
 * An artifact this build refuses. The caller keeps whatever it already holds.
 * @param {string} message What is wrong with the bytes
 * @returns {Error}
 */
function malformed(message) {
  return new Error(`iplocation artifact: ${message}`);
}

/**
 * The store could not be reached. Tagged so a caller can tell "the table could
 * not be read" from "no row covers this address" - see lookup().
 * @param {string} message Underlying reason
 * @returns {Error}
 */
function unavailable(message) {
  const error = new Error(`iplocation store unavailable: ${message}`);
  error.code = STORE_UNAVAILABLE;
  return error;
}

/**
 * Whether an error means the store could not be read.
 * @param {Error} error Any error
 * @returns {boolean}
 */
function isStoreUnavailable(error) {
  return error?.code === STORE_UNAVAILABLE;
}

/**
 * The local apps database, or null when mongo is not connected.
 * @returns {object|null}
 */
function db() {
  const connection = dbHelper.databaseConnection();
  return connection ? connection.db(config.database.local.database) : null;
}

/**
 * Read one unsigned LEB128 varint and advance the cursor. Arithmetic rather
 * than shifts: a u32 does not survive JavaScript's 32-bit signed shift.
 * @param {Buffer} buf Decompressed artifact
 * @param {{offset: number}} cursor Read position, advanced in place
 * @returns {number}
 */
function readVarint(buf, cursor) {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < MAX_VARINT_BYTES; i += 1) {
    if (cursor.offset >= buf.length) throw malformed('row stream ends mid-value');
    const byte = buf[cursor.offset];
    cursor.offset += 1;
    value += (byte % 128) * scale;
    if (byte < 128) {
      if (value > IPV4_MAX) throw malformed('varint wider than 32 bits');
      return value;
    }
    scale *= 128;
  }
  throw malformed('varint wider than 32 bits');
}

/**
 * Check one header vocabulary: a list of non-empty bounded strings.
 * @param {*} list Candidate section
 * @param {string} name Section name, for the error
 * @returns {string[]}
 */
function assertTokenList(list, name) {
  if (!Array.isArray(list)) throw malformed(`header section ${name} is missing`);
  list.forEach((token, i) => {
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
      throw malformed(`header ${name}[${i}] is not a token`);
    }
  });
  return list;
}

/**
 * Read and check the fixed prefix, the header JSON and the row count.
 * @param {Buffer} buf Decompressed artifact
 * @returns {{header: object, continents: Map<string, string>, rowCount: number, rowsOffset: number}}
 */
function parseHeader(buf) {
  if (buf.length < HEADER_OFFSET) throw malformed('shorter than the fixed header');
  if (buf.toString('latin1', 0, MAGIC.length) !== MAGIC) throw malformed('bad magic');
  if (buf[6] !== SUPPORTED_VERSION) throw malformed(`unsupported format version ${buf[6]}`);
  const headerLength = buf.readUInt32LE(7);
  const rowCountOffset = HEADER_OFFSET + headerLength;
  // the u32 row count sits immediately after the header
  if (rowCountOffset + 4 > buf.length) throw malformed('truncated header');
  let header;
  try {
    header = JSON.parse(buf.toString('utf8', HEADER_OFFSET, rowCountOffset));
  } catch (error) {
    throw malformed(`header is not valid JSON: ${error.message}`);
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw malformed('header is not an object');
  }
  if (typeof header.generated !== 'string' || !header.generated
    || header.generated.length > MAX_TOKEN_LENGTH) {
    throw malformed('header section generated is missing');
  }
  if (!header.sources || typeof header.sources !== 'object' || Array.isArray(header.sources)) {
    throw malformed('header section sources is missing');
  }
  if (!header.continents || typeof header.continents !== 'object' || Array.isArray(header.continents)) {
    throw malformed('header section continents is missing');
  }
  assertTokenList(header.countries, 'countries');
  assertTokenList(header.orgs, 'orgs');
  assertTokenList(header.regions, 'regions');
  const continentEntries = Object.entries(header.continents);
  continentEntries.forEach(([country, continent]) => {
    if (typeof continent !== 'string' || !continent || continent.length > MAX_TOKEN_LENGTH) {
      throw malformed(`header continents.${country} is not a token`);
    }
  });
  return {
    header,
    // a Map, so a country named after an Object.prototype member reads as itself
    continents: new Map(continentEntries),
    rowCount: buf.readUInt32LE(rowCountOffset),
    rowsOffset: rowCountOffset + 4,
  };
}

/**
 * Walk the row stream, checking every row, and hand the caller completed
 * batches of documents. With no callback nothing is materialised - that is the
 * validation pass, which must complete before the first write so a malformed
 * artifact never touches the database.
 * @param {Buffer} buf Decompressed artifact
 * @param {object} parsed parseHeader() result
 * @param {(docs: Array<object>) => Promise<void>} [onBatch] Batch sink
 */
async function walkRows(buf, parsed, onBatch) {
  const { header, continents, rowCount, rowsOffset } = parsed;
  const cursor = { offset: rowsOffset };
  let previousEnd = -1;
  let batch = onBatch ? [] : null;
  for (let i = 0; i < rowCount; i += 1) {
    const gap = readVarint(buf, cursor);
    const len = readVarint(buf, cursor);
    const org = readVarint(buf, cursor);
    const cc = readVarint(buf, cursor);
    const region = readVarint(buf, cursor);
    const start = previousEnd + 1 + gap;
    const end = start + len;
    // Rows are sorted and non-overlapping by construction - a gap is unsigned,
    // so a row that starts at or before the previous end is unrepresentable and
    // shows up here as a range walking off the end of the address space.
    if (end > IPV4_MAX) throw malformed(`row ${i} runs past the IPv4 address space`);
    if (org > header.orgs.length) throw malformed(`org index out of range at row ${i}`);
    if (cc > header.countries.length) throw malformed(`country index out of range at row ${i}`);
    if (region > header.regions.length) throw malformed(`region index out of range at row ${i}`);
    previousEnd = end;
    if (batch) {
      const countryCode = cc === 0 ? null : header.countries[cc - 1];
      batch.push({
        _id: start,
        e: end,
        o: org === 0 ? null : header.orgs[org - 1],
        c: countryCode,
        // denormalised at ingest so eligibility never joins
        n: countryCode === null ? null : (continents.get(countryCode) ?? null),
        r: region === 0 ? null : header.regions[region - 1],
      });
      if (batch.length === INSERT_BATCH_SIZE) {
        // eslint-disable-next-line no-await-in-loop
        await onBatch(batch);
        batch = [];
      }
    }
  }
  if (cursor.offset !== buf.length) throw malformed('row count disagrees with the byte stream');
  if (batch && batch.length) await onBatch(batch);
}

/**
 * Whether a mongo error only means the collection was not there.
 * @param {Error} error Driver error
 * @returns {boolean}
 */
function isNamespaceMissing(error) {
  return error?.codeName === 'NamespaceNotFound' || error?.code === 26
    || /ns not found/i.test(error?.message ?? '');
}

/**
 * Drop the staging collection a previous attempt may have left behind.
 * @param {object} database Local apps database
 */
async function dropStagingCollection(database) {
  try {
    await dbHelper.dropCollection(database, ipRangesNextCollection);
  } catch (error) {
    if (!isNamespaceMissing(error)) throw error;
  }
}

/**
 * Fill the staging collection, keeping a bounded number of batches in flight.
 * Any failed batch fails the ingest: the live collection is not involved, so
 * the previous table stays whole.
 * @param {Buffer} buf Decompressed artifact
 * @param {object} parsed parseHeader() result
 * @param {object} database Local apps database
 */
async function fillStagingCollection(buf, parsed, database) {
  const inFlight = new Set();
  let failure = null;
  const track = (promise) => {
    // the failure is captured here rather than at the await site, so a batch
    // that fails while others are still running never surfaces as an unhandled
    // rejection - the waiters below only ever see settled promises
    const tracked = promise
      .catch((error) => { failure = failure ?? error; })
      .finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
  };

  try {
    await walkRows(buf, parsed, async (docs) => {
      if (failure) throw failure;
      if (inFlight.size >= MAX_BATCHES_IN_FLIGHT) await Promise.race(inFlight);
      if (failure) throw failure;
      // dbHelper.insertManyToDatabase reports a duplicate key as success; the
      // count check turns it back into the ingest failure it is.
      track(dbHelper.insertManyToDatabase(database, ipRangesNextCollection, docs, { ordered: false })
        .then((result) => {
          if (result?.insertedCount !== docs.length) {
            throw new Error(`batch inserted ${result?.insertedCount ?? 0} of ${docs.length} rows`);
          }
        }));
    });
  } finally {
    // no write outlives this call, so a rejected ingest is finished writing by
    // the time the caller sees it
    await Promise.all(inFlight);
  }
  if (failure) throw failure;
}

/**
 * Install a new baseline: validate the artifact end to end, build a fresh
 * collection, then swap it in with one rename. Throws - and leaves both the
 * live collection and the reported status exactly as they were - on a
 * malformed artifact or on any database failure.
 * @param {Buffer} bytes The gzipped artifact
 * @returns {Promise<{generated: string, rowCount: number}>}
 */
async function setArtifact(bytes) {
  if (!Buffer.isBuffer(bytes)) throw malformed('artifact bytes are not a buffer');
  let buf;
  try {
    buf = await gunzip(bytes);
  } catch (error) {
    throw malformed(`not a gzip stream: ${error.message}`);
  }
  const parsed = parseHeader(buf);
  if (parsed.rowCount < minimumRowCount) {
    throw malformed(`row count ${parsed.rowCount} is below the truncation floor ${minimumRowCount}`);
  }
  await walkRows(buf, parsed);

  const database = db();
  if (!database) throw unavailable('no database connection');
  await dropStagingCollection(database);
  await fillStagingCollection(buf, parsed, database);
  await database.renameCollection(ipRangesNextCollection, ipRangesCollection, { dropTarget: true });

  status = { ready: true, generated: parsed.header.generated, rowCount: parsed.rowCount };
  log.info(`ipLocationStore - baseline installed: ${parsed.rowCount} ranges, generated ${parsed.header.generated}`);
  return { generated: status.generated, rowCount: status.rowCount };
}

/**
 * Locate an IP in the stored table.
 *
 * Resolves null when the address does not parse, is not IPv4 (the table is
 * IPv4 only - no Flux node holds a v6 address), or no row covers it. Rejects
 * with a store-unavailable error - isStoreUnavailable(error) - when mongo
 * could not answer: callers must treat that exactly like "no table" and fall
 * back to /16 arithmetic, never like "no covering row".
 * @param {string} ip Bare IP address (no port)
 * @returns {Promise<{org: string|null, block: {start: number, end: number}|null,
 *   countryCode: string|null, continentCode: string|null, region: string|null} | null>}
 */
async function lookup(ip) {
  const parsed = cidrUtils.parseIp(ip);
  if (!parsed || parsed.version !== 4) return null;
  const needle = Number(parsed.value);
  const database = db();
  if (!database) throw unavailable('no database connection');
  let rows;
  try {
    rows = await dbHelper.findInDatabase(
      database,
      ipRangesCollection,
      { _id: { $lte: needle } },
      { sort: { _id: -1 }, limit: 1 },
    );
  } catch (error) {
    throw unavailable(error.message);
  }
  const row = rows?.[0];
  if (!row || !Number.isInteger(row.e) || row.e < needle) return null;
  const org = row.o ?? null;
  return {
    org,
    // no allocation means no block rung: the /16 rung applies instead
    block: org === null ? null : { start: row._id, end: row.e },
    countryCode: row.c ?? null,
    continentCode: row.n ?? null,
    region: row.r ?? null,
  };
}

/**
 * What this process holds, from memory - never a database call.
 * @returns {{ready: boolean, generated: string|null, rowCount: number}}
 */
function currentStatus() {
  return { ...status };
}

/**
 * Forget the installed baseline and restore the production row floor. Test
 * support; the stored collection is untouched.
 */
function clear() {
  status = { ready: false, generated: null, rowCount: 0 };
  minimumRowCount = MIN_ROW_COUNT;
}

/**
 * Lower the truncation floor so a fixture need not carry a real baseline's
 * worth of rows. Test support - clear() restores MIN_ROW_COUNT.
 * @param {number} rows Minimum accepted row count
 */
function setMinimumRowCount(rows) {
  if (!Number.isInteger(rows) || rows < 1) throw new Error('ipLocationStore: row floor must be a positive integer');
  minimumRowCount = rows;
}

module.exports = {
  setArtifact,
  lookup,
  status: currentStatus,
  clear,
  setMinimumRowCount,
  isStoreUnavailable,
  MIN_ROW_COUNT,
  STORE_UNAVAILABLE,
};
