/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */
const chai = require('chai');
const natUpnp = require('@runonflux/nat-upnp');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const log = require('../../ZelBack/src/lib/log');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const ufw = require('../../ZelBack/src/services/utils/ufw');
const ufwHelper = require('../../ZelBack/src/services/utils/ufwHelper');

const ufwRun = (args) => sinon.match({ runAsRoot: true, params: [ufw.UFW_HELPER, '--wait', '30', '--command', JSON.stringify(args)] });
// The ufw commands each batch handed to the helper.
const batches = (stub) => stub.getCalls()
  .filter((call) => call.args[0] === 'python3' && call.args[1].params.includes('--keep-outbound'))
  .map((call) => ({ commands: JSON.parse(call.args[1].params[call.args[1].params.indexOf('--rules') + 1]), options: call.args[1] }));

const { expect } = chai;

const config = {
  apiport: '5550',
};

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

const fluxadmPortStub = {
  isArcane: false,
  sshPortFor: (apiPort) => +apiPort - 5,
  sshdSocket: 'fluxadm-sshd.socket',
};

const upnpService = proxyquire(
  '../../ZelBack/src/services/upnpService',
  { config, './fluxadmPort': fluxadmPortStub },
);

describe('upnpService tests', () => {
  describe('adjustFirewallForUPNP tests', () => {
    let originalUserConfig;

    beforeEach(() => {
      // The installed copy of the ufw helper is the one to run (utils/ufwHelper has its own tests).
      sinon.stub(ufwHelper, 'path').resolves(ufwHelper.UFW_HELPER);
      originalUserConfig = globalThis.userconfig;
      globalThis.userconfig = { initial: { ...originalUserConfig.initial, routerIP: '192.168.1.1' } };
    });

    afterEach(() => {
      globalThis.userconfig = originalUserConfig;
      sinon.restore();
    });

    it('should allow UDP in from the router and write no outbound rule, in one bounded ufw batch', async () => {
      const runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: '{"removed": 0, "applied": true, "failed": [], "reason": null}\n', stderr: '' });
      runCommandStub.withArgs('python3', ufwRun(['status'])).resolves({ error: null, stdout: 'Status: active\n', stderr: '' });

      await upnpService.adjustFirewallForUPNP();

      const sent = batches(runCommandStub);
      expect(sent).to.have.lengthOf(1);
      const params = sent[0].commands.map((command) => command.join(' '));
      expect(params).to.include('prepend allow from 192.168.1.1 to any proto udp');
      expect(params).to.include('prepend allow in proto tcp from any to 192.168.1.1 port 16137');
      expect(params.filter((rule) => /\bout\b/.test(rule))).to.deep.equal([]);
      expect(sent[0].options).to.include({ runAsRoot: true, timeout: 60000 });
    });

    it('should log each rule ufw refused', async () => {
      const failed = [{ rule: 'prepend allow from 192.168.1.1 to any proto udp', error: 'ERROR: Bad rule' }];
      const runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: `${JSON.stringify({ removed: 0, applied: true, failed, reason: null })}\n`, stderr: '' });
      runCommandStub.withArgs('python3', ufwRun(['status'])).resolves({ error: null, stdout: 'Status: active\n', stderr: '' });
      const warnSpy = sinon.spy(log, 'warn');

      await upnpService.adjustFirewallForUPNP();

      sinon.assert.calledWith(warnSpy, 'Firewall rule not applied for UPNP: ufw prepend allow from 192.168.1.1 to any proto udp: ERROR: Bad rule');
    });

    it('should stop when ufw is locked by another ufw command', async () => {
      const runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: Object.assign(new Error('killed'), { killed: true }), stdout: '', stderr: '' });
      runCommandStub.withArgs('python3', ufwRun(['status'])).resolves({ error: null, stdout: 'Status: active\n', stderr: '' });
      const errorSpy = sinon.spy(log, 'error');

      await upnpService.adjustFirewallForUPNP();

      expect(batches(runCommandStub)).to.have.lengthOf(1);
      sinon.assert.calledWith(errorSpy, 'Firewall not adjusted for UPNP: ufw is locked by another ufw command');
    });
  });

  describe('verifyUPNPsupport tests', () => {
    let logSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if all client responses are valid', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should log a proper error if getPublicIp throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').throws();
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get public ip');
    });

    it('should log a proper error if getGateway throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').throws();
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get Gateway');
    });

    it('should log a proper error if createMapping throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').throws();
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed Create Mapping');
    });

    it('should log a proper error if getMappings throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').throws();
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get Mappings');
    });

    it('should log a proper error if removeMapping throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMappings').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').throws();

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed Remove Mapping');
    });
  });

  describe('setupUPNP tests', () => {
    let logSpy;
    let createMappingSpy;
    let getMappingsStub;
    let removeMappingStub;
    let unitStateStub;

    // What `systemctl is-enabled fluxadm-sshd.socket` prints, and whether it failed.
    const sshdSocket = (stdout, error = null) => unitStateStub.resolves({ error, stdout, stderr: '' });

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
      unitStateStub = sinon.stub(serviceHelper, 'runCommand')
        .withArgs('systemctl', sinon.match({ params: ['is-enabled', 'fluxadm-sshd.socket'] }));
      sshdSocket('disabled\n');
      createMappingSpy = sinon.stub(natUpnp.Client.prototype, 'createMapping');
      getMappingsStub = sinon.stub(natUpnp.Client.prototype, 'getMappings').resolves([]);
      removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
    });

    afterEach(() => {
      fluxadmPortStub.isArcane = false;
      sinon.restore();
    });

    const fluxadmMapping = (overrides = {}) => ({
      public: { host: '', port: 118 },
      private: { host: '192.168.1.10', port: 118 },
      protocol: 'tcp',
      description: 'Flux_Fluxadm_SSH',
      ttl: 0,
      local: true,
      ...overrides,
    });

    async function runSetup(apiport) {
      const clock = sinon.useFakeTimers();
      const promise = upnpService.setupUPNP(apiport);
      await clock.tickAsync(2_000);
      return promise;
    }

    it('should map the maintenance ssh port beside the core ports while its socket is enabled', async () => {
      createMappingSpy.returns(true);
      sshdSocket('enabled\n');

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.callCount(createMappingSpy, 5);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 118, private: 118, ttl: 0, description: 'Flux_Fluxadm_SSH',
      });
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should remove its own maintenance ssh mapping while its socket is not enabled', async () => {
      createMappingSpy.returns(true);
      getMappingsStub.resolves([fluxadmMapping()]);

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.callCount(createMappingSpy, 4);
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: 118, protocol: 'TCP' });
    });

    it('should remove its own maintenance ssh mapping once its socket is gone, or systemctl cannot answer', async () => {
      createMappingSpy.returns(true);
      getMappingsStub.resolves([fluxadmMapping()]);
      sshdSocket('', new Error('Failed to get unit file state for fluxadm-sshd.socket: No such file or directory'));

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.callCount(createMappingSpy, 4);
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: 118, protocol: 'TCP' });
    });

    it('should keep a mapping of the same port that it did not make', async () => {
      createMappingSpy.returns(true);
      getMappingsStub.resolves([
        fluxadmMapping({ description: 'node owner ssh' }),
        fluxadmMapping({ local: false }),
      ]);

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.calledOnce(getMappingsStub);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should neither map nor unmap the maintenance ssh port on ArcaneOS', async () => {
      createMappingSpy.returns(true);
      fluxadmPortStub.isArcane = true;
      sshdSocket('enabled\n');
      getMappingsStub.resolves([fluxadmMapping()]);

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.callCount(createMappingSpy, 4);
      sinon.assert.notCalled(getMappingsStub);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should still report the core ports mapped when the maintenance ssh mapping fails', async () => {
      createMappingSpy.returns(true);
      createMappingSpy.withArgs(sinon.match({ description: 'Flux_Fluxadm_SSH' })).rejects(new Error('conflict'));
      sshdSocket('enabled\n');

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.callCount(createMappingSpy, 5);
      sinon.assert.calledOnce(logSpy);
    });

    it('should return true if all client responses are valid', async () => {
      createMappingSpy.returns(true);

      const clock = sinon.useFakeTimers();

      const promise = upnpService.setupUPNP(123);

      await clock.tickAsync(2_000);
      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.callCount(createMappingSpy, 4);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 123, private: 123, ttl: 0, description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 124, private: 124, ttl: 0, description: 'Flux_Backend_API_SSL',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 122, private: 122, ttl: 0, description: 'Flux_Home_UI',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 125, private: 125, ttl: 0, description: 'Flux_Syncthing',
      });
    });

    it('should return true if all client responses are valid, no parameter passed', async () => {
      createMappingSpy.returns(true);

      const clock = sinon.useFakeTimers();

      const promise = upnpService.setupUPNP();

      await clock.tickAsync(2_000);
      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.callCount(createMappingSpy, 4);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 16127, private: 16127, ttl: 0, description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 16128, private: 16128, ttl: 0, description: 'Flux_Backend_API_SSL',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 16126, private: 16126, ttl: 0, description: 'Flux_Home_UI',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 16129, private: 16129, ttl: 0, description: 'Flux_Syncthing',
      });
    });

    it('should return error if client response throws', async () => {
      createMappingSpy.throws();

      const clock = sinon.useFakeTimers();

      const promise = upnpService.setupUPNP(123);

      await clock.tickAsync(2_000);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logSpy);
    });
  });

  describe('mapUpnpPort tests', () => {
    let logSpy;
    let createMappingSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
      createMappingSpy = sinon.stub(natUpnp.Client.prototype, 'createMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if all client responses are valid', async () => {
      createMappingSpy.returns(true);

      const clock = sinon.useFakeTimers();

      const promise = upnpService.mapUpnpPort(123, 'some description');

      await clock.tickAsync(1_000);
      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledTwice(createMappingSpy);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 123,
        private: 123,
        ttl: 0,
        protocol: 'TCP',
        description: 'some description',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 123,
        private: 123,
        ttl: 0,
        protocol: 'UDP',
        description: 'some description',
      });
    });

    it('should return error if client response throws', async () => {
      createMappingSpy.throws();

      const clock = sinon.useFakeTimers();

      const promise = upnpService.mapUpnpPort(123);

      await clock.tickAsync(1_000);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logSpy);
    });
  });

  describe('removeMapUpnpPort tests', () => {
    let logSpy;
    let removeMappingSpy;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
      removeMappingSpy = sinon.stub(natUpnp.Client.prototype, 'removeMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if all client responses are valid', async () => {
      removeMappingSpy.returns(true);

      const clock = sinon.useFakeTimers();

      const promise = upnpService.removeMapUpnpPort(123, 'some description');

      await clock.tickAsync(1_000);
      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledTwice(removeMappingSpy);
      sinon.assert.calledWithExactly(removeMappingSpy, { public: 123, protocol: 'TCP' });
      sinon.assert.calledWithExactly(removeMappingSpy, { public: 123, protocol: 'UDP' });
    });

    it('should return error if client response throws', async () => {
      removeMappingSpy.throws();

      const clock = sinon.useFakeTimers();

      const promise = upnpService.removeMapUpnpPort(123);

      await clock.tickAsync(1_000);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledOnce(logSpy);
    });
  });

  describe('removeStaleMappings tests', () => {
    let getMappingsStub;
    let removeMappingStub;
    let clock;

    const mapping = (port, description, overrides = {}) => ({
      public: { host: '', port },
      private: { host: '192.168.1.10', port },
      protocol: 'tcp',
      enabled: true,
      description,
      ttl: 0,
      local: true,
      ...overrides,
    });

    // Two sweeps far enough apart for a stale mapping to be taken on the second.
    async function sweepTwice(keepPorts) {
      await upnpService.removeStaleMappings(keepPorts);
      clock.tick(31 * 60 * 1000);
      return upnpService.removeStaleMappings(keepPorts);
    }

    beforeEach(() => {
      upnpService.staleMappingsSeen.clear();
      clock = sinon.useFakeTimers();
      sinon.stub(serviceHelper, 'delay').resolves();
      getMappingsStub = sinon.stub(natUpnp.Client.prototype, 'getMappings');
      removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
    });

    afterEach(() => {
      fluxadmPortStub.isArcane = false;
      sinon.restore();
    });

    it('should ask only for the mappings to this node', async () => {
      getMappingsStub.resolves([]);

      await upnpService.removeStaleMappings([16127]);

      sinon.assert.calledOnceWithExactly(getMappingsStub, { local: true });
    });

    it('should only note a stale mapping on the first sweep that finds it', async () => {
      getMappingsStub.resolves([mapping(31000, 'Flux_App_gone')]);

      const removed = await upnpService.removeStaleMappings([16127]);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should remove a stale mapping found again on a sweep at least 30 minutes later, by its own protocol', async () => {
      getMappingsStub.resolves([mapping(31000, 'Flux_App_gone', { protocol: 'udp' })]);

      const removed = await sweepTwice([16127]);

      expect(removed).to.equal(1);
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: { host: '', port: 31000 }, protocol: 'UDP' });
      expect(upnpService.staleMappingsSeen.size).to.equal(0);
    });

    it('should not remove a stale mapping found again sooner than 30 minutes later', async () => {
      getMappingsStub.resolves([mapping(31000, 'Flux_App_gone')]);

      await upnpService.removeStaleMappings([16127]);
      clock.tick(29 * 60 * 1000);
      const removed = await upnpService.removeStaleMappings([16127]);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should start over a mapping that was missing from a sweep in between', async () => {
      getMappingsStub.resolves([mapping(31000, 'Flux_Test_App')]);
      await upnpService.removeStaleMappings([16127]);
      clock.tick(31 * 60 * 1000);
      getMappingsStub.resolves([]);
      await upnpService.removeStaleMappings([16127]);
      getMappingsStub.resolves([mapping(31000, 'Flux_Test_App')]);
      clock.tick(31 * 60 * 1000);

      const removed = await upnpService.removeStaleMappings([16127]);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should keep every mapping on a port something holds, whatever its description', async () => {
      getMappingsStub.resolves([mapping(16127, 'Flux_Backend_API'), mapping(31000, 'Flux_App_other')]);

      const removed = await sweepTwice([16127, 31000]);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should remove the core mappings of an api port the node no longer uses', async () => {
      getMappingsStub.resolves([
        mapping(16127, 'Flux_Backend_API'),
        mapping(16128, 'Flux_Backend_API_SSL'),
        mapping(16126, 'Flux_Home_UI'),
        mapping(16129, 'Flux_Syncthing'),
        mapping(16137, 'Flux_Backend_API'),
      ]);

      const removed = await sweepTwice([16132, 16136, 16137, 16138, 16139]);

      expect(removed).to.equal(4);
      expect(removeMappingStub.getCalls().map((call) => call.args[0].public.port)).to.deep.equal([16127, 16128, 16126, 16129]);
    });

    it('should never touch a mapping to another address, the operator\'s manual entries or anything it did not make', async () => {
      getMappingsStub.resolves([
        mapping(31000, 'Flux_App_sibling', { local: false, private: { host: '192.168.1.11', port: 31000 } }),
        mapping(31001, 'Flux_manual_entry'),
        mapping(22, 'ssh'),
        mapping(31002, undefined),
        mapping(31003, 'Flux_A'),
      ]);

      const removed = await sweepTwice([16127]);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should leave ArcaneOS\'s own maintenance ssh mapping alone', async () => {
      fluxadmPortStub.isArcane = true;
      getMappingsStub.resolves([mapping(16100, 'Flux_Fluxadm_SSH')]);

      const removed = await sweepTwice([16127]);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should go on past a removal the router refuses, and try it again on the next sweep', async () => {
      getMappingsStub.resolves([mapping(31000, 'Flux_App_a'), mapping(31001, 'Flux_Prelaunch_App_31001')]);
      removeMappingStub.onFirstCall().rejects(new Error('ActionFailed'));
      const warnSpy = sinon.spy(log, 'warn');

      const removed = await sweepTwice([16127]);

      expect(removed).to.equal(1);
      sinon.assert.calledTwice(removeMappingStub);
      sinon.assert.calledOnce(warnSpy);

      clock.tick(60 * 60 * 1000);
      getMappingsStub.resolves([mapping(31000, 'Flux_App_a')]);
      expect(await upnpService.removeStaleMappings([16127])).to.equal(1);
    });

    it('should reject when the router\'s mappings cannot be listed', async () => {
      getMappingsStub.rejects(new Error('Incorrect response'));

      let error;
      await upnpService.removeStaleMappings([16127]).catch((err) => { error = err; });

      expect(error.message).to.equal('Incorrect response');
      sinon.assert.notCalled(removeMappingStub);
    });
  });

  describe('mapPortApi tests', () => {
    let verifyPrivilegeStub;
    let createMappingSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      createMappingSpy = sinon.stub(natUpnp.Client.prototype, 'createMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.mapPortApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should throw error if port is null', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: null,
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.mapPortApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Port address specified.',
        },
      });
    });

    it('should throw error if port is undefined', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.mapPortApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Port address specified.',
        },
      });
    });

    it('should show a proper message if port is given in the params', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.mapPortApi(req, res);

      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 1234,
        private: 1234,
        ttl: 0,
        protocol: 'TCP',
        description: 'Flux_manual_entry',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 1234,
        private: 1234,
        ttl: 0,
        protocol: 'UDP',
        description: 'Flux_manual_entry',
      });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Port mapped' },
      });
    });

    it('should show a proper message if port is given in the query', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        query: {
          port: '1234',
        },
        params: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.mapPortApi(req, res);
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 1234,
        private: 1234,
        ttl: 0,
        protocol: 'TCP',
        description: 'Flux_manual_entry',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 1234,
        private: 1234,
        ttl: 0,
        protocol: 'UDP',
        description: 'Flux_manual_entry',
      });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Port mapped' },
      });
    });
  });

  describe('removeMapPortApi tests', () => {
    let verifyPrivilegeStub;
    let removeMappingSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      removeMappingSpy = sinon.stub(natUpnp.Client.prototype, 'removeMapping');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.removeMapPortApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should throw error if port is null', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: null,
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.removeMapPortApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Port address specified.',
        },
      });
    });

    it('should throw error if port is undefined', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.removeMapPortApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No Port address specified.',
        },
      });
    });

    it('should show a proper message if port is given in the params', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.removeMapPortApi(req, res);

      sinon.assert.calledWithExactly(removeMappingSpy, {
        public: 1234,
        protocol: 'UDP',
      });
      sinon.assert.calledWithExactly(removeMappingSpy, {
        public: 1234,
        protocol: 'TCP',
      });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Port unmapped' },
      });
    });

    it('should show a proper message if port is given in the query', async () => {
      verifyPrivilegeStub.resolves(true);
      const req = {
        query: {
          port: '1234',
        },
        params: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.removeMapPortApi(req, res);

      sinon.assert.calledWithExactly(removeMappingSpy, {
        public: 1234,
        protocol: 'TCP',
      });
      sinon.assert.calledWithExactly(removeMappingSpy, {
        public: 1234,
        protocol: 'UDP',
      });
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'Port unmapped' },
      });
    });
  });

  describe('getMapApi tests', () => {
    let verifyPrivilegeStub;
    let getMappingsSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      getMappingsSpy = sinon.stub(natUpnp.Client.prototype, 'getMappings');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.getMapApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if getMappings throws', async () => {
      getMappingsSpy.throws();
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getMapApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'Error' },
      });
    });

    it('should show a proper message if all data is valid', async () => {
      getMappingsSpy.resolves({
        data: 'data1',
      });
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getMapApi(req, res);

      sinon.assert.calledOnce(getMappingsSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: { data: 'data1' } });
    });
  });

  describe('getIpApi tests', () => {
    let verifyPrivilegeStub;
    let getPublicIpSpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      getPublicIpSpy = sinon.stub(natUpnp.Client.prototype, 'getPublicIp');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.getIpApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if getMappings throws', async () => {
      getPublicIpSpy.throws();
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getIpApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'Error' },
      });
    });

    it('should show a proper message if all data is valid', async () => {
      getPublicIpSpy.resolves('192.169.1.1');
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getIpApi(req, res);

      sinon.assert.calledOnce(getPublicIpSpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: '192.169.1.1' });
    });
  });

  describe('getGatewayApi tests', () => {
    let verifyPrivilegeStub;
    let getGatewaySpy;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      getGatewaySpy = sinon.stub(natUpnp.Client.prototype, 'getGateway');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should create error message if user does not have proper access', async () => {
      verifyPrivilegeStub.resolves(false);
      const res = generateResponse();

      await upnpService.getGatewayApi(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });

    it('should create error message if getMappings throws', async () => {
      getGatewaySpy.throws();
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          test: 'test2',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getGatewayApi(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: 'Error', message: 'Error' },
      });
    });

    it('should show a proper message if all data is valid', async () => {
      getGatewaySpy.resolves('10.1.1.1');
      verifyPrivilegeStub.resolves(true);
      const req = {
        params: {
          port: '1234',
        },
        query: {
          test: 'test',
        },
      };
      const res = generateResponse();

      await upnpService.getGatewayApi(req, res);

      sinon.assert.calledOnce(getGatewaySpy);
      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: '10.1.1.1' });
    });
  });
});
