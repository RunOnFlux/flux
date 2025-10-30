const config = require('config');
const axios = require('axios');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const pgpService = require('../pgpService');
const imageVerifier = require('../utils/imageVerifier');
const dbHelper = require('../dbHelper');
const verificationHelper = require('../verificationHelper');
const log = require('../../lib/log');
const userconfig = require('../../../../config/userconfig');
const { supportedArchitectures, globalAppsMessages, globalAppsInformation } = require('../utils/appConstants');
const fluxCaching = require('../utils/cacheManager').default;

// Global cache for original compatibility
let myLongCache = {
  cache: new Map(),
  get(key) { return this.cache.get(key); },
  set(key, value) { this.cache.set(key, value); }
};

// Cache for blocked repositories
let cacheUserBlockedRepos = null;

/**
 * Classify error type and determine appropriate cache TTL
 * Uses structured error metadata from imageVerifier when available
 * @param {Error} error - The error from image verification
 * @param {object} errorMeta - Error metadata from imageVerifier (httpStatus, errorCode, errorType)
 * @returns {{ttlMs: number, reason: string}}
 */
function classifyVerificationError(error, errorMeta) {
  const { FluxCacheManager } = require('../utils/cacheManager');

  // Use structured errorMeta if available (from imageVerifier)
  if (errorMeta && errorMeta.errorType) {
    switch (errorMeta.errorType) {
      case 'network':
        return { ttlMs: FluxCacheManager.oneHour, reason: 'Network/Connection error' };
      case 'rate_limit':
        return { ttlMs: 2 * FluxCacheManager.oneHour, reason: 'Rate limiting (429)' };
      case 'server_error':
        return { ttlMs: 3 * FluxCacheManager.oneHour, reason: 'Server error (5xx)' };
      case 'whitelist_fetch_error':
      case 'auth_unavailable':
        return { ttlMs: 2 * FluxCacheManager.oneHour, reason: 'Temporary service issue' };
      // Permanent errors - longer cache
      case 'not_whitelisted':
      case 'invalid_format':
      case 'unsupported_architecture':
      case 'unsupported_media_type':
      case 'unsupported_schema':
      case 'auth_rejected':
      case 'auth_failed':
      case 'size_limit':
        return { ttlMs: 6 * FluxCacheManager.oneHour, reason: `Permanent error: ${errorMeta.errorType}` };
      default:
        return { ttlMs: 4 * FluxCacheManager.oneHour, reason: 'Unknown error type' };
    }
  }

  // Fallback to message parsing if errorMeta not available (shouldn't happen with updated imageVerifier)
  const errorMessage = error.message.toLowerCase();
  if (errorMessage.includes('connection error') || errorMessage.includes('econnrefused')
    || errorMessage.includes('enetunreach')) {
    return { ttlMs: FluxCacheManager.oneHour, reason: 'Network error (fallback)' };
  }
  if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
    return { ttlMs: 2 * FluxCacheManager.oneHour, reason: 'Rate limit (fallback)' };
  }
  if (errorMessage.includes('bad http status 5')) {
    return { ttlMs: 3 * FluxCacheManager.oneHour, reason: 'Server error (fallback)' };
  }

  // Default permanent error
  return { ttlMs: 6 * FluxCacheManager.oneHour, reason: 'Permanent error (fallback)' };
}

/**
 * Verify repository and image compliance
 * @param {string} repotag - Repository tag to verify
 * @param {object} options - Verification options
 * @returns {Promise<object>} Verification result
 */
async function verifyRepository(repotag, options = {}) {
  const repoauth = options.repoauth || null;
  const authVersion = options.authVersion || 8;
  const architecture = options.architecture || null;

  // Check cache first to avoid redundant Docker Hub API calls
  // Cache key includes architecture since same image may have different arch support
  const cacheKey = `${repotag}:${architecture || 'any'}:${repoauth ? 'auth' : 'noauth'}`;
  const cached = fluxCaching.dockerHubVerificationCache.get(cacheKey);

  if (cached) {
    log.info(`Docker Hub verification cache HIT for ${repotag} (${architecture || 'any'})`);
    // If cached verification failed, throw the cached error
    if (cached.error) {
      throw new Error(cached.error);
    }
    return cached.result;
  }

  const imgVerifier = new imageVerifier.ImageVerifier(
    repotag,
    { maxImageSize: config.fluxapps.maxImageSize, architecture, architectureSet: supportedArchitectures },
  );

  // we skip veriying repos on v7 encrypted as we probably don't have the key
  if (repoauth && authVersion === 7) {
    return;
  }

  if (repoauth) {
    imgVerifier.addCredentials(repoauth);
  }

  try {
    await imgVerifier.verifyImage();
    imgVerifier.throwIfError();

    if (architecture && !imgVerifier.supported) {
      throw new Error(`This Fluxnode's architecture ${architecture} not supported by ${repotag}`);
    }

    // Cache successful verification (uses default TTL from FluxCacheManager: 1 hour)
    fluxCaching.dockerHubVerificationCache.set(cacheKey, {
      result: true,
      error: null,
    });
    log.info(`Docker Hub verification cache MISS - cached for ${repotag} (${architecture || 'any'})`);

    return true;
  } catch (error) {
    // Use errorMeta from imageVerifier for intelligent classification
    const errorMeta = imgVerifier.errorMeta;
    const { ttlMs, reason } = classifyVerificationError(error, errorMeta);

    log.warn(`Docker Hub verification failed for ${repotag}: ${error.message}`);
    log.warn(`Error classified as: ${reason} (retry in ${ttlMs / 1000 / 60 / 60} hours)`);

    // Cache failure with custom TTL based on error type
    fluxCaching.dockerHubVerificationCache.set(cacheKey, {
      result: null,
      error: error.message,
    }, { ttl: ttlMs });

    throw error;
  }
}

/**
 * Get blocked repositories from official source
 * @returns {Promise<Array|null>} List of blocked repositories
 */
async function getBlockedRepositores() {
  try {
    const cachedResponse = myLongCache.get('blockedRepositories');
    if (cachedResponse) {
      return cachedResponse;
    }
    const resBlockedRepo = await serviceHelper.axiosGet('https://raw.githubusercontent.com/RunOnFlux/flux/master/helpers/blockedrepositories.json');
    if (resBlockedRepo.data) {
      myLongCache.set('blockedRepositories', resBlockedRepo.data);
      return resBlockedRepo.data;
    }
    return null;
  } catch (error) {
    log.error(error);
    return null;
  }
}

/**
 * Get user-defined blocked repositories from configuration
 * @returns {Promise<Array>} List of user blocked repositories
 */
async function getUserBlockedRepositores() {
  try {
    if (cacheUserBlockedRepos) {
      return cacheUserBlockedRepos;
    }

    const userBlockedRepos = userconfig.initial.blockedRepositories || [];
    if (userBlockedRepos.length === 0) {
      return userBlockedRepos;
    }
    const usableUserBlockedRepos = [];
    const marketPlaceUrl = 'https://stats.runonflux.io/marketplace/listapps';
    const response = await axios.get(marketPlaceUrl);
    console.log(response);
    if (response && response.data && response.data.status === 'success') {
      const visibleApps = response.data.data.filter((val) => val.visible);
      for (let i = 0; i < userBlockedRepos.length; i += 1) {
        const userRepo = userBlockedRepos[i];
        userRepo.substring(0, userRepo.lastIndexOf(':') > -1 ? userRepo.lastIndexOf(':') : userRepo.length);
        const exist = visibleApps.find((app) => app.compose.find((compose) => compose.repotag.substring(0, compose.repotag.lastIndexOf(':') > -1 ? compose.repotag.lastIndexOf(':') : compose.repotag.length).toLowerCase() === userRepo.toLowerCase()));
        if (!exist) {
          usableUserBlockedRepos.push(userRepo);
        } else {
          log.info(`${userRepo} is part of marketplace offer and despite being on blockedRepositories it will not be take in consideration`);
        }
      }
      cacheUserBlockedRepos = usableUserBlockedRepos;
      return cacheUserBlockedRepos;
    }
    return [];

  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * Check application secrets compliance
 * @param {string} appName - Application name
 * @param {object} appComponentSpecs - Component specifications
 * @param {string} appOwner - Application owner
 * @param {boolean} registration - Whether this is a registration (true) or update (false)
 * @returns {Promise<boolean>} True if secrets are valid
 */
async function checkAppSecrets(appName, appComponentSpecs, appOwner, registration = false) {
  log.info('checkAppSecrets - starting');
  log.info(`checkAppSecrets - appOwner: ${appOwner}`);

  // Normalize PGP secrets for consistent comparison
  const normalizePGP = (pgpMessage) => {
    if (!pgpMessage) return '';
    return pgpMessage.replace(/\s+/g, '').replace(/\\n/g, '').trim();
  };

  const appComponentSecrets = normalizePGP(appComponentSpecs.secrets);

  // Database connection
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = { projection: { _id: 0 } };

  // Query global apps
  const results = await dbHelper.findInDatabase(database, globalAppsInformation, {}, projection);

  let foundSecretsWithSameAppName = false;
  let foundSecretsWithDifferentAppName = false;
  // eslint-disable-next-line no-restricted-syntax
  for (const app of results) {
    if (app.version >= 7 && app.nodes.length > 0) {
      // eslint-disable-next-line no-restricted-syntax
      for (const component of app.compose) {
        const normalizedComponentSecret = normalizePGP(component.secrets);

        if (normalizedComponentSecret === appComponentSecrets) {
          if (registration) {
            throw new Error(
              `Provided component '${appComponentSpecs.name}' secrets are not valid (duplicate in app: '${app.name}')`
            );
          } else if (app.name !== appName) {
            foundSecretsWithDifferentAppName = true;
          } else {
            foundSecretsWithSameAppName = true;
          }
        }
      }
    }
  }

  if (!registration && foundSecretsWithDifferentAppName && !foundSecretsWithSameAppName) {
    throw new Error('Provided component(s) secrets are not valid (conflict with another app).');
  }

  // Query permanent app messages
  const appsQuery = {
    $and: [
      { 'appSpecifications.name': 'encrypted' },
      { 'appSpecifications.version': 7 },
      { 'appSpecifications.nodes': { $exists: true, $ne: [] } },
    ],
  };
  log.info('checkAppSecrets - checking permanentAppMessages');

  const permanentAppMessages = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
  log.info(`checkAppSecrets - permanentAppMessages found: ${permanentAppMessages.length}`);

  const processedSecrets = new Set();
  // eslint-disable-next-line no-restricted-syntax
  for (const message of permanentAppMessages) {
    // eslint-disable-next-line no-restricted-syntax
    for (const component of message.appSpecifications.compose) {
      const normalizedComponentSecret = normalizePGP(component.secrets);
      // eslint-disable-next-line no-continue
      if (processedSecrets.has(normalizedComponentSecret)) continue;
      processedSecrets.add(normalizedComponentSecret);

      if (normalizedComponentSecret === appComponentSecrets) {
        log.info('checkAppSecrets - found same secret');
        log.info(`checkAppSecrets - appOwner: ${appOwner}`);
        log.info(`checkAppSecrets - message owner: ${message.appSpecifications.owner}`);

        if (message.appSpecifications.owner !== appOwner) {
          throw new Error(
            `Provided component '${appComponentSpecs.name}' secrets are not valid (owner mismatch: '${message.appSpecifications.owner}').`
          );
        }
      }
    }
  }

  log.info('checkAppSecrets - completed successfully');
}

/**
 * Check application images compliance against blocked repositories
 * @param {object} appSpecs - Application specifications
 * @returns {Promise<boolean>} True if images are compliant
 */
async function checkApplicationImagesCompliance(appSpecs) {
  const repos = await getBlockedRepositores();
  const userBlockedRepos = await getUserBlockedRepositores();

  if (!repos) {
    throw new Error('Unable to communicate with Flux Services! Try again later.');
  }

  const pureImagesOrOrganisationsRepos = [];
  repos.forEach((repo) => {
    pureImagesOrOrganisationsRepos.push(repo.substring(0, repo.lastIndexOf(':') > -1 ? repo.lastIndexOf(':') : repo.length));
  });

  // userBlockedRepos handling will be done separately below

  // Check if app hash is blocked
  if (pureImagesOrOrganisationsRepos.includes(appSpecs.hash)) {
    throw new Error(`${appSpecs.hash} is not allowed to be spawned`);
  }

  // Check if app owner is blocked
  if (pureImagesOrOrganisationsRepos.includes(appSpecs.owner)) {
    throw new Error(`${appSpecs.owner} is not allowed to run applications`);
  }

  const images = [];
  const organisations = [];

  if (appSpecs.version <= 3) {
    const repository = appSpecs.repotag.substring(0, appSpecs.repotag.lastIndexOf(':') > -1 ? appSpecs.repotag.lastIndexOf(':') : appSpecs.repotag.length);
    images.push(repository);
    const pureNamespace = repository.substring(0, repository.lastIndexOf('/') > -1 ? repository.lastIndexOf('/') : repository.length);
    organisations.push(pureNamespace);
  } else {
    appSpecs.compose.forEach((component) => {
      const repository = component.repotag.substring(0, component.repotag.lastIndexOf(':') > -1 ? component.repotag.lastIndexOf(':') : component.repotag.length);
      images.push(repository);
      const pureNamespace = repository.substring(0, repository.lastIndexOf('/') > -1 ? repository.lastIndexOf('/') : repository.length);
      organisations.push(pureNamespace);
    });
  }

  images.forEach((image) => {
    if (pureImagesOrOrganisationsRepos.includes(image)) {
      throw new Error(`Image ${image} is blocked. Application ${appSpecs.name} cannot be spawned.`);
    }
  });
  organisations.forEach((org) => {
    if (pureImagesOrOrganisationsRepos.includes(org)) {
      throw new Error(`Organisation ${org} is blocked. Application ${appSpecs.name} cannot be spawned.`);
    }
  });
  if (userBlockedRepos) {
    log.info(`userBlockedRepos: ${JSON.stringify(userBlockedRepos)}`);
    organisations.forEach((org) => {
      if (userBlockedRepos.includes(org.toLowerCase())) {
        throw new Error(`Organisation ${org} is user blocked. Application ${appSpecs.name} cannot be spawned.`);
      }
    });
    images.forEach((image) => {
      if (userBlockedRepos.includes(image.toLowerCase())) {
        throw new Error(`Image ${image} is user blocked. Application ${appSpecs.name} cannot be spawned.`);
      }
    });
  }

  return true;
}

/**
 * Check if application images are blocked (non-throwing version)
 * @param {object} appSpecs - Application specifications
 * @returns {Promise<boolean>} True if blocked
 */
async function checkApplicationImagesBlocked(appSpecs) {
  const repos = await getBlockedRepositores();
  const userBlockedRepos = await getUserBlockedRepositores();
  let isBlocked = false;
  if (!repos && !userBlockedRepos) {
    return isBlocked;
  }
  const images = [];
  const organisations = [];
  if (appSpecs.version <= 3) {
    const repository = appSpecs.repotag.substring(0, appSpecs.repotag.lastIndexOf(':') > -1 ? appSpecs.repotag.lastIndexOf(':') : appSpecs.repotag.length);
    images.push(repository);
    const pureNamespace = repository.substring(0, repository.lastIndexOf('/') > -1 ? repository.lastIndexOf('/') : repository.length);
    organisations.push(pureNamespace);
  } else {
    appSpecs.compose.forEach((component) => {
      const repository = component.repotag.substring(0, component.repotag.lastIndexOf(':') > -1 ? component.repotag.lastIndexOf(':') : component.repotag.length);
      images.push(repository);
      const pureNamespace = repository.substring(0, repository.lastIndexOf('/') > -1 ? repository.lastIndexOf('/') : repository.length);
      organisations.push(pureNamespace);
    });
  }
  if (repos) {
    const pureImagesOrOrganisationsRepos = [];
    repos.forEach((repo) => {
      pureImagesOrOrganisationsRepos.push(repo.substring(0, repo.lastIndexOf(':') > -1 ? repo.lastIndexOf(':') : repo.length));
    });

    // blacklist works also for zelid and app hash
    if (pureImagesOrOrganisationsRepos.includes(appSpecs.hash)) {
      return `${appSpecs.hash} is not allowed to be spawned`;
    }
    if (pureImagesOrOrganisationsRepos.includes(appSpecs.owner)) {
      return `${appSpecs.owner} is not allowed to run applications`;
    }

    images.forEach((image) => {
      if (pureImagesOrOrganisationsRepos.includes(image)) {
        isBlocked = `Image ${image} is blocked. Application ${appSpecs.name} cannot be spawned.`;
      }
    });
    organisations.forEach((org) => {
      if (pureImagesOrOrganisationsRepos.includes(org)) {
        isBlocked = `Organisation ${org} is blocked. Application ${appSpecs.name} cannot be spawned.`;
      }
    });
  }

  if (!isBlocked && userBlockedRepos) {
    log.info(`userBlockedRepos: ${JSON.stringify(userBlockedRepos)}`);
    organisations.forEach((org) => {
      if (userBlockedRepos.includes(org.toLowerCase())) {
        isBlocked = `Organisation ${org} is user blocked. Application ${appSpecs.name} cannot be spawned.`;
      }
    });
    if (!isBlocked) {
      images.forEach((image) => {
        if (userBlockedRepos.includes(image.toLowerCase())) {
          isBlocked = `Image ${image} is user blocked. Application ${appSpecs.name} cannot be spawned.`;
        }
      });
    }
  }

  return isBlocked;
}


/**
 * Check Docker accessibility for repository
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Docker accessibility result
 */
async function checkDockerAccessibility(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        return res.json(errMessage);
      }
      // check repotag if available for download
      const processedBody = serviceHelper.ensureObject(body);

      if (!processedBody.repotag) {
        throw new Error('No repotag specifiec');
      }

      const message = messageHelper.createSuccessMessage('deprecated');
      // await verifyRepository(processedBody.repotag);
      // const message = messageHelper.createSuccessMessage('Repotag is accessible');
      return res.json(message);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      return res.json(errorResponse);
    }
  });
}

/**
 * Check applications compliance and remove blacklisted apps
 * @param {Function} installedApps - Function to get installed apps
 * @param {Function} removeAppLocally - Function to remove app locally
 * @returns {Promise<void>}
 */
async function checkApplicationsCompliance(installedApps, removeAppLocally) {
  try {
    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    const appsToRemoveNames = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsInstalled) {
      // eslint-disable-next-line no-await-in-loop
      const isAppBlocked = await checkApplicationImagesBlocked(app);
      if (isAppBlocked) {
        if (!appsToRemoveNames.includes(app.name)) {
          appsToRemoveNames.push(app.name);
        }
      }
    }
    // remove appsToRemoveNames apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      log.warn(`Application ${appName} is blacklisted, removing`);
      log.warn(`REMOVAL REASON: Blacklisted image - ${appName} uses a blacklisted Docker image (imageManager)`);
      // eslint-disable-next-line no-await-in-loop
      await removeAppLocally(appName, null, false, true, true);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(3 * 60 * 1000); // wait for 3 mins so we don't have more removals at the same time
    }
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  verifyRepository,
  getBlockedRepositores,
  getUserBlockedRepositores,
  checkAppSecrets,
  checkApplicationImagesCompliance,
  checkApplicationImagesBlocked,
  checkDockerAccessibility,
  checkApplicationsCompliance,
};
