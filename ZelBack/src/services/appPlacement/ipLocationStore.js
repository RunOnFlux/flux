// Mongo-backed store for the IP location baseline published in
// RunOnFlux/fluxos-network-policy (iplocation.bin.gz, format 2).
//
// The table maps every allocated IPv4 range to the organisation that holds it
// and where it is located (DB-IP City Lite country and region over RIR
// allocation boundaries). A range with no organisation carries no fault domain
// of its own and falls to the /16 rung placement computes. It is the input that
// makes placement fault domains computable locally - see placementFeasibility.
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
//
// Two things outlive the process alongside the rows: an ingest marker naming
// the baseline the collection holds, so a boot adopts it instead of re-ingesting
// the same two million rows, and the per-node view (nodelocations) placement
// reads in one query rather than a lookup per node.

const zlib = require('node:zlib');
const util = require('node:util');
const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const cidrUtils = require('../utils/cidrUtils');
const { bareIp } = require('../utils/socketAddressUtils');

const gunzip = util.promisify(zlib.gunzip);

// Hand the thread back so queued I/O and timers run. setImmediate, not a
// resolved promise: a promise only drains microtasks, which is the same thread
// with extra steps.
const yieldToEventLoop = () => new Promise((resolve) => { setImmediate(resolve); });

const MAGIC = 'FLXGEO';
const SUPPORTED_VERSION = 2;
// magic(6) + version(1) + u32 header length
const HEADER_OFFSET = 11;
const IPV4_MAX = 0xffffffff;
// A structurally valid but truncated generation must not replace a good
// table. A fleet-integrity invariant, deliberately NOT configuration: a knob
// would let a single node (or a config-generation defect) switch the
// protection off. The harness publishes padded real-scale artifacts instead.
const MIN_ROW_COUNT = 1500000;
const INSERT_BATCH_SIZE = 10000;
const MAX_BATCHES_IN_FLIGHT = 4;
// Rows decoded between handing the thread back. Small enough that no single
// stretch is noticeable (a few milliseconds), large enough that two million rows
// cost a couple of hundred yields rather than one per row.
const ROWS_PER_YIELD = 10000;
// Bounds what one artifact string can cost in a document. Not a vocabulary
// check - the vocabularies are the publisher's, and rejecting a token this
// build has not seen would take the whole fleet's table down with it.
const MAX_TOKEN_LENGTH = 64;
// A u32 needs at most five LEB128 bytes; every field of a row is a u32.
const MAX_VARINT_BYTES = 5;
const STORE_UNAVAILABLE = 'IPLOCATION_STORE_UNAVAILABLE';
// The marker shares policyDocuments with the artifact record, under its own id.
const INGEST_MARKER_ID = 'ipLocationTableIngest';
// A point lookup costs well under a millisecond; eight in flight fill a fleet's
// worth of node locations in about a second without crowding the API's queries.
const NODE_LOOKUP_CONCURRENCY = 8;

const ipRangesCollection = config.database.local.collections.ipRanges;
const ipRangesNextCollection = `${ipRangesCollection}_next`;
const nodeLocationsCollection = config.database.local.collections.nodeLocations;
const policyDocumentsCollection = config.database.local.collections.policyDocuments;

let status = { ready: false, generated: null, rowCount: 0 };
// country -> continent, from the header of whatever baseline this node holds
let continentByCountry = new Map();
// '<CC>|<region name>' -> ISO 3166-2, from the same header. The rows carry
// codes, while an app's geolocation may name a region the way ip-api does, and
// this is what connects the two.
let regionCodeByName = new Map();
let minimumRowCount = MIN_ROW_COUNT;
// The per-node view, resident. It is a decoration on the node list - one small
// fact per listed address - and the node list lives in this process, so keeping
// the view beside it removes both the per-computation read and the need to keep
// a collection in step with a list. Mongo still holds it, for restarts.
// Replaced whole on refresh, never mutated: see nodeLocationSnapshot.
let nodeView = new Map();
let nodeViewLoaded = false;

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
  // The region-name vocabulary, keyed '<CC>|<name>'. Optional: a baseline built
  // before it existed carries none, and without it a spec that names a region
  // the way ip-api does is answered at country granularity - the same place a
  // name this vocabulary cannot resolve lands, and the safe direction.
  const regionNameEntries = Object.entries(header.regionNames ?? {});
  if (typeof (header.regionNames ?? {}) !== 'object' || Array.isArray(header.regionNames)) {
    throw malformed('header section regionNames is not an object');
  }
  regionNameEntries.forEach(([key, code]) => {
    if (typeof code !== 'string' || !code || code.length > MAX_TOKEN_LENGTH
      || key.length > MAX_TOKEN_LENGTH * 2) {
      throw malformed(`header regionNames.${key} is not a token`);
    }
  });
  return {
    header,
    // Maps, so a country named after an Object.prototype member reads as itself
    continents: new Map(continentEntries),
    regionNames: new Map(regionNameEntries),
    rowCount: buf.readUInt32LE(rowCountOffset),
    rowsOffset: rowCountOffset + 4,
  };
}

/**
 * Walk the row stream, checking every row, and hand the caller completed
 * batches of documents. With no callback nothing is materialised - that is the
 * validation pass, which must complete before the first write so a malformed
 * artifact never touches the database.
 *
 * The walk gives the thread back every ROWS_PER_YIELD rows. Two million rows of
 * pure decoding is a fifth of a second on a developer machine and longer on a
 * node, and for that whole time the process serves no request, reads no socket
 * and fires no timer. The batch sink is not a substitute: it awaits real I/O
 * only once MAX_BATCHES_IN_FLIGHT writes are outstanding, and awaiting an
 * already-settled promise drains microtasks without letting the event loop run.
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
    if ((i + 1) % ROWS_PER_YIELD === 0) {
      // eslint-disable-next-line no-await-in-loop
      await yieldToEventLoop();
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
 * Record which baseline the live collection holds. Written after the swap, so
 * a marker never names rows that are not there; a failure to write it costs one
 * re-ingest on the next boot and nothing else, which is why it does not fail
 * the ingest.
 * @param {object} database Local apps database
 * @param {object} parsed parseHeader() result
 */
async function writeIngestMarker(database, parsed) {
  await dbHelper.findOneAndUpdateInDatabase(
    database,
    policyDocumentsCollection,
    { _id: INGEST_MARKER_ID },
    {
      $set: {
        generated: parsed.header.generated,
        rowCount: parsed.rowCount,
        // the header's vocabularies, so a boot that adopts the stored table can
        // answer continentForCountry and resolve a region name without holding
        // the artifact
        continents: Object.fromEntries(parsed.continents),
        regionNames: Object.fromEntries(parsed.regionNames),
        ingestedAt: Date.now(),
      },
    },
    { upsert: true },
  ).catch((error) => log.warn(`ipLocationStore - could not record the ingest marker: ${error.message}`));
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
  continentByCountry = parsed.continents;
  regionCodeByName = parsed.regionNames;
  await writeIngestMarker(database, parsed);
  log.info(`ipLocationStore - baseline installed: ${parsed.rowCount} ranges, generated ${parsed.header.generated}`);
  return { generated: status.generated, rowCount: status.rowCount };
}

/**
 * Adopt the baseline this node already holds. The rows survive a restart in
 * mongo, so a boot that finds the marker is already serving the baseline it
 * names - re-ingesting the same artifact would cost two million writes to
 * arrive back exactly here. The marker is written only after the swap, and the
 * swap is atomic, so nothing further needs verifying.
 * @returns {Promise<boolean>} true when a stored ingest was adopted
 */
async function adoptPersistedStatus() {
  const database = db();
  if (!database) return false;
  let marker;
  try {
    marker = await dbHelper.findOneInDatabase(database, policyDocumentsCollection, { _id: INGEST_MARKER_ID });
  } catch (error) {
    log.warn(`ipLocationStore - could not read the ingest marker: ${error.message}`);
    return false;
  }
  if (!marker || typeof marker.generated !== 'string' || !marker.generated) return false;
  status = { ready: true, generated: marker.generated, rowCount: marker.rowCount ?? 0 };
  continentByCountry = new Map(Object.entries(marker.continents ?? {}));
  regionCodeByName = new Map(Object.entries(marker.regionNames ?? {}));
  log.info(`ipLocationStore - adopted the stored baseline: ${status.rowCount} ranges, generated ${status.generated}`);
  return true;
}

/**
 * Continent code for an ISO 3166-1 country code, from the header of the
 * baseline this node holds.
 * @param {string} countryCode ISO 3166-1 alpha-2 code
 * @returns {string | null} null without a table, or when the country is unknown
 */
function continentForCountry(countryCode) {
  if (!status.ready) return null;
  return continentByCountry.get(countryCode) ?? null;
}

/**
 * The ISO 3166-2 code for a region an app named the way ip-api does.
 *
 * A geolocation entry may carry either vocabulary - 'acEU_DE_DE-BY' or
 * 'acEU_DE_Bavaria' - while the rows carry codes alone. Null when this node
 * holds no vocabulary, or the name is not in it: the caller then answers that
 * entry at country granularity, which counts more nodes rather than fewer.
 * @param {string} countryCode ISO 3166-1 alpha-2 code
 * @param {string} regionName The entry's region part
 * @returns {string | null}
 */
function regionCodeForName(countryCode, regionName) {
  if (!status.ready || !countryCode || !regionName) return null;
  return regionCodeByName.get(`${countryCode}|${regionName}`) ?? null;
}

/**
 * The fault-domain key a stored location gives its address: the organisation
 * holding the range. Null when the table names none, which leaves the address on
 * the /16 rung its caller computes. Derived once, when the entry is built.
 *
 * Two rungs, not three. A row's own extent was once keyed between these as the
 * range's "registry allocation block", but the artifact carries no allocation -
 * a row is bounded by whichever of owner, country or region changes first, so
 * its extent is a fragment of an allocation rather than one. It would also be
 * the wrong direction: the median ownerless range is around 512 addresses, so
 * keying on it splits one /16 into up to 128 domains and calls nodes diverse
 * that the /16 rung holds together.
 * @param {{o: string|null}} doc A stored location
 * @returns {string | null}
 */
function domainKeyFor(doc) {
  if (doc.o) return `org:${doc.o}`;
  return null;
}

/**
 * One entry of the per-node view, in the shape its readers use: the fault
 * domain already keyed, and the three location fields eligibility reads.
 * @param {object} doc A stored nodelocations document
 * @returns {{d: string|null, c: string|null, n: string|null, r: string|null, g: string|null}}
 */
function viewEntry(doc) {
  return {
    d: domainKeyFor(doc),
    c: doc.c ?? null,
    n: doc.n ?? null,
    r: doc.r ?? null,
    g: doc.g ?? null,
  };
}

/**
 * Load the stored view into the process. One read, at boot: the rows survive a
 * restart in mongo, and re-deriving them would cost a lookup per node against
 * the range table.
 * @returns {Promise<void>}
 */
async function loadNodeLocationView() {
  const database = db();
  if (!database) throw unavailable('no database connection');
  let docs;
  try {
    docs = await dbHelper.findInDatabase(database, nodeLocationsCollection, {});
  } catch (error) {
    throw unavailable(error.message);
  }
  const loaded = new Map();
  (docs ?? []).forEach((doc) => loaded.set(doc._id, viewEntry(doc)));
  nodeView = loaded;
  nodeViewLoaded = true;
}

/**
 * The per-node location view this process holds.
 *
 * The map is replaced whole on every refresh and never mutated in place, so a
 * caller that takes it once answers every question from one consistent picture
 * of the network - a spawn decision and the share it is measured against can
 * never come from two different views.
 *
 * `ready` is what a caller must gate a location answer on: it means this
 * process holds both a baseline and the view derived from it. Without it the
 * map is empty, every address falls to /16 arithmetic, and that is exactly the
 * posture a node with no table at all is in.
 * @returns {{byIp: Map<string, object>, ready: boolean, generated: string|null}}
 */
function nodeLocationSnapshot() {
  return {
    byIp: nodeView,
    ready: status.ready && nodeViewLoaded,
    generated: status.generated ?? null,
  };
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
 * @returns {Promise<{org: string|null, countryCode: string|null,
 *   continentCode: string|null, region: string|null} | null>}
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
  return {
    org: row.o ?? null,
    countryCode: row.c ?? null,
    continentCode: row.n ?? null,
    region: row.r ?? null,
  };
}

/**
 * Bring the per-node view in line with the node list.
 *
 * The list is what the view is FOR, so it is also what the view is bounded by:
 * an address the list no longer carries is dropped, and an entry derived from
 * an older baseline is re-derived. That leaves the view holding exactly the
 * listed addresses, which is what lets a reader take absence at face value.
 *
 * A lookup that fails leaves that address out, which reads downstream as an
 * unresolved location - the /16 rung - so one failure never fails the pass. The
 * resident view is swapped in at the end, whole: a reader holding the previous
 * one keeps a consistent picture rather than watching this pass rewrite it.
 * @param {Array<{ip: string}>} nodeList The deterministic node list
 * @returns {Promise<{refreshed: number, dropped: number}>}
 */
async function refreshNodeLocations(nodeList) {
  // without a baseline there is nothing to derive a location from, and the
  // entries already held stay as they are
  if (!status.ready) return { refreshed: 0, dropped: 0 };
  const database = db();
  if (!database) throw unavailable('no database connection');
  if (!nodeViewLoaded) await loadNodeLocationView();

  const listed = new Set();
  const missing = [];
  (nodeList ?? []).forEach((node) => {
    const ip = bareIp(node?.ip);
    if (!ip || listed.has(ip)) return;
    listed.add(ip);
    const held = nodeView.get(ip);
    // an entry from an older baseline says where the address used to resolve
    if (!held || held.g !== status.generated) missing.push(ip);
  });

  const departed = [...nodeView.keys()].filter((ip) => !listed.has(ip));

  let dropped = 0;
  if (departed.length) {
    try {
      const removal = await dbHelper.removeDocumentsFromCollection(
        database,
        nodeLocationsCollection,
        { _id: { $in: departed } },
      );
      dropped = removal?.deletedCount ?? 0;
    } catch (error) {
      throw unavailable(error.message);
    }
  }

  const next = new Map();
  nodeView.forEach((entry, ip) => {
    if (listed.has(ip) && entry.g === status.generated) next.set(ip, entry);
  });

  let refreshed = 0;
  let failure = null;
  let cursor = 0;
  const fill = async () => {
    while (cursor < missing.length) {
      const ip = missing[cursor];
      cursor += 1;
      const doc = {
        o: null, c: null, n: null, r: null, g: status.generated,
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        const hit = await lookup(ip);
        doc.o = hit?.org ?? null;
        doc.c = hit?.countryCode ?? null;
        doc.n = hit?.continentCode ?? null;
        doc.r = hit?.region ?? null;
        // eslint-disable-next-line no-await-in-loop
        await dbHelper.updateOneInDatabase(
          database,
          nodeLocationsCollection,
          { _id: ip },
          { $set: doc },
          { upsert: true },
        );
        next.set(ip, viewEntry(doc));
        refreshed += 1;
      } catch (error) {
        failure = failure ?? error;
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(NODE_LOOKUP_CONCURRENCY, missing.length) },
    () => fill(),
  ));

  nodeView = next;
  nodeViewLoaded = true;
  if (failure) log.warn(`ipLocationStore - some node locations could not be refreshed: ${failure.message}`);
  return { refreshed, dropped };
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
  continentByCountry = new Map();
  regionCodeByName = new Map();
  minimumRowCount = MIN_ROW_COUNT;
  nodeView = new Map();
  nodeViewLoaded = false;
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
  adoptPersistedStatus,
  continentForCountry,
  regionCodeForName,
  loadNodeLocationView,
  nodeLocationSnapshot,
  refreshNodeLocations,
  lookup,
  status: currentStatus,
  clear,
  setMinimumRowCount,
  isStoreUnavailable,
  MIN_ROW_COUNT,
  STORE_UNAVAILABLE,
};
