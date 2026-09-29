// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const syncthingService = require('../../ZelBack/src/services/syncthingService');
const { appsFolder } = require('../../ZelBack/src/services/utils/appConstants');
const { OWNED_FOLDER_SETTINGS } = require('../../ZelBack/src/services/appMonitoring/syncthingMonitorHelpers');
const syncthingFolderType = require('../../ZelBack/src/services/appMonitoring/syncthingFolderType');

describe('changeSyncthingFolderType', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('writes the type together with every setting FluxOS owns on the folder', async () => {
    sinon.stub(syncthingService, 'getConfigFolders').resolves([
      { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'receiveonly' },
    ]);
    const adjust = sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'success' });

    const changed = await syncthingFolderType.changeSyncthingFolderType('fluxprobe_app', 'sendreceive');

    expect(changed).to.equal(true);
    sinon.assert.calledOnceWithExactly(adjust, 'patch', { type: 'sendreceive', ...OWNED_FOLDER_SETTINGS }, 'fluxprobe_app');
    expect(adjust.firstCall.args[1].maxConflicts, 'a type change that omits maxConflicts hands the folder syncthing\'s default').to.equal(0);
  });

  it('writes nothing when the folder already has the type', async () => {
    sinon.stub(syncthingService, 'getConfigFolders').resolves([
      { id: 'fluxprobe_app', path: `${appsFolder}fluxprobe_app`, type: 'sendreceive' },
    ]);
    const adjust = sinon.stub(syncthingService, 'adjustConfigFolders');

    const changed = await syncthingFolderType.changeSyncthingFolderType('fluxprobe_app', 'sendreceive');

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

      const changed = await syncthingFolderType.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { settleMs: 1000 });

      expect(changed).to.equal(true);
    });

    it('fails when the type never shows within the wait', async () => {
      sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOfType('receiveonly'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves(unanswered);

      const changed = await syncthingFolderType.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { settleMs: 50 });

      expect(changed).to.equal(false);
    });

    it('fails at once without a wait', async () => {
      const read = sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOfType('receiveonly'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves(unanswered);

      const changed = await syncthingFolderType.changeSyncthingFolderType('fluxprobe_app', 'sendreceive');

      expect(changed).to.equal(false);
      sinon.assert.calledOnce(read);
    });

    it('a write syncthing refused fails at once, even with a wait', async () => {
      const read = sinon.stub(syncthingService, 'getConfigFolders').resolves(folderOfType('receiveonly'));
      sinon.stub(syncthingService, 'adjustConfigFolders').resolves({ status: 'error', data: { httpStatus: 400 } });

      const changed = await syncthingFolderType.changeSyncthingFolderType('fluxprobe_app', 'sendreceive', { settleMs: 1000 });

      expect(changed).to.equal(false);
      sinon.assert.calledOnce(read);
    });
  });
});
