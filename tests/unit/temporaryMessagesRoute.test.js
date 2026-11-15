const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const messageVerifier = require('../../ZelBack/src/services/appMessaging/messageVerifier');
const { requireMongo, releaseMongo } = require('./dbTestHelper');

describe('the temporary messages route', () => {
  after(releaseMongo);

  before(requireMongo);

  const hash = 'c'.repeat(64);
  const stored = {
    hash,
    type: 'fluxappregister',
    version: 1,
    appSpecifications: { name: 'RouteApp' },
    timestamp: 1,
    signature: 'sig',
    clientTag: 'd'.repeat(64),
    clientTagHeight: 3081600,
    clientTagCap: 100,
    originKey: '04aa',
  };
  let collection;

  beforeEach(async () => {
    await dbHelper.initiateDB();
    collection = dbHelper.databaseConnection().db(config.database.appsglobal.database)
      .collection(config.database.appsglobal.collections.appsTemporaryMessages);
    await collection.deleteMany({ hash });
    await collection.insertOne({ ...stored });
  });

  afterEach(async () => {
    await collection.deleteMany({ hash });
  });

  it('serves a pending message without the client tag it was counted under', async () => {
    const response = await new Promise((resolve) => {
      messageVerifier.getAppsTemporaryMessages({ params: { hash }, query: {} }, { json: resolve });
    });

    expect(response.status).to.equal('success');
    const [served] = response.data;
    expect(served.hash).to.equal(hash);
    expect(served.originKey).to.equal('04aa');
    expect(served).to.not.have.any.keys('clientTag', 'clientTagHeight', 'clientTagCap', '_id');
  });
});
