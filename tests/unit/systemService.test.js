const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;

const config = require('config');

const fs = require('node:fs/promises');
const axios = require('axios');

const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

const systemService = require('../../ZelBack/src/services/systemService');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');

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
      sinon.assert.calledOnceWithExactly(runCmdStub, 'env', { runAsRoot: true, params: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', '-y', '-o', 'DPkg::Lock::Timeout=180', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold', 'update'] });
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
      sinon.assert.calledWithExactly(runCmdStub, 'env', { runAsRoot: true, params: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', '-y', '-o', 'DPkg::Lock::Timeout=180', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold', 'install', 'syncthing'] });
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

      // for aptSource
      statStub.resolves(true);

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

      // for aptSource
      statStub.resolves(true);

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

      // for aptSource
      statStub.resolves(true);

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

      // for aptSource
      statStub.resolves(true);

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
        if (cmd === 'dpkg-query') return { error: null, stdout: '1.27.3:install ok installed' };
        if (cmd === 'env') return { error: null };
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      // don't update apt cache
      statStub.resolves({ mtimeMs: now });

      sinon.useFakeTimers({
        now,
      });

      await systemService.monitorSyncthingPackage();

      sinon.assert.calledWithExactly(runCmdStub, 'env', { runAsRoot: true, params: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', '-y', '-o', 'DPkg::Lock::Timeout=180', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold', 'install', 'syncthing'] });
    });

    it('should upgrade syncthing immediately if correct version present but uninstalled', async () => {
      const now = 1713858779721;

      const statsVersion = '2.2.2';

      const axiosRes = { data: { status: 'success', data: { syncthing: statsVersion } } };

      sinon.stub(axios, 'get').resolves(axiosRes);

      const cmdRunner = sinon.fake((cmd) => {
        if (cmd === 'dpkg-query') return { error: null, stdout: '2.2.2:deinstall ok config-files' };
        if (cmd === 'env') return { error: null };
        return null;
      });

      runCmdStub.callsFake(cmdRunner);

      // don't update apt cache
      statStub.resolves({ mtimeMs: now });

      sinon.useFakeTimers({
        now,
      });

      await systemService.monitorSyncthingPackage();

      sinon.assert.calledWithExactly(runCmdStub, 'env', { runAsRoot: true, params: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', '-y', '-o', 'DPkg::Lock::Timeout=180', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold', 'install', 'syncthing'] });
    });

    it('should not call upgradeSyncthing if on correct version', async () => {
      const now = 1713858779721;

      const statsVersion = '2.2.2';
      const dpgkVersion = '2.2.2|install ok installed';

      const axiosRes = { data: { status: 'success', data: { syncthing: statsVersion } } };

      sinon.stub(axios, 'get').resolves(axiosRes);

      const cmdRunner = sinon.fake((cmd) => {
        if (cmd === 'dpkg-query') return { error: null, stdout: dpgkVersion };
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
      // monitorSyncthingPackage calls getPackageVersion once (optimized):
      // The current version is fetched once and passed to ensurePackageVersion
      sinon.assert.calledOnce(runCmdStub.withArgs('dpkg-query'));
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
      systemService.getQueue().clear();
      systemService.resetTimers();
    });

    after(() => {
      systemService.getQueue().worker = systemService.aptRunner;
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

      const cmdRunner = sinon.fake((cmd, opts) => {
        // apt-get check
        if (cmd === 'apt-get' && opts.params.includes('check')) {
          checkCount += 1;
          return { error: lockError };
        }
        if (cmd === 'fuser') return { error: null };
        if (cmd === 'dpkg') return { error: null };
        if (cmd === 'apt-get') return { error: null }; // install --fix-broken
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
      // extra call to check after reconfigure
      expect(checkCount).to.equal(4);

      await promise;
      expect(checkCount).to.equal(4);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Unable to run apt-get command(s), clearing the queue and resetting state.');
    });

    it('should SIGTERM, then SIGKILL any processes holding the locks after 30 minutes', async () => {
      const clock = sinon.useFakeTimers();

      let checkCount = 0;

      const lockError = new Error('No lock: /var/lib/dpkg/lock-frontend');
      const event = { options: { command: 'install', params: ['syncthing'] }, error: lockError };

      const cmdRunner = sinon.fake((cmd, opts) => {
        // apt-get check
        if (cmd === 'apt-get' && opts.params.includes('check')) {
          checkCount += 1;
          if (checkCount === 4) return { error: null };
          return { error: lockError };
        }
        if (cmd === 'dpkg') return { error: null };
        if (cmd === 'fuser' && opts.params[1] === '-TERM') return { error: new Error('Unable to kill processes') };
        if (cmd === 'fuser' && opts.params[1] === '-KILL') return { error: null };
        if (cmd === 'apt-get' && opts.params.includes('install')) return { error: null };
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
      // extra call to check after reconfigure
      expect(checkCount).to.equal(4);

      await promise;
      expect(checkCount).to.equal(4);
      sinon.assert.calledWith(runCmdStub, 'fuser', { runAsRoot: true, timeout: 10000, params: ['-k', '-TERM', '/var/lib/dpkg/lock', '/var/lib/dpkg/lock-frontend'] });
      sinon.assert.calledWith(runCmdStub, 'fuser', { runAsRoot: true, timeout: 10000, params: ['-k', '-KILL', '/var/lib/dpkg/lock', '/var/lib/dpkg/lock-frontend'] });
      sinon.assert.notCalled(errorSpy);
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

    it('should clear the queue and reset state if there is an unrecoverable error', async () => {
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

      sinon.assert.calledOnceWithExactly(errorSpy, 'Unable to run apt-get command(s), clearing the queue and resetting state.');
      expect(workCount).to.equal(0);
      expect(queue.workAvailable).to.equal(false);
      expect(queue.halted).to.equal(false);
    });
  });

  describe('addSyncthingRepository tests', () => {
    let statStub;
    let runCmdStub;
    let axiosStub;
    let accessStub;
    let writeStub;

    beforeEach(() => {
      systemService.resetTimers();
      statStub = sinon.stub(fs, 'stat');
      accessStub = sinon.stub(fs, 'access');
      writeStub = sinon.stub(fs, 'writeFile');
      axiosStub = sinon.stub(axios, 'get');
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should bail out if the source already exists', async () => {
      // for aptSource
      statStub.resolves(true);

      await systemService.addSyncthingRepository();

      sinon.assert.calledOnceWithExactly(statStub, '/etc/apt/sources.list.d/syncthing.list');
      sinon.assert.notCalled(axiosStub);
      sinon.assert.notCalled(runCmdStub);
    });

    it('should fetch and install keyfile in keyring', async () => {
      const expectedPath = '/usr/share/keyrings/syncthing-archive-keyring.gpg';
      // for aptSource - means we need to install
      statStub.resolves(false);

      const axiosRes = { data: 'Binary Data Blob' };
      axiosStub.resolves(axiosRes);

      // can access /usr/share/keyrings
      accessStub.resolves(null);

      // no write error
      writeStub.resolves(null);

      // can update cache
      runCmdStub.resolves({ error: false });

      await systemService.addSyncthingRepository();

      sinon.assert.calledWithExactly(statStub, '/etc/apt/sources.list.d/syncthing.list');
      sinon.assert.calledOnceWithExactly(axiosStub, 'https://syncthing.net/release-key.gpg', { responseType: 'arraybuffer', timeout: 10000 });
      sinon.assert.calledWithExactly(accessStub, '/usr/share/keyrings', 6);
      sinon.assert.calledWithExactly(writeStub, expectedPath, Buffer.from(axiosRes.data, 'binary'));
    });

    it('should retry fetching keyring file is there is an axios error', async () => {
      const clock = sinon.useFakeTimers();

      const expectedPath = '/usr/share/keyrings/syncthing-archive-keyring.gpg';

      // for aptSource - means we need to install
      statStub.resolves(false);

      let calls = 0;

      const axiosRes = { data: 'Binary Data Blob' };
      const axiosFake = sinon.fake(async () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error('Axios Error'));
        }
        return axiosRes;
      });
      axiosStub.callsFake(axiosFake);

      // can access /usr/share/keyrings
      accessStub.resolves(null);

      // no write error
      writeStub.resolves(null);

      // can update cache
      runCmdStub.resolves({ error: false });

      const promise = systemService.addSyncthingRepository();

      await clock.tickAsync(30000);

      await promise;

      sinon.assert.calledWithExactly(statStub, '/etc/apt/sources.list.d/syncthing.list');
      sinon.assert.calledWithExactly(axiosStub, 'https://syncthing.net/release-key.gpg', { responseType: 'arraybuffer', timeout: 10000 });
      expect(calls).to.equal(2);
      sinon.assert.calledWithExactly(accessStub, '/usr/share/keyrings', 6);
      sinon.assert.calledWithExactly(writeStub, expectedPath, Buffer.from(axiosRes.data, 'binary'));
    });

    it('should not add apt source if there is a problem with keyfile', async () => {
      const clock = sinon.useFakeTimers();

      // for aptSource - means we need to install
      statStub.resolves(false);

      axiosStub.rejects('Test Axios Error');

      // can access /usr/share/keyrings
      accessStub.resolves(null);

      // no write error
      writeStub.resolves(null);

      // can update cache
      runCmdStub.resolves({ error: false });

      const promise = systemService.addSyncthingRepository();

      await clock.tickAsync(3 * 30000);
      await promise;

      sinon.assert.calledThrice(axiosStub);
      sinon.assert.notCalled(accessStub);
      sinon.assert.notCalled(writeStub);
    });

    it('should add apt source if keyfile was added', async () => {
      // for aptSource - means we need to install
      statStub.resolves(false);

      const axiosRes = { data: 'Binary Data Blob' };
      axiosStub.resolves(axiosRes);

      // can access /usr/share/keyrings
      accessStub.resolves(null);

      // no write error
      writeStub.resolves(null);

      // can update cache
      runCmdStub.resolves({ error: false });

      await systemService.addSyncthingRepository();

      sinon.assert.calledWithExactly(writeStub, '/etc/apt/sources.list.d/syncthing.list', 'deb [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable-v2\n');
    });

    it('should force update cache if source added, even if cache was just updated', async () => {
      const now = 1713858779721;
      const oneMinute = 60 * 1000;

      sinon.useFakeTimers({
        now,
      });

      const statFake = sinon.fake(async (cmd) => {
        if (cmd === '/etc/apt/sources.list.d/syncthing.list') return false;
        // 10 minutes ago
        return { mtimeMs: now - oneMinute * 10 };
      });

      statStub.callsFake(statFake);

      const axiosRes = { data: 'Binary Data Blob' };
      axiosStub.resolves(axiosRes);

      // can access /usr/share/keyrings
      accessStub.resolves(null);

      // no write error
      writeStub.resolves(null);

      // can update cache
      runCmdStub.resolves({ error: false });

      await systemService.addSyncthingRepository();

      sinon.assert.calledWithExactly(writeStub, '/etc/apt/sources.list.d/syncthing.list', 'deb [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable-v2\n');
      sinon.assert.calledWithExactly(runCmdStub, 'env', { runAsRoot: true, params: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', '-y', '-o', 'DPkg::Lock::Timeout=180', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold', 'update'] });
    });
  });
  describe('enableFluxdZmq tests', () => {
    let statStub;
    let errorSpy;
    let infoSpy;
    let configBackupStub;
    let configWriteStub;
    let runCommandStub;
    let writeStub;

    beforeEach(async () => {
      writeStub = sinon.stub(fs, 'writeFile').resolves();
      errorSpy = sinon.spy(log, 'error');
      infoSpy = sinon.spy(log, 'info');
      statStub = sinon.stub(fs, 'stat').resolves({ found: true });

      sinon.stub(fs, 'rm').resolves();
      sinon.stub(daemonServiceUtils, 'getFluxdDir').returns('/home/testuser/.flux');
      sinon.stub(daemonServiceUtils, 'getFluxdConfigPath').returns('/home/testuser/.flux/flux.conf');

      configWriteStub = sinon.stub(daemonServiceUtils, 'writeFluxdConfig').resolves();
      configBackupStub = sinon.stub(daemonServiceUtils, 'createBackupFluxdConfig').resolves();
      runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if zmq has already been enabled', async () => {
      const result = await systemService.enableFluxdZmq('tcp://127.0.0.1:16126');

      sinon.assert.calledWithExactly(statStub, '/home/testuser/.flux/.zmqEnabled');
      expect(result).to.equal(true);
    });

    it('should return false if endpoint is not a string', async () => {
      // for .zmqEnabled file
      statStub.resolves(false);

      const result = await systemService.enableFluxdZmq({ badendpoint: true });

      expect(result).to.equal(false);
    });

    it('should return false and log error if url string is unparseable', async () => {
      statStub.resolves(false);

      const result = await systemService.enableFluxdZmq('notaurl');

      expect(result).to.equal(false);
      sinon.assert.calledWithMatch(errorSpy, 'Error parsing zmqEndpoint');
    });

    it('should return false if there is an error getting flux-cli blockcount', async () => {
      statStub.resolves(false);
      runCommandStub.resolves({ error: 'Test: not running' });

      const result = await systemService.enableFluxdZmq('tcp://1.2.3.4:3333');

      expect(result).to.equal(false);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Error getting blockcount via flux-cli to validate new zmq config, skipping');
    });

    it('should return false if there is an error getting systemd zelcash status', async () => {
      statStub.resolves(false);

      runCommandStub.callsFake(async (cmd) => {
        if (cmd === 'flux-cli') return { error: null };
        return { error: 'Zelcash.service does not exist (test error)' };
      });

      const result = await systemService.enableFluxdZmq('tcp://1.2.3.4:3333');

      expect(result).to.equal(false);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Unable to get Fluxd status via systemd, skipping config update');
    });

    it('should write a fluxd config backupfile if flux-cli returns no error', async () => {
      statStub.resolves(false);
      runCommandStub.resolves({ error: null });

      await systemService.enableFluxdZmq('tcp://1.2.3.4:3333');

      sinon.assert.calledOnceWithExactly(configBackupStub, 'flux.conf.bak');
    });

    it('should write to the main fluxd config file if flux-cli returns no error', async () => {
      statStub.resolves(false);
      runCommandStub.resolves({ error: null });

      await systemService.enableFluxdZmq('tcp://1.2.3.4:3333');

      sinon.assert.calledWithExactly(configWriteStub);
    });

    it('should return if there is a parsing error on new config file', async () => {
      runCommandStub.callsFake(async (cmd, opts) => {
        const { params } = opts;
        if (params.length && params[0].startsWith('-conf')) {
          console.log('about to throw');
          return { error: new Error('test: not working') };
        }
        return { error: null };
      });

      statStub.resolves(false);

      const result = await systemService.enableFluxdZmq('tcp://1.2.3.4:3333');

      expect(result).to.equal(false);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Parsing error on new zmq fluxd config file... skipping');
    });

    it('should restart the zelcash service on successful parse of new service', async () => {
      statStub.resolves(false);

      const result = await systemService.enableFluxdZmq('tcp://1.2.3.4:3333');

      expect(result).to.equal(true);
      sinon.assert.calledOnceWithExactly(infoSpy, 'ZMQ pub/sub enabled');
      sinon.assert.calledWithExactly(runCommandStub, 'systemctl', { runAsRoot: true, params: ['restart', 'zelcash.service'] });
    });

    it('should revert config and reset if there is a problem starting fluxd', async () => {
      runCommandStub.callsFake(async (cmd, opts) => {
        if (cmd === 'systemctl' && opts.params[0] === 'restart') return { error: 'broken' };
        return { error: null };
      });

      const renameStub = sinon.stub(fs, 'rename').resolves();

      statStub.resolves(false);

      const result = await systemService.enableFluxdZmq('tcp://1.2.3.4:3333');

      expect(result).to.equal(false);
      sinon.assert.calledOnceWithExactly(renameStub, '/home/testuser/.flux/flux.conf.bak', '/home/testuser/.flux/flux.conf');
      sinon.assert.calledOnceWithExactly(errorSpy, 'Error restarting zelcash.service after config update');
    });

    it('should write lockfile if everything installed and restarted peroperly', async () => {
      statStub.resolves(false);

      const result = await systemService.enableFluxdZmq('tcp://1.2.3.4:3333');

      expect(result).to.equal(true);
      sinon.assert.calledOnceWithExactly(writeStub, '/home/testuser/.flux/.zmqEnabled', '');
    });
  });

  describe('updateSyncthingSourceComponent tests', () => {
    describe('legacy format tests', () => {
      it('should update normal legacy format with single space', () => {
        const input = 'deb [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable\n';
        const expected = 'deb [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable-v2\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });

      it('should handle legacy format with extra spaces between fields', () => {
        const input = 'deb    [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ]    https://apt.syncthing.net/    syncthing    stable\n';
        const expected = 'deb    [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ]    https://apt.syncthing.net/    syncthing    stable-v2\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });

      it('should handle legacy format with tabs', () => {
        const input = 'deb\t[ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ]\thttps://apt.syncthing.net/\tsyncthing\tstable\n';
        const expected = 'deb\t[ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ]\thttps://apt.syncthing.net/\tsyncthing\tstable-v2\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });

      it('should handle deb-src (source packages)', () => {
        const input = 'deb-src [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable\n';
        const expected = 'deb-src [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable-v2\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });

      it('should handle legacy format without options', () => {
        const input = 'deb https://apt.syncthing.net/ syncthing stable\n';
        const expected = 'deb https://apt.syncthing.net/ syncthing stable-v2\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });

      it('should not update if already on stable-v2', () => {
        const input = 'deb [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable-v2\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(null);
      });

      it('should handle legacy format with trailing spaces', () => {
        const input = 'deb https://apt.syncthing.net/ syncthing stable   \n';
        const expected = 'deb https://apt.syncthing.net/ syncthing stable-v2   \n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });
    });

    describe('deb822 format tests', () => {
      it('should update normal deb822 format', () => {
        const input = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;
        const expected = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable-v2
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });

      it('should handle deb822 format with extra spaces after colon', () => {
        const input = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components:   stable
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;
        const expected = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components:   stable-v2
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });

      it('should not update deb822 format already on stable-v2', () => {
        const input = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable-v2
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(null);
      });

      it('should handle deb822 format with multiple components (only update stable)', () => {
        const input = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable contrib
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;
        const expected = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable-v2 contrib
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });

      it('should handle deb822 format with trailing whitespace', () => {
        const input = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;
        const expected = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable-v2
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(expected);
      });
    });

    describe('edge case tests', () => {
      it('should return null for empty string', () => {
        const result = systemService.updateSyncthingSourceComponent('');

        expect(result).to.equal(null);
      });

      it('should return null for null input', () => {
        const result = systemService.updateSyncthingSourceComponent(null);

        expect(result).to.equal(null);
      });

      it('should return null for non-string input', () => {
        const result = systemService.updateSyncthingSourceComponent({ foo: 'bar' });

        expect(result).to.equal(null);
      });

      it('should not match "stable" in comments', () => {
        const input = `# This is for stable repository
deb https://apt.syncthing.net/ syncthing testing
`;

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(null);
      });

      it('should not match "stable" in URL field', () => {
        const input = 'deb https://stable.example.com/ syncthing testing\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(null);
      });

      it('should return null if no stable component found', () => {
        const input = 'deb https://apt.syncthing.net/ syncthing testing\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(null);
      });

      it('should not partially match "stable" in "unstable"', () => {
        const input = 'deb https://apt.syncthing.net/ syncthing unstable\n';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(null);
      });

      it('should handle malformed content gracefully', () => {
        const input = 'this is not a valid apt source line stable';

        const result = systemService.updateSyncthingSourceComponent(input);

        expect(result).to.equal(null);
      });
    });

    describe('updateSyncthingRepository tests', () => {
      let runCmdStub;
      let writeStub;
      let rmStub;
      let logSpy;
      let cacheUpdateTimeStub;

      beforeEach(() => {
        runCmdStub = sinon.stub(serviceHelper, 'runCommand');
        writeStub = sinon.stub(fs, 'writeFile');
        rmStub = sinon.stub(fs, 'rm');
        logSpy = sinon.spy(log, 'info');
        // Stub cacheUpdateTime to avoid file system operations in updateAptCache
        cacheUpdateTimeStub = sinon.stub(systemService, 'cacheUpdateTime').resolves(0);
      });

      afterEach(() => {
        sinon.restore();
        systemService.getQueue().clear();
      });

      it('should successfully update syncthing source from stable to stable-v2', async () => {
        // Mock reading the source file as root
        const sourceContent = 'deb [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable\n';
        runCmdStub.withArgs('cat', sinon.match.any).resolves({ stdout: sourceContent });

        // Mock moving the temp file as root
        runCmdStub.withArgs('mv', sinon.match.any).resolves({ error: null });

        // Mock apt-get update (called by updateAptCache)
        runCmdStub.withArgs('apt-get', sinon.match.any).resolves({ error: null });

        // Mock temp file operations
        writeStub.resolves();
        rmStub.resolves();

        const result = await systemService.updateSyncthingRepository();

        // Should return true on success
        expect(result).to.equal(true);

        // Should have read the file as root
        sinon.assert.calledWith(runCmdStub, 'cat', sinon.match({
          runAsRoot: true,
          params: ['/etc/apt/sources.list.d/syncthing.list'],
        }));

        // Should have written temp file
        const expectedNewContent = 'deb [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable-v2\n';
        sinon.assert.calledWith(writeStub, './syncthing.list.tmp', expectedNewContent, 'utf8');

        // Should have moved temp file as root
        sinon.assert.calledWith(runCmdStub, 'mv', sinon.match({
          runAsRoot: true,
          params: ['./syncthing.list.tmp', '/etc/apt/sources.list.d/syncthing.list'],
        }));

        // Should have cleaned up temp file
        sinon.assert.calledWith(rmStub, './syncthing.list.tmp', { force: true });

        // Should have logged success
        sinon.assert.calledWith(logSpy, 'Switching syncthing apt source from stable to stable-v2...');
        sinon.assert.calledWith(logSpy, 'Apt source updated to stable-v2');
      });

      it('should handle already migrated source (stable-v2)', async () => {
        const sourceContent = 'deb [ signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg ] https://apt.syncthing.net/ syncthing stable-v2\n';
        runCmdStub.withArgs('cat', sinon.match.any).resolves({ stdout: sourceContent });

        const result = await systemService.updateSyncthingRepository();

        // Should return true - sources are ready for v2
        expect(result).to.equal(true);

        // Should have read the file
        sinon.assert.calledWith(runCmdStub, 'cat', sinon.match.any);

        // Should NOT have written anything
        sinon.assert.notCalled(writeStub);
        sinon.assert.notCalled(rmStub);

        // Should have logged already on v2
        sinon.assert.calledWith(logSpy, 'Syncthing sources already on v2, nothing to do');
      });

      it('should handle file read failure gracefully', async () => {
        runCmdStub.withArgs('cat', sinon.match.any).resolves({ stdout: '' });

        const warnSpy = sinon.spy(log, 'warn');

        const result = await systemService.updateSyncthingRepository();

        // Should return false on failure
        expect(result).to.equal(false);

        // Should have warned about read failure
        sinon.assert.calledWith(warnSpy, 'Unable to read syncthing sources, unable to update syncthing');

        // Should NOT have written anything
        sinon.assert.notCalled(writeStub);
        sinon.assert.notCalled(rmStub);
      });

      it('should handle temp file write failure gracefully', async () => {
        const sourceContent = 'deb https://apt.syncthing.net/ syncthing stable\n';
        runCmdStub.withArgs('cat', sinon.match.any).resolves({ stdout: sourceContent });

        // Mock write failure
        writeStub.rejects(new Error('Write failed'));

        const warnSpy = sinon.spy(log, 'warn');

        const result = await systemService.updateSyncthingRepository();

        // Should return false on failure
        expect(result).to.equal(false);

        // Should have warned about write failure
        sinon.assert.calledWith(warnSpy, 'Unable to write to current directory, unable to update syncthing');

        // Should NOT have tried to move the file
        sinon.assert.neverCalledWith(runCmdStub, 'mv', sinon.match.any);
      });

      it('should handle move failure and log error', async () => {
        const sourceContent = 'deb https://apt.syncthing.net/ syncthing stable\n';
        runCmdStub.withArgs('cat', sinon.match.any).resolves({ stdout: sourceContent });
        runCmdStub.withArgs('mv', sinon.match.any).resolves({ error: 'Permission denied' });

        writeStub.resolves();
        rmStub.resolves();

        const errorSpy = sinon.spy(log, 'error');

        const result = await systemService.updateSyncthingRepository();

        // Should return false on failure
        expect(result).to.equal(false);

        // Should have logged the error
        sinon.assert.calledWith(errorSpy, 'Failed to write syncthing apt source');

        // Should still clean up temp file
        sinon.assert.calledWith(rmStub, './syncthing.list.tmp', { force: true });
      });

      it('should handle deb822 format', async () => {
        const sourceContent = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;
        runCmdStub.withArgs('cat', sinon.match.any).resolves({ stdout: sourceContent });
        runCmdStub.withArgs('mv', sinon.match.any).resolves({ error: null });
        runCmdStub.withArgs('apt-get', sinon.match.any).resolves({ error: null });

        writeStub.resolves();
        rmStub.resolves();

        const result = await systemService.updateSyncthingRepository();

        // Should return true on success
        expect(result).to.equal(true);

        const expectedNewContent = `Types: deb
URIs: https://apt.syncthing.net/
Suites: syncthing
Components: stable-v2
Signed-By: /usr/share/keyrings/syncthing-archive-keyring.gpg
`;

        // Should have written the correct deb822 format
        sinon.assert.calledWith(writeStub, './syncthing.list.tmp', expectedNewContent, 'utf8');

        // Should have logged success
        sinon.assert.calledWith(logSpy, 'Apt source updated to stable-v2');
      });
    });
  });
});
