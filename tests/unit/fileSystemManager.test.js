const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('fileSystemManager tests', () => {
  let fileSystemManager;
  let verificationHelperStub;
  let messageHelperStub;
  let serviceHelperStub;
  let IOUtilsStub;
  let logStub;
  let execShellStub;

  beforeEach(() => {
    // Stubs
    verificationHelperStub = {
      verifyPrivilege: sinon.stub(),
    };

    messageHelperStub = {
      createSuccessMessage: sinon.stub(),
      createErrorMessage: sinon.stub(),
      errUnauthorizedMessage: sinon.stub(),
    };

    serviceHelperStub = {
      ensureString: sinon.stub().returnsArg(0),
    };

    IOUtilsStub = {
      getVolumeInfo: sinon.stub(),
    };

    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    execShellStub = sinon.stub();

    // Proxy require with util mocked
    fileSystemManager = proxyquire('../../ZelBack/src/services/appSystem/fileSystemManager', {
      '../messageHelper': messageHelperStub,
      '../verificationHelper': verificationHelperStub,
      '../serviceHelper': serviceHelperStub,
      '../IOUtils': IOUtilsStub,
      '../../lib/log': logStub,
      util: {
        promisify: () => execShellStub,
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('createAppsFolder', () => {
    it('should create folder when authorized', async () => {
      const req = {
        params: { appname: 'testapp', folder: 'testfolder', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      IOUtilsStub.getVolumeInfo.resolves([{ mount: '/mnt/testapp' }]);
      execShellStub.resolves();
      messageHelperStub.createSuccessMessage.returns({ status: 'success', data: { message: 'Folder Created' } });

      await fileSystemManager.createAppsFolder(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(verificationHelperStub.verifyPrivilege.calledWith('appownerabove', req, 'testapp')).to.be.true;
      expect(execShellStub.calledOnce).to.be.true;
      expect(messageHelperStub.createSuccessMessage.calledWith('Folder Created')).to.be.true;
    });

    it('should deny unauthorized access', async () => {
      const req = {
        params: { appname: 'testapp', folder: 'testfolder', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await fileSystemManager.createAppsFolder(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.errUnauthorizedMessage.calledOnce).to.be.true;
      expect(execShellStub.called).to.be.false;
    });

    it('should handle missing appname parameter', async () => {
      const req = {
        params: {},
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'appname and component parameters are mandatory' } });

      await fileSystemManager.createAppsFolder(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.createErrorMessage.calledOnce).to.be.true;
    });

    it('should handle application volume not found error', async () => {
      const req = {
        params: { appname: 'testapp', folder: 'testfolder', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      IOUtilsStub.getVolumeInfo.resolves([]);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Application volume not found' } });

      await fileSystemManager.createAppsFolder(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.createErrorMessage.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('renameAppsObject', () => {
    it('should rename object when authorized', async () => {
      const req = {
        params: {
          appname: 'testapp', oldpath: 'oldname', newname: 'newname', component: 'testcomp',
        },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      IOUtilsStub.getVolumeInfo.resolves([{ mount: '/mnt/testapp' }]);
      execShellStub.resolves();
      messageHelperStub.createSuccessMessage.returns({ status: 'success', data: { message: 'Rename successful' } });

      await fileSystemManager.renameAppsObject(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(execShellStub.calledOnce).to.be.true;
      expect(messageHelperStub.createSuccessMessage.calledWith('Rename successful')).to.be.true;
    });

    it('should deny unauthorized access', async () => {
      const req = {
        params: {
          appname: 'testapp', oldpath: 'oldname', newname: 'newname', component: 'testcomp',
        },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await fileSystemManager.renameAppsObject(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.errUnauthorizedMessage.calledOnce).to.be.true;
      expect(execShellStub.called).to.be.false;
    });

    it('should handle missing oldpath parameter', async () => {
      const req = {
        params: { appname: 'testapp', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        write: sinon.stub(),
        end: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'No file nor folder to rename specified' } });

      await fileSystemManager.renameAppsObject(req, res);

      expect(res.write.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });

    it('should reject invalid newname with slash', async () => {
      const req = {
        params: {
          appname: 'testapp', oldpath: 'oldname', newname: 'new/name', component: 'testcomp',
        },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        write: sinon.stub(),
        end: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'New name is invalid' } });

      await fileSystemManager.renameAppsObject(req, res);

      expect(res.write.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('removeAppsObject', () => {
    it('should remove object when authorized', async () => {
      const req = {
        params: { appname: 'testapp', object: 'testfile', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      IOUtilsStub.getVolumeInfo.resolves([{ mount: '/mnt/testapp' }]);
      execShellStub.resolves();
      messageHelperStub.createSuccessMessage.returns({ status: 'success', data: { message: 'File Removed' } });

      await fileSystemManager.removeAppsObject(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(execShellStub.calledOnce).to.be.true;
      expect(messageHelperStub.createSuccessMessage.calledWith('File Removed')).to.be.true;
    });

    it('should deny unauthorized access', async () => {
      const req = {
        params: { appname: 'testapp', object: 'testfile', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await fileSystemManager.removeAppsObject(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.errUnauthorizedMessage.calledOnce).to.be.true;
      expect(execShellStub.called).to.be.false;
    });

    it('should handle missing object parameter', async () => {
      const req = {
        params: { appname: 'testapp', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        write: sinon.stub(),
        end: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'No object specified' } });

      await fileSystemManager.removeAppsObject(req, res);

      expect(res.write.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('downloadAppsFolder', () => {
    it('should deny unauthorized access', async () => {
      const req = {
        params: { appname: 'testapp', folder: 'testfolder', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await fileSystemManager.downloadAppsFolder(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.errUnauthorizedMessage.calledOnce).to.be.true;
    });

    it('should handle missing folder parameter', async () => {
      const req = {
        params: { appname: 'testapp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'folder and component parameters are mandatory' } });

      await fileSystemManager.downloadAppsFolder(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.createErrorMessage.calledOnce).to.be.true;
    });

    it('should handle application volume not found error', async () => {
      const req = {
        params: { appname: 'testapp', folder: 'testfolder', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        write: sinon.stub(),
        end: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      IOUtilsStub.getVolumeInfo.resolves([]);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Application volume not found' } });

      await fileSystemManager.downloadAppsFolder(req, res);

      expect(res.write.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });

  describe('downloadAppsFile', () => {
    it('should initiate file download when authorized', async () => {
      const req = {
        params: { appname: 'testapp', file: 'testfile.txt', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        download: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      IOUtilsStub.getVolumeInfo.resolves([{ mount: '/mnt/testapp' }]);
      execShellStub.resolves();

      await fileSystemManager.downloadAppsFile(req, res);

      expect(execShellStub.calledOnce).to.be.true;
      expect(res.download.calledOnce).to.be.true;
    });

    it('should deny unauthorized access', async () => {
      const req = {
        params: { appname: 'testapp', file: 'testfile.txt', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(false);
      messageHelperStub.errUnauthorizedMessage.returns({ status: 'error', data: { message: 'Unauthorized' } });

      await fileSystemManager.downloadAppsFile(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.errUnauthorizedMessage.calledOnce).to.be.true;
    });

    it('should handle missing file parameter', async () => {
      const req = {
        params: { appname: 'testapp', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'file and component parameters are mandatory' } });

      await fileSystemManager.downloadAppsFile(req, res);

      expect(res.json.calledOnce).to.be.true;
      expect(messageHelperStub.createErrorMessage.calledOnce).to.be.true;
    });

    it('should handle application volume not found error', async () => {
      const req = {
        params: { appname: 'testapp', file: 'testfile.txt', component: 'testcomp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
        write: sinon.stub(),
        end: sinon.stub(),
      };

      verificationHelperStub.verifyPrivilege.resolves(true);
      IOUtilsStub.getVolumeInfo.resolves([]);
      messageHelperStub.createErrorMessage.returns({ status: 'error', data: { message: 'Application volume not found' } });

      await fileSystemManager.downloadAppsFile(req, res);

      expect(res.write.calledOnce).to.be.true;
      expect(logStub.error.called).to.be.true;
    });
  });
});
