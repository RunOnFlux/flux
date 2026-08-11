// NodeJS Stubbed
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const EventEmitter = require('node:events');

// 3rd Party Stubbed
const axios = require('axios');
const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');

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
  describe('postDbIgnores privilege tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    // .stignore decides what LEAVES the node for an app the node operator does
    // not own, so this route asks for fluxteam where its siblings take
    // adminandfluxteam. Pinned because the difference is a single string.
    const answerFor = (req) => new Promise((resolve) => {
      syncthingService.postDbIgnores(req, { json: resolve });
      req.emit('data', JSON.stringify({ folder: 'fluxcomp_app', config: { ignore: ['!/backup'] } }));
      req.emit('end');
    });

    it('should ask for fluxteam, not the node operator', async () => {
      const verify = sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      const req = new EventEmitter();

      const answer = await answerFor(req);

      sinon.assert.calledOnceWithExactly(verify, 'fluxteam', req);
      expect(answer.data.code).to.equal(401);
      expect(answer.data.name).to.equal('Unauthorized');
    });

    it('should refuse a session the privilege check rejects, without reaching syncthing', async () => {
      sinon.stub(verificationHelper, 'verifyPrivilege').resolves(false);
      const requested = sinon.stub(axios, 'create');

      const answer = await answerFor(new EventEmitter());

      sinon.assert.notCalled(requested);
      expect(answer.status).to.equal('error');
    });
  });

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

  describe('getEvents tests', () => {
    let fakeGet;

    beforeEach(() => {
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: null });
      sinon.stub(fs, 'readFile').resolves(syncthingFixtures.configFile);
      fakeGet = sinon.stub().resolves({ data: [] });
      sinon.stub(axios, 'create').returns({ get: fakeGet });
    });

    afterEach(() => {
      syncthingService.getAxiosCache().reset();
      sinon.restore();
    });

    it('long-poll request: the client-side timeout must exceed the requested server-side hold', async () => {
      // the events endpoint holds the request open up to `timeout` seconds when
      // nothing is pending; the shared instance's 5s default aborts every quiet
      // poll before syncthing can answer
      await syncthingService.getEvents({ params: {}, query: { since: 5, events: 'FolderSummary', timeout: 55 } });

      sinon.assert.calledOnce(fakeGet);
      const config = fakeGet.firstCall.args[1];
      expect(config, 'axios per-request config').to.be.an('object');
      expect(config.timeout, 'client timeout (ms)').to.be.greaterThan(55 * 1000);
    });

    it('plain request (no hold asked): keeps the instance default timeout', async () => {
      await syncthingService.getEvents({ params: {}, query: { since: 5 } });

      sinon.assert.calledOnce(fakeGet);
      const config = fakeGet.firstCall.args[1];
      expect(config?.timeout).to.equal(undefined);
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

  describe('systemPause / systemResume endpoint paths', () => {
    // Contract: pause posts to /rest/system/pause, resume posts to /rest/system/resume.
    // Resume is load-bearing for stuck-folder recovery (device pause/resume nudge): a
    // resume that actually pauses would wedge the device permanently.
    let fakePost;
    const deviceId = 'AEYDK6D-2U3U5AI-MEDDSIE-5WC7F0K-FDLAOJQ-24AFG44-Z2B749L-BOUX3QM';

    beforeEach(() => {
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: null });
      sinon.stub(fs, 'readFile').resolves(syncthingFixtures.configFile);
      fakePost = sinon.fake.resolves({ data: '' });
      sinon.stub(axios, 'create').returns({ post: fakePost });
    });

    afterEach(async () => {
      await syncthingService.syncthingController().abort();
      syncthingService.getAxiosCache().reset();
      sinon.restore();
    });

    it('systemPause posts to /rest/system/pause with the device', async () => {
      await syncthingService.systemPause({ params: { device: deviceId }, query: {} }, null);
      sinon.assert.calledOnce(fakePost);
      expect(fakePost.firstCall.args[0]).to.equal(`/rest/system/pause?device=${deviceId}`);
    });

    it('systemResume posts to /rest/system/resume with the device', async () => {
      await syncthingService.systemResume({ params: { device: deviceId }, query: {} }, null);
      sinon.assert.calledOnce(fakePost);
      expect(fakePost.firstCall.args[0]).to.equal(`/rest/system/resume?device=${deviceId}`);
    });

    it('systemResume posts to /rest/system/resume for all devices when none given', async () => {
      await syncthingService.systemResume({ params: {}, query: {} }, null);
      sinon.assert.calledOnce(fakePost);
      expect(fakePost.firstCall.args[0]).to.equal('/rest/system/resume');
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

    it('never asks syncthing whether a restart is required', async () => {
      // requiresRestart is a one-way latch FluxOS cannot set: it is written only
      // for auditEnabled/auditFile, which FluxOS never touches. So a true here is
      // always something else's, set hours earlier and never cleared - and this
      // runs every eight minutes, so acting on it restarts the daemon on every
      // pass until syncthing's own supervisor gives up and leaves it down.
      await syncthingService.runSyncthingSentinel();

      sinon.assert.notCalled(fakeRestartRequired);
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

  describe('collectSyncthingMetrics error surfacing', () => {
    // Syncthing's /rest/system/error buffer is cumulative for the daemon's
    // lifetime, and the daemon outlives FluxOS restarts. The collector must
    // treat each entry as an occurrence: log its content, clear the buffer,
    // and report unhealthy only for the pass the errors arrived in - never
    // re-count history every cycle as a bare number.
    let fakeInstance;
    let logErrorStub;
    let logWarnStub;
    let routes;

    const route = (urlpath, data) => { routes[urlpath] = data; };

    beforeEach(() => {
      routes = {};
      fakeInstance = {
        get: sinon.stub().callsFake((urlpath) => (urlpath in routes
          ? Promise.resolve({ data: routes[urlpath] })
          : Promise.reject(new Error(`no route for ${urlpath}`)))),
        post: sinon.stub().resolves({ data: 'ok' }),
      };
      const cache = syncthingService.getAxiosCache();
      cache.axiosInstance = fakeInstance;
      cache.syncthingApiKey = 'testkey';
      cache.lastUpdate = Date.now();
      logErrorStub = sinon.stub(log, 'error');
      logWarnStub = sinon.stub(log, 'warn');
      sinon.stub(log, 'info');
      route('/rest/noauth/health', { status: 'OK' });
      route('/rest/system/status', { uptime: 1 });
      route('/rest/system/connections', { connections: {} });
      route('/rest/stats/folder', {});
      route('/rest/stats/device', {});
      route('/rest/config/folders', []);
      route('/rest/system/error', { errors: [] });
    });

    afterEach(() => {
      syncthingService.getAxiosCache().reset();
      sinon.restore();
    });

    it('drains the system error buffer: each message to the error log, buffer cleared, unhealthy for the pass', async () => {
      route('/rest/system/error', {
        errors: [
          { when: '2026-07-30T14:52:50Z', message: 'Failed to auto-accept folder due to path conflict (folder.id=fluxwp_x)' },
          { when: '2026-07-30T15:40:03Z', message: 'database is corrupted' },
        ],
      });

      const metrics = await syncthingService.collectSyncthingMetrics();

      expect(metrics.overall.healthy).to.equal(false);
      expect(logErrorStub.args.some((a) => String(a[0]).includes('path conflict'))).to.equal(true);
      expect(logErrorStub.args.some((a) => String(a[0]).includes('database is corrupted'))).to.equal(true);
      expect(fakeInstance.post.calledWith('/rest/system/error/clear')).to.equal(true);
      // the health summary names what happened rather than carrying a bare count
      expect(metrics.overall.issues.some((issue) => issue.includes('system error'))).to.equal(true);
    });

    it('an empty buffer stays healthy, logs nothing, and is not cleared', async () => {
      const metrics = await syncthingService.collectSyncthingMetrics();

      expect(metrics.overall.healthy).to.equal(true);
      expect(logErrorStub.called).to.equal(false);
      expect(fakeInstance.post.called).to.equal(false);
    });

    it('a failed clear is labeled as such and the pass still completes', async () => {
      route('/rest/system/error', { errors: [{ when: '2026-08-02T10:00:00Z', message: 'boom' }] });
      fakeInstance.post.rejects(new Error('connection refused'));

      const metrics = await syncthingService.collectSyncthingMetrics();

      expect(metrics.overall.healthy).to.equal(false);
      expect(logWarnStub.args.some((a) => String(a[0]).includes('clear'))).to.equal(true);
    });

    it('folder errors log their file-level causes, capped with a remainder line', async () => {
      route('/rest/config/folders', [{ id: 'fluxwp_app', label: 'fluxwp_app' }]);
      route('/rest/db/status?folder=fluxwp_app', {
        state: 'idle', globalBytes: 10, inSyncBytes: 10, pullErrors: 7, errors: 0,
      });
      route('/rest/folder/errors?folder=fluxwp_app', {
        errors: Array.from({ length: 7 }, (unused, i) => ({ path: `file-${i}`, error: `cause-${i}` })),
      });

      const metrics = await syncthingService.collectSyncthingMetrics();

      expect(metrics.errors.folder.fluxwp_app.pullErrors).to.equal(7);
      expect(logErrorStub.args.some((a) => String(a[0]).includes('file-0') && String(a[0]).includes('cause-0'))).to.equal(true);
      expect(logErrorStub.args.some((a) => String(a[0]).includes('file-4'))).to.equal(true);
      expect(logErrorStub.args.some((a) => String(a[0]).includes('file-5'))).to.equal(false);
      expect(logErrorStub.args.some((a) => String(a[0]).includes('2 further'))).to.equal(true);
    });
  });
});
