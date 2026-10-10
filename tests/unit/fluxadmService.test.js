const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const { expect } = chai;

const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const systemService = require('../../ZelBack/src/services/systemService');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');
const ufw = require('../../ZelBack/src/services/utils/ufw');
const ufwHelper = require('../../ZelBack/src/services/utils/ufwHelper');

const testKeys = ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYONLYFORTESTS fluxteam-legacy'];

// the real config singleton is deep-frozen once loaded, so the service gets a
// plain mutable config injected - tests set the key list they need on it
const testConfig = {
  fluxadm: { sshAuthorizedKeys: [] },
  server: { apiport: 16127 },
};
const fluxadmPort = proxyquire('../../ZelBack/src/services/fluxadmPort', {
  config: testConfig,
});
const fluxadmService = proxyquire('../../ZelBack/src/services/fluxadmService', {
  './fluxadmPort': fluxadmPort,
});

const cmdOk = { error: null, stdout: '', stderr: '' };
const cmdFail = { error: new Error('command failed'), stdout: '', stderr: '' };
// One ufw command as ufw.runUfw runs it, through the lock-first helper.
const ufwCall = (args) => sinon.match({ params: [ufw.UFW_HELPER, '--wait', '30', '--command', JSON.stringify(args)] });
// Any ufw command run through ufw.runUfw.
const anyUfwCall = sinon.match({ params: sinon.match((params) => params.includes('--command')) });

describe('fluxadmService tests', () => {
  let runCommandStub;
  let systemdStub;

  beforeEach(() => {
    runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ ...cmdOk });
    // The installed copy of the ufw helper is the one to run (utils/ufwHelper has its own tests).
    sinon.stub(ufwHelper, 'path').resolves(ufwHelper.UFW_HELPER);
    systemdStub = sinon.stub(fsSync, 'existsSync').callThrough();
    systemdStub.withArgs('/run/systemd/system').returns(true);
    // No package operation holds dpkg's lock, whatever the host running the tests.
    sinon.stub(systemService, 'dpkgFrontendLocked').resolves(false);
  });

  afterEach(() => {
    testConfig.fluxadm.sshAuthorizedKeys = [];
    sinon.restore();
  });

  describe('confirmedLegacyNode tests', () => {
    it('should confirm a legacy node when systemsecure is false', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });

      const res = await fluxadmService.confirmedLegacyNode();

      expect(res).to.equal(true);
    });

    it('should reject when systemsecure is true', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: true } });

      const res = await fluxadmService.confirmedLegacyNode();

      expect(res).to.equal(false);
    });

    it('should be indeterminate when systemsecure is missing', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { status: 'ok' } });

      const res = await fluxadmService.confirmedLegacyNode();

      expect(res).to.equal(null);
    });

    it('should be indeterminate when the benchmark call errors', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'error', data: { message: 'down' } });

      const res = await fluxadmService.confirmedLegacyNode();

      expect(res).to.equal(null);
    });

    it('should be indeterminate when the benchmark call throws', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').rejects(new Error('unreachable'));

      const res = await fluxadmService.confirmedLegacyNode();

      expect(res).to.equal(null);
    });
  });

  describe('fluxadmPort getFluxadmSshPort tests', () => {
    let originalUserConfig;
    let originalApiPort;

    beforeEach(() => {
      originalUserConfig = globalThis.userconfig;
      originalApiPort = testConfig.server.apiport;
    });

    afterEach(() => {
      globalThis.userconfig = originalUserConfig;
      testConfig.server.apiport = originalApiPort;
    });

    it('should return null when no keys are configured', () => {
      const res = fluxadmPort.getFluxadmSshPort();

      expect(res).to.equal(null);
    });

    it('should return apiport - 5 when keys are configured', () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;

      const res = fluxadmPort.getFluxadmSshPort();

      expect(res).to.equal(16122);
    });

    it('should return null when systemd is not the init', () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      systemdStub.withArgs('/run/systemd/system').returns(false);

      const res = fluxadmPort.getFluxadmSshPort();

      expect(res).to.equal(null);
    });

    it('should follow a custom apiport from userconfig', () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      globalThis.userconfig = { initial: { ...originalUserConfig.initial, apiport: 16137 } };

      const res = fluxadmPort.getFluxadmSshPort();

      expect(res).to.equal(16132);
    });

    it('should fall back to the configured apiport when userconfig sets none', () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      testConfig.server.apiport = 16147;
      globalThis.userconfig = { initial: { ...originalUserConfig.initial, apiport: undefined } };

      const res = fluxadmPort.getFluxadmSshPort();

      expect(res).to.equal(16142);
    });
  });

  describe('ensureUser tests', () => {
    it('should not create the user if it exists and has our sudoers drop-in', async () => {
      runCommandStub.withArgs('id').resolves({ ...cmdOk, stdout: '998' });
      runCommandStub.withArgs('cat').resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });

      const res = await fluxadmService.ensureUser();

      expect(res).to.equal(true);
      sinon.assert.neverCalledWith(runCommandStub, 'useradd');
    });

    it('should refuse a pre-existing fluxadm user that has no sudoers drop-in', async () => {
      runCommandStub.withArgs('id').resolves({ ...cmdOk, stdout: '1001' });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureUser();

      expect(res).to.equal(false);
      sinon.assert.neverCalledWith(runCommandStub, 'useradd');
    });

    it('should create a system user with home and shell when missing', async () => {
      runCommandStub.withArgs('id').resolves({ ...cmdFail });
      runCommandStub.withArgs('cat').resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });

      const res = await fluxadmService.ensureUser();

      expect(res).to.equal(true);
      sinon.assert.calledWithExactly(runCommandStub, 'useradd', {
        runAsRoot: true,
        params: ['-r', '-m', '-s', '/bin/bash', 'fluxadm'],
      });
    });

    it('should install the sudoers marker before creating the user', async () => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
      runCommandStub.withArgs('id').resolves({ ...cmdFail });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureUser();

      expect(res).to.equal(true);
      expect(runCommandStub.withArgs('install').calledBefore(runCommandStub.withArgs('useradd'))).to.equal(true);
    });

    it('should not create the user when the sudoers marker cannot be installed', async () => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
      runCommandStub.withArgs('id').resolves({ ...cmdFail });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });
      runCommandStub.withArgs('visudo').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureUser();

      expect(res).to.equal(false);
      sinon.assert.neverCalledWith(runCommandStub, 'useradd');
    });

    it('should return false when useradd fails', async () => {
      runCommandStub.withArgs('id').resolves({ ...cmdFail });
      runCommandStub.withArgs('cat').resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });
      runCommandStub.withArgs('useradd').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureUser();

      expect(res).to.equal(false);
    });
  });

  describe('ensureSudoers tests', () => {
    beforeEach(() => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
    });

    it('should not rewrite the drop-in when content already matches', async () => {
      runCommandStub.withArgs('cat').resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });

      const res = await fluxadmService.ensureSudoers();

      expect(res).to.equal(true);
      sinon.assert.neverCalledWith(runCommandStub, 'install');
    });

    it('should validate with visudo and install when missing', async () => {
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureSudoers();

      expect(res).to.equal(true);
      sinon.assert.calledWithExactly(runCommandStub, 'visudo', {
        runAsRoot: true,
        params: ['-cf', '/tmp/fluxadm-test/fluxadm'],
      });
      sinon.assert.calledWithExactly(runCommandStub, 'install', {
        runAsRoot: true,
        params: ['-o', 'root', '-g', 'root', '-m', '0440', '/tmp/fluxadm-test/fluxadm', '/etc/sudoers.d/fluxadm'],
      });
    });

    it('should not install when visudo rejects the staged file', async () => {
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });
      runCommandStub.withArgs('visudo').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureSudoers();

      expect(res).to.equal(false);
      sinon.assert.neverCalledWith(runCommandStub, 'install');
    });
  });

  describe('ensureAuthorizedKeys tests', () => {
    beforeEach(() => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
    });

    it('should not rewrite authorized_keys when content already matches', async () => {
      sinon.stub(fs, 'readFile')
        .withArgs('/etc/ssh/fluxadm_authorized_keys', 'utf-8').resolves(`${testKeys[0]}\n`);

      const res = await fluxadmService.ensureAuthorizedKeys(testKeys);

      expect(res).to.equal(true);
      sinon.assert.neverCalledWith(runCommandStub, 'install');
    });

    it('should install a root-owned key file outside the user\'s home when different', async () => {
      sinon.stub(fs, 'readFile').rejects(new Error('missing'));

      const res = await fluxadmService.ensureAuthorizedKeys(testKeys);

      expect(res).to.equal(true);
      sinon.assert.calledOnceWithExactly(runCommandStub, 'install', {
        runAsRoot: true,
        params: ['-o', 'root', '-g', 'root', '-m', '0644', '/tmp/fluxadm-test/fluxadm_authorized_keys', '/etc/ssh/fluxadm_authorized_keys'],
      });
    });
  });

  describe('ensureAuthorizedKeys rotation tests', () => {
    const otherKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOTHERKEYONLYFORTESTS fluxteam-legacy-next';
    const killSessions = sinon.match({ params: sinon.match.array.startsWith(['kill', '--signal=SIGKILL', 'fluxadm-sshd@*.service']) });

    beforeEach(() => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
    });

    it('should end open sessions after installing a list that drops a key', async () => {
      sinon.stub(fs, 'readFile').resolves(`${testKeys[0]}\n${otherKey}\n`);

      const res = await fluxadmService.ensureAuthorizedKeys([otherKey]);

      expect(res).to.equal(true);
      sinon.assert.callOrder(runCommandStub.withArgs('install'), runCommandStub.withArgs('systemctl', killSessions));
    });

    it('should leave open sessions alone when a key is only added', async () => {
      sinon.stub(fs, 'readFile').resolves(`${testKeys[0]}\n`);

      await fluxadmService.ensureAuthorizedKeys([testKeys[0], otherKey]);

      sinon.assert.calledWith(runCommandStub, 'install');
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', killSessions);
    });

    it('should not end sessions on the first install', async () => {
      sinon.stub(fs, 'readFile').rejects(new Error('missing'));

      await fluxadmService.ensureAuthorizedKeys(testKeys);

      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', killSessions);
    });

    it('should not end sessions when the new list could not be installed', async () => {
      sinon.stub(fs, 'readFile').resolves(`${testKeys[0]}\n${otherKey}\n`);
      runCommandStub.withArgs('install').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureAuthorizedKeys([otherKey]);

      expect(res).to.equal(false);
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', killSessions);
    });
  });

  describe('ensureSshdInstance tests', () => {
    beforeEach(() => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
    });

    it('should not touch systemd when config, units and state are all current', async () => {
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile')
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig())
        .withArgs('/etc/systemd/system/fluxadm-sshd.socket', 'utf-8').resolves(fluxadmService.buildSocketUnit(16122))
        .withArgs('/etc/systemd/system/fluxadm-sshd@.service', 'utf-8').resolves(fluxadmService.buildSessionUnit());
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'enabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'active\n' });

      const res = await fluxadmService.ensureSshdInstance(16122);

      expect(res).to.equal(true);
      sinon.assert.neverCalledWith(runCommandStub, 'install');
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: ['daemon-reload'] }));
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: ['restart', 'fluxadm-sshd.socket'] }));
    });

    it('should validate and install a drifted config, which the next connection reads, without a restart', async () => {
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile')
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig().replace('MaxAuthTries 3', 'MaxAuthTries 6'))
        .withArgs('/etc/systemd/system/fluxadm-sshd.socket', 'utf-8').resolves(fluxadmService.buildSocketUnit(16122))
        .withArgs('/etc/systemd/system/fluxadm-sshd@.service', 'utf-8').resolves(fluxadmService.buildSessionUnit());
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'enabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'active\n' });

      const res = await fluxadmService.ensureSshdInstance(16122);

      expect(res).to.equal(true);
      sinon.assert.calledWithExactly(runCommandStub, '/usr/sbin/sshd', {
        runAsRoot: true,
        params: ['-t', '-f', '/tmp/fluxadm-test/fluxadm_sshd_config'],
      });
      sinon.assert.calledWithExactly(runCommandStub, 'install', {
        runAsRoot: true,
        params: ['-o', 'root', '-g', 'root', '-m', '0644', '/tmp/fluxadm-test/fluxadm_sshd_config', '/etc/ssh/fluxadm_sshd_config'],
      });
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: ['restart', 'fluxadm-sshd.socket'] }));
    });

    it('should move the socket to a new port and restart only the socket, leaving open sessions', async () => {
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile')
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig())
        .withArgs('/etc/systemd/system/fluxadm-sshd.socket', 'utf-8').resolves(fluxadmService.buildSocketUnit(16132))
        .withArgs('/etc/systemd/system/fluxadm-sshd@.service', 'utf-8').resolves(fluxadmService.buildSessionUnit());
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'enabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'active\n' });

      const res = await fluxadmService.ensureSshdInstance(16122);

      expect(res).to.equal(true);
      sinon.assert.calledOnceWithExactly(runCommandStub.withArgs('install'), 'install', {
        runAsRoot: true,
        params: ['-o', 'root', '-g', 'root', '-m', '0644', '/tmp/fluxadm-test/fluxadm-sshd.socket', '/etc/systemd/system/fluxadm-sshd.socket'],
      });
      sinon.assert.callOrder(
        runCommandStub.withArgs('systemctl', sinon.match({ params: ['daemon-reload'] })),
        runCommandStub.withArgs('systemctl', sinon.match({ params: ['restart', 'fluxadm-sshd.socket'] })),
      );
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: sinon.match.some(sinon.match('fluxadm-sshd@')) }));
    });

    it('should not install a config that fails sshd validation', async () => {
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile').resolves(null);
      runCommandStub.withArgs('/usr/sbin/sshd').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureSshdInstance(16122);

      expect(res).to.equal(false);
      sinon.assert.neverCalledWith(runCommandStub, 'install');
    });

    describe('when sshd is missing', () => {
      const policyRc = '#!/bin/sh\n# FluxOS: no service starts while it installs openssh-server.\nexit 101\n';
      const presetPath = '/etc/systemd/system-preset/00-fluxadm.preset';
      const holdInstalled = sinon.match({ params: sinon.match.array.endsWith(['/usr/sbin/policy-rc.d']) });
      const holdRemoved = sinon.match({ params: ['-f', '/usr/sbin/policy-rc.d'] });
      const presetDirMade = sinon.match({ runAsRoot: true, params: ['-d', '-m', '0755', '/etc/systemd/system-preset'] });
      const presetInstalled = sinon.match({ params: sinon.match.array.endsWith([presetPath]) });
      const presetRemoved = sinon.match({ params: ['-f', presetPath] });
      const anyDistroUnit = sinon.match({ params: sinon.match.some(sinon.match(/^ssh\.(service|socket)$/)) });
      let aptStub;
      let updateAptCacheStub;
      let statusStub;
      let readFileStub;
      let accessStub;

      beforeEach(() => {
        accessStub = sinon.stub(fs, 'access').rejects(new Error('missing'));
        // the preset exists from the moment the install writes it
        accessStub.withArgs(presetPath).resolves();
        readFileStub = sinon.stub(fs, 'readFile');
        readFileStub.withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig());
        readFileStub.withArgs('/etc/systemd/system/fluxadm-sshd.socket', 'utf-8').resolves(fluxadmService.buildSocketUnit(16122));
        readFileStub.withArgs('/etc/systemd/system/fluxadm-sshd@.service', 'utf-8').resolves(fluxadmService.buildSessionUnit());
        readFileStub.withArgs('/usr/sbin/policy-rc.d', 'utf-8').rejects(new Error('missing'));
        runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.socket'] }))
          .resolves({ ...cmdOk, stdout: 'enabled\n' });
        runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.socket'] }))
          .resolves({ ...cmdOk, stdout: 'active\n' });
        updateAptCacheStub = sinon.stub(systemService, 'updateAptCache').resolves();
        aptStub = sinon.stub(systemService, 'queueAptGetCommand').resolves({ error: null });
        statusStub = sinon.stub(systemService, 'getPackageStatus').resolves('install ok installed');
      });

      it('should write the preset and the hold before the install, and remove both once the package is installed', async () => {
        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(true);
        sinon.assert.calledWith(aptStub, 'install', sinon.match({ wait: true, params: ['openssh-server'] }));
        // the apt cache update runs before the hold, so the hold spans only the install
        sinon.assert.callOrder(updateAptCacheStub, runCommandStub.withArgs('install', holdInstalled));
        sinon.assert.callOrder(
          runCommandStub.withArgs('install', presetDirMade),
          runCommandStub.withArgs('install', presetInstalled),
          runCommandStub.withArgs('install', holdInstalled),
          aptStub,
          runCommandStub.withArgs('rm', holdRemoved),
          runCommandStub.withArgs('rm', presetRemoved),
        );
      });

      it('should never enable, disable or mask the package\'s own units', async () => {
        await fluxadmService.ensureSshdInstance(16122);

        for (const action of ['enable', 'disable', 'mask', 'start']) {
          sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: sinon.match.array.startsWith([action]) }).and(anyDistroUnit));
        }
      });

      it('should write a preset that leaves both of the package\'s units disabled', async () => {
        const writeFileStub = fs.writeFile;

        await fluxadmService.ensureSshdInstance(16122);

        const written = writeFileStub.getCalls().find((call) => call.args[0].endsWith('/00-fluxadm.preset'));
        expect(written, 'the preset must be staged').to.not.equal(undefined);
        const rules = written.args[1].split('\n').filter((line) => line && !line.startsWith('#'));
        expect(rules).to.deep.equal(['disable ssh.service', 'disable ssh.socket']);
      });

      it('should not install when the preset cannot be written', async () => {
        runCommandStub.withArgs('install', presetInstalled).resolves({ ...cmdFail });

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(false);
        sinon.assert.notCalled(aptStub);
        sinon.assert.neverCalledWith(runCommandStub, 'install', holdInstalled);
      });

      it('should not install when the preset directory cannot be made', async () => {
        runCommandStub.withArgs('install', presetDirMade).resolves({ ...cmdFail });

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(false);
        sinon.assert.notCalled(aptStub);
      });

      it('should remove the hold and the preset when apt fails after the package is installed', async () => {
        aptStub.resolves({ error: new Error('apt failed') });

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(false);
        sinon.assert.calledWith(runCommandStub, 'rm', holdRemoved);
        sinon.assert.calledWith(runCommandStub, 'rm', presetRemoved);
      });

      for (const state of ['unpacked', 'half-configured', 'half-installed']) {
        it(`should keep the preset while the package is ${state}, so configuring it later leaves its units disabled`, async () => {
          aptStub.resolves({ error: new Error('apt failed') });
          statusStub.resolves(`install ok ${state}`);

          const res = await fluxadmService.ensureSshdInstance(16122);

          expect(res).to.equal(false);
          sinon.assert.calledWith(runCommandStub, 'rm', holdRemoved);
          sinon.assert.neverCalledWith(runCommandStub, 'rm', presetRemoved);
        });
      }

      it('should never replace a policy-rc.d that is not FluxOS\'s', async () => {
        readFileStub.withArgs('/usr/sbin/policy-rc.d', 'utf-8').resolves('#!/bin/sh\nexit 0\n');

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(false);
        sinon.assert.notCalled(aptStub);
        sinon.assert.neverCalledWith(runCommandStub, 'install', holdInstalled);
        sinon.assert.neverCalledWith(runCommandStub, 'install', presetInstalled);
        sinon.assert.neverCalledWith(runCommandStub, 'rm', holdRemoved);
      });

      it('should install under its own hold left by an interrupted install, and remove it after', async () => {
        readFileStub.withArgs('/usr/sbin/policy-rc.d', 'utf-8').resolves(policyRc);

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(true);
        sinon.assert.neverCalledWith(runCommandStub, 'install', holdInstalled);
        sinon.assert.callOrder(aptStub, runCommandStub.withArgs('rm', holdRemoved));
      });

      describe('when a removed openssh-server left its enablement behind', () => {
        const serviceState = '/var/lib/systemd/deb-systemd-helper-enabled/ssh.service.dsh-also';
        const socketState = '/var/lib/systemd/deb-systemd-helper-enabled/ssh.socket.dsh-also';
        const wantsLink = '/etc/systemd/system/multi-user.target.wants/ssh.service';
        const aliasLink = '/etc/systemd/system/sshd.service';
        const socketLink = '/etc/systemd/system/sockets.target.wants/ssh.socket';
        const linksRemoved = sinon.match({ runAsRoot: true, params: ['-f', aliasLink, wantsLink] });
        const unitState = {};
        let lstatStub;
        let statStub;

        beforeEach(() => {
          unitState[serviceState] = `${aliasLink}\n${wantsLink}\n`;
          unitState[socketState] = `${socketLink}\n`;
          readFileStub.withArgs(sinon.match((p) => p in unitState), 'utf-8').callsFake(async (p) => unitState[p]);
          lstatStub = sinon.stub(fs, 'lstat').rejects(new Error('missing'));
          lstatStub.withArgs(wantsLink).resolves({ isSymbolicLink: () => true });
          lstatStub.withArgs(aliasLink).resolves({ isSymbolicLink: () => true });
          // pointing at nothing: the unit file left with the package
          statStub = sinon.stub(fs, 'stat').rejects(new Error('missing'));
        });

        it('should remove the recorded links that point at nothing and stop the units, before the install', async () => {
          const res = await fluxadmService.ensureSshdInstance(16122);

          expect(res).to.equal(true);
          sinon.assert.calledWithExactly(runCommandStub, 'rm', linksRemoved);
          sinon.assert.callOrder(
            runCommandStub.withArgs('rm', linksRemoved),
            runCommandStub.withArgs('systemctl', sinon.match({ params: ['stop', 'ssh.service', 'ssh.socket'] })),
            runCommandStub.withArgs('install', presetInstalled),
            aptStub,
          );
        });

        it('should keep a recorded link whose unit file exists', async () => {
          statStub.withArgs(wantsLink).resolves({});

          await fluxadmService.ensureSshdInstance(16122);

          sinon.assert.calledWithExactly(runCommandStub, 'rm', sinon.match({ params: ['-f', aliasLink] }));
          sinon.assert.neverCalledWith(runCommandStub, 'rm', sinon.match({ params: sinon.match.some(sinon.match(wantsLink)) }));
        });

        it('should keep a recorded path that is not a link, or not under /etc/systemd/system', async () => {
          lstatStub.withArgs(aliasLink).resolves({ isSymbolicLink: () => false });
          unitState[socketState] = '/lib/systemd/system/elsewhere.socket\n';
          lstatStub.withArgs('/lib/systemd/system/elsewhere.socket').resolves({ isSymbolicLink: () => true });

          await fluxadmService.ensureSshdInstance(16122);

          sinon.assert.calledWithExactly(runCommandStub, 'rm', sinon.match({ params: ['-f', wantsLink] }));
          sinon.assert.neverCalledWith(runCommandStub, 'rm', sinon.match({ params: sinon.match.some(sinon.match('elsewhere')) }));
        });

        it('should not install when the links cannot be removed', async () => {
          runCommandStub.withArgs('rm', linksRemoved).resolves({ ...cmdFail });

          const res = await fluxadmService.ensureSshdInstance(16122);

          expect(res).to.equal(false);
          sinon.assert.notCalled(aptStub);
          sinon.assert.neverCalledWith(runCommandStub, 'install', presetInstalled);
        });
      });
    });

    describe('when sshd is present', () => {
      const holdRemoved = sinon.match({ params: ['-f', '/usr/sbin/policy-rc.d'] });
      let readFileStub;

      beforeEach(() => {
        sinon.stub(fs, 'access').resolves();
        readFileStub = sinon.stub(fs, 'readFile');
        readFileStub.withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig());
        readFileStub.withArgs('/etc/systemd/system/fluxadm-sshd.socket', 'utf-8').resolves(fluxadmService.buildSocketUnit(16122));
        readFileStub.withArgs('/etc/systemd/system/fluxadm-sshd@.service', 'utf-8').resolves(fluxadmService.buildSessionUnit());
        runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.socket'] }))
          .resolves({ ...cmdOk, stdout: 'enabled\n' });
        runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.socket'] }))
          .resolves({ ...cmdOk, stdout: 'active\n' });
      });

      it('should remove its own hold left behind once the package went in', async () => {
        readFileStub.withArgs('/usr/sbin/policy-rc.d', 'utf-8')
          .resolves('#!/bin/sh\n# FluxOS: no service starts while it installs openssh-server.\nexit 101\n');

        await fluxadmService.ensureSshdInstance(16122);

        sinon.assert.calledWith(runCommandStub, 'rm', holdRemoved);
      });

      it('should leave a policy-rc.d that is not FluxOS\'s', async () => {
        readFileStub.withArgs('/usr/sbin/policy-rc.d', 'utf-8').resolves('#!/bin/sh\nexit 101\n');

        await fluxadmService.ensureSshdInstance(16122);

        sinon.assert.neverCalledWith(runCommandStub, 'rm', holdRemoved);
      });
    });

    it('should leave an sshd the node owner already has untouched', async () => {
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile').resolves(null);
      const aptStub = sinon.stub(systemService, 'queueAptGetCommand').resolves({ error: null });

      await fluxadmService.ensureSshdInstance(16122);

      sinon.assert.notCalled(aptStub);
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: sinon.match.some(sinon.match(/^ssh\./)) }));
    });
  });

  describe('ensureFirewall tests', () => {
    it('should skip when no firewall is active', async () => {
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(false);

      await fluxadmService.ensureFirewall(16122);

      sinon.assert.neverCalledWith(runCommandStub, 'python3', anyUfwCall);
    });

    it('should add a rate-limited rule when the firewall is active', async () => {
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);

      const res = await fluxadmService.ensureFirewall(16122);

      expect(res).to.equal(true);
      sinon.assert.calledWithExactly(runCommandStub, 'python3', {
        runAsRoot: true,
        logError: false,
        params: [ufw.UFW_HELPER, '--wait', '30', '--command', '["limit","16122/tcp"]'],
        timeout: 2 * ufw.UFW_LOCK_WAIT_MS,
      });
    });

    it('should report a rule it could not add', async () => {
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);
      runCommandStub.withArgs('python3', anyUfwCall).resolves({ ...cmdFail, stderr: 'ERROR: problem running ufw-init' });

      const res = await fluxadmService.ensureFirewall(16122);

      expect(res).to.equal(false);
    });
  });

  describe('endSessions tests', () => {
    const units = ['fluxadm-sshd@*.service', 'user-998.slice'];

    it('should kill every session unit and the user\'s slice, then stop them, which waits until they are empty', async () => {
      runCommandStub.withArgs('id').resolves({ ...cmdOk, stdout: '998\n' });

      await fluxadmService.endSessions();

      sinon.assert.callOrder(
        runCommandStub.withArgs('systemctl', sinon.match({ runAsRoot: true, params: ['kill', '--signal=SIGKILL', ...units] })),
        runCommandStub.withArgs('systemctl', sinon.match({ runAsRoot: true, params: ['stop', ...units] })),
      );
    });

    it('should still end the session units when the user cannot be looked up', async () => {
      runCommandStub.withArgs('id').resolves({ ...cmdFail });

      await fluxadmService.endSessions();

      sinon.assert.calledWith(runCommandStub, 'systemctl', sinon.match({ params: ['kill', '--signal=SIGKILL', 'fluxadm-sshd@*.service'] }));
      sinon.assert.calledWith(runCommandStub, 'systemctl', sinon.match({ params: ['stop', 'fluxadm-sshd@*.service'] }));
    });
  });

  describe('removeAccess tests', () => {
    const sudoersRead = sinon.match({ params: ['/etc/sudoers.d/fluxadm'] });
    const call = (cmd, params) => runCommandStub.withArgs(cmd, sinon.match({ params }));

    it('should stop listening, end sessions, remove the sshd, its keys, the firewall rule, the user, and the drop-in last', async () => {
      sinon.stub(fs, 'access').resolves();
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });

      await fluxadmService.removeAccess();

      sinon.assert.callOrder(
        call('systemctl', ['disable', '--now', 'fluxadm-sshd.socket']),
        call('systemctl', sinon.match.array.startsWith(['kill', '--signal=SIGKILL', 'fluxadm-sshd@*.service'])),
        call('systemctl', sinon.match.array.startsWith(['stop', 'fluxadm-sshd@*.service'])),
        call('rm', ['-f', '/etc/systemd/system/fluxadm-sshd.socket', '/etc/systemd/system/fluxadm-sshd@.service', '/etc/ssh/fluxadm_sshd_config', '/etc/ssh/fluxadm_authorized_keys']),
        call('systemctl', ['daemon-reload']),
        runCommandStub.withArgs('python3', ufwCall(['delete', 'limit', '16122/tcp'])),
        call('userdel', ['-r', 'fluxadm']),
        call('rm', ['-f', '/etc/sudoers.d/fluxadm']),
      );
    });

    it('should keep the user and the drop-in when the firewall rule cannot be deleted', async () => {
      sinon.stub(fs, 'access').resolves();
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });
      runCommandStub.withArgs('python3', anyUfwCall).resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'userdel');
      sinon.assert.neverCalledWith(runCommandStub, 'rm', sinon.match({ params: ['-f', '/etc/sudoers.d/fluxadm'] }));
    });

    it('should remove the user of a node without ufw', async () => {
      sinon.stub(fs, 'access').resolves()
        .withArgs('/usr/sbin/ufw').rejects(new Error('missing'));
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'python3', anyUfwCall);
      sinon.assert.calledWith(runCommandStub, 'userdel', sinon.match({ params: ['-r', 'fluxadm'] }));
      sinon.assert.calledWith(runCommandStub, 'rm', sinon.match({ params: ['-f', '/etc/sudoers.d/fluxadm'] }));
    });

    it('should keep the drop-in when the user cannot be removed', async () => {
      sinon.stub(fs, 'access').resolves();
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });
      runCommandStub.withArgs('userdel').resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'rm', sinon.match({ params: ['-f', '/etc/sudoers.d/fluxadm'] }));
    });

    it('should remove the drop-in of a user already gone', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });
      runCommandStub.withArgs('id').resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'userdel');
      sinon.assert.calledWith(runCommandStub, 'rm', sinon.match({ params: ['-f', '/etc/sudoers.d/fluxadm'] }));
    });

    it('should remove a key file left without its unit', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'))
        .withArgs('/etc/ssh/fluxadm_authorized_keys').resolves();
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.calledWith(runCommandStub, 'rm', sinon.match({ params: sinon.match.some(sinon.match('/etc/ssh/fluxadm_authorized_keys')) }));
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl');
    });

    it('should never touch a fluxadm user without our drop-in', async () => {
      sinon.stub(fs, 'access').resolves();
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: sinon.match.array.startsWith(['kill']) }));
      sinon.assert.neverCalledWith(runCommandStub, 'python3', anyUfwCall);
      sinon.assert.neverCalledWith(runCommandStub, 'userdel');
      sinon.assert.calledWith(runCommandStub, 'rm', sinon.match({ params: sinon.match.some(sinon.match('/etc/ssh/fluxadm_sshd_config')) }));
    });

    it('should do nothing on a node that never had access installed', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'systemctl');
      sinon.assert.neverCalledWith(runCommandStub, 'rm');
      sinon.assert.neverCalledWith(runCommandStub, 'python3', anyUfwCall);
      sinon.assert.neverCalledWith(runCommandStub, 'userdel');
    });
  });

  describe('buildSshdConfig tests', () => {
    it('should read keys only from the root-owned key file', () => {
      const lines = fluxadmService.buildSshdConfig().split('\n');

      expect(lines.filter((line) => line.startsWith('AuthorizedKeysFile'))).to.deep.equal(['AuthorizedKeysFile /etc/ssh/fluxadm_authorized_keys']);
    });

    it('should end a connection that has not logged in within 10 s', () => {
      const lines = fluxadmService.buildSshdConfig().split('\n');

      expect(lines.filter((line) => line.startsWith('LoginGraceTime'))).to.deep.equal(['LoginGraceTime 10']);
    });
  });

  describe('maintenance sshd unit tests', () => {
    it('should listen on the port and start one session unit per connection', () => {
      const lines = fluxadmService.buildSocketUnit(16122).split('\n');

      expect(lines).to.include('ListenStream=16122');
      expect(lines).to.include('Accept=yes');
    });

    it('should turn off the trigger rate limit and cap concurrent connections, so a burst cannot take it offline', () => {
      const lines = fluxadmService.buildSocketUnit(16122).split('\n');

      expect(lines).to.include('TriggerLimitIntervalSec=0');
      expect(lines).to.include('MaxConnections=10');
    });

    it('should keep one address to two connections, so a single source cannot hold every slot', () => {
      const lines = fluxadmService.buildSocketUnit(16122).split('\n');

      expect(lines).to.include('MaxConnectionsPerSource=2');
    });

    it('should serve each connection with an sshd in inetd mode on the maintenance config', () => {
      const lines = fluxadmService.buildSessionUnit().split('\n');

      expect(lines).to.include('ExecStart=-/usr/sbin/sshd -i -f /etc/ssh/fluxadm_sshd_config');
      expect(lines).to.include('StandardInput=socket');
      expect(lines.filter((line) => line.startsWith('KillMode='))).to.deep.equal([]);
    });

    it('should name no port in the sshd config, which the socket holds', () => {
      expect(fluxadmService.buildSshdConfig()).to.not.match(/^(Port|PidFile|ListenAddress)\b/m);
    });
  });

  describe('ensureFluxadmAccess tests', () => {
    it('should run the removal path only on a confirmed legacy node when no keys are configured', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      const benchStub = sinon.stub(benchmarkService, 'getBenchmarks')
        .resolves({ status: 'success', data: { systemsecure: false } });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('reconciled');
      sinon.assert.calledOnce(benchStub);
    });

    it('should not run the removal path while the ArcaneOS confirmation is indeterminate', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').rejects(new Error('unreachable'));

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('deferred');
      sinon.assert.notCalled(runCommandStub);
    });

    it('should not run the removal path when fluxbenchd reports ArcaneOS', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: true } });

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('skipped');
      sinon.assert.notCalled(runCommandStub);
    });

    it('should defer when the ArcaneOS confirmation is indeterminate', async () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      sinon.stub(benchmarkService, 'getBenchmarks').rejects(new Error('unreachable'));

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('deferred');
    });

    it('should skip when fluxbenchd reports ArcaneOS', async () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: true } });

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('skipped');
      sinon.assert.neverCalledWith(runCommandStub, 'useradd');
    });

    it('should skip a legacy node whose init is not systemd without touching the system', async () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
      systemdStub.withArgs('/run/systemd/system').returns(false);

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('skipped');
      sinon.assert.notCalled(runCommandStub);
    });

    it('should not run the removal path on a legacy node whose init is not systemd', async () => {
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
      systemdStub.withArgs('/run/systemd/system').returns(false);

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('skipped');
      sinon.assert.notCalled(runCommandStub);
    });

    it('should stop the pipeline at the first failing step', async () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
      runCommandStub.withArgs('id').resolves({ ...cmdOk, stdout: '1001' });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('failed');
      sinon.assert.neverCalledWith(runCommandStub, 'useradd');
      sinon.assert.neverCalledWith(runCommandStub, 'visudo');
      sinon.assert.neverCalledWith(runCommandStub, 'install');
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl');
      sinon.assert.neverCalledWith(runCommandStub, 'python3', anyUfwCall);
    });

    it('should publish each pass, naming the step a failed pass stopped at', async () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
      runCommandStub.withArgs('id').resolves({ ...cmdOk, stdout: '1001' });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });
      const publishStub = sinon.stub(fluxEventBus, 'publish');
      const clock = sinon.useFakeTimers();

      try {
        fluxadmService.start();
        await clock.tickAsync(0);
      } finally {
        fluxadmService.stop();
        clock.restore();
      }

      sinon.assert.calledOnceWithExactly(publishStub, 'fluxadm:pass', { outcome: 'failed', step: 'user' });
    });

    describe('a preset an interrupted openssh-server install left', () => {
      const presetPath = '/etc/systemd/system-preset/00-fluxadm.preset';
      const presetRemoved = sinon.match({ runAsRoot: true, params: ['-f', presetPath] });
      let statusStub;
      let lockedStub;

      beforeEach(() => {
        sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
        sinon.stub(fs, 'access').rejects(new Error('missing')).withArgs(presetPath).resolves();
        runCommandStub.withArgs('cat').resolves({ ...cmdFail });
        statusStub = sinon.stub(systemService, 'getPackageStatus').resolves('install ok installed');
        lockedStub = systemService.dpkgFrontendLocked;
      });

      it('should be removed at the start of a pass once openssh-server is installed, also with no keys configured', async () => {
        const res = await fluxadmService.ensureFluxadmAccess();

        expect(res).to.equal('reconciled');
        sinon.assert.calledWithExactly(statusStub, 'openssh-server');
        sinon.assert.calledWithExactly(runCommandStub, 'rm', presetRemoved);
      });

      it('should stay while a package operation holds dpkg\'s lock, the package not yet unpacked', async () => {
        // An apt install that outlived a crashed FluxOS, still downloading.
        lockedStub.resolves(true);
        statusStub.resolves('unknown ok not-installed');

        await fluxadmService.ensureFluxadmAccess();

        sinon.assert.neverCalledWith(runCommandStub, 'rm', presetRemoved);
      });

      it('should be removed on the first pass after dpkg\'s lock is released', async () => {
        lockedStub.resolves(true);
        statusStub.resolves('unknown ok not-installed');
        await fluxadmService.ensureFluxadmAccess();
        lockedStub.resolves(false);

        await fluxadmService.ensureFluxadmAccess();

        sinon.assert.calledOnceWithExactly(runCommandStub.withArgs('rm', presetRemoved), 'rm', presetRemoved);
      });

      it('should be removed once openssh-server is gone', async () => {
        statusStub.resolves('');

        await fluxadmService.ensureFluxadmAccess();

        sinon.assert.calledWithExactly(runCommandStub, 'rm', presetRemoved);
      });

      for (const state of ['unpacked', 'half-configured', 'half-installed']) {
        it(`should stay while openssh-server is ${state}`, async () => {
          statusStub.resolves(`install ok ${state}`);

          await fluxadmService.ensureFluxadmAccess();

          sinon.assert.neverCalledWith(runCommandStub, 'rm', presetRemoved);
        });
      }

      it('should be left alone on a node that is not a confirmed legacy node', async () => {
        benchmarkService.getBenchmarks.resolves({ status: 'success', data: { systemsecure: true } });

        expect(await fluxadmService.ensureFluxadmAccess()).to.equal('skipped');
        sinon.assert.notCalled(statusStub);
        sinon.assert.neverCalledWith(runCommandStub, 'rm', presetRemoved);
      });
    });

    it('should publish a pass that reconciled without a step', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });
      const publishStub = sinon.stub(fluxEventBus, 'publish');
      const clock = sinon.useFakeTimers();

      try {
        fluxadmService.start();
        await clock.tickAsync(0);
      } finally {
        fluxadmService.stop();
        clock.restore();
      }

      sinon.assert.calledOnceWithExactly(publishStub, 'fluxadm:pass', { outcome: 'reconciled' });
    });

    it('should fail the pass when the firewall rule cannot be added', async () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile')
        .withArgs('/etc/ssh/fluxadm_authorized_keys', 'utf-8').rejects(new Error('missing'))
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig())
        .withArgs('/etc/systemd/system/fluxadm-sshd.socket', 'utf-8').resolves(fluxadmService.buildSocketUnit(16122))
        .withArgs('/etc/systemd/system/fluxadm-sshd@.service', 'utf-8').resolves(fluxadmService.buildSessionUnit());
      runCommandStub.withArgs('id').resolves({ ...cmdFail });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'disabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'inactive\n' });

      runCommandStub.withArgs('python3', anyUfwCall).resolves({ ...cmdFail });

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('failed');
    });

    it('should reconcile user, sudoers, keys, sshd and firewall on a confirmed legacy node', async () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile')
        .withArgs('/etc/ssh/fluxadm_authorized_keys', 'utf-8').rejects(new Error('missing'))
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig())
        .withArgs('/etc/systemd/system/fluxadm-sshd.socket', 'utf-8').resolves(fluxadmService.buildSocketUnit(16122))
        .withArgs('/etc/systemd/system/fluxadm-sshd@.service', 'utf-8').resolves(fluxadmService.buildSessionUnit());
      runCommandStub.withArgs('id').resolves({ ...cmdFail });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'disabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.socket'] }))
        .resolves({ ...cmdOk, stdout: 'inactive\n' });

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('reconciled');
      sinon.assert.calledWith(runCommandStub, 'useradd', sinon.match({ runAsRoot: true }));
      sinon.assert.calledWith(runCommandStub, 'visudo', sinon.match({ runAsRoot: true }));
      sinon.assert.calledWith(runCommandStub, 'systemctl', sinon.match({ params: ['enable', 'fluxadm-sshd.socket'] }));
      sinon.assert.calledWith(runCommandStub, 'systemctl', sinon.match({ params: ['restart', 'fluxadm-sshd.socket'] }));
      sinon.assert.calledWith(runCommandStub, 'python3', ufwCall(['limit', '16122/tcp']));
    });
  });
});
