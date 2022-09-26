const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const proxyquire = require('proxyquire');
const fs = require('fs');
const util = require('util');
const log = require('../../ZelBack/src/lib/log');

const dbHelper = require('../../ZelBack/src/services/dbHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const generalService = require('../../ZelBack/src/services/generalService');

const adminConfig = {
  fluxTeamZelId: '1zasdfg',
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    kadena: '1234kadena',
    cruxid: '12345678',
    apiport: '5550',
    testnet: true,
  },
};

const fluxshareService = proxyquire('../../ZelBack/src/services/fluxshareService',
  { '../../../config/userconfig': adminConfig });

chai.use(chaiAsPromised);
const { expect } = chai;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  res.write = sinon.fake(() => 'written');
  res.end = sinon.fake(() => true);
  res.writeHead = sinon.fake(() => true);
  res.download = sinon.fake(() => true);
  return res;
};

describe('idService tests', () => {
  describe('fluxShareDatabaseFileDelete tests', () => {
    let dbStub;

    beforeEach(async () => {
      dbStub = sinon.stub(dbHelper, 'findOneAndDeleteInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if db insert throws error', async () => {
      const fileName = 'test.txt';
      dbStub.throws(new Error('delete failed'));

      await expect(fluxshareService.fluxShareDatabaseFileDelete(fileName)).to.eventually.be.rejectedWith('delete failed');
    });

    it('should find and delete the file in the DB', async () => {
      const fileName = 'test.txt';
      dbStub.resolves('all good');

      const result = await fluxshareService.fluxShareDatabaseFileDelete(fileName);

      expect(result).to.eql(true);
      sinon.assert.calledOnceWithMatch(dbStub, sinon.match.object, 'shared', { name: 'test.txt' }, { projection: { _id: 0, name: 1, token: 1 } });
    });
  });

  describe('fluxShareDatabaseFileDeleteMultiple tests', () => {
    let dbStub;

    beforeEach(async () => {
      dbStub = sinon.stub(dbHelper, 'removeDocumentsFromCollection');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if db insert throws error', async () => {
      const fileName = 'test.txt';
      dbStub.throws(new Error('delete failed'));

      await expect(fluxshareService.fluxShareDatabaseFileDeleteMultiple(fileName)).to.eventually.be.rejectedWith('delete failed');
    });

    it('should find and delete the file in the DB', async () => {
      const fileName = 'test.txt';
      dbStub.resolves('all good');

      const result = await fluxshareService.fluxShareDatabaseFileDeleteMultiple(fileName);

      expect(result).to.eql(true);
      sinon.assert.calledOnceWithMatch(dbStub, sinon.match.object, 'shared', { name: /^test.txt/ });
    });
  });

  describe('getAllFiles tests', () => {
    let readdirSyncStub;
    let statSyncStub;

    beforeEach(async () => {
      readdirSyncStub = sinon.stub(fs, 'readdirSync');
      statSyncStub = sinon.stub(fs, 'statSync');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return files array', async () => {
      const arrayOfFiles = [];
      const dirPath = 'testing';
      readdirSyncStub.returns(['file1', 'file2']);
      statSyncStub.returns({
        isDirectory: sinon.fake(() => false),
      });

      const result = await fluxshareService.getAllFiles(dirPath, arrayOfFiles);

      expect(result).to.eql(['testing/file1', 'testing/file2']);
    });

    it('should change the directory and return files', async () => {
      const arrayOfFiles = [];
      const dirPath = 'testing';
      readdirSyncStub.returns(['file1', 'file2']);
      statSyncStub.onCall(0).returns({
        isDirectory: sinon.fake(() => true),
      });
      statSyncStub.onCall(1).returns({
        isDirectory: sinon.fake(() => false),
      });
      statSyncStub.onCall(2).returns({
        isDirectory: sinon.fake(() => false),
      });
      statSyncStub.onCall(3).returns({
        isDirectory: sinon.fake(() => false),
      });

      const result = await fluxshareService.getAllFiles(dirPath, arrayOfFiles);

      expect(result).to.eql(['testing/file1/file1', 'testing/file1/file2', 'testing/file2']);
    });
  });

  describe('getFluxShareSize tests', () => {
    let readdirSyncStub;
    let statSyncStub;

    beforeEach(async () => {
      readdirSyncStub = sinon.stub(fs, 'readdirSync');
      statSyncStub = sinon.stub(fs, 'statSync');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return files array', async () => {
      const arrayOfFiles = [];
      const dirPath = 'testing';
      readdirSyncStub.returns(['file1', 'file2']);
      statSyncStub.returns({
        size: 1000000,
      });

      const result = await fluxshareService.getFluxShareSize(dirPath, arrayOfFiles);

      expect(result).to.equal(0.002);
    });
  });

  describe('getFluxShareSpecificFolderSize tests', () => {
    let readdirSyncStub;
    let statSyncStub;

    beforeEach(async () => {
      readdirSyncStub = sinon.stub(fs, 'readdirSync');
      statSyncStub = sinon.stub(fs, 'statSync');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return files array', async () => {
      const arrayOfFiles = [];
      const dirPath = 'testing';
      readdirSyncStub.returns(['file1', 'file2']);
      statSyncStub.returns({
        size: 1000000,
      });

      const result = await fluxshareService.getFluxShareSpecificFolderSize(dirPath, arrayOfFiles);

      expect(result).to.equal(2000000);
    });
  });

  describe('fluxShareDatabaseShareFile tests', () => {
    let findOneInDatabaseStub;
    let insertOneToDatabaseStub;

    beforeEach(async () => {
      findOneInDatabaseStub = sinon.stub(dbHelper, 'findOneInDatabase');
      insertOneToDatabaseStub = sinon.stub(dbHelper, 'insertOneToDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if db insert throws error', async () => {
      const fileName = 'test.txt';
      findOneInDatabaseStub.throws(new Error('find failed'));

      await expect(fluxshareService.fluxShareDatabaseShareFile(fileName)).to.eventually.be.rejectedWith('find failed');
    });

    it('should find return if file is in db', async () => {
      const fileName = 'test.txt';
      findOneInDatabaseStub.resolves('all good');

      const result = await fluxshareService.fluxShareDatabaseShareFile(fileName);

      expect(result).to.eql('all good');
      sinon.assert.calledOnceWithMatch(findOneInDatabaseStub, sinon.match.object, 'shared', { name: 'test.txt' }, { projection: { _id: 0, name: 1, token: 1 } });
      sinon.assert.notCalled(insertOneToDatabaseStub);
    });

    it('should find the file in the DB', async () => {
      const fileName = 'test.txt';
      findOneInDatabaseStub.resolves(false);

      const result = await fluxshareService.fluxShareDatabaseShareFile(fileName);

      expect(result.name).to.eql('test.txt');
      expect(result.token).to.be.a('string');
      sinon.assert.calledOnceWithMatch(findOneInDatabaseStub, sinon.match.object, 'shared', { name: 'test.txt' }, { projection: { _id: 0, name: 1, token: 1 } });
      sinon.assert.calledOnceWithMatch(insertOneToDatabaseStub, sinon.match.object, 'shared', { name: 'test.txt' });
    });
  });

  describe('fluxShareSharedFiles tests', () => {
    let dbStub;

    beforeEach(async () => {
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if db insert throws error', async () => {
      const fileName = 'test.txt';
      dbStub.throws(new Error('delete failed'));

      await expect(fluxshareService.fluxShareSharedFiles(fileName)).to.eventually.be.rejectedWith('delete failed');
    });

    it('should find the file in the DB', async () => {
      const fileName = 'test.txt';
      dbStub.resolves('all good');

      const result = await fluxshareService.fluxShareSharedFiles(fileName);

      expect(result).to.eql('all good');
      sinon.assert.calledOnceWithMatch(dbStub, sinon.match.object, 'shared', {}, { projection: { _id: 0, name: 1, token: 1 } });
    });
  });

  describe('fluxShareGetSharedFiles tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if file was found', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareGetSharedFiles(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 'all good' });
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareGetSharedFiles(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if db throws error', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.rejects('error');

      await fluxshareService.fluxShareGetSharedFiles(undefined, res);

      sinon.assert.calledOnceWithExactly(res.write, sinon.match.string);
      sinon.assert.calledOnce(res.end);
    });
  });

  describe('fluxShareUnshareFile tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if file was unshared', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          file: 'test.txt',
        },
      };

      await fluxshareService.fluxShareUnshareFile(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'File sharing disabled',
        },
      });
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareUnshareFile(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if db throws error', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.rejects('error');

      await fluxshareService.fluxShareUnshareFile(undefined, res);

      sinon.assert.calledOnceWithExactly(res.write, sinon.match.string);
      sinon.assert.calledOnce(res.end);
    });
  });

  describe('fluxShareShareFile tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if file was shared', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          file: 'test.txt',
        },
      };

      await fluxshareService.fluxShareShareFile(req, res);

      sinon.assert.calledOnceWithMatch(res.json, {
        status: 'success',
        data: {
          name: 'test.txt',
          token: sinon.match.string,
        },
      });
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareShareFile(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if db throws error', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.rejects('error');

      await fluxshareService.fluxShareShareFile(undefined, res);

      sinon.assert.calledOnceWithExactly(res.write, sinon.match.string);
      sinon.assert.calledOnce(res.end);
    });
  });

  describe('fluxShareDownloadFolder tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if folder was shared', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          folder: 'test',
        },
      };

      await fluxshareService.fluxShareDownloadFolder(req, res);

      sinon.assert.calledOnceWithMatch(res.writeHead, 200, {
        'Content-Type': 'application/zip',
        'Content-disposition': 'attachment; filename=test.zip',
      });
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareDownloadFolder(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if no folder was specified', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test2',
        },
      };

      await fluxshareService.fluxShareDownloadFolder(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'No folder specified' },
      });
    });
  });

  describe('fluxShareDownloadFile tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if file was downloaded and user is authorized', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      const req = {
        params: {
          file: 'test',
        },
      };

      await fluxshareService.fluxShareDownloadFile(req, res);

      sinon.assert.calledOnceWithExactly(res.download, sinon.match.string, 'test');
    });

    it('should create error message if user is unauthorized, file not found in db', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves(null);
      const req = {
        params: {
          file: 'test',
          token: 'token2',
        },
      };

      await fluxshareService.fluxShareDownloadFile(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create success message if user is unauthorized, file found in db', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves(true);
      const req = {
        params: {
          file: 'test',
          token: 'token2',
        },
      };
      const createLstat = () => {
        const lstat = { test: 'testing' };
        lstat.isDirectory = sinon.fake(() => false);
        return lstat;
      };
      sinon.stub(fs.promises, 'lstat').resolves(createLstat());

      await fluxshareService.fluxShareDownloadFile(req, res);

      sinon.assert.calledOnceWithExactly(res.download, sinon.match.string, 'test');
    });

    it('should create error message if user does not have proper access + file and token params are empty', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test2',
        },
      };
      await fluxshareService.fluxShareDownloadFile(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if no file was specified', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test2',
        },
      };

      await fluxshareService.fluxShareDownloadFile(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'No file specified' },
      });
    });
  });

  describe('fluxShareRename tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if folder was renamed', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          oldpath: 'test',
          newname: 'test2',
        },
      };

      sinon.stub(fs.promises, 'rename').resolves(true);

      await fluxshareService.fluxShareRename(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Rename successful' },
      });
    });

    it('should create error message if no new name is specified', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          oldpath: 'test',
        },
        query: {
          test: 'test',
        },
      };

      sinon.stub(fs.promises, 'rename').resolves(true);

      await fluxshareService.fluxShareRename(req, res);

      sinon.assert.calledOnceWithExactly(res.write, '{"status":"error","data":{"name":"Error","message":"No new name specified"}}');
    });

    it('should create error message if new name is invalid', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          oldpath: 'test',
          newname: 'te/st2',
        },
        query: {
          test: 'test',
        },
      };

      sinon.stub(fs.promises, 'rename').resolves(true);

      await fluxshareService.fluxShareRename(req, res);

      sinon.assert.calledOnceWithExactly(res.write, '{"status":"error","data":{"name":"Error","message":"New name is invalid"}}');
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareRename(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if no folder was specified', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test2',
        },
      };

      await fluxshareService.fluxShareRename(req, res);

      sinon.assert.calledOnceWithExactly(res.write, '{"status":"error","data":{"name":"Error","message":"No file nor folder to rename specified"}}');
    });
  });

  describe('fluxShareRemoveFile tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if file was removed', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          file: 'test',
        },
      };

      sinon.stub(fs.promises, 'unlink').resolves(true);

      await fluxshareService.fluxShareRemoveFile(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'File Removed' },
      });
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareRemoveFile(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if no file was specified', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test2',
        },
      };

      await fluxshareService.fluxShareRemoveFile(req, res);

      sinon.assert.calledOnceWithExactly(res.write, '{"status":"error","data":{"name":"Error","message":"No file specified"}}');
    });
  });

  describe('fluxShareRemoveFolder tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if folder was removed', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          folder: 'test',
        },
      };

      sinon.stub(fs.promises, 'rmdir').resolves(true);

      await fluxshareService.fluxShareRemoveFolder(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Folder Removed' },
      });
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareRemoveFolder(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if no folder was specified', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test2',
        },
      };

      await fluxshareService.fluxShareRemoveFolder(req, res);

      sinon.assert.calledOnceWithExactly(res.write, '{"status":"error","data":{"name":"Error","message":"No folder specified"}}');
    });
  });

  describe('fluxShareCreateFolder tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if folder was removed', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          folder: 'test',
        },
      };

      sinon.stub(fs.promises, 'mkdir').resolves(true);

      await fluxshareService.fluxShareCreateFolder(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Folder Created' },
      });
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareCreateFolder(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });
  });

  describe('fluxShareFileExists tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create success message if folder was removed', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          file: 'test',
        },
      };

      sinon.stub(fs.promises, 'access').resolves(true);

      await fluxshareService.fluxShareFileExists(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { fileExists: true } });
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareFileExists(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if no folder was specified', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves('all good');
      const req = {
        params: {
          test: 'test',
        },
        query: {
          test: 'test2',
        },
      };
      sinon.stub(fs.promises, 'access').throws('error');

      await fluxshareService.fluxShareFileExists(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { fileExists: false } });
    });
  });

  describe('fluxShareGetFolder tests', () => {
    let verifyPrivilegeStub;
    let dbStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      dbStub = sinon.stub(dbHelper, 'findInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();
      dbStub.resolves('all good');

      await fluxshareService.fluxShareGetFolder(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create success message with folder data', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves();
      const req = {
        params: {
          folder: 'test',
        },
      };
      sinon.stub(fs.promises, 'readdir').resolves(['file1', 'file2', 'file3']);
      const generatelstatResponse = () => {
        const lsres = { test: 'testing' };
        lsres.isDirectory = sinon.fake(() => true);
        lsres.isFile = sinon.fake(() => true);
        lsres.isSymbolicLink = sinon.fake(() => true);
        return lsres;
      };
      sinon.stub(fs, 'statSync').returns({
        size: 1000000,
        isDirectory: sinon.fake(() => false),
      });
      sinon.stub(fs.promises, 'lstat').resolves(generatelstatResponse());
      sinon.stub(fs, 'readdirSync').returns(['file1', 'file2']);

      await fluxshareService.fluxShareGetFolder(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: [
          {
            name: 'file1',
            size: 2000000,
            isDirectory: true,
            isFile: true,
            isSymbolicLink: true,
            createdAt: undefined,
            modifiedAt: undefined,
            shareToken: undefined,
            shareFile: undefined,
          },
          {
            name: 'file2',
            size: 2000000,
            isDirectory: true,
            isFile: true,
            isSymbolicLink: true,
            createdAt: undefined,
            modifiedAt: undefined,
            shareToken: undefined,
            shareFile: undefined,
          },
          {
            name: 'file3',
            size: 2000000,
            isDirectory: true,
            isFile: true,
            isSymbolicLink: true,
            createdAt: undefined,
            modifiedAt: undefined,
            shareToken: undefined,
            shareFile: undefined,
          },
        ],
      });
    });

    it('should create an error message if lstat throws error', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();
      dbStub.resolves();
      const req = {
        params: {
          folder: 'test',
        },
      };
      sinon.stub(fs.promises, 'readdir').resolves(['file1', 'file2', 'file3']);

      sinon.stub(fs, 'statSync').returns({
        size: 1000000,
        isDirectory: sinon.fake(() => false),
      });
      sinon.stub(fs.promises, 'lstat').throws(new Error('This is an error!'));
      sinon.stub(fs, 'readdirSync').returns(['file1', 'file2']);

      await fluxshareService.fluxShareGetFolder(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'This is an error!' },
      });
    });
  });

  describe('getSpaceAvailableForFluxShare tests', () => {
    beforeEach(() => {
      sinon.stub(generalService, 'getNewNodeTier').returns('stratus');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should properly return free space on the node if all volumes are proper', async () => {
      sinon.stub(util, 'promisify').returns(() => [
        {
          filesystem: '/dev/',
          mount: 'test',
          size: '1000',
        },
        {
          filesystem: '/dev/',
          mount: 'test',
          size: '2010',
        },
      ]);

      const result = await fluxshareService.getSpaceAvailableForFluxShare();

      expect(result).to.equal(2132);
    });

    it('should properly return free space on the node if one of the volumes is not /dev/ filesystem', async () => {
      sinon.stub(util, 'promisify').returns(() => [
        {
          filesystem: '/dev/',
          mount: 'test',
          size: '1000',
        },
        {
          filesystem: 'test',
          mount: 'test',
          size: '2010',
        },
      ]);

      const result = await fluxshareService.getSpaceAvailableForFluxShare();

      expect(result).to.equal(122);
    });

    it('should properly return free space on the node if all of the volumes are not /dev/ filesystem', async () => {
      sinon.stub(util, 'promisify').returns(() => [
        {
          filesystem: 'test',
          mount: 'test',
          size: '1000',
        },
        {
          filesystem: 'test',
          mount: 'test',
          size: '2010',
        },
      ]);

      const result = await fluxshareService.getSpaceAvailableForFluxShare();

      expect(result).to.equal(2);
    });

    it('should properly return free space on the node if one of the volumes has loop in the filesystem', async () => {
      sinon.stub(util, 'promisify').returns(() => [
        {
          filesystem: '/dev/',
          mount: 'test',
          size: '1000',
        },
        {
          filesystem: '/dev/loop',
          mount: 'test',
          size: '2010',
        },
      ]);

      const result = await fluxshareService.getSpaceAvailableForFluxShare();

      expect(result).to.equal(122);
    });

    it('should properly return free space on the node if one of the volumes has boot in the mount', async () => {
      sinon.stub(util, 'promisify').returns(() => [
        {
          filesystem: '/dev/',
          mount: 'test',
          size: '1000',
        },
        {
          filesystem: '/dev/',
          mount: 'boot',
          size: '2010',
        },
      ]);

      const result = await fluxshareService.getSpaceAvailableForFluxShare();

      expect(result).to.equal(122);
    });

    it('should properly return free space on the node if one of the volumes has loop in the filesystem and / in the mount', async () => {
      sinon.stub(util, 'promisify').returns(() => [
        {
          filesystem: '/dev/',
          mount: 'test',
          size: '1000',
        },
        {
          filesystem: '/dev/boot',
          mount: '/',
          size: '2010',
        },
      ]);

      const result = await fluxshareService.getSpaceAvailableForFluxShare();

      expect(result).to.equal(2132);
    });
  });

  describe('fluxShareStorageStats tests', () => {
    let verifyPrivilegeStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      sinon.stub(generalService, 'getNewNodeTier').returns('stratus');
      sinon.stub(util, 'promisify').returns(() => [
        {
          filesystem: '/dev/',
          mount: 'test',
          size: '1000',
        },
        {
          filesystem: '/dev/',
          mount: 'test',
          size: '2010',
        },
      ]);
      sinon.stub(fs, 'readdirSync').returns(['file1', 'file2']);
      sinon.stub(fs, 'statSync').returns({
        size: 1000000,
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await fluxshareService.fluxShareStorageStats(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create success message if access is valid', async () => {
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();

      await fluxshareService.fluxShareStorageStats(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { available: 2131.998, used: 0.002, total: 2132 },
      });
    });
  });

  describe('fluxShareUpload tests', () => {
    let verifyPrivilegeStub;
    let logSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);

      await fluxshareService.fluxShareUpload(undefined, undefined);

      sinon.assert.calledOnce(logSpy);
    });
    // TODO: Add more tests in the future, once we figure out how to test these
  });
});
