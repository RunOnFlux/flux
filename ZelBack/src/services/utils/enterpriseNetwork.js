const config = require('config');
const dbHelper = require('../dbHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const appConstants = require('./appConstants');
const enterpriseConfig = require('./enterpriseConfig');
const log = require('../../lib/log');

// This node's own fluxnode pubkey, cached once resolved. The pubkey never
// changes, so the expensive daemon/benchmark RPC runs only once. Enterprise
// membership and the allowed-owner list are NOT cached: both are derived live
// from the current map (which re-syncs from github every 6h), so adding or
// removing this node from the map — or changing its owners — takes effect within
// the sync interval without a node restart. See getCachedEnterpriseIdentity()
// and getCachedAllowedOwnersForNode().
let cachedNodePubKey = null;

function getEnterpriseAppOwners() {
  return enterpriseConfig.getEnterpriseAppOwners();
}

function getEnterpriseNodesPublicKeys() {
  return enterpriseConfig.getEnterpriseNodesPublicKeys();
}

function isEnterpriseAppOwner(owner) {
  if (!owner) return false;
  return getEnterpriseAppOwners().includes(owner);
}

/**
 * Returns true if this fluxnode's own pubkey is currently listed in the
 * enterprise nodes public keys (helpers/enterprisenodes.json, synced via
 * enterpriseConfig). Only the resolved pubkey is cached for the lifetime of the
 * process; membership is evaluated live against the current map on every call,
 * so a node added to or removed from the map is reflected within the sync
 * interval with no restart. resetEnterpriseNodeCache() forces the pubkey to be
 * re-resolved.
 *
 * Throws if the pubkey cannot be resolved (daemon/benchmark down). Prefer the
 * boot-time scheduleIdentityResolution() + getCachedEnterpriseIdentity() pair
 * over awaiting this from hot paths.
 */
async function isEnterpriseNode() {
  if (cachedNodePubKey === null) {
    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    // getFluxNodePublicKey swallows errors and returns the Error object on failure.
    if (!pubKey || typeof pubKey !== 'string') {
      throw new Error('enterpriseNetwork: unable to resolve fluxnode public key (daemon/benchmark unavailable)');
    }
    cachedNodePubKey = pubKey;
  }
  return getEnterpriseNodesPublicKeys().includes(cachedNodePubKey);
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
  return getEnterpriseNodesPublicKeys().includes(cachedNodePubKey);
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
  if (!getEnterpriseNodesPublicKeys().includes(cachedNodePubKey)) return [];
  return enterpriseConfig.getAllowedOwnersForNode(cachedNodePubKey);
}

/**
 * Boot-time identity resolution. Calls isEnterpriseNode() to populate the
 * cache; if the pubkey can't be resolved (daemon/benchmark still coming up),
 * reschedules itself every retryDelayMs until a run succeeds. Returns a
 * promise that resolves once the identity is cached.
 */
function scheduleIdentityResolution({ retryDelayMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const tryResolve = async () => {
      try {
        await isEnterpriseNode();
        log.info('enterpriseNetwork: identity resolved');
        resolve();
      } catch (err) {
        log.warn(`enterpriseNetwork: identity resolution failed, retrying in ${Math.round(retryDelayMs / 1000)}s: ${err.message || err}`);
        setTimeout(tryResolve, retryDelayMs);
      }
    };
    tryResolve();
  });
}

function resetEnterpriseNodeCache() {
  cachedNodePubKey = null;
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
  if (isEnterprise) {
    const allowedOwners = getCachedAllowedOwnersForNode() || [];
    return apps.filter((app) => allowedOwners.includes(app.owner));
  }
  return apps.filter((app) => !isEnterpriseAppOwner(app.owner));
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
 * appLocations. Intended to run once, ~5 minutes after boot.
 */
async function cleanupOwnershipViolations() {
  // eslint-disable-next-line global-require
  const appUninstaller = require('../appLifecycle/appUninstaller');

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

module.exports = {
  cleanupOwnershipViolations,
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
