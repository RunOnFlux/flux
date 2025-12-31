const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const fileQueryService = require('../../ZelBack/src/services/appQuery/fileQueryService');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const IOUtils = require('../../ZelBack/src/services/IOUtils');

describe('fileQueryService tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('getAppsFolder tests', () => {
    it('should return folder contents when authorized', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').resolves(['file1.txt', 'file2.txt', 'folder1']);

      const lstatStub = sinon.stub(fs, 'lstat');
      lstatStub.withArgs('/mnt/appvolumes/TestApp_Component1/file1.txt').resolves({
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
        size: 1024,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-02'),
      });
      lstatStub.withArgs('/mnt/appvolumes/TestApp_Component1/file2.txt').resolves({
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
        size: 2048,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-02'),
      });
      lstatStub.withArgs('/mnt/appvolumes/TestApp_Component1/folder1').resolves({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        size: 4096,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-02'),
      });

      sinon.stub(IOUtils, 'getFolderSize').resolves(10240);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data).to.be.an('array');
      expect(response.data.length).to.equal(3);
      expect(response.data[0].name).to.equal('file1.txt');
      expect(response.data[0].isFile).to.be.true;
      expect(response.data[2].name).to.equal('folder1');
      expect(response.data[2].isDirectory).to.be.true;
      expect(response.data[2].size).to.equal(10240);
    });

    it('should reject unauthorized request', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      sinon.stub(messageHelper, 'errUnauthorizedMessage').returns({ status: 'error', data: { code: 401 } });

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].data.code).to.equal(401);
    });

    it('should throw error if appname not specified', async () => {
      const req = {
        params: { component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should throw error if component not specified', async () => {
      const req = {
        params: { appname: 'TestApp' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should throw error if volume not found', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([]);
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should use query parameters if params not provided', async () => {
      const req = {
        params: {},
        query: { appname: 'TestApp', component: 'Component1', folder: 'subfolder' },
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      const volumeStub = sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').resolves([]);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledWith(volumeStub, 'TestApp', 'Component1', 'B', 'mount', 0);
      sinon.assert.calledOnce(res.json);
    });

    it('should handle subfolder path correctly', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1', folder: 'data/logs' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      const readdirStub = sinon.stub(fs, 'readdir').resolves([]);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledWith(readdirStub, '/mnt/appvolumes/TestApp_Component1/data/logs');
    });

    it('should include file details', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      const birthtime = new Date('2024-01-01T00:00:00Z');
      const mtime = new Date('2024-01-02T00:00:00Z');

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').resolves(['test.txt']);
      sinon.stub(fs, 'lstat').resolves({
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
        size: 1024,
        birthtime,
        mtime,
      });
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data[0]).to.have.property('name', 'test.txt');
      expect(response.data[0]).to.have.property('size', 1024);
      expect(response.data[0]).to.have.property('isFile', true);
      expect(response.data[0]).to.have.property('isDirectory', false);
      expect(response.data[0]).to.have.property('isSymbolicLink', false);
      expect(response.data[0]).to.have.property('createdAt');
      expect(response.data[0]).to.have.property('modifiedAt');
    });

    it('should handle symbolic links', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').resolves(['link.txt']);
      sinon.stub(fs, 'lstat').resolves({
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
        size: 512,
        birthtime: new Date(),
        mtime: new Date(),
      });
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data[0].isSymbolicLink).to.be.true;
    });

    it('should calculate folder size for directories', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').resolves(['bigfolder']);
      sinon.stub(fs, 'lstat').resolves({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        size: 4096,
        birthtime: new Date(),
        mtime: new Date(),
      });
      const folderSizeStub = sinon.stub(IOUtils, 'getFolderSize').resolves(104857600);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(folderSizeStub);
      const response = res.json.firstCall.args[0];
      expect(response.data[0].size).to.equal(104857600);
    });

    it('should handle empty folders', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').resolves([]);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data).to.be.an('array');
      expect(response.data.length).to.equal(0);
    });

    it('should handle filesystem errors', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').rejects(new Error('Permission denied'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should handle lstat errors', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').resolves(['file.txt']);
      sinon.stub(fs, 'lstat').rejects(new Error('File not found'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should handle mixed files and folders', async () => {
      const req = {
        params: { appname: 'TestApp', component: 'Component1' },
        query: {},
      };
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
      sinon.stub(IOUtils, 'getVolumeInfo').resolves([
        { mount: '/mnt/appvolumes/TestApp_Component1' },
      ]);
      sinon.stub(fs, 'readdir').resolves(['file.txt', 'folder', 'link.txt']);

      const lstatStub = sinon.stub(fs, 'lstat');
      lstatStub.onCall(0).resolves({
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
        size: 1024,
        birthtime: new Date(),
        mtime: new Date(),
      });
      lstatStub.onCall(1).resolves({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        size: 4096,
        birthtime: new Date(),
        mtime: new Date(),
      });
      lstatStub.onCall(2).resolves({
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
        size: 512,
        birthtime: new Date(),
        mtime: new Date(),
      });

      sinon.stub(IOUtils, 'getFolderSize').resolves(8192);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await fileQueryService.getAppsFolder(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.length).to.equal(3);
      expect(response.data[0].isFile).to.be.true;
      expect(response.data[1].isDirectory).to.be.true;
      expect(response.data[2].isSymbolicLink).to.be.true;
    });
  });
});
