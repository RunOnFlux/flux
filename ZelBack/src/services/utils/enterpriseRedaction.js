const config = require('config');
const dbHelper = require('../dbHelper');
const appConstants = require('./appConstants');
const log = require('../../lib/log');

/**
 * Enterprise apps ship an encrypted `compose`, so their image, entrypoint and
 * build metadata are deliberately withheld from the chain and from every spec
 * endpoint. The running CONTAINER, however, still carries all of it, and the
 * container listings below are public and unauthenticated — which published
 * exactly what the encryption was there to hide.
 *
 * These helpers replace those fields with a marker on the way out. The response
 * keeps its shape, so container counts, per-node tallies and app names all keep
 * working; only the identity of the workload stops leaving the node.
 */
const ENTERPRISE_PLACEHOLDER = 'EnterpriseApp';

// Fields on a docker container object that are derived from the encrypted spec:
//   Image / ImageID  the image itself, by name and by digest
//   Command          the entrypoint and arguments baked into that image
//   Labels           build metadata — source repo, revision, author, version
const REDACTED_STRING_FIELDS = ['Image', 'ImageID', 'Command'];

const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, names: null };

/**
 * Names of enterprise apps installed on THIS node.
 *
 * appInstaller stores enterprise specs with `compose` blanked but the
 * `enterprise` blob intact, so membership is a cheap local read — no
 * decryption, no benchmark call, no network.
 *
 * Returns null when the lookup fails, which callers must treat as "cannot
 * prove this is not enterprise" and redact anyway.
 */
async function enterpriseAppNames() {
  if (cache.names && Date.now() - cache.at < CACHE_TTL_MS) return cache.names;
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appslocal.database);
    const apps = await dbHelper.findInDatabase(
      database,
      appConstants.localAppsInformation,
      { version: { $gte: 8 }, enterprise: { $exists: true, $nin: [null, false, ''] } },
      { projection: { _id: 0, name: 1 } },
    );
    const names = new Set();
    apps.forEach((app) => { if (app.name) names.add(app.name); });
    cache = { at: Date.now(), names };
    return names;
  } catch (error) {
    log.error(`enterpriseRedaction: local app lookup failed, redacting every container: ${error.message}`);
    return null;
  }
}

/** `/fluxComponent_appName` or `/fluxAppName` -> `appName`. */
function mainAppNameFromContainer(containerName) {
  const raw = String(containerName || '').replace(/^\//, '');
  const body = raw.replace(/^(zel|flux)/, '');
  return body.split('_')[1] || body;
}

/**
 * Redact the spec-derived fields of every container belonging to an enterprise
 * app. Call this ONLY on the way out to a caller outside this node — internal
 * consumers (spawner, installer, reconciler, FDM sync) need the real values.
 *
 * @param {Array} containers docker container objects
 * @returns {Promise<Array>} a redacted copy; the input is not mutated
 */
async function redactEnterpriseContainers(containers) {
  if (!Array.isArray(containers) || !containers.length) return containers;
  const names = await enterpriseAppNames();

  return containers.map((container) => {
    const appName = mainAppNameFromContainer((container.Names || [])[0]);
    // names === null means the lookup failed: fail closed rather than risk
    // publishing an encrypted spec's image.
    if (names !== null && !names.has(appName)) return container;

    const redacted = { ...container };
    REDACTED_STRING_FIELDS.forEach((field) => {
      if (field in redacted) redacted[field] = ENTERPRISE_PLACEHOLDER;
    });
    if ('Labels' in redacted) redacted.Labels = {};
    return redacted;
  });
}

/** Reset the installed-apps cache (install/uninstall changes the set). */
function resetCache() {
  cache = { at: 0, names: null };
}

module.exports = {
  ENTERPRISE_PLACEHOLDER,
  enterpriseAppNames,
  mainAppNameFromContainer,
  redactEnterpriseContainers,
  resetCache,
};
