const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { expect } = chai;

describe('networkRecovery tests', () => {
  let dockerServiceStub;
  let appQueryServiceStub;
  let logStub;
  let recovery;

  beforeEach(() => {
    dockerServiceStub = { reclaimAppNetworks: sinon.stub().resolves([]) };
    appQueryServiceStub = { installedApps: sinon.stub().resolves({ status: 'success', data: [] }) };
    logStub = {
      info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
    };

    recovery = proxyquire('../../ZelBack/src/services/appSystem/networkRecovery', {
      '../dockerService': dockerServiceStub,
      '../appQuery/appQueryService': appQueryServiceStub,
      '../../lib/log': logStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('expects a network for every installed app, built from the record', async () => {
    // Built from the app's own name rather than read back out of a network
    // name: recovering one from fluxDockerNetwork_<name> means assuming what a
    // name may contain, and being wrong there removes a live app's network.
    appQueryServiceStub.installedApps.resolves({
      status: 'success',
      data: [{ name: 'myapp' }, { name: 'other_app_with_underscores' }],
    });

    await recovery.reclaimOrphanedAppNetworks();

    const expected = dockerServiceStub.reclaimAppNetworks.firstCall.args[0];
    expect([...expected]).to.have.members([
      'fluxDockerNetwork_myapp',
      'fluxDockerNetwork_other_app_with_underscores',
    ]);
  });

  it('reclaims nothing when the app list cannot be read', async () => {
    // Every network looks unowned to an empty list, so a failed read must not
    // read as "no app owns anything".
    appQueryServiceStub.installedApps.resolves({ status: 'error', data: 'database is down' });

    const reclaimed = await recovery.reclaimOrphanedAppNetworks();

    expect(reclaimed).to.deep.equal([]);
    sinon.assert.notCalled(dockerServiceStub.reclaimAppNetworks);
    sinon.assert.calledOnce(logStub.warn);
  });

  it('reclaims nothing when the app list is not a list', async () => {
    appQueryServiceStub.installedApps.resolves({ status: 'success', data: null });

    await recovery.reclaimOrphanedAppNetworks();

    sinon.assert.notCalled(dockerServiceStub.reclaimAppNetworks);
  });

  it('reclaims nothing when the app list throws', async () => {
    appQueryServiceStub.installedApps.rejects(new Error('no database connection'));

    const reclaimed = await recovery.reclaimOrphanedAppNetworks();

    expect(reclaimed).to.deep.equal([]);
    sinon.assert.notCalled(dockerServiceStub.reclaimAppNetworks);
    sinon.assert.calledOnce(logStub.error);
  });

  it('reports what it reclaimed', async () => {
    appQueryServiceStub.installedApps.resolves({ status: 'success', data: [{ name: 'live' }] });
    dockerServiceStub.reclaimAppNetworks.resolves(['fluxDockerNetwork_gone']);

    const reclaimed = await recovery.reclaimOrphanedAppNetworks();

    expect(reclaimed).to.deep.equal(['fluxDockerNetwork_gone']);
    expect(logStub.info.firstCall.args[0]).to.contain('fluxDockerNetwork_gone');
  });

  it('says nothing when there was nothing to reclaim', async () => {
    await recovery.reclaimOrphanedAppNetworks();

    sinon.assert.notCalled(logStub.info);
  });
});
