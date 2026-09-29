// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const APP = 'n8n_n8napp';
const FOLDER = 'fluxn8n_n8napp';

/**
 * The role owner with everything it reaches outside itself replaced. The order of
 * the calls it makes is what these tests are about, so every collaborator writes
 * to one shared log.
 */
function loadRole({ primary = false } = {}) {
  const calls = [];
  const note = (name) => (...args) => { calls.push([name, ...args]); };
  const reconciler = {
    committed: primary ? [APP] : [],
    committedIdentifiers: sinon.spy(() => reconciler.committed),
    setControllerDesired: sinon.spy((id, state) => {
      note('setControllerDesired')(id, state);
      if (state === 'running') reconciler.committed = [id];
    }),
    setControllerDesiredAndWait: sinon.spy(async (id, state) => {
      note('setControllerDesiredAndWait')(id, state);
      if (state === 'stopped') reconciler.committed = [];
      return true;
    }),
    dockerActual: sinon.stub().resolves({ reachable: true, exists: true, running: false }),
  };
  const folderType = {
    changeSyncthingFolderType: sinon.spy(async (id, type) => { note('folder')(id, type); return true; }),
    FOLDER_TYPE_SETTLE_MS: 60000,
  };
  const syncthing = { scanFolder: sinon.spy(async (id) => { note('scan')(id); }) };
  const bus = {
    publish: sinon.stub(),
    count: sinon.stub(),
    checkpoint: sinon.spy(async (name, key) => { note('checkpoint')(name, key); }),
    Checkpoint: { MASTERSLAVE_BEFORE_START: 'masterSlave:beforeStart' },
  };
  const changes = proxyquire('../../ZelBack/src/services/appLifecycle/primaryRoleChanges', {});
  const role = proxyquire('../../ZelBack/src/services/appLifecycle/primaryRole', {
    '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    '../utils/fluxEventBus': bus,
    '../syncthingService': syncthing,
    '../appMonitoring/appReconciler': reconciler,
    '../appMonitoring/syncthingFolderType': folderType,
    './primaryRoleChanges': changes,
  });
  const roleEvents = () => bus.publish.getCalls().filter((c) => c.args[0] === 'primaryRole:changed').map((c) => c.args[1]);
  return {
    role, changes, calls, reconciler, folderType, syncthing, bus, roleEvents,
  };
}

describe('primaryRole', () => {
  describe('becoming the primary', () => {
    it('makes the folder send before it asks the reconciler to run the component', async () => {
      const t = loadRole();

      expect(t.role.promote(APP, FOLDER)).to.equal(true);
      await t.role.whenSettled(APP);

      expect(t.calls).to.deep.equal([
        ['checkpoint', 'masterSlave:beforeStart', APP],
        ['folder', FOLDER, 'sendreceive'],
        ['setControllerDesired', APP, 'running'],
      ]);
      expect(t.roleEvents()).to.deep.equal([
        { identifier: APP, from: 'standby', to: 'promoting' },
        { identifier: APP, from: 'promoting', to: 'primary' },
      ]);
      sinon.assert.calledWith(t.bus.publish, 'masterSlave:started', { identifier: APP });
      sinon.assert.calledWith(t.bus.count, 'masterSlave:decision', APP, 'started');
    });

    it('holds the component while promoting, and not once the change has ended', async () => {
      const t = loadRole();
      let sent;
      t.folderType.changeSyncthingFolderType = sinon.spy(() => new Promise((resolve) => { sent = () => resolve(true); }));
      const role = proxyquire('../../ZelBack/src/services/appLifecycle/primaryRole', {
        '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
        '../utils/fluxEventBus': t.bus,
        '../syncthingService': t.syncthing,
        '../appMonitoring/appReconciler': t.reconciler,
        '../appMonitoring/syncthingFolderType': t.folderType,
        './primaryRoleChanges': t.changes,
      });

      role.promote(APP, FOLDER);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(t.changes.promotingIdentifiers()).to.deep.equal([APP]);
      expect(role.inTransition(APP)).to.equal('promoting');

      sent();
      await role.whenSettled(APP);
      expect(t.changes.promotingIdentifiers()).to.deep.equal([]);
      expect(role.inTransition(APP)).to.equal(null);
    });

    it('begins nothing while a promotion is in progress', async () => {
      const t = loadRole();

      expect(t.role.promote(APP, FOLDER)).to.equal(true);
      expect(t.role.promote(APP, FOLDER), 'a second promotion began while the first was running').to.equal(false);
      await t.role.whenSettled(APP);

      sinon.assert.calledOnce(t.folderType.changeSyncthingFolderType);
      sinon.assert.calledOnce(t.bus.count);
    });

    it('begins nothing once this node is the primary', async () => {
      const t = loadRole({ primary: true });

      expect(t.role.promote(APP, FOLDER)).to.equal(false);

      expect(t.calls).to.deep.equal([]);
      sinon.assert.notCalled(t.bus.publish);
    });

    it('does not ask for the container when the folder does not send, and ends as a standby', async () => {
      const t = loadRole();
      t.folderType.changeSyncthingFolderType = sinon.spy(async () => false);
      const role = proxyquire('../../ZelBack/src/services/appLifecycle/primaryRole', {
        '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
        '../utils/fluxEventBus': t.bus,
        '../syncthingService': t.syncthing,
        '../appMonitoring/appReconciler': t.reconciler,
        '../appMonitoring/syncthingFolderType': t.folderType,
        './primaryRoleChanges': t.changes,
      });

      role.promote(APP, FOLDER);
      await role.whenSettled(APP);

      sinon.assert.notCalled(t.reconciler.setControllerDesired);
      expect(t.roleEvents().at(-1)).to.deep.equal({
        identifier: APP, from: 'promoting', to: 'standby', reason: 'the folder did not send',
      });
      expect(role.inTransition(APP)).to.equal(null);
    });
  });

  describe('standing down', () => {
    it('stops the container, then scans the folder, then makes it receive', async () => {
      const t = loadRole({ primary: true });

      expect(t.role.standDown(APP, FOLDER, { running: true })).to.equal(true);
      await t.role.whenSettled(APP);

      expect(t.calls).to.deep.equal([
        ['setControllerDesiredAndWait', APP, 'stopped'],
        ['scan', FOLDER],
        ['folder', FOLDER, 'receiveonly'],
      ]);
      expect(t.roleEvents()).to.deep.equal([
        { identifier: APP, from: 'primary', to: 'demoting' },
        { identifier: APP, from: 'demoting', to: 'standby' },
      ]);
    });

    [
      ['docker cannot be reached', { reachable: false, exists: false, running: false }],
      ['its state cannot be read', {
        reachable: true, exists: true, running: false, indeterminate: true,
      }],
      ['the container still runs', { reachable: true, exists: true, running: true }],
    ].forEach(([when, actual]) => {
      it(`keeps the folder sending when ${when}`, async () => {
        const t = loadRole({ primary: true });
        t.reconciler.dockerActual.resolves(actual);

        t.role.standDown(APP, FOLDER, { running: true });
        await t.role.whenSettled(APP);

        expect(t.calls).to.deep.equal([['setControllerDesiredAndWait', APP, 'stopped']]);
        expect(t.roleEvents().at(-1)).to.deep.equal({
          identifier: APP, from: 'demoting', to: 'primary', reason: 'the container is not confirmed stopped',
        });
      });
    });

    it('abandons a promotion in progress before it asks for the container', async () => {
      const t = loadRole();
      let sent;
      t.folderType.changeSyncthingFolderType = sinon.spy((id, type) => {
        t.calls.push(['folder', id, type]);
        return type === 'sendreceive' ? new Promise((resolve) => { sent = () => resolve(true); }) : Promise.resolve(true);
      });
      const role = proxyquire('../../ZelBack/src/services/appLifecycle/primaryRole', {
        '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
        '../utils/fluxEventBus': t.bus,
        '../syncthingService': t.syncthing,
        '../appMonitoring/appReconciler': t.reconciler,
        '../appMonitoring/syncthingFolderType': t.folderType,
        './primaryRoleChanges': t.changes,
      });

      role.promote(APP, FOLDER);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(role.standDown(APP, FOLDER), 'a promotion in progress was not stood down').to.equal(true);
      sent();
      await role.whenSettled(APP);

      sinon.assert.notCalled(t.reconciler.setControllerDesired);
      expect(t.calls.filter(([name]) => name === 'folder')).to.deep.equal([
        ['folder', FOLDER, 'sendreceive'],
        ['folder', FOLDER, 'receiveonly'],
      ]);
      expect(t.roleEvents().at(-1)).to.deep.equal({
        identifier: APP, from: 'promoting', to: 'standby', reason: 'stood down before it ran',
      });
    });

    it('has nothing to stand down from on a standby that runs nothing', () => {
      const t = loadRole();

      expect(t.role.standDown(APP, FOLDER, { running: false })).to.equal(false);

      expect(t.calls).to.deep.equal([]);
    });

    it('begins nothing while a stand-down is in progress', async () => {
      const t = loadRole({ primary: true });

      expect(t.role.standDown(APP, FOLDER, { running: true })).to.equal(true);
      expect(t.role.standDown(APP, FOLDER, { running: true })).to.equal(false);
      await t.role.whenSettled(APP);

      sinon.assert.calledOnce(t.reconciler.setControllerDesiredAndWait);
    });
  });
});
