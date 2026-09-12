const config = require('config');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const registryCredentialHelper = require('../utils/registryCredentialHelper');
const imageVerifier = require('../utils/imageVerifier');
const dbHelper = require('../dbHelper');
const verificationHelper = require('../verificationHelper');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
const policyStore = require('../policyStore');
const { supportedArchitectures, globalAppsMessages, globalAppsInformation } = require('../utils/appConstants');
const fluxCaching = require('../utils/cacheManager').default;
const { Privilege, authOf } = require('../utils/privileges');

// Cache for blocked repositories

/**
 * Classify error type and determine appropriate cache TTL
 * Uses structured error metadata from imageVerifier when available
 * @param {Error} error - The error from image verification
 * @param {object} errorMeta - Error metadata from imageVerifier (httpStatus, errorCode, errorType)
 * @returns {{ttlMs: number, reason: string}}
 */
function classifyVerificationError(error, errorMeta) {
  // eslint-disable-next-line global-require
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
      case 'auth_unavailable':
        return { ttlMs: 2 * FluxCacheManager.oneHour, reason: 'Temporary service issue' };
      // Permanent errors - longer cache
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
 * @param {string} [options.repoauth] - Repository authentication credentials
 * @param {number} [options.specVersion] - App specification version (required with repoauth)
 * @param {string} [options.architecture] - Specific architecture to validate support for
 * @param {string} [options.appName] - Application name (for logging)
 * @returns {Promise<{verified: boolean, supportedArchitectures: string[]}>} Verification result with supported architectures
 */
async function verifyRepository(repotag, options = {}) {
  const repoauth = options.repoauth || null;
  const specVersion = options.specVersion || null;
  const architecture = options.architecture || null;
  const appName = options.appName || null;

  // Check cache first to avoid redundant Docker Hub API calls
  // Cache key includes architecture since same image may have different arch support
  const cacheKey = `${repotag}:${architecture || 'any'}:${repoauth ? 'auth' : 'noauth'}`;
  const cached = fluxCaching.dockerHubVerificationCache.get(cacheKey);

  if (repoauth && !specVersion) {
    throw new Error('specVersion is required when using repoauth');
  }

  if (cached) {
    log.info('Docker Hub verification cache HIT for '
      + `${repotag} (${architecture || 'any'})`);

    // If cached verification failed, throw the cached error
    if (cached.error) {
      throw new Error(cached.error);
    }

    return cached.result;
  }

  const imgVerifier = new imageVerifier.ImageVerifier(repotag, {
    maxImageSize: config.fluxapps.maxImageSize,
    architecture,
    architectureSet: supportedArchitectures,
  });

  if (repoauth) {
    // Use credential helper to handle version-aware decryption and cloud providers
    const credentials = await registryCredentialHelper.getCredentials(
      repotag,
      repoauth,
      specVersion,
      appName,
    );

    if (credentials) {
      // Pass credentials object directly - no need to convert to string
      imgVerifier.addCredentials(credentials);
    }
  }

  try {
    await imgVerifier.verifyImage();
    imgVerifier.throwIfError();

    if (architecture && !imgVerifier.supported) {
      throw new Error(`This Fluxnode's architecture ${architecture} not supported by ${repotag}`);
    }

    // Extract supported architectures from the verified image
    const supportedArchs = imgVerifier.supportedArchitectures;

    const result = {
      verified: true,
      supportedArchitectures: supportedArchs,
    };

    // Cache successful verification (uses default TTL from FluxCacheManager: 1 hour)
    fluxCaching.dockerHubVerificationCache.set(cacheKey, {
      result,
      error: null,
    });

    log.info(`Docker Hub verification cache MISS - cached for ${repotag} (${architecture || 'any'})`);

    return result;
  } catch (error) {
    // Use errorMeta from imageVerifier for intelligent classification
    const { errorMeta } = imgVerifier;
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
function getBlockedRepositores() {
  // Read from the signed bundle policyStore holds, not fetched here. What that removes, as
  // well as the trust: this used to cache whatever the response contained without checking it
  // was a list, for six hours. A github error page is truthy, so it was cached, and every
  // read of it then threw `repos.forEach is not a function` -- refusing installs with a
  // TypeError and, in the spawner, marking apps unspawnable for seven days because the
  // TypeError did not match the one error message that path treats as "the service is down".
  //
  // Still null for "not obtained", which callers already distinguish from an empty list.
  return policyStore.getDocument('blockedrepositories');
}

/**
 * A repository reference with any tag or digest removed. Entries are compared
 * against this form, never against the raw repotag.
 * @param {string} repotag
 * @returns {string}
 */
function repositoryOf(repotag) {
  const separator = repotag.lastIndexOf(':');
  return separator > -1 ? repotag.substring(0, separator) : repotag;
}

/**
 * The namespace an image is published under. An image with no namespace is its
 * own, which is how a bare entry reaches an official library image.
 * @param {string} repository
 * @returns {string}
 */
function namespaceOf(repository) {
  const separator = repository.lastIndexOf('/');
  return separator > -1 ? repository.substring(0, separator) : repository;
}

/**
 * The blocklist, as typed entries.
 *
 * `blocklist.json` states what each entry refuses - an application hash, an
 * application name, an owner, an image or a namespace - so an entry is compared
 * against exactly one field. `blockedrepositories.json` cannot: there an entry is
 * a bare string tested against all of them, so `grafana` refuses both the
 * application called grafana and every image under the grafana namespace, and
 * whoever wrote it had no way to say which was meant.
 *
 * The flat document is the fallback, and its entries keep that older meaning -
 * they are marked `legacy` rather than guessed at, because guessing a kind is the
 * ambiguity this reader exists to remove.
 *
 * Null means the list could not be obtained from either document. That is not
 * "nothing is blocked": callers refuse or defer on it.
 * @returns {Array<{kind: string, value: string}>|null}
 */
function getBlocklist() {
  // PRECEDENCE, NOT A COMBINE. The typed document wins outright when it is usable, and
  // the flat one is then never read; otherwise the flat one decides alone, its bare
  // strings marked `legacy` rather than guessed at, because guessing a kind is the
  // ambiguity this reader exists to remove.
  //
  // Usable means every element is a typed entry. An EMPTY typed document is usable and
  // returns [] - from a signed bundle that genuinely means "published, and nothing is
  // blocked". The fetch version fell through on empty, which was right for a fetch: a
  // 200 carrying [] from a host that does not have the file must not silently skip the
  // flat list. A bundle cannot be uncertain in that way.
  //
  // A MALFORMED typed document refuses rather than falling through, for the same reason
  // in reverse. The fetch version fell through because the ways a fetch lies - a CDN
  // serving 404-as-200, an error page with a 200 - are indistinguishable from an absent
  // document. Neither is reachable through signature-verified bytes: a document of the
  // wrong shape inside a validly signed bundle means the bundle is internally
  // inconsistent, and that is exactly when refusing beats guessing. Suite 1501 asserts
  // the same rule from the other end.
  //
  // Null still means "could not ask", never "nothing is blocked", and callers refuse or
  // defer on it. What no longer needs defending against is the cache that held an error
  // page for six hours: there is no response to cache, only bytes a signature has
  // already vouched for.
  const typed = policyStore.getDocument('blocklist');
  if (typed !== null && typed !== undefined) {
    if (!Array.isArray(typed)) return null;
    if (typed.every((entry) => entry && typeof entry.kind === 'string' && typeof entry.value === 'string')) {
      return typed;
    }
    return null;
  }

  const repos = getBlockedRepositores();
  if (!Array.isArray(repos)) return null;
  return repos.map((value) => ({ kind: 'legacy', value }));
}

/**
 * Why this application is blocked, or null.
 *
 * `images` may be null, which asks only the questions that need no components:
 * an application's name, owner and hash are plaintext on the stored record, so
 * they can be answered for an application whose specification cannot be read.
 * @param {Array<{kind: string, value: string}>} entries From getBlocklist
 * @param {{name: string, owner: string, hash: string, images: string[]|null}} subject
 * @returns {string|null}
 */
function blockedReasonFor(entries, subject) {
  const repositories = (subject.images ?? []).map(repositoryOf);
  const namespaces = repositories.map(namespaceOf);

  const matchedImage = (value) => repositories.find((repository) => repository === value);
  const matchedNamespace = (value) => namespaces.find((namespace) => namespace === value);

  const found = entries.map((entry) => {
    const { value } = entry;
    switch (entry.kind) {
      case 'hash':
        return subject.hash && value === subject.hash ? `${value} is not allowed to be spawned` : null;
      case 'name':
        return subject.name && value === subject.name ? `Application ${value} is not allowed to run` : null;
      case 'owner':
        return subject.owner && value === subject.owner ? `${value} is not allowed to run applications` : null;
      case 'image':
        return matchedImage(value) ? `Image ${value} is blocked. Application ${subject.name} cannot be spawned.` : null;
      case 'org':
        return matchedNamespace(value) ? `Organisation ${value} is blocked. Application ${subject.name} cannot be spawned.` : null;
      case 'legacy': {
        // One string against four fields, which is what the flat document means
        // and the reason the typed one exists. Order follows the reader it
        // replaces, so a legacy entry refuses for the same stated reason it
        // always did.
        const pure = repositoryOf(value);
        if (subject.hash && pure === subject.hash) return `${pure} is not allowed to be spawned`;
        if (subject.owner && pure === subject.owner) return `${pure} is not allowed to run applications`;
        if (matchedImage(pure)) return `Image ${pure} is blocked. Application ${subject.name} cannot be spawned.`;
        if (matchedNamespace(pure)) return `Organisation ${pure} is blocked. Application ${subject.name} cannot be spawned.`;
        return null;
      }
      default:
        // A kind this release does not know refuses nothing. A newer document can
        // then ship before the reader that understands it, which is how the
        // signed bundle is designed to roll out.
        return null;
    }
  }).find((reason) => reason);

  return found ?? null;
}

/**
 * The repositories an application's components run, or null when they cannot be
 * read - an enterprise specification carries them inside its encrypted blob.
 * @param {object} appSpecs
 * @returns {string[]|null}
 */
function imagesOf(appSpecs) {
  if (appSpecs.version <= 3) {
    return appSpecs.repotag ? [appSpecs.repotag] : null;
  }
  if (!Array.isArray(appSpecs.compose) || !appSpecs.compose.length) return null;
  return appSpecs.compose.map((component) => component.repotag).filter((repotag) => repotag);
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
              `Provided component '${appComponentSpecs.name}' secrets are not valid (duplicate in app: '${app.name}')`,
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
            `Provided component '${appComponentSpecs.name}' secrets are not valid (owner mismatch: '${message.appSpecifications.owner}').`,
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
  const entries = getBlocklist();

  if (!entries) {
    throw new Error('Unable to communicate with Flux Services! Try again later.');
  }

  const repotags = imagesOf(appSpecs);
  const networkReason = blockedReasonFor(entries, {
    name: appSpecs.name,
    owner: appSpecs.owner,
    hash: appSpecs.hash,
    images: repotags,
  });
  if (networkReason) {
    throw new Error(networkReason);
  }


  return true;
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
      const authorized = await verificationHelper.verifyPrivilege(Privilege.USER, authOf(req));
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
    const entries = getBlocklist();
    if (!entries) {
      // The list could not be obtained. Removing on that would tear down every
      // application on the node the first time the document was unreachable.
      log.warn('Blocklist unavailable; leaving installed applications as they are this pass');
      return;
    }

    const appsToRemove = new Map();

    // Name, owner and hash are plaintext on the stored record, so a ban on any of
    // them is answered for every installed application - including one whose
    // specification this node cannot decrypt. They are asked before the decrypt
    // for exactly that reason: an application dropped from the readable set must
    // still be judged on what it is.
    installedAppsRes.data.forEach((app) => {
      const reason = blockedReasonFor(entries, {
        name: app.name, owner: app.owner, hash: app.hash, images: null,
      });
      if (reason) appsToRemove.set(app.name, reason);
    });

    // Images are the part that genuinely needs the specification: an enterprise
    // application carries its components inside the encrypted blob. One that
    // cannot be read is deferred here, and says so - it is not cleared.
    const { readable: appsInstalled, unreadable } = await decryptEnterpriseApps(installedAppsRes.data);
    if (unreadable.length) {
      log.warn(`Cannot check blocked images for undecryptable apps: ${unreadable.map((app) => app.name).join(', ')}`);
    }
    appsInstalled.forEach((app) => {
      if (appsToRemove.has(app.name)) return;
      const reason = blockedReasonFor(entries, {
        name: app.name, owner: app.owner, hash: app.hash, images: imagesOf(app),
      });
      if (reason) appsToRemove.set(app.name, reason);
    });

    // remove appsToRemove apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const [appName, reason] of appsToRemove) {
      log.warn(`Application ${appName} is blacklisted, removing`);
      log.warn(`REMOVAL REASON: Blocked by network policy - ${reason} (imageManager)`);
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
  getBlocklist,
  blockedReasonFor,
  checkAppSecrets,
  checkApplicationImagesCompliance,
  checkDockerAccessibility,
  checkApplicationsCompliance,
};
