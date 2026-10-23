const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');
const syncthingFolderWrites = require('../../ZelBack/src/services/appMonitoring/syncthingFolderWrites');

const syncthingServiceMock = {
  getDeviceId: sinon.stub(),
  getDbLocalChanged: sinon.stub(),
  getDbFile: sinon.stub(),
  dbRevert: sinon.stub(),
  getDbStatus: sinon.stub(),
  getConfigFolders: sinon.stub(),
};
const localChangeCheck = proxyquire('../../ZelBack/src/services/appMonitoring/localChangeCheck', {
  '../syncthingService': syncthingServiceMock,
});

async function settled() {
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

// A read that waits until the test lets it answer.
function held(answer) {
  let release;
  const promise = new Promise((resolve) => { release = () => resolve(answer); });
  return { promise, release };
}

// The folder a revert's check was made against, as syncthing describes it.
const FOLDER_STATUS = { receiveOnlyChangedFiles: 1, receiveOnlyChangedBytes: 10 };
const FOLDER_DEVICES = [{ deviceID: 'LOCAL-DEVICE' }, { deviceID: 'PRIMARY-DEVICE' }];

describe('localChangeCheck tests', () => {
  beforeEach(() => {
    syncthingServiceMock.getDeviceId.reset();
    syncthingServiceMock.getDeviceId.resolves('LOCAL-DEVICE');
    syncthingServiceMock.getDbLocalChanged.reset();
    syncthingServiceMock.getDbLocalChanged.resolves({ files: [] });
    syncthingServiceMock.getDbFile.reset();
    syncthingServiceMock.getDbFile.resolves({ global: { localFlags: 0 } });
    syncthingServiceMock.dbRevert.reset();
    syncthingServiceMock.dbRevert.resolves({ status: 'success', data: {} });
    syncthingServiceMock.getDbStatus.reset();
    syncthingServiceMock.getDbStatus.resolves(FOLDER_STATUS);
    syncthingServiceMock.getConfigFolders.reset();
    syncthingServiceMock.getConfigFolders.resolves({ devices: FOLDER_DEVICES });
  });

  // An answer with no only copy, as runCheck leaves it.
  const FINGERPRINT = sinon.match(/^[0-9a-f]{64}$/);

  describe('stampOf', () => {
    const COUNTS = {
      receiveOnlyChangedFiles: 2, receiveOnlyChangedDirectories: 1, receiveOnlyChangedSymlinks: 0, receiveOnlyChangedDeletes: 0, receiveOnlyChangedBytes: 4096,
    };

    it('is the same for the same folder, whatever order syncthing lists its devices in', () => {
      expect(localChangeCheck.stampOf(COUNTS, [{ deviceID: 'Y' }, { deviceID: 'X' }]))
        .to.equal(localChangeCheck.stampOf(COUNTS, [{ deviceID: 'X' }, { deviceID: 'Y' }]));
    });

    // A pull moves both, and neither says anything about what this node changed.
    it('does not change with this node\'s sequence or another device\'s', () => {
      const devices = [{ deviceID: 'X' }];

      expect(localChangeCheck.stampOf({ ...COUNTS, sequence: 3, remoteSequence: { A: 1 } }, devices))
        .to.equal(localChangeCheck.stampOf({ ...COUNTS, sequence: 90, remoteSequence: { A: 70 } }, devices));
    });

    [
      ['the files this node changed', { receiveOnlyChangedFiles: 3 }],
      ['the directories this node changed', { receiveOnlyChangedDirectories: 2 }],
      ['the symlinks this node changed', { receiveOnlyChangedSymlinks: 1 }],
      ['the deletions this node made', { receiveOnlyChangedDeletes: 1 }],
      ['the bytes this node changed', { receiveOnlyChangedBytes: 8192 }],
    ].forEach(([what, moved]) => {
      it(`changes with ${what}`, () => {
        const devices = [{ deviceID: 'X' }];

        expect(localChangeCheck.stampOf({ ...COUNTS, ...moved }, devices)).to.not.equal(localChangeCheck.stampOf(COUNTS, devices));
      });
    });

    it('changes with the devices the folder is shared with', () => {
      expect(localChangeCheck.stampOf(COUNTS, [{ deviceID: 'X' }])).to.not.equal(localChangeCheck.stampOf(COUNTS, [{ deviceID: 'X' }, { deviceID: 'Y' }]));
    });
  });

  describe('request', () => {
    it('runs one check at a time on the node', async () => {
      const first = held({ files: [] });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a').returns(first.promise);
      const a = {};
      const b = {};

      localChangeCheck.request('fluxa_a', a, 's1', () => true);
      localChangeCheck.request('fluxb_b', b, 's1', () => true);
      await settled();

      sinon.assert.neverCalledWith(syncthingServiceMock.getDbLocalChanged, 'fluxb_b');
      first.release();
      await settled();
      sinon.assert.match(a.localChangeCheck, {
        stamp: 's1', onlyCopy: false, madeHere: false, changes: FINGERPRINT,
      });
      sinon.assert.match(b.localChangeCheck, {
        stamp: 's1', onlyCopy: false, madeHere: false, changes: FINGERPRINT,
      });
    });

    it('replaces a check still waiting with the newer one for the same folder', async () => {
      const first = held({ files: [] });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a').returns(first.promise);
      const b = {};

      localChangeCheck.request('fluxa_a', {}, 's1', () => true);
      localChangeCheck.request('fluxb_b', b, 'old', () => true);
      localChangeCheck.request('fluxb_b', b, 'new', () => true);
      first.release();
      await settled();

      expect(syncthingServiceMock.getDbLocalChanged.withArgs('fluxb_b').callCount, 'the folder was checked once per stamp asked for').to.equal(1);
      expect(b.localChangeCheck.stamp).to.equal('new');
    });

    it('does not start again a check already running for the same folder and stamp', async () => {
      const first = held({ files: [] });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a').returns(first.promise);
      const a = {};

      localChangeCheck.request('fluxa_a', a, 's1', () => true);
      await settled();
      localChangeCheck.request('fluxa_a', a, 's1', () => true);
      first.release();
      await settled();

      sinon.assert.calledOnce(syncthingServiceMock.getDbLocalChanged);
    });

    it('says when it has answered', async () => {
      const publish = sinon.stub(fluxEventBus, 'publish');
      try {
        localChangeCheck.request('fluxa_a', {}, 's1', () => true);
        await settled();

        sinon.assert.calledWithExactly(publish, 'syncthing:localChangesChecked', { folder: 'fluxa_a', onlyCopy: false, madeHere: false });
      } finally {
        publish.restore();
      }
    });
  });

  describe('examineLocalChanges', () => {
    it('asks about the items another device wrote, at most eight at once, and stops at the first only copy', async () => {
      const files = Array.from({ length: 20 }, (_, k) => ({ name: `f${k}`, version: ['PRIMARY:1'] }));
      syncthingServiceMock.getDbLocalChanged.resolves({ files });
      syncthingServiceMock.getDbFile.withArgs('fluxa_a', 'f9').resolves({ global: { localFlags: 8 } });

      expect(await localChangeCheck.examineLocalChanges('fluxa_a')).to.deep.equal({ onlyCopy: 'f9', madeHere: false });
      expect(syncthingServiceMock.getDbFile.callCount, 'asked past the batch that held it').to.equal(16);
    });

    it('says a change was made here, asking nothing about it', async () => {
      syncthingServiceMock.getDbLocalChanged.resolves({ files: [{ name: 'stray', version: ['LOCAL-D:4'] }] });

      sinon.assert.match(await localChangeCheck.examineLocalChanges('fluxa_a'), { onlyCopy: false, madeHere: true, changes: FINGERPRINT });
      sinon.assert.notCalled(syncthingServiceMock.getDbFile);
    });

    it('says a change was made here when it is on a later page than the changes others hold', async () => {
      const held = Array.from({ length: 1000 }, (_, k) => ({ name: `f${k}`, version: ['PRIMARY:1'] }));
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a', 1).resolves({ files: held });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxa_a', 2).resolves({ files: [{ name: 'stray', version: ['LOCAL-D:4'] }] });

      sinon.assert.match(await localChangeCheck.examineLocalChanges('fluxa_a'), { onlyCopy: false, madeHere: true, changes: FINGERPRINT });
    });

    it('says nothing was made here when every change names another device', async () => {
      syncthingServiceMock.getDbLocalChanged.resolves({ files: [{ name: 'f', version: ['PRIMARY:1', 'LOCAL-D:2'] }] });

      sinon.assert.match(await localChangeCheck.examineLocalChanges('fluxa_a'), { onlyCopy: false, madeHere: false, changes: FINGERPRINT });
    });

    it('cannot say when an item cannot be read', async () => {
      syncthingServiceMock.getDbLocalChanged.resolves({ files: [{ name: 'f', version: ['PRIMARY:1'] }] });
      syncthingServiceMock.getDbFile.rejects(new Error('404 No such object in the index'));

      expect(await localChangeCheck.examineLocalChanges('fluxa_a')).to.equal(null);
    });
  });

  describe('changesFingerprint', () => {
    it('is the fingerprint the check left for the same changes', async () => {
      syncthingServiceMock.getDbLocalChanged.resolves({ files: [{ name: 'f', version: ['PRIMARY:1', 'LOCAL-D:2'] }] });

      expect(await localChangeCheck.changesFingerprint('fluxa_a')).to.equal((await localChangeCheck.examineLocalChanges('fluxa_a')).changes);
    });

    [
      ['another name', { name: 'g', version: ['PRIMARY:1', 'LOCAL-D:2'] }],
      ['another history', { name: 'f', version: ['PRIMARY:1', 'LOCAL-D:3'] }],
      ['a deletion', {
        name: 'f', version: ['PRIMARY:1', 'LOCAL-D:2'], deleted: true,
      }],
    ].forEach(([what, item]) => {
      it(`differs for ${what}`, async () => {
        syncthingServiceMock.getDbLocalChanged.resolves({ files: [{ name: 'f', version: ['PRIMARY:1', 'LOCAL-D:2'] }] });
        const before = await localChangeCheck.changesFingerprint('fluxa_a');
        syncthingServiceMock.getDbLocalChanged.resolves({ files: [item] });

        expect(await localChangeCheck.changesFingerprint('fluxa_a')).to.not.equal(before);
      });
    });

    it('cannot say when the changes cannot be read', async () => {
      syncthingServiceMock.getDbLocalChanged.rejects(new Error('connect ECONNREFUSED'));

      expect(await localChangeCheck.changesFingerprint('fluxa_a')).to.equal(null);
    });
  });

  describe('revert', () => {
    const CHANGED = { files: 1, directories: 0 };
    // A folder no other test has stubbed reads for, page by page.
    // A folder checked with one change, its answer left on its entry.
    async function checked(folderId = 'fluxr_r') {
      syncthingServiceMock.getDbLocalChanged.withArgs(folderId).resolves({ files: [{ name: 'f', version: ['PRIMARY:1', 'LOCAL-D:2'] }] });
      const entry = {};
      localChangeCheck.request(folderId, entry, localChangeCheck.stampOf(FOLDER_STATUS, FOLDER_DEVICES), () => true);
      await settled();
      return entry;
    }

    it('reverts the changes the check examined, and says so', async () => {
      const entry = await checked();
      const publish = sinon.stub(fluxEventBus, 'publish');
      try {
        localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
        await settled();

        sinon.assert.calledOnceWithExactly(syncthingServiceMock.dbRevert, 'fluxr_r');
        sinon.assert.calledWithExactly(publish, 'syncthing:localChangesReverted', { folder: 'fluxr_r', files: 1, directories: 0 });
        expect(entry).to.not.have.property('localChangeCheck');
      } finally {
        publish.restore();
      }
    });

    it('does not revert changes other than the ones checked, and drops the answer', async () => {
      const entry = await checked();
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxr_r').resolves({ files: [{ name: 'g', version: ['PRIMARY:1', 'LOCAL-D:2'] }] });

      localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
      await settled();

      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      expect(entry).to.not.have.property('localChangeCheck');
    });

    it('does not revert while the changes cannot be read, and keeps the answer', async () => {
      const entry = await checked();
      const answer = entry.localChangeCheck;
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxr_r').rejects(new Error('connect ECONNREFUSED'));

      localChangeCheck.revert('fluxr_r', entry, answer, () => true, CHANGED);
      await settled();

      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      expect(entry.localChangeCheck).to.equal(answer);
    });

    it('does not revert a folder whose entry was replaced, or on an answer the entry no longer carries', async () => {
      const entry = await checked();
      const answer = entry.localChangeCheck;

      localChangeCheck.revert('fluxr_r', entry, answer, () => false, CHANGED);
      await settled();
      entry.localChangeCheck = { ...answer };
      localChangeCheck.revert('fluxr_r', entry, answer, () => true, CHANGED);
      await settled();

      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
    });

    it('keeps the answer when syncthing refuses the revert, and says nothing was reverted', async () => {
      const entry = await checked();
      const answer = entry.localChangeCheck;
      syncthingServiceMock.dbRevert.resolves({ status: 'error', data: { message: 'folder is not running' } });
      const publish = sinon.stub(fluxEventBus, 'publish');
      try {
        localChangeCheck.revert('fluxr_r', entry, answer, () => true, CHANGED);
        await settled();

        sinon.assert.calledOnce(syncthingServiceMock.dbRevert);
        sinon.assert.neverCalledWith(publish, 'syncthing:localChangesReverted');
        expect(entry.localChangeCheck).to.equal(answer);
      } finally {
        publish.restore();
      }
    });

    it('runs in the same queue as the checks, one at a time on the node', async () => {
      const entry = await checked();
      const first = held({ files: [] });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxb_b').returns(first.promise);

      localChangeCheck.request('fluxb_b', {}, 's1', () => true);
      localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
      await settled();

      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      first.release();
      await settled();
      sinon.assert.calledOnce(syncthingServiceMock.dbRevert);
    });

    it('does not revert a folder a device has left since the check, and drops the answer', async () => {
      const entry = await checked();
      syncthingServiceMock.getConfigFolders.resolves({ devices: [{ deviceID: 'LOCAL-DEVICE' }] });

      localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
      await settled();

      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      expect(entry).to.not.have.property('localChangeCheck');
    });

    it('does not revert a folder whose counts of changes moved since the check, and drops the answer', async () => {
      const entry = await checked();
      syncthingServiceMock.getDbStatus.resolves({ ...FOLDER_STATUS, receiveOnlyChangedBytes: 11 });

      localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
      await settled();

      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      expect(entry).to.not.have.property('localChangeCheck');
    });

    it('does not revert while the folder cannot be read, and keeps the answer', async () => {
      const entry = await checked();
      const answer = entry.localChangeCheck;
      syncthingServiceMock.getConfigFolders.rejects(new Error('syncthing did not answer'));

      localChangeCheck.revert('fluxr_r', entry, answer, () => true, CHANGED);
      await settled();

      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      expect(entry.localChangeCheck).to.equal(answer);
    });

    // The order a monitor pass makes possible: the revert is asked for, and the pass's
    // write of the folder's devices, which drops the primary, holds the folder first.
    it('waits for a write to the folder that holds it, and does not revert once that write has dropped a device', async () => {
      const entry = await checked();
      const write = held();
      const writing = syncthingFolderWrites.exclusive(['fluxr_r'], async () => {
        await write.promise;
        syncthingServiceMock.getConfigFolders.resolves({ devices: [{ deviceID: 'LOCAL-DEVICE' }] });
      });

      localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
      await settled();
      sinon.assert.notCalled(syncthingServiceMock.getConfigFolders);
      write.release();
      await writing;
      await settled();

      sinon.assert.notCalled(syncthingServiceMock.dbRevert);
      expect(entry).to.not.have.property('localChangeCheck');
    });

    it('holds the folder against every write until the revert is sent', async () => {
      const entry = await checked();
      const sent = held({ status: 'success', data: {} });
      syncthingServiceMock.dbRevert.returns(sent.promise);
      localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
      await settled();
      sinon.assert.calledOnce(syncthingServiceMock.dbRevert);

      let wrote = false;
      const writing = syncthingFolderWrites.exclusive(['fluxr_r'], async () => { wrote = true; });
      await settled();
      expect(wrote, 'a write to the folder went in while its revert was being sent').to.equal(false);
      sent.release();
      await writing;

      expect(wrote).to.equal(true);
    });

    it('does not start again a revert already running on the same answer', async () => {
      const entry = await checked();
      const again = held({ files: [{ name: 'f', version: ['PRIMARY:1', 'LOCAL-D:2'] }] });
      syncthingServiceMock.getDbLocalChanged.withArgs('fluxr_r').returns(again.promise);

      localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
      await settled();
      localChangeCheck.revert('fluxr_r', entry, entry.localChangeCheck, () => true, CHANGED);
      again.release();
      await settled();

      sinon.assert.calledOnce(syncthingServiceMock.dbRevert);
      expect(syncthingServiceMock.getDbLocalChanged.withArgs('fluxr_r').callCount, 'the changes were read again for a second revert').to.equal(2);
    });
  });
});
