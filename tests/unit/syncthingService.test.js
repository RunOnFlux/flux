// NodeJS Stubbed
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

// 3rd Party Stubbed
const axios = require('axios');
const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');

// Testing imports
const chai = require('chai');

const { expect } = chai;
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const syncthingFixtures = require('./data/syncthingFixtures');

// Fakes
const runExecStub = sinon.stub();
const utilFake = { promisify: () => runExecStub };

// Module under test
const syncthingService = proxyquire('../../ZelBack/src/services/syncthingService', { 'node:util': utilFake });

describe('syncthingService tests', () => {
  describe('getConfigFile tests', () => {
    let runCmdStub;
    beforeEach(async () => {
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should set the .config dir permissions to the current user', async () => {
      runCmdStub.resolves({ stdout: '', error: null });
      sinon.stub(fs, 'readFile').resolves();
      sinon.stub(os, 'homedir').returns('/home/usertest');
      sinon.stub(os, 'userInfo').returns({ username: 'testuser' });

      const expectedParams = ['testuser:testuser', '/home/usertest/.config'];

      await syncthingService.getConfigFile();

      sinon.assert.calledWithExactly(runCmdStub, 'chown', { runAsRoot: true, logError: false, params: expectedParams });
    });

    it('should set the syncthing dir permissions to the current user', async () => {
      runCmdStub.resolves({ stdout: '', error: null });
      sinon.stub(fs, 'readFile').resolves();
      sinon.stub(os, 'homedir').returns('/home/usertest');
      sinon.stub(os, 'userInfo').returns({ username: 'testuser' });

      const expectedParams = ['testuser:testuser', '/home/usertest/.config/syncthing'];

      await syncthingService.getConfigFile();
      sinon.assert.calledWithExactly(runCmdStub, 'chown', { runAsRoot: true, logError: false, params: expectedParams });
    });

    it('should set the syncthing config file permissions to 644', async () => {
      runCmdStub.resolves({ stdout: '', error: null });
      sinon.stub(fs, 'readFile').resolves();
      sinon.stub(os, 'homedir').returns('/home/usertest');
      sinon.stub(os, 'userInfo').returns({ username: 'testuser' });

      const expectedParams = ['644', '/home/usertest/.config/syncthing/config.xml'];

      await syncthingService.getConfigFile();
      sinon.assert.calledWithExactly(runCmdStub, 'chmod', { runAsRoot: true, logError: false, params: expectedParams });
    });

    it('should return the syncthing config file with utf-8 format', async () => {
      const expected = 'Test config file';
      runCmdStub.resolves({ stdout: '', error: null });

      sinon.stub(fs, 'readFile').resolves(expected);
      sinon.stub(os, 'homedir').returns('/home/usertest');
      sinon.stub(os, 'userInfo').returns({ username: 'testuser' });

      const res = await syncthingService.getConfigFile();
      expect(res).to.be.equal(expected);
    });

    it('should return null if there is an error getting config file', async () => {
      runCmdStub.resolves({ stdout: '', error: null });
      sinon.stub(fs, 'readFile').rejects('Test ENOENT');
      sinon.stub(os, 'homedir').returns('/home/usertest');
      sinon.stub(os, 'userInfo').returns({ username: 'testuser' });

      const res = await syncthingService.getConfigFile();
      expect(res).to.be.equal(null);
    });
  });

  describe('getDeviceId tests', () => {
    let fakePerformRequest;
    let fakeMeta;
    let fakeGet;

    const deviceId = 'AEYDK6D-2U3U5AI-MEDDSIE-5WC7F0K-FDLAOJQ-24AFG44-Z2B749L-BOUX3QM';

    beforeEach(() => {
      // this is for all the chown/chmod stuff
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: null });

      // for getSynchingApiKey
      sinon.stub(fs, 'readFile').resolves().resolves(syncthingFixtures.configFile);

      fakeMeta = sinon.stub().resolves({
        status: 'success', data: `var metadata = {"authenticated":true,"deviceID":"${deviceId}","deviceIDShort":"AEYDK6D"};\n`,
      });

      fakeGet = sinon.fake(async (reqPath) => {
        if (reqPath === '/meta.js') {
          return fakeMeta();
        } if (reqPath === '/rest/noauth/health') {
          return { status: 'success', data: { status: 'OK' } };
        }
        if (reqPath === '/rest/system/ping') {
          return { status: 'success', data: { ping: 'pong' } };
        }
        return {};
      });
      fakePerformRequest = { get: fakeGet };
      sinon.stub(axios, 'create').returns(fakePerformRequest);
    });

    afterEach(async () => {
      syncthingService.getAxiosCache().reset();
      await syncthingService.syncthingController().abort();
      sinon.restore();
    });

    it('should only run getDeviceId one at a time', async () => {
      const clock = sinon.useFakeTimers();

      const blah = {
        status: 'success', data: `var metadata = {"authenticated":true,"deviceID":"${deviceId}","deviceIDShort":"AEYDK6D"};\n`,
      };

      // a dummy command that takes 2 seconds
      const timeout = async () => new Promise((r) => { setTimeout(() => r(blah), 2000); });

      fakeMeta.callsFake(timeout);
      const promise1 = syncthingService.getDeviceId();
      const promise2 = syncthingService.getDeviceId();

      await clock.tickAsync(1999);

      expect(fakeMeta.callCount).to.be.equal(1);
      await clock.tickAsync(1);
      expect(fakeMeta.callCount).to.be.equal(2);
      await clock.nextAsync();
      await Promise.all([promise1, promise2]);
    });

    it('should return syncthing deviceId', async () => {
      const res = await syncthingService.getDeviceId();

      expect(res).to.be.equal(deviceId);
    });

    it('should return null if commands were not successful', async () => {
      const error = new Error('Axios not working today');
      fakeMeta.throws(error);

      const res = await syncthingService.getDeviceId();
      expect(res).to.be.equal(null);
    });
  });

  describe('installSyncthingIdempotently tests', () => {
    let runCmdStub;
    let infoSpy;
    let errorSpy;

    beforeEach(() => {
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
      infoSpy = sinon.spy(log, 'info');
      errorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return without installing if syncthing already installed', async () => {
      const version = 'syncthing v1.27.3 "Gold Grasshopper" (go1.21.6 linux-amd64) debian@github.syncthing.net 2024-01-15 03:45:19 UTC [noupgrade]';
      runCmdStub.resolves({ stdout: version });

      await syncthingService.installSyncthingIdempotently();

      sinon.assert.calledWithExactly(runCmdStub, 'syncthing', { logError: false, params: ['--version'] });
      sinon.assert.calledWithExactly(infoSpy, 'Checking if Syncthing is installed...');
      sinon.assert.calledWithExactly(infoSpy, 'Syncthing already installed. Version: v1.27.3 ');
      sinon.assert.notCalled(errorSpy);
    });

    it('should run install syncthing script if syncthing not installed and log outcome', async () => {
      const scriptPath = '/home/testuser/helpers/installSyncthing.sh';
      sinon.stub(path, 'join').returns(scriptPath);

      // this wouldn't usually happen but easier to stub the same for both calls
      runCmdStub.resolves({ stdout: '', error: null });

      await syncthingService.installSyncthingIdempotently();

      sinon.assert.calledWithExactly(runCmdStub, scriptPath);
      sinon.assert.calledWithExactly(infoSpy, 'Installing Syncthing...');
      sinon.assert.calledWithExactly(infoSpy, 'Syncthing installed');

      sinon.assert.notCalled(errorSpy);
    });
  });

  describe('configureDirectories tests', () => {
    let runCmdStub;

    beforeEach(() => {
      runCmdStub = sinon.stub(serviceHelper, 'runCommand').resolves();
      sinon.stub(os, 'homedir').returns('/home/testuser');
      sinon.stub(os, 'userInfo').returns({ username: 'testuser' });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call mkdir -p for the syncthing dir', async () => {
      await syncthingService.configureDirectories();

      sinon.assert.calledWithExactly(runCmdStub, 'mkdir', { params: ['-p', '/home/testuser/.config/syncthing'] });
    });

    it('should chown the main .config dir to the running user', async () => {
      await syncthingService.configureDirectories();

      sinon.assert.calledWithExactly(runCmdStub, 'chown', { runAsRoot: true, params: ['testuser:testuser', '/home/testuser/.config'] });
    });

    it('should chown the syncthing dir to the running user', async () => {
      await syncthingService.configureDirectories();

      sinon.assert.calledWithExactly(runCmdStub, 'chown', { runAsRoot: true, params: ['testuser:testuser', '/home/testuser/.config/syncthing'] });
    });
  });

  describe('stopSyncthing tests', () => {
    let runCmdStub;
    let infoSpy;
    let errorSpy;

    beforeEach(() => {
      runCmdStub = sinon.stub(serviceHelper, 'runCommand');
      infoSpy = sinon.spy(log, 'info');
      errorSpy = sinon.spy(log, 'error');
    });

    afterEach(async () => {
      await syncthingService.syncthingController().abort();
      syncthingService.getAxiosCache().reset();
      sinon.restore();
    });

    it('should return immediately if controller aborted already', async () => {
      const stc = syncthingService.syncthingController();

      // we lock the controller first, so that when we call abort, it doesn't immediately resolve
      // and create a new abortController, in this test it isn't strictly necessary but in real world,
      // it would be
      await stc.lock.enable();

      const promise = stc.abort();

      await syncthingService.stopSyncthing();

      expect(stc.aborted).to.be.true;
      sinon.assert.notCalled(runCmdStub);

      stc.lock.disable();
      await promise;
    });

    it('should stop syncthing gracefully if running', async () => {
      // there is a one second wait inbetween gracefully killing services,
      // and checking if it's still running
      const clock = sinon.useFakeTimers();

      let pgrepCalls = 0;
      runCmdStub.callsFake(async (cmd) => {
        if (cmd === 'pgrep' && !pgrepCalls) {
          pgrepCalls += 1;
          return { stdout: 'syncthing is running' };
        }
        if (cmd === 'pgrep') return { stdout: '' };
        return {};
      });

      const promise = syncthingService.stopSyncthing();
      await clock.tickAsync(1000);
      await promise;

      sinon.assert.calledWithExactly(infoSpy, 'Stopping syncthing service gracefully');
      sinon.assert.notCalled(errorSpy);
      sinon.assert.calledWithExactly(runCmdStub, 'killall', { runAsRoot: true, logError: false, params: ['syncthing'] });
      sinon.assert.calledWithExactly(runCmdStub, 'pkill', { runAsRoot: true, logError: false, params: ['syncthing'] });
      sinon.assert.neverCalledWith(runCmdStub, 'kill', { runAsRoot: true, params: ['-9', 'syncthing'] });
    });

    it('should forcefully stop syncthing if still running after asking nicely', async () => {
      // there is a one second wait inbetween gracefully killing services,
      // and checking if it's still running
      const clock = sinon.useFakeTimers();

      runCmdStub.callsFake(async (cmd) => {
        if (cmd === 'pgrep') return { stdout: 'syncthing is running' };
        return {};
      });

      const promise = syncthingService.stopSyncthing();
      await clock.tickAsync(1000);
      await promise;

      sinon.assert.calledWithExactly(infoSpy, 'Sending SIGKILL to syncthing service');
      sinon.assert.notCalled(errorSpy);
      sinon.assert.calledWithExactly(runCmdStub, 'killall', { runAsRoot: true, logError: false, params: ['syncthing'] });
      sinon.assert.calledWithExactly(runCmdStub, 'pkill', { runAsRoot: true, logError: false, params: ['syncthing'] });
      sinon.assert.calledWithExactly(runCmdStub, 'kill', { runAsRoot: true, params: ['-9', 'syncthing'] });
    });
  });
  describe('runSyncthingSentinel tests', () => {
    const deviceId = 'AEYDK6D-2U3U5AI-MEDDSIE-5WC7F0K-FDLAOJQ-24AFG44-Z2B749L-BOUX3QM';

    let fakeMeta;
    let fakeGet;
    let runCmdStub;
    let fakeConfigOptions;
    let fakeConfigDefaults;
    let fakeConfigFolders;
    let fakeGuiConfig;
    let fakePerformRequest;
    let fakeRestartRequired;
    let spawnStub;
    let infoSpy;
    let unrefStub;

    beforeEach(() => {
      infoSpy = sinon.spy(log, 'info');
      unrefStub = sinon.stub();
      runCmdStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null });
      spawnStub = sinon.stub(childProcess, 'spawn').returns({ unref: unrefStub });
      sinon.stub(os, 'homedir').returns('/home/testuser');
      sinon.stub(process, 'cwd').returns('/home/testuser/flux');
      // for getSynchingApiKey
      sinon.stub(fs, 'readFile').resolves().resolves(syncthingFixtures.configFile);

      fakeMeta = sinon.stub().resolves({
        status: 'success', data: `var metadata = {"authenticated":true,"deviceID":"${deviceId}","deviceIDShort":"AEYDK6D"};\n`,
      });

      // we use these so we can skip doing work in the adjustSyncthing function
      fakeConfigOptions = sinon.stub().rejects(Error('Test fakeConfigOptions Error'));
      fakeConfigDefaults = sinon.stub().rejects(Error('Test fakeConfigDefaults Error'));
      fakeConfigFolders = sinon.stub().rejects(Error('Test fakeConfigFolders Error'));
      fakeGuiConfig = sinon.stub().rejects(Error('Test fakeGuiConfig Error'));
      fakeRestartRequired = sinon.stub().rejects(Error('Test fakeRestartRequired Error'));

      fakeGet = sinon.fake(async (reqPath) => {
        if (reqPath === '/meta.js') {
          return fakeMeta();
        } if (reqPath === '/rest/noauth/health') {
          return { status: 'success', data: { status: 'OK' } };
        } if (reqPath === '/rest/system/ping') {
          return { status: 'success', data: { ping: 'pong' } };
        } if (reqPath === '/rest/config/options') {
          // use this as a counter
          return fakeConfigOptions();
        } if (reqPath === '/rest/config/defaults/folder') {
          // use this as a counter
          return fakeConfigDefaults();
        } if (reqPath === '/rest/config/folders') {
          // use this as a counter
          return fakeConfigFolders();
        } if (reqPath === '/rest/config/gui') {
          // use this as a counter
          return fakeGuiConfig();
        } if (reqPath === '/rest/config/restart-required') {
          // use this as a counter
          return fakeRestartRequired();
        }
        return { data: 'Intentional failure' };
      });
      fakePerformRequest = { get: fakeGet };
      sinon.stub(axios, 'create').returns(fakePerformRequest);
    });

    afterEach(async () => {
      await syncthingService.syncthingController().abort();
      syncthingService.getAxiosCache().reset();
      sinon.restore();
    });

    it('should call adjustSyncthing on the first iteration', async () => {
      const ms = await syncthingService.runSyncthingSentinel();
      expect(ms).to.equal(60000);
      sinon.assert.callCount(fakeConfigOptions, 1);
    });

    it('should call adjustSyncthing every eight runs under normal conditions', async () => {
      const DEFAULT_WAIT = 60000;

      const clock = sinon.useFakeTimers();

      const stc = syncthingService.syncthingController();

      stc.startLoop(syncthingService.runSyncthingSentinel);

      // allow first iteration to run (counter starts at 0, is at 1 after it's run)
      await clock.tickAsync(10);

      // we are using fakeConfigOptions as a proxy for adjustSynthing function.
      sinon.assert.callCount(fakeConfigOptions, 1);
      expect(stc.loopCount).to.equal(1);

      // allow some more iterations to run
      await clock.tickAsync(4 * DEFAULT_WAIT);

      // assert adjustSynthing hasn't been called again
      sinon.assert.callCount(fakeConfigOptions, 1);
      expect(stc.loopCount).to.equal(5);

      // go to 8th iteration
      await clock.tickAsync(4 * DEFAULT_WAIT);
      sinon.assert.callCount(fakeConfigOptions, 2);

      // runSyncthingSentinel resets the loopCount to 0
      expect(stc.loopCount).to.equal(1);

      await stc.abort();
    });

    it('should stop syncthing if there is a problem with the service', async () => {
      const clock = sinon.useFakeTimers();

      // simulate syncthing error
      fakeMeta.rejects(Error('Fake Meta Error'));

      // fake syncthing running then not running
      let pgrepCalls = 0;
      runCmdStub.callsFake(async (cmd) => {
        if (cmd === 'pgrep' && !pgrepCalls) {
          pgrepCalls += 1;
          return { stdout: 'syncthing is running' };
        }
        if (cmd === 'pgrep') return { stdout: '' };
        return { error: null };
      });

      const promise = syncthingService.runSyncthingSentinel();
      await clock.tickAsync(6000);
      await promise;

      sinon.assert.calledWithExactly(runCmdStub, 'killall', { runAsRoot: true, logError: false, params: ['syncthing'] });
    });

    it('should install syncthing if there is a problem with the service', async () => {
      const clock = sinon.useFakeTimers();

      // simulate syncthing error
      fakeMeta.rejects(Error('Fake Meta Error'));

      // fake syncthing not running
      runCmdStub.callsFake(async (cmd) => {
        if (cmd === 'pgrep') {
          return { stdout: '' };
        } if (cmd === 'syncthing') {
          return { stdout: '' };
        }
        return { error: null };
      });

      const promise = syncthingService.runSyncthingSentinel();
      await clock.tickAsync(5000);
      await promise;

      sinon.assert.calledWithExactly(infoSpy, 'Installing Syncthing...');
      sinon.assert.calledWithExactly(runCmdStub, '/home/testuser/flux/helpers/installSyncthing.sh');
      sinon.assert.calledWithExactly(infoSpy, 'Syncthing installed');
    });

    it('should configure syncthing permissions if there is a problem with the service', async () => {
      const clock = sinon.useFakeTimers();

      // simulate syncthing error
      fakeMeta.rejects(Error('Fake Meta Error'));

      // fake syncthing not running
      runCmdStub.callsFake(async (cmd) => {
        if (cmd === 'pgrep') {
          return { stdout: '' };
        } if (cmd === 'syncthing') {
          return { stdout: 'syncthing installed' };
        }
        return { error: null };
      });

      const promise = syncthingService.runSyncthingSentinel();
      await clock.tickAsync(5000);
      await promise;

      // already tested this, this is just to make sure that configureDirectories is called
      sinon.assert.calledWithExactly(runCmdStub, 'mkdir', { params: ['-p', '/home/testuser/.config/syncthing'] });
    });

    it('should spawn a new syncthing process if there is a problem with the service', async () => {
      const clock = sinon.useFakeTimers();

      const expected = 'sudo nohup syncthing --logfile /home/testuser/.config/syncthing/syncthing.log --logflags=3 --log-max-old-files=2 --log-max-size=26214400 --allow-newer-config --no-browser --home /home/testuser/.config/syncthing >/dev/null 2>&1 </dev/null &';
      // const expectedParams = [
      //   'syncthing',
      //   '--logfile',
      //   '/home/testuser/.config/syncthing/syncthing.log',
      //   '--logflags=3',
      //   '--log-max-old-files=2',
      //   '--log-max-size=26214400',
      //   '--allow-newer-config',
      //   '--no-browser',
      //   '--home',
      //   '/home/testuser/.config/syncthing',
      // ];

      // const expectedOptions = { detached: true, stdio: 'ignore' };
      const expectedOptions = { shell: true };

      // simulate syncthing error
      fakeMeta.rejects(Error('Fake Meta Error'));

      // fake syncthing not running
      runCmdStub.callsFake(async (cmd) => {
        if (cmd === 'pgrep') {
          return { stdout: '' };
        } if (cmd === 'syncthing') {
          return { stdout: 'syncthing installed' };
        }
        return { error: null };
      });

      const promise = syncthingService.runSyncthingSentinel();
      await clock.tickAsync(5000);
      await promise;

      sinon.assert.calledWithExactly(spawnStub, expected, expectedOptions);
      // sinon.assert.calledOnce(unrefStub);
    });
  });
});
