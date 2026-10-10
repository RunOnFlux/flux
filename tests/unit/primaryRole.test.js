// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const globalState = require('../../ZelBack/src/services/utils/globalState');
const peerComponent = require('../../ZelBack/src/services/appMonitoring/peerComponent');

const { PeerComponent } = peerComponent;

const APP = 'n8n_n8napp';
const FOLDER = 'fluxn8n_n8napp';

/**
 * The role owner with everything it reaches outside itself replaced. The order of
 * the calls it makes is what these tests are about, so every collaborator writes
 * to one shared log.
 */
function loadRole({
  primary = false, changeType, folder = null, operatorStopped = false, inSlot = async () => {}, afterRun = () => {},
} = {}) {
  const calls = [];
  const note = (name) => (...args) => { calls.push([name, ...args]); };
  const reconciler = {
    committed: primary ? [APP] : [],
    committedIdentifiers: sinon.spy(() => reconciler.committed),
    // Writes the desire to run only when the caller's `unless` and the operator
    // allow it, as the reconciler decides it in its per-key slot. `inSlot` runs
    // once the slot is held, `afterRun` once the desire is written.
    setRunningUnlessOperatorStopped: sinon.spy(async (id, _reason, { unless = () => false } = {}) => {
      note('setRunningUnlessOperatorStopped')(id, { operatorStopped });
      await inSlot();
      if (unless() || operatorStopped) return false;
      reconciler.committed = [id];
      afterRun();
      return true;
    }),
    setControllerDesiredAndWait: sinon.spy(async (id, state) => {
      note('setControllerDesiredAndWait')(id, state);
      if (state === 'stopped') reconciler.committed = [];
      return true;
    }),
    dockerActual: sinon.stub().resolves({ reachable: true, exists: true, running: false }),
    // Records a verdict where none is held; what it answers is the reconciler's.
    adoptControllerDesired: sinon.stub().resolves(true),
    hasControllerOpinion: sinon.stub().returns(false),
  };
  // Records each type change with the options that shape it; `changeType` decides
  // what the write answers.
  const folderWrites = {
    changeSyncthingFolderType: sinon.spy((id, type, options = {}) => {
      if (options.abandonIf?.()) return Promise.resolve(false);
      const { scanFirst, unpause } = options;
      calls.push(['folder', id, type, ...(scanFirst ? ['scanFirst'] : []), ...(unpause ? ['unpause'] : [])]);
      return changeType ? changeType(id, type) : Promise.resolve(true);
    }),
    patchFolder: sinon.spy(async (id, fields) => { note('patch')(id, fields); return { status: 'success' }; }),
    folderConfig: sinon.stub().resolves(folder),
    FOLDER_TYPE_SETTLE_MS: 60000,
  };
  const bus = {
    publish: sinon.stub(),
    count: sinon.stub(),
    checkpoint: sinon.spy(async (name, key) => { note('checkpoint')(name, key); }),
    Checkpoint: { MASTERSLAVE_BEFORE_START: 'masterSlave:beforeStart', MASTERSLAVE_BEFORE_RUN: 'masterSlave:beforeRun' },
  };
  const changes = proxyquire('../../ZelBack/src/services/appLifecycle/primaryRoleChanges', {});
  const role = proxyquire('../../ZelBack/src/services/appLifecycle/primaryRole', {
    '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    '../utils/fluxEventBus': bus,
    '../appMonitoring/appReconciler': reconciler,
    '../appMonitoring/syncthingFolderWrites': folderWrites,
    './primaryRoleChanges': changes,
    '../appMonitoring/peerComponent': peerComponent,
  });
  const roleEvents = () => bus.publish.getCalls().filter((c) => c.args[0] === 'primaryRole:changed').map((c) => c.args[1]);
  return {
    role, changes, calls, reconciler, folderWrites, bus, roleEvents,
  };
}

/** A type write that answers only when the returned function is called. */
function heldSend() {
  const held = {};
  held.changeType = (id, type) => (type === 'sendreceive'
    ? new Promise((resolve) => { held.answer = resolve; })
    : Promise.resolve(true));
  return held;
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
        ['checkpoint', 'masterSlave:beforeRun', APP],
        ['setRunningUnlessOperatorStopped', APP, { operatorStopped: false }],
      ]);
      expect(t.roleEvents()).to.deep.equal([
        { identifier: APP, from: 'standby', to: 'promoting' },
        { identifier: APP, from: 'promoting', to: 'primary' },
      ]);
      sinon.assert.calledWith(t.bus.publish, 'masterSlave:started', { identifier: APP });
      sinon.assert.calledWith(t.bus.count, 'masterSlave:decision', APP, 'started');
    });

    // A stop given while the folder turned lands before the desire to run. The
    // component stays held by the lock with its folder sending, and nothing is
    // asked to run it.
    it('leaves a component its operator stopped mid-promotion stopped, its folder sending', async () => {
      const t = loadRole({ operatorStopped: true });

      expect(t.role.promote(APP, FOLDER)).to.equal(true);
      await t.role.whenSettled(APP);

      expect(t.calls).to.deep.equal([
        ['checkpoint', 'masterSlave:beforeStart', APP],
        ['folder', FOLDER, 'sendreceive'],
        ['checkpoint', 'masterSlave:beforeRun', APP],
        ['setRunningUnlessOperatorStopped', APP, { operatorStopped: true }],
      ]);
      expect(t.roleEvents()).to.deep.equal([
        { identifier: APP, from: 'standby', to: 'promoting' },
        { identifier: APP, from: 'promoting', to: 'standby', reason: 'its operator stopped it' },
      ]);
      expect(t.reconciler.committed).to.deep.equal([]);
      expect(t.changes.promotingIdentifiers()).to.deep.equal([]);
    });

    it('holds the component while promoting, and not once the change has ended', async () => {
      const held = heldSend();
      const t = loadRole({ changeType: held.changeType });

      t.role.promote(APP, FOLDER);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(t.changes.promotingIdentifiers()).to.deep.equal([APP]);
      expect(t.role.inTransition(APP)).to.equal('promoting');

      held.answer(true);
      await t.role.whenSettled(APP);
      expect(t.changes.promotingIdentifiers()).to.deep.equal([]);
      expect(t.role.inTransition(APP)).to.equal(null);
    });

    it('begins nothing while a promotion is in progress', async () => {
      const t = loadRole();

      expect(t.role.promote(APP, FOLDER)).to.equal(true);
      expect(t.role.promote(APP, FOLDER), 'a second promotion began while the first was running').to.equal(false);
      await t.role.whenSettled(APP);

      sinon.assert.calledOnce(t.folderWrites.changeSyncthingFolderType);
      sinon.assert.calledOnce(t.bus.count);
    });

    it('begins nothing once this node is the primary', async () => {
      const t = loadRole({ primary: true });

      expect(t.role.promote(APP, FOLDER)).to.equal(false);

      expect(t.calls).to.deep.equal([]);
      sinon.assert.notCalled(t.bus.publish);
    });

    it('does not ask for the container when the folder does not send, and ends as a standby', async () => {
      const t = loadRole({ changeType: async () => false });

      t.role.promote(APP, FOLDER);
      await t.role.whenSettled(APP);

      sinon.assert.notCalled(t.reconciler.setRunningUnlessOperatorStopped);
      expect(t.roleEvents().at(-1)).to.deep.equal({
        identifier: APP, from: 'promoting', to: 'standby', reason: 'the folder did not send',
      });
      expect(t.role.inTransition(APP)).to.equal(null);
    });
  });

  describe('standing down', () => {
    // Another node runs it, so both have been writing: what this one had not yet
    // sent is discarded, never sent over the elected copy.
    it('stops the container, then makes the folder receive, unscanned', async () => {
      const t = loadRole({ primary: true });

      expect(t.role.standDown(APP, FOLDER, { running: true })).to.equal(true);
      await t.role.whenSettled(APP);

      expect(t.calls).to.deep.equal([
        ['setControllerDesiredAndWait', APP, 'stopped'],
        ['folder', FOLDER, 'receiveonly'],
      ]);
      expect(t.roleEvents()).to.deep.equal([
        { identifier: APP, from: 'primary', to: 'demoting' },
        { identifier: APP, from: 'demoting', to: 'standby' },
      ]);
    });

    it('ends as a standby whose folder still sends when the folder could not be made to receive', async () => {
      const t = loadRole({ primary: true, changeType: async () => false });

      t.role.standDown(APP, FOLDER, { running: true });
      await t.role.whenSettled(APP);

      expect(t.roleEvents().at(-1)).to.deep.equal({
        identifier: APP, from: 'demoting', to: 'standby', reason: 'the folder still sends: it was not changed',
      });
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
      const held = heldSend();
      const t = loadRole({ changeType: held.changeType });

      t.role.promote(APP, FOLDER);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(t.role.standDown(APP, FOLDER), 'a promotion in progress was not stood down').to.equal(true);
      held.answer(true);
      await t.role.whenSettled(APP);

      sinon.assert.notCalled(t.reconciler.setRunningUnlessOperatorStopped);
      expect(t.calls.filter(([name]) => name === 'folder')).to.deep.equal([
        ['folder', FOLDER, 'sendreceive'],
        ['folder', FOLDER, 'receiveonly'],
      ]);
      expect(t.roleEvents().at(-1)).to.deep.equal({
        identifier: APP, from: 'promoting', to: 'standby', reason: 'stood down before it ran',
      });
    });

    it('publishes the first stand-down a promotion is given, and no repeat', async () => {
      const held = heldSend();
      const t = loadRole({ changeType: held.changeType });

      t.role.promote(APP, FOLDER);
      await new Promise((resolve) => { setImmediate(resolve); });
      t.role.standDown(APP, FOLDER);
      t.role.standDown(APP, FOLDER);
      held.answer(true);
      await t.role.whenSettled(APP);

      const given = t.bus.publish.getCalls().filter((c) => c.args[0] === 'primaryRole:standDownGiven').map((c) => c.args[1]);
      expect(given).to.deep.equal([{ identifier: APP }]);
    });

    it('asks for no container when it is stood down while the start waits for the reconciler', async () => {
      let t;
      t = loadRole({ inSlot: async () => { t.role.standDown(APP, FOLDER); } });

      t.role.promote(APP, FOLDER);
      await t.role.whenSettled(APP);

      sinon.assert.calledOnce(t.reconciler.setRunningUnlessOperatorStopped);
      expect(t.reconciler.committed, 'the container was asked to run').to.deep.equal([]);
      expect(t.calls.filter(([name]) => name === 'folder')).to.deep.equal([
        ['folder', FOLDER, 'sendreceive'],
        ['folder', FOLDER, 'receiveonly'],
      ]);
      expect(t.roleEvents().at(-1)).to.deep.equal({
        identifier: APP, from: 'promoting', to: 'standby', reason: 'stood down before it ran',
      });
    });

    it('stands down the moment the promotion ends when it is stood down once the container was asked to run', async () => {
      let t;
      t = loadRole({ afterRun: () => { expect(t.role.standDown(APP, FOLDER), 'a promotion in progress was not stood down').to.equal(true); } });

      t.role.promote(APP, FOLDER);
      await t.role.whenSettled(APP);
      await new Promise((resolve) => { setImmediate(resolve); });
      await t.role.whenSettled(APP);

      sinon.assert.calledWith(t.reconciler.setControllerDesiredAndWait, APP, 'stopped');
      expect(t.reconciler.committed, 'still the primary').to.deep.equal([]);
      expect(t.calls.filter(([name]) => name === 'folder').at(-1)).to.deep.equal(['folder', FOLDER, 'receiveonly']);
      expect(t.roleEvents().map(({ from, to }) => `${from}->${to}`)).to.deep.equal([
        'standby->promoting', 'promoting->primary', 'primary->demoting', 'demoting->standby',
      ]);
    });

    it('has the folder write of a promotion abandoned once it is stood down', async () => {
      const held = heldSend();
      const t = loadRole({ changeType: held.changeType });

      t.role.promote(APP, FOLDER);
      await new Promise((resolve) => { setImmediate(resolve); });
      const { abandonIf } = t.folderWrites.changeSyncthingFolderType.firstCall.args[2];
      expect(abandonIf(), 'fixture: a promotion not stood down goes ahead').to.equal(false);
      t.role.standDown(APP, FOLDER);

      expect(abandonIf()).to.equal(true);
      held.answer(true);
      await t.role.whenSettled(APP);
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

  describe('keeping the folder in line with the role', () => {
    it('keeps the folder of the primary running here sending', async () => {
      const t = loadRole({ primary: true });

      expect(await t.role.holdAsPrimary(APP, FOLDER)).to.equal(true);

      expect(t.calls).to.deep.equal([['folder', FOLDER, 'sendreceive']]);
    });

    it('keeps the folder of a standby receiving, scanned first', async () => {
      const t = loadRole();

      expect(await t.role.holdAsStandby(APP, FOLDER)).to.equal(true);

      expect(t.calls).to.deep.equal([['folder', FOLDER, 'receiveonly', 'scanFirst']]);
    });

    it('does not make the folder of the primary receive', async () => {
      const t = loadRole({ primary: true });

      expect(await t.role.holdAsStandby(APP, FOLDER)).to.equal(false);

      expect(t.calls).to.deep.equal([]);
      sinon.assert.notCalled(t.reconciler.adoptControllerDesired);
    });

    // A FluxOS restart leaves each container where it was with no verdict recorded,
    // and the reconciler acts on the component, a restart included, only once one is.
    it('records running for the primary running here', async () => {
      const t = loadRole({ primary: true });

      await t.role.holdAsPrimary(APP, FOLDER);

      sinon.assert.calledOnceWithExactly(t.reconciler.adoptControllerDesired, APP, 'running', 'masterSlave primary');
      sinon.assert.calledWith(t.bus.count, 'masterSlave:decision', APP, 'adopted');
    });

    it('records stopped for a standby', async () => {
      const t = loadRole();

      await t.role.holdAsStandby(APP, FOLDER);

      sinon.assert.calledOnceWithExactly(t.reconciler.adoptControllerDesired, APP, 'stopped', 'masterSlave standby');
      sinon.assert.calledWith(t.bus.count, 'masterSlave:decision', APP, 'adopted');
    });

    it('counts no adoption the reconciler did not make', async () => {
      const t = loadRole({ primary: true });
      t.reconciler.adoptControllerDesired.resolves(false);

      expect(await t.role.holdAsPrimary(APP, FOLDER)).to.equal(true);

      sinon.assert.neverCalledWith(t.bus.count, 'masterSlave:decision', APP, 'adopted');
    });

    it('asks no adoption for a component this process holds an opinion on', async () => {
      const t = loadRole({ primary: true });
      t.reconciler.hasControllerOpinion.returns(true);

      expect(await t.role.holdAsPrimary(APP, FOLDER)).to.equal(true);

      sinon.assert.calledWith(t.reconciler.hasControllerOpinion, APP);
      sinon.assert.notCalled(t.reconciler.adoptControllerDesired);
    });

    ['holdAsPrimary', 'holdAsStandby'].forEach((hold) => {
      it(`${hold} writes nothing during a change of role`, async () => {
        const held = heldSend();
        const t = loadRole({ changeType: held.changeType });
        t.role.promote(APP, FOLDER);
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(t.role.inTransition(APP), 'fixture: a promotion is in progress').to.equal('promoting');

        expect(await t.role[hold](APP, FOLDER)).to.equal(false);

        expect(t.calls.filter(([name]) => name === 'folder')).to.deep.equal([['folder', FOLDER, 'sendreceive']]);
        sinon.assert.notCalled(t.reconciler.adoptControllerDesired);
        held.answer(true);
        await t.role.whenSettled(APP);
      });
    });
  });

  describe('a primary returning with its folder paused', () => {
    const PAUSED_SENDING = { id: FOLDER, type: 'sendreceive', paused: true };
    const returned = (t) => t.bus.publish.getCalls().filter((c) => c.args[0] === 'primaryRole:returned').map((c) => c.args[1]);

    afterEach(() => {
      globalState.finishBackup('n8napp');
      globalState.finishRestore('n8napp');
    });

    it('discards what it holds when another holder runs the component: receives, unpaused, unscanned, in one write', async () => {
      const t = loadRole({ folder: PAUSED_SENDING });

      expect(await t.role.holdAsStandby(APP, FOLDER, { othersHold: async () => PeerComponent.RUNNING })).to.equal(true);

      expect(t.calls).to.deep.equal([['folder', FOLDER, 'receiveonly', 'unpause']]);
      expect(returned(t)).to.deep.equal([{ identifier: APP, outcome: 'discarded' }]);
    });

    it('resumes as primary when no other holder runs the component: unpaused, sending, then asked to run', async () => {
      const t = loadRole({ folder: PAUSED_SENDING });

      expect(await t.role.holdAsStandby(APP, FOLDER, { othersHold: async () => PeerComponent.NOT_RUNNING })).to.equal(true);
      await t.role.whenSettled(APP);

      expect(t.calls[0]).to.deep.equal(['patch', FOLDER, { paused: false }]);
      expect(t.calls.filter((c) => c[0] === 'folder' && c[2] === 'receiveonly'), 'the folder made to receive').to.deep.equal([]);
      expect(t.calls.map((c) => c[0])).to.include('setRunningUnlessOperatorStopped');
      expect(t.role.inTransition(APP)).to.equal(null);
      expect(t.reconciler.committed).to.deep.equal([APP]);
      expect(returned(t)).to.deep.equal([{ identifier: APP, outcome: 'kept' }]);
    });

    it('stays paused while a holder cannot be ruled out', async () => {
      const t = loadRole({ folder: PAUSED_SENDING });

      expect(await t.role.holdAsStandby(APP, FOLDER, { othersHold: async () => PeerComponent.UNKNOWN })).to.equal(false);

      expect(t.calls).to.deep.equal([]);
      sinon.assert.calledWith(t.bus.count, 'primaryRole:returned', APP, 'heldPaused');
    });

    it('stays paused when its caller cannot ask the other holders', async () => {
      const t = loadRole({ folder: PAUSED_SENDING });

      expect(await t.role.holdAsStandby(APP, FOLDER)).to.equal(false);

      expect(t.calls).to.deep.equal([]);
    });

    ['tryStartBackup', 'tryStartRestore'].forEach((claim) => {
      it(`stays paused while ${claim === 'tryStartBackup' ? 'a backup' : 'a restore'} holds the app`, async () => {
        const t = loadRole({ folder: PAUSED_SENDING });
        globalState[claim]('n8napp');

        expect(await t.role.holdAsStandby(APP, FOLDER, { othersHold: async () => PeerComponent.RUNNING })).to.equal(false);

        expect(t.calls).to.deep.equal([]);
      });
    });

    it('writes nothing when this node became the primary while it asked', async () => {
      const t = loadRole({ folder: PAUSED_SENDING });

      const othersHold = async () => { t.reconciler.committed = [APP]; return PeerComponent.RUNNING; };
      expect(await t.role.holdAsStandby(APP, FOLDER, { othersHold })).to.equal(false);

      expect(t.calls).to.deep.equal([]);
    });

    it('writes nothing when a promotion began while it asked', async () => {
      const t = loadRole({ folder: PAUSED_SENDING });

      const othersHold = async () => { t.role.promote(APP, FOLDER); return PeerComponent.RUNNING; };
      expect(await t.role.holdAsStandby(APP, FOLDER, { othersHold })).to.equal(false);
      await t.role.whenSettled(APP);

      expect(t.calls.filter(([name]) => name === 'folder')).to.deep.equal([['folder', FOLDER, 'sendreceive']]);
    });

    it('does not make the folder receive when the unpause fails', async () => {
      const t = loadRole({ folder: PAUSED_SENDING });
      t.folderWrites.patchFolder = sinon.stub().resolves({ status: 'error' });

      expect(await t.role.holdAsStandby(APP, FOLDER, { othersHold: async () => PeerComponent.NOT_RUNNING })).to.equal(false);

      expect(t.calls).to.deep.equal([]);
      expect(returned(t)).to.deep.equal([]);
    });

    it('does not ask the other holders about a folder that is not paused', async () => {
      const t = loadRole({ folder: { ...PAUSED_SENDING, paused: false } });
      const othersHold = sinon.stub().resolves(PeerComponent.RUNNING);

      expect(await t.role.holdAsStandby(APP, FOLDER, { othersHold })).to.equal(true);

      sinon.assert.notCalled(othersHold);
      expect(t.calls).to.deep.equal([['folder', FOLDER, 'receiveonly', 'scanFirst']]);
    });

    it('does not ask the other holders about a paused folder that already receives', async () => {
      const t = loadRole({ folder: { ...PAUSED_SENDING, type: 'receiveonly' } });
      const othersHold = sinon.stub().resolves(PeerComponent.RUNNING);

      await t.role.holdAsStandby(APP, FOLDER, { othersHold });

      sinon.assert.notCalled(othersHold);
    });
  });

  describe('a safety demotion', () => {
    it('makes the folder receive at once, unscanned', async () => {
      const t = loadRole();

      const response = await t.role.demoteForSafety(FOLDER);

      expect(response.status).to.equal('success');
      expect(t.calls).to.deep.equal([['patch', FOLDER, { type: 'receiveonly' }]]);
    });

    it('abandons a promotion in progress, which then never runs the component', async () => {
      const held = heldSend();
      const t = loadRole({ changeType: held.changeType });
      t.role.promote(APP, FOLDER);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(t.role.inTransition(APP), 'fixture: a promotion is in progress').to.equal('promoting');

      await t.role.demoteForSafety(FOLDER);
      held.answer(true);
      await t.role.whenSettled(APP);

      sinon.assert.notCalled(t.reconciler.setRunningUnlessOperatorStopped);
      expect(t.roleEvents().at(-1)).to.deep.equal({
        identifier: APP, from: 'promoting', to: 'standby', reason: 'stood down before it ran',
      });
    });
  });
});
