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
const { upnp: { testMappingLeaseS: TEST_LEASE_S } } = require('config');

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

// the options each nat-upnp client was constructed with
const clientOptions = [];
class RecordingClient extends natUpnp.Client {
  constructor(options) {
    super(options);
    clientOptions.push(options);
  }
}
proxyquire(
  '../../ZelBack/src/services/upnpService',
  { config, './fluxadmPort': fluxadmPortStub, '@runonflux/nat-upnp': { ...natUpnp, Client: RecordingClient } },
);

const GATEWAY_URL = 'http://192.168.1.1:5000/rootDesc.xml';
const upnpServiceAtGatewayUrl = proxyquire(
  '../../ZelBack/src/services/upnpService',
  { config: { ...config, upnp: { gatewayUrl: GATEWAY_URL, nodeIp: '192.168.1.10' } }, './fluxadmPort': fluxadmPortStub },
);

describe('upnpService tests', () => {
  describe('client tests', () => {
    it('should keep the router it discovers between calls', () => {
      expect(clientOptions).to.deep.equal([{ cacheGateway: true }]);
    });
  });

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
    // what the router answers for the test mapping verifyUPNPsupport makes
    const testMapping = {
      public: { host: '', port: 16130 },
      private: { host: '192.168.1.10', port: 16130 },
      protocol: 'tcp',
      enabled: true,
      description: 'Flux_UPNP_Mapping_Test',
      ttl: 0,
      local: true,
    };

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
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(testMapping);
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
    });

    // The test mapping is made with a lease and read back: the router keeps the
    // lease, or shows the mapping as permanent - having refused the lease, or
    // dropped it without a word.
    describe('the lease of its test mapping', () => {
      let createMappingStub;
      const readBack = (ttl) => sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves({ ...testMapping, ttl });

      beforeEach(() => {
        sinon.stub(serviceHelper, 'delay').resolves();
        sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves(true);
        sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves(true);
        createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
        sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
      });

      it('should make its test mapping with a lease', async () => {
        readBack(598);

        await upnpService.verifyUPNPsupport();

        sinon.assert.calledOnceWithExactly(createMappingStub, {
          public: 16130, private: 16130, ttl: TEST_LEASE_S, protocol: 'TCP', description: 'Flux_UPNP_Mapping_Test',
        });
      });

      it('should know the router keeps a lease when the mapping reads back with one', async () => {
        readBack(598);

        expect(await upnpService.verifyUPNPsupport()).to.equal(true);

        expect(upnpService.routerLeases.kept).to.equal(true);
      });

      it('should know the router drops a lease when the mapping reads back permanent', async () => {
        readBack(0);

        expect(await upnpService.verifyUPNPsupport()).to.equal(true);

        expect(upnpService.routerLeases.kept).to.equal(false);
      });

      it('should verify, and know the router refuses a lease, when it maps the test only without one', async () => {
        createMappingStub.onFirstCall().rejects(new natUpnp.UpnpError(402, 'InvalidArgs', 'AddPortMapping'));
        readBack(0);

        expect(await upnpService.verifyUPNPsupport()).to.equal(true);

        expect(createMappingStub.getCalls().map((call) => call.args[0].ttl)).to.deep.equal([TEST_LEASE_S, 0]);
        expect(upnpService.routerLeases.kept).to.equal(false);
      });

      it('should ask the router again on every check, whatever an earlier one found', async () => {
        readBack(0);
        await upnpService.verifyUPNPsupport();
        natUpnp.Client.prototype.getMapping.resolves({ ...testMapping, ttl: 598 });
        createMappingStub.resetHistory();

        await upnpService.verifyUPNPsupport();

        expect(createMappingStub.firstCall.args[0].ttl).to.equal(TEST_LEASE_S);
        expect(upnpService.routerLeases.kept).to.equal(true);
      });

      it('should forget whether the router renews a lease on every check, so it is learned again', async () => {
        readBack(598);
        upnpService.routerLeases.renews = true;
        const { generation } = upnpService.routerLeases;

        await upnpService.verifyUPNPsupport();

        expect(upnpService.routerLeases.renews).to.equal(null);
        expect(upnpService.routerLeases.generation).to.equal(generation + 1);
      });
    });

    it('should not wait for a turn when the router has room for the test mapping', async () => {
      const delayStub = sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(testMapping);
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
      const getMappingsStub = sinon.stub(natUpnp.Client.prototype, 'getMappings').resolves([]);

      expect(await upnpService.verifyUPNPsupport(16177)).to.equal(true);

      expect(delayStub.getCalls().every((call) => call.args[0] < upnpService.BOOT_LISTING_STAGGER_MS)).to.equal(true);
      sinon.assert.notCalled(getMappingsStub);
    });

    it('should hold the test port from the time it is mapped until it is read back, so a cleanup pass cannot take it mid-test', async () => {
      upnpService.mappedHere.clear();
      const heldAt = {};
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'createMapping').callsFake(async () => { heldAt.create = upnpService.mappedHere.has(16130); });
      sinon.stub(natUpnp.Client.prototype, 'getMapping').callsFake(async () => { heldAt.readBack = upnpService.mappedHere.has(16130); return testMapping; });
      const removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport(16127);

      await clock.tickAsync(2_500);

      expect(await promise).to.equal(true);
      expect(heldAt).to.deep.equal({ create: true, readBack: true });
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: 16130, protocol: 'TCP' });
      expect(upnpService.mappedHere.has(16130)).to.equal(false);
    });

    it('should log a proper error if getPublicIp throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').throws();
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(testMapping);
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
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(testMapping);
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
      sinon.stub(natUpnp.Client.prototype, 'createMapping').rejects(new Error('connect ECONNREFUSED'));
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(testMapping);
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledOnceWithExactly(logSpy, 'VerifyUPNPsupport - Failed Create Mapping: TCP 16130 not mapped: connect ECONNREFUSED');
    });

    describe('when the router\'s table is full', () => {
      let createMappingStub;
      let getMappingsStub;
      let removeMappingStub;

      const listed = (port, description) => ({
        ...testMapping, public: { host: '', port }, private: { host: '192.168.1.10', port }, description,
      });
      const tableFull = () => new natUpnp.UpnpError(728, 'NoPortMapsAvailable', 'AddPortMapping');

      beforeEach(() => {
        upnpService.mappedHere.clear();
        sinon.stub(serviceHelper, 'delay').resolves();
        sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves('1.2.3.4');
        sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves(true);
        createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping');
        createMappingStub.onFirstCall().rejects(tableFull());
        createMappingStub.resolves();
        // the lookup after the refusal finds no entry; the one after the mapping finds it
        sinon.stub(natUpnp.Client.prototype, 'getMapping').onFirstCall().resolves(null).resolves(testMapping);
        getMappingsStub = sinon.stub(natUpnp.Client.prototype, 'getMappings').resolves([
          listed(31000, 'Flux_Test_App'),
          listed(31001, 'Flux_Prelaunch_App_31001'),
          listed(31002, 'Flux_App_web'),
          listed(31003, 'Flux_Backend_API'),
          // this check's own, held while it runs
          listed(16130, 'Flux_UPNP_Mapping_Test'),
        ]);
        removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
      });

      it('should remove the test mappings earlier runs left, and nothing else, then map once more', async () => {
        // the api port mapped here too: a test mapped on the retry is still checked and removed
        natUpnp.Client.prototype.getMapping.withArgs({ public: 16127, protocol: 'TCP' }).resolves({
          ...testMapping, public: { host: '', port: 16127 }, private: { host: '192.168.1.10', port: 16127 },
        });

        const result = await upnpService.verifyUPNPsupport();

        expect(result).to.equal(true);
        sinon.assert.calledOnceWithExactly(getMappingsStub, { local: true, signal: sinon.match.instanceOf(AbortSignal) });
        const removedPorts = removeMappingStub.getCalls().map((call) => call.args[0].public.port ?? call.args[0].public);
        expect(removedPorts).to.deep.equal([31000, 31001, 16130]);
        sinon.assert.calledTwice(createMappingStub);
      });

      it('should count no refusal of its own test mapping toward the router\'s refusals', async () => {
        const before = upnpService.routerRefusals();

        expect(await upnpService.verifyUPNPsupport()).to.equal(true);

        sinon.assert.calledTwice(createMappingStub);
        expect(upnpService.routerRefusals()).to.equal(before);
      });

      it('should count no refusal of its own test mapping when it fails, either', async () => {
        getMappingsStub.resolves([]);
        const before = upnpService.routerRefusals();

        expect(await upnpService.verifyUPNPsupport()).to.equal(false);

        expect(upnpService.routerRefusals()).to.equal(before);
      });

      [
        [16127, 2],
        [16137, 3],
        [16177, 7],
        [16187, 0],
        [16197, 1],
      ].forEach(([apiport, slot]) => {
        it(`should wait slot ${slot}'s turn before listing the table on api port ${apiport}`, async () => {
          getMappingsStub.resolves([]);

          await upnpService.verifyUPNPsupport(apiport);

          const wait = serviceHelper.delay.withArgs(slot * upnpService.BOOT_LISTING_STAGGER_MS);
          sinon.assert.called(wait);
          expect(wait.calledBefore(getMappingsStub), 'the wait comes before the listing').to.equal(true);
        });
      });

      it('should know the test mappings earlier runs left as a FRITZ!Box stores their descriptions', async () => {
        getMappingsStub.resolves([
          listed(31000, 'Flux.Test.App'),
          listed(31001, 'Flux.Prelaunch.App.31001'),
          listed(31002, 'Flux.App.web'),
        ]);

        expect(await upnpService.verifyUPNPsupport()).to.equal(true);

        const removedPorts = removeMappingStub.getCalls().map((call) => call.args[0].public.port ?? call.args[0].public);
        expect(removedPorts.filter((port) => port !== 16130)).to.deep.equal([31000, 31001]);
      });

      it('should fail without mapping again when there is no test mapping to remove', async () => {
        getMappingsStub.resolves([listed(31002, 'Flux_App_web')]);

        const result = await upnpService.verifyUPNPsupport();

        expect(result).to.equal(false);
        sinon.assert.calledOnce(createMappingStub);
        sinon.assert.calledWithMatch(logSpy, /^VerifyUPNPsupport - Failed Create Mapping: TCP 16130 not mapped: UPnP error 728/);
      });

      it('should fail without mapping again when the router cannot be listed', async () => {
        getMappingsStub.rejects(new Error('listing timed out'));

        const result = await upnpService.verifyUPNPsupport();

        expect(result).to.equal(false);
        sinon.assert.calledOnce(createMappingStub);
      });

      it('should remove the left-overs, and map once more, when the router refuses with a generic 501 Action Failed', async () => {
        // a full table refuses the leased mapping and the one asked for without a lease alike
        createMappingStub.onFirstCall().rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'AddPortMapping'));
        createMappingStub.onSecondCall().rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'AddPortMapping'));

        const result = await upnpService.verifyUPNPsupport();

        expect(result).to.equal(true);
        sinon.assert.calledOnce(getMappingsStub);
        expect(createMappingStub.getCalls().map((call) => call.args[0].ttl)).to.deep.equal([TEST_LEASE_S, 0, TEST_LEASE_S]);
      });

      it('should not ask for a mapping without a lease when the table is full', async () => {
        await upnpService.verifyUPNPsupport();

        expect(createMappingStub.getCalls().map((call) => call.args[0].ttl)).to.deep.equal([TEST_LEASE_S, TEST_LEASE_S]);
      });

      describe('and holds nothing of this node\'s to remove', () => {
        // the router's entry for each port: this node's api port, or nothing
        const routerMaps = (apiEntry) => {
          natUpnp.Client.prototype.getMapping.reset();
          natUpnp.Client.prototype.getMapping.callsFake(async ({ public: port }) => (port === 16127 ? apiEntry : null));
        };
        const apiEntry = (overrides = {}) => ({
          ...testMapping, public: { host: '', port: 16127 }, private: { host: '192.168.1.10', port: 16127 }, description: 'Flux_Backend_API', ...overrides,
        });

        beforeEach(() => {
          createMappingStub.reset();
          createMappingStub.rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'AddPortMapping'));
          getMappingsStub.resolves([listed(31002, 'Flux_App_web')]);
        });

        it('should verify when the router already maps this node\'s api port to it', async () => {
          routerMaps(apiEntry());

          const result = await upnpService.verifyUPNPsupport();

          expect(result).to.equal(true);
          expect(upnpService.isUPNP()).to.equal(true);
          sinon.assert.calledWithExactly(natUpnp.Client.prototype.getMapping, { public: 16127, protocol: 'TCP' });
          // the leased test mapping, and the same asked for once without a lease
          expect(createMappingStub.getCalls().map((call) => call.args[0].ttl)).to.deep.equal([TEST_LEASE_S, 0]);
          sinon.assert.notCalled(removeMappingStub);
          expect(upnpService.mappedHere.has(16130)).to.equal(false);
        });

        [
          ['holds no mapping of the api port', null],
          ['maps the api port to another machine', apiEntry({ local: false, private: { host: '192.168.1.11', port: 16127 } })],
          ['maps the api port disabled', apiEntry({ enabled: false })],
        ].forEach(([what, entry]) => {
          it(`should fail when the router ${what}`, async () => {
            routerMaps(entry);

            const result = await upnpService.verifyUPNPsupport();

            expect(result).to.equal(false);
            expect(upnpService.isUPNP()).to.equal(false);
          });
        });

        it('should fail on a refusal of the port\'s own, whatever the router maps', async () => {
          routerMaps(apiEntry());
          createMappingStub.reset();
          createMappingStub.rejects(new natUpnp.UpnpError(718, 'ConflictInMappingEntry', 'AddPortMapping'));

          const result = await upnpService.verifyUPNPsupport();

          expect(result).to.equal(false);
        });

        it('should fail when the router does not answer, whatever it maps', async () => {
          routerMaps(apiEntry());
          createMappingStub.reset();
          createMappingStub.rejects(new Error('timeout of 10000ms exceeded'));

          const result = await upnpService.verifyUPNPsupport();

          expect(result).to.equal(false);
        });
      });

      it('should list nothing when the router does not answer', async () => {
        createMappingStub.onFirstCall().rejects(new Error('timeout of 10000ms exceeded'));

        const result = await upnpService.verifyUPNPsupport();

        expect(result).to.equal(false);
        sinon.assert.notCalled(getMappingsStub);
        sinon.assert.calledOnce(createMappingStub);
      });

      it('should list nothing when the router refuses for the port\'s own reason', async () => {
        createMappingStub.onFirstCall().rejects(new natUpnp.UpnpError(718, 'ConflictInMappingEntry', 'AddPortMapping'));

        const result = await upnpService.verifyUPNPsupport();

        expect(result).to.equal(false);
        sinon.assert.notCalled(getMappingsStub);
        sinon.assert.calledOnce(createMappingStub);
      });
    });

    it('should look up the test mapping it made, by its port, and nothing else', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves(true);
      const getMappingStub = sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(testMapping);
      const getMappingsStub = sinon.stub(natUpnp.Client.prototype, 'getMappings').resolves([]);
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves(true);

      const clock = sinon.useFakeTimers();
      const promise = upnpService.verifyUPNPsupport(16127);
      await clock.tickAsync(2_500);

      expect(await promise).to.equal(true);
      sinon.assert.calledOnceWithExactly(getMappingStub, { public: 16130, protocol: 'TCP' });
      sinon.assert.notCalled(getMappingsStub);
    });

    it('should fail when the router holds no mapping for the test port it just made', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(null);
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves(true);

      const clock = sinon.useFakeTimers();
      const promise = upnpService.verifyUPNPsupport(16127);
      await clock.tickAsync(2_500);

      expect(await promise).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get Mapping');
    });

    it('should log a proper error if getMapping throws', async () => {
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getGateway').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'createMapping').returns(Promise.resolve(true));
      sinon.stub(natUpnp.Client.prototype, 'getMapping').throws();
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').returns(Promise.resolve(true));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(false);
      sinon.assert.calledTwice(logSpy);
      sinon.assert.calledWithExactly(logSpy, 'VerifyUPNPsupport - Failed get Mapping');
    });

    it('should verify when the router refuses to remove the test mapping, and leave its removal pending', async () => {
      upnpService.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      upnpService.pendingRemovals.clear();
      sinon.stub(natUpnp.Client.prototype, 'getPublicIp').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'getGateway').resolves(true);
      sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(testMapping);
      sinon.stub(natUpnp.Client.prototype, 'removeMapping').rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'DeletePortMapping'));

      const clock = sinon.useFakeTimers();

      const promise = upnpService.verifyUPNPsupport();

      await clock.tickAsync(2_500);
      const result = await promise;

      expect(result).to.equal(true);
      expect([...upnpService.pendingRemovals.keys()]).to.deep.equal(['16130/TCP']);
      expect(upnpService.removalPending()).to.equal(true);
      upnpService.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      upnpService.pendingRemovals.clear();
    });
  });

  describe('setupUPNP tests', () => {
    let logSpy;
    let createMappingSpy;
    let getMappingStub;
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
      getMappingStub = sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(null);
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
      getMappingStub.resolves(fluxadmMapping());

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.callCount(createMappingSpy, 4);
      sinon.assert.calledOnceWithExactly(getMappingStub, { public: 118, protocol: 'TCP' });
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: 118, protocol: 'TCP' });
    });

    it('should know its own maintenance ssh mapping as a FRITZ!Box stores its description', async () => {
      createMappingSpy.returns(true);
      getMappingStub.resolves(fluxadmMapping({ description: 'Flux.Fluxadm.SSH' }));

      await runSetup(123);

      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: 118, protocol: 'TCP' });
    });

    it('should remove nothing when the router holds no mapping of the maintenance ssh port', async () => {
      createMappingSpy.returns(true);

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.calledOnce(getMappingStub);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should remove its own maintenance ssh mapping once its socket is gone, or systemctl cannot answer', async () => {
      createMappingSpy.returns(true);
      getMappingStub.resolves(fluxadmMapping());
      sshdSocket('', new Error('Failed to get unit file state for fluxadm-sshd.socket: No such file or directory'));

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.callCount(createMappingSpy, 4);
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: 118, protocol: 'TCP' });
    });

    [
      ['made under another description', { description: 'node owner ssh' }],
      ['to another machine', { local: false }],
      ['the router cannot say is to this node', { local: null }],
    ].forEach(([what, overrides]) => {
      it(`should keep a mapping of the same port ${what}`, async () => {
        createMappingSpy.returns(true);
        getMappingStub.resolves(fluxadmMapping(overrides));

        const result = await runSetup(123);

        expect(result).to.equal(true);
        sinon.assert.calledOnce(getMappingStub);
        sinon.assert.notCalled(removeMappingStub);
      });
    });

    it('should neither map nor unmap the maintenance ssh port on ArcaneOS', async () => {
      createMappingSpy.returns(true);
      fluxadmPortStub.isArcane = true;
      sshdSocket('enabled\n');
      getMappingStub.resolves(fluxadmMapping());

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.callCount(createMappingSpy, 4);
      sinon.assert.notCalled(getMappingStub);
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
        public: 123, private: 123, ttl: 0, protocol: 'TCP', description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 124, private: 124, ttl: 0, protocol: 'TCP', description: 'Flux_Backend_API_SSL',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 122, private: 122, ttl: 0, protocol: 'TCP', description: 'Flux_Home_UI',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 125, private: 125, ttl: 0, protocol: 'TCP', description: 'Flux_Syncthing',
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
        public: 16127, private: 16127, ttl: 0, protocol: 'TCP', description: 'Flux_Backend_API',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 16128, private: 16128, ttl: 0, protocol: 'TCP', description: 'Flux_Backend_API_SSL',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 16126, private: 16126, ttl: 0, protocol: 'TCP', description: 'Flux_Home_UI',
      });
      sinon.assert.calledWithExactly(createMappingSpy, {
        public: 16129, private: 16129, ttl: 0, protocol: 'TCP', description: 'Flux_Syncthing',
      });
    });

    it('should take a core port the router refuses but already maps to this node as mapped', async () => {
      createMappingSpy.withArgs(sinon.match({ public: 124 })).rejects(new natUpnp.UpnpError(728, 'NoPortMapsAvailable', 'AddPortMapping'));
      getMappingStub.withArgs({ public: 124, protocol: 'TCP' }).resolves(fluxadmMapping({
        public: { host: '', port: 124 }, private: { host: '192.168.1.10', port: 124 }, description: 'Flux_Backend_API_SSL', enabled: true,
      }));

      const result = await runSetup(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should fail on a core port the router refuses, naming it and the router\'s reason', async () => {
      createMappingSpy.withArgs(sinon.match({ public: 124 })).rejects(new natUpnp.UpnpError(728, 'NoPortMapsAvailable', 'AddPortMapping'));

      const result = await runSetup(123);

      expect(result).to.equal(false);
      sinon.assert.calledOnceWithExactly(logSpy, 'setupUPNP - TCP 124 not mapped: UPnP error 728: NoPortMapsAvailable (action: AddPortMapping)');
      sinon.assert.callCount(createMappingSpy, 2);
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
    let createMappingStub;
    let getMappingStub;

    const refusal = (code, description) => new natUpnp.UpnpError(code, description, 'AddPortMapping');
    // the router's entry for port 123, to this node unless overridden
    const entry = (overrides = {}) => ({
      public: { host: '', port: 123 },
      private: { host: '192.168.1.10', port: 123 },
      protocol: 'udp',
      enabled: true,
      description: 'Flux_App_web',
      ttl: 0,
      local: true,
      ...overrides,
    });

    beforeEach(() => {
      upnpService.mappedHere.clear();
      upnpService.routerLeases.kept = null;
      upnpService.routerLeases.renews = null;
      logSpy = sinon.spy(log, 'error');
      sinon.stub(serviceHelper, 'delay').resolves();
      createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      getMappingStub = sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should map TCP and then UDP, port for port, with no lease', async () => {
      const result = await upnpService.mapUpnpPort(123, 'some description');

      expect(result).to.deep.equal({
        mapped: true, code: null, reason: null, routerWide: false,
      });
      sinon.assert.notCalled(logSpy);
      sinon.assert.calledTwice(createMappingStub);
      sinon.assert.calledWithExactly(createMappingStub.firstCall, {
        public: 123, private: 123, ttl: 0, protocol: 'TCP', description: 'some description',
      });
      sinon.assert.calledWithExactly(createMappingStub.secondCall, {
        public: 123, private: 123, ttl: 0, protocol: 'UDP', description: 'some description',
      });
    });

    it('should map only the protocols it is given', async () => {
      upnpService.mappedProtocols.clear();
      const result = await upnpService.mapUpnpPort(123, 'Flux_Test_App', { protocols: ['TCP'] });

      expect(result.mapped).to.equal(true);
      sinon.assert.calledOnceWithExactly(createMappingStub, {
        public: 123, private: 123, ttl: TEST_LEASE_S, protocol: 'TCP', description: 'Flux_Test_App',
      });
      expect([...upnpService.mappedProtocols.get(123)]).to.deep.equal(['TCP']);
    });

    // A test mapping the router took after this node stopped waiting for its
    // answer is never removed by this node, so it carries a lease the router
    // ends it by - on a router that keeps one.
    describe('the lease of a test mapping', () => {
      const ttls = () => createMappingStub.getCalls().map((call) => call.args[0].ttl);

      [
        ['the port test\'s', 'Flux_Test_App'],
        ['the UPnP check\'s', 'Flux_UPNP_Mapping_Test'],
        ['one stored as a FRITZ!Box stores it', 'Flux.Test.App'],
      ].forEach(([what, description]) => {
        it(`should lease ${what} while the router is not known to refuse a lease`, async () => {
          await upnpService.mapUpnpPort(123, description);

          expect(ttls()).to.deep.equal([TEST_LEASE_S, TEST_LEASE_S]);
        });
      });

      it('should lease a test mapping on a router known to keep a lease', async () => {
        upnpService.routerLeases.kept = true;

        await upnpService.mapUpnpPort(123, 'Flux_Test_App');

        expect(ttls()).to.deep.equal([TEST_LEASE_S, TEST_LEASE_S]);
      });

      it('should map a test mapping without a lease on a router known to drop one', async () => {
        upnpService.routerLeases.kept = false;

        await upnpService.mapUpnpPort(123, 'Flux_Test_App');

        expect(ttls()).to.deep.equal([0, 0]);
      });

      ['Flux_App_web', 'Flux_Backend_API', 'Flux_Syncthing'].forEach((description) => {
        it(`should not give the test lease to a mapping that is not a test's: ${description}`, async () => {
          upnpService.routerLeases.kept = true;

          await upnpService.mapUpnpPort(123, description);

          expect(ttls()).to.deep.equal([0, 0]);
        });
      });

      [402, 501, 606, 725].forEach((code) => {
        it(`should map without a lease, and know the router refuses one, when it refuses a leased mapping with ${code}`, async () => {
          createMappingStub.onFirstCall().rejects(refusal(code, 'ActionFailed'));

          const result = await upnpService.mapUpnpPort(123, 'Flux_Test_App');

          expect(result.mapped).to.equal(true);
          expect(upnpService.routerLeases.kept).to.equal(false);
          // the refused protocol asked once more without a lease, and the next asked without one at once
          expect(ttls()).to.deep.equal([TEST_LEASE_S, 0, 0]);
          expect([...upnpService.mappedProtocols.get(123)]).to.deep.equal(['TCP', 'UDP']);
        });
      });

      [
        [718, 'ConflictInMappingEntry'],
        [728, 'NoPortMapsAvailable'],
        [729, 'ConflictWithOtherMechanisms'],
      ].forEach(([code, description]) => {
        it(`should not ask again without a lease when the router refuses with ${code}, which says nothing of the lease`, async () => {
          createMappingStub.rejects(refusal(code, description));

          const result = await upnpService.mapUpnpPort(123, 'Flux_Test_App');

          expect(result).to.include({ mapped: false, code });
          expect(ttls()).to.deep.equal([TEST_LEASE_S]);
          expect(upnpService.routerLeases.kept).to.equal(null);
        });
      });

      it('should report the refusal of the mapping asked for without a lease, and learn nothing, when both are refused', async () => {
        createMappingStub.onFirstCall().rejects(refusal(501, 'ActionFailed'));
        createMappingStub.onSecondCall().rejects(refusal(402, 'InvalidArgs'));

        const result = await upnpService.mapUpnpPort(123, 'Flux_Test_App');

        expect(result).to.include({ mapped: false, code: 402 });
        expect(ttls()).to.deep.equal([TEST_LEASE_S, 0]);
        expect(upnpService.routerLeases.kept).to.equal(null);
      });

      it('should not ask again without a lease when the router does not answer', async () => {
        createMappingStub.rejects(new Error('timeout of 10000ms exceeded'));

        const result = await upnpService.mapUpnpPort(123, 'Flux_Test_App');

        expect(result).to.include({ mapped: false, code: null });
        expect(ttls()).to.deep.equal([TEST_LEASE_S]);
      });
    });

    // A long-lived mapping is refreshed while what it serves runs, so a lease
    // ends it only once this node stops refreshing it - on a router that
    // restarts a lease when the mapping is added again.
    describe('the lease of a long-lived mapping', () => {
      const ttls = () => createMappingStub.getCalls().map((call) => call.args[0].ttl);
      const LONG_LEASE_S = 35 * 60;

      [
        ['an app\'s', 'Flux_App_web'],
        ['the api port\'s', 'Flux_Backend_API'],
        ['the api SSL port\'s', 'Flux_Backend_API_SSL'],
        ['the home UI\'s', 'Flux_Home_UI'],
        ['syncthing\'s', 'Flux_Syncthing'],
        ['an app\'s stored as a FRITZ!Box stores it', 'Flux.App.web'],
      ].forEach(([what, description]) => {
        it(`should lease ${what} on a router known to renew a lease`, async () => {
          upnpService.routerLeases.kept = true;
          upnpService.routerLeases.renews = true;

          await upnpService.mapUpnpPort(123, description);

          expect(ttls()).to.deep.equal([LONG_LEASE_S, LONG_LEASE_S]);
        });
      });

      [null, false].forEach((renews) => {
        it(`should map a long-lived mapping without a lease while renewal is ${renews === null ? 'not known' : 'known not to happen'}`, async () => {
          upnpService.routerLeases.kept = true;
          upnpService.routerLeases.renews = renews;

          await upnpService.mapUpnpPort(123, 'Flux_App_web');

          expect(ttls()).to.deep.equal([0, 0]);
        });
      });

      ['Flux_manual_entry', 'some description'].forEach((description) => {
        it(`should never lease a mapping that is neither a test's nor long-lived: ${description}`, async () => {
          upnpService.routerLeases.kept = true;
          upnpService.routerLeases.renews = true;

          await upnpService.mapUpnpPort(123, description);

          expect(ttls()).to.deep.equal([0, 0]);
        });
      });

      it('should map without a lease, and know long-lived mappings are permanent, when the router refuses the lease', async () => {
        upnpService.routerLeases.kept = true;
        upnpService.routerLeases.renews = true;
        createMappingStub.onFirstCall().rejects(refusal(725, 'OnlyPermanentLeasesSupported'));

        const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

        expect(result.mapped).to.equal(true);
        expect(upnpService.routerLeases.renews).to.equal(false);
        expect(upnpService.routerLeases.kept).to.equal(true);
        expect(ttls()).to.deep.equal([LONG_LEASE_S, 0, 0]);
      });
    });

    it('should signal each refusal it counts as the router\'s, and no other', async () => {
      const onRefused = sinon.spy();
      upnpService.routerEvents.on('mappingRefused', onRefused);
      try {
        createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry'));
        getMappingStub.resolves(entry({ private: { host: '192.168.1.20', port: 123 }, local: false }));
        await upnpService.mapUpnpPort(123, 'Flux_App_web');
        sinon.assert.notCalled(onRefused);

        createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
        getMappingStub.resolves(null);
        await upnpService.mapUpnpPort(124, 'Flux_App_web');
        await upnpService.mapUpnpPort(125, 'Flux_App_web');
        sinon.assert.calledTwice(onRefused);
      } finally {
        upnpService.routerEvents.off('mappingRefused', onRefused);
      }
    });

    it('should not ask for UDP when TCP is refused', async () => {
      createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry'));

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(result.mapped).to.equal(false);
      sinon.assert.calledOnce(createMappingStub);
    });

    it('should give a port another machine holds as the port\'s refusal, not the router\'s', async () => {
      createMappingStub.onSecondCall().rejects(refusal(718, 'ConflictInMappingEntry'));
      getMappingStub.resolves(entry({ local: false, private: { host: '192.168.1.11', port: 123 } }));
      const before = upnpService.routerRefusals();

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(result).to.deep.equal({
        mapped: false,
        code: 718,
        reason: 'UDP 123 not mapped: UPnP error 718: ConflictInMappingEntry (action: AddPortMapping)',
        routerWide: false,
      });
      expect(upnpService.routerRefusals()).to.equal(before);
      sinon.assert.calledOnceWithExactly(logSpy, `UPnP - ${result.reason}`);
    });

    it('should count a full table as the router\'s refusal', async () => {
      createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
      const before = upnpService.routerRefusals();

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: 728, routerWide: true });
      expect(upnpService.routerRefusals()).to.equal(before + 1);
    });

    it('should count a router that does not answer as the router\'s refusal, and not ask it again', async () => {
      createMappingStub.rejects(new Error('timeout of 10000ms exceeded'));
      const before = upnpService.routerRefusals();

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(result).to.deep.equal({
        mapped: false, code: null, reason: 'TCP 123 not mapped: timeout of 10000ms exceeded', routerWide: true,
      });
      expect(upnpService.routerRefusals()).to.equal(before + 1);
      sinon.assert.notCalled(getMappingStub);
    });

    [
      [501, 'ActionFailed'],
      [606, 'ActionNotAuthorized'],
    ].forEach(([code, description]) => {
      it(`should count a ${code} ${description} as the router's refusal`, async () => {
        createMappingStub.rejects(refusal(code, description));
        const before = upnpService.routerRefusals();

        const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

        expect(result).to.include({ mapped: false, code, routerWide: true });
        expect(upnpService.routerRefusals()).to.equal(before + 1);
      });
    });

    [
      [402, 'InvalidArgs'],
      [716, 'WildCardNotPermittedInExtPort'],
      [718, 'ConflictInMappingEntry'],
      [724, 'SamePortValuesRequired'],
      [725, 'OnlyPermanentLeasesSupported'],
      [726, 'RemoteHostOnlySupportsWildcard'],
      [727, 'ExternalPortOnlySupportsWildcard'],
      [729, 'ConflictWithOtherMechanisms'],
    ].forEach(([code, description]) => {
      it(`should give a ${code} ${description} as the port's refusal, not the router's`, async () => {
        createMappingStub.rejects(refusal(code, description));
        const before = upnpService.routerRefusals();

        const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

        expect(result).to.include({ mapped: false, code, routerWide: false });
        expect(upnpService.routerRefusals()).to.equal(before);
      });
    });

    [
      [501, 'ActionFailed'],
      [606, 'ActionNotAuthorized'],
    ].forEach(([code, description]) => {
      it(`should give a ${code} for a port another machine holds as the port's refusal, not the router's`, async () => {
        createMappingStub.rejects(refusal(code, description));
        getMappingStub.resolves(entry({ local: false, private: { host: '192.168.1.11', port: 123 } }));
        const before = upnpService.routerRefusals();

        const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

        expect(result).to.include({ mapped: false, code, routerWide: false });
        expect(upnpService.routerRefusals()).to.equal(before);
      });
    });

    it('should give a 501 for a port this node holds otherwise as the port\'s refusal, not the router\'s', async () => {
      createMappingStub.rejects(refusal(501, 'ActionFailed'));
      getMappingStub.resolves(entry({ private: { host: '192.168.1.10', port: 124 } }));
      const before = upnpService.routerRefusals();

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: 501, routerWide: false });
      expect(upnpService.routerRefusals()).to.equal(before);
    });

    it('should count a 728 as the router\'s refusal even for a port another machine holds', async () => {
      createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
      getMappingStub.resolves(entry({ local: false, private: { host: '192.168.1.11', port: 123 } }));
      const before = upnpService.routerRefusals();

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: 728, routerWide: true });
      expect(upnpService.routerRefusals()).to.equal(before + 1);
    });

    it('should take a refusal as mapped when the router already maps the port to this node', async () => {
      createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
      getMappingStub.callsFake(async ({ protocol }) => entry({ protocol: protocol.toLowerCase() }));
      const before = upnpService.routerRefusals();

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(result.mapped).to.equal(true);
      expect(upnpService.routerRefusals()).to.equal(before);
      sinon.assert.calledWithExactly(getMappingStub.firstCall, { public: 123, protocol: 'TCP' });
      sinon.assert.calledWithExactly(getMappingStub.secondCall, { public: 123, protocol: 'UDP' });
      sinon.assert.notCalled(logSpy);
    });

    [
      ['to another port of this node', { private: { host: '192.168.1.10', port: 124 } }],
      ['disabled', { enabled: false }],
      ['where this node cannot tell whose it is', { local: null }],
    ].forEach(([what, overrides]) => {
      it(`should keep the refusal when the router's entry is ${what}`, async () => {
        createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
        getMappingStub.resolves(entry(overrides));

        const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

        expect(result).to.include({ mapped: false, code: 728 });
      });
    });

    it('should keep the refusal when the router cannot be asked for its entry', async () => {
      createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry'));
      getMappingStub.rejects(new Error('socket hang up'));

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: 718 });
    });

    it('should ask the router nothing for what is not a port, and count nothing', async () => {
      const before = upnpService.routerRefusals();

      const result = await upnpService.mapUpnpPort(Number.NaN, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: null, routerWide: false });
      expect(upnpService.routerRefusals()).to.equal(before);
      sinon.assert.notCalled(createMappingStub);
    });

    it('should no longer hold a port it failed to map', async () => {
      createMappingStub.onSecondCall().rejects(refusal(718, 'ConflictInMappingEntry'));

      await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(upnpService.mappedHere.has(123)).to.equal(false);
    });

    it('should hold a port it mapped', async () => {
      await upnpService.mapUpnpPort(123, 'Flux_App_web');

      expect(upnpService.mappedHere.has(123)).to.equal(true);
    });
  });

  describe('removeMapUpnpPort tests', () => {
    let logSpy;
    let createMappingStub;
    let getMappingStub;
    let removeMappingStub;

    const refusal = (code, description, action) => new natUpnp.UpnpError(code, description, action);
    const removedProtocols = () => removeMappingStub.getCalls().map((call) => call.args[0].protocol);

    beforeEach(() => {
      upnpService.mappedHere.clear();
      upnpService.mappedProtocols.clear();
      logSpy = sinon.spy(log, 'error');
      sinon.stub(serviceHelper, 'delay').resolves();
      createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      getMappingStub = sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(null);
      removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should remove both protocols this node mapped, without asking the router whose they are', async () => {
      await upnpService.mapUpnpPort(123, 'Flux_Test_App');
      getMappingStub.resetHistory();

      const result = await upnpService.removeMapUpnpPort(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(getMappingStub);
      sinon.assert.calledWithExactly(removeMappingStub.firstCall, { public: 123, protocol: 'TCP' });
      sinon.assert.calledWithExactly(removeMappingStub.secondCall, { public: 123, protocol: 'UDP' });
      sinon.assert.notCalled(logSpy);
    });

    it('should remove the TCP half of a port whose UDP the router refused', async () => {
      createMappingStub.onSecondCall().rejects(refusal(718, 'ConflictInMappingEntry', 'AddPortMapping'));
      await upnpService.mapUpnpPort(123, 'Flux_Test_App');

      await upnpService.removeMapUpnpPort(123);

      expect(removedProtocols()).to.deep.equal(['TCP']);
    });

    it('should ask the router to remove nothing of a port it refused to map here', async () => {
      createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry', 'AddPortMapping'));
      await upnpService.mapUpnpPort(123, 'Flux_Test_App');

      const result = await upnpService.removeMapUpnpPort(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should ask the router to remove nothing of a port this node never mapped', async () => {
      const result = await upnpService.removeMapUpnpPort(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should forget a protocol whose latest map the router refused', async () => {
      await upnpService.mapUpnpPort(123, 'Flux_App_web');
      createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry', 'AddPortMapping'));
      await upnpService.mapUpnpPort(123, 'Flux_App_web');

      await upnpService.removeMapUpnpPort(123);

      // TCP was refused; UDP, not asked again, stays as the first map left it
      expect(removedProtocols()).to.deep.equal(['UDP']);
    });

    it('should count a refusal the router has the port mapped here for as mapped here', async () => {
      createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable', 'AddPortMapping'));
      getMappingStub.callsFake(async ({ protocol }) => ({
        public: { host: '', port: 123 },
        private: { host: '192.168.1.10', port: 123 },
        protocol: protocol.toLowerCase(),
        enabled: true,
        description: 'Flux_App_web',
        ttl: 0,
        local: true,
      }));
      await upnpService.mapUpnpPort(123, 'Flux_App_web');

      await upnpService.removeMapUpnpPort(123);

      expect(removedProtocols()).to.deep.equal(['TCP', 'UDP']);
    });

    it('should remove UDP when the router refuses to remove TCP, and report the port not removed', async () => {
      await upnpService.mapUpnpPort(123, 'Flux_Test_App');
      removeMappingStub.withArgs({ public: 123, protocol: 'TCP' }).rejects(refusal(501, 'ActionFailed', 'DeletePortMapping'));

      const result = await upnpService.removeMapUpnpPort(123);

      expect(result).to.equal(false);
      expect(removedProtocols()).to.deep.equal(['TCP', 'UDP']);
      sinon.assert.calledOnceWithExactly(logSpy, 'UPnP - TCP 123 not unmapped: UPnP error 501: ActionFailed (action: DeletePortMapping)');
    });

    it('should take a removal the router has no entry for as removed', async () => {
      await upnpService.mapUpnpPort(123, 'Flux_Test_App');
      removeMappingStub.rejects(refusal(714, 'NoSuchEntryInArray', 'DeletePortMapping'));

      const result = await upnpService.removeMapUpnpPort(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should ask a second removal of the same port for nothing', async () => {
      await upnpService.mapUpnpPort(123, 'Flux_Test_App');
      await upnpService.removeMapUpnpPort(123);
      removeMappingStub.resetHistory();

      await upnpService.removeMapUpnpPort(123);

      sinon.assert.notCalled(removeMappingStub);
    });
  });

  describe('pending removal tests', () => {
    const FIRST_MS = 30 * 1000;
    const MAX_MS = 60 * 1000;
    let clock;
    let createMappingStub;
    let getMappingStub;
    let removeMappingStub;

    const refused = () => new natUpnp.UpnpError(501, 'ActionFailed', 'DeletePortMapping');
    // the router's entry for a port, to this node unless overridden
    const entry = (port, protocol, overrides = {}) => ({
      public: { host: '', port },
      private: { host: '192.168.1.10', port },
      protocol: protocol.toLowerCase(),
      enabled: true,
      description: 'Flux_App_web',
      ttl: 0,
      local: true,
      ...overrides,
    });
    const lookups = () => getMappingStub.getCalls().map((call) => `${call.args[0].public}/${call.args[0].protocol}`);
    const removals = () => removeMappingStub.getCalls().map((call) => `${call.args[0].public}/${call.args[0].protocol}`);
    // a test port mapped TCP only: its UDP refused, held by another machine
    const mapTcpOnly = async (port, description) => {
      createMappingStub.withArgs(sinon.match({ public: port, protocol: 'UDP' })).rejects(new natUpnp.UpnpError(718, 'ConflictInMappingEntry', 'AddPortMapping'));
      getMappingStub.withArgs(sinon.match({ public: port, protocol: 'UDP' }))
        .resolves(entry(port, 'UDP', { private: { host: '192.168.1.11', port }, local: false }));
      await upnpService.mapUpnpPort(port, description);
      getMappingStub.resetHistory();
    };

    beforeEach(() => {
      upnpService.mappedHere.clear();
      upnpService.mappedProtocols.clear();
      upnpService.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      upnpService.pendingRemovals.clear();
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(log, 'error');
      sinon.stub(log, 'info');
      createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      getMappingStub = sinon.stub(natUpnp.Client.prototype, 'getMapping')
        .callsFake(async ({ public: port, protocol }) => entry(port, protocol));
      removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      upnpService.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      upnpService.pendingRemovals.clear();
      clock.restore();
      sinon.restore();
    });

    it('should ask the router again for a removal it refused, waiting longer each time, until it goes', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(refused());
      removeMappingStub.onCall(2).rejects(refused());

      expect(await upnpService.removeMapUpnpPort(123, 'Flux_Test_App')).to.equal(false);
      expect(removals()).to.deep.equal(['123/TCP']);

      await clock.tickAsync(FIRST_MS - 1);
      expect(removals().length, 'nothing before the first wait').to.equal(1);
      await clock.tickAsync(1);
      expect(removals().length, 'asked again after the first wait').to.equal(2);
      await clock.tickAsync(MAX_MS - 1);
      expect(removals().length, 'the wait doubles').to.equal(2);
      await clock.tickAsync(1);
      expect(removals().length).to.equal(3);
      await clock.tickAsync(MAX_MS);
      expect(removals().length, 'removed on the fourth ask, the wait capped').to.equal(4);
      expect(upnpService.pendingRemovals.size).to.equal(0);

      await clock.tickAsync(MAX_MS * 2);
      expect(removals().length, 'nothing once removed').to.equal(4);
    });

    it('should never give up, and wait no longer than the cap between asks', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_Test_App');

      // 30s, then 1m each
      await clock.tickAsync(FIRST_MS);
      expect(removals().length).to.equal(2);
      await clock.tickAsync(MAX_MS - 1);
      expect(removals().length).to.equal(2);
      await clock.tickAsync(1);
      expect(removals().length).to.equal(3);
      await clock.tickAsync(MAX_MS * 10);
      expect(removals().length, 'still asking').to.equal(13);
      expect(upnpService.pendingRemovals.has('123/TCP')).to.equal(true);
    });

    it('should take a router that holds no such entry as removed', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(new natUpnp.UpnpError(714, 'NoSuchEntryInArray', 'DeletePortMapping'));
      await upnpService.removeMapUpnpPort(123, 'Flux_Test_App');

      await clock.tickAsync(FIRST_MS);
      expect(upnpService.pendingRemovals.size).to.equal(0);
      await clock.tickAsync(MAX_MS);
      expect(removals().length).to.equal(2);
    });

    it('should remove a pending test mapping once more before the port is mapped for an app, then drop it', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_Test_App');
      const before = createMappingStub.callCount;

      await upnpService.mapUpnpPort(123, 'Flux_App_web', { protocols: ['TCP'] });
      await clock.tickAsync(MAX_MS);

      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(createMappingStub.getCall(before).args[0]).to.include({ public: 123, protocol: 'TCP', description: 'Flux_App_web' });
      expect(removeMappingStub.secondCall.callId, 'removed before mapped').to.be.below(createMappingStub.getCall(before).callId);
      expect(upnpService.pendingRemovals.size).to.equal(0);
    });

    it('should map an app over a test mapping the router refuses to remove again, and drop the removal', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_Test_App');

      const result = await upnpService.mapUpnpPort(123, 'Flux_App_web', { protocols: ['TCP'] });
      await clock.tickAsync(MAX_MS);

      expect(result.mapped).to.equal(true);
      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(upnpService.pendingRemovals.size).to.equal(0);
    });

    it('should drop a pending removal without asking when a test maps the port again', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_Test_App');

      await upnpService.mapUpnpPort(123, 'Flux_Test_App');
      await clock.tickAsync(MAX_MS);

      expect(removals()).to.deep.equal(['123/TCP']);
      expect(upnpService.pendingRemovals.size).to.equal(0);
    });

    it('should drop a pending removal of an app mapping without asking when the port is mapped again', async () => {
      await mapTcpOnly(123, 'Flux_App_old');
      removeMappingStub.onCall(0).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_old');

      await upnpService.mapUpnpPort(123, 'Flux_App_web');
      await clock.tickAsync(MAX_MS);

      expect(removals()).to.deep.equal(['123/TCP']);
      expect(upnpService.pendingRemovals.size).to.equal(0);
    });

    it('should ask for pending removals one at a time', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      await mapTcpOnly(124, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_Test_App');
      await upnpService.removeMapUpnpPort(124, 'Flux_Test_App');
      let inFlight = 0;
      let most = 0;
      removeMappingStub.callsFake(async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => { setTimeout(resolve, 1000); });
        inFlight -= 1;
      });

      await clock.tickAsync(FIRST_MS + 5000);

      expect(removals().slice(2).sort()).to.deep.equal(['123/TCP', '124/TCP']);
      expect(most, 'never two at once').to.equal(1);
    });

    it('should keep asking for both protocols of a port when the router refuses to remove either', async () => {
      await upnpService.mapUpnpPort(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');

      expect([...upnpService.pendingRemovals.keys()].sort()).to.deep.equal(['123/TCP', '123/UDP']);
      await clock.tickAsync(FIRST_MS);
      expect(removals().slice(2).sort()).to.deep.equal(['123/TCP', '123/UDP']);
      expect(upnpService.pendingRemovals.size).to.equal(0);
    });

    it('should keep a pending removal when the port is removed again with nothing mapped since', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');

      expect(await upnpService.removeMapUpnpPort(123, 'Flux_App_web')).to.equal(true);
      await clock.tickAsync(FIRST_MS);

      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(upnpService.pendingRemovals.size).to.equal(0);
    });

    it('should say a removal is pending until the router has removed it, whatever the mapping', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');
      expect(upnpService.removalPending()).to.equal(true);

      await clock.tickAsync(FIRST_MS);
      expect(upnpService.removalPending(), 'removed on the next ask').to.equal(false);
    });

    it('should say pending when the first removal is refused, and clear when the last goes', async () => {
      const events = [];
      const onPending = () => events.push('pending');
      const onClear = () => events.push('clear');
      upnpService.routerEvents.on('removalPending', onPending);
      upnpService.routerEvents.on('removalsClear', onClear);
      try {
        await mapTcpOnly(123, 'Flux_App_web');
        await mapTcpOnly(124, 'Flux_Test_App');
        removeMappingStub.onCall(0).rejects(refused());
        removeMappingStub.onCall(1).rejects(refused());
        removeMappingStub.onCall(2).rejects(refused());
        await upnpService.removeMapUpnpPort(123, 'Flux_App_web');
        await upnpService.removeMapUpnpPort(124, 'Flux_Test_App');
        expect(events, 'once, for the first').to.deep.equal(['pending']);

        await clock.tickAsync(FIRST_MS);
        expect(events, 'one still pending').to.deep.equal(['pending']);
        await clock.tickAsync(MAX_MS);
        expect(events).to.deep.equal(['pending', 'clear']);
      } finally {
        upnpService.routerEvents.off('removalPending', onPending);
        upnpService.routerEvents.off('removalsClear', onClear);
      }
    });

    it('should clear when the port of the last pending removal is mapped again', async () => {
      const onClear = sinon.spy();
      upnpService.routerEvents.on('removalsClear', onClear);
      try {
        await mapTcpOnly(123, 'Flux_App_web');
        removeMappingStub.onCall(0).rejects(refused());
        await upnpService.removeMapUpnpPort(123, 'Flux_App_web');

        await upnpService.mapUpnpPort(123, 'Flux_App_web');

        sinon.assert.calledOnce(onClear);
        expect(upnpService.removalPending()).to.equal(false);
      } finally {
        upnpService.routerEvents.off('removalsClear', onClear);
      }
    });
  
    it('should look the entry up before each ask, and remove it only while it is this node\'s', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');
      expect(lookups(), 'the first removal asks nothing first').to.deep.equal([]);

      await clock.tickAsync(FIRST_MS);

      expect(lookups()).to.deep.equal(['123/TCP']);
      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(upnpService.pendingRemovals.size).to.equal(0);
    });

    it('should end a removal with nothing sent when the router no longer holds the entry, whatever it answers to a removal', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');
      getMappingStub.resolves(null);

      await clock.tickAsync(FIRST_MS);

      expect(removals(), 'no removal after the lookup').to.deep.equal(['123/TCP']);
      expect(upnpService.removalPending()).to.equal(false);
      await clock.tickAsync(MAX_MS * 5);
      expect(lookups(), 'asked nothing more').to.have.length(1);
    });

    it('should end a removal with nothing sent when the router holds the port for something else', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');
      getMappingStub.callsFake(async ({ public: port, protocol }) => entry(port, protocol, { private: { host: '192.168.1.11', port }, local: false }));

      await clock.tickAsync(FIRST_MS);

      expect(removals()).to.deep.equal(['123/TCP']);
      expect(upnpService.removalPending()).to.equal(false);
    });

    it('should send the removal when the router answers the lookup with a fault, and keep it pending while the removal is refused', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');
      getMappingStub.rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'GetSpecificPortMappingEntry'));

      await clock.tickAsync(FIRST_MS);

      expect(removals(), 'a lookup it did not settle leaves the mapping counted as this node\'s').to.deep.equal(['123/TCP', '123/TCP']);
      expect(upnpService.removalPending()).to.equal(true);

      removeMappingStub.resolves();
      await clock.tickAsync(MAX_MS);
      expect(removals()).to.have.length(3);
      expect(upnpService.removalPending(), 'ended once the router removed it').to.equal(false);
    });

    it('should end a removal whose lookup the router answers with a fault once it answers the removal with no such entry', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(new natUpnp.UpnpError(714, 'NoSuchEntryInArray', 'DeletePortMapping'));
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');
      getMappingStub.rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'GetSpecificPortMappingEntry'));

      await clock.tickAsync(FIRST_MS);

      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(upnpService.removalPending()).to.equal(false);
    });

    it('should send the removal while the router does not answer the lookup, and keep it pending while the removal is refused', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.rejects(refused());
      await upnpService.removeMapUpnpPort(123, 'Flux_App_web');
      getMappingStub.rejects(new Error('timeout of 10000ms exceeded'));

      await clock.tickAsync(FIRST_MS);
      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(upnpService.removalPending()).to.equal(true);

      removeMappingStub.resolves();
      await clock.tickAsync(MAX_MS);
      expect(upnpService.removalPending(), 'ended once the router removed it').to.equal(false);
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

  describe('msUntilRefreshSlot tests', () => {
    const CYCLE_MS = 10 * 60 * 1000;
    const at = (cycleOffsetMs, cycleMs = CYCLE_MS) => 1_800_000_000_000 - (1_800_000_000_000 % cycleMs) + cycleOffsetMs;
    const STANDARD_PORTS = [16127, 16137, 16147, 16157, 16167, 16177, 16187, 16197];

    it('should give each standard api port a slot of its own', () => {
      const slots = STANDARD_PORTS.map((apiport) => upnpService.msUntilRefreshSlot(apiport, CYCLE_MS, at(0)));

      expect(new Set(slots).size).to.equal(8);
      slots.forEach((ms) => expect(ms % upnpService.CLEANUP_SLOT_MS).to.equal(0));
    });

    it('should hold a slot half a cycle from the node\'s cleanup slot', () => {
      // from the top of a cycle, each wait is where the slot starts in it
      STANDARD_PORTS.forEach((apiport) => {
        const cleanupStart = upnpService.msUntilCleanupSlot(apiport, at(0));
        const refreshStart = upnpService.msUntilRefreshSlot(apiport, CYCLE_MS, at(0));
        expect((refreshStart - cleanupStart + CYCLE_MS) % CYCLE_MS, `api port ${apiport}`).to.equal(CYCLE_MS / 2);
      });
    });

    it('should wait for the next start of the node\'s slot, never a slot already under way', () => {
      // 16127 cleans in the third slot (150 s) and refreshes in the seventh, 450 s into each cycle
      expect(upnpService.msUntilRefreshSlot(16127, CYCLE_MS, at(0))).to.equal(450 * 1000);
      expect(upnpService.msUntilRefreshSlot(16127, CYCLE_MS, at(450 * 1000))).to.equal(0);
      expect(upnpService.msUntilRefreshSlot(16127, CYCLE_MS, at(451 * 1000))).to.equal(599 * 1000);
    });

    it('should lay its eight slots across whatever cycle it is given', () => {
      // the harness's 30 s cycle: slots of 3.75 s, 16127 in the seventh
      expect(upnpService.msUntilRefreshSlot(16127, 30_000, at(0, 30_000))).to.equal(22_500);
      expect(upnpService.msUntilRefreshSlot(16127, 30_000, at(22_501, 30_000))).to.equal(29_999);
    });
  });

  // Whether adding a held mapping again restarts its lease, learned from a
  // mapping that outlives its first lease only if it does.
  describe('learnLeaseRenewal tests', () => {
    const APIPORT = 16127;
    const TEST_PORT = APIPORT + 3;
    let createMappingStub;
    let getMappingStub;
    let removeMappingStub;
    let clock;
    const held = (ttl) => ({
      public: { host: '', port: TEST_PORT },
      private: { host: '192.168.1.10', port: TEST_PORT },
      protocol: 'tcp',
      enabled: true,
      description: 'Flux_UPNP_Mapping_Test',
      ttl,
      local: true,
    });
    // runs the test to its end on the fake clock: 70 s, and the removal's pause
    const run = async () => {
      const promise = upnpService.learnLeaseRenewal(APIPORT);
      await clock.tickAsync(75_000);
      return promise;
    };

    beforeEach(() => {
      upnpService.mappedHere.clear();
      upnpService.mappedProtocols.clear();
      upnpService.routerLeases.kept = true;
      upnpService.routerLeases.renews = null;
      sinon.stub(log, 'info');
      sinon.stub(log, 'error');
      createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      getMappingStub = sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(held(58));
      removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      upnpService.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      upnpService.pendingRemovals.clear();
      clock.restore();
      sinon.restore();
    });

    it('should map the test port with a 60 s lease, add it again at 30 s, and look it up at 70 s', async () => {
      const promise = upnpService.learnLeaseRenewal(APIPORT);
      await clock.tickAsync(0);
      sinon.assert.calledOnceWithExactly(createMappingStub, {
        public: TEST_PORT, private: TEST_PORT, ttl: 60, protocol: 'TCP', description: 'Flux_UPNP_Mapping_Test',
      });
      await clock.tickAsync(29_999);
      sinon.assert.calledOnce(createMappingStub);
      await clock.tickAsync(1);
      sinon.assert.calledTwice(createMappingStub);
      expect(createMappingStub.secondCall.args).to.deep.equal(createMappingStub.firstCall.args);
      await clock.tickAsync(39_999);
      sinon.assert.notCalled(getMappingStub);
      await clock.tickAsync(1);
      sinon.assert.calledOnceWithExactly(getMappingStub, { public: TEST_PORT, protocol: 'TCP' });
      await clock.tickAsync(5_000);
      expect(await promise).to.equal(true);
    });

    it('should know the router renews when the mapping is still this node\'s, with a lease no longer than asked', async () => {
      expect(await run()).to.equal(true);
      expect(upnpService.routerLeases.renews).to.equal(true);
    });

    it('should know the router renews when it shows the asked lease without counting down', async () => {
      getMappingStub.resolves(held(60));

      expect(await run()).to.equal(true);
    });

    [
      ['the mapping is gone', () => null],
      ['the mapping is another machine\'s', () => ({ ...held(58), private: { host: '192.168.1.20', port: TEST_PORT }, local: false })],
      ['the mapping is disabled', () => ({ ...held(58), enabled: false })],
      ['it shows the mapping as permanent', () => held(0)],
      ['it shows a lease longer than asked, a minimum it enforces', () => held(840)],
    ].forEach(([what, answer]) => {
      it(`should know the router does not renew when ${what}`, async () => {
        getMappingStub.resolves(answer());

        expect(await run()).to.equal(false);
        expect(upnpService.routerLeases.renews).to.equal(false);
      });
    });

    it('should know the router does not renew when it does not answer the lookup', async () => {
      getMappingStub.rejects(new Error('timeout of 10000ms exceeded'));

      expect(await run()).to.equal(false);
    });

    it('should know the router does not renew when it refuses the refresh', async () => {
      createMappingStub.onSecondCall().rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'AddPortMapping'));

      expect(await run()).to.equal(false);
      sinon.assert.notCalled(getMappingStub);
    });

    it('should remove its mapping when it ends, whatever it found', async () => {
      getMappingStub.resolves(null);

      await run();

      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: TEST_PORT, protocol: 'TCP' });
      expect(upnpService.mappedHere.has(TEST_PORT)).to.equal(false);
    });

    it('should hold the test port as in use while it runs', async () => {
      const promise = upnpService.learnLeaseRenewal(APIPORT);
      await clock.tickAsync(40_000);
      expect(upnpService.mappedHere.has(TEST_PORT)).to.equal(true);
      await clock.tickAsync(35_000);
      await promise;
      expect(upnpService.mappedHere.has(TEST_PORT)).to.equal(false);
    });

    it('should remove nothing, and release the port, when the router refuses the first mapping', async () => {
      createMappingStub.rejects(new natUpnp.UpnpError(718, 'ConflictInMappingEntry', 'AddPortMapping'));

      expect(await run()).to.equal(false);
      sinon.assert.calledOnce(createMappingStub);
      sinon.assert.notCalled(removeMappingStub);
      expect(upnpService.mappedHere.has(TEST_PORT)).to.equal(false);
    });

    [null, false].forEach((kept) => {
      it(`should map nothing, and know long-lived mappings are permanent, on a router ${kept === null ? 'not known to keep' : 'known to drop'} a lease`, async () => {
        upnpService.routerLeases.kept = kept;

        expect(await run()).to.equal(false);
        expect(upnpService.routerLeases.renews).to.equal(false);
        sinon.assert.notCalled(createMappingStub);
      });
    });

    it('should not record an answer that arrives after UPnP was verified again', async () => {
      const promise = upnpService.learnLeaseRenewal(APIPORT);
      await clock.tickAsync(40_000);
      upnpService.routerLeases.generation += 1;
      upnpService.routerLeases.renews = null;
      await clock.tickAsync(35_000);
      await promise;

      expect(upnpService.routerLeases.renews).to.equal(null);
    });
  });

  describe('removeStaleMappings tests', () => {
    const BUDGET_MS = 75 * 1000;
    const LISTING_MS = 60 * 1000;
    let getMappingsStub;
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

    const refused = () => new natUpnp.UpnpError(501, 'ActionFailed', 'DeletePortMapping');
    // a request the router never answers: it ends when its signal aborts, as
    // the library's requests do
    const unanswered = ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    const routerHas = (mappings) => { table = mappings; };

    beforeEach(() => {
      upnpService.mappedHere.clear();
      clock = sinon.useFakeTimers();
      // the fake clock does not drive AbortSignal.timeout's own timer
      sinon.stub(AbortSignal, 'timeout').callsFake((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms);
        return controller.signal;
      });
      sinon.stub(serviceHelper, 'delay').resolves();
      table = [];
      getMappingsStub = sinon.stub(natUpnp.Client.prototype, 'getMappings')
        .callsFake(async (options) => table.filter((m) => !options.local || m.local === true));
      removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').resolves();
    });

    afterEach(() => {
      fluxadmPortStub.isArcane = false;
      sinon.restore();
    });

    it('should list only the router\'s mappings to this node, and remove the stale one', async () => {
      routerHas([mapping(31000, 'Flux_App_gone'), mapping(31001, 'Flux_App_sibling', { local: false, private: { host: '192.168.1.11', port: 31001 } })]);

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      sinon.assert.calledOnceWithExactly(getMappingsStub, { local: true, signal: sinon.match.instanceOf(AbortSignal) });
      expect(removed).to.equal(1);
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: { host: '', port: 31000 }, protocol: 'TCP', signal: sinon.match.instanceOf(AbortSignal) });
    });

    it('should know its own mappings as a FRITZ!Box stores their descriptions, and nothing else', async () => {
      // FRITZ!Box rewrites the punctuation: 'Flux_App_gone' comes back 'Flux.App.gone'
      routerHas([
        mapping(31000, 'Flux.App.gone'),
        mapping(31001, 'Flux.Prelaunch.App.31001'),
        mapping(31002, 'Flux.Test.App'),
        mapping(31003, 'Flux.manual.entry'),
        mapping(31004, 'FluxOS.Reserved'),
      ]);

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(3);
      const removedPorts = removeMappingStub.getCalls().map((call) => call.args[0].public.port);
      expect(removedPorts).to.deep.equal([31000, 31001, 31002]);
    });

    it('should give the router\'s requests whole-millisecond timeouts from a budget that halves to a fraction', async () => {
      routerHas([mapping(31000, 'Flux_App_gone')]);

      const removed = await upnpService.removeStaleMappings(async () => [16127], 29_999);

      expect(removed).to.equal(1);
      const timeouts = AbortSignal.timeout.getCalls().map((call) => call.args[0]);
      expect(timeouts).to.have.length(2);
      timeouts.forEach((ms) => expect(Number.isInteger(ms), `${ms} ms`).to.equal(true));
    });

    it('should remove nothing from an empty table', async () => {
      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(0);
      sinon.assert.calledOnce(getMappingsStub);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should remove a stale mapping on the one pass, by its own protocol', async () => {
      routerHas([mapping(31000, 'Flux_App_gone', { protocol: 'udp' })]);

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(1);
      sinon.assert.calledOnceWithExactly(removeMappingStub, { public: { host: '', port: 31000 }, protocol: 'UDP', signal: sinon.match.instanceOf(AbortSignal) });
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

    it('should never touch the operator\'s manual entries or anything it did not make', async () => {
      routerHas([
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
      removeMappingStub.onFirstCall().rejects(refused());
      const warnSpy = sinon.spy(log, 'warn');

      const removed = await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS);

      expect(removed).to.equal(1);
      sinon.assert.calledTwice(removeMappingStub);
      sinon.assert.calledOnce(warnSpy);
    });

    it('should reject, and remove nothing, when the listing fails', async () => {
      getMappingsStub.rejects(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

      let error;
      await upnpService.removeStaleMappings(async () => [16127], BUDGET_MS).catch((err) => { error = err; });

      expect(error.message).to.equal('socket hang up');
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should ask what is held only after the router has been listed', async () => {
      routerHas([mapping(31000, 'Flux_App_a')]);
      let listingsBeforeHeld;
      const held = sinon.stub().callsFake(async () => { listingsBeforeHeld = getMappingsStub.callCount; return [16127]; });

      await upnpService.removeStaleMappings(held, BUDGET_MS);

      expect(listingsBeforeHeld).to.equal(1);
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
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(mapping(31000, 'Flux_App_gone'));
      await upnpService.mapUpnpPort(31000, 'Flux_App_gone');
      removeMappingStub.onFirstCall().rejects(refused());
      await upnpService.removeMapUpnpPort(31000);
      removeMappingStub.reset();
      removeMappingStub.resolves();
      routerHas([mapping(31000, 'Flux_App_gone')]);

      const removed = await upnpService.removeStaleMappings(async () => [], BUDGET_MS);

      expect(removed).to.equal(1);
      sinon.assert.calledOnce(removeMappingStub);
    });

    it('should give the listing its 60s of the 75s slot, and remove nothing when it does not finish', async () => {
      routerHas([mapping(31000, 'Flux_App_a')]);
      getMappingsStub.callsFake(unanswered);

      let error;
      const passing = upnpService.removeStaleMappings(async () => [], BUDGET_MS).catch((err) => { error = err; });
      await clock.tickAsync(LISTING_MS - 1);
      expect(error).to.equal(undefined);
      await clock.tickAsync(1);
      await passing;

      expect(error.name).to.equal('TimeoutError');
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should step past a refused removal but end the pass on one the router does not answer', async () => {
      routerHas([mapping(31000, 'Flux_App_a'), mapping(31001, 'Flux_App_b'), mapping(31002, 'Flux_App_c')]);
      removeMappingStub.onFirstCall().rejects(refused());
      removeMappingStub.onSecondCall().callsFake(unanswered);

      const passing = upnpService.removeStaleMappings(async () => [], BUDGET_MS);
      await clock.tickAsync(BUDGET_MS);
      const removed = await passing;

      expect(removed).to.equal(0);
      sinon.assert.calledTwice(removeMappingStub);
    });

    it('should end the pass on a removal that fails without a UPnP error', async () => {
      routerHas([mapping(31000, 'Flux_App_a'), mapping(31001, 'Flux_App_b')]);
      removeMappingStub.onFirstCall().rejects(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

      const removed = await upnpService.removeStaleMappings(async () => [], BUDGET_MS);

      expect(removed).to.equal(0);
      sinon.assert.calledOnce(removeMappingStub);
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

    it('should answer with the gateway\'s description and services and this node\'s address', async () => {
      const device = new natUpnp.Device(GATEWAY_URL);
      getGatewaySpy.resolves(new natUpnp.UpnpInfo(device, '192.168.1.10'));
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();

      await upnpService.getGatewayApi({ params: {}, query: {} }, res);

      sinon.assert.calledOnce(getGatewaySpy);
      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { gateway: { description: GATEWAY_URL, services: device.services }, address: '192.168.1.10' },
      });
    });

    it('should reach the router at config.upnp.gatewayUrl as config.upnp.nodeIp, without discovering it', async () => {
      getGatewaySpy.restore();
      verifyPrivilegeStub.resolves(true);
      const res = generateResponse();

      await upnpServiceAtGatewayUrl.getGatewayApi({ params: {}, query: {} }, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { gateway: { description: GATEWAY_URL, services: new natUpnp.Device(GATEWAY_URL).services }, address: '192.168.1.10' },
      });
    });
  });
});
