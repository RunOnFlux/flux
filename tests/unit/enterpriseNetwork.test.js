const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const MODULE_PATH = '../../ZelBack/src/services/utils/enterpriseNetwork';

const OWNERS = ['ownerA', 'ownerB'];
const NODE_PUBKEYS = ['pubA', 'pubB'];
const NODE_OWNER_MAP = { pubA: ['ownerA'], pubB: ['ownerB'] };

function loadModule(overrides = {}) {
  const logStub = overrides.log || {
    error: sinon.stub(),
    info: sinon.stub(),
    warn: sinon.stub(),
  };

  const defaultConfig = {
    database: {
      appslocal: { database: 'localapps', collections: { appsInformation: 'zelappsinformation' } },
    },
    fluxapps: {
      spawnDelayMultiplier: 1,
    },
  };

  const stubs = {
    config: overrides.config || defaultConfig,
    './enterpriseConfig': overrides.enterpriseConfig || {
      getEnterpriseAppOwners: () => OWNERS,
      getEnterpriseNodesPublicKeys: () => NODE_PUBKEYS,
      getAllowedOwnersForNode: (pubKey) => NODE_OWNER_MAP[pubKey] || [],
    },
    '../dbHelper': overrides.dbHelper || {
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
      findInDatabase: sinon.stub().resolves([]),
    },
    '../fluxNetworkHelper': overrides.fluxNetworkHelper || {
      getFluxNodePublicKey: sinon.stub().resolves('pubA'),
    },
    './appConstants': overrides.appConstants || {
      localAppsInformation: 'zelappsinformation',
    },
    '../../lib/log': logStub,
    '../appLifecycle/appUninstaller': overrides.appUninstaller || {
      removeAppLocally: sinon.stub().resolves(),
    },
  };

  return { module: proxyquire(MODULE_PATH, stubs), stubs, log: logStub };
}

describe('enterpriseNetwork', () => {
  afterEach(() => sinon.restore());

  describe('isEnterpriseAppOwner', () => {
    it('returns true when owner is in enterpriseAppOwners', () => {
      const { module: m } = loadModule();
      expect(m.isEnterpriseAppOwner('ownerA')).to.equal(true);
    });

    it('returns false when owner is not in enterpriseAppOwners', () => {
      const { module: m } = loadModule();
      expect(m.isEnterpriseAppOwner('someoneElse')).to.equal(false);
    });

    it('returns false for null/undefined owner', () => {
      const { module: m } = loadModule();
      expect(m.isEnterpriseAppOwner(null)).to.equal(false);
      expect(m.isEnterpriseAppOwner(undefined)).to.equal(false);
      expect(m.isEnterpriseAppOwner('')).to.equal(false);
    });
  });

  describe('getEnterpriseAppOwners / getEnterpriseNodesPublicKeys', () => {
    it('returns the configured enterpriseAppOwners list', () => {
      const { module: m } = loadModule();
      expect(m.getEnterpriseAppOwners()).to.deep.equal(OWNERS);
    });

    it('returns the configured enterpriseNodesPublicKeys list', () => {
      const { module: m } = loadModule();
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal(NODE_PUBKEYS);
    });

    it('returns [] when the underlying lists are empty', () => {
      const { module: m } = loadModule({
        enterpriseConfig: {
          getEnterpriseAppOwners: () => [],
          getEnterpriseNodesPublicKeys: () => [],
          getAllowedOwnersForNode: () => [],
        },
      });
      expect(m.getEnterpriseAppOwners()).to.deep.equal([]);
      expect(m.getEnterpriseNodesPublicKeys()).to.deep.equal([]);
    });
  });

  describe('isEnterpriseNode', () => {
    it('returns false when enterpriseNodesPublicKeys is empty', async () => {
      const getPubKey = sinon.stub().resolves('pubA');
      const { module: m } = loadModule({
        enterpriseConfig: {
          getEnterpriseAppOwners: () => OWNERS,
          getEnterpriseNodesPublicKeys: () => [],
          getAllowedOwnersForNode: () => [],
        },
        fluxNetworkHelper: { getFluxNodePublicKey: getPubKey },
      });
      expect(await m.isEnterpriseNode()).to.equal(false);
    });

    it('returns true when own pubkey is listed', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
      });
      expect(await m.isEnterpriseNode()).to.equal(true);
    });

    it('returns false when own pubkey is not listed', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubOther') },
      });
      expect(await m.isEnterpriseNode()).to.equal(false);
    });

    it('throws when getFluxNodePublicKey returns a non-string (daemon/benchmark down)', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves(new Error('daemon down')) },
      });
      try {
        await m.isEnterpriseNode();
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('unable to resolve fluxnode public key');
      }
    });

    it('caches the result on success and does not re-query the pubkey', async () => {
      const getPubKey = sinon.stub().resolves('pubA');
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: getPubKey },
      });
      expect(await m.isEnterpriseNode()).to.equal(true);
      expect(await m.isEnterpriseNode()).to.equal(true);
      expect(getPubKey.callCount).to.equal(1);
    });

    it('does not cache when the pubkey cannot be resolved (so the next call retries)', async () => {
      const getPubKey = sinon.stub().resolves(new Error('down'));
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: getPubKey },
      });
      await m.isEnterpriseNode().catch(() => {});
      await m.isEnterpriseNode().catch(() => {});
      expect(getPubKey.callCount).to.equal(2);
    });

    it('resetEnterpriseNodeCache forces a re-query', async () => {
      const getPubKey = sinon.stub().resolves('pubA');
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: getPubKey },
      });
      await m.isEnterpriseNode();
      m.resetEnterpriseNodeCache();
      await m.isEnterpriseNode();
      expect(getPubKey.callCount).to.equal(2);
    });
  });

  describe('getCachedEnterpriseIdentity', () => {
    it('returns null before isEnterpriseNode resolves', () => {
      const { module: m } = loadModule();
      expect(m.getCachedEnterpriseIdentity()).to.equal(null);
    });

    it('returns the cached boolean after isEnterpriseNode resolves', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
      });
      await m.isEnterpriseNode();
      expect(m.getCachedEnterpriseIdentity()).to.equal(true);
    });

    it('returns null again after resetEnterpriseNodeCache', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
      });
      await m.isEnterpriseNode();
      m.resetEnterpriseNodeCache();
      expect(m.getCachedEnterpriseIdentity()).to.equal(null);
    });

    it('re-evaluates membership live when the node set changes after a sync, no restart (finding #1)', async () => {
      // Mutable key set simulates the map being re-synced from github.
      let keys = ['pubA'];
      const getPubKey = sinon.stub().resolves('pubA');
      const { module: m } = loadModule({
        enterpriseConfig: {
          getEnterpriseAppOwners: () => OWNERS,
          getEnterpriseNodesPublicKeys: () => keys,
          getAllowedOwnersForNode: (pubKey) => NODE_OWNER_MAP[pubKey] || [],
        },
        fluxNetworkHelper: { getFluxNodePublicKey: getPubKey },
      });

      await m.isEnterpriseNode(); // resolves + caches pubkey only
      expect(m.getCachedEnterpriseIdentity()).to.equal(true);

      keys = []; // this node removed from the map by a sync
      expect(m.getCachedEnterpriseIdentity()).to.equal(false);
      expect(m.getCachedAllowedOwnersForNode()).to.deep.equal([]);

      keys = ['pubA']; // node added back by a later sync
      expect(m.getCachedEnterpriseIdentity()).to.equal(true);
      expect(m.getCachedAllowedOwnersForNode()).to.deep.equal(['ownerA']);

      // pubkey resolution happened exactly once despite the membership changes
      expect(getPubKey.callCount).to.equal(1);
    });
  });

  describe('getCachedAllowedOwnersForNode', () => {
    it('returns null before isEnterpriseNode resolves', () => {
      const { module: m } = loadModule();
      expect(m.getCachedAllowedOwnersForNode()).to.equal(null);
    });

    it('returns this node\'s mapped owners after resolution', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
      });
      await m.isEnterpriseNode();
      expect(m.getCachedAllowedOwnersForNode()).to.deep.equal(['ownerA']);
    });

    it('returns [] for a non-enterprise node', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubOther') },
      });
      await m.isEnterpriseNode();
      expect(m.getCachedAllowedOwnersForNode()).to.deep.equal([]);
    });
  });

  describe('scheduleIdentityResolution', () => {
    let clock;
    beforeEach(() => { clock = sinon.useFakeTimers(); });
    afterEach(() => clock.restore());

    it('resolves immediately when the pubkey is available on first try', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
      });
      await m.scheduleIdentityResolution({ retryDelayMs: 1000 });
      expect(m.getCachedEnterpriseIdentity()).to.equal(true);
    });

    it('retries on failure and resolves once the pubkey becomes available', async () => {
      const getPubKey = sinon.stub();
      getPubKey.onFirstCall().resolves(new Error('down'));
      getPubKey.onSecondCall().resolves('pubA');
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: getPubKey },
      });

      const resolved = m.scheduleIdentityResolution({ retryDelayMs: 1000 });
      // First attempt fails; advance past the retry delay.
      await clock.tickAsync(0);
      expect(m.getCachedEnterpriseIdentity()).to.equal(null);
      await clock.tickAsync(1000);
      await resolved;
      expect(getPubKey.callCount).to.equal(2);
      expect(m.getCachedEnterpriseIdentity()).to.equal(true);
    });
  });

  describe('filterAppsByOwnership', () => {
    const apps = [
      { name: 'e1', owner: 'ownerA' },
      { name: 'e2', owner: 'ownerB' },
      { name: 'n1', owner: 'stranger' },
      { name: 'n2', owner: null },
    ];

    it('enterprise node keeps only apps whose owner is allowed on THIS node', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
      });
      await m.isEnterpriseNode(); // resolves identity -> caches allowed owners for pubA = ['ownerA']
      const kept = m.filterAppsByOwnership(apps, true).map((a) => a.name);
      expect(kept).to.deep.equal(['e1']);
    });

    it('enterprise node mapped to no owners hosts nothing', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubB') },
        enterpriseConfig: {
          getEnterpriseAppOwners: () => OWNERS,
          getEnterpriseNodesPublicKeys: () => NODE_PUBKEYS,
          getAllowedOwnersForNode: () => [], // pubB mapped to no owners
        },
      });
      await m.isEnterpriseNode();
      expect(m.filterAppsByOwnership(apps, true)).to.deep.equal([]);
    });

    it('non-enterprise node drops apps owned by ANY enterprise owner (union)', () => {
      const { module: m } = loadModule();
      const kept = m.filterAppsByOwnership(apps, false).map((a) => a.name);
      expect(kept).to.deep.equal(['n1', 'n2']);
    });

    it('empty input produces empty output either way', () => {
      const { module: m } = loadModule();
      expect(m.filterAppsByOwnership([], true)).to.deep.equal([]);
      expect(m.filterAppsByOwnership([], false)).to.deep.equal([]);
    });

    it('enterprise filter drops all apps when identity is unresolved (allowed owners null) (finding #11)', () => {
      const { module: m } = loadModule(); // isEnterpriseNode never called -> pubkey unresolved
      expect(m.getCachedAllowedOwnersForNode()).to.equal(null);
      expect(m.filterAppsByOwnership(apps, true)).to.deep.equal([]);
    });
  });

  describe('getSpawnDelays', () => {
    it('enterprise: 30s/60s regardless of appsAvailable', () => {
      const { module: m } = loadModule();
      expect(m.getSpawnDelays(true, 0)).to.deep.equal({ shortDelayTime: 30 * 1000, delayTime: 60 * 1000 });
      expect(m.getSpawnDelays(true, 1)).to.deep.equal({ shortDelayTime: 30 * 1000, delayTime: 60 * 1000 });
      expect(m.getSpawnDelays(true, 42)).to.deep.equal({ shortDelayTime: 30 * 1000, delayTime: 60 * 1000 });
    });

    it('non-enterprise with appsAvailable > 1: 60s/60s', () => {
      const { module: m } = loadModule();
      expect(m.getSpawnDelays(false, 2)).to.deep.equal({ shortDelayTime: 60 * 1000, delayTime: 60 * 1000 });
    });

    it('non-enterprise with appsAvailable <= 1: legacy 5m/30m defaults', () => {
      const { module: m } = loadModule();
      expect(m.getSpawnDelays(false, 0)).to.deep.equal({ shortDelayTime: 5 * 60 * 1000, delayTime: 30 * 60 * 1000 });
      expect(m.getSpawnDelays(false, 1)).to.deep.equal({ shortDelayTime: 5 * 60 * 1000, delayTime: 30 * 60 * 1000 });
    });
  });

  describe('cleanupOwnershipViolations', () => {
    function installedAppsStub(apps) {
      return {
        databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
        findInDatabase: sinon.stub().resolves(apps),
      };
    }

    it('enterprise-network node: uninstalls apps whose owner is not in enterpriseAppOwners', async () => {
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
        dbHelper: installedAppsStub([
          { name: 'keep', owner: 'ownerA' },
          { name: 'drop1', owner: 'stranger' },
          { name: 'drop2', owner: null },
        ]),
        appUninstaller: { removeAppLocally },
      });

      await m.cleanupOwnershipViolations();

      expect(removeAppLocally.callCount).to.equal(2);
      const names = removeAppLocally.getCalls().map((c) => c.args[0]).sort();
      expect(names).to.deep.equal(['drop1', 'drop2']);
      // sendMessage flag must be true so peers get fluxappremoved
      const firstCall = removeAppLocally.firstCall.args;
      expect(firstCall[4]).to.equal(true);
    });

    it('enterprise-network node: uninstalls an app owned by a valid enterprise owner NOT mapped to THIS node (finding #9)', async () => {
      // pubA is mapped to ['ownerA'] only. ownerB is a valid enterprise owner
      // (in the global union) but is NOT allowed on this node, so its app must be
      // removed — this is the PR's core per-node scoping behavior.
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
        dbHelper: installedAppsStub([
          { name: 'keep', owner: 'ownerA' }, // mapped to pubA -> kept
          { name: 'dropOtherEnterprise', owner: 'ownerB' }, // valid enterprise owner, not on pubA -> removed
          { name: 'dropStranger', owner: 'stranger' }, // not enterprise at all -> removed
        ]),
        appUninstaller: { removeAppLocally },
      });

      await m.cleanupOwnershipViolations();

      const names = removeAppLocally.getCalls().map((c) => c.args[0]).sort();
      expect(names).to.deep.equal(['dropOtherEnterprise', 'dropStranger']);
      expect(removeAppLocally.firstCall.args[4]).to.equal(true);
    });

    it('non-enterprise-network node: uninstalls apps whose owner IS in enterpriseAppOwners', async () => {
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubOther') },
        dbHelper: installedAppsStub([
          { name: 'enterprise-app', owner: 'ownerA' },
          { name: 'normal-app', owner: 'stranger' },
        ]),
        appUninstaller: { removeAppLocally },
      });

      await m.cleanupOwnershipViolations();

      expect(removeAppLocally.callCount).to.equal(1);
      expect(removeAppLocally.firstCall.args[0]).to.equal('enterprise-app');
      expect(removeAppLocally.firstCall.args[4]).to.equal(true);
    });

    it('is a no-op when there are no offenders', async () => {
      const removeAppLocally = sinon.stub().resolves();
      const { module: m, log } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
        dbHelper: installedAppsStub([{ name: 'ok', owner: 'ownerA' }]),
        appUninstaller: { removeAppLocally },
      });

      await m.cleanupOwnershipViolations();

      expect(removeAppLocally.called).to.equal(false);
      expect(log.info.calledWith(sinon.match(/no ownership violations/))).to.equal(true);
    });

    it('propagates the throw when isEnterpriseNode cannot resolve the pubkey', async () => {
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves(new Error('down')) },
      });
      try {
        await m.cleanupOwnershipViolations();
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('unable to resolve fluxnode public key');
      }
    });

    it('propagates an uninstall failure so the scheduler can retry', async () => {
      const removeAppLocally = sinon.stub().rejects(new Error('boom'));
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubA') },
        dbHelper: installedAppsStub([{ name: 'bad', owner: 'stranger' }]),
        appUninstaller: { removeAppLocally },
      });
      try {
        await m.cleanupOwnershipViolations();
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.equal('boom');
      }
    });
  });
});
