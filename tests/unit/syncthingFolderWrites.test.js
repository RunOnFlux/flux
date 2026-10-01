// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const syncthingService = require('../../ZelBack/src/services/syncthingService');
const globalState = require('../../ZelBack/src/services/utils/globalState');
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');
const { appsFolder } = require('../../ZelBack/src/services/utils/appConstants');
const { OWNED_FOLDER_SETTINGS } = require('../../ZelBack/src/services/appMonitoring/syncthingMonitorHelpers');
const syncthingFolderWrites = require('../../ZelBack/src/services/appMonitoring/syncthingFolderWrites');

describe('changeSyncthingFolderType', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('writes the type together with every setting FluxOS owns on the folder', async () => {
    sinon.stub(syncthingService, 'getConfigFolders').resolves([
      { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'receiveonly' },
    ]);
    const adjust = sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });

    const changed = await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive');

    expect(changed).to.equal(true);
    sinon.assert.calledOnceWithExactly(adjust, 'patch', { type: 'sendreceive', ...OWNED_FOLDER_SETTINGS }, 'fluxprobe_app');
    expect(adjust.firstCall.args[1].maxConflicts, 'a type change that omits maxConflicts hands the folder syncthing\'s default').to.equal(0);
  });

  it('writes nothing when the folder already has the type', async () => {
    sinon.stub(syncthingService, 'getConfigFolders').resolves([
      { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'sendreceive' },
    ]);
    const adjust = sinon.stub(syncthingService, 'adjustConfigFolders');

    const changed = await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive');

    expect(changed).to.equal(true);
    sinon.assert.notCalled(adjust);
  });

  describe('a write syncthing did not answer', () => {
    const unanswered = { status: 'error', data: { code: 'ECONNABORTED', httpStatus: null } };
    const folderOfType = (type) => [{ id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type }];

    beforeEach(() => {
      sinon.stub(serviceHelper, 'delay').callsFake(() => new Promise((resolve) => { setTimeout(resolve, 5); }));
    });

    it('succeeds when the type shows in the config within the wait', async () => {
      const read = sinon.stub(syncthingService, 'getConfigFolders');
      read.onFirstCall().resolves(folderOfType('receiveonly'));
      read.resolves(folderOfType('sendreceive'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves(unanswered);

      const changed = await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { settleMs: 1000 });

      expect(changed).to.equal(true);
    });

    it('fails when the type never shows within the wait', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOfType('receiveonly'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves(unanswered);

      const changed = await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { settleMs: 50 });

      expect(changed).to.equal(false);
    });

    it('fails at once without a wait', async () => {
      const read = sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOfType('receiveonly'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves(unanswered);

      const changed = await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive');

      expect(changed).to.equal(false);
      sinon.assert.calledOnce(read);
    });

    it('a write syncthing refused fails at once, even with a wait', async () => {
      const read = sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOfType('receiveonly'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'error', data: { httpStatus: 400 } });

      const changed = await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { settleMs: 1000 });

      expect(changed).to.equal(false);
      sinon.assert.calledOnce(read);
    });
  });
});

/** A syncthing write that answers only when `answer` is called. */
function heldWrite() {
  const held = {};
  held.promise = new Promise((resolve) => { held.answer = () => resolve({ status: 'success' }); });
  return held;
}

const tick = () => new Promise((resolve) => { setImmediate(resolve); });

describe('syncthing folder writes', () => {
  let savedWritable;

  beforeEach(() => {
    savedWritable = globalState.promotedFolderIds;
    globalState.promotedFolderIds = new Set();
  });

  afterEach(() => {
    globalState.promotedFolderIds = savedWritable;
    sinon.restore();
  });

  describe('one write at a time per folder', () => {
    it('sends a second write to a folder only once the first has ended', async () => {
      const first = heldWrite();
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders');
      adjust.onFirstCall().returns(first.promise);
      adjust.resolves({ status: 'success' });

      const writes = [
        syncthingFolderWrites.patchFolder('fluxprobe_app', { devices: [] }),
        syncthingFolderWrites.patchFolder('fluxprobe_app', { paused: true }),
      ];
      await tick();
      sinon.assert.calledOnce(adjust);

      first.answer();
      await Promise.all(writes);
      expect(adjust.getCalls().map((c) => c.args[1])).to.deep.equal([{ devices: [] }, { paused: true }]);
    });

    it('does not hold a write to one folder behind a write to another', async () => {
      const first = heldWrite();
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders');
      adjust.onFirstCall().returns(first.promise);
      adjust.resolves({ status: 'success' });

      const writes = [
        syncthingFolderWrites.patchFolder('fluxprobe_app', { paused: true }),
        syncthingFolderWrites.patchFolder('fluxother_app', { paused: true }),
      ];
      await tick();

      sinon.assert.calledTwice(adjust);
      first.answer();
      await Promise.all(writes);
    });

    it('holds a write of several folders behind a write to any one of them', async () => {
      const first = heldWrite();
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders');
      adjust.onFirstCall().returns(first.promise);
      adjust.resolves({ status: 'success' });

      const writes = [
        syncthingFolderWrites.patchFolder('fluxother_app', { paused: true }),
        syncthingFolderWrites.putFolders([
          { id: 'fluxprobe_app', type: 'receiveonly' },
          { id: 'fluxother_app', type: 'sendreceive' },
        ]),
      ];
      await tick();
      sinon.assert.calledOnce(adjust);

      first.answer();
      await Promise.all(writes);
      sinon.assert.calledTwice(adjust);
    });

    it('holds the next write to a folder while a type change waits to show', async () => {
      sinon.stub(serviceHelper, 'delay').callsFake(() => new Promise((resolve) => { setTimeout(resolve, 5); }));
      let applied = false;
      sinon.stub(syncthingService, 'getConfigFolders').callsFake(async () => [
        { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: applied ? 'sendreceive' : 'receiveonly' },
      ]);
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders');
      adjust.onFirstCall().resolves({ status: 'error', data: { code: 'ECONNABORTED', httpStatus: null } });
      adjust.resolves({ status: 'success' });

      const change = syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { settleMs: 1000 });
      const next = syncthingFolderWrites.patchFolder('fluxprobe_app', { devices: [] });
      await new Promise((resolve) => { setTimeout(resolve, 30); });
      sinon.assert.calledOnce(adjust);

      applied = true;
      expect(await change).to.equal(true);
      await next;
      sinon.assert.calledTwice(adjust);
    });

    it('asks whether to abandon a type change once the folder is its turn, and writes nothing if so', async () => {
      const first = heldWrite();
      sinon.stub(syncthingService, 'getConfigFolders').resolves([
        { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'receiveonly' },
      ]);
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders');
      adjust.onFirstCall().returns(first.promise);
      adjust.resolves({ status: 'success' });
      let abandon = false;

      const earlier = syncthingFolderWrites.patchFolder('fluxprobe_app', { devices: [] });
      const change = syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { abandonIf: () => abandon });
      await tick();
      abandon = true;
      first.answer();

      expect(await change).to.equal(false);
      await earlier;
      sinon.assert.calledOnce(adjust);
    });
  });

  describe('scanning before a type change', () => {
    it('scans before the write that changes the type', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves([
        { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'sendreceive' },
      ]);
      const scan = sinon.stub(syncthingService, 'scanFolder').resolves();
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });

      await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'receiveonly', { scanFirst: true });

      sinon.assert.callOrder(scan, adjust);
    });

    it('leaves the type unchanged when the scan does not finish', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves([
        { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'sendreceive' },
      ]);
      sinon.stub(syncthingService, 'scanFolder').rejects(new Error('timeout of 600000ms exceeded'));
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });

      expect(await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'receiveonly', { scanFirst: true })).to.equal(false);

      sinon.assert.notCalled(adjust);
    });

    it('lets the scan run as long as a scan of a large folder takes, not the client\'s default', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves([
        { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'sendreceive' },
      ]);
      const scan = sinon.stub(syncthingService, 'scanFolder').resolves();
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });

      await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'receiveonly', { scanFirst: true });

      sinon.assert.calledOnceWithExactly(scan, 'fluxprobe_app', { timeoutMs: 600000 });
    });

    it('does not hold the folder\'s other writes while it scans', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves([
        { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'sendreceive' },
      ]);
      let scanned;
      sinon.stub(syncthingService, 'scanFolder').returns(new Promise((resolve) => { scanned = resolve; }));
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });

      const change = syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'receiveonly', { scanFirst: true });
      await tick();
      expect(scanned, 'fixture: the scan is in progress').to.be.a('function');
      await syncthingFolderWrites.patchFolder('fluxprobe_app', { devices: [] });

      sinon.assert.calledOnceWithExactly(adjust, 'patch', { devices: [] }, 'fluxprobe_app');
      scanned();
      expect(await change).to.equal(true);
    });

    it('does not scan a folder that already has the type', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves([
        { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'receiveonly' },
      ]);
      const scan = sinon.stub(syncthingService, 'scanFolder').resolves();

      await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'receiveonly', { scanFirst: true });

      sinon.assert.notCalled(scan);
    });
  });

  describe('covering a folder restart', () => {
    const folderOf = (type) => [{ id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type }];

    it('scans a folder it turns sending twice, the second once the first has answered, before the change returns', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOf('receiveonly'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      const first = heldWrite();
      const scan = sinon.stub(syncthingService, 'scanFolder');
      scan.onFirstCall().returns(first.promise);
      scan.resolves({ status: 'success' });
      const count = sinon.spy(fluxEventBus, 'count');

      let returned = false;
      const change = syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive').then((r) => { returned = true; return r; });
      await tick();
      sinon.assert.calledOnce(scan);
      expect(returned, 'the change returned before its restart was covered').to.equal(false);

      first.answer();
      expect(await change).to.equal(true);
      sinon.assert.calledTwice(scan);
      expect(scan.getCalls().map((c) => c.args[0])).to.deep.equal(['fluxprobe_app', 'fluxprobe_app']);
      sinon.assert.calledWith(count, 'syncthing:restartCover', 'fluxprobe_app', 'covered');
    });

    it('scans nothing for a folder that receives', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOf('sendreceive'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      const scan = sinon.stub(syncthingService, 'scanFolder').resolves({ status: 'success' });
      globalState.promotedFolderIds.add('fluxprobe_app');

      await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'receiveonly');

      sinon.assert.notCalled(scan);
    });

    it('covers any write to a sending folder, and none that pauses it', async () => {
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      const scan = sinon.stub(syncthingService, 'scanFolder').resolves({ status: 'success' });
      globalState.promotedFolderIds.add('fluxprobe_app');

      await syncthingFolderWrites.patchFolder('fluxprobe_app', { devices: [] });
      sinon.assert.calledTwice(scan);

      scan.resetHistory();
      await syncthingFolderWrites.patchFolder('fluxprobe_app', { paused: true });
      sinon.assert.notCalled(scan);
    });

    it('covers each sending folder of a whole-folder write, and no receiving one', async () => {
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      const scan = sinon.stub(syncthingService, 'scanFolder').resolves({ status: 'success' });

      await syncthingFolderWrites.putFolders([
        { id: 'fluxsends_app', type: 'sendreceive' },
        { id: 'fluxreceives_app', type: 'receiveonly' },
      ]);

      expect(scan.getCalls().map((c) => c.args[0])).to.deep.equal(['fluxsends_app', 'fluxsends_app']);
    });

    it('holds the folder until its restart is covered, so the next write waits', async () => {
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      const held = heldWrite();
      const scan = sinon.stub(syncthingService, 'scanFolder');
      scan.onSecondCall().returns(held.promise);
      scan.resolves({ status: 'success' });
      globalState.promotedFolderIds.add('fluxprobe_app');

      const writes = [
        syncthingFolderWrites.patchFolder('fluxprobe_app', { devices: [] }),
        syncthingFolderWrites.patchFolder('fluxprobe_app', { label: 'next' }),
      ];
      await tick();
      await tick();
      sinon.assert.calledOnce(adjust);

      held.answer();
      await Promise.all(writes);
      sinon.assert.calledTwice(adjust);
    });

    it('stands the write when a scan does not finish, and makes no second scan', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOf('receiveonly'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      const scan = sinon.stub(syncthingService, 'scanFolder').rejects(new Error('timeout of 600000ms exceeded'));
      const count = sinon.spy(fluxEventBus, 'count');

      expect(await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive')).to.equal(true);

      sinon.assert.calledOnce(scan);
      sinon.assert.calledWith(count, 'syncthing:restartCover', 'fluxprobe_app', 'unfinished');
      sinon.assert.neverCalledWith(count, 'syncthing:restartCover', 'fluxprobe_app', 'covered');
    });

    it('covers a type change syncthing did not answer that applied later', async () => {
      const folders = sinon.stub(syncthingService, 'getConfigFolders');
      folders.onFirstCall().resolves(folderOf('receiveonly'));
      folders.resolves(folderOf('sendreceive'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'error', data: { httpStatus: null } });
      const scan = sinon.stub(syncthingService, 'scanFolder').resolves({ status: 'success' });

      expect(await syncthingFolderWrites.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { settleMs: 5000 })).to.equal(true);

      sinon.assert.calledTwice(scan);
    });
  });

  describe('writing whole folders', () => {
    it('refuses a folder without a type, which syncthing would write as its default', async () => {
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });

      let refusal;
      try {
        await syncthingFolderWrites.putFolders([{ id: 'fluxprobe_app', type: 'receiveonly' }, { id: 'fluxother_app' }]);
      } catch (error) {
        refusal = error;
      }

      expect(refusal?.message).to.contain('fluxother_app');
      sinon.assert.notCalled(adjust);
    });
  });

  describe('the types it records', () => {
    it('publishes a folder turning writable once, and tells peers it is writable', async () => {
      const publish = sinon.stub(fluxEventBus, 'publish');
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });

      await syncthingFolderWrites.putFolders([{ id: 'fluxprobe_app', type: 'sendreceive' }]);
      await syncthingFolderWrites.patchFolder('fluxprobe_app', { type: 'sendreceive' });

      expect(publish.getCalls().filter((c) => c.args[0] === 'syncthing:folderWritable').map((c) => c.args[1]))
        .to.deep.equal([{ folder: 'fluxprobe_app' }]);
      expect(globalState.promotedFolderIds.has('fluxprobe_app')).to.equal(true);
    });

    it('publishes a folder a monitor pass found writable before its writer recorded it, once', async () => {
      const publish = sinon.stub(fluxEventBus, 'publish');
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      globalState.promotedFolderIds = new Set(['fluxother_app']);

      syncthingFolderWrites.publishWritable(new Set(['fluxother_app', 'fluxprobe_app']));
      await syncthingFolderWrites.patchFolder('fluxprobe_app', { type: 'sendreceive' });

      expect(publish.getCalls().filter((c) => c.args[0] === 'syncthing:folderWritable').map((c) => c.args[1]))
        .to.deep.equal([{ folder: 'fluxprobe_app' }]);
    });

    it('publishes nothing for the folders the first pass after a start finds writable', () => {
      const publish = sinon.stub(fluxEventBus, 'publish');
      globalState.promotedFolderIds = null;

      syncthingFolderWrites.publishWritable(new Set(['fluxprobe_app']));

      sinon.assert.neverCalledWith(publish, 'syncthing:folderWritable');
      expect(globalState.promotedFolderIds.has('fluxprobe_app')).to.equal(true);
    });

    it('stops telling peers a folder is writable once it receives', async () => {
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      globalState.promotedFolderIds.add('fluxprobe_app');

      await syncthingFolderWrites.patchFolder('fluxprobe_app', { type: 'receiveonly' });

      expect(globalState.promotedFolderIds.has('fluxprobe_app')).to.equal(false);
    });

    it('records nothing for a write that sends no type, or that syncthing refused', async () => {
      const publish = sinon.stub(fluxEventBus, 'publish');
      const adjust = sinon.stub(syncthingService, 'adjustConfigFolders');
      adjust.onFirstCall().resolves({ status: 'success' });
      adjust.onSecondCall().resolves({ status: 'error', data: { httpStatus: 500 } });
      const mark = syncthingFolderWrites.mark();

      await syncthingFolderWrites.patchFolder('fluxprobe_app', { devices: [] });
      await syncthingFolderWrites.patchFolder('fluxprobe_app', { type: 'sendreceive' });

      expect(syncthingFolderWrites.typesRecordedSince(mark)).to.deep.equal([]);
      sinon.assert.neverCalledWith(publish, 'syncthing:folderWritable');
    });

    it('answers the types written since a mark, and only those', async () => {
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });
      await syncthingFolderWrites.patchFolder('fluxprobe_app', { type: 'receiveonly' });
      const mark = syncthingFolderWrites.mark();

      await syncthingFolderWrites.patchFolder('fluxother_app', { type: 'sendreceive' });

      expect(syncthingFolderWrites.typesRecordedSince(mark)).to.deep.equal([['fluxother_app', 'sendreceive']]);
    });
  });
});
