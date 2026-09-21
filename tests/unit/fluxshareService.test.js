const chai = require('chai');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');

const fluxshareService = require('../../ZelBack/src/services/fluxshareService');
const { appsFolder } = require('../../ZelBack/src/services/utils/appConstants');
const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');

const { expect } = chai;

const shareRoot = path.join(appsFolder, 'ZelShare');

function responseRecorder() {
  return { json: sinon.stub(), download: sinon.stub(), setHeader: sinon.stub() };
}

const bodyOf = (res) => res.json.firstCall.args[0];

describe('fluxshareService tests', () => {
  const req = { params: {}, query: {} };

  afterEach(() => {
    sinon.restore();
  });

  // What is left is a way to collect files a previous release allowed onto the
  // node. Everything that put them there, renamed them, deleted them or served
  // them to a stranger is gone, and these assert it stays gone.
  describe('who reaches it', () => {
    ['fluxShareGetFolder', 'fluxShareDownloadFile'].forEach((handler) => {
      it(`${handler} asks for the operator-or-flux-team privilege`, async () => {
        const verifyPrivilege = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
        const res = responseRecorder();

        await fluxshareService[handler]({ params: { file: 'x', folder: '' }, query: {} }, res);

        sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf({ params: { file: 'x', folder: '' }, query: {} }));
        expect(bodyOf(res).status).to.equal('error');
      });
    });

    // The old handler fell through to a {name, token} lookup when the privilege
    // check failed, which served the file to whoever held the link. A refusal
    // must be the end of the request, not a branch in it.
    it('a refused download does not fall through to a token', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      const readdir = sinon.stub(fs.promises, 'readdir');
      const lstat = sinon.stub(fs.promises, 'lstat');
      const res = responseRecorder();

      await fluxshareService.fluxShareDownloadFile({ params: { file: 'secret.txt', token: 'anything' }, query: {} }, res);

      expect(bodyOf(res).data.message).to.match(/[Uu]nauthorized/);
      sinon.assert.notCalled(readdir);
      sinon.assert.notCalled(lstat);
      sinon.assert.notCalled(res.download);
    });
  });

  describe('listing', () => {
    beforeEach(() => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
    });

    // Nothing in FluxOS creates the share directory, so most nodes have none.
    // A caller collecting files wants to be told there are none, not handed an
    // ENOENT - that error is what made the feature look broken.
    it('answers an empty list when the directory does not exist', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      sinon.stub(fs.promises, 'lstat').resolves({ isSymbolicLink: () => false });
      sinon.stub(fs.promises, 'readdir').rejects(enoent);
      const res = responseRecorder();

      await fluxshareService.fluxShareGetFolder(req, res);

      expect(bodyOf(res).status).to.equal('success');
      expect(bodyOf(res).data).to.deep.equal([]);
    });

    it('reports a file with its size and a directory without one', async () => {
      const when = new Date('2026-01-01T00:00:00Z');
      sinon.stub(fs.promises, 'readdir').resolves(['note.txt', 'sub']);
      sinon.stub(fs.promises, 'lstat').callsFake(async (target) => {
        if (target === shareRoot) return { isSymbolicLink: () => false };
        const dir = path.basename(target) === 'sub';
        return {
          isDirectory: () => dir,
          isFile: () => !dir,
          isSymbolicLink: () => false,
          size: dir ? 4096 : 12,
          birthtime: when,
          mtime: when,
        };
      });
      const res = responseRecorder();

      await fluxshareService.fluxShareGetFolder(req, res);

      const [file, dir] = bodyOf(res).data;
      expect(file).to.include({ name: 'note.txt', size: 12, isDirectory: false });
      // A directory's size would mean walking the operator's data to add it up.
      expect(dir).to.include({ name: 'sub', isDirectory: true });
      expect(dir.size).to.equal(null);
    });
  });

  describe('containment', () => {
    beforeEach(() => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
    });

    // Only the target escapes. A stub that moved the base as well would put the
    // two in the same place and the check would pass for the wrong reason.
    const escapes = (target, landsAt) => {
      sinon.stub(fs.promises, 'lstat').resolves({ isSymbolicLink: () => false });
      sinon.stub(fs.promises, 'realpath').callsFake(async (p) => (p === target ? landsAt : p));
    };

    it('refuses a listing that resolves out of the share directory', async () => {
      escapes(path.join(shareRoot, 'link'), '/etc');
      const readdir = sinon.stub(fs.promises, 'readdir').resolves([]);
      const res = responseRecorder();

      await fluxshareService.fluxShareGetFolder({ params: { folder: 'link' }, query: {} }, res);

      sinon.assert.notCalled(readdir);
      expect(bodyOf(res).status).to.equal('error');
    });

    it('refuses a download that resolves out of the share directory', async () => {
      escapes(path.join(shareRoot, 'link'), '/etc/shadow');
      const res = responseRecorder();

      await fluxshareService.fluxShareDownloadFile({ params: { file: 'link' }, query: {} }, res);

      expect(bodyOf(res).status).to.equal('error');
      sinon.assert.notCalled(res.download);
    });
  });
});
