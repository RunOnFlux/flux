const sinon = require('sinon');
const backupRestoreService = require('../../ZelBack/src/services/backupRestoreService');
const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');

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
        const res = {
          json: sinon.stub(),
          setHeader: sinon.stub(),
          write: sinon.stub(),
          end: sinon.stub(),
          download: sinon.stub(),
          sendFile: sinon.stub(),
        };

        await backupRestoreService[name](req, res);

        sinon.assert.calledOnceWithExactly(verifyPrivilege, Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: 'myapp' });
      });
    });
  });
});
