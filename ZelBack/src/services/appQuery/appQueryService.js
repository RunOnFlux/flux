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
 * Decrypt enterprise apps from a list of apps
 * @param {Array} apps - Array of app specifications
 * @param {Object} options - Options for decryption
 * @param {boolean} options.formatSpecs - Whether to format specs (strips metadata like hash, height). Default: true
 * @param {boolean} options.throwOnError - Rethrow a decrypt failure instead of returning the encrypted spec. Default: false
 * @returns {Promise<Array>} Array of decrypted app specifications
 */
async function decryptEnterpriseApps(apps, options = {}) {
  const { formatSpecs = true, throwOnError = false } = options;
  const decryptedApps = [];

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
        // Display/listing callers (default) keep the lenient behavior: include the
        // still-encrypted spec so the rest of the list isn't lost. Callers that act
        // on the spec (the reconciler) pass throwOnError so they can defer rather
        // than operate on undecrypted data (wrong containerData, mis-typed g:/r:).
        if (throwOnError) throw error;
        decryptedApps.push(spec);
      }
    } else {
      decryptedApps.push(spec);
    }
  }
  return decryptedApps;
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
  listRunningApps,
  listAllApps,
  getlatestApplicationSpecificationAPI,
  getApplicationOriginalOwner,
  getAppsInstallingLocations,
  getAppsMessagesCount,
};
