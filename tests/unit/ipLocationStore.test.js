const zlib = require('node:zlib');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const cidrUtils = require('../../ZelBack/src/services/utils/cidrUtils');

chai.use(chaiAsPromised);
const { expect } = chai;

const IP_RANGES = 'ipranges';
const IP_RANGES_NEXT = 'ipranges_next';
const NODE_LOCATIONS = 'nodelocations';
const POLICY_DOCUMENTS = 'policydocuments';
const INGEST_MARKER_ID = 'ipLocationTableIngest';

function v4Int(ip) {
  return Number(cidrUtils.parseIp(ip).value);
}

/** Unsigned LEB128, the row field encoding. */
function varint(value) {
  const bytes = [];
  let rest = value;
  do {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    bytes.push(rest > 0 ? byte + 128 : byte);
  } while (rest > 0);
  return bytes;
}

/**
 * A valid format 2 artifact. Rows are [start, end, orgIdx, ccIdx, regionIdx]
 * with null for "none"; the encoder derives the gap/len/index+1 wire form.
 */
function encodeArtifact(header, rows) {
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(11);
  prefix.write('FLXGEO', 0, 'latin1');
  prefix[6] = 2;
  prefix.writeUInt32LE(headerJson.length, 7);
  const rowCount = Buffer.alloc(4);
  rowCount.writeUInt32LE(rows.length, 0);
  const body = [];
  let previousEnd = -1;
  rows.forEach(([start, end, org, cc, region]) => {
    body.push(
      ...varint(start - previousEnd - 1),
      ...varint(end - start),
      ...varint(org === null ? 0 : org + 1),
      ...varint(cc === null ? 0 : cc + 1),
      ...varint(region === null ? 0 : region + 1),
    );
    previousEnd = end;
  });
  return zlib.gzipSync(Buffer.concat([prefix, headerJson, rowCount, Buffer.from(body)]));
}

/** Every malformed case is a valid artifact with its bytes damaged. */
function corrupt(bytes, mutate) {
  const plain = zlib.gunzipSync(bytes);
  return zlib.gzipSync(mutate(plain) ?? plain);
}

function rowCountOffset(plain) {
  return 11 + plain.readUInt32LE(7);
}

// the baseline stamp every fixture document is derived from
const GENERATED = '2026-07-31T00:00:00Z';

function fixtureHeader() {
  return {
    generated: GENERATED,
    sources: { ripencc: '1785362399', dbip: '2026-07' },
    countries: ['BH', 'BG', 'FI'],
    continents: { BH: 'AS', BG: 'EU', FI: 'EU' },
    orgs: ['a1b2c3d4e5f6', 'b2c3d4e5f6a1', 'c3d4e5f6a1b2'],
    regions: ['FI-18'],
  };
}

// The incident geography: a Bahrain block and a Bulgarian one inside the same
// /16, Hetzner's /15 spanning two /16s, and a range with no organisation.
function fixtureRows() {
  return [
    [v4Int('65.108.0.0'), v4Int('65.109.255.255'), 2, 2, 0],
    [v4Int('80.95.16.0'), v4Int('80.95.19.255'), 1, 1, null],
    [v4Int('80.95.208.0'), v4Int('80.95.223.255'), 0, 0, null],
    [v4Int('91.0.0.0'), v4Int('91.0.0.255'), null, 1, null],
  ];
}

function fixtureArtifact() {
  return encodeArtifact(fixtureHeader(), fixtureRows());
}

describe('ipLocationStore tests', () => {
  let store;
  let database;
  let dbHelperStub;
  let logStub;

  function loadStore() {
    return proxyquire('../../ZelBack/src/services/appPlacement/ipLocationStore', {
      config: {
        database: {
          local: {
            database: 'zelfluxlocal',
            collections: {
              ipRanges: IP_RANGES,
              nodeLocations: NODE_LOCATIONS,
              policyDocuments: POLICY_DOCUMENTS,
            },
          },
        },
      },
      '../../lib/log': logStub,
      '../dbHelper': dbHelperStub,
    });
  }

  beforeEach(() => {
    logStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    database = { renameCollection: sinon.stub().resolves() };
    dbHelperStub = {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns(database) }),
      dropCollection: sinon.stub().resolves(),
      insertManyToDatabase: sinon.stub().callsFake(async (db, collection, docs) => ({ insertedCount: docs.length })),
      findInDatabase: sinon.stub().resolves([]),
      findOneInDatabase: sinon.stub().resolves(null),
      findOneAndUpdateInDatabase: sinon.stub().resolves({}),
      updateOneInDatabase: sinon.stub().resolves({}),
      removeDocumentsFromCollection: sinon.stub().resolves({ deletedCount: 0 }),
    };
    store = loadStore();
    // the fixtures carry four rows, not a real baseline's two million
    store.setMinimumRowCount(1);
  });

  afterEach(() => {
    store.clear();
    sinon.restore();
  });

  describe('truncation floor', () => {
    it('defaults to the production floor of 1,500,000 rows', () => {
      expect(store.MIN_ROW_COUNT).to.equal(1500000);
    });

    it('rejects a short baseline at the production floor without touching the database', async () => {
      store.clear(); // restores MIN_ROW_COUNT
      await expect(store.setArtifact(fixtureArtifact())).to.be.rejectedWith('below the truncation floor 1500000');
      expect(dbHelperStub.databaseConnection.called).to.equal(false);
    });

    it('refuses a floor that is not a positive integer', () => {
      expect(() => store.setMinimumRowCount(0)).to.throw('positive integer');
      expect(() => store.setMinimumRowCount('1')).to.throw('positive integer');
    });
  });

  describe('setArtifact', () => {
    it('reports no table before an artifact is set', () => {
      expect(store.status()).to.eql({ ready: false, generated: null, rowCount: 0 });
    });

    it('ingests into the staging collection and swaps it in', async () => {
      const result = await store.setArtifact(fixtureArtifact());

      expect(result).to.eql({ generated: '2026-07-31T00:00:00Z', rowCount: 4 });
      expect(store.status()).to.eql({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 4 });

      sinon.assert.calledWithExactly(dbHelperStub.dropCollection, database, IP_RANGES_NEXT);
      sinon.assert.calledOnce(dbHelperStub.insertManyToDatabase);
      const [, collection, docs, options] = dbHelperStub.insertManyToDatabase.firstCall.args;
      expect(collection).to.equal(IP_RANGES_NEXT);
      expect(options).to.eql({ ordered: false });
      expect(docs).to.have.length(4);

      sinon.assert.calledWithExactly(database.renameCollection, IP_RANGES_NEXT, IP_RANGES, { dropTarget: true });
      sinon.assert.callOrder(dbHelperStub.dropCollection, dbHelperStub.insertManyToDatabase, database.renameCollection);
    });

    it('writes the spec document shape with the continent denormalised', async () => {
      await store.setArtifact(fixtureArtifact());
      const [, , docs] = dbHelperStub.insertManyToDatabase.firstCall.args;

      expect(docs[0]).to.eql({
        _id: v4Int('65.108.0.0'),
        e: v4Int('65.109.255.255'),
        o: 'c3d4e5f6a1b2',
        c: 'FI',
        n: 'EU',
        r: 'FI-18',
      });
      expect(docs[2]).to.eql({
        _id: v4Int('80.95.208.0'),
        e: v4Int('80.95.223.255'),
        o: 'a1b2c3d4e5f6',
        c: 'BH',
        n: 'AS',
        r: null,
      });
      expect(docs[3]).to.eql({
        _id: v4Int('91.0.0.0'),
        e: v4Int('91.0.0.255'),
        o: null,
        c: 'BG',
        n: 'EU',
        r: null,
      });
    });

    it('batches at ten thousand rows and keeps four batches in flight', async () => {
      const rows = [];
      for (let i = 0; i < 45000; i += 1) rows.push([i * 8, i * 8 + 3, null, null, null]);
      const held = [];
      let capReached;
      const capped = new Promise((resolve) => { capReached = resolve; });
      let holding = true;
      dbHelperStub.insertManyToDatabase = sinon.stub().callsFake((db, collection, docs) => {
        if (!holding) return Promise.resolve({ insertedCount: docs.length });
        return new Promise((resolve) => {
          held.push(() => resolve({ insertedCount: docs.length }));
          if (held.length === 4) capReached();
        });
      });

      const pending = store.setArtifact(encodeArtifact(fixtureHeader(), rows));
      await capped;
      // nothing further may launch while all four are held
      await new Promise(setImmediate);
      expect(held.length).to.equal(4);
      expect(database.renameCollection.called).to.equal(false);

      holding = false;
      held.forEach((resolve) => resolve());
      await pending;

      expect(dbHelperStub.insertManyToDatabase.callCount).to.equal(5);
      const sizes = dbHelperStub.insertManyToDatabase.getCalls().map((call) => call.args[2].length);
      expect(sizes).to.eql([10000, 10000, 10000, 10000, 5000]);
      sinon.assert.calledOnce(database.renameCollection);
    });

    it('drops a staging collection left by a crashed attempt, and tolerates its absence', async () => {
      const missing = new Error('ns not found');
      missing.codeName = 'NamespaceNotFound';
      dbHelperStub.dropCollection = sinon.stub().rejects(missing);

      await store.setArtifact(fixtureArtifact());

      sinon.assert.calledOnce(database.renameCollection);
    });

    it('fails the ingest when the staging collection cannot be dropped', async () => {
      dbHelperStub.dropCollection = sinon.stub().rejects(new Error('not authorized'));

      await expect(store.setArtifact(fixtureArtifact())).to.be.rejectedWith('not authorized');
      expect(dbHelperStub.insertManyToDatabase.called).to.equal(false);
      expect(database.renameCollection.called).to.equal(false);
    });

    it('never renames and keeps the previous status when a batch fails', async () => {
      await store.setArtifact(fixtureArtifact());
      const previous = store.status();
      database.renameCollection.resetHistory();
      dbHelperStub.insertManyToDatabase = sinon.stub().rejects(new Error('write timed out'));

      const header = fixtureHeader();
      header.generated = '2026-08-01T00:00:00Z';
      await expect(store.setArtifact(encodeArtifact(header, fixtureRows()))).to.be.rejectedWith('write timed out');

      expect(database.renameCollection.called).to.equal(false);
      expect(store.status()).to.eql(previous);
    });

    it('keeps the previous status when the swap fails', async () => {
      await store.setArtifact(fixtureArtifact());
      const previous = store.status();
      database.renameCollection.rejects(new Error('rename failed'));

      const header = fixtureHeader();
      header.generated = '2026-08-01T00:00:00Z';
      await expect(store.setArtifact(encodeArtifact(header, fixtureRows()))).to.be.rejectedWith('rename failed');

      expect(store.status()).to.eql(previous);
    });

    it('treats a short insert as a failed batch', async () => {
      dbHelperStub.insertManyToDatabase = sinon.stub().resolves({ insertedCount: 3 });

      await expect(store.setArtifact(fixtureArtifact())).to.be.rejectedWith('batch inserted 3 of 4 rows');
      expect(database.renameCollection.called).to.equal(false);
    });

    it('reports the store unavailable when mongo is not connected', async () => {
      dbHelperStub.databaseConnection = sinon.stub().returns(null);

      const error = await store.setArtifact(fixtureArtifact()).catch((err) => err);
      expect(store.isStoreUnavailable(error)).to.equal(true);
      expect(store.status().ready).to.equal(false);
    });
  });

  describe('setArtifact validation', () => {
    const damagedArtifacts = [
      ['bad magic', (plain) => { plain.write('FLXGEX', 0, 'latin1'); }, 'bad magic'],
      ['unsupported version', (plain) => { plain[6] = 3; }, 'unsupported format version 3'],
      ['header length past the end', (plain) => { plain.writeUInt32LE(0xfffffff, 7); }, 'truncated header'],
      ['header that is not JSON', (plain) => { plain[11] = 0x5b; }, 'header is not valid JSON'],
      ['a truncated row stream', (plain) => plain.subarray(0, plain.length - 2), 'row stream ends mid-value'],
      ['bytes after the last row', (plain) => Buffer.concat([plain, Buffer.from([0])]), 'row count disagrees with the byte stream'],
      ['a row count above the rows present', (plain) => {
        const offset = rowCountOffset(plain);
        plain.writeUInt32LE(plain.readUInt32LE(offset) + 1, offset);
      }, 'row stream ends mid-value'],
      ['a row count below the rows present', (plain) => {
        const offset = rowCountOffset(plain);
        plain.writeUInt32LE(plain.readUInt32LE(offset) - 1, offset);
      }, 'row count disagrees with the byte stream'],
      ['a header shorter than the fixed prefix', (plain) => plain.subarray(0, 8), 'shorter than the fixed header'],
    ];

    damagedArtifacts.forEach(([name, mutate, message]) => {
      it(`rejects ${name} and performs no database call`, async () => {
        await expect(store.setArtifact(corrupt(fixtureArtifact(), mutate))).to.be.rejectedWith(message);
        expect(dbHelperStub.databaseConnection.called).to.equal(false);
      });
    });

    it('rejects bytes that are not a gzip stream, and non-buffers', async () => {
      await expect(store.setArtifact(Buffer.from('not gzipped'))).to.be.rejectedWith('not a gzip stream');
      await expect(store.setArtifact('a string')).to.be.rejectedWith('artifact bytes are not a buffer');
      expect(dbHelperStub.databaseConnection.called).to.equal(false);
    });

    const missingSections = ['generated', 'sources', 'countries', 'continents', 'orgs', 'regions'];
    missingSections.forEach((section) => {
      it(`rejects a header missing ${section}`, async () => {
        const header = fixtureHeader();
        delete header[section];
        await expect(store.setArtifact(encodeArtifact(header, fixtureRows())))
          .to.be.rejectedWith(`header section ${section} is missing`);
        expect(dbHelperStub.databaseConnection.called).to.equal(false);
      });
    });

    it('rejects vocabulary entries that are not tokens', async () => {
      const notAString = fixtureHeader();
      notAString.orgs[1] = 7;
      await expect(store.setArtifact(encodeArtifact(notAString, fixtureRows())))
        .to.be.rejectedWith('header orgs[1] is not a token');

      const overlong = fixtureHeader();
      overlong.regions[0] = 'x'.repeat(65);
      await expect(store.setArtifact(encodeArtifact(overlong, fixtureRows())))
        .to.be.rejectedWith('header regions[0] is not a token');

      const badContinent = fixtureHeader();
      badContinent.continents.FI = null;
      await expect(store.setArtifact(encodeArtifact(badContinent, fixtureRows())))
        .to.be.rejectedWith('header continents.FI is not a token');

      expect(dbHelperStub.databaseConnection.called).to.equal(false);
    });

    it('rejects an index past the end of its vocabulary', async () => {
      const header = fixtureHeader();
      const orgOutOfRange = fixtureRows();
      orgOutOfRange[0][2] = header.orgs.length;
      await expect(store.setArtifact(encodeArtifact(header, orgOutOfRange)))
        .to.be.rejectedWith('org index out of range at row 0');

      const countryOutOfRange = fixtureRows();
      countryOutOfRange[1][3] = header.countries.length;
      await expect(store.setArtifact(encodeArtifact(header, countryOutOfRange)))
        .to.be.rejectedWith('country index out of range at row 1');

      const regionOutOfRange = fixtureRows();
      regionOutOfRange[0][4] = header.regions.length;
      await expect(store.setArtifact(encodeArtifact(header, regionOutOfRange)))
        .to.be.rejectedWith('region index out of range at row 0');

      expect(dbHelperStub.databaseConnection.called).to.equal(false);
    });

    // An unsigned gap cannot express a row that starts at or before the previous
    // end, so an out-of-order row list can only reach the reader as a range that
    // walks off the end of the address space.
    it('rejects rows that walk past the IPv4 address space', async () => {
      const rows = [[4294967290, 4294967300, null, null, null]];
      await expect(store.setArtifact(encodeArtifact(fixtureHeader(), rows)))
        .to.be.rejectedWith('row 0 runs past the IPv4 address space');
      expect(dbHelperStub.databaseConnection.called).to.equal(false);
    });

    it('rejects a gap wider than the address space', async () => {
      const rows = [[0, 10, null, null, null], [5000000000, 5000000001, null, null, null]];
      await expect(store.setArtifact(encodeArtifact(fixtureHeader(), rows)))
        .to.be.rejectedWith('varint wider than 32 bits');
      expect(dbHelperStub.databaseConnection.called).to.equal(false);
    });
  });

  describe('lookup', () => {
    const bahrainRow = {
      _id: v4Int('80.95.208.0'), e: v4Int('80.95.223.255'), o: 'a1b2c3d4e5f6', c: 'BH', n: 'AS', r: null,
    };

    it('queries the live collection for the covering row', async () => {
      dbHelperStub.findInDatabase.resolves([bahrainRow]);

      await store.lookup('80.95.213.209');

      sinon.assert.calledWithExactly(
        dbHelperStub.findInDatabase,
        database,
        IP_RANGES,
        { _id: { $lte: v4Int('80.95.213.209') } },
        { sort: { _id: -1 }, limit: 1 },
      );
    });

    it('resolves the organisation, block and geography', async () => {
      dbHelperStub.findInDatabase.resolves([bahrainRow]);

      expect(await store.lookup('80.95.213.209')).to.eql({
        org: 'a1b2c3d4e5f6',
        block: { start: v4Int('80.95.208.0'), end: v4Int('80.95.223.255') },
        countryCode: 'BH',
        continentCode: 'AS',
        region: null,
      });
    });

    it('returns a null block for a row with no organisation', async () => {
      dbHelperStub.findInDatabase.resolves([{
        _id: v4Int('91.0.0.0'), e: v4Int('91.0.0.255'), o: null, c: 'BG', n: 'EU', r: null,
      }]);

      expect(await store.lookup('91.0.0.7')).to.eql({
        org: null,
        block: null,
        countryCode: 'BG',
        continentCode: 'EU',
        region: null,
      });
    });

    it('returns null when the nearest row ends before the address, and when there is none', async () => {
      dbHelperStub.findInDatabase.resolves([bahrainRow]);
      expect(await store.lookup('80.95.224.0')).to.equal(null);

      dbHelperStub.findInDatabase.resolves([]);
      expect(await store.lookup('9.9.9.9')).to.equal(null);
    });

    it('returns null for addresses the table cannot hold, without querying', async () => {
      expect(await store.lookup('2a01:4f9:c010:1234::1')).to.equal(null);
      expect(await store.lookup('80.95.213.209:16127')).to.equal(null);
      expect(await store.lookup('garbage')).to.equal(null);
      expect(await store.lookup(null)).to.equal(null);
      expect(dbHelperStub.findInDatabase.called).to.equal(false);
    });

    // The degrade contract: a read that failed must not read as "no row covers
    // this address" - that is a different placement decision.
    it('surfaces a mongo failure as store unavailable, never as no covering row', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('connection reset'));

      const error = await store.lookup('80.95.213.209').then((value) => value, (err) => err);
      expect(error).to.be.an('error');
      expect(store.isStoreUnavailable(error)).to.equal(true);
      expect(error.code).to.equal(store.STORE_UNAVAILABLE);
      expect(error.message).to.include('connection reset');
    });

    it('surfaces a missing connection as store unavailable', async () => {
      dbHelperStub.databaseConnection.returns(null);

      const error = await store.lookup('80.95.213.209').then((value) => value, (err) => err);
      expect(store.isStoreUnavailable(error)).to.equal(true);
    });

    it('does not treat an ordinary artifact rejection as store unavailable', async () => {
      const error = await store.setArtifact(Buffer.from('not gzipped')).catch((err) => err);
      expect(store.isStoreUnavailable(error)).to.equal(false);
    });
  });

  describe('ingest marker', () => {
    it('records the ingested baseline, after the swap', async () => {
      await store.setArtifact(fixtureArtifact());

      sinon.assert.calledOnce(dbHelperStub.findOneAndUpdateInDatabase);
      const [, collection, query, update, options] = dbHelperStub.findOneAndUpdateInDatabase.firstCall.args;
      expect(collection).to.equal(POLICY_DOCUMENTS);
      expect(query).to.eql({ _id: INGEST_MARKER_ID });
      expect(options).to.eql({ upsert: true });
      expect(update.$set.generated).to.equal('2026-07-31T00:00:00Z');
      expect(update.$set.rowCount).to.equal(4);
      expect(update.$set.continents).to.eql({ BH: 'AS', BG: 'EU', FI: 'EU' });
      expect(update.$set.ingestedAt).to.be.a('number');
      // a marker that named rows the collection does not hold would be a lie
      sinon.assert.callOrder(database.renameCollection, dbHelperStub.findOneAndUpdateInDatabase);
    });

    it('warns but does not fail the ingest when the marker cannot be written', async () => {
      dbHelperStub.findOneAndUpdateInDatabase.rejects(new Error('not authorized'));

      const result = await store.setArtifact(fixtureArtifact());

      expect(result).to.eql({ generated: '2026-07-31T00:00:00Z', rowCount: 4 });
      expect(store.status().ready).to.equal(true);
    });
  });

  describe('adoptPersistedStatus', () => {
    const marker = {
      _id: INGEST_MARKER_ID,
      generated: '2026-07-31T00:00:00Z',
      rowCount: 2126447,
      continents: { BH: 'AS', BG: 'EU', FI: 'EU' },
      ingestedAt: 1,
    };

    it('adopts the stored baseline and its continents, without touching the rows', async () => {
      dbHelperStub.findOneInDatabase.resolves(marker);

      expect(await store.adoptPersistedStatus()).to.equal(true);
      expect(store.status()).to.eql({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 2126447 });
      expect(store.continentForCountry('BH')).to.equal('AS');
      expect(store.continentForCountry('CZ')).to.equal(null);
      sinon.assert.calledWithExactly(
        dbHelperStub.findOneInDatabase,
        database,
        POLICY_DOCUMENTS,
        { _id: INGEST_MARKER_ID },
      );
      expect(dbHelperStub.findInDatabase.called).to.equal(false);
    });

    it('reports no adoption when there is no marker, and holds no table', async () => {
      expect(await store.adoptPersistedStatus()).to.equal(false);
      expect(store.status().ready).to.equal(false);
    });

    it('reports no adoption for a marker without a baseline name', async () => {
      dbHelperStub.findOneInDatabase.resolves({ _id: INGEST_MARKER_ID, rowCount: 12 });
      expect(await store.adoptPersistedStatus()).to.equal(false);
      expect(store.status().ready).to.equal(false);
    });

    it('reports no adoption when the marker cannot be read, or mongo is not connected', async () => {
      dbHelperStub.findOneInDatabase.rejects(new Error('connection reset'));
      expect(await store.adoptPersistedStatus()).to.equal(false);

      dbHelperStub.databaseConnection.returns(null);
      expect(await store.adoptPersistedStatus()).to.equal(false);
      expect(store.status().ready).to.equal(false);
    });
  });

  describe('continentForCountry', () => {
    it('answers from the ingested header, and null without a table', async () => {
      expect(store.continentForCountry('BH')).to.equal(null);

      await store.setArtifact(fixtureArtifact());
      expect(store.continentForCountry('BH')).to.equal('AS');
      expect(store.continentForCountry('FI')).to.equal('EU');
      expect(store.continentForCountry('CZ')).to.equal(null);

      store.clear();
      expect(store.continentForCountry('BH')).to.equal(null);
    });
  });

  describe('node locations', () => {
    const bahrainRow = {
      _id: v4Int('80.95.208.0'), e: v4Int('80.95.223.255'), o: 'a1b2c3d4e5f6', c: 'BH', n: 'AS', r: null,
    };
    const orglessRow = {
      _id: v4Int('91.0.0.0'), e: v4Int('91.0.0.255'), o: null, c: 'BG', n: 'EU', r: null,
    };

    // findInDatabase serves two collections here: the covering-row lookup over
    // the baseline, and the view's own documents
    function serveView(held = []) {
      dbHelperStub.findInDatabase = sinon.stub().callsFake(async (db, collection, query) => {
        if (collection === NODE_LOCATIONS) return held;
        const needle = query._id.$lte;
        return [bahrainRow, orglessRow]
          .filter((row) => row._id <= needle)
          .sort((a, b) => b._id - a._id)
          .slice(0, 1);
      });
    }

    async function withTable() {
      await store.setArtifact(fixtureArtifact());
      dbHelperStub.findOneAndUpdateInDatabase.resetHistory();
    }

    it('loads the stored view into the process in one read, with the domain already keyed', async () => {
      await withTable();
      dbHelperStub.findInDatabase.resolves([
        {
          _id: '80.95.213.209', o: 'a1b2c3d4e5f6', bs: v4Int('80.95.208.0'), be: v4Int('80.95.223.255'), c: 'BH', n: 'AS', r: null, g: GENERATED,
        },
        {
          _id: '91.0.0.7', o: null, bs: null, be: null, c: 'BG', n: 'EU', r: null, g: GENERATED,
        },
      ]);

      await store.loadNodeLocationView();

      sinon.assert.calledWithExactly(dbHelperStub.findInDatabase, database, NODE_LOCATIONS, {});
      const { byIp, ready, generated } = store.nodeLocationSnapshot();
      expect(ready).to.equal(true);
      expect(generated).to.equal(GENERATED);
      expect(byIp.get('80.95.213.209')).to.eql({
        d: 'org:a1b2c3d4e5f6', c: 'BH', n: 'AS', r: null, g: GENERATED,
      });
      // no organisation means no block rung - the address falls to /16 downstream
      expect(byIp.get('91.0.0.7').d).to.equal(null);
    });

    it('keys the allocation block when a location carries one without an organisation', async () => {
      await withTable();
      dbHelperStub.findInDatabase.resolves([{
        _id: '80.95.213.209', o: null, bs: v4Int('80.95.208.0'), be: v4Int('80.95.223.255'), c: 'BH', n: 'AS', r: null, g: GENERATED,
      }]);

      await store.loadNodeLocationView();

      expect(store.nodeLocationSnapshot().byIp.get('80.95.213.209').d)
        .to.equal(`blk:${v4Int('80.95.208.0')}-${v4Int('80.95.223.255')}`);
    });

    it('surfaces a view load failure as store unavailable', async () => {
      dbHelperStub.findInDatabase.rejects(new Error('connection reset'));
      const error = await store.loadNodeLocationView().then((value) => value, (err) => err);
      expect(store.isStoreUnavailable(error)).to.equal(true);

      dbHelperStub.databaseConnection.returns(null);
      const noConnection = await store.loadNodeLocationView().then((value) => value, (err) => err);
      expect(store.isStoreUnavailable(noConnection)).to.equal(true);
    });

    it('reports the view as not held until it is loaded', async () => {
      await withTable();
      expect(store.nodeLocationSnapshot()).to.eql({ byIp: new Map(), ready: false, generated: GENERATED });
    });

    it('does nothing without a baseline to derive locations from', async () => {
      expect(await store.refreshNodeLocations([{ ip: '80.95.213.209:16127' }])).to.eql({ refreshed: 0, dropped: 0 });
      expect(dbHelperStub.removeDocumentsFromCollection.called).to.equal(false);
      expect(dbHelperStub.updateOneInDatabase.called).to.equal(false);
    });

    it('drops the addresses the node list no longer carries', async () => {
      await withTable();
      serveView([
        { _id: '80.95.213.209', g: GENERATED },
        { _id: '91.0.0.7', g: GENERATED },
      ]);
      dbHelperStub.removeDocumentsFromCollection.resolves({ deletedCount: 1 });

      const result = await store.refreshNodeLocations([{ ip: '80.95.213.209:16127' }]);

      sinon.assert.calledWithExactly(
        dbHelperStub.removeDocumentsFromCollection,
        database,
        NODE_LOCATIONS,
        { _id: { $in: ['91.0.0.7'] } },
      );
      expect(result.dropped).to.equal(1);
      // the view is bounded by the list, so absence can be taken at face value
      expect([...store.nodeLocationSnapshot().byIp.keys()]).to.eql(['80.95.213.209']);
    });

    it('leaves the collection alone when every held address is still listed', async () => {
      await withTable();
      serveView([{ _id: '80.95.213.209', g: GENERATED }]);

      const result = await store.refreshNodeLocations([{ ip: '80.95.213.209:16127' }]);

      expect(dbHelperStub.removeDocumentsFromCollection.called).to.equal(false);
      expect(result).to.eql({ refreshed: 0, dropped: 0 });
    });

    it('re-derives an entry left by an older baseline', async () => {
      await withTable();
      serveView([{
        _id: '80.95.213.209', o: 'stale', bs: null, be: null, c: 'XX', n: 'XX', r: null, g: '2026-06-01T00:00:00Z',
      }]);

      const result = await store.refreshNodeLocations([{ ip: '80.95.213.209:16127' }]);

      expect(result.refreshed).to.equal(1);
      expect(store.nodeLocationSnapshot().byIp.get('80.95.213.209')).to.eql({
        d: 'org:a1b2c3d4e5f6', c: 'BH', n: 'AS', r: null, g: GENERATED,
      });
    });

    it('writes only the addresses the view is missing, in the document shape', async () => {
      await withTable();
      serveView([{ _id: '80.95.213.209', g: GENERATED }]);

      const result = await store.refreshNodeLocations([
        { ip: '80.95.213.209:16127' }, // already held
        { ip: '80.95.215.211:16167' },
        { ip: '91.0.0.7:16127' },
        { ip: '203.0.113.7:16127' },
      ]);

      expect(result.refreshed).to.equal(3);
      const written = new Map(dbHelperStub.updateOneInDatabase.getCalls()
        .map((call) => [call.args[2]._id, call.args[3].$set]));
      expect(dbHelperStub.updateOneInDatabase.getCalls().every((call) => call.args[1] === NODE_LOCATIONS
        && call.args[4].upsert === true)).to.equal(true);
      expect(written.has('80.95.213.209')).to.equal(false);
      expect(written.get('80.95.215.211')).to.eql({
        o: 'a1b2c3d4e5f6',
        bs: v4Int('80.95.208.0'),
        be: v4Int('80.95.223.255'),
        c: 'BH',
        n: 'AS',
        r: null,
        g: '2026-07-31T00:00:00Z',
      });
      // no organisation means no block rung - the /16 rung applies downstream
      expect(written.get('91.0.0.7')).to.eql({
        o: null, bs: null, be: null, c: 'BG', n: 'EU', r: null, g: '2026-07-31T00:00:00Z',
      });
      // an address no row covers is still recorded, as an unresolved location
      expect(written.get('203.0.113.7')).to.eql({
        o: null, bs: null, be: null, c: null, n: null, r: null, g: '2026-07-31T00:00:00Z',
      });
    });

    it('keeps going past a lookup that fails, and warns once', async () => {
      await withTable();
      serveView();
      dbHelperStub.updateOneInDatabase
        .onFirstCall().rejects(new Error('write timed out'))
        .onSecondCall().rejects(new Error('write timed out again'));

      const result = await store.refreshNodeLocations([
        { ip: '80.95.215.211:16167' },
        { ip: '91.0.0.7:16127' },
        { ip: '80.95.213.209:16127' },
      ]);

      expect(result.refreshed).to.equal(1);
      const warnings = logStub.warn.args.filter((a) => a[0].includes('could not be refreshed'));
      expect(warnings).to.have.length(1);
      expect(warnings[0][0]).to.include('write timed out');
    });

    it('keeps eight lookups in flight', async () => {
      await withTable();
      serveView();
      const held = [];
      dbHelperStub.updateOneInDatabase = sinon.stub().callsFake(
        () => new Promise((resolve) => { held.push(resolve); }),
      );
      const nodeList = Array.from({ length: 20 }, (unused, i) => ({ ip: `80.95.208.${i}:16127` }));

      const pending = store.refreshNodeLocations(nodeList);
      await new Promise(setImmediate);
      expect(held.length).to.equal(8);

      const drain = setInterval(() => held.splice(0).forEach((resolve) => resolve({})), 0);
      const result = await pending;
      clearInterval(drain);

      expect(result.refreshed).to.equal(20);
    });

    it('surfaces a failed drop as store unavailable', async () => {
      await withTable();
      serveView([{ _id: '91.0.0.7', g: GENERATED }]);
      dbHelperStub.removeDocumentsFromCollection.rejects(new Error('not authorized'));

      const error = await store.refreshNodeLocations([]).then((value) => value, (err) => err);
      expect(store.isStoreUnavailable(error)).to.equal(true);
    });

    it('surfaces a failed view load as store unavailable', async () => {
      await withTable();
      dbHelperStub.findInDatabase = sinon.stub().rejects(new Error('connection reset'));

      const error = await store.refreshNodeLocations([]).then((value) => value, (err) => err);
      expect(store.isStoreUnavailable(error)).to.equal(true);
    });
  });

  describe('status', () => {
    it('answers from memory, never from the database', async () => {
      await store.setArtifact(fixtureArtifact());
      dbHelperStub.databaseConnection.resetHistory();

      expect(store.status()).to.eql({ ready: true, generated: '2026-07-31T00:00:00Z', rowCount: 4 });
      expect(dbHelperStub.databaseConnection.called).to.equal(false);
    });

    it('hands out a copy, so a caller cannot edit the stored view', async () => {
      await store.setArtifact(fixtureArtifact());

      const snapshot = store.status();
      snapshot.rowCount = 0;
      expect(store.status().rowCount).to.equal(4);
    });
  });
});
