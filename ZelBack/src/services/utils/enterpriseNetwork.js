const config = require('config');
const dbHelper = require('../dbHelper');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const appConstants = require('./appConstants');
const log = require('../../lib/log');

let cachedIsEnterpriseNode = null;

function getEnterpriseAppOwners() {
  return config.enterpriseAppOwners || [];
}

function getEnterpriseNodesPublicKeys() {
  return config.enterpriseNodesPublicKeys || [];
}

function isEnterpriseAppOwner(owner) {
  if (!owner) return false;
  return getEnterpriseAppOwners().includes(owner);
}

/**
 * Returns true if this fluxnode's own pubkey is listed in
 * config.enterpriseNodesPublicKeys. Result is cached for the lifetime of the
 * process after a successful resolution; call resetEnterpriseNodeCache() if
 * the config is hot-reloaded and the membership might have changed.
 *
 * Throws if the pubkey cannot be resolved (daemon/benchmark down). Callers
 * that want a retry-until-clean semantic should let the throw propagate;
 * callers that just want a best-effort boolean should `.catch(() => false)`.
 */
async function isEnterpriseNode() {
  if (cachedIsEnterpriseNode !== null) return cachedIsEnterpriseNode;

  const allowed = getEnterpriseNodesPublicKeys();
  if (!allowed.length) {
    cachedIsEnterpriseNode = false;
    return false;
  }

  const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
  // getFluxNodePublicKey swallows errors and returns the Error object on failure.
  if (!pubKey || typeof pubKey !== 'string') {
    throw new Error('enterpriseNetwork: unable to resolve fluxnode public key (daemon/benchmark unavailable)');
  }

  cachedIsEnterpriseNode = allowed.includes(pubKey);
  return cachedIsEnterpriseNode;
}

function resetEnterpriseNodeCache() {
  cachedIsEnterpriseNode = null;
}

/**
 * Uninstall locally-installed apps whose ownership violates the enterprise
 * network split:
 *   - enterprise-network nodes must only host apps owned by enterpriseAppOwners
 *   - every other node must never host apps owned by enterpriseAppOwners
 *
 * sendMessage=true so peers receive fluxappremoved and drop this IP from
 * appLocations. Intended to run once, ~5 minutes after boot.
 */
async function cleanupOwnershipViolations() {
  // eslint-disable-next-line global-require
  const appUninstaller = require('../appLifecycle/appUninstaller');

  const enterprise = await isEnterpriseNode();

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
      ? !isEnterpriseAppOwner(app.owner)
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
  getEnterpriseAppOwners,
  getEnterpriseNodesPublicKeys,
  isEnterpriseAppOwner,
  isEnterpriseNode,
  resetEnterpriseNodeCache,
};
