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

// A router's refusal as nat-upnp 1.x rejects it: an HTTP 500 with the SOAP fault in the body.
const soapFault = (code, description) => {
  const error = new Error('Request failed with status code 500');
  error.response = {
    status: 500,
    data: `<?xml version="1.0"?><s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode>`
      + `<errorDescription>${description}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`,
  };
  return error;
};
// The router's answer to GetSpecificPortMappingEntry.
const entryFor = (internalClient, port, enabled = '1') => ({
  GetSpecificPortMappingEntryResponse: { NewInternalClient: internalClient, NewInternalPort: String(port), NewEnabled: enabled },
});
// The gateway as nat-upnp 1.x hands it over, this node at 192.168.1.10.
const stubGateway = (run) => sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves({ gateway: { run }, address: '192.168.1.10' });

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

    it('should hold the test port from the time it is mapped until it is removed, so a cleanup pass cannot take it mid-test', async () => {
      upnpService.mappedHere.clear();
      const heldAt = {};
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'createMapping').callsFake(async () => { heldAt.create = upnpService.mappedHere.has(16130); });
      sinon.stub(natUpnp.Client.prototype, 'getMappings').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').callsFake(async () => { heldAt.remove = upnpService.mappedHere.has(16130); });

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport(16127);

      await clock.tickAsync(2_500);

      expect(await promise).to.equal(true);
      expect(heldAt).to.deep.equal({ create: true, remove: true });
      expect(upnpService.mappedHere.has(16130)).to.equal(false);
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
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get public ip: Error');
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
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get Gateway: Error');
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
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed Create Mapping: Error');
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
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get Mappings: Error');
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
      sinon.assert.calledOnce(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed Remove Mapping: Error');
    });

    it('should make room when the router refuses its test mapping: remove the test mappings earlier starts left, then ask again', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves('1.2.3.4');
      sinon.stub(natUpnp.Client.prototype, 'getMappings').resolves([]);
      const createStub = sinon.stub(natUpnp.Client.prototype, 'createMapping');
      createStub.onFirstCall().rejects(soapFault(728, 'NoPortMapsAvailable'));
      createStub.resolves();
      const removeStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
      const table = [
        ['192.168.1.10', 41713, 'TCP', 'Flux_Test_App'],
        ['192.168.1.10', 30001, 'TCP', 'Flux_App_kept'],
        ['192.168.1.11', 39988, 'TCP', 'Flux_Test_App'],
        ['192.168.1.10', 52217, 'UDP', 'Flux_Prelaunch_App_52217'],
      ];
      const run = sinon.stub().callsFake(async (action, args) => {
        if (action === 'GetSpecificPortMappingEntry') throw soapFault(714, 'NoSuchEntryInArray');
        const index = args[0][1];
        if (index >= table.length) throw soapFault(713, 'SpecifiedArrayIndexInvalid');
        const [internalClient, port, protocol, description] = table[index];
        return {
          GetGenericPortMappingEntryResponse: {
            NewRemoteHost: '', NewExternalPort: String(port), NewProtocol: protocol, NewInternalClient: internalClient, NewInternalPort: String(port), NewPortMappingDescription: description,
          },
        };
      });
      stubGateway(run);

      const clock = sinon.useFakeTimers();
      const promise = upnpService.verifyUPNPsupport(16127);
      await clock.tickAsync(10_000);
      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.calledTwice(createStub);
      // this node's test mappings go; its app's and another machine's stay
      sinon.assert.calledWithExactly(removeStub, { public: { host: '', port: 41713 }, protocol: 'TCP' });
      sinon.assert.calledWithExactly(removeStub, { public: { host: '', port: 52217 }, protocol: 'UDP' });
      sinon.assert.neverCalledWithMatch(removeStub, { public: { port: 30001 } });
      sinon.assert.neverCalledWithMatch(removeStub, { public: { port: 39988 } });
    });

    it('should go on when the refused test mapping is one an earlier start left for this node', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves('1.2.3.4');
      sinon.stub(natUpnp.Client.prototype, 'getMappings').resolves([]);
      const createStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').rejects(soapFault(718, 'ConflictInMappingEntry'));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
      stubGateway(sinon.stub().resolves(entryFor('192.168.1.10', 16130)));

      const clock = sinon.useFakeTimers();
      const promise = upnpService.verifyUPNPsupport(16127);
      await clock.tickAsync(10_000);

      expect(await promise).to.equal(true);
      sinon.assert.calledOnce(createStub);
    });

    it('should still fail when the router refuses and nothing can be removed', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves('1.2.3.4');
      sinon.stub(natUpnp.Client.prototype, 'getMappings').resolves([]);
      sinon.stub(natUpnp.Client.prototype, 'createMapping').rejects(soapFault(728, 'NoPortMapsAvailable'));
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
      stubGateway(sinon.stub().rejects(soapFault(713, 'SpecifiedArrayIndexInvalid')));

      const clock = sinon.useFakeTimers();
      const promise = upnpService.verifyUPNPsupport(16127);
      await clock.tickAsync(10_000);

      expect(await promise).to.equal(false);
      sinon.assert.calledOnceWithExactly(logSpy, 'VerifyUPNPsupport - Failed Create Mapping: UPnP error 728 NoPortMapsAvailable (HTTP 500)');
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
      stubGateway(sinon.stub().rejects(soapFault(714, 'NoSuchEntryInArray')));
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

    it('should take a core port the router refuses but already maps to this node as mapped', async () => {
      natUpnp.Client.prototype.getGateway.restore();
      stubGateway(sinon.stub().callsFake(async (action, args) => entryFor('192.168.1.10', args[1][1])));
      createMappingSpy.returns(true);
      createMappingSpy.withArgs(sinon.match({ description: 'Flux_Backend_API' })).rejects(soapFault(728, 'NoPortMapsAvailable'));

      const clock = sinon.useFakeTimers();
      const promise = upnpService.setupUPNP(16127);
      await clock.tickAsync(5_000);
      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
    });
  });

  describe('mapUpnpPort tests', () => {
    let logSpy;
    let createMappingSpy;

    let runStub;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
      createMappingSpy = sinon.stub(natUpnp.Client.prototype, 'createMapping');
      runStub = sinon.stub().rejects(soapFault(714, 'NoSuchEntryInArray'));
      stubGateway(runStub);
    });

    async function runMap(port) {
      const clock = sinon.useFakeTimers();
      const promise = upnpService.mapUpnpPort(port, 'Flux_App_test');
      await clock.tickAsync(3_000);
      const result = await promise;
      clock.restore();
      return result;
    }

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

    it('should log the router\'s UPnP code, and keep it as the port\'s reason for an install to report', async () => {
      createMappingSpy.rejects(soapFault(728, 'NoPortMapsAvailable'));

      expect(await runMap(123)).to.equal(false);
      sinon.assert.calledOnceWithExactly(logSpy, 'UPnP - TCP 123 not mapped: UPnP error 728 NoPortMapsAvailable (HTTP 500)');
      expect(upnpService.getMapFailureReason(123)).to.equal('UPnP - TCP 123 not mapped: UPnP error 728 NoPortMapsAvailable (HTTP 500)');
      expect(upnpService.getMapFailureReason(124)).to.equal('');
    });

    it('should take a refused mapping the router already holds for this node as mapped', async () => {
      createMappingSpy.rejects(soapFault(718, 'ConflictInMappingEntry'));
      runStub.resolves(entryFor('192.168.1.10', 123));

      expect(await runMap(123)).to.equal(true);
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledWith(runStub, 'GetSpecificPortMappingEntry', [['NewRemoteHost', ''], ['NewExternalPort', '123'], ['NewProtocol', 'TCP']]);
    });

    it('should not take a refused mapping held for another machine, or switched off, as mapped', async () => {
      createMappingSpy.rejects(soapFault(718, 'ConflictInMappingEntry'));
      runStub.resolves(entryFor('192.168.1.11', 123));
      expect(await runMap(123)).to.equal(false);

      runStub.resolves(entryFor('192.168.1.10', 123, '0'));
      expect(await runMap(123)).to.equal(false);
    });

    it('should stop holding a port it failed to map, so the cleanup can take what the router kept', async () => {
      createMappingSpy.withArgs(sinon.match({ protocol: 'TCP' })).resolves();
      createMappingSpy.withArgs(sinon.match({ protocol: 'UDP' })).rejects(soapFault(728, 'NoPortMapsAvailable'));

      expect(await runMap(41713)).to.equal(false);
      expect(upnpService.mappedHere.has(41713)).to.equal(false);
    });

    it('should give up on a router that never answers', async () => {
      createMappingSpy.returns(new Promise(() => {}));
      runStub.returns(new Promise(() => {}));

      const clock = sinon.useFakeTimers();
      const promise = upnpService.mapUpnpPort(123, 'Flux_App_test');
      await clock.tickAsync(40_000);

      expect(await promise).to.equal(false);
      sinon.assert.calledOnceWithMatch(logSpy, /^UPnP - TCP 123 not mapped: mapping TCP 123: the router did not answer within 15s$/);
    });
  });

  describe('describeUpnpError tests', () => {
    it('should name the UPnP code and the router\'s wording from a 1.x SOAP fault', () => {
      const error = soapFault(718, 'ConflictInMappingEntry');

      expect(upnpService.describeUpnpError(error)).to.equal('UPnP error 718 ConflictInMappingEntry (HTTP 500)');
      expect(upnpService.upnpErrorCode(error)).to.equal(718);
    });

    it('should read the code 2.x throws, and its message', () => {
      const error = new Error('UPnP error 728: NoPortMapsAvailable (action: AddPortMapping)');
      error.code = 728;

      expect(upnpService.upnpErrorCode(error)).to.equal(728);
      expect(upnpService.describeUpnpError(error)).to.equal('UPnP error 728: NoPortMapsAvailable (action: AddPortMapping)');
    });

    it('should fall back to the message when the failure carried no code', () => {
      const error = new Error('socket hang up');
      error.code = 'ECONNRESET';

      expect(upnpService.describeUpnpError(error)).to.equal('socket hang up');
      expect(upnpService.upnpErrorCode(error)).to.equal(null);
    });
  });

  describe('mappingOwner tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should ask 2.x for the local address it no longer hands over', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves({
        gateway: { run: sinon.stub().resolves(entryFor('192.168.1.10', 123)) },
        getLocalAddress: sinon.stub().resolves('192.168.1.10'),
      });

      expect(await upnpService.mappingOwner(123, 'TCP')).to.equal('here');
    });

    it('should read fields 2.x\'s parser wraps', async () => {
      stubGateway(sinon.stub().resolves({
        GetSpecificPortMappingEntryResponse: { NewInternalClient: { '#text': '192.168.1.10' }, NewInternalPort: 123, NewEnabled: 1 },
      }));

      expect(await upnpService.mappingOwner(123, 'TCP')).to.equal('here');
    });

    it('should tell no mapping from a router that could not be asked', async () => {
      stubGateway(sinon.stub().rejects(soapFault(714, 'NoSuchEntryInArray')));
      expect(await upnpService.mappingOwner(123, 'TCP')).to.equal('none');

      natUpnp.Client.prototype.getGateway.restore();
      stubGateway(sinon.stub().rejects(new Error('socket hang up')));
      expect(await upnpService.mappingOwner(123, 'TCP')).to.equal('unknown');
    });
  });

  describe('device description fetch tests', () => {
    // eslint-disable-next-line global-require
    const axios = require('axios');
    const url = 'http://192.168.1.1:1900/gatedesc.xml';

    afterEach(() => {
      sinon.restore();
    });

    it('should fetch on a socket of its own, never a kept-alive one', async () => {
      const getStub = sinon.stub(axios, 'get').resolves({ data: '<?xml version="1.0"?><root><device><deviceType>x</deviceType></device></root>' });

      const parsed = await new natUpnp.Device(url).getXML(url);

      expect(parsed.root.device.deviceType).to.equal('x');
      expect(getStub.firstCall.args[1].httpAgent.keepAlive).to.equal(false);
    });

    it('should reject with the reason when the description cannot be read', async () => {
      sinon.stub(axios, 'get').rejects(new Error('socket hang up'));

      const result = await new natUpnp.Device(url).getXML(url).catch((error) => error);

      expect(result.message).to.equal(`UPnP - the router's device description at ${url} could not be read: socket hang up`);
    });

    it('should reject a reply that is not a device description', async () => {
      sinon.stub(axios, 'get').resolves({ data: '<html><body>login</body></html>' });

      const result = await new natUpnp.Device(url).getXML(url).catch((error) => error);

      expect(result.message).to.equal(`UPnP - ${url} is not a UPnP device description`);
    });

    it('should resolve a real router description through to the action it sends', async () => {
      sinon.stub(axios, 'get').resolves({
        data: '<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><URLBase>http://192.168.1.1:1900</URLBase><device>'
          + '<deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><deviceList><device>'
          + '<deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType><deviceList><device>'
          + '<deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType><serviceList><service>'
          + '<serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId>'
          + '<controlURL>/upnp/control/WANIPConn1</controlURL><eventSubURL>/upnp/event/WANIPConn1</eventSubURL><SCPDURL>/gateconnSCPD.xml</SCPDURL>'
          + '</service></serviceList></device></deviceList></device></deviceList></device></root>',
      });

      const service = await new natUpnp.Device(url).getService(['urn:schemas-upnp-org:service:WANIPConnection:1']);

      expect(service).to.deep.equal({
        service: 'urn:schemas-upnp-org:service:WANIPConnection:1',
        SCPDURL: 'http://192.168.1.1:1900/gateconnSCPD.xml',
        controlURL: 'http://192.168.1.1:1900/upnp/control/WANIPConn1',
      });
    });
  });

  describe('removeMapUpnpPort tests', () => {
    let logSpy;
    let removeMappingSpy;

    let runStub;

    beforeEach(() => {
      logSpy = sinon.spy(log, 'error');
      removeMappingSpy = sinon.stub(natUpnp.Client.prototype, 'removeMapping');
      runStub = sinon.stub().callsFake(async (action, args) => entryFor('192.168.1.10', args[1][1]));
      stubGateway(runStub);
    });

    async function runRemove(port) {
      const clock = sinon.useFakeTimers();
      const promise = upnpService.removeMapUpnpPort(port);
      await clock.tickAsync(3_000);
      const result = await promise;
      clock.restore();
      return result;
    }

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if all client responses are valid', async () => {
      removeMappingSpy.returns(true);

      const clock = sinon.useFakeTimers();

      const promise = upnpService.removeMapUpnpPort(123, 'some description');

      await clock.tickAsync(3_000);
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

      await clock.tickAsync(3_000);
      const result = await promise;

      expect(result).to.equal(false);
      // the UDP half is still tried when TCP is refused
      sinon.assert.calledTwice(removeMappingSpy);
      sinon.assert.calledTwice(logSpy);
    });

    it('should leave alone a mapping the router points at another machine', async () => {
      removeMappingSpy.resolves();
      runStub.callsFake(async (action, args) => (args[2][1] === 'UDP' ? entryFor('192.168.1.11', 123) : entryFor('192.168.1.10', 123)));

      expect(await runRemove(123)).to.equal(true);
      sinon.assert.calledOnceWithExactly(removeMappingSpy, { public: 123, protocol: 'TCP' });
    });

    it('should skip a mapping the router does not have, and count one gone by the time it is removed', async () => {
      removeMappingSpy.rejects(soapFault(714, 'NoSuchEntryInArray'));
      runStub.callsFake(async (action, args) => {
        if (args[2][1] === 'TCP') throw soapFault(714, 'NoSuchEntryInArray');
        return entryFor('192.168.1.10', 123);
      });

      expect(await runRemove(123)).to.equal(true);
      sinon.assert.calledOnceWithExactly(removeMappingSpy, { public: 123, protocol: 'UDP' });
      sinon.assert.notCalled(logSpy);
    });

    it('should still remove when the router cannot say who holds the port', async () => {
      removeMappingSpy.resolves();
      runStub.rejects(new Error('socket hang up'));

      expect(await runRemove(123)).to.equal(true);
      sinon.assert.calledTwice(removeMappingSpy);
    });
  });

  describe('msUntilCleanupSlot tests', () => {
    const at = (cycleOffsetMs) => 1_800_000_000_000 - (1_800_000_000_000 % (10 * 60 * 1000)) + cycleOffsetMs;

    it('should give each standard api port a slot of its own', () => {
      const slots = [16127, 16137, 16147, 16157, 16167, 16177, 16187, 16197]
        .map((apiport) => (upnpService.msUntilCleanupSlot(apiport, at(0))));

      expect(new Set(slots).size).to.equal(8);
      slots.forEach((ms) => expect(ms % upnpService.CLEANUP_SLOT_MS).to.equal(0));
    });

    it('should wait for the next start of the node\'s slot, never a slot already under way', () => {
      // 16127 holds the third slot, 150s into each 10-minute cycle
      expect(upnpService.msUntilCleanupSlot(16127, at(0))).to.equal(150 * 1000);
      expect(upnpService.msUntilCleanupSlot(16127, at(150 * 1000))).to.equal(0);
      expect(upnpService.msUntilCleanupSlot(16127, at(151 * 1000))).to.equal(599 * 1000);
    });
  });

  describe('removeStaleMappings tests', () => {
    const BUDGET_MS = 75 * 1000;
    let runStub;
    let removeMappingStub;
    let clock;
    let table;

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

    // the router's error reply to an index past the last entry
    const arrayIndexInvalid = () => Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } });
    const asEntry = (m) => ({
      GetGenericPortMappingEntryResponse: {
        NewRemoteHost: m.public.host,
        NewExternalPort: String(m.public.port),
        NewProtocol: m.protocol.toUpperCase(),
        NewInternalPort: String(m.private.port),
        NewInternalClient: m.private.host,
        NewEnabled: '1',
        NewPortMappingDescription: m.description,
        NewLeaseDuration: '0',
      },
    });
    const routerHas = (mappings) => { table = mappings; };

    beforeEach(() => {
      upnpService.mappedHere.clear();
      clock = sinon.useFakeTimers();
      sinon.stub(serviceHelper, 'delay').resolves();
      table = [];
      runStub = sinon.stub().callsFake(async (action, [[, index]]) => {
        if (index >= table.length) throw arrayIndexInvalid();
        return asEntry(table[index]);
      });
      sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves({ gateway: { run: runStub }, address: '192.168.1.10' });
      sinon.stub(natUpnp.Client.prototype, 'getMappings').rejects(new Error('the pass walks the table itself'));
      removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
    });

    afterEach(() => {
      fluxadmPortStub.isArcane = false;
      sinon.restore();
    });

    it('should walk the router\'s table one index at a time, up to the error reply that ends it', async () => {
      routerHas([mapping(31000, 'Flux_App_gone'), mapping(31001, 'Flux_App_sibling', { private: { host: '192.168.1.11', port: 31001 } })]);

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(runStub.getCalls().map((call) => [call.args[0], call.args[1][0][1]])).to.deep.equal([
        ['GetGenericPortMappingEntry', 0],
        ['GetGenericPortMappingEntry', 1],
        ['GetGenericPortMappingEntry', 2],
      ]);
      expect(removed).to.equal(1);
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: { host: '', port: 31000 }, protocol: 'TCP' });
    });

    it('should end the walk on the end-of-table code 2.x throws, which carries no HTTP reply', async () => {
      routerHas([mapping(31000, 'Flux_App_gone')]);
      runStub.callsFake(async (action, [[, index]]) => {
        if (index >= table.length) throw Object.assign(new Error('UPnP error 713: SpecifiedArrayIndexInvalid'), { code: 713 });
        return asEntry(table[index]);
      });

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(1);
    });

    it('should take an error reply at the first index for an empty table', async () => {
      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(0);
      sinon.assert.calledOnce(runStub);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should remove a stale mapping on the one pass, by its own protocol', async () => {
      routerHas([mapping(31000, 'Flux_App_gone', { protocol: 'udp' })]);

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(1);
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: { host: '', port: 31000 }, protocol: 'UDP' });
    });

    it('should keep every mapping on a port something holds, whatever its description', async () => {
      routerHas([mapping(16127, 'Flux_Backend_API'), mapping(31000, 'Flux_App_other')]);

      const removed = await upnpService.removeStaleMappings(async () => [16127, 31000], BUDGET_MS);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should remove the core mappings of an api port the node no longer uses', async () => {
      routerHas([
        mapping(16127, 'Flux_Backend_API'),
        mapping(16128, 'Flux_Backend_API_SSL'),
        mapping(16126, 'Flux_Home_UI'),
        mapping(16129, 'Flux_Syncthing'),
        mapping(16137, 'Flux_Backend_API'),
      ]);

      const removed = await upnpService.removeStaleMappings(async () => [16132, 16136, 16137, 16138, 16139], BUDGET_MS);

      expect(removed).to.equal(4);
      expect(removeMappingStub.getCalls().map((call) => call.args[0].public.port)).to.deep.equal([16127, 16128, 16126, 16129]);
    });

    it('should never touch a mapping to another address, the operator\'s manual entries or anything it did not make', async () => {
      routerHas([
        mapping(31000, 'Flux_App_sibling', { local: false, private: { host: '192.168.1.11', port: 31000 } }),
        mapping(31001, 'Flux_manual_entry'),
        mapping(22, 'ssh'),
        mapping(31002, undefined),
        mapping(31003, 'Flux_A'),
      ]);

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should leave ArcaneOS\'s own maintenance ssh mapping alone', async () => {
      fluxadmPortStub.isArcane = true;
      routerHas([mapping(16100, 'Flux_Fluxadm_SSH')]);

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should go on past a removal the router refuses', async () => {
      routerHas([mapping(31000, 'Flux_App_a'), mapping(31001, 'Flux_Prelaunch_App_31001')]);
      removeMappingStub.onFirstCall().rejects(new Error('ActionFailed'));
      const warnSpy = sinon.spy(log, 'warn');

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(1);
      sinon.assert.calledTwice(removeMappingStub);
      sinon.assert.calledOnce(warnSpy);
    });

    it('should reject, and remove nothing, when the router does not reply to the listing at all', async () => {
      routerHas([mapping(31000, 'Flux_App_gone'), mapping(31001, 'Flux_App_gone2')]);
      runStub.onSecondCall().rejects(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

      let error;
      await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS).catch((err) => { error = err; });

      expect(error.message).to.equal('socket hang up');
      sinon.assert.calledTwice(runStub);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should reject on a reply that is not a mapping entry', async () => {
      runStub.resolves({ SomethingElse: {} });

      let error;
      await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS).catch((err) => { error = err; });

      expect(error.message).to.equal('listing the mappings: incorrect response');
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should ask what is held only after the router has been listed', async () => {
      routerHas([mapping(31000, 'Flux_App_a')]);
      let requestsBeforeHeld;
      const held = sinon.stub().callsFake(async () => { requestsBeforeHeld = runStub.callCount; return [16127]; });

      await upnpService.removeStaleMappings(held, BUDGET_MS);

      expect(requestsBeforeHeld).to.equal(2);
      expect(runStub.callCount).to.equal(2);
    });

    it('should remove nothing when what is held cannot be read', async () => {
      routerHas([mapping(31000, 'Flux_App_gone')]);

      let error;
      await upnpService.removeStaleMappings(async () => { throw new Error('unreadable'); }, BUDGET_MS).catch((err) => { error = err; });

      expect(error.message).to.equal('unreadable');
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should not remove a port mapUpnpPort has mapped and nobody has unmapped', async () => {
      sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      await upnpService.mapUpnpPort(31000, 'Flux_Test_App');
      routerHas([mapping(31000, 'Flux_Test_App')]);

      const removed = await upnpService.removeStaleMappings(async () => [], BUDGET_MS);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should hold a port from the moment mapUpnpPort starts mapping it, before the router has answered', async () => {
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(new Promise(() => {}));
      upnpService.mapUpnpPort(31000, 'Flux_Test_App');
      routerHas([mapping(31000, 'Flux_Test_App')]);

      const removed = await upnpService.removeStaleMappings(async () => [], BUDGET_MS);

      expect(removed).to.equal(0);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should not remove a port mapUpnpPort maps while the pass is still at the ones before it', async () => {
      routerHas([mapping(31000, 'Flux_App_a'), mapping(31001, 'Flux_Test_App')]);
      removeMappingStub.onFirstCall().callsFake(async () => { upnpService.mappedHere.add(31001); });

      const removed = await upnpService.removeStaleMappings(async () => [], BUDGET_MS);

      expect(removed).to.equal(1);
      sinon.assert.calledOnce(removeMappingStub);
    });

    it('should remove a port mapUpnpPort mapped once removeMapUpnpPort has given it up, even if the router refused', async () => {
      sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      await upnpService.mapUpnpPort(31000, 'Flux_App_gone');
      removeMappingStub.onFirstCall().rejects(new Error('ActionFailed'));
      await upnpService.removeMapUpnpPort(31000);
      removeMappingStub.reset();
      removeMappingStub.resolves();
      routerHas([mapping(31000, 'Flux_App_gone')]);

      const removed = await upnpService.removeStaleMappings(async () => [], BUDGET_MS);

      expect(removed).to.equal(1);
      sinon.assert.calledOnce(removeMappingStub);
    });

    it('should send the router nothing more once a listing request goes unanswered', async () => {
      routerHas([mapping(31000, 'Flux_App_a'), mapping(31001, 'Flux_App_b')]);
      runStub.onSecondCall().returns(new Promise(() => {}));

      let error;
      const passing = upnpService.removeStaleMappings(async () => [], BUDGET_MS).catch((err) => { error = err; });
      await clock.tickAsync(BUDGET_MS);
      await passing;

      expect(error.message).to.match(/listing the mappings: the router did not answer within 15s/);
      sinon.assert.calledTwice(runStub);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should stop walking a slow router\'s table before the slot ends, and remove from what it listed', async () => {
      // 100 entries at 1s each would take 100s; the listing has 60s of the 75s slot
      routerHas(Array.from({ length: 100 }, (_, i) => mapping(31000 + i, `Flux_App_${i}`)));
      runStub.callsFake(async (action, args) => {
        await new Promise((resolve) => { setTimeout(resolve, 1000); });
        const [[, index]] = args;
        if (index >= table.length) throw arrayIndexInvalid();
        return asEntry(table[index]);
      });

      const passing = upnpService.removeStaleMappings(async () => [], BUDGET_MS);
      await clock.tickAsync(BUDGET_MS);
      const removed = await passing;

      // no request goes out after the listing's 60s: at most the one in flight at that moment
      expect(runStub.callCount).to.be.within(60, 61);
      expect(removed).to.equal(runStub.callCount);
      const requestsBySlotEnd = runStub.callCount;
      await clock.tickAsync(10 * 60 * 1000);
      expect(runStub.callCount).to.equal(requestsBySlotEnd);
    });

    it('should step past a refused removal but end the pass on one the router does not answer', async () => {
      routerHas([mapping(31000, 'Flux_App_a'), mapping(31001, 'Flux_App_b'), mapping(31002, 'Flux_App_c')]);
      removeMappingStub.onFirstCall().rejects(new Error('ActionFailed'));
      removeMappingStub.onSecondCall().returns(new Promise(() => {}));

      const passing = upnpService.removeStaleMappings(async () => [], BUDGET_MS);
      await clock.tickAsync(15 * 1000);
      const removed = await passing;

      expect(removed).to.equal(0);
      sinon.assert.calledTwice(removeMappingStub);
    });

    it('should stop removing once its budget is spent, and report what it did', async () => {
      routerHas([mapping(31000, 'Flux_App_a'), mapping(31001, 'Flux_App_b'), mapping(31002, 'Flux_App_c')]);
      removeMappingStub.callsFake(async () => { clock.tick(40 * 1000); });

      const removed = await upnpService.removeStaleMappings(async () => [], BUDGET_MS);

      sinon.assert.calledTwice(removeMappingStub);
      expect(removed).to.equal(2);
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
