const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const log = require('../../ZelBack/src/lib/log');
const upnpMappingRecord = require('../../ZelBack/src/services/upnpMappingRecord');

describe('upnpMappingRecord tests', () => {
  // a collection kept in memory, answering the calls the record makes
  let documents;
  let asked;
  const collection = {
    updateOne: async (filter, update, options) => {
      const existing = documents.get(filter._id);
      if (!existing && !options?.upsert) return;
      documents.set(filter._id, { ...existing, _id: filter._id, ...update.$set });
    },
    deleteOne: async (filter) => { documents.delete(filter._id); },
    findOne: async (filter) => documents.get(filter._id) ?? null,
    find: (filter) => ({
      toArray: async () => [...documents.values()]
        .filter((doc) => doc._id !== filter._id.$ne)
        .map((doc) => {
          const rest = { ...doc };
          delete rest._id;
          return rest;
        }),
    }),
  };

  beforeEach(() => {
    documents = new Map();
    asked = [];
    upnpMappingRecord.unwritten.clear();
    sinon.stub(dbHelper, 'databaseConnection').returns({
      db: (name) => ({
        collection: (collectionName) => {
          asked.push(`${name}.${collectionName}`);
          return collection;
        },
      }),
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('keeps one record per port and protocol, in the local database', async () => {
    await upnpMappingRecord.mapping(31000, 'tcp', 'Flux_App_web');
    await upnpMappingRecord.mapping(31000, 'UDP', 'Flux_App_web');
    await upnpMappingRecord.mapping(31000, 'TCP', 'Flux_App_other');

    const records = await upnpMappingRecord.all();

    expect(records.map((r) => `${r.port}/${r.protocol} ${r.description}`).sort()).to.deep.equal([
      '31000/TCP Flux_App_other',
      '31000/UDP Flux_App_web',
    ]);
    expect(new Set(asked)).to.deep.equal(new Set([`${config.database.local.database}.upnpmappings`]));
  });

  it('ends a record by its port and protocol, leaving the other protocol\'s', async () => {
    await upnpMappingRecord.mapping(31000, 'TCP', 'Flux_App_web');
    await upnpMappingRecord.mapping(31000, 'UDP', 'Flux_App_web');

    await upnpMappingRecord.removed(31000, 'tcp');

    expect((await upnpMappingRecord.all()).map((r) => r.protocol)).to.deep.equal(['UDP']);
  });

  it('is complete only once marked, and lists the mark as no mapping', async () => {
    expect(await upnpMappingRecord.complete()).to.equal(false);

    await upnpMappingRecord.markComplete();

    expect(await upnpMappingRecord.complete()).to.equal(true);
    expect(await upnpMappingRecord.all()).to.deep.equal([]);
  });

  it('logs a write it cannot make, and lets the map go ahead', async () => {
    sinon.stub(collection, 'updateOne').rejects(new Error('not primary'));
    const errorStub = sinon.stub(log, 'error');

    await upnpMappingRecord.mapping(31000, 'TCP', 'Flux_App_web');

    sinon.assert.calledOnce(errorStub);
    expect(errorStub.firstCall.args[0]).to.match(/31000\/TCP not recorded: not primary/);
  });

  it('keeps what it records before the database is connected, and writes it first once it is', async () => {
    dbHelper.databaseConnection.returns(null);
    await upnpMappingRecord.mapping(16137, 'TCP', 'Flux_Backend_API');
    await upnpMappingRecord.mapping(16138, 'TCP', 'Flux_Backend_API_SSL');
    await upnpMappingRecord.removed(16138, 'TCP');

    expect((await upnpMappingRecord.all()).map((r) => r.port)).to.deep.equal([16137]);
    expect(documents.size).to.equal(0);
    expect(await upnpMappingRecord.complete()).to.equal(false);

    dbHelper.databaseConnection.restore();
    sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({ collection: () => collection }) });
    await upnpMappingRecord.mapping(31000, 'UDP', 'Flux_App_web');

    expect([...documents.keys()].sort()).to.deep.equal(['16137/TCP', '31000/UDP']);
    expect(upnpMappingRecord.unwritten.size).to.equal(0);
  });

  it('writes what waited for the database when asked to, once it is connected', async () => {
    dbHelper.databaseConnection.returns(null);
    await upnpMappingRecord.mapping(16137, 'TCP', 'Flux_Backend_API');
    await upnpMappingRecord.writeWaiting();
    expect(documents.size, 'nothing written while not connected').to.equal(0);
    dbHelper.databaseConnection.restore();
    sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({ collection: () => collection }) });

    await upnpMappingRecord.writeWaiting();

    expect([...documents.keys()]).to.deep.equal(['16137/TCP']);
    expect(upnpMappingRecord.unwritten.size).to.equal(0);
  });

  it('writes what waited before it lists, once the database is connected', async () => {
    dbHelper.databaseConnection.returns(null);
    await upnpMappingRecord.mapping(16137, 'TCP', 'Flux_Backend_API');
    dbHelper.databaseConnection.restore();
    sinon.stub(dbHelper, 'databaseConnection').returns({ db: () => ({ collection: () => collection }) });

    expect((await upnpMappingRecord.all()).map((r) => r.port)).to.deep.equal([16137]);
    expect([...documents.keys()]).to.deep.equal(['16137/TCP']);
  });
});
