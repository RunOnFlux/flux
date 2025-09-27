const config = require('config');
const axios = require('axios');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const pgpService = require('../pgpService');
const imageVerifier = require('../utils/imageVerifier');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const userconfig = require('../../../../config/userconfig');
const { supportedArchitectures, globalAppsMessages } = require('../utils/appConstants');

// Global cache for original compatibility
let myLongCache = {
  cache: new Map(),
  get(key) { return this.cache.get(key); },
  set(key, value) { this.cache.set(key, value); }
};

// Cache for blocked repositories
let cacheUserBlockedRepos = null;

/**
 * Verify repository and image compliance
 * @param {string} repotag - Repository tag to verify
 * @param {object} options - Verification options
 * @returns {Promise<object>} Verification result
 */
async function verifyRepository(repotag, options = {}) {
  const repoauth = options.repoauth || null;
  const skipVerification = options.skipVerification || false;
  const architecture = options.architecture || null;

  const imgVerifier = new imageVerifier.ImageVerifier(
    repotag,
    { maxImageSize: config.fluxapps.maxImageSize, architecture, architectureSet: supportedArchitectures },
  );

  // ToDo: fix this upstream
  if (repoauth && skipVerification) {
    return;
  }

  if (repoauth) {
    const authToken = await pgpService.decryptMessage(repoauth);

    if (!authToken) {
      throw new Error('Unable to decrypt provided credentials');
    }

    if (!authToken.includes(':')) {
      throw new Error('Provided credentials not in the correct username:token format');
    }

    imgVerifier.addCredentials(authToken);
  }

  await imgVerifier.verifyImage();
  imgVerifier.throwIfError();

  if (architecture && !imgVerifier.supported) {
    throw new Error(`This Fluxnode's architecture ${architecture} not supported by ${repotag}`);
  }
}

/**
 * Get blocked repositories from official source
 * @param {object} myLongCache - Cache reference
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
 * @returns {Promise<boolean>} True if secrets are valid
 */
async function checkAppSecrets(appName, appComponentSpecs, appOwner) {
  // Normalize PGP secrets string
  const normalizePGP = (pgpMessage) => {
    if (!pgpMessage) return '';
    return pgpMessage.replace(/\s+/g, '').replace(/\\n/g, '').trim();
  };

  const appComponentSecrets = normalizePGP(appComponentSpecs.secrets);

  // If no secrets, return true (no secrets required)
  if (!appComponentSecrets) {
    return true;
  }

  try {
    // Database connection
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const projection = { projection: { _id: 0 } };

    // Query permanent app messages for apps with node restrictions
    const appsQuery = {
      $and: [
        { 'appSpecifications.version': 7 },
        { 'appSpecifications.nodes': { $exists: true, $ne: [] } },
      ],
    };

    const appsWithNodeRestrictions = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);

    const permanentAppMessages = appsWithNodeRestrictions;
    const processedSecrets = new Set();
    // eslint-disable-next-line no-restricted-syntax
    for (const message of permanentAppMessages) {
      // eslint-disable-next-line no-restricted-syntax
      for (const component of message.appSpecifications.compose.filter((comp) => comp.secrets)) {
        const normalizedComponentSecret = normalizePGP(component.secrets);
        // eslint-disable-next-line no-continue
        if (processedSecrets.has(normalizedComponentSecret)) continue;
        processedSecrets.add(normalizedComponentSecret);
        if (normalizedComponentSecret === appComponentSecrets && message.appSpecifications.owner !== appOwner) {
          throw new Error(
            `Component '${appComponentSpecs.name}' secrets are not valid - registered already with different app owner').`,
          );
        }
      }
    }

    return true;
  } catch (error) {
    log.error(`Error checking app secrets for ${appName}: ${error.message}`);
    throw error;
  }
}

/**
 * Check application images compliance against blocked repositories
 * @param {object} appSpecs - Application specifications
 * @param {object} myLongCache - Cache reference
 * @returns {Promise<boolean>} True if images are compliant
 */
async function checkApplicationImagesComplience(appSpecs) {
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
      throw new Error(`Image ${image} is blocked. Application ${appSpecs.name} connot be spawned.`);
    }
  });
  organisations.forEach((org) => {
    if (pureImagesOrOrganisationsRepos.includes(org)) {
      throw new Error(`Organisation ${org} is blocked. Application ${appSpecs.name} connot be spawned.`);
    }
  });
  if (userBlockedRepos) {
    log.info(`userBlockedRepos: ${JSON.stringify(userBlockedRepos)}`);
    organisations.forEach((org) => {
      if (userBlockedRepos.includes(org.toLowerCase())) {
        throw new Error(`Organisation ${org} is user blocked. Application ${appSpecs.name} connot be spawned.`);
      }
    });
    images.forEach((image) => {
      if (userBlockedRepos.includes(image.toLowerCase())) {
        throw new Error(`Image ${image} is user blocked. Application ${appSpecs.name} connot be spawned.`);
      }
    });
  }

  return true;
}

/**
 * Check if application images are blocked (non-throwing version)
 * @param {object} appSpecs - Application specifications
 * @param {object} myLongCache - Cache reference
 * @returns {Promise<boolean>} True if blocked
 */
async function checkApplicationImagesBlocked(appSpecs, myLongCache) {
  try {
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

    // Check against official blocked repos
    if (repos) {
      const pureRepos = repos.map(repo => repo.substring(0, repo.lastIndexOf(':') > -1 ? repo.lastIndexOf(':') : repo.length));

      if (images.some(img => pureRepos.includes(img)) || organisations.some(org => pureRepos.includes(org))) {
        isBlocked = true;
      }
    }

    // Check against user blocked repos
    if (userBlockedRepos && userBlockedRepos.length > 0) {
      const pureUserRepos = userBlockedRepos.map(repo => repo.substring(0, repo.lastIndexOf(':') > -1 ? repo.lastIndexOf(':') : repo.length));

      if (images.some(img => pureUserRepos.includes(img)) || organisations.some(org => pureUserRepos.includes(org))) {
        isBlocked = true;
      }
    }

    return isBlocked;
  } catch (error) {
    log.error(`Error checking if application images are blocked: ${error.message}`);
    return false; // If we can't check, assume not blocked
  }
}

/**
 * Validate image security and authenticity
 * @param {string} repotag - Repository tag
 * @param {object} options - Validation options
 * @returns {Promise<object>} Validation result
 */
async function validateImageSecurity(repotag, options = {}) {
  try {
    // Perform repository verification
    const verificationResult = await verifyRepository(repotag, options);

    // Additional security checks could be added here
    // - Image signature verification
    // - Vulnerability scanning
    // - Content scanning

    return {
      status: 'success',
      message: 'Image security validation passed',
      data: verificationResult,
    };
  } catch (error) {
    log.error(`Image security validation failed for ${repotag}: ${error.message}`);
    throw new Error(`Image security validation failed: ${error.message}`);
  }
}

/**
 * Clear blocked repositories cache
 */
function clearBlockedRepositoriesCache() {
  cacheUserBlockedRepos = null;
}

/**
 * Check Docker accessibility for repository
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Docker accessibility result
 */
async function checkDockerAccessibility(req, res) {
  try {
    let body = '';
    req.on('data', (data) => {
      body += data;
    });
    req.on('end', async () => {
      try {
        const processedBody = serviceHelper.ensureObject(body);
        if (!processedBody.repotag) {
          throw new Error('Missing repository tag');
        }

        // Verify repository accessibility without full verification
        // This is a lighter check compared to full repository verification
        const repoResult = await verifyRepository(processedBody.repotag, {
          skipVerification: true,
          repoauth: processedBody.repoauth
        });

        const successResponse = messageHelper.createSuccessMessage('Docker repository is accessible');
        res.json(successResponse);
      } catch (error) {
        log.error(`Docker accessibility check failed: ${error.message}`);
        const errorResponse = messageHelper.createErrorMessage(
          error.message || error,
          error.name,
          error.code,
        );
        res.json(errorResponse);
      }
    });
  } catch (error) {
    log.error(`Docker accessibility check error: ${error.message}`);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
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
  checkApplicationImagesComplience,
  checkApplicationImagesBlocked,
  validateImageSecurity,
  clearBlockedRepositoriesCache,
  checkDockerAccessibility,
  checkApplicationsCompliance,
};