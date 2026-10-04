const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const appValidator = require('../../ZelBack/src/services/appRequirements/appValidator');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const { requireMongo } = require('./dbTestHelper');

// The submission path itself, up to the refusals this branch adds: an update is turned away
// before it is signed off and paid for when its app has expired, or could expire before the
// payment confirms.
describe('updateAppGlobaly tests', () => {
  before(requireMongo);

  const owner = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
  const name = 'SubmitApp';
  const spec = {
    version: 1,
    name,
    description: 'submission test',
    owner,
    repotag: 'test/image:latest',
    port: 30001,
    containerPort: 7396,
    enviromentParameters: [],
    commands: [],
    containerData: '/data',
    cpu: 0.5,
    ram: 500,
    hdd: 5,
    tiered: false,
  };
  let database;

  const submit = () => advancedWorkflows.updateAppGlobaly({
    appSpecification: spec, timestamp: Date.now(), signature: 'not-checked-before-the-refusal', type: 'fluxappupdate', version: 1,
  });

  beforeEach(async () => {
    await dbHelper.initiateDB();
    database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    const { appsMessages, appsInformation } = config.database.appsglobal.collections;
    await database.collection(appsMessages).deleteMany({ 'appSpecifications.name': name });
    await database.collection(appsInformation).deleteMany({ name });
    // registered at 3003000 for 1000 blocks: alive until 3004000
    await database.collection(appsMessages).insertOne({
      type: 'fluxappregister', hash: 'reg', height: 3003000, timestamp: 1, appSpecifications: { ...spec, expire: 1000 },
    });
    await database.collection(appsInformation).insertOne({
      ...spec, expire: 1000, height: 3003000, hash: 'reg',
    });
    sinon.stub(appValidator, 'verifyAppSpecifications').resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should refuse an update that could confirm after its app expires', async () => {
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 3004000 - 100 } });

    await submit().then(
      () => expect.fail('should have refused'),
      (error) => expect(error.message).to.include('can no longer be updated or renewed'),
    );
  });

  it('should refuse an update of an app that has expired, even one this node still holds', async () => {
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 3004100 } });

    await submit().then(
      () => expect.fail('should have refused'),
      (error) => expect(error.message).to.include('does not exist or has expired'),
    );
  });

  it('should get past the expiry checks with time left', async () => {
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 3003100 } });

    // it goes on to the signature check, which this fake signature fails
    await submit().then(
      () => expect.fail('should have failed on the signature'),
      (error) => expect(error.message).to.not.match(/expired|no longer be updated/),
    );
  });
});
