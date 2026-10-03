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

describe('fluxadmService tests', () => {
  let runCommandStub;
  let systemdStub;

  beforeEach(() => {
    runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ ...cmdOk });
    systemdStub = sinon.stub(fsSync, 'existsSync').callThrough();
    systemdStub.withArgs('/run/systemd/system').returns(true);
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
    const terminate = sinon.match({ params: ['terminate-user', 'fluxadm'] });

    beforeEach(() => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
    });

    it('should end open sessions after installing a list that drops a key', async () => {
      sinon.stub(fs, 'readFile').resolves(`${testKeys[0]}\n${otherKey}\n`);

      const res = await fluxadmService.ensureAuthorizedKeys([otherKey]);

      expect(res).to.equal(true);
      sinon.assert.callOrder(runCommandStub.withArgs('install'), runCommandStub.withArgs('loginctl', terminate));
      sinon.assert.calledWith(runCommandStub, 'systemctl', sinon.match({ params: sinon.match.some(sinon.match('--kill-who=all')) }));
    });

    it('should leave open sessions alone when a key is only added', async () => {
      sinon.stub(fs, 'readFile').resolves(`${testKeys[0]}\n`);

      await fluxadmService.ensureAuthorizedKeys([testKeys[0], otherKey]);

      sinon.assert.calledWith(runCommandStub, 'install');
      sinon.assert.neverCalledWith(runCommandStub, 'loginctl');
    });

    it('should not end sessions on the first install', async () => {
      sinon.stub(fs, 'readFile').rejects(new Error('missing'));

      await fluxadmService.ensureAuthorizedKeys(testKeys);

      sinon.assert.neverCalledWith(runCommandStub, 'loginctl');
    });

    it('should not end sessions when the new list could not be installed', async () => {
      sinon.stub(fs, 'readFile').resolves(`${testKeys[0]}\n${otherKey}\n`);
      runCommandStub.withArgs('install').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureAuthorizedKeys([otherKey]);

      expect(res).to.equal(false);
      sinon.assert.neverCalledWith(runCommandStub, 'loginctl');
    });
  });

  describe('ensureSshdInstance tests', () => {
    beforeEach(() => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
    });

    it('should not touch systemd when config, unit and state are all current', async () => {
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile')
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig(16122))
        .withArgs('/etc/systemd/system/fluxadm-sshd.service', 'utf-8').resolves(fluxadmService.buildServiceUnit());
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.service'] }))
        .resolves({ ...cmdOk, stdout: 'enabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.service'] }))
        .resolves({ ...cmdOk, stdout: 'active\n' });

      const res = await fluxadmService.ensureSshdInstance(16122);

      expect(res).to.equal(true);
      sinon.assert.neverCalledWith(runCommandStub, 'install');
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: ['restart', 'fluxadm-sshd.service'] }));
    });

    it('should validate, install and restart when the config drifted', async () => {
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile')
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig(16132))
        .withArgs('/etc/systemd/system/fluxadm-sshd.service', 'utf-8').resolves(fluxadmService.buildServiceUnit());
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.service'] }))
        .resolves({ ...cmdOk, stdout: 'enabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.service'] }))
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
      sinon.assert.calledWithExactly(runCommandStub, 'systemctl', {
        runAsRoot: true,
        params: ['restart', 'fluxadm-sshd.service'],
      });
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
      const distroUnits = ['ssh.service', 'ssh.socket'];
      const systemctlCall = (verb) => sinon.match({ runAsRoot: true, params: [verb, ...distroUnits] });
      let upgradeStub;

      beforeEach(() => {
        sinon.stub(fs, 'access').rejects(new Error('missing'));
        sinon.stub(fs, 'readFile')
          .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig(16122))
          .withArgs('/etc/systemd/system/fluxadm-sshd.service', 'utf-8').resolves(fluxadmService.buildServiceUnit());
        runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.service'] }))
          .resolves({ ...cmdOk, stdout: 'enabled\n' });
        runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.service'] }))
          .resolves({ ...cmdOk, stdout: 'active\n' });
        upgradeStub = sinon.stub(systemService, 'upgradePackage').resolves(false);
      });

      it('should mask the package\'s own units across the install, then leave them disabled', async () => {
        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(true);
        const mask = runCommandStub.withArgs('systemctl', systemctlCall('mask'));
        const unmask = runCommandStub.withArgs('systemctl', systemctlCall('unmask'));
        const disable = runCommandStub.withArgs('systemctl', systemctlCall('disable'));
        sinon.assert.calledWithExactly(upgradeStub, 'openssh-server');
        sinon.assert.callOrder(mask, upgradeStub, unmask, disable);
        sinon.assert.calledOnce(mask);
      });

      it('should not install when the units cannot be masked', async () => {
        runCommandStub.withArgs('systemctl', systemctlCall('mask')).resolves({ ...cmdFail });

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(false);
        sinon.assert.notCalled(upgradeStub);
      });

      it('should leave the units masked when the install fails', async () => {
        upgradeStub.resolves(true);

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(false);
        sinon.assert.neverCalledWith(runCommandStub, 'systemctl', systemctlCall('unmask'));
      });

      it('should not disable units it could not unmask', async () => {
        runCommandStub.withArgs('systemctl', systemctlCall('unmask')).resolves({ ...cmdFail });

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(false);
        sinon.assert.neverCalledWith(runCommandStub, 'systemctl', systemctlCall('disable'));
      });

      it('should mask the units again when they cannot be disabled', async () => {
        runCommandStub.withArgs('systemctl', systemctlCall('disable')).resolves({ ...cmdFail });

        const res = await fluxadmService.ensureSshdInstance(16122);

        expect(res).to.equal(false);
        const mask = runCommandStub.withArgs('systemctl', systemctlCall('mask'));
        sinon.assert.calledTwice(mask);
        sinon.assert.callOrder(runCommandStub.withArgs('systemctl', systemctlCall('disable')), mask);
      });
    });

    it('should leave an sshd the operator already has untouched', async () => {
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile').resolves(null);
      const upgradeStub = sinon.stub(systemService, 'upgradePackage').resolves(false);

      await fluxadmService.ensureSshdInstance(16122);

      sinon.assert.notCalled(upgradeStub);
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl', sinon.match({ params: sinon.match.some(sinon.match(/^ssh\./)) }));
    });
  });

  describe('ensureFirewall tests', () => {
    it('should skip when no firewall is active', async () => {
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(false);

      await fluxadmService.ensureFirewall(16122);

      sinon.assert.neverCalledWith(runCommandStub, 'ufw');
    });

    it('should add a rate-limited rule when the firewall is active', async () => {
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);

      const res = await fluxadmService.ensureFirewall(16122);

      expect(res).to.equal(true);
      sinon.assert.calledWithExactly(runCommandStub, 'ufw', {
        runAsRoot: true,
        logError: false,
        params: ['limit', '16122/tcp'],
      });
    });

    it('should report a rule it could not add', async () => {
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);
      runCommandStub.withArgs('ufw').resolves({ ...cmdFail, stderr: 'ERROR: problem running ufw-init' });

      const res = await fluxadmService.ensureFirewall(16122);

      expect(res).to.equal(false);
    });
  });

  describe('endSessions tests', () => {
    it('should end logind sessions and everything left in the maintenance unit\'s cgroup', async () => {
      await fluxadmService.endSessions();

      sinon.assert.calledWithExactly(runCommandStub, 'loginctl', {
        runAsRoot: true,
        logError: false,
        params: ['terminate-user', 'fluxadm'],
      });
      sinon.assert.calledWithExactly(runCommandStub, 'systemctl', {
        runAsRoot: true,
        logError: false,
        params: ['kill', '--kill-who=all', '--signal=SIGKILL', 'fluxadm-sshd.service'],
      });
    });
  });

  describe('removeAccess tests', () => {
    const sudoersRead = sinon.match({ params: ['/etc/sudoers.d/fluxadm'] });
    const call = (cmd, params) => runCommandStub.withArgs(cmd, sinon.match({ params }));

    it('should end sessions, remove the sshd, its keys, the firewall rule, the user, and the drop-in last', async () => {
      sinon.stub(fs, 'access').resolves();
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });

      await fluxadmService.removeAccess();

      sinon.assert.callOrder(
        call('loginctl', ['terminate-user', 'fluxadm']),
        call('systemctl', ['kill', '--kill-who=all', '--signal=SIGKILL', 'fluxadm-sshd.service']),
        call('systemctl', ['disable', '--now', 'fluxadm-sshd.service']),
        call('rm', ['-f', '/etc/systemd/system/fluxadm-sshd.service', '/etc/ssh/fluxadm_sshd_config', '/etc/ssh/fluxadm_authorized_keys']),
        call('systemctl', ['daemon-reload']),
        call('ufw', ['delete', 'limit', '16122/tcp']),
        call('userdel', ['-r', 'fluxadm']),
        call('rm', ['-f', '/etc/sudoers.d/fluxadm']),
      );
    });

    it('should keep the user and the drop-in when the firewall rule cannot be deleted', async () => {
      sinon.stub(fs, 'access').resolves();
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });
      runCommandStub.withArgs('ufw').resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'userdel');
      sinon.assert.neverCalledWith(runCommandStub, 'rm', sinon.match({ params: ['-f', '/etc/sudoers.d/fluxadm'] }));
    });

    it('should remove the user of a node without ufw', async () => {
      sinon.stub(fs, 'access').resolves()
        .withArgs('/usr/sbin/ufw').rejects(new Error('missing'));
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'ufw');
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

      sinon.assert.neverCalledWith(runCommandStub, 'loginctl');
      sinon.assert.neverCalledWith(runCommandStub, 'ufw');
      sinon.assert.neverCalledWith(runCommandStub, 'userdel');
      sinon.assert.calledWith(runCommandStub, 'rm', sinon.match({ params: sinon.match.some(sinon.match('/etc/ssh/fluxadm_sshd_config')) }));
    });

    it('should do nothing on a node that never had access installed', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      runCommandStub.withArgs('cat', sudoersRead).resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'loginctl');
      sinon.assert.neverCalledWith(runCommandStub, 'systemctl');
      sinon.assert.neverCalledWith(runCommandStub, 'rm');
      sinon.assert.neverCalledWith(runCommandStub, 'ufw');
      sinon.assert.neverCalledWith(runCommandStub, 'userdel');
    });
  });

  describe('buildSshdConfig tests', () => {
    it('should read keys only from the root-owned key file', () => {
      const lines = fluxadmService.buildSshdConfig(16122).split('\n');

      expect(lines.filter((line) => line.startsWith('AuthorizedKeysFile'))).to.deep.equal(['AuthorizedKeysFile /etc/ssh/fluxadm_authorized_keys']);
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
      sinon.assert.neverCalledWith(runCommandStub, 'ufw');
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
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig(16122))
        .withArgs('/etc/systemd/system/fluxadm-sshd.service', 'utf-8').resolves(fluxadmService.buildServiceUnit());
      runCommandStub.withArgs('id').resolves({ ...cmdFail });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.service'] }))
        .resolves({ ...cmdOk, stdout: 'disabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.service'] }))
        .resolves({ ...cmdOk, stdout: 'inactive\n' });

      runCommandStub.withArgs('ufw').resolves({ ...cmdFail });

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
        .withArgs('/etc/ssh/fluxadm_sshd_config', 'utf-8').resolves(fluxadmService.buildSshdConfig(16122))
        .withArgs('/etc/systemd/system/fluxadm-sshd.service', 'utf-8').resolves(fluxadmService.buildServiceUnit());
      runCommandStub.withArgs('id').resolves({ ...cmdFail });
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.service'] }))
        .resolves({ ...cmdOk, stdout: 'disabled\n' });
      runCommandStub.withArgs('systemctl', sinon.match({ params: ['is-active', 'fluxadm-sshd.service'] }))
        .resolves({ ...cmdOk, stdout: 'inactive\n' });

      const res = await fluxadmService.ensureFluxadmAccess();

      expect(res).to.equal('reconciled');
      sinon.assert.calledWith(runCommandStub, 'useradd', sinon.match({ runAsRoot: true }));
      sinon.assert.calledWith(runCommandStub, 'visudo', sinon.match({ runAsRoot: true }));
      sinon.assert.calledWith(runCommandStub, 'systemctl', sinon.match({ params: ['enable', 'fluxadm-sshd.service'] }));
      sinon.assert.calledWith(runCommandStub, 'systemctl', sinon.match({ params: ['restart', 'fluxadm-sshd.service'] }));
      sinon.assert.calledWith(runCommandStub, 'ufw', sinon.match({ params: ['limit', '16122/tcp'] }));
    });
  });
});
