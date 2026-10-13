const { expect } = require('chai');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const appsRuntimeState = require('../../ZelBack/src/services/appManagement/appsRuntimeState');
const { requireMongo } = require('./dbTestHelper');

// Against the database itself: the rule is decided inside the one write, so a
// stand-in for that write could only restate it.
describe('appsRuntimeState keyed restart requests', () => {
  before(requireMongo);

  const ID = 'web_restartkeyapp';
  let states;
  const generation = async () => (await appsRuntimeState.getState(ID))?.restartGeneration;

  beforeEach(async () => {
    await dbHelper.initiateDB();
    states = dbHelper.databaseConnection().db(config.database.appslocal.database)
      .collection(config.database.appslocal.collections.appsRuntimeState);
    await states.deleteMany({ identifier: ID });
    // as boot creates it: one record per component
    await states.createIndex({ identifier: 1 }, { unique: true, name: 'identifier_unique' });
  });

  afterEach(async () => {
    await states.deleteMany({ identifier: ID });
  });

  it('raises the generation once for a key, however often the key is asked', async () => {
    await appsRuntimeState.requestRestart(ID, { key: 'ownMove:1' });
    await appsRuntimeState.requestRestart(ID, { key: 'ownMove:1' });

    expect(await generation()).to.equal(1);
  });

  it('raises it once for two requests of one key made at once', async () => {
    await Promise.all([
      appsRuntimeState.requestRestart(ID, { key: 'ownMove:2' }),
      appsRuntimeState.requestRestart(ID, { key: 'ownMove:2' }),
    ]);

    expect(await generation()).to.equal(1);
    expect(await states.countDocuments({ identifier: ID })).to.equal(1);
  });

  it('raises it again for another key, and for every request without one', async () => {
    await states.insertOne({ identifier: ID, restartGeneration: 7, actuatedRestartGeneration: 7 });

    await appsRuntimeState.requestRestart(ID, { key: 'ownMove:3' });
    await appsRuntimeState.requestRestart(ID, { key: 'ownMove:4' });
    await appsRuntimeState.requestRestart(ID);
    await appsRuntimeState.requestRestart(ID);

    expect(await generation()).to.equal(11);
  });
});
