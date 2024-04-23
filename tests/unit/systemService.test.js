const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;

const fs = require('node:fs/promises');

const log = require('../../ZelBack/src/lib/log');
const systemService = require('../../ZelBack/src/services/systemService');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

describe('system Services tests', () => {
  describe('get last cache time update tests', () => {
    let statStub;
    let stubFake;

    beforeEach(() => {
      statStub = sinon.stub(fs, 'stat');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return 0 if neither cache path exists', async () => {
      statStub.rejects(new Error('No file'));

      const res = await systemService.cacheUpdateTime();

      expect(res).to.equal(0);
    });

    it('should return mtime of update-success-stamp if it exists', async () => {
      const testTime = 1713858779721.123;

      stubFake = sinon.fake(async (path) => {
        if (path === '/var/lib/apt/periodic/update-success-stamp') {
          return { mtimeMs: testTime };
        }
        throw new Error('Test Error here');
      });
      statStub.callsFake(stubFake);

      const res = await systemService.cacheUpdateTime();

      expect(res).to.equal(testTime);
    });

    it('should return mtime of lists if stamp does not exist and lists does', async () => {
      const testTime = 1713858779721.123;

      stubFake = sinon.fake(async (path) => {
        if (path === '/var/lib/apt/periodic/update-success-stamp') {
          throw new Error('Test Error here');
        }
        return { mtimeMs: testTime };
      });
      statStub.callsFake(stubFake);

      const res = await systemService.cacheUpdateTime();

      expect(res).to.equal(testTime);
    });
  });

  describe('updateAptCache tests', () => {
    let statStub;
    let runCmdStub;

    beforeEach(() => {
      statStub = sinon.stub(fs, 'stat');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should skip updating if last update was within 24 hours', async () => {
      const now = 1713858779721;

      sinon.useFakeTimers({
        now,
      });

      // 10 seconds ago
      statStub.resolves({ mtimeMs: now - 10000 });

      const cacheUpdateError = await systemService.updateAptCache();

      expect(cacheUpdateError).to.equal(false);
      sinon.assert.notCalled(runCmdStub);
    });

    it('should update cache if last update was over 24 hours ago', async () => {
      const now = 1713858779721;
      const oneDay = 86400 * 1000;

      runCmdStub.resolves({ error: null });

      sinon.useFakeTimers({
        now,
      });

      // 2 days ago
      statStub.resolves({ mtimeMs: now - oneDay * 2 });

      const cacheUpdateError = await systemService.updateAptCache();

      expect(cacheUpdateError).to.equal(false);
      sinon.assert.calledOnceWithExactly(runCmdStub, 'apt-get', { runAsRoot: true, params: ['update'] });
    });
  });

  describe('updateSyncthing tests', () => {
    let statStub;
    let runCmdStub;

    beforeEach(() => {
      statStub = sinon.stub(fs, 'stat');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should not upgrade syncthing if there is an error with apt-get update', async () => {
      const now = 1713858779721;
      const oneDay = 86400 * 1000;

      runCmdStub.resolves({ error: new Error('No update for apt cache') });

      sinon.useFakeTimers({
        now,
      });

      // 2 days ago
      statStub.resolves({ mtimeMs: now - oneDay * 2 });

      const error = await systemService.upgradePackage('syncthing');

      expect(error).to.equal(true);
      // if there was no error, this would be called twice
      sinon.assert.calledOnceWithExactly(runCmdStub, 'apt-get', { runAsRoot: true, params: ['update'] });
    });

    it('should upgrade syncthing if there is no error with apt-get update', async () => {
      const now = 1713858779721;
      const oneDay = 86400 * 1000;

      runCmdStub.resolves({ error: null });

      sinon.useFakeTimers({
        now,
      });

      // 2 days ago
      statStub.resolves({ mtimeMs: now - oneDay * 2 });

      const error = await systemService.upgradePackage('syncthing');

      expect(error).to.equal(false);
      sinon.assert.calledWithExactly(runCmdStub, 'apt-get', { runAsRoot: true, params: ['install', 'syncthing'] });
    });
  });

  describe('monitorSyncthingPackage tests', () => {
    let statStub;
    let runCmdStub;
    let logSpy;

    beforeEach(() => {
      systemService.resetTimer();
      statStub = sinon.stub(fs, 'stat');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
      logSpy = sinon.spy(log, 'info');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call upgradeSyncthing immediately if on lower version', async () => {
      const now = 1713858779721;

      runCmdStub.resolves({ error: null, stdout: 'v1.27.3' });

      // don't update
      statStub.resolves({ mtimeMs: now });

      sinon.useFakeTimers({
        now,
      });
    })

    it('should not call upgradeSyncthing if on correct version', async () => {
      const now = 1713858779721;

      runCmdStub.resolves({ error: null, stdout: 'v1.27.6' });

      // don't update
      statStub.resolves({ mtimeMs: now });

      sinon.useFakeTimers({
        now,
      });

      await systemService.monitorSyncthingPackage();
      sinon.assert.notCalled(logSpy);
    });

    it('should call upgradeSyncthing every month', async () => {
      const now = 1713858779721;
      const oneDay = 86400 * 1000;

      runCmdStub.resolves({ error: null, stdout: '1.27.3' });

      // don't update
      statStub.resolves({ mtimeMs: now });

      const clock = sinon.useFakeTimers({
        now,
      });

      await systemService.monitorSyncthingPackage();
      sinon.assert.calledOnceWithExactly(logSpy, 'syncthing is on the latest version');

      // go forward 30 days
      await clock.tickAsync(30 * oneDay + oneDay);

      const filteredCalls = logSpy.getCalls().filter(
        (call) => call.args[0] === 'syncthing is on the latest version',
      );

      expect(filteredCalls.length).to.equal(2);
    });
  });
});
