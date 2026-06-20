/**
 * App Network Linker
 *
 * Implements opt-in app-to-app network linking. An app owner links the app to
 * other apps by embedding a token in the app `description` text:
 *
 *     networkWith:[appA,appB]
 *
 * Brackets are required, quotes are optional, the key is matched
 * case-insensitively and names are comma separated. When the token is present,
 * before the app is installed or redeployed the node verifies every named app
 * is installed locally and owned by the same owner; otherwise the install
 * fails. Each of the app's component containers is then attached to the
 * private docker network of every linked app (`fluxDockerNetwork_<linked>`), so
 * it can reach that app's components by their docker DNS name
 * `flux<component>_<linkedApp>` — exactly as if both apps were a single app.
 *
 * This is purely node-local behaviour: it does not introduce an app
 * specification field, change validation, or touch any network consensus. An
 * app whose description has no (or a malformed) token behaves exactly as before.
 */

const config = require('config');
const dbHelper = require('../dbHelper');
const dockerService = require('../dockerService');
const log = require('../../lib/log');
const { socketAddressesMatch } = require('../utils/socketAddressUtils');
const { localAppsInformation, globalAppsInformation, APP_NAME_REGEX } = require('../utils/appConstants');

/**
 * Parses the `networkWith:[...]` token out of an app description.
 *
 * @param {string} description - app description text
 * @returns {string[]} unique, syntactically valid linked app names ([] if none)
 */
function parseNetworkWith(description) {
  if (typeof description !== 'string' || !description) {
    return [];
  }
  const match = description.match(/\bnetworkWith\s*[:=]\s*\[([^\]]*)\]/i);
  if (!match) {
    return [];
  }
  const names = [];
  const seen = new Set();
  match[1].split(',').forEach((raw) => {
    const name = raw.trim().replace(/^["']+|["']+$/g, '').trim();
    const key = name.toLowerCase();
    if (name && APP_NAME_REGEX.test(name) && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  });
  return names;
}

/**
 * Returns the linked app names declared by an app, excluding any self
 * reference to the app itself.
 *
 * @param {object} appSpecs - full app specification
 * @returns {string[]} linked app names
 */
function getLinkedApps(appSpecs) {
  if (!appSpecs || !appSpecs.name) {
    return [];
  }
  const selfName = String(appSpecs.name).toLowerCase();
  return parseNetworkWith(appSpecs.description).filter((linked) => linked.toLowerCase() !== selfName);
}

/**
 * Whether an app opts out of standalone spawning via `dependencyOnly=true` in its
 * description. Such an app (e.g. a stats collector) is the *target* of other
 * apps' `networkWith` links: it is installed only while at least one app that
 * links to it is present, and removed once nothing links to it any more. The
 * literal `:true`/`=true` is required so the marker can't be tripped by the word
 * appearing in prose.
 *
 * @param {string} description - app description text
 * @returns {boolean}
 */
function parseDependencyOnly(description) {
  if (typeof description !== 'string' || !description) {
    return false;
  }
  return /\bdependencyOnly\s*[:=]\s*true\b/i.test(description);
}

/**
 * Given a set of app specs (each at least `{ name, owner, description }`), returns
 * the set of dependency-app names that are *required*: the transitive
 * `networkWith` closure starting from the workload apps (those NOT marked
 * `dependencyOnly`). Links are only followed between apps of the same owner.
 * Original-cased names are returned; matching is case-insensitive.
 *
 * Starting the closure from workloads only (not every app in the set) is what
 * lets a dependency-only app fall out of the required set once nothing links to
 * it — otherwise a collector, being present itself, would keep itself alive.
 *
 * @param {Array<object>} apps - app specs to reason over
 * @returns {Set<string>} required dependency app names
 */
function computeRequiredDependencyNames(apps) {
  const required = new Set();
  if (!Array.isArray(apps) || !apps.length) {
    return required;
  }
  const byName = new Map();
  apps.forEach((app) => {
    if (app && app.name) byName.set(app.name.toLowerCase(), app);
  });

  const roots = apps.filter((app) => app && app.name && !parseDependencyOnly(app.description));
  const queue = [...roots];
  const visited = new Set(roots.map((app) => app.name.toLowerCase()));

  while (queue.length) {
    const current = queue.shift();
    // eslint-disable-next-line no-restricted-syntax
    for (const linkedName of getLinkedApps(current)) {
      const dep = byName.get(linkedName.toLowerCase());
      if (dep && dep.owner === current.owner) {
        required.add(dep.name);
        const key = dep.name.toLowerCase();
        if (!visited.has(key)) {
          visited.add(key);
          queue.push(dep);
        }
      }
    }
  }
  return required;
}

/**
 * The dependency-app names that should be present on this node, computed from
 * every app the global registry assigns to this node (pinned via `nodes`). Used
 * by the spawner to suppress a `dependencyOnly` app that nothing here requires.
 *
 * @param {string} localSocketAddr - this node's socket address
 * @returns {Promise<Set<string>>}
 */
async function getRequiredDependencyNamesForNode(localSocketAddr) {
  if (!localSocketAddr) {
    return new Set();
  }
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  const projection = { projection: { _id: 0, name: 1, owner: 1, description: 1, nodes: 1 } };
  const apps = await dbHelper.findInDatabase(database, globalAppsInformation, {}, projection);
  const assigned = (apps || []).filter((app) => Array.isArray(app.nodes)
    && app.nodes.some((ip) => socketAddressesMatch(ip, localSocketAddr)));
  return computeRequiredDependencyNames(assigned);
}

/**
 * Locally-installed apps that are `dependencyOnly` but no longer required by any
 * installed workload (transitive `networkWith`). These should be removed. Based
 * on what is actually installed here now, so removing the last workload orphans
 * the collectors it linked to.
 *
 * @returns {Promise<Array<object>>} orphaned dependency app specs
 */
async function findUnrequiredInstalledDependencies() {
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appslocal.database);
  const projection = { projection: { _id: 0, name: 1, owner: 1, description: 1 } };
  const installed = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, {}, projection);
  if (!installed || !installed.length) {
    return [];
  }
  const required = computeRequiredDependencyNames(installed);
  return installed.filter((app) => parseDependencyOnly(app.description) && !required.has(app.name));
}

/**
 * Verifies every app this app is linked to is installed locally and owned by
 * the same owner. Throws otherwise, aborting the install/redeploy.
 *
 * @param {object} appSpecs - full app specification
 * @returns {Promise<boolean>} true when all network links are satisfied
 */
async function checkAppNetworkRequirements(appSpecs) {
  const linkedApps = getLinkedApps(appSpecs);
  if (!linkedApps.length) {
    return true;
  }

  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appslocal.database);
  const projection = { projection: { _id: 0, name: 1, owner: 1 } };

  // eslint-disable-next-line no-restricted-syntax
  for (const linkedApp of linkedApps) {
    // eslint-disable-next-line no-await-in-loop
    const installed = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, { name: linkedApp }, projection);
    if (!installed) {
      // Transient ordering condition, not a misconfiguration: the dependency may
      // simply not be installed yet. Tagged so the spawner can retry shortly
      // instead of treating it as a hard install failure.
      const error = new Error(`App '${linkedApp}' that '${appSpecs.name}' must be networked with is not installed on this node. Installation aborted.`);
      error.code = 'NETWORK_DEPENDENCY_NOT_READY';
      throw error;
    }
    if (installed.owner !== appSpecs.owner) {
      throw new Error(`App '${linkedApp}' that '${appSpecs.name}' must be networked with is owned by a different owner. Installation aborted.`);
    }
  }
  log.info(`App network links satisfied for ${appSpecs.name}: ${linkedApps.join(', ')}`);
  return true;
}

/**
 * Attaches a freshly created component container to the private docker network
 * of every app the parent app is linked to, so it can reach the linked apps'
 * components. Throws on a real connection failure so the install is rolled back.
 *
 * @param {string} componentContainerName - docker container name (flux<component>_<app>)
 * @param {object} fullAppSpecs - full app specification of the parent app
 * @returns {Promise<void>}
 */
async function connectComponentToLinkedApps(componentContainerName, fullAppSpecs) {
  const linkedApps = getLinkedApps(fullAppSpecs);
  if (!linkedApps.length) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const linkedApp of linkedApps) {
    const networkName = `fluxDockerNetwork_${linkedApp}`;
    // eslint-disable-next-line no-await-in-loop
    await dockerService.appDockerNetworkConnect(componentContainerName, networkName);
    log.info(`Connected ${componentContainerName} to linked app network ${networkName}`);
  }
}

/**
 * After an app's private network is (re)created, reconnects every locally
 * installed app that is networked with it back onto that network. Best-effort —
 * never throws, so a redeploy is not aborted by a reconnect hiccup.
 *
 * @param {string} appName - the app whose network was (re)created
 * @returns {Promise<void>}
 */
async function reconnectLinkedApps(appName) {
  let installedApps;
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    installedApps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, {}, { projection: { _id: 0 } });
  } catch (error) {
    log.error(`reconnectLinkedApps: failed to read installed apps for ${appName}: ${error.message}`);
    return;
  }

  const networkName = `fluxDockerNetwork_${appName}`;
  const lowerAppName = appName.toLowerCase();

  // eslint-disable-next-line no-restricted-syntax
  for (const app of installedApps || []) {
    if (!app || app.name === appName) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const linkedApps = getLinkedApps(app);
    if (!linkedApps.some((linked) => linked.toLowerCase() === lowerAppName)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const containerNames = await dockerService.getAppContainerNames(app.name);
      // eslint-disable-next-line no-restricted-syntax
      for (const containerName of containerNames) {
        // eslint-disable-next-line no-await-in-loop
        await dockerService.appDockerNetworkConnect(containerName, networkName);
        log.info(`Reconnected linked app ${containerName} to ${networkName}`);
      }
    } catch (error) {
      log.error(`reconnectLinkedApps: failed to reconnect ${app.name} to ${networkName}: ${error.message}`);
    }
  }
}

/**
 * Boot-time sweep: ensures every installed app that declares network links is
 * attached to each linked app's network. Idempotent and best-effort.
 *
 * @returns {Promise<void>}
 */
async function reconcileAllAppNetworkLinks() {
  let installedApps;
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    installedApps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, {}, { projection: { _id: 0 } });
  } catch (error) {
    log.error(`reconcileAllAppNetworkLinks: failed to read installed apps: ${error.message}`);
    return;
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const app of installedApps || []) {
    const linkedApps = getLinkedApps(app);
    if (!linkedApps.length) {
      // eslint-disable-next-line no-continue
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const containerNames = await dockerService.getAppContainerNames(app.name);
      // eslint-disable-next-line no-restricted-syntax
      for (const linkedApp of linkedApps) {
        const networkName = `fluxDockerNetwork_${linkedApp}`;
        // eslint-disable-next-line no-restricted-syntax
        for (const containerName of containerNames) {
          // eslint-disable-next-line no-await-in-loop
          await dockerService.appDockerNetworkConnect(containerName, networkName).catch((error) => {
            log.error(`reconcileAllAppNetworkLinks: failed to connect ${containerName} to ${networkName}: ${error.message}`);
          });
        }
      }
    } catch (error) {
      log.error(`reconcileAllAppNetworkLinks: failed for ${app.name}: ${error.message}`);
    }
  }
}

/**
 * For a SEND component being installed in an app whose own compose array does
 * NOT contain a LOG=COLLECT component, looks at every app this app is
 * networkWith-linked to and returns the first linked app that owns a COLLECT
 * component. The actual container name resolution happens in the caller.
 *
 * Enterprise linked apps whose `compose` is blanked in the local DB and not
 * decryptable on this node are skipped — the SEND container will fall back to
 * json-file logging.
 *
 * @param {object} fullAppSpecs - app specification of the app being installed
 * @returns {Promise<{linkedAppName: string, collectorComponentName: string}|null>}
 */
async function findLinkedAppLogCollector(fullAppSpecs) {
  const linkedApps = getLinkedApps(fullAppSpecs);
  if (!linkedApps.length) {
    return null;
  }

  // Lazy require to avoid the circular dependency dockerService → appLifecycle/appNetworkLinker → appDatabase/registryManager → dockerService.
  // eslint-disable-next-line global-require
  const registryManager = require('../appDatabase/registryManager');

  // eslint-disable-next-line no-restricted-syntax
  for (const linkedAppName of linkedApps) {
    let linkedSpec;
    try {
      // eslint-disable-next-line no-await-in-loop
      linkedSpec = await registryManager.getApplicationSpecifications(linkedAppName);
    } catch (error) {
      log.warn(`findLinkedAppLogCollector: failed to read spec for ${linkedAppName}: ${error.message}`);
      // eslint-disable-next-line no-continue
      continue;
    }
    if (!linkedSpec || !Array.isArray(linkedSpec.compose) || !linkedSpec.compose.length) {
      // No compose to scan — typical for enterprise apps on non-Arcane nodes.
      // eslint-disable-next-line no-continue
      continue;
    }
    const collectorComponent = linkedSpec.compose.find((component) => {
      const envs = (component && (component.environmentParameters || component.enviromentParameters)) || [];
      return envs.some((env) => typeof env === 'string' && env.startsWith('LOG=COLLECT'));
    });
    if (collectorComponent && collectorComponent.name) {
      return { linkedAppName, collectorComponentName: collectorComponent.name };
    }
  }
  return null;
}

module.exports = {
  parseNetworkWith,
  getLinkedApps,
  parseDependencyOnly,
  computeRequiredDependencyNames,
  getRequiredDependencyNamesForNode,
  findUnrequiredInstalledDependencies,
  checkAppNetworkRequirements,
  connectComponentToLinkedApps,
  reconnectLinkedApps,
  reconcileAllAppNetworkLinks,
  findLinkedAppLogCollector,
};
