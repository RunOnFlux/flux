const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const appValidator = require('../../ZelBack/src/services/appRequirements/appValidator');
const messageVerifier = require('../../ZelBack/src/services/appMessaging/messageVerifier');
const advancedWorkflows = require('../../ZelBack/src/services/appLifecycle/advancedWorkflows');
const { requireMongo } = require('./dbTestHelper');

// The submission path up to the owner's signature: which app an update is judged against, and
// whose signature it needs.
describe('updateAppGlobaly tests', () => {
  before(requireMongo);

  const owner = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
  const otherOwner = '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6W';
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
  let signatureCheck;

  const submit = () => advancedWorkflows.updateAppGlobaly({
    appSpecification: spec, timestamp: Date.now(), signature: 'sig', type: 'fluxappupdate', version: 1,
  });
  // the submission is judged up to the signature check, which ends it here
  const submitToSignatureCheck = async () => {
    await submit().then(
      () => expect.fail('should have stopped at the signature check'),
      (error) => expect(error.message).to.equal('signature checked'),
    );
    return signatureCheck.firstCall.args;
  };

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
    sinon.stub(appValidator, 'verifyAppSpecifications').resolves();
    signatureCheck = sinon.stub(messageVerifier, 'verifyAppMessageUpdateSignature').rejects(new Error('signature checked'));
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should judge an update of a live app against the app', async () => {
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 3003100 } });
    await database.collection(config.database.appsglobal.collections.appsInformation).insertOne({
      ...spec, expire: 1000, height: 3003000, hash: 'reg',
    });

    const [, , , , , appOwner, , previousSpec] = await submitToSignatureCheck();

    expect(appOwner).to.equal(owner);
    expect(previousSpec.name).to.equal(name);
  });

  it('should take a renewal of an app that has expired and been removed here', async () => {
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 3010000 } });

    const [, , , , , appOwner, , previousSpec] = await submitToSignatureCheck();

    expect(appOwner).to.equal(owner);
    expect(previousSpec.name).to.equal(name);
  });

  it('should need the new owner\'s signature once someone else has registered the name', async () => {
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 3010000 } });
    await database.collection(config.database.appsglobal.collections.appsMessages).insertOne({
      type: 'fluxappregister', hash: 'taken', height: 3005000, timestamp: 2, appSpecifications: { ...spec, owner: otherOwner, expire: 88000 },
    });

    const [, , , , , appOwner] = await submitToSignatureCheck();

    expect(appOwner).to.equal(otherOwner);
  });

  it('should refuse an update of a name that was never registered', async () => {
    sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({ data: { synced: true, height: 3003100 } });
    await database.collection(config.database.appsglobal.collections.appsMessages).deleteMany({ 'appSpecifications.name': name });

    await submit().then(
      () => expect.fail('should have refused'),
      (error) => expect(error.message).to.include('application to update does not exist'),
    );
    expect(signatureCheck.called).to.equal(false);
  });
});
