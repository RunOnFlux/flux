const config = require('config');
const dbHelper = require('../dbHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const appConstants = require('./appConstants');
const enterpriseConfig = require('./enterpriseConfig');
const policyStore = require('../policyStore');
const globalState = require('./globalState');
const log = require('../../lib/log');

// This node's own fluxnode pubkey, cached once resolved. The pubkey never
// changes, so the expensive daemon/benchmark RPC runs only once. Enterprise
// membership and the allowed-owner list are NOT cached: both are derived live
// from the current map (which re-syncs from github every 6h), so adding or
// removing this node from the map — or changing its owners — takes effect within
// the sync interval without a node restart. See getCachedEnterpriseIdentity()
// and getCachedAllowedOwnersForNode().
let cachedNodePubKey = null;

// The sweep in progress, and whether anything asked for another while it ran.
let sweepInFlight = null;
let sweepAgain = false;

function getEnterpriseAppOwners() {
  return enterpriseConfig.getEnterpriseAppOwners();
}

function getEnterpriseNodesPublicKeys() {
  return enterpriseConfig.getEnterpriseNodesPublicKeys();
}

/**
 * Whether an address is an enterprise app owner. Returns null when the policy is
 * unknown — callers must not read that as false, which would let an ordinary node
 * host enterprise apps and let the sweep tear down apps it cannot judge.
 */
function isEnterpriseAppOwner(owner) {
  if (!owner) return false;
  const owners = getEnterpriseAppOwners();
  if (owners === null) return null;
  return owners.includes(owner);
}

/**
 * Returns true if this fluxnode's own pubkey is currently listed in the
 * enterprise nodes public keys (enterprisenodes.json in fluxos-network-policy,
 * fetched via enterpriseConfig). Only the resolved pubkey is cached for the lifetime of the
 * process; membership is evaluated live against the current map on every call,
 * so a node added to or removed from the map is reflected within the sync
 * interval with no restart. resetEnterpriseNodeCache() forces the pubkey to be
 * re-resolved.
 *
 * Throws if the pubkey cannot be read from flux.conf, or if policy has not been
 * obtained. Prefer the boot-time scheduleIdentityResolution() +
 * getCachedEnterpriseIdentity() pair over awaiting this from hot paths.
 */
async function isEnterpriseNode() {
  if (cachedNodePubKey === null) {
    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    // Kept even though the accessor now answers null rather than the Error it
    // used to. What arrives here has to be a key to be usable, and checking
    // that is this function's business whatever its source promises.
    if (!pubKey || typeof pubKey !== 'string') {
      throw new Error('enterpriseNetwork: unable to resolve fluxnode public key (daemon/benchmark unavailable)');
    }
    cachedNodePubKey = pubKey;
  }
  const pubKeys = getEnterpriseNodesPublicKeys();
  // Unknown policy throws rather than answering false, so scheduleIdentityResolution
  // keeps retrying and identityReady stays unresolved — which is what holds the
  // ownership sweep back until there is something real to judge against.
  if (pubKeys === null) {
    throw new Error('enterpriseNetwork: network policy not yet obtained');
  }
  return pubKeys.includes(cachedNodePubKey);
}

/**
 * Synchronous read of the enterprise identity. Returns:
 *   - true  : node is currently in the enterprise set
 *   - false : node is not currently in the enterprise set
 *   - null  : pubkey not yet resolved (caller should defer)
 *
 * Membership is recomputed live from the current map on each call (only the
 * pubkey is cached), so node add/remove via a github sync is honoured without a
 * restart. This is the read used by hot paths (e.g. the spawn loop) so they
 * don't need to await or handle a throw on every iteration.
 */
function getCachedEnterpriseIdentity() {
  if (cachedNodePubKey === null) return null;
  const pubKeys = getEnterpriseNodesPublicKeys();
  if (pubKeys === null) return null;
  return pubKeys.includes(cachedNodePubKey);
}

/**
 * Synchronous read of the owners this node is allowed to host. Returns null
 * before isEnterpriseNode() has resolved, [] for a non-enterprise node, or this
 * node's owner list otherwise. The list is read live from the current map (which
 * re-syncs from github every 6h), so owner changes take effect without a node
 * restart; only the node's enterprise identity itself is cached for the process.
 */
function getCachedAllowedOwnersForNode() {
  if (cachedNodePubKey === null) return null;
  const pubKeys = getEnterpriseNodesPublicKeys();
  if (pubKeys === null) return null;
  if (!pubKeys.includes(cachedNodePubKey)) return [];
  return enterpriseConfig.getAllowedOwnersForNode(cachedNodePubKey);
}

/**
 * Boot-time identity resolution. Calls isEnterpriseNode() to populate the cache,
 * and resolves once it is. Policy arriving is subscribed to; anything else that
 * can fail reschedules every retryDelayMs until a run succeeds.
 */
function scheduleIdentityResolution({ retryDelayMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let timer = null;
    let unsubscribe = null;

    const done = () => {
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      timer = null;
      unsubscribe = null;
      resolve();
    };

    // One attempt at a time. An attempt in flight will report its own outcome, and a second
    // one started beside it would arm a second deadline over the first handle - leaving a
    // chain nothing can cancel, which then outlives the success that was meant to end it.
    let inFlight = false;

    const tryResolve = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await isEnterpriseNode();
        log.info('enterpriseNetwork: identity resolved');
        done();
      } catch (err) {
        log.warn(`enterpriseNetwork: identity resolution failed, retrying in ${Math.round(retryDelayMs / 1000)}s: ${err.message || err}`);
        timer = setTimeout(tryResolve, retryDelayMs);
      } finally {
        inFlight = false;
      }
    };

    // THE TWO REASONS THIS FAILS NEED DIFFERENT ANSWERS, AND ONLY ONE OF THEM IS A WAIT.
    // Policy not yet obtained arrives and says so, so it is subscribed to. An unreadable
    // flux.conf announces nothing, and the interval is all there is - but that is a local
    // file, not a service coming up, so it is the rare case rather than every boot.
    //
    // Without the subscription the node waits the full interval for a fact already in hand:
    // the spawner is gated on this identity (appSpawner: enterprise_unresolved), and a fleet
    // measured here had policy nine seconds after boot and could not spawn for five minutes.
    unsubscribe = policyStore.onBundleChanged(() => {
      if (timer) clearTimeout(timer);
      timer = null;
      tryResolve();
    });

    tryResolve();
  });
}

function resetEnterpriseNodeCache() {
  cachedNodePubKey = null;
  sweepInFlight = null;
  sweepAgain = false;
}

/**
 * Enterprise network ownership split applied as a single filter:
 *   - enterprise nodes install ONLY apps owned by the owners mapped to THIS node
 *     (getCachedAllowedOwnersForNode); a node mapped to no owners hosts nothing
 *   - every other node NEVER installs apps owned by ANY enterprise app owner
 *
 * Relies on the identity cache, which is consistent with the isEnterprise flag
 * callers pass (both derive from isEnterpriseNode()).
 */
function filterAppsByOwnership(apps, isEnterprise) {
  // Defensive: the spawner already declines to run at all while the policy gate is
  // shut, so this should be unreachable. Selecting nothing is the answer that cannot
  // be wrong if it ever is reached.
  if (!enterpriseConfig.isPolicyKnown()) return [];
  if (isEnterprise) {
    const allowedOwners = getCachedAllowedOwnersForNode() || [];
    return apps.filter((app) => allowedOwners.includes(app.owner));
  }
  return apps.filter((app) => isEnterpriseAppOwner(app.owner) === false);
}

/**
 * Spawn-loop cadence for trySpawningGlobalApplication. Enterprise nodes get
 * a tight cadence that sticks regardless of how many apps are installable;
 * non-enterprise nodes keep the original dynamic tuning (60s when more than
 * one candidate exists, otherwise the legacy 5m/30m defaults).
 */
function getSpawnDelays(isEnterprise, appsAvailable) {
  const multiplier = config.fluxapps.spawnDelayMultiplier ?? 1;
  if (isEnterprise) {
    return { shortDelayTime: 30 * 1000 * multiplier, delayTime: 60 * 1000 * multiplier };
  }
  if (appsAvailable > 1) {
    return { shortDelayTime: 60 * 1000 * multiplier, delayTime: 60 * 1000 * multiplier };
  }
  return { shortDelayTime: 5 * 60 * 1000 * multiplier, delayTime: 30 * 60 * 1000 * multiplier };
}

/**
 * Uninstall locally-installed apps whose ownership violates the enterprise
 * network split:
 *   - enterprise nodes must only host apps owned by the owners mapped to THIS
 *     node (a node mapped to no owners must host none)
 *   - every other node must never host apps owned by ANY enterprise app owner
 *
 * sendMessage=true so peers receive fluxappremoved and drop this IP from
 * appLocations. Driven by startOwnershipSweeps, which runs it whenever this node's view of
 * who may host what changes.
 */
async function cleanupOwnershipViolations() {
  // eslint-disable-next-line global-require
  const appUninstaller = require('../appLifecycle/appUninstaller');

  // NOTHING IS UNINSTALLED ON POLICY THIS NODE HAS NOT ESTABLISHED IS THE NETWORK'S.
  // Holding a bundle is not that: one off disk is whatever this node last had, and a map
  // that has since granted an owner reads here as that owner's apps being violations. This
  // is the only destructive path in the module, so it takes the gate acquisition takes.
  if (!globalState.policyReady) {
    log.warn('enterpriseNetwork: network policy not confirmed, skipping ownership cleanup');
    return;
  }

  const enterprise = await isEnterpriseNode();
  const allowedOwners = getCachedAllowedOwnersForNode() || [];

  const db = dbHelper.databaseConnection();
  const appsDatabase = db.db(config.database.appslocal.database);
  const projection = { projection: { _id: 0, name: 1, owner: 1 } };
  const apps = await dbHelper.findInDatabase(
    appsDatabase,
    appConstants.localAppsInformation,
    {},
    projection,
  );

  const offenders = apps.filter((app) => (
    enterprise
      ? !allowedOwners.includes(app.owner)
      : isEnterpriseAppOwner(app.owner)
  ));
  if (!offenders.length) {
    log.info('enterpriseNetwork: no ownership violations to clean up');
    return;
  }

  const role = enterprise ? 'enterprise-network' : 'non-enterprise-network';
  log.warn(`enterpriseNetwork: ${role} node has ${offenders.length} locally-installed app(s) with disallowed owner, uninstalling`);
  // eslint-disable-next-line no-restricted-syntax
  for (const app of offenders) {
    log.warn(`REMOVAL REASON: ${role} node, app ${app.name} owner ${app.owner} disallowed by enterprise network split (enterpriseNetwork)`);
    // Let exceptions propagate so the scheduler can retry on the next tick;
    // a half-applied cleanup is fine to resume — subsequent runs re-query the db.
    // eslint-disable-next-line no-await-in-loop
    await appUninstaller.removeAppLocally(app.name, null, true, true, true);
  }
}

/**
 * Run the sweep, and once more if anything asked for one while it ran.
 *
 * COALESCED RATHER THAN QUEUED. The sweep is a function of the bundle this node holds now,
 * so a second request arriving during a pass needs exactly one more pass - a queue of them
 * would each re-read the same final state and walk the whole local app table again.
 * @returns {Promise<void>} The run in progress, so a caller can wait for it.
 */
function requestOwnershipSweep() {
  if (sweepInFlight) {
    sweepAgain = true;
    return sweepInFlight;
  }
  sweepInFlight = (async () => {
    do {
      // Cleared BEFORE the pass, so a request arriving during it is not read as one this
      // pass already accounted for.
      sweepAgain = false;
      // eslint-disable-next-line no-await-in-loop
      await cleanupOwnershipViolations()
        .catch((error) => log.error(`enterpriseNetwork: ownership cleanup failed: ${error.message || error}`));
    } while (sweepAgain);
  })().finally(() => { sweepInFlight = null; });
  return sweepInFlight;
}

/**
 * Sweep whenever this node's view of who may host what changes.
 *
 * TWO TRIGGERS, BECAUSE NEITHER COVERS THE OTHER. The gate opening is what makes the map
 * safe to act on at all, and it opens without the bundle changing - a node confirmed by its
 * peers holds exactly what it restored. A bundle changing is what makes an already-safe map
 * say something different, and that happens for the rest of the node's life: an owner
 * granted or revoked after boot is not visible to a sweep that ran once at boot.
 *
 * NOTHING WAITS ON THIS. The sweep uninstalls apps, so it runs only on policy this node has
 * established is the network's - which may be a long time coming, and may never come.
 * @returns {Function} Ends the subscription.
 */
function startOwnershipSweeps() {
  const unsubscribe = policyStore.onBundleChanged(() => {
    // A bundle this node may not act on yet changes nothing it may do. The gate opening
    // carries its own trigger.
    if (!globalState.policyReady) return;
    requestOwnershipSweep();
  });
  globalState.waitForPolicyReady().then(() => requestOwnershipSweep());
  return unsubscribe;
}

module.exports = {
  cleanupOwnershipViolations,
  requestOwnershipSweep,
  startOwnershipSweeps,
  filterAppsByOwnership,
  getCachedAllowedOwnersForNode,
  getCachedEnterpriseIdentity,
  getEnterpriseAppOwners,
  getEnterpriseNodesPublicKeys,
  getSpawnDelays,
  isEnterpriseAppOwner,
  isEnterpriseNode,
  resetEnterpriseNodeCache,
  scheduleIdentityResolution,
};
