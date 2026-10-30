/* eslint-disable no-restricted-syntax */
const chai = require('chai');
const natUpnp = require('@runonflux/nat-upnp');
const sinon = require('sinon');
const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const upnpRouter = require('../../ZelBack/src/services/upnpRouter');
const portReconciler = require('../../ZelBack/src/services/portReconciler');
const upnpMappingRecord = require('../../ZelBack/src/services/upnpMappingRecord');
const config = require('config');

const { upnp: { testMappingLeaseS: TEST_LEASE_S } } = config;

const { expect } = chai;

describe('portReconciler tests', () => {
  // the record of this node's mappings, kept by the router's client on every add
  // and removal, is upnpMappingRecord's own to test
  beforeEach(() => {
    sinon.stub(upnpMappingRecord, 'mapping').resolves();
    sinon.stub(upnpMappingRecord, 'removed').resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('want tests', () => {
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
      portReconciler.wanted.clear();
      portReconciler.wantedMaps.clear();
      upnpRouter.routerLeases.kept = null;
      upnpRouter.routerLeases.renews = null;
      logSpy = sinon.spy(log, 'error');
      sinon.stub(serviceHelper, 'delay').resolves();
      createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      getMappingStub = sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should map TCP and then UDP, port for port, with no lease', async () => {
      const result = await portReconciler.want(123, 'some description');

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
      portReconciler.mappedProtocols.clear();
      const result = await portReconciler.want(123, 'Flux_Test_App', { protocols: ['TCP'] });

      expect(result.mapped).to.equal(true);
      sinon.assert.calledOnceWithExactly(createMappingStub, {
        public: 123, private: 123, ttl: TEST_LEASE_S, protocol: 'TCP', description: 'Flux_Test_App',
      });
      expect([...portReconciler.mappedProtocols.get(123)]).to.deep.equal(['TCP']);
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
          await portReconciler.want(123, description);

          expect(ttls()).to.deep.equal([TEST_LEASE_S, TEST_LEASE_S]);
        });
      });

      it('should lease a test mapping on a router known to keep a lease', async () => {
        upnpRouter.routerLeases.kept = true;

        await portReconciler.want(123, 'Flux_Test_App');

        expect(ttls()).to.deep.equal([TEST_LEASE_S, TEST_LEASE_S]);
      });

      it('should map a test mapping without a lease on a router known to drop one', async () => {
        upnpRouter.routerLeases.kept = false;

        await portReconciler.want(123, 'Flux_Test_App');

        expect(ttls()).to.deep.equal([0, 0]);
      });

      ['Flux_App_web', 'Flux_Backend_API', 'Flux_Syncthing'].forEach((description) => {
        it(`should not give the test lease to a mapping that is not a test's: ${description}`, async () => {
          upnpRouter.routerLeases.kept = true;

          await portReconciler.want(123, description);

          expect(ttls()).to.deep.equal([0, 0]);
        });
      });

      [402, 501, 606, 725].forEach((code) => {
        it(`should map without a lease, and know the router refuses one, when it refuses a leased mapping with ${code}`, async () => {
          createMappingStub.onFirstCall().rejects(refusal(code, 'ActionFailed'));

          const result = await portReconciler.want(123, 'Flux_Test_App');

          expect(result.mapped).to.equal(true);
          expect(upnpRouter.routerLeases.kept).to.equal(false);
          // the refused protocol asked once more without a lease, and the next asked without one at once
          expect(ttls()).to.deep.equal([TEST_LEASE_S, 0, 0]);
          expect([...portReconciler.mappedProtocols.get(123)]).to.deep.equal(['TCP', 'UDP']);
        });
      });

      [
        [718, 'ConflictInMappingEntry'],
        [728, 'NoPortMapsAvailable'],
        [729, 'ConflictWithOtherMechanisms'],
      ].forEach(([code, description]) => {
        it(`should not ask again without a lease when the router refuses with ${code}, which says nothing of the lease`, async () => {
          createMappingStub.rejects(refusal(code, description));

          const result = await portReconciler.want(123, 'Flux_Test_App');

          expect(result).to.include({ mapped: false, code });
          expect(ttls()).to.deep.equal([TEST_LEASE_S]);
          expect(upnpRouter.routerLeases.kept).to.equal(null);
        });
      });

      it('should report the refusal of the mapping asked for without a lease, and learn nothing, when both are refused', async () => {
        createMappingStub.onFirstCall().rejects(refusal(501, 'ActionFailed'));
        createMappingStub.onSecondCall().rejects(refusal(402, 'InvalidArgs'));

        const result = await portReconciler.want(123, 'Flux_Test_App');

        expect(result).to.include({ mapped: false, code: 402 });
        expect(ttls()).to.deep.equal([TEST_LEASE_S, 0]);
        expect(upnpRouter.routerLeases.kept).to.equal(null);
      });

      it('should not ask again without a lease when the router does not answer', async () => {
        createMappingStub.rejects(new Error('timeout of 10000ms exceeded'));

        const result = await portReconciler.want(123, 'Flux_Test_App');

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
          upnpRouter.routerLeases.kept = true;
          upnpRouter.routerLeases.renews = true;

          await portReconciler.want(123, description);

          expect(ttls()).to.deep.equal([LONG_LEASE_S, LONG_LEASE_S]);
        });
      });

      [null, false].forEach((renews) => {
        it(`should map a long-lived mapping without a lease while renewal is ${renews === null ? 'not known' : 'known not to happen'}`, async () => {
          upnpRouter.routerLeases.kept = true;
          upnpRouter.routerLeases.renews = renews;

          await portReconciler.want(123, 'Flux_App_web');

          expect(ttls()).to.deep.equal([0, 0]);
        });
      });

      ['Flux_manual_entry', 'some description'].forEach((description) => {
        it(`should never lease a mapping that is neither a test's nor long-lived: ${description}`, async () => {
          upnpRouter.routerLeases.kept = true;
          upnpRouter.routerLeases.renews = true;

          await portReconciler.want(123, description);

          expect(ttls()).to.deep.equal([0, 0]);
        });
      });

      it('should map without a lease, and know long-lived mappings are permanent, when the router refuses the lease', async () => {
        upnpRouter.routerLeases.kept = true;
        upnpRouter.routerLeases.renews = true;
        createMappingStub.onFirstCall().rejects(refusal(725, 'OnlyPermanentLeasesSupported'));

        const result = await portReconciler.want(123, 'Flux_App_web');

        expect(result.mapped).to.equal(true);
        expect(upnpRouter.routerLeases.renews).to.equal(false);
        expect(upnpRouter.routerLeases.kept).to.equal(true);
        expect(ttls()).to.deep.equal([LONG_LEASE_S, 0, 0]);
      });
    });

    it('should signal each refusal it counts as the router\'s, and no other', async () => {
      const onRefused = sinon.spy();
      upnpRouter.routerEvents.on('mappingRefused', onRefused);
      try {
        createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry'));
        getMappingStub.resolves(entry({ private: { host: '192.168.1.20', port: 123 }, local: false }));
        await portReconciler.want(123, 'Flux_App_web');
        sinon.assert.notCalled(onRefused);

        createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
        getMappingStub.resolves(null);
        await portReconciler.want(124, 'Flux_App_web');
        await portReconciler.want(125, 'Flux_App_web');
        sinon.assert.calledTwice(onRefused);
      } finally {
        upnpRouter.routerEvents.off('mappingRefused', onRefused);
      }
    });

    it('should not ask for UDP when TCP is refused', async () => {
      createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry'));

      const result = await portReconciler.want(123, 'Flux_App_web');

      expect(result.mapped).to.equal(false);
      sinon.assert.calledOnce(createMappingStub);
    });

    it('should give a port another machine holds as the port\'s refusal, not the router\'s', async () => {
      createMappingStub.onSecondCall().rejects(refusal(718, 'ConflictInMappingEntry'));
      getMappingStub.resolves(entry({ local: false, private: { host: '192.168.1.11', port: 123 } }));
      const before = upnpRouter.routerRefusals();

      const result = await portReconciler.want(123, 'Flux_App_web');

      expect(result).to.deep.equal({
        mapped: false,
        code: 718,
        reason: 'UDP 123 not mapped: UPnP error 718: ConflictInMappingEntry (action: AddPortMapping)',
        routerWide: false,
      });
      expect(upnpRouter.routerRefusals()).to.equal(before);
      sinon.assert.calledOnceWithExactly(logSpy, `UPnP - ${result.reason}`);
    });

    it('should count a full table as the router\'s refusal', async () => {
      createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
      const before = upnpRouter.routerRefusals();

      const result = await portReconciler.want(123, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: 728, routerWide: true });
      expect(upnpRouter.routerRefusals()).to.equal(before + 1);
    });

    it('should count a router that does not answer as the router\'s refusal, and not ask it again', async () => {
      createMappingStub.rejects(new Error('timeout of 10000ms exceeded'));
      const before = upnpRouter.routerRefusals();

      const result = await portReconciler.want(123, 'Flux_App_web');

      expect(result).to.deep.equal({
        mapped: false, code: null, reason: 'TCP 123 not mapped: timeout of 10000ms exceeded', routerWide: true,
      });
      expect(upnpRouter.routerRefusals()).to.equal(before + 1);
      sinon.assert.notCalled(getMappingStub);
    });

    [
      [501, 'ActionFailed'],
      [606, 'ActionNotAuthorized'],
    ].forEach(([code, description]) => {
      it(`should count a ${code} ${description} as the router's refusal`, async () => {
        createMappingStub.rejects(refusal(code, description));
        const before = upnpRouter.routerRefusals();

        const result = await portReconciler.want(123, 'Flux_App_web');

        expect(result).to.include({ mapped: false, code, routerWide: true });
        expect(upnpRouter.routerRefusals()).to.equal(before + 1);
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
        const before = upnpRouter.routerRefusals();

        const result = await portReconciler.want(123, 'Flux_App_web');

        expect(result).to.include({ mapped: false, code, routerWide: false });
        expect(upnpRouter.routerRefusals()).to.equal(before);
      });
    });

    [
      [501, 'ActionFailed'],
      [606, 'ActionNotAuthorized'],
    ].forEach(([code, description]) => {
      it(`should give a ${code} for a port another machine holds as the port's refusal, not the router's`, async () => {
        createMappingStub.rejects(refusal(code, description));
        getMappingStub.resolves(entry({ local: false, private: { host: '192.168.1.11', port: 123 } }));
        const before = upnpRouter.routerRefusals();

        const result = await portReconciler.want(123, 'Flux_App_web');

        expect(result).to.include({ mapped: false, code, routerWide: false });
        expect(upnpRouter.routerRefusals()).to.equal(before);
      });
    });

    it('should give a 501 for a port this node holds otherwise as the port\'s refusal, not the router\'s', async () => {
      createMappingStub.rejects(refusal(501, 'ActionFailed'));
      getMappingStub.resolves(entry({ private: { host: '192.168.1.10', port: 124 } }));
      const before = upnpRouter.routerRefusals();

      const result = await portReconciler.want(123, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: 501, routerWide: false });
      expect(upnpRouter.routerRefusals()).to.equal(before);
    });

    it('should count a 728 as the router\'s refusal even for a port another machine holds', async () => {
      createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
      getMappingStub.resolves(entry({ local: false, private: { host: '192.168.1.11', port: 123 } }));
      const before = upnpRouter.routerRefusals();

      const result = await portReconciler.want(123, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: 728, routerWide: true });
      expect(upnpRouter.routerRefusals()).to.equal(before + 1);
    });

    it('should take a refusal as mapped when the router already maps the port to this node', async () => {
      createMappingStub.rejects(refusal(728, 'NoPortMapsAvailable'));
      getMappingStub.callsFake(async ({ protocol }) => entry({ protocol: protocol.toLowerCase() }));
      const before = upnpRouter.routerRefusals();

      const result = await portReconciler.want(123, 'Flux_App_web');

      expect(result.mapped).to.equal(true);
      expect(upnpRouter.routerRefusals()).to.equal(before);
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

        const result = await portReconciler.want(123, 'Flux_App_web');

        expect(result).to.include({ mapped: false, code: 728 });
      });
    });

    it('should keep the refusal when the router cannot be asked for its entry', async () => {
      createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry'));
      getMappingStub.rejects(new Error('socket hang up'));

      const result = await portReconciler.want(123, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: 718 });
    });

    it('should ask the router nothing for what is not a port, and count nothing', async () => {
      const before = upnpRouter.routerRefusals();

      const result = await portReconciler.want(Number.NaN, 'Flux_App_web');

      expect(result).to.include({ mapped: false, code: null, routerWide: false });
      expect(upnpRouter.routerRefusals()).to.equal(before);
      sinon.assert.notCalled(createMappingStub);
    });

    it('should no longer hold a port it failed to map', async () => {
      createMappingStub.onSecondCall().rejects(refusal(718, 'ConflictInMappingEntry'));

      await portReconciler.want(123, 'Flux_App_web');

      expect(portReconciler.wanted.has(123)).to.equal(false);
    });

    it('should hold a port it mapped', async () => {
      await portReconciler.want(123, 'Flux_App_web');

      expect(portReconciler.wanted.has(123)).to.equal(true);
    });
  });

  describe('release tests', () => {
    let logSpy;
    let createMappingStub;
    let getMappingStub;
    let removeMappingStub;

    const refusal = (code, description, action) => new natUpnp.UpnpError(code, description, action);
    const removedProtocols = () => removeMappingStub.getCalls().map((call) => call.args[0].protocol);

    beforeEach(() => {
      portReconciler.wanted.clear();
      portReconciler.wantedMaps.clear();
      portReconciler.mappedProtocols.clear();
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
      await portReconciler.want(123, 'Flux_Test_App');
      getMappingStub.resetHistory();

      const result = await portReconciler.release(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(getMappingStub);
      sinon.assert.calledWithExactly(removeMappingStub.firstCall, { public: 123, protocol: 'TCP' });
      sinon.assert.calledWithExactly(removeMappingStub.secondCall, { public: 123, protocol: 'UDP' });
      sinon.assert.notCalled(logSpy);
    });

    it('should remove the TCP half of a port whose UDP the router refused', async () => {
      createMappingStub.onSecondCall().rejects(refusal(718, 'ConflictInMappingEntry', 'AddPortMapping'));
      await portReconciler.want(123, 'Flux_Test_App');

      await portReconciler.release(123);

      expect(removedProtocols()).to.deep.equal(['TCP']);
    });

    it('should ask the router to remove nothing of a port it refused to map here', async () => {
      createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry', 'AddPortMapping'));
      await portReconciler.want(123, 'Flux_Test_App');

      const result = await portReconciler.release(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should ask the router to remove nothing of a port this node never mapped', async () => {
      const result = await portReconciler.release(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(removeMappingStub);
    });

    it('should forget a protocol whose latest map the router refused', async () => {
      await portReconciler.want(123, 'Flux_App_web');
      createMappingStub.rejects(refusal(718, 'ConflictInMappingEntry', 'AddPortMapping'));
      await portReconciler.want(123, 'Flux_App_web');

      await portReconciler.release(123);

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
      await portReconciler.want(123, 'Flux_App_web');

      await portReconciler.release(123);

      expect(removedProtocols()).to.deep.equal(['TCP', 'UDP']);
    });

    it('should remove UDP when the router refuses to remove TCP, and report the port not removed', async () => {
      await portReconciler.want(123, 'Flux_Test_App');
      removeMappingStub.withArgs({ public: 123, protocol: 'TCP' }).rejects(refusal(501, 'ActionFailed', 'DeletePortMapping'));

      const result = await portReconciler.release(123);

      expect(result).to.equal(false);
      expect(removedProtocols()).to.deep.equal(['TCP', 'UDP']);
      sinon.assert.calledOnceWithExactly(logSpy, 'UPnP - TCP 123 not unmapped: UPnP error 501: ActionFailed (action: DeletePortMapping)');
    });

    it('should take a removal the router has no entry for as removed', async () => {
      await portReconciler.want(123, 'Flux_Test_App');
      removeMappingStub.rejects(refusal(714, 'NoSuchEntryInArray', 'DeletePortMapping'));

      const result = await portReconciler.release(123);

      expect(result).to.equal(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should ask a second removal of the same port for nothing', async () => {
      await portReconciler.want(123, 'Flux_Test_App');
      await portReconciler.release(123);
      removeMappingStub.resetHistory();

      await portReconciler.release(123);

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
      await portReconciler.want(port, description);
      getMappingStub.resetHistory();
    };

    beforeEach(() => {
      portReconciler.wanted.clear();
      portReconciler.wantedMaps.clear();
      portReconciler.mappedProtocols.clear();
      portReconciler.releasedPorts.clear();
      portReconciler.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      portReconciler.pendingRemovals.clear();
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
      portReconciler.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      portReconciler.pendingRemovals.clear();
      clock.restore();
      sinon.restore();
    });

    it('leaves a port released and not mapped since alone on a refresh, and its pending removal with it', async () => {
      await portReconciler.want(777, 'Flux_App_web');
      removeMappingStub.rejects(refused());
      await portReconciler.release(777, 'Flux_App_web');
      createMappingStub.resetHistory();

      const result = await portReconciler.keep(777, 'Flux_App_web');

      expect(result.released).to.equal(true);
      sinon.assert.notCalled(createMappingStub);
      expect([...portReconciler.pendingRemovals.keys()].sort()).to.deep.equal(['777/TCP', '777/UDP']);
    });

    it('refreshes a released port once it is mapped again', async () => {
      await portReconciler.want(778, 'Flux_App_web');
      removeMappingStub.rejects(refused());
      await portReconciler.release(778, 'Flux_App_web');
      await portReconciler.want(778, 'Flux_App_web');
      // mapped more than a refresh cycle ago
      portReconciler.wantedMaps.delete(778);
      createMappingStub.resetHistory();

      const result = await portReconciler.keep(778, 'Flux_App_web');

      expect(result.mapped).to.equal(true);
      sinon.assert.called(createMappingStub);
    });

    it('should ask the router again for a removal it refused, waiting longer each time, until it goes', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(refused());
      removeMappingStub.onCall(2).rejects(refused());

      expect(await portReconciler.release(123, 'Flux_Test_App')).to.equal(false);
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
      expect(portReconciler.pendingRemovals.size).to.equal(0);

      await clock.tickAsync(MAX_MS * 2);
      expect(removals().length, 'nothing once removed').to.equal(4);
    });

    it('should never give up, and wait no longer than the cap between asks', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.rejects(refused());
      await portReconciler.release(123, 'Flux_Test_App');

      // 30s, then 1m each
      await clock.tickAsync(FIRST_MS);
      expect(removals().length).to.equal(2);
      await clock.tickAsync(MAX_MS - 1);
      expect(removals().length).to.equal(2);
      await clock.tickAsync(1);
      expect(removals().length).to.equal(3);
      await clock.tickAsync(MAX_MS * 10);
      expect(removals().length, 'still asking').to.equal(13);
      expect(portReconciler.pendingRemovals.has('123/TCP')).to.equal(true);
    });

    it('should take a router that holds no such entry as removed', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(new natUpnp.UpnpError(714, 'NoSuchEntryInArray', 'DeletePortMapping'));
      await portReconciler.release(123, 'Flux_Test_App');

      await clock.tickAsync(FIRST_MS);
      expect(portReconciler.pendingRemovals.size).to.equal(0);
      await clock.tickAsync(MAX_MS);
      expect(removals().length).to.equal(2);
    });

    it('should remove a pending test mapping once more before the port is mapped for an app, then drop it', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      await portReconciler.release(123, 'Flux_Test_App');
      const before = createMappingStub.callCount;

      await portReconciler.want(123, 'Flux_App_web', { protocols: ['TCP'] });
      await clock.tickAsync(MAX_MS);

      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(createMappingStub.getCall(before).args[0]).to.include({ public: 123, protocol: 'TCP', description: 'Flux_App_web' });
      expect(removeMappingStub.secondCall.callId, 'removed before mapped').to.be.below(createMappingStub.getCall(before).callId);
      expect(portReconciler.pendingRemovals.size).to.equal(0);
    });

    it('should map an app over a test mapping the router refuses to remove again, and drop the removal', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(refused());
      await portReconciler.release(123, 'Flux_Test_App');

      const result = await portReconciler.want(123, 'Flux_App_web', { protocols: ['TCP'] });
      await clock.tickAsync(MAX_MS);

      expect(result.mapped).to.equal(true);
      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(portReconciler.pendingRemovals.size).to.equal(0);
    });

    it('should drop a pending removal without asking when a test maps the port again', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      await portReconciler.release(123, 'Flux_Test_App');

      await portReconciler.want(123, 'Flux_Test_App');
      await clock.tickAsync(MAX_MS);

      expect(removals()).to.deep.equal(['123/TCP']);
      expect(portReconciler.pendingRemovals.size).to.equal(0);
    });

    it('should drop a pending removal of an app mapping without asking when the port is mapped again', async () => {
      await mapTcpOnly(123, 'Flux_App_old');
      removeMappingStub.onCall(0).rejects(refused());
      await portReconciler.release(123, 'Flux_App_old');

      await portReconciler.want(123, 'Flux_App_web');
      await clock.tickAsync(MAX_MS);

      expect(removals()).to.deep.equal(['123/TCP']);
      expect(portReconciler.pendingRemovals.size).to.equal(0);
    });

    it('should ask for pending removals one at a time', async () => {
      await mapTcpOnly(123, 'Flux_Test_App');
      await mapTcpOnly(124, 'Flux_Test_App');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(refused());
      await portReconciler.release(123, 'Flux_Test_App');
      await portReconciler.release(124, 'Flux_Test_App');
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
      await portReconciler.want(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(refused());
      await portReconciler.release(123, 'Flux_App_web');

      expect([...portReconciler.pendingRemovals.keys()].sort()).to.deep.equal(['123/TCP', '123/UDP']);
      await clock.tickAsync(FIRST_MS);
      expect(removals().slice(2).sort()).to.deep.equal(['123/TCP', '123/UDP']);
      expect(portReconciler.pendingRemovals.size).to.equal(0);
    });

    it('should keep a pending removal when the port is removed again with nothing mapped since', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      await portReconciler.release(123, 'Flux_App_web');

      expect(await portReconciler.release(123, 'Flux_App_web')).to.equal(true);
      await clock.tickAsync(FIRST_MS);

      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(portReconciler.pendingRemovals.size).to.equal(0);
    });

    it('should say a removal is pending until the router has removed it, whatever the mapping', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      await portReconciler.release(123, 'Flux_App_web');
      expect(portReconciler.removalPending()).to.equal(true);

      await clock.tickAsync(FIRST_MS);
      expect(portReconciler.removalPending(), 'removed on the next ask').to.equal(false);
    });

    it('should say pending when the first removal is refused, and clear when the last goes', async () => {
      const events = [];
      const onPending = () => events.push('pending');
      const onClear = () => events.push('clear');
      upnpRouter.routerEvents.on('removalPending', onPending);
      upnpRouter.routerEvents.on('removalsClear', onClear);
      try {
        await mapTcpOnly(123, 'Flux_App_web');
        await mapTcpOnly(124, 'Flux_Test_App');
        removeMappingStub.onCall(0).rejects(refused());
        removeMappingStub.onCall(1).rejects(refused());
        removeMappingStub.onCall(2).rejects(refused());
        await portReconciler.release(123, 'Flux_App_web');
        await portReconciler.release(124, 'Flux_Test_App');
        expect(events, 'once, for the first').to.deep.equal(['pending']);

        await clock.tickAsync(FIRST_MS);
        expect(events, 'one still pending').to.deep.equal(['pending']);
        await clock.tickAsync(MAX_MS);
        expect(events).to.deep.equal(['pending', 'clear']);
      } finally {
        upnpRouter.routerEvents.off('removalPending', onPending);
        upnpRouter.routerEvents.off('removalsClear', onClear);
      }
    });

    it('should clear when the port of the last pending removal is mapped again', async () => {
      const onClear = sinon.spy();
      upnpRouter.routerEvents.on('removalsClear', onClear);
      try {
        await mapTcpOnly(123, 'Flux_App_web');
        removeMappingStub.onCall(0).rejects(refused());
        await portReconciler.release(123, 'Flux_App_web');

        await portReconciler.want(123, 'Flux_App_web');

        sinon.assert.calledOnce(onClear);
        expect(portReconciler.removalPending()).to.equal(false);
      } finally {
        upnpRouter.routerEvents.off('removalsClear', onClear);
      }
    });
  
    it('should look the entry up before each ask, and remove it only while it is this node\'s', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      await portReconciler.release(123, 'Flux_App_web');
      expect(lookups(), 'the first removal asks nothing first').to.deep.equal([]);

      await clock.tickAsync(FIRST_MS);

      expect(lookups()).to.deep.equal(['123/TCP']);
      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(portReconciler.pendingRemovals.size).to.equal(0);
    });

    it('should end a removal with nothing sent when the router no longer holds the entry, whatever it answers to a removal', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.rejects(refused());
      await portReconciler.release(123, 'Flux_App_web');
      getMappingStub.resolves(null);

      await clock.tickAsync(FIRST_MS);

      expect(removals(), 'no removal after the lookup').to.deep.equal(['123/TCP']);
      expect(portReconciler.removalPending()).to.equal(false);
      await clock.tickAsync(MAX_MS * 5);
      expect(lookups(), 'asked nothing more').to.have.length(1);
    });

    it('should end a removal with nothing sent when the router holds the port for something else', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      await portReconciler.release(123, 'Flux_App_web');
      getMappingStub.callsFake(async ({ public: port, protocol }) => entry(port, protocol, { private: { host: '192.168.1.11', port }, local: false }));

      await clock.tickAsync(FIRST_MS);

      expect(removals()).to.deep.equal(['123/TCP']);
      expect(portReconciler.removalPending()).to.equal(false);
    });

    it('should send the removal when the router answers the lookup with a fault, and keep it pending while the removal is refused', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.rejects(refused());
      await portReconciler.release(123, 'Flux_App_web');
      getMappingStub.rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'GetSpecificPortMappingEntry'));

      await clock.tickAsync(FIRST_MS);

      expect(removals(), 'a lookup it did not settle leaves the mapping counted as this node\'s').to.deep.equal(['123/TCP', '123/TCP']);
      expect(portReconciler.removalPending()).to.equal(true);

      removeMappingStub.resolves();
      await clock.tickAsync(MAX_MS);
      expect(removals()).to.have.length(3);
      expect(portReconciler.removalPending(), 'ended once the router removed it').to.equal(false);
    });

    it('should end a removal whose lookup the router answers with a fault once it answers the removal with no such entry', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.onCall(0).rejects(refused());
      removeMappingStub.onCall(1).rejects(new natUpnp.UpnpError(714, 'NoSuchEntryInArray', 'DeletePortMapping'));
      await portReconciler.release(123, 'Flux_App_web');
      getMappingStub.rejects(new natUpnp.UpnpError(501, 'ActionFailed', 'GetSpecificPortMappingEntry'));

      await clock.tickAsync(FIRST_MS);

      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(portReconciler.removalPending()).to.equal(false);
    });

    it('should send the removal while the router does not answer the lookup, and keep it pending while the removal is refused', async () => {
      await mapTcpOnly(123, 'Flux_App_web');
      removeMappingStub.rejects(refused());
      await portReconciler.release(123, 'Flux_App_web');
      getMappingStub.rejects(new Error('timeout of 10000ms exceeded'));

      await clock.tickAsync(FIRST_MS);
      expect(removals()).to.deep.equal(['123/TCP', '123/TCP']);
      expect(portReconciler.removalPending()).to.equal(true);

      removeMappingStub.resolves();
      await clock.tickAsync(MAX_MS);
      expect(portReconciler.removalPending(), 'ended once the router removed it').to.equal(false);
    });
  });

  describe('the lane', () => {
    let calls;
    let inFlight;
    let most;
    let createMappingStub;
    let removeMappingStub;
    let getMappingStub;

    const refused = () => new natUpnp.UpnpError(501, 'ActionFailed', 'DeletePortMapping');
    const gate = () => {
      let open;
      const opened = new Promise((resolve) => { open = resolve; });
      return { opened, open };
    };
    // A router request settles in the order the router answers, so each is
    // recorded once answered.
    const answered = (what) => async ({ public: port, protocol }) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      calls.push(`${what} ${port}/${protocol}`);
    };
    // The next request of `stub` waits for the gate before it is answered.
    const holdNext = (stub, what) => {
      const held = gate();
      const answer = answered(what);
      stub.callsFake(async (args) => {
        stub.callsFake(answer);
        inFlight += 1;
        most = Math.max(most, inFlight);
        await held.opened;
        inFlight -= 1;
        calls.push(`${what} ${args.public}/${args.protocol}`);
      });
      return held;
    };
    const settle = () => new Promise((resolve) => { setImmediate(resolve); });

    beforeEach(() => {
      portReconciler.wanted.clear();
      portReconciler.wantedMaps.clear();
      portReconciler.mappedProtocols.clear();
      portReconciler.releasedPorts.clear();
      portReconciler.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      portReconciler.pendingRemovals.clear();
      upnpRouter.routerLeases.kept = null;
      upnpRouter.routerLeases.renews = null;
      calls = [];
      inFlight = 0;
      most = 0;
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(log, 'error');
      sinon.stub(log, 'info');
      sinon.stub(log, 'warn');
      createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').callsFake(answered('map'));
      removeMappingStub = sinon.stub(natUpnp.Client.prototype, 'removeMapping').callsFake(answered('remove'));
      getMappingStub = sinon.stub(natUpnp.Client.prototype, 'getMapping').callsFake(async ({ public: port, protocol }) => ({
        public: { host: '', port },
        private: { host: '192.168.1.10', port },
        protocol: protocol.toLowerCase(),
        enabled: true,
        description: 'Flux_App_web',
        ttl: 0,
        local: true,
      }));
    });

    afterEach(() => {
      portReconciler.pendingRemovals.forEach((pending) => clearTimeout(pending.timer));
      portReconciler.pendingRemovals.clear();
      sinon.restore();
    });

    it('removes what a refresh mapped when the port is released while the refresh waits for the router', async () => {
      await portReconciler.want(31000, 'Flux_App_web');
      // mapped more than a refresh cycle ago
      portReconciler.wantedMaps.delete(31000);
      calls = [];
      const held = holdNext(createMappingStub, 'map');

      const refreshing = portReconciler.keep(31000, 'Flux_App_web');
      await settle();
      const releasing = portReconciler.release(31000, 'Flux_App_web');
      held.open();
      await Promise.all([refreshing, releasing]);

      expect(calls).to.deep.equal(['map 31000/TCP', 'map 31000/UDP', 'remove 31000/TCP', 'remove 31000/UDP']);
      expect(portReconciler.isWanted(31000)).to.equal(false);
      expect(portReconciler.mappedProtocols.has(31000)).to.equal(false);
    });

    it('removes every protocol an install maps when the port is released while the install waits for the router', async () => {
      const held = holdNext(createMappingStub, 'map');

      const installing = portReconciler.want(31001, 'Flux_App_web');
      await settle();
      const releasing = portReconciler.release(31001, 'Flux_App_web');
      held.open();
      await Promise.all([installing, releasing]);

      expect(calls).to.deep.equal(['map 31001/TCP', 'map 31001/UDP', 'remove 31001/TCP', 'remove 31001/UDP']);
    });

    it('maps a port wanted again after a pending removal\'s retry has asked the router about it', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        await portReconciler.want(31003, 'Flux_App_web');
        removeMappingStub.onFirstCall().rejects(refused());
        removeMappingStub.onSecondCall().rejects(refused());
        await portReconciler.release(31003, 'Flux_App_web');
        calls = [];
        const lookup = gate();
        getMappingStub.withArgs(sinon.match({ protocol: 'TCP' })).callsFake(async ({ public: port, protocol }) => {
          await lookup.opened;
          return {
            public: { host: '', port }, private: { host: '192.168.1.10', port }, protocol: protocol.toLowerCase(), enabled: true, description: 'Flux_App_web', ttl: 0, local: true,
          };
        });

        await clock.tickAsync(30 * 1000);
        sinon.assert.calledWithMatch(getMappingStub, { public: 31003, protocol: 'TCP' });
        const reinstalling = portReconciler.want(31003, 'Flux_App_web');
        lookup.open();
        await reinstalling;
        await settle();

        expect(calls).to.deep.equal(['remove 31003/TCP', 'map 31003/TCP', 'map 31003/UDP']);
        expect(portReconciler.pendingRemovals.size).to.equal(0);
      } finally {
        clock.restore();
      }
    });

    it('leaves a port to the holder that took it over when an earlier holder releases it', async () => {
      const earlier = {};
      const later = {};
      await portReconciler.hold(31004, 'Flux_UPNP_Mapping_Test', earlier);
      await portReconciler.want(31004, 'Flux_UPNP_Mapping_Test', { protocols: ['TCP'], holder: later });
      calls = [];

      expect(await portReconciler.release(31004, 'Flux_UPNP_Mapping_Test', { holder: earlier })).to.equal(true);

      expect(calls).to.deep.equal([]);
      expect(portReconciler.holds(31004, later)).to.equal(true);
    });

    it('leaves an installed port to its installation when a test that held it is released', async () => {
      const attempt = {};
      await portReconciler.want(31015, 'Flux_App_web', { holder: attempt });
      await portReconciler.want(31015, 'Flux_App_web');
      calls = [];

      await portReconciler.release(31015, 'Flux_App_web', { holder: attempt });

      expect(calls).to.deep.equal([]);
      expect(portReconciler.isWanted(31015)).to.equal(true);
    });

    it('lets no test take over a port an installation holds', async () => {
      const attempt = {};
      await portReconciler.want(31016, 'Flux_App_web');
      await portReconciler.want(31016, 'Flux_App_web', { holder: attempt });
      calls = [];

      await portReconciler.release(31016, 'Flux_App_web', { holder: attempt });

      expect(calls).to.deep.equal([]);
      expect(portReconciler.holds(31016, null)).to.equal(true);
    });

    it('keeps a held port wanted when its map is refused, until its holder releases it', async () => {
      const holder = {};
      createMappingStub.rejects(new natUpnp.UpnpError(728, 'NoPortMapsAvailable', 'AddPortMapping'));
      getMappingStub.resolves(null);

      const result = await portReconciler.want(31005, 'Flux_UPNP_Mapping_Test', { protocols: ['TCP'], holder });

      expect(result.mapped).to.equal(false);
      expect(portReconciler.holds(31005, holder)).to.equal(true);
      await portReconciler.release(31005, 'Flux_UPNP_Mapping_Test', { holder });
      expect(portReconciler.isWanted(31005)).to.equal(false);
    });

    it('no longer wants a port nothing holds when its map is refused', async () => {
      createMappingStub.rejects(new natUpnp.UpnpError(728, 'NoPortMapsAvailable', 'AddPortMapping'));
      getMappingStub.resolves(null);

      await portReconciler.want(31006, 'Flux_App_web');

      expect(portReconciler.isWanted(31006)).to.equal(false);
    });

    it('runs the turns a caller waits on before upkeep queued ahead of them', async () => {
      const held = holdNext(createMappingStub, 'map');
      const first = portReconciler.want(31007, 'Flux_App_web', { protocols: ['TCP'] });
      await settle();
      const upkeep = portReconciler.keep(31008, 'Flux_App_web', { protocols: ['TCP'] });
      const intent = portReconciler.want(31009, 'Flux_App_web', { protocols: ['TCP'] });
      held.open();
      await Promise.all([first, upkeep, intent]);

      expect(calls).to.deep.equal(['map 31007/TCP', 'map 31009/TCP', 'map 31008/TCP']);
    });

    it('sends the router one request at a time, whoever asks', async () => {
      await portReconciler.want(31010, 'Flux_App_web');
      const held = holdNext(createMappingStub, 'map');
      calls = [];
      most = 0;

      const asked = [
        portReconciler.want(31011, 'Flux_App_web'),
        portReconciler.release(31010, 'Flux_App_web'),
        portReconciler.keep(31012, 'Flux_App_web'),
        portReconciler.onRouter(() => natUpnp.Client.prototype.removeMapping({ public: 31013, protocol: 'TCP' })),
      ];
      await settle();
      held.open();
      await Promise.all(asked);

      expect(most, 'never two at once').to.equal(1);
      expect(calls).to.have.lengthOf(7);
    });

    it('settles a turn whose work throws with that error, and runs the next', async () => {
      const failing = portReconciler.onRouter(() => { throw new Error('refused'); });
      const next = portReconciler.want(31014, 'Flux_App_web', { protocols: ['TCP'] });

      const error = await failing.catch((e) => e);

      expect(error.message).to.equal('refused');
      expect((await next).mapped).to.equal(true);
    });
  });

  // A refresh does not repeat a mapping want made since the last refresh, and
  // renews every other.
  describe('a refresh after want', () => {
    const CYCLE_MS = config.fluxapps.portRestoreIntervalMs;
    const LONG_LEASE_S = config.upnp.longLivedLeaseS;
    let createMappingStub;
    let clock;
    const asked = () => createMappingStub.getCalls().map((call) => `${call.args[0].protocol} ${call.args[0].ttl}`);

    beforeEach(() => {
      portReconciler.wanted.clear();
      portReconciler.wantedMaps.clear();
      portReconciler.mappedProtocols.clear();
      portReconciler.releasedPorts.clear();
      upnpRouter.routerLeases.kept = true;
      upnpRouter.routerLeases.renews = null;
      clock = sinon.useFakeTimers({ toFake: ['hrtime'] });
      sinon.stub(serviceHelper, 'delay').resolves();
      sinon.stub(log, 'error');
      createMappingStub = sinon.stub(natUpnp.Client.prototype, 'createMapping').resolves();
      sinon.stub(natUpnp.Client.prototype, 'getMapping').resolves(null);
    });

    afterEach(() => {
      clock.restore();
      sinon.restore();
    });

    it('leaves a port want mapped less than a cycle ago as it is', async () => {
      await portReconciler.want(31020, 'Flux_App_web');
      createMappingStub.resetHistory();
      clock.tick(CYCLE_MS - 1);

      const result = await portReconciler.keep(31020, 'Flux_App_web');

      expect(result.mapped).to.equal(true);
      expect(asked()).to.deep.equal([]);
    });

    it('maps a port again a cycle after want mapped it', async () => {
      await portReconciler.want(31021, 'Flux_App_web');
      createMappingStub.resetHistory();
      clock.tick(CYCLE_MS);

      await portReconciler.keep(31021, 'Flux_App_web');

      expect(asked()).to.deep.equal(['TCP 0', 'UDP 0']);
    });

    // mapped permanently before the node learned its router renews a lease, and
    // given the lease by the next refresh
    it('maps a port again when the lease it would be given has changed since want mapped it', async () => {
      await portReconciler.want(31022, 'Flux_App_web');
      createMappingStub.resetHistory();
      upnpRouter.routerLeases.renews = true;

      await portReconciler.keep(31022, 'Flux_App_web');

      expect(asked()).to.deep.equal([`TCP ${LONG_LEASE_S}`, `UDP ${LONG_LEASE_S}`]);
    });

    // refreshes come a cycle apart, so a refresh's own map would read as made
    // this cycle at the next one, and every renewal would slip a cycle
    it('renews at every refresh a port its last refresh mapped', async () => {
      await portReconciler.want(31023, 'Flux_App_web');
      clock.tick(CYCLE_MS);
      await portReconciler.keep(31023, 'Flux_App_web');
      createMappingStub.resetHistory();
      clock.tick(CYCLE_MS - 1);

      await portReconciler.keep(31023, 'Flux_App_web');

      expect(asked()).to.deep.equal(['TCP 0', 'UDP 0']);
    });

    it('maps a port again over a protocol want did not map', async () => {
      await portReconciler.want(31024, 'Flux_App_web', { protocols: ['TCP'] });
      createMappingStub.resetHistory();

      await portReconciler.keep(31024, 'Flux_App_web');

      expect(asked()).to.deep.equal(['TCP 0', 'UDP 0']);
    });
  });
});
