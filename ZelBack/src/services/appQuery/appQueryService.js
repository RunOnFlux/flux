// App Query Service - Query and information functions for installed apps
const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const registryManager = require('../appDatabase/registryManager');
const appConstants = require('../utils/appConstants');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const fluxCaching = require('../utils/cacheManager');
const log = require('../../lib/log');

// Database collections
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

// Decryption is delegated to fluxbenchd, and many callers can ask about the
// same spec at once (every component's reconcile retry, sweeps, listings). To
// keep that from hammering benchd while it is down or hung: one in-flight
// attempt per spec is shared by concurrent callers, and a failure is
// remembered for a short window during which callers are answered from it
// (lenient callers get the spec back encrypted, strict callers get the
// rethrow) without another benchd call. Failures are deliberately NOT cached
// longer - a long-lived failure cache would delay recovery; successes live in
// the 7-day enterpriseAppDecryptionCache.
const DECRYPT_FAILURE_WINDOW_MS = 60 * 1000;
const decryptFailures = new Map(); // spec hash -> { error, at }
const decryptInFlight = new Map(); // spec hash -> Promise<decrypted spec>

/**
 * Resolves the decrypted spec for one enterprise app via cache, the failure
 * window, or a (shared) fluxbenchd attempt. Throws the decrypt error on
 * failure - the caller decides lenient vs strict handling.
 * @param {object} spec - Enterprise app specification (encrypted)
 * @returns {Promise<object>} Decrypted specification (unformatted)
 */
async function decryptEnterpriseSpec(spec) {
  const cacheKey = spec.hash;
  const cache = fluxCaching.default.enterpriseAppDecryptionCache;

  const cached = cache.get(cacheKey);
  if (cached) {
    log.info(`Using cached decrypted app for ${spec.name} (${cacheKey})`);
    return cached;
  }

  const failure = decryptFailures.get(cacheKey);
  if (failure && Date.now() - failure.at < DECRYPT_FAILURE_WINDOW_MS) {
    throw failure.error;
  }

  let inFlight = decryptInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const decrypted = await checkAndDecryptAppSpecs(spec);
        // Store unformatted in cache with 7-day TTL (configured in cacheManager)
        cache.set(cacheKey, decrypted);
        decryptFailures.delete(cacheKey);
        log.info(`Cached decrypted app for ${spec.name} (${cacheKey})`);
        return decrypted;
      } catch (error) {
        decryptFailures.set(cacheKey, { error, at: Date.now() });
        throw error;
      } finally {
        decryptInFlight.delete(cacheKey);
      }
    })();
    decryptInFlight.set(cacheKey, inFlight);
  }
  return inFlight;
}

/**
 * Decrypt enterprise apps, reporting the ones that could not be read.
 *
 * An enterprise spec carries its components inside the encrypted blob, so a
 * failed decrypt leaves a spec with no components - which is not a valid app
 * and must never be handed out as though it were. Every caller that enumerates
 * components would act on it as "this app has none": the sweep would delete its
 * folders, the blocked-image scan would find no images to block, the update
 * check would find nothing to update. All silent.
 *
 * So the result says which apps were read and which were not. A caller that
 * acts on components skips the unreadable ones and says so; a caller that only
 * lists them can put them straight back in the list.
 * @param {Array} apps - Array of app specifications
 * @param {Object} options - Options for decryption
 * @param {boolean} options.formatSpecs - Whether to format specs (strips metadata like hash, height). Default: true
 * @returns {Promise<{apps: Array, unreadable: Array}>} The specs that decrypted,
 *   and the still-encrypted specs that did not
 */
async function decryptEnterpriseApps(apps, options = {}) {
  const { formatSpecs = true } = options;
  const decryptedApps = [];
  const unreadable = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const spec of apps) {
    const isEnterprise = Boolean(
      spec.version >= 8 && spec.enterprise,
    );
    if (isEnterprise) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const decrypted = await decryptEnterpriseSpec(spec);

        // Apply formatting if requested
        const result = formatSpecs ? specificationFormatter(decrypted) : decrypted;
        decryptedApps.push(result);
      } catch (error) {
        log.error(`Failed to decrypt enterprise app ${spec.name}: ${error.message}`);
        unreadable.push(spec);
      }
    } else {
      decryptedApps.push(spec);
    }
  }
  return { apps: decryptedApps, unreadable };
}

/**
 * The apps that decrypted, with the ones that did not put back in the list.
 * For callers that only display or count apps and never read a component: the
 * list is the product, and an app missing from it would read as uninstalled.
 * @param {Array} apps - Array of app specifications
 * @param {Object} [options] - Passed to decryptEnterpriseApps
 * @returns {Promise<Array>} Every app, decrypted where possible
 */
async function decryptEnterpriseAppsForListing(apps, options = {}) {
  const { apps: readable, unreadable } = await decryptEnterpriseApps(apps, options);
  if (!unreadable.length) return readable;
  // each unreadable spec goes back where it was, so the order a caller sees is
  // the order it asked about
  const failed = new Set(unreadable);
  const decrypted = [...readable];
  return apps.map((spec) => (failed.has(spec) ? spec : decrypted.shift()));
}

/**
 * To list installed apps. Returns apps from local database.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function installedApps(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    let appsQuery = {};
    if (req && req.params && req.query) {
      let { appname } = req.params;
      appname = appname || req.query.appname;
      if (appname) {
        appsQuery = { name: appname };
      }
    } else if (req && typeof req === 'string') {
      appsQuery = { name: req };
    }

    const appsProjection = {
      projection: { _id: 0 },
    };

    const apps = await dbHelper.findInDatabase(appsDatabase, appConstants.localAppsInformation, appsQuery, appsProjection);
    const dataResponse = messageHelper.createDataMessage(apps);
    return res ? res.json(dataResponse) : dataResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * To list running apps.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listRunningApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(false);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));
    }

    // Include apps that are in backup or restore as "running" even if container is stopped
    const globalState = require('../utils/globalState');
    const backupInProgress = globalState.backupInProgress || [];
    const restoreInProgress = globalState.restoreInProgress || [];
    const appsInBackupRestore = [...backupInProgress, ...restoreInProgress];

    if (appsInBackupRestore.length > 0) {
      // Get all containers including stopped ones
      const allContainers = await dockerService.dockerListContainers(true);
      const fluxContainers = allContainers.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));

      // Find stopped containers that are in backup/restore and add them to running list
      fluxContainers.forEach((container) => {
        const containerName = container.Names[0].slice(1); // Remove leading '/'
        const appName = containerName.replace(/^(zel|flux)/, ''); // Remove zel/flux prefix
        // backup/restore hold the bare MAIN app name; composed containers are
        // component_app, so compare on the main name
        const mainAppName = appName.split('_')[1] || appName;

        // If this app is in backup/restore and not already in running list, add it
        if (appsInBackupRestore.includes(mainAppName)) {
          const alreadyIncluded = apps.some((app) => app.Names[0] === container.Names[0]);
          if (!alreadyIncluded) {
            // Keep original state - FDM treats any container in list as active
            const containerCopy = { ...container };
            apps.push(containerCopy);
          }
        }
      });
    }

    const modifiedApps = [];
    apps.forEach((app) => {
      // eslint-disable-next-line no-param-reassign
      delete app.HostConfig;
      // eslint-disable-next-line no-param-reassign
      delete app.NetworkSettings;
      // eslint-disable-next-line no-param-reassign
      delete app.Mounts;
      modifiedApps.push(app);
    });
    const appsResponse = messageHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Component identifiers this node holds: running here, or committed to running
 * and not started yet.
 *
 * The question a primary election actually asks a peer. Running containers alone
 * answer it wrongly during the masterSlave primary path, which fixes ownership on
 * the persistent data before it starts anything - for that whole window the node
 * has decided but has no container, so a peer reading running containers is told
 * the component is free and starts a second writer on the shared volume.
 *
 * Uncached, unlike listrunningapps: a 15-second-stale answer reopens the same
 * window it exists to close.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message carrying an array of container-name identifiers.
 */
async function heldComponents(req, res) {
  try {
    const containers = await dockerService.dockerListContainers(false);
    const running = containers
      .map((container) => (container.Names?.[0] || '').replace(/^\//, ''))
      .filter((name) => name.slice(0, 3) === 'zel' || name.slice(0, 4) === 'flux');

    // eslint-disable-next-line global-require
    const appReconciler = require('../appMonitoring/appReconciler');
    const committed = appReconciler.committedIdentifiers()
      .map((identifier) => dockerService.getAppIdentifier(identifier));

    const held = [...new Set([...running, ...committed])];
    const response = messageHelper.createDataMessage(held);
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * Syncthing folder ids this node has promoted to sendreceive - the folders it
 * holds the writable copy of.
 *
 * Asked by a peer before it promotes a folder of its own. Promotion is decided
 * from each node's own view of the holder list, and those views fill in at
 * different moments, so two nodes can each conclude they are the one - the first
 * while it is briefly the only holder it knows of, the second once it can see
 * more and wins the tiebreak among them. Neither revisits the decision, because a
 * promoted folder never re-enters the election. Nothing else carries this: folder
 * type is local syncthing config, and at genesis the promoted node has no data
 * yet, so the has-data signal is silent exactly when it is needed.
 *
 * Served from the set the syncthing monitor refreshes each pass, not by reading
 * syncthing per request: the route is unauthenticated and reachable by any peer,
 * so an on-demand read would be an amplifier into syncthing, and the API has no
 * rate limiting of its own. It is also then O(1), so it needs no response cache
 * and carries no staleness beyond one monitor pass.
 *
 * `ready` is what stops a booting node being read as a free one. Before the
 * monitor's first pass this node cannot distinguish "I hold nothing" from "I have
 * not looked", and answering the first would invite a peer to promote alongside a
 * folder this node is already holding. The asker treats an unready peer as a
 * reason to wait rather than a clearance.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message carrying { ready, folders }.
 */
async function promotedFolders(req, res) {
  try {
    // eslint-disable-next-line global-require
    const globalState = require('../utils/globalState');
    const ids = globalState.promotedFolderIds;
    const response = messageHelper.createDataMessage({
      ready: ids !== null,
      folders: ids === null ? [] : [...ids],
    });
    return res ? res.json(response) : response;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * List all apps (both running and installed)
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function listAllApps(req, res) {
  try {
    let apps = await dockerService.dockerListContainers(true);
    if (apps.length > 0) {
      apps = apps.filter((app) => (app.Names[0].slice(1, 4) === 'zel' || app.Names[0].slice(1, 5) === 'flux'));
    }
    const modifiedApps = [];
    apps.forEach((app) => {
      // eslint-disable-next-line no-param-reassign
      delete app.HostConfig;
      // eslint-disable-next-line no-param-reassign
      delete app.NetworkSettings;
      // eslint-disable-next-line no-param-reassign
      delete app.Mounts;
      modifiedApps.push(app);
    });
    const appsResponse = messageHelper.createDataMessage(modifiedApps);
    return res ? res.json(appsResponse) : appsResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * To get latest application specification API version.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getlatestApplicationSpecificationAPI(req, res) {
  const latestSpec = config.fluxapps.latestAppSpecification || 1;

  const message = messageHelper.createDataMessage(latestSpec);

  res.json(message);
}

/**
 * To get application original owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getApplicationOriginalOwner(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const projection = {
      projection: {
        _id: 0,
      },
    };
    log.info(`Searching register permanent messages for ${appname}`);
    const appsQuery = {
      'appSpecifications.name': appname,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
    const ownerResponse = messageHelper.createDataMessage(lastAppRegistration.appSpecifications.owner);
    res.json(ownerResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get apps installing locations.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsInstallingLocations(req, res) {
  try {
    const results = await registryManager.appInstallingLocation();
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

/**
 * To get count of app messages by owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsMessagesCount(req, res) {
  try {
    let { appowner } = req.params;
    appowner = appowner || req.query.appowner;
    if (!appowner) {
      throw new Error('No Application Owner specified');
    }
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { 'appSpecifications.owner': appowner };

    const count = await dbHelper.countInDatabase(database, globalAppsMessages, query);
    const countResponse = messageHelper.createDataMessage(count);
    res.json(countResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

module.exports = {
  installedApps,
  decryptEnterpriseApps,
  decryptEnterpriseAppsForListing,
  listRunningApps,
  heldComponents,
  promotedFolders,
  listAllApps,
  getlatestApplicationSpecificationAPI,
  getApplicationOriginalOwner,
  getAppsInstallingLocations,
  getAppsMessagesCount,
};
