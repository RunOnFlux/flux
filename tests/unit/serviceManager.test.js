const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');

chai.use(chaiAsPromised);
const { expect } = chai;

const {
  untilSucceeds, prepareDatabaseSchema, dosState,
} = require('../../ZelBack/src/services/serviceManager');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');

describe('serviceManager untilSucceeds', () => {
  afterEach(() => sinon.restore());

  it('runs a failing step again after a wait, until it succeeds, and answers what it resolved', async () => {
    const wait = sinon.stub(serviceHelper, 'delay').resolves();
    const step = sinon.stub();
    step.onFirstCall().rejects(new Error('connection timed out'));
    step.onSecondCall().rejects(new Error('connection timed out'));
    step.resolves('prepared');

    expect(await untilSucceeds('a step', step)).to.equal('prepared');

    sinon.assert.calledThrice(step);
    sinon.assert.calledTwice(wait);
    sinon.assert.alwaysCalledWithExactly(wait, 15 * 1000);
  });
});

describe('serviceManager prepareDatabaseSchema', () => {
  afterEach(() => sinon.restore());

  it('rejects when the login rows cannot be cleared of signatures, so boot prepares the schema again', async () => {
    sinon.stub(dbHelper, 'maintenanceConnection').returns({ db: (name) => ({ name, client: 'maintenance' }) });
    const unset = sinon.stub(dbHelper, 'updateInDatabase').rejects(new Error('connection timed out'));

    await expect(prepareDatabaseSchema()).to.be.rejectedWith('connection timed out');
    expect(unset.firstCall.args[0].client, 'the schema runs on the maintenance client').to.equal('maintenance');
  });
});

describe('serviceManager apps availability DOS state', () => {
  afterEach(() => {
    fluxNetworkHelper.setDosMessage(null);
    fluxNetworkHelper.setDosStateValue(0);
  });

  it('writes its message as the node\'s own', () => {
    dosState.dosMessage = 'Ports tested not reachable from outside';

    chai.expect(fluxNetworkHelper.getDosMessage()).to.equal('Ports tested not reachable from outside');
  });

  it('reads the node\'s own message, whoever set it', () => {
    fluxNetworkHelper.setDosMessage('Flux IP detection failed');

    chai.expect(dosState.dosMessage).to.equal('Flux IP detection failed');
  });
});
