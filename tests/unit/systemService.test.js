const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;

const config = require('config');

const fs = require('node:fs/promises');
const axios = require('axios');

const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

const systemService = require('../../ZelBack/src/services/systemService');

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
    systemService.getQueue().addWorker(systemService.aptRunner);

    beforeEach(() => {
      statStub = sinon.stub(fs, 'stat');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
      systemService.getQueue().clear();
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
      sinon.assert.calledOnceWithExactly(runCmdStub, 'apt-get', { runAsRoot: true, params: ['-o', 'DPkg::Lock::Timeout=180', 'update'] });
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
      systemService.getQueue().clear();
    });

    it('should upgrade syncthing', async () => {
      // it checks for version first with dpkg, check that
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
      sinon.assert.calledWithExactly(runCmdStub, 'apt-get', { runAsRoot: true, params: ['-o', 'DPkg::Lock::Timeout=180', 'install', 'syncthing'] });
    });
  });

  describe('monitorSyncthingPackage tests', () => {
    let statStub;
    let runCmdStub;
    let logSpy;

    beforeEach(() => {
      systemService.resetTimers();
      statStub = sinon.stub(fs, 'stat');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
      logSpy = sinon.spy(log, 'info');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should use stats.runonflux.io over local minimum version', async () => {
      const statsEndpoint = 'https://stats.runonflux.io/getmodulesminimumversions';
      const statsVersion = '1.27.3';

      const axiosRes = { data: { status: 'success', data: { syncthing: statsVersion } } };

      const axiosStub = sinon.stub(axios, 'get').resolves(axiosRes);

      runCmdStub.resolves({ error: null, stdout: statsVersion });

      await systemService.monitorSyncthingPackage();

      sinon.assert.calledOnceWithExactly(axiosStub, statsEndpoint, { timeout: 10000 });
      sinon.assert.calledWith(logSpy, `Checking package syncthing is updated to version ${statsVersion}`);
    });

    it('should fallback to local syncthing version if there is an axios error', async () => {
      const statsEndpoint = 'https://stats.runonflux.io/getmodulesminimumversions';
      const localVersion = '1.25.2';

      config.minimumSyncthingAllowedVersion = localVersion;

      const axiosStub = sinon.stub(axios, 'get').rejects(new Error('Simulated Axios error'));

      runCmdStub.resolves({ error: null, stdout: localVersion });

      await systemService.monitorSyncthingPackage();

      sinon.assert.calledOnceWithExactly(axiosStub, statsEndpoint, { timeout: 10000 });
      sinon.assert.calledWith(logSpy, `Checking package syncthing is updated to version ${localVersion}`);
    });

    it('should fallback to local syncthing version if there is a fluxstats error', async () => {
      const statsEndpoint = 'https://stats.runonflux.io/getmodulesminimumversions';
      const localVersion = '1.25.2';

      config.minimumSyncthingAllowedVersion = localVersion;

      const axiosStub = sinon.stub(axios, 'get').resolves({ data: { status: 'error', data: { code: 123, error: 'Test error', message: 'Broken' } } });

      runCmdStub.resolves({ error: null, stdout: localVersion });

      await systemService.monitorSyncthingPackage();

      sinon.assert.calledOnceWithExactly(axiosStub, statsEndpoint, { timeout: 10000 });
      sinon.assert.calledWith(logSpy, `Checking package syncthing is updated to version ${localVersion}`);
    });

    it('should fallback to local syncthing version if fluxstats syncthing response is empty', async () => {
      const statsEndpoint = 'https://stats.runonflux.io/getmodulesminimumversions';
      const localVersion = '1.25.2';

      config.minimumSyncthingAllowedVersion = localVersion;

      const axiosStub = sinon.stub(axios, 'get').resolves({ data: { status: 'success', data: { syncthing: null } } });

      runCmdStub.resolves({ error: null, stdout: localVersion });

      await systemService.monitorSyncthingPackage();

      sinon.assert.calledOnceWithExactly(axiosStub, statsEndpoint, { timeout: 10000 });
      sinon.assert.calledWith(logSpy, `Checking package syncthing is updated to version ${localVersion}`);
    });

    it('should upgrade syncthing immediately if on lower version', async () => {
      const now = 1713858779721;

      const statsVersion = '2.2.2';

      const axiosRes = { data: { status: 'success', data: { syncthing: statsVersion } } };

      sinon.stub(axios, 'get').resolves(axiosRes);

      const cmdRunner = sinon.fake((cmd) => {
        if (cmd === 'dpkg-query') return { error: null, stdout: '1.27.3' };
        if (cmd === 'apt-get') return { error: null };
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      // don't update apt cache
      statStub.resolves({ mtimeMs: now });

      sinon.useFakeTimers({
        now,
      });

      await systemService.monitorSyncthingPackage();

      sinon.assert.calledWithExactly(runCmdStub, 'apt-get', { runAsRoot: true, params: ['-o', 'DPkg::Lock::Timeout=180', 'install', 'syncthing'] });
    });

    it('should not call upgradeSyncthing if on correct version', async () => {
      const now = 1713858779721;

      const statsVersion = '2.2.2';

      const axiosRes = { data: { status: 'success', data: { syncthing: statsVersion } } };

      sinon.stub(axios, 'get').resolves(axiosRes);

      const cmdRunner = sinon.fake((cmd) => {
        if (cmd === 'dpkg-query') return { error: null, stdout: statsVersion };
        if (cmd === 'apt-get') return { error: null };
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      // don't update apt cache
      statStub.resolves({ mtimeMs: now });

      sinon.useFakeTimers({
        now,
      });

      await systemService.monitorSyncthingPackage();
      sinon.assert.calledOnceWithMatch(runCmdStub, 'dpkg-query');
    });
  });

  describe('monitorAptCache tests', () => {
    let runCmdStub;
    let errorSpy;

    beforeEach(() => {
      systemService.resetTimers();
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
      errorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should bail out if the apt cache is alredy being monitored', async () => {
      const event = { options: { command: 'install', params: ['syncthing'] }, error: new Error('Non lock error') };

      const cmdRunner = sinon.fake((cmd) => {
        // dpkg --configure -a
        if (cmd === 'dpkg') return '';
        // apt-get check
        if (cmd === 'apt-get') return { error: new Error('Still broken') };
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      await systemService.monitorAptCache(event);
      // calls configure and check
      sinon.assert.calledTwice(cmdRunner);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Unable to run apt-get command(s), all apt activities are halted, will resume in 12 hours.');

      // should return immediately as timer is running
      await systemService.monitorAptCache(event);
      sinon.assert.calledTwice(cmdRunner);
      sinon.assert.calledOnce(errorSpy);
    });

    it('should resume halted queue if the error was for apt-get update', async () => {
      const event = { options: { command: 'update', params: [] }, error: new Error('Lock error') };

      let count = 0;

      const worker = () => { count += 1; };

      const queue = systemService.getQueue();

      queue.halted = true;
      queue.worker = worker;
      queue.push('42');

      expect(count).to.equal(0);

      await systemService.monitorAptCache(event);

      expect(queue.halted).to.equal(false);
      expect(count).to.equal(1);
    });

    it('should retry 3 times with a 10 minute wait between retries if unable to get a lock', async () => {
      const clock = sinon.useFakeTimers();

      let checkCount = 0;

      const lockError = new Error('No lock: /var/lib/dpkg/lock-frontend');
      const event = { options: { command: 'install', params: ['syncthing'] }, error: lockError };

      const cmdRunner = sinon.fake((cmd) => {
        // apt-get check
        if (cmd === 'apt-get') {
          checkCount += 1;
          return { error: lockError };
        }
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      const promise = systemService.monitorAptCache(event);

      expect(checkCount).to.equal(0);
      await clock.tickAsync(10 * 60 * 1000);
      expect(checkCount).to.equal(1);
      await clock.tickAsync(10 * 60 * 1000);
      expect(checkCount).to.equal(2);
      await clock.tickAsync(10 * 60 * 1000);
      expect(checkCount).to.equal(3);

      await promise;
      expect(checkCount).to.equal(3);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Unable to run apt-get command(s), all apt activities are halted, will resume in 12 hours.');
    });

    it('should resume if there is a lock error and it clears', async () => {
      const clock = sinon.useFakeTimers();
      let checkCount = 0;
      let workCount = 0;

      const worker = () => { workCount += 1; };

      const queue = systemService.getQueue();

      queue.halted = true;
      queue.worker = worker;
      queue.push('42');

      expect(workCount).to.equal(0);

      const lockError = new Error('No lock: /var/lib/dpkg/lock-frontend');
      const event = { options: { command: 'install', params: ['syncthing'] }, error: lockError };

      const cmdRunner = sinon.fake((cmd) => {
        // apt-get check
        if (cmd === 'apt-get') {
          checkCount += 1;
          if (checkCount === 1) return { error: lockError };
          return { error: null };
        }
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      const promise = systemService.monitorAptCache(event);

      expect(checkCount).to.equal(0);
      await clock.tickAsync(10 * 60 * 1000);
      expect(checkCount).to.equal(1);
      await clock.tickAsync(10 * 60 * 1000);
      expect(checkCount).to.equal(2);

      await promise;
      expect(checkCount).to.equal(2);
      expect(workCount).to.equal(1);

      sinon.assert.notCalled(errorSpy);
    });

    it('should run dpkg configure if there is a non Lock error after a lock error', async () => {
      const clock = sinon.useFakeTimers();

      let dpkgCount = 0;

      const lockError = new Error('No lock: /var/lib/dpkg/lock-frontend');
      const event = { options: { command: 'install', params: ['syncthing'] }, error: lockError };

      const cmdRunner = sinon.fake((cmd) => {
        // apt-get check
        if (cmd === 'apt-get') return { error: new Error('Some other error') };
        if (cmd === 'dpkg') {
          dpkgCount += 1;
          return { error: null };
        }
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      const promise = systemService.monitorAptCache(event);
      await clock.tickAsync(10 * 60 * 1000);
      await promise;
      expect(dpkgCount).to.equal(1);
    });

    it('should resume if there is a non lock error and it clears after running dpkg configure', async () => {
      let workCount = 0;

      const worker = () => { workCount += 1; };

      const queue = systemService.getQueue();

      queue.halted = true;
      queue.worker = worker;
      queue.push('42');

      expect(workCount).to.equal(0);

      const nonLockError = new Error('Some other error');
      const event = { options: { command: 'install', params: ['syncthing'] }, error: nonLockError };

      const cmdRunner = sinon.fake((cmd) => {
        // apt-get check
        if (cmd === 'apt-get') return { error: null };
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      await systemService.monitorAptCache(event);

      sinon.assert.notCalled(errorSpy);
      expect(workCount).to.equal(1);
    });

    it('should resume queue activities in 12 hours if there is an unrecoverable error', async () => {
      const clock = sinon.useFakeTimers();
      let workCount = 0;

      const worker = () => { workCount += 1; };

      const queue = systemService.getQueue();

      queue.halted = true;
      queue.worker = worker;
      queue.push('42');

      expect(workCount).to.equal(0);

      const nonLockError = new Error('Some other error');
      const event = { options: { command: 'install', params: ['syncthing'] }, error: nonLockError };

      const cmdRunner = sinon.fake((cmd) => {
        // apt-get check
        if (cmd === 'apt-get') return { error: nonLockError };
        if (cmd === 'dpkg') return { error: null };
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      await systemService.monitorAptCache(event);

      sinon.assert.calledOnceWithExactly(errorSpy, 'Unable to run apt-get command(s), all apt activities are halted, will resume in 12 hours.');
      expect(workCount).to.equal(0);

      // roll forward 11 hours
      await clock.tickAsync(1000 * 3600 * 11);
      expect(workCount).to.equal(0);
      // another hour
      await clock.tickAsync(1000 * 3600);
      expect(workCount).to.equal(1);
    });
  });
});
