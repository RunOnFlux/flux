const config = require('config');
const axios = require('axios');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const pgpService = require('../pgpService');
const imageVerifier = require('../utils/imageVerifier');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const { supportedArchitectures, globalAppsMessages } = require('../utils/appConstants');

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
async function getBlockedRepositores(myLongCache) {
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
    log.error(`Error getting blocked repositories: ${error.message}`);
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

    const userBlockedRepos = (typeof userconfig !== 'undefined' && userconfig.initial && userconfig.initial.blockedRepositories) || [];
    if (userBlockedRepos.length === 0) {
      cacheUserBlockedRepos = userBlockedRepos;
      return userBlockedRepos;
    }

    const usableUserBlockedRepos = [];
    const marketPlaceUrl = 'https://stats.runonflux.io/marketplace/listapps';

    try {
      const response = await axios.get(marketPlaceUrl);
      if (response && response.data && response.data.status === 'success') {
        const visibleApps = response.data.data.filter((val) => val.visible);

        for (let i = 0; i < userBlockedRepos.length; i += 1) {
          const userRepo = userBlockedRepos[i];
          const repoWithoutTag = userRepo.substring(0, userRepo.lastIndexOf(':') > -1 ? userRepo.lastIndexOf(':') : userRepo.length);

          const exist = visibleApps.find((app) =>
            app.compose.find((compose) => {
              const composeRepoWithoutTag = compose.repotag.substring(0, compose.repotag.lastIndexOf(':') > -1 ? compose.repotag.lastIndexOf(':') : compose.repotag.length);
              return composeRepoWithoutTag.toLowerCase() === repoWithoutTag.toLowerCase();
            })
          );

          if (!exist) {
            usableUserBlockedRepos.push(userRepo);
          }
        }
      }
    } catch (marketplaceError) {
      log.warn(`Could not fetch marketplace data: ${marketplaceError.message}`);
      // If marketplace is unreachable, use all user blocked repos
      usableUserBlockedRepos.push(...userBlockedRepos);
    }

    cacheUserBlockedRepos = usableUserBlockedRepos;
    return usableUserBlockedRepos;
  } catch (error) {
    log.error(`Error getting user blocked repositories: ${error.message}`);
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

    // Check if any other app is using the same secrets
    for (const app of appsWithNodeRestrictions) {
      if (app.appSpecifications && app.appSpecifications.name !== appName && app.appSpecifications.owner === appOwner) {
        if (app.appSpecifications.compose) {
          for (const component of app.appSpecifications.compose) {
            const existingSecrets = normalizePGP(component.secrets);
            if (existingSecrets && existingSecrets === appComponentSecrets) {
              throw new Error(`Application secrets are already in use by another application: ${app.appSpecifications.name}`);
            }
          }
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
async function checkApplicationImagesComplience(appSpecs, myLongCache) {
  const repos = await getBlockedRepositores(myLongCache);
  const userBlockedRepos = await getUserBlockedRepositores();

  if (!repos) {
    throw new Error('Unable to communicate with Flux Services! Try again later.');
  }

  const pureImagesOrOrganisationsRepos = [];
  repos.forEach((repo) => {
    pureImagesOrOrganisationsRepos.push(repo.substring(0, repo.lastIndexOf(':') > -1 ? repo.lastIndexOf(':') : repo.length));
  });

  // Add user blocked repos
  userBlockedRepos.forEach((repo) => {
    pureImagesOrOrganisationsRepos.push(repo.substring(0, repo.lastIndexOf(':') > -1 ? repo.lastIndexOf(':') : repo.length));
  });

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

  // Check images against blocked list
  const blockedImages = images.filter((image) => pureImagesOrOrganisationsRepos.includes(image));
  if (blockedImages.length > 0) {
    throw new Error(`Blocked image detected: ${blockedImages.join(', ')}`);
  }

  // Check organisations against blocked list
  const blockedOrganisations = organisations.filter((org) => pureImagesOrOrganisationsRepos.includes(org));
  if (blockedOrganisations.length > 0) {
    throw new Error(`Blocked organisation detected: ${blockedOrganisations.join(', ')}`);
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
    const repos = await getBlockedRepositores(myLongCache);
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