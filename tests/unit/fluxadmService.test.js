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
const fluxadmService = proxyquire('../../ZelBack/src/services/fluxadmService', {
  config: testConfig,
});

const cmdOk = { error: null, stdout: '', stderr: '' };
const cmdFail = { error: new Error('command failed'), stdout: '', stderr: '' };

describe('fluxadmService tests', () => {
  let runCommandStub;
  let systemdStub;

  before(() => {
    globalThis.userconfig = { initial: {} };
  });

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

  describe('getFluxadmSshPort tests', () => {
    it('should return null when no keys are configured', () => {
      const res = fluxadmService.getFluxadmSshPort();

      expect(res).to.equal(null);
    });

    it('should return apiport - 5 when keys are configured', () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;

      const res = fluxadmService.getFluxadmSshPort();

      expect(res).to.equal(16122);
    });

    it('should return null when systemd is not the init', () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      systemdStub.withArgs('/run/systemd/system').returns(false);

      const res = fluxadmService.getFluxadmSshPort();

      expect(res).to.equal(null);
    });

    it('should follow a custom apiport from userconfig', () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      globalThis.userconfig = { initial: { apiport: 16137 } };

      const res = fluxadmService.getFluxadmSshPort();

      expect(res).to.equal(16132);
      globalThis.userconfig = { initial: {} };
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
      runCommandStub.withArgs('cat').resolves({ ...cmdOk, stdout: `${testKeys[0]}\n` });

      const res = await fluxadmService.ensureAuthorizedKeys(testKeys);

      expect(res).to.equal(true);
      sinon.assert.neverCalledWith(runCommandStub, 'install');
    });

    it('should create the .ssh dir and install the key file when different', async () => {
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });

      const res = await fluxadmService.ensureAuthorizedKeys(testKeys);

      expect(res).to.equal(true);
      sinon.assert.calledWithExactly(runCommandStub, 'install', {
        runAsRoot: true,
        params: ['-d', '-o', 'fluxadm', '-g', 'fluxadm', '-m', '0700', '/home/fluxadm/.ssh'],
      });
      sinon.assert.calledWithExactly(runCommandStub, 'install', {
        runAsRoot: true,
        params: ['-o', 'fluxadm', '-g', 'fluxadm', '-m', '0600', '/tmp/fluxadm-test/authorized_keys', '/home/fluxadm/.ssh/authorized_keys'],
      });
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

    it('should attempt to install openssh-server when sshd is missing', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      sinon.stub(fs, 'readFile').resolves(null);
      const upgradeStub = sinon.stub(systemService, 'upgradePackage').resolves(true);

      const res = await fluxadmService.ensureSshdInstance(16122);

      expect(res).to.equal(false);
      sinon.assert.calledWithExactly(upgradeStub, 'openssh-server');
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

      await fluxadmService.ensureFirewall(16122);

      sinon.assert.calledWithExactly(runCommandStub, 'ufw', {
        runAsRoot: true,
        params: ['limit', '16122/tcp'],
      });
    });
  });

  describe('removeAccess tests', () => {
    beforeEach(() => {
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
    });

    it('should disable the unit, remove its files and empty authorized_keys when present', async () => {
      sinon.stub(fs, 'access').resolves();
      runCommandStub.withArgs('cat', sinon.match({ params: ['/etc/sudoers.d/fluxadm'] }))
        .resolves({ ...cmdOk, stdout: 'fluxadm ALL=(ALL) NOPASSWD:ALL\n' });
      runCommandStub.withArgs('cat', sinon.match({ params: ['/home/fluxadm/.ssh/authorized_keys'] }))
        .resolves({ ...cmdOk, stdout: `${testKeys[0]}\n` });

      await fluxadmService.removeAccess();

      sinon.assert.calledWithExactly(runCommandStub, 'systemctl', {
        runAsRoot: true,
        logError: false,
        params: ['disable', '--now', 'fluxadm-sshd.service'],
      });
      sinon.assert.calledWithExactly(runCommandStub, 'rm', {
        runAsRoot: true,
        params: ['-f', '/etc/systemd/system/fluxadm-sshd.service', '/etc/ssh/fluxadm_sshd_config'],
      });
      sinon.assert.calledWithExactly(runCommandStub, 'systemctl', {
        runAsRoot: true,
        params: ['daemon-reload'],
      });
      sinon.assert.calledWithExactly(runCommandStub, 'install', {
        runAsRoot: true,
        params: ['-o', 'fluxadm', '-g', 'fluxadm', '-m', '0600', '/tmp/fluxadm-test/authorized_keys', '/home/fluxadm/.ssh/authorized_keys'],
      });
    });

    it('should do nothing on a node that never had access installed', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      runCommandStub.withArgs('cat').resolves({ ...cmdFail });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'systemctl');
      sinon.assert.neverCalledWith(runCommandStub, 'rm');
      sinon.assert.neverCalledWith(runCommandStub, 'install');
    });

    it('should never touch the keys of a fluxadm user without our sudoers drop-in', async () => {
      sinon.stub(fs, 'access').rejects(new Error('missing'));
      runCommandStub.withArgs('cat', sinon.match({ params: ['/etc/sudoers.d/fluxadm'] }))
        .resolves({ ...cmdFail });
      runCommandStub.withArgs('cat', sinon.match({ params: ['/home/fluxadm/.ssh/authorized_keys'] }))
        .resolves({ ...cmdOk, stdout: 'ssh-ed25519 AAAA operator-own-key\n' });

      await fluxadmService.removeAccess();

      sinon.assert.neverCalledWith(runCommandStub, 'install');
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

    it('should reconcile user, sudoers, keys, sshd and firewall on a confirmed legacy node', async () => {
      testConfig.fluxadm.sshAuthorizedKeys = testKeys;
      sinon.stub(benchmarkService, 'getBenchmarks').resolves({ status: 'success', data: { systemsecure: false } });
      sinon.stub(fluxNetworkHelper, 'isFirewallActive').resolves(true);
      sinon.stub(fs, 'mkdtemp').resolves('/tmp/fluxadm-test');
      sinon.stub(fs, 'writeFile').resolves();
      sinon.stub(fs, 'rm').resolves();
      sinon.stub(fs, 'access').resolves();
      sinon.stub(fs, 'readFile')
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
