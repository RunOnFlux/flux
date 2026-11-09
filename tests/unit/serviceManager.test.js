const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');

chai.use(chaiAsPromised);
const { expect } = chai;

const { prepareDatabaseSchema, dosState, startRouterAddressUpkeep } = require('../../ZelBack/src/services/serviceManager');
const { untilSucceeds } = require('../../ZelBack/src/services/utils/untilSucceeds');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const nodeDosState = require('../../ZelBack/src/services/nodeDosState');
const appTamperingDetectionService = require('../../ZelBack/src/services/appTamperingDetectionService');
const appsRuntimeState = require('../../ZelBack/src/services/appManagement/appsRuntimeState');
const appPlacements = require('../../ZelBack/src/services/appManagement/appPlacements');
const explorerService = require('../../ZelBack/src/services/explorerService');
const upnpMappingRecord = require('../../ZelBack/src/services/upnpMappingRecord');
const messageStore = require('../../ZelBack/src/services/appMessaging/messageStore');
const upnpService = require('../../ZelBack/src/services/upnpService');
const portManager = require('../../ZelBack/src/services/appNetwork/portManager');

describe('untilSucceeds', () => {
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

  it('writes the UPnP mappings the node recorded before its database was connected, as it prepares the local database', async () => {
    const collection = {};
    sinon.stub(dbHelper, 'maintenanceConnection').returns({ db: () => ({ collection: () => collection }) });
    sinon.stub(dbHelper, 'updateInDatabase').resolves();
    sinon.stub(dbHelper, 'dropCollection').resolves();
    sinon.stub(dbHelper, 'ensureIndexes').resolves();
    sinon.stub(appTamperingDetectionService, 'prepareIncidentRollup').resolves();
    sinon.stub(appTamperingDetectionService, 'checkNodeReboot').resolves();
    sinon.stub(appsRuntimeState, 'prepareCollection').resolves();
    sinon.stub(appPlacements, 'prepareCollection').resolves();
    const written = sinon.stub(upnpMappingRecord, 'writeWaiting').resolves();
    // the step after the record's, to end the preparation there
    sinon.stub(explorerService, 'prepareCollections').rejects(new Error('stop here'));

    await expect(prepareDatabaseSchema()).to.be.rejectedWith('stop here');

    sinon.assert.calledOnce(written);
  });
});

describe('serviceManager prepareDatabaseSchema, temp messages and install errors', () => {
  afterEach(() => sinon.restore());

  async function prepared() {
    const deletes = {};
    const collection = (name) => ({ collectionName: name, deleteMany: async (query) => { deletes[name] = query; } });
    sinon.stub(dbHelper, 'maintenanceConnection').returns({ db: () => ({ collection }) });
    sinon.stub(dbHelper, 'updateInDatabase').resolves();
    sinon.stub(dbHelper, 'dropCollection').resolves();
    const indexes = sinon.stub(dbHelper, 'ensureIndexes').resolves();
    sinon.stub(dbHelper, 'ensureNewestAppMessageIndex').resolves();
    sinon.stub(appTamperingDetectionService, 'prepareIncidentRollup').resolves();
    sinon.stub(appTamperingDetectionService, 'checkNodeReboot').resolves();
    sinon.stub(appsRuntimeState, 'prepareCollection').resolves();
    sinon.stub(appPlacements, 'prepareCollection').resolves();
    sinon.stub(upnpMappingRecord, 'writeWaiting').resolves();
    sinon.stub(explorerService, 'prepareCollections').resolves();
    const lowercased = sinon.stub(messageStore, 'lowercaseStoredAppNames').resolves();
    sinon.stub(dbHelper, 'repairNanInAppsMessagesDb').rejects(new Error('stop here'));
    await expect(prepareDatabaseSchema()).to.be.rejectedWith('stop here');
    return { deletes, indexes, lowercased };
  }

  const specsOf = (indexes, name) => indexes.getCalls().find((c) => c.args[0].collectionName === name).args[1];

  it('holds a temp message once, ended by its expireAt', async () => {
    const { indexes } = await prepared();
    const specs = specsOf(indexes, 'zelappstemporarymessages');
    expect(specs.find((s) => s.key.hash === 1).unique).to.equal(true);
    expect(specs.find((s) => s.key.expireAt === 1).expireAfterSeconds).to.equal(0);
    expect(specs.find((s) => s.key.receivedAt === 1).expireAfterSeconds, 'a ttl on receipt still runs').to.equal(undefined);
  });

  it('holds one row per message for checking, ended by its expireAt', async () => {
    const { indexes } = await prepared();
    const specs = specsOf(indexes, 'zelappsheldmessages');
    expect(specs.find((s) => s.key.key === 1).unique).to.equal(true);
    expect(specs.find((s) => s.key.expireAt === 1).expireAfterSeconds).to.equal(0);
  });

  it('gives the stored events their app names lowercased, once their indexes are in place', async () => {
    const { indexes, lowercased } = await prepared();
    sinon.assert.calledOnceWithMatch(lowercased, { collectionName: 'appstateevents' });
    const eventIndexes = indexes.getCalls().find((c) => c.args[0].collectionName === 'appstateevents');
    expect(eventIndexes.calledBefore(lowercased.firstCall), 'the names were lowercased before their indexes were in place').to.equal(true);
  });

  it('removes install error rows a ttl index cannot', async () => {
    const { deletes } = await prepared();
    expect(deletes.appsInstallingErrorsLocations).to.deep.equal({ expireAt: { $not: { $type: 'date' } } });
  });
});

describe('serviceManager apps availability DOS state', () => {
  afterEach(() => {
    nodeDosState.setDosMessage(null);
    nodeDosState.setDosStateValue(0);
  });

  it('writes its message as the node\'s own', () => {
    dosState.dosMessage = 'Ports tested not reachable from outside';

    chai.expect(nodeDosState.getDosMessage()).to.equal('Ports tested not reachable from outside');
  });

  it('reads the node\'s own message, whoever set it', () => {
    nodeDosState.setDosMessage('Flux IP detection failed');

    chai.expect(dosState.dosMessage).to.equal('Flux IP detection failed');
  });
});

describe('serviceManager router address upkeep', () => {
  let saved;
  let clock;

  beforeEach(() => {
    saved = globalThis.userconfig;
    globalThis.userconfig = { initial: { ...saved.initial, routerIP: '192.168.1.1' } };
    clock = sinon.useFakeTimers();
    sinon.stub(upnpService, 'adjustFirewallForUPNP').resolves();
    sinon.stub(portManager, 'callOtherNodeToKeepUpnpPortsOpen').resolves();
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
    globalThis.userconfig = saved;
  });

  it('runs nothing on a node that does not map through UPnP, whatever its router address', () => {
    sinon.stub(upnpService, 'isUPNP').returns(false);

    expect(startRouterAddressUpkeep()).to.equal(false);
    clock.tick(2 * 60 * 60 * 1000);

    sinon.assert.notCalled(upnpService.adjustFirewallForUPNP);
    sinon.assert.notCalled(portManager.callOtherNodeToKeepUpnpPortsOpen);
  });

  it('keeps a UPnP node with a router address open: its firewall rules hourly, peers asked every 8 minutes', () => {
    sinon.stub(upnpService, 'isUPNP').returns(true);

    expect(startRouterAddressUpkeep()).to.equal(true);
    clock.tick(60 * 1000);
    sinon.assert.calledOnce(portManager.callOtherNodeToKeepUpnpPortsOpen);
    clock.tick(8 * 60 * 1000);
    sinon.assert.calledTwice(portManager.callOtherNodeToKeepUpnpPortsOpen);
    clock.tick(60 * 60 * 1000);
    sinon.assert.calledOnce(upnpService.adjustFirewallForUPNP);
  });
});
