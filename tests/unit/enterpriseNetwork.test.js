const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

// Listeners enterpriseNetwork registers with policyStore, so a test can fire the bundle
// event without reaching into the module.
const bundleListeners = [];

const MODULE_PATH = '../../ZelBack/src/services/utils/enterpriseNetwork';

/**
 * The acquisition gate as globalState presents it, with a handle to open it.
 *
 * Both of the sweep's triggers hang off this: it reads the flag before acting, and it hangs
 * a first run on the wait resolving.
 * @param {boolean} ready Whether the gate is open to start with.
 */
function gateState(ready = true) {
  let openIt;
  const opened = new Promise((resolve) => { openIt = resolve; });
  const state = {
    policyReady: ready,
    waitForPolicyReady: () => (state.policyReady ? Promise.resolve() : opened),
    open() { state.policyReady = true; openIt(); },
  };
  return state;
}

// Lets every queued continuation run, so a detached sweep has finished by the time a test
// looks. No wall clock: what is still pending afterwards is pending on something.
const drain = async () => {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
  }
};

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

  bundleListeners.length = 0;
  const stubs = {
    config: overrides.config || defaultConfig,
    './enterpriseConfig': overrides.enterpriseConfig || {
      isPolicyKnown: () => true,
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
    '../policyStore': overrides.policyStore || {
      // Captured so a test can deliver a bundle the way adoption does.
      onBundleChanged: (listener) => {
        bundleListeners.push(listener);
        return () => {
          const at = bundleListeners.indexOf(listener);
          if (at >= 0) bundleListeners.splice(at, 1);
        };
      },
    },
    './globalState': overrides.globalState || gateState(true),
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

    it('resolves on the bundle arriving, without waiting out the retry', async () => {
      // THE TWO FAILURES NEED DIFFERENT ANSWERS. Policy not yet obtained arrives and says
      // so; an unreadable config announces nothing and the interval is all there is. The
      // spawner is gated on this identity, so waiting out five minutes for a fact already
      // in hand is five minutes the node cannot spawn.
      let policyKnown = false;
      const { module: m } = loadModule({
        enterpriseConfig: {
          isPolicyKnown: () => policyKnown,
          getEnterpriseAppOwners: () => OWNERS,
          getEnterpriseNodesPublicKeys: () => (policyKnown ? NODE_PUBKEYS : null),
          getAllowedOwnersForNode: (pubKey) => NODE_OWNER_MAP[pubKey] || [],
        },
      });

      const resolved = m.scheduleIdentityResolution({ retryDelayMs: 5 * 60 * 1000 });
      await clock.tickAsync(0);
      expect(m.getCachedEnterpriseIdentity(), 'nothing to judge against yet').to.equal(null);

      policyKnown = true;
      bundleListeners.forEach((fn) => fn({ seq: 1, source: 'peer' }));
      await clock.tickAsync(0);
      await resolved;

      expect(m.getCachedEnterpriseIdentity(), 'resolved on the event, not on the clock').to.equal(true);
    });

    it('does not start a second attempt beside one already running', async () => {
      // The bundle arriving while an attempt is in flight used to start another. Both could
      // then fail and arm a deadline, and the second wrote over the first one's handle - so
      // the orphan could never be cancelled and outlived the success meant to end it.
      let releasePubKey;
      const getPubKey = sinon.stub().returns(new Promise((resolve) => {
        releasePubKey = () => resolve('pubA');
      }));
      const { module: m } = loadModule({ fluxNetworkHelper: { getFluxNodePublicKey: getPubKey } });

      const resolved = m.scheduleIdentityResolution({ retryDelayMs: 1000 });
      await clock.tickAsync(0);
      expect(getPubKey.callCount, 'the first attempt is out').to.equal(1);

      bundleListeners.forEach((fn) => fn({ seq: 1, source: 'peer' }));
      await clock.tickAsync(0);
      expect(getPubKey.callCount, 'the event started a second attempt beside it').to.equal(1);

      releasePubKey();
      await clock.tickAsync(0);
      await resolved;
      expect(m.getCachedEnterpriseIdentity()).to.equal(true);
    });

    it('still waits out the retry when the failure is not about policy', async () => {
      // A key that cannot be read at all. No event is coming for that, so the interval is
      // the mechanism and must survive the subscription added beside it.
      const getPubKey = sinon.stub();
      getPubKey.onFirstCall().rejects(new Error('daemon down'));
      getPubKey.onSecondCall().resolves('pubA');
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: getPubKey },
      });

      const resolved = m.scheduleIdentityResolution({ retryDelayMs: 1000 });
      await clock.tickAsync(0);
      expect(m.getCachedEnterpriseIdentity()).to.equal(null);

      await clock.tickAsync(1000);
      await resolved;
      expect(getPubKey.callCount).to.equal(2);
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
          isPolicyKnown: () => true,
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

    // AN OWNER WHO SIGNS AS THEMSELVES IS NOT A STRANGER. EIP-55 capitalisation is a
    // checksum over the same twenty bytes, so an owner listed one way and writing their
    // spec the other is one key - and this is the sweep that acts on the answer by
    // uninstalling the app and telling the network it has gone.
    it('does not uninstall an ethereum owner listed in the other capitalisation', async () => {
      const LISTED = '0x2b8E7f6e8F0b6F4c6F8e2B8e7F6e8f0B6f4C6f8E';
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubEth') },
        enterpriseConfig: {
          getEnterpriseAppOwners: () => [LISTED],
          getEnterpriseNodesPublicKeys: () => ['pubEth'],
          getAllowedOwnersForNode: () => [LISTED],
          isPolicyKnown: () => true,
        },
        dbHelper: installedAppsStub([{ name: 'theirs', owner: LISTED.toLowerCase() }]),
        appUninstaller: { removeAppLocally },
      });

      await m.cleanupOwnershipViolations();

      expect(
        removeAppLocally.called,
        'the app was swept off the node over its capitalisation',
      ).to.equal(false);
    });

    // The canary: the same fixture with a genuinely different address IS swept, so the
    // test above is the comparison and not a sweep that never ran.
    it('still uninstalls an ethereum owner the list does not hold', async () => {
      const LISTED = '0x2b8E7f6e8F0b6F4c6F8e2B8e7F6e8f0B6f4C6f8E';
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        fluxNetworkHelper: { getFluxNodePublicKey: sinon.stub().resolves('pubEth') },
        enterpriseConfig: {
          getEnterpriseAppOwners: () => [LISTED],
          getEnterpriseNodesPublicKeys: () => ['pubEth'],
          getAllowedOwnersForNode: () => [LISTED],
          isPolicyKnown: () => true,
        },
        dbHelper: installedAppsStub([{ name: 'stranger', owner: '0x0000000000000000000000000000000000000001' }]),
        appUninstaller: { removeAppLocally },
      });

      await m.cleanupOwnershipViolations();

      expect(removeAppLocally.callCount).to.equal(1);
    });

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

  // An unknown policy is not an empty one. Before these, every read below answered as
  // though the node were an ordinary one with no enterprise owners anywhere - which is
  // how a node with no policy filled itself with apps it must not host, and how the
  // sweep uninstalled a customer's apps off a release-time snapshot.
  describe('unknown policy', () => {
    const unknownPolicy = {
      isPolicyKnown: () => false,
      getEnterpriseAppOwners: () => null,
      getEnterpriseNodesPublicKeys: () => null,
      getAllowedOwnersForNode: () => null,
    };

    it('getCachedEnterpriseIdentity answers null, not false', async () => {
      const { module: m } = loadModule({ enterpriseConfig: unknownPolicy });
      // Resolve the pubkey first, so null can only be coming from the policy.
      await m.isEnterpriseNode().catch(() => {});

      expect(m.getCachedEnterpriseIdentity()).to.equal(null);
    });

    it('isEnterpriseNode throws, so boot identity resolution keeps retrying', async () => {
      const { module: m } = loadModule({ enterpriseConfig: unknownPolicy });

      try {
        await m.isEnterpriseNode();
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('network policy not yet obtained');
      }
    });

    it('getCachedAllowedOwnersForNode answers null, not []', async () => {
      const { module: m } = loadModule({ enterpriseConfig: unknownPolicy });
      await m.isEnterpriseNode().catch(() => {});

      expect(m.getCachedAllowedOwnersForNode()).to.equal(null);
    });

    it('isEnterpriseAppOwner answers null, not false', () => {
      const { module: m } = loadModule({ enterpriseConfig: unknownPolicy });

      expect(m.isEnterpriseAppOwner('ownerA')).to.equal(null);
    });

    it('filterAppsByOwnership selects nothing', () => {
      const { module: m } = loadModule({ enterpriseConfig: unknownPolicy });
      const apps = [{ name: 'n1', owner: 'stranger' }, { name: 'n2', owner: 'ownerA' }];

      expect(m.filterAppsByOwnership(apps, false)).to.deep.equal([]);
      expect(m.filterAppsByOwnership(apps, true)).to.deep.equal([]);
    });

    it('cleanupOwnershipViolations uninstalls NOTHING', async () => {
      const removeAppLocally = sinon.stub().resolves();
      const { module: m, log } = loadModule({
        enterpriseConfig: unknownPolicy,
        globalState: gateState(false),
        dbHelper: {
          databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
          findInDatabase: sinon.stub().resolves([
            { name: 'customer-app', owner: 'ownerA' },
            { name: 'stranger-app', owner: 'stranger' },
          ]),
        },
        appUninstaller: { removeAppLocally },
      });

      await m.cleanupOwnershipViolations();

      expect(removeAppLocally.called).to.equal(false);
      expect(log.warn.calledWithMatch(/policy not confirmed/)).to.equal(true);
    });
  });

  // The sweep uninstalls apps and tells the network it did, so WHEN it runs is as load
  // bearing as what it decides. It reads the node->owners map, which changes over a node's
  // life: an owner granted or revoked after boot is invisible to a sweep that ran once at
  // boot, and one read off a bundle this node has not confirmed reads a grant it has not
  // heard about as a violation.
  describe('when the ownership sweep runs', () => {
    const offenderDb = () => ({
      databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
      findInDatabase: sinon.stub().resolves([{ name: 'customer-app', owner: 'stranger' }]),
    });
    const fireBundleChanged = () => bundleListeners.slice().forEach((listener) => listener());

    it('refuses a bundle this node holds but has not confirmed', async () => {
      // The case the gate exists for: the map is perfectly readable, and it is whatever this
      // node last had. isPolicyKnown answers true throughout.
      const removeAppLocally = sinon.stub().resolves();
      const { module: m, log } = loadModule({
        globalState: gateState(false),
        dbHelper: offenderDb(),
        appUninstaller: { removeAppLocally },
      });

      await m.cleanupOwnershipViolations();

      expect(removeAppLocally.called, 'held is not confirmed').to.equal(false);
      expect(log.warn.calledWithMatch(/policy not confirmed/)).to.equal(true);
    });

    it('does not sweep while the gate is shut', async () => {
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        globalState: gateState(false),
        dbHelper: offenderDb(),
        appUninstaller: { removeAppLocally },
      });

      m.startOwnershipSweeps();
      await drain();

      expect(removeAppLocally.called).to.equal(false);
    });

    it('sweeps when the gate opens, with no bundle change to announce it', async () => {
      // A node confirmed by its peers holds exactly what it restored, so nothing changes and
      // nothing is announced. The gate opening is the only signal there is.
      const gate = gateState(false);
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        globalState: gate, dbHelper: offenderDb(), appUninstaller: { removeAppLocally },
      });

      m.startOwnershipSweeps();
      await drain();
      expect(removeAppLocally.called, 'nothing yet').to.equal(false);

      gate.open();
      await drain();
      expect(removeAppLocally.calledOnce, 'the gate opening is a trigger of its own').to.equal(true);
    });

    it('sweeps again when the bundle changes', async () => {
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        globalState: gateState(true), dbHelper: offenderDb(), appUninstaller: { removeAppLocally },
      });

      m.startOwnershipSweeps();
      await drain();
      expect(removeAppLocally.callCount, 'the gate was already open').to.equal(1);

      fireBundleChanged();
      await drain();
      expect(removeAppLocally.callCount, 'an owner granted after boot is not invisible').to.equal(2);
    });

    it('ignores a bundle change while the gate is shut', async () => {
      const removeAppLocally = sinon.stub().resolves();
      const db = offenderDb();
      const { module: m, log } = loadModule({
        globalState: gateState(false), dbHelper: db, appUninstaller: { removeAppLocally },
      });

      m.startOwnershipSweeps();
      fireBundleChanged();
      await drain();

      expect(removeAppLocally.called, 'a bundle it may not act on changes nothing it may do').to.equal(false);
      // Not started and then refused: not started. A change arriving while the gate is shut
      // is not a question worth putting to the database, and the pass that would refuse it
      // logs every time it does.
      expect(db.findInDatabase.called, 'no pass was begun').to.equal(false);
      expect(log.warn.calledWithMatch(/policy not confirmed/), 'so there was nothing to refuse').to.equal(false);
    });

    it('coalesces requests made during a pass into one more pass', async () => {
      // Three requests during one pass are one question - what does the map say NOW - and
      // the pass that answers it reads the latest state. Queueing them would walk the whole
      // local app table twice more for nothing.
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      let passes = 0;
      const findInDatabase = sinon.stub().callsFake(async () => {
        passes += 1;
        if (passes === 1) await held;
        return [];
      });
      const { module: m } = loadModule({
        dbHelper: {
          databaseConnection: sinon.stub().returns({ db: sinon.stub().returns({}) }),
          findInDatabase,
        },
      });

      const first = m.requestOwnershipSweep();
      await drain();
      expect(passes, 'one pass in flight').to.equal(1);

      m.requestOwnershipSweep();
      m.requestOwnershipSweep();
      m.requestOwnershipSweep();
      release();
      await first;

      expect(passes, 'three requests cost one more pass, not three').to.equal(2);
    });

    it('runs again after a pass throws', async () => {
      // An uninstall that failed is logged and left for the next pass. A sweep that stopped
      // driving itself on one failure would leave the node acting on a map it has read.
      const removeAppLocally = sinon.stub()
        .onFirstCall().rejects(new Error('boom'))
        .onSecondCall()
        .resolves();
      const { module: m, log } = loadModule({
        globalState: gateState(true), dbHelper: offenderDb(), appUninstaller: { removeAppLocally },
      });

      m.startOwnershipSweeps();
      await drain();
      expect(removeAppLocally.callCount).to.equal(1);
      expect(log.error.calledWithMatch(/ownership cleanup failed/)).to.equal(true);

      fireBundleChanged();
      await drain();
      expect(removeAppLocally.callCount, 'the failure ended the pass, not the sweeping').to.equal(2);
    });

    it('stops sweeping once the subscription is ended', async () => {
      const removeAppLocally = sinon.stub().resolves();
      const { module: m } = loadModule({
        globalState: gateState(true), dbHelper: offenderDb(), appUninstaller: { removeAppLocally },
      });

      const stop = m.startOwnershipSweeps();
      await drain();
      const after = removeAppLocally.callCount;

      stop();
      fireBundleChanged();
      await drain();

      expect(removeAppLocally.callCount).to.equal(after);
    });
  });
});
