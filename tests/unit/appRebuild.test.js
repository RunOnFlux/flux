const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { RemovalOutcome } = require('../../ZelBack/src/services/utils/removalOutcome');
const { InstallOutcome } = require('../../ZelBack/src/services/utils/installOutcome');

describe('appRebuild tests', () => {
  let uninstaller;
  let installer;
  let appRebuild;
  let bus;
  const spec = { name: 'myapp', version: 8 };

  beforeEach(() => {
    uninstaller = {
      removeAppLocally: sinon.stub().resolves(RemovalOutcome.REMOVED),
      announceRemoval: sinon.stub().resolves(),
    };
    installer = {
      checkAppRequirements: sinon.stub().resolves(true),
      registerAppLocally: sinon.stub().resolves(InstallOutcome.INSTALLED),
    };
    bus = { publish: sinon.stub() };
    appRebuild = proxyquire('../../ZelBack/src/services/appLifecycle/appRebuild', {
      '../utils/fluxEventBus': bus,
      './appUninstaller': uninstaller,
      './appInstaller': installer,
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('removes the app and installs it again, and tells the network nothing', async () => {
    expect(await appRebuild.rebuildApp(spec)).to.equal(InstallOutcome.INSTALLED);

    sinon.assert.callOrder(installer.checkAppRequirements, uninstaller.removeAppLocally, installer.registerAppLocally);
    sinon.assert.notCalled(uninstaller.announceRemoval);
  });

  it('leaves the installer\'s teardown silent, so the network is told once, here', async () => {
    await appRebuild.rebuildApp(spec);

    expect(installer.registerAppLocally.firstCall.args[3], 'the installer was asked to announce its own teardown').to.equal(false);
  });

  it('tells the network once when the app was removed and the install did not complete', async () => {
    installer.registerAppLocally.resolves(InstallOutcome.FAILED);

    expect(await appRebuild.rebuildApp(spec)).to.equal(InstallOutcome.FAILED);

    sinon.assert.calledOnceWithExactly(uninstaller.announceRemoval, 'myapp');
  });

  // The app's row and the room reserved for it are its own, and counting them
  // beside the specification it moves to asks for room for two.
  it('checks the new specification against the node without the app itself', async () => {
    await appRebuild.rebuildApp(spec);

    sinon.assert.calledOnceWithExactly(installer.checkAppRequirements, spec, false, false, false, { replacing: 'myapp' });
  });

  it('leaves the app as it was, and tells the network nothing, when the new specification does not fit', async () => {
    installer.checkAppRequirements.rejects(new Error('Insufficient RAM'));

    expect(await appRebuild.rebuildApp(spec)).to.equal(InstallOutcome.DECLINED);

    sinon.assert.notCalled(uninstaller.removeAppLocally);
    sinon.assert.notCalled(installer.registerAppLocally);
    sinon.assert.notCalled(uninstaller.announceRemoval);
  });

  it('installs nothing and tells the network nothing when the removal did not finish', async () => {
    uninstaller.removeAppLocally.resolves(RemovalOutcome.FAILED);

    expect(await appRebuild.rebuildApp(spec)).to.equal(InstallOutcome.FAILED);

    sinon.assert.notCalled(installer.registerAppLocally);
    sinon.assert.notCalled(uninstaller.announceRemoval);
  });

  it('tells the network nothing about an app that was not installed here', async () => {
    uninstaller.removeAppLocally.resolves(RemovalOutcome.NOT_INSTALLED);
    installer.registerAppLocally.resolves(InstallOutcome.FAILED);

    await appRebuild.rebuildApp(spec);

    sinon.assert.calledOnce(installer.registerAppLocally);
    sinon.assert.notCalled(uninstaller.announceRemoval);
  });

  it('publishes how each rebuild ended', async () => {
    await appRebuild.rebuildApp(spec);
    uninstaller.removeAppLocally.resolves(RemovalOutcome.FAILED);
    await appRebuild.rebuildApp(spec);

    expect(bus.publish.args).to.deep.equal([
      ['app:rebuilt', { name: 'myapp', outcome: InstallOutcome.INSTALLED }],
      ['app:rebuilt', { name: 'myapp', outcome: InstallOutcome.FAILED }],
    ]);
  });

  it('settles a removal it could not announce, and still answers', async () => {
    installer.registerAppLocally.resolves(InstallOutcome.FAILED);
    uninstaller.announceRemoval.rejects(new Error('no peers'));

    expect(await appRebuild.rebuildApp(spec)).to.equal(InstallOutcome.FAILED);
  });
});
