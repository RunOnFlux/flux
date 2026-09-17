const chai = require('chai');
const sinon = require('sinon');
const backupRestoreService = require('../../ZelBack/src/services/backupRestoreService');
const IOUtils = require('../../ZelBack/src/services/IOUtils');
const { appsFolder } = require('../../ZelBack/src/services/utils/appConstants');
const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');

const { expect } = chai;

function responseRecorder() {
  return {
    json: sinon.stub(),
    setHeader: sinon.stub(),
    write: sinon.stub(),
    end: sinon.stub(),
    download: sinon.stub(),
    sendFile: sinon.stub(),
  };
}

function messageOf(res) {
  return res.json.firstCall.args[0].data.message;
}

describe('backupRestoreService tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  // Every endpoint here is app-scoped, and the node operator is admitted to none
  // of them. appownerorfluxteam admits the app's owner and the flux team, and refuses
  // the node operator - so the string a handler asks for is the whole of the
  // policy; what each privilege admits is pinned in verificationHelperUtils.test.js.
  //
  // These read and delete a customer's archives: the local backup list, the size
  // of a remote one, the volume's own contents, a download of a stored file, and
  // its removal. Driven as a table because completeness is the point - one
  // handler left on the wider privilege is the whole hole.
  describe('the node operator is refused every app-scoped endpoint', () => {
    const handlers = [
      { name: 'getVolumeDataOfComponent', params: { appname: 'myapp', component: 'comp' } },
      { name: 'getLocalBackupList', params: { appname: 'myapp', path: '/backup' } },
      { name: 'getRemoteFileSize', params: { appname: 'myapp', fileurl: 'https://example.invalid/a.tar.gz' } },
      { name: 'removeBackupFile', params: { appname: 'myapp', filepath: '/backup/a.tar.gz' } },
      { name: 'downloadLocalFile', params: { appname: 'myapp', filepath: '/backup/a.tar.gz' } },
    ];

    handlers.forEach(({ name, params }) => {
      it(`${name} asks for the privilege that refuses the node operator`, async () => {
        const verifyPrivilege = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
        const req = { params, query: {} };
        const res = responseRecorder();

        await backupRestoreService[name](req, res);

        sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: 'myapp' });
      });
    });
  });

  // Holding the privilege over one app is the whole of what these handlers check,
  // and the path they then act on arrives separately - so the privilege has to be
  // bound to the volume the path reaches, or any app owner on the node reaches
  // every other tenant's archives. Authorization is granted throughout: what is
  // under test is what a genuinely authorized owner of `myapp` may address.
  describe('an authorized app owner reaches only their own volume', () => {
    const appname = 'myapp';

    // An app is mounted at `<appsFolder>/flux<app>`, or at
    // `<appsFolder>/flux<component>_<app>` once per component when it composes.
    const reachable = [
      { what: 'its single-component volume', dir: 'fluxmyapp' },
      { what: 'a component volume of the same app', dir: 'fluxmongo_myapp' },
    ];

    // The app name is the field after the separator, never the one before it and
    // never a prefix of the directory, so each of these names a different tenant.
    const refused = [
      { what: "another tenant's single-component volume", dir: 'fluxvictim' },
      { what: "another tenant's component volume", dir: 'fluxmongo_victim' },
      { what: 'a longer app name that starts with this one', dir: 'fluxmyappextra' },
      { what: 'a volume whose component is named after this app', dir: 'fluxmyapp_victim' },
    ];

    beforeEach(() => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
    });

    reachable.forEach(({ what, dir }) => {
      it(`lists ${what}`, async () => {
        const getPathFileList = sinon.stub(IOUtils, 'getPathFileList').resolves([{ name: 'backup_comp.tar.gz' }]);
        const vPath = `${appsFolder}${dir}/backup/local`;
        const req = { params: { appname, path: vPath }, query: {} };

        await backupRestoreService.getLocalBackupList(req, responseRecorder());

        sinon.assert.calledOnce(getPathFileList);
        expect(getPathFileList.firstCall.args[0]).to.equal(vPath);
      });

      it(`removes a backup file from ${what}`, async () => {
        const removeFile = sinon.stub(IOUtils, 'removeFile').resolves('removed');
        const filepath = `${appsFolder}${dir}/backup/local/backup_comp.tar.gz`;
        const req = { params: { appname, filepath }, query: {} };

        await backupRestoreService.removeBackupFile(req, responseRecorder());

        sinon.assert.calledOnceWithExactly(removeFile, filepath);
      });
    });

    refused.forEach(({ what, dir }) => {
      it(`refuses to list ${what}`, async () => {
        const getPathFileList = sinon.stub(IOUtils, 'getPathFileList').resolves([{ name: 'backup_comp.tar.gz' }]);
        const req = { params: { appname, path: `${appsFolder}${dir}/backup/local` }, query: {} };
        const res = responseRecorder();

        await backupRestoreService.getLocalBackupList(req, res);

        sinon.assert.notCalled(getPathFileList);
        expect(messageOf(res)).to.equal('Path validation failed..');
      });

      it(`refuses to remove a backup file from ${what}`, async () => {
        const removeFile = sinon.stub(IOUtils, 'removeFile').resolves('removed');
        const req = { params: { appname, filepath: `${appsFolder}${dir}/backup/local/backup_comp.tar.gz` }, query: {} };
        const res = responseRecorder();

        await backupRestoreService.removeBackupFile(req, res);

        sinon.assert.notCalled(removeFile);
        expect(messageOf(res)).to.equal('Path validation failed..');
      });

      it(`refuses to download from ${what}`, async () => {
        const req = { params: { appname, filepath: `${appsFolder}${dir}/backup/local/backup_comp.tar.gz` }, query: {} };
        const res = responseRecorder();

        await backupRestoreService.downloadLocalFile(req, res);

        expect(messageOf(res)).to.equal('Path validation failed..');
      });
    });

    // The download's sink resolves symlinks and streams the file, so it is not
    // stubbable from here; the discriminator is that its own volume gets past
    // validation and fails later on the archive that is not there.
    it('lets a download of its own volume past validation', async () => {
      const req = { params: { appname, filepath: `${appsFolder}fluxmyapp/backup/local/backup_comp.tar.gz` }, query: {} };
      const res = responseRecorder();

      await backupRestoreService.downloadLocalFile(req, res);

      expect(messageOf(res)).to.not.equal('Path validation failed..');
    });

    it('refuses an app name carrying the component separator', async () => {
      const removeFile = sinon.stub(IOUtils, 'removeFile').resolves('removed');
      const req = {
        params: { appname: 'mongo_victim', filepath: `${appsFolder}fluxmongo_victim/backup/local/backup_comp.tar.gz` },
        query: {},
      };
      const res = responseRecorder();

      await backupRestoreService.removeBackupFile(req, res);

      sinon.assert.notCalled(removeFile);
      expect(messageOf(res)).to.equal('Path validation failed..');
    });

    it('reaches the volume of a legacy zel-namespaced app', async () => {
      const removeFile = sinon.stub(IOUtils, 'removeFile').resolves('removed');
      const filepath = `${appsFolder}zelKadenaChainWebNode/backup/local/backup_comp.tar.gz`;
      const req = { params: { appname: 'KadenaChainWebNode', filepath }, query: {} };

      await backupRestoreService.removeBackupFile(req, responseRecorder());

      sinon.assert.calledOnceWithExactly(removeFile, filepath);
    });
  });

  // The query-string form read `number` for the app name, so every caller that
  // passed `?appname=` authorized against the empty string and was refused.
  describe('getLocalBackupList accepts its parameters from the query string', () => {
    it('reads the app name from the query rather than another parameter', async () => {
      const verifyPrivilege = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getPathFileList').resolves([{ name: 'backup_comp.tar.gz' }]);
      const req = {
        params: {},
        query: { appname: 'myapp', path: `${appsFolder}fluxmyapp/backup/local`, number: 'false' },
      };

      await backupRestoreService.getLocalBackupList(req, responseRecorder());

      sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: 'myapp' });
    });
  });
});
