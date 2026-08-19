const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('appEvacuationSafety tests', () => {
  let appEvacuationSafety;
  let fluxNetworkHelperStub;
  let globalStateStub;
  let deps;

  const LOCAL = '1.2.3.4:16127';

  function statelessSpec(overrides = {}) {
    return {
      name: 'plainapp',
      version: 8,
      compose: [{ name: 'web', containerData: '/data' }],
      ...overrides,
    };
  }

  function statefulSpec(overrides = {}) {
    return {
      name: 'palworld1',
      version: 8,
      compose: [{ name: 'server', containerData: 'g:/data' }],
      ...overrides,
    };
  }

  function locations(...ips) {
    return ips.map((ip, index) => ({ ip, runningSince: new Date(1700000000000 + index) }));
  }

  beforeEach(() => {
    fluxNetworkHelperStub = {
      getLocalSocketAddress: sinon.stub().resolves(LOCAL),
    };
    globalStateStub = {
      backupInProgress: [],
      restoreInProgress: [],
    };

    appEvacuationSafety = proxyquire('../../ZelBack/src/services/appLifecycle/appEvacuationSafety', {
      '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      '../fluxNetworkHelper': fluxNetworkHelperStub,
      '../utils/globalState': globalStateStub,
    });

    deps = {
      appLocation: sinon.stub(),
      getApplicationGlobalSpecifications: sinon.stub(),
      findSyncedPeer: sinon.stub().resolves({ deviceID: 'PEER1', globalBytes: 1024 }),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('refuses on anything it cannot establish', () => {
    it('refuses while a backup is running', async () => {
      globalStateStub.backupInProgress.push('plainapp');

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('backup');
    });

    it('refuses while a restore is running', async () => {
      globalStateStub.restoreInProgress.push('plainapp');

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('restore');
    });

    it('refuses when the global specification is unavailable', async () => {
      deps.getApplicationGlobalSpecifications.resolves(null);

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('specification');
    });

    it('refuses when this node does not know its own address', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statelessSpec());
      fluxNetworkHelperStub.getLocalSocketAddress.resolves(null);

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(false);
    });

    it('refuses on an empty location list rather than reading it as "runs nowhere"', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statelessSpec());
      deps.appLocation.resolves([]);

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('no instance locations');
    });

    it('refuses when the safety check itself throws', async () => {
      deps.getApplicationGlobalSpecifications.rejects(new Error('db gone'));

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('db gone');
    });
  });

  describe('the app must be at full strength', () => {
    it('refuses while the app is already short, because another move is in flight', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statelessSpec({ instances: 3 }));
      deps.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127'));

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('below its instance count');
    });

    it('allows when the app is exactly at its instance count', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statelessSpec({ instances: 3 }));
      deps.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127', '9.9.9.9:16127'));

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(true);
    });

    it('falls back to the configured minimum when the spec names no instance count', async () => {
      // Must match the spawner's own `$ifNull: [instances, 3]`, or the departure
      // creates a deficit the spawner does not agree exists.
      deps.getApplicationGlobalSpecifications.resolves(statelessSpec());
      deps.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127'));

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('/3');
    });
  });

  describe('stateless apps', () => {
    it('may be given up even as the only instance, because there is no data to lose', async () => {
      // The 57 single-instance apps on residential nodes are all stateless. The
      // container is rebuilt from the specification elsewhere.
      deps.getApplicationGlobalSpecifications.resolves(statelessSpec({ instances: 1 }));
      deps.appLocation.resolves(locations(LOCAL));

      const result = await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      expect(result.safe).to.equal(true);
      expect(result.reason).to.contain('stateless');
    });

    it('never consults syncthing', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statelessSpec({ instances: 1 }));
      deps.appLocation.resolves(locations(LOCAL));

      await appEvacuationSafety.canSafelyRemoveApp('plainapp', deps);

      sinon.assert.notCalled(deps.findSyncedPeer);
    });
  });

  describe('stateful apps', () => {
    it('is refused when no other host holds it', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statefulSpec({ instances: 1 }));
      deps.appLocation.resolves(locations(LOCAL));

      const result = await appEvacuationSafety.canSafelyRemoveApp('palworld1', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('only host');
    });

    it('is refused when no connected peer holds the folder in full', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statefulSpec({ instances: 2 }));
      deps.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127'));
      deps.findSyncedPeer.resolves(null);

      const result = await appEvacuationSafety.canSafelyRemoveApp('palworld1', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('no connected peer');
    });

    it('is allowed when a connected peer holds every synced folder', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statefulSpec({ instances: 2 }));
      deps.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127'));

      const result = await appEvacuationSafety.canSafelyRemoveApp('palworld1', deps);

      expect(result.safe).to.equal(true);
      sinon.assert.calledWith(deps.findSyncedPeer, 'fluxserver_palworld1');
    });

    it('requires EVERY synced component to be held, not just the first', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statefulSpec({
        instances: 2,
        compose: [
          { name: 'server', containerData: 'g:/data' },
          { name: 'db', containerData: 'r:/var/lib/mysql' },
        ],
      }));
      deps.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127'));
      deps.findSyncedPeer.onFirstCall().resolves({ deviceID: 'PEER1', globalBytes: 1 });
      deps.findSyncedPeer.onSecondCall().resolves(null);

      const result = await appEvacuationSafety.canSafelyRemoveApp('palworld1', deps);

      expect(result.safe).to.equal(false);
    });

    it('refuses when this node is the elected primary', async () => {
      deps.getApplicationGlobalSpecifications.resolves(statefulSpec({ instances: 2 }));
      deps.appLocation.resolves(locations(LOCAL, '5.6.7.8:16127'));
      deps.isElectedPrimary = sinon.stub().resolves(true);

      const result = await appEvacuationSafety.canSafelyRemoveApp('palworld1', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('primary');
    });
  });

  describe('instances are counted per host, not per node slot', () => {
    it('does not treat a second slot on our own machine as another copy', async () => {
      // 329 target slots sit on 148 machines. Two locations at one address fail
      // together and are being evacuated together, so they were never two copies.
      deps.getApplicationGlobalSpecifications.resolves(statefulSpec({ instances: 2 }));
      deps.appLocation.resolves(locations(LOCAL, '1.2.3.4:16137'));

      const result = await appEvacuationSafety.canSafelyRemoveApp('palworld1', deps);

      expect(result.safe).to.equal(false);
      expect(result.reason).to.contain('only host');
    });

    it('counts distinct hosts once each', () => {
      const counted = appEvacuationSafety.otherHostCount(
        locations(LOCAL, '5.6.7.8:16127', '5.6.7.8:16137', '9.9.9.9:16127'),
        LOCAL,
      );

      expect(counted).to.equal(2);
    });
  });

  describe('syncedComponents', () => {
    it('reads the sync mode through the mount parser, not a substring', () => {
      // `/dogs/data` contains "g:" nowhere but a naive check on the letter would
      // still trip; the canonical parser is what keeps this honest.
      const components = appEvacuationSafety.syncedComponents({
        name: 'app', version: 8, compose: [{ name: 'c', containerData: '/dogs/data' }],
      });

      expect(components).to.be.empty;
    });

    it('names the folder id each synced component owns', () => {
      const components = appEvacuationSafety.syncedComponents(statefulSpec());

      expect(components).to.have.lengthOf(1);
      expect(components[0].folderId).to.equal('fluxserver_palworld1');
      expect(components[0].syncMode).to.equal('g');
    });
  });
});
