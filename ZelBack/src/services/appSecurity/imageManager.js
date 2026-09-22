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
const globalState = require('../utils/globalState');
const { supportedArchitectures, globalAppsMessages, globalAppsInformation } = require('../utils/appConstants');
const fluxCaching = require('../utils/cacheManager').default;
const { Privilege, authOf } = require('../utils/privileges');
const { RemovalOutcome } = require('../utils/removalOutcome');

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
  // Read from the signed bundle policyStore holds, not fetched here - so what arrives is
  // bytes a signature has vouched for, rather than whatever a response body contained. An
  // error page is truthy and shaped like nothing; a signed document cannot be.
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
  // Null means "could not ask", never "nothing is blocked", and callers refuse or defer
  // on it.
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

  // One entry's verdict. Named rather than inlined so the loop below can stop at
  // the first refusal: a subject is refused for ONE stated reason, and the entries
  // after it decide nothing.
  const reasonFor = (entry) => {
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
  };

  // eslint-disable-next-line no-restricted-syntax
  for (const entry of entries) {
    const reason = reasonFor(entry);
    if (reason) return reason;
  }
  return null;
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
    // AN INVARIANT, NOT A CONDITION TO HANDLE. Every caller holds its work shut until the
    // node has policy - the spawner before acquiring, the validator before answering a live
    // submission, the installer before pulling - so reaching here means one of them asked
    // without checking, which is a wiring fault rather than a node that is still catching up.
    //
    // Named for that. The message said the node could not reach Flux Services, which was
    // never what this was: the node had spoken to nobody and did not need to, it simply had
    // no blocklist yet. A caller cannot act on a diagnosis of the wrong thing, and one of
    // them used to tell the two apart by comparing this sentence.
    throw new Error('checkApplicationImagesCompliance called before network policy was obtained');
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
 * The node's compliance sweeper: what removes an application the network's blocklist
 * names, once it is already installed.
 *
 * EVERY OTHER PATH GATES ON THE WAY IN. The spawner will not acquire a blocked
 * application, the validator will not answer for one and the installer will not pull
 * it - so this exists for the case none of them can answer: an application that was
 * permitted when it was installed and is not any more.
 *
 * ONE OBJECT HOLDING ITS OWN STATE. The set of applications still owed a pass, the
 * pass in flight, and the two timers are one another's invariants - what may be
 * dropped from the held set depends on what the pass in flight has reached. As file
 * scope they were reachable from two entry points that disagreed about them, and a
 * test could only get a clean one by deleting the module from the require cache.
 *
 * WHAT IT DEPENDS ON IS PASSED IN, including the clock and the knobs. A pass is
 * entirely about timing - when it starts, how long it holds itself open, when it
 * asks again - so a test that cannot control time can only assert the parts that are
 * not the point.
 *
 * @param {object} deps
 * @param {Function} deps.installedApps Whole table with no argument, one row with a name
 * @param {Function} deps.removeAppLocally Answers a RemovalOutcome
 * @param {Function} [deps.blocklist] The typed blocklist, or null when it cannot be read
 * @param {Function} [deps.decryptApps] Splits installed apps into readable and unreadable
 * @param {object} [deps.policy] Carries policyReady and waitForPolicyReady
 * @param {object} [deps.bundle] Carries onBundleChanged
 * @param {object} [deps.knobs] Read once: the sweeper's timings do not change under it
 * @param {object} [deps.timers] set and clear, for a test that owns time
 * @param {Function} [deps.wait] Holds the pass open between removals
 * @returns {{runPass: Function, request: Function, start: Function, stop: Function}}
 */
function createComplianceSweeper({
  installedApps,
  removeAppLocally,
  blocklist = getBlocklist,
  decryptApps = decryptEnterpriseApps,
  policy = globalState,
  bundle = policyStore,
  knobs = config.fluxapps,
  timers = { set: setTimeout, clear: clearTimeout },
  wait = serviceHelper.delay,
} = {}) {
  const {
    complianceSweepStaggerMs: staggerMs,
    complianceRemovalSpacingMs: spacingMs,
    complianceRetryBaseMs: retryBaseMs,
    complianceRetryMaxMs: retryMaxMs,
  } = knobs;

  // Applications this node still owes a pass, by name, and why it owes them.
  //
  //   deferred    an enterprise specification that did not decrypt, so its images were
  //               never judged. Nothing announces that it has become readable.
  //   busy        the node was installing or removing something else, so the removal
  //               was refused. It says nothing about the application.
  //   failed      the removal was attempted and did not complete.
  //   unread      the stored record could not be read, so nothing was established
  //               about the application either way.
  //   unexamined  a pass stopped before reaching it.
  //
  // None of these has an event to wait on. Everything else this acts on does: the
  // bundle changing, the gate opening, and the install and redeploy paths that judge an
  // application before its record is ever written.
  const owed = new Map();
  // Whether what is owed is the whole node rather than named applications. A pass that
  // stopped before it classified anything knows no names to owe, and the applications
  // it never looked at are owed a pass all the same.
  let owedWholeNode = false;

  let inFlight = null;
  let again = false;
  let staggerTimer = null;
  let retryTimer = null;
  let retryDelayMs = retryBaseMs;
  // What was owed the last time a wait was set, to compare the next one against. The
  // whole node is not a list of names and never compares equal to one.
  const EVERYTHING = Symbol('every installed application');
  let owedWhenLastArmed = null;

  /** Hold one application for a later pass. */
  function hold(appName, reason) {
    owed.set(appName, reason);
  }

  /** Hold the whole node, for a pass that stopped before it could name anything. */
  function holdEverything() {
    owedWholeNode = true;
  }

  /** What is owed, in a form two passes can be compared by. */
  function owedNow() {
    return owedWholeNode ? EVERYTHING : [...owed.keys()].sort().join(' ');
  }

  /**
   * Arm the retry, if anything is owed and nothing is armed.
   *
   * SELF-CANCELLING: the timer exists for what is owed and ends with it, so a node
   * owing nothing runs no timer. Armed once a pass is over, never while one runs - a
   * pass spaces its removals over minutes and holds applications as it goes, so a timer
   * armed at the moment of holding fires inside the pass that armed it.
   */
  function armRetry() {
    if (retryTimer || (!owed.size && !owedWholeNode)) return;
    // THE WAIT IS DECIDED HERE AND NOWHERE ELSE, from what is owed at the moment of
    // arming. It doubles for as long as the same thing is owed, and starts again the
    // moment that changes: a node that resolved something has shown it can, and what is
    // left of a debt that is moving is worth asking about sooner than one that is not.
    //
    // Asked of the debt rather than of the act that recorded it, because the retry path
    // clears what it is about to re-ask before the pass runs - a rule written at the
    // point of holding reads that as a debt this node has never carried.
    const owing = owedNow();
    retryDelayMs = owing === owedWhenLastArmed
      ? Math.min(retryDelayMs * 2, retryMaxMs)
      : retryBaseMs;
    owedWhenLastArmed = owing;
    const delayMs = retryDelayMs;
    retryTimer = timers.set(() => {
      retryTimer = null;
      const wholeNode = owedWholeNode;
      owedWholeNode = false;
      const scope = wholeNode ? null : new Set(owed.keys());
      if (!wholeNode && !scope.size) return;
      log.info(`Asking again about ${wholeNode ? 'every installed application' : [...owed].map(([name, why]) => `${name} (${why})`).join(', ')}`);
      // Returned, not discarded: setTimeout ignores it, and a scheduler that drives this
      // deliberately - a test owning the clock - can wait for the pass it just started
      // rather than guess at how many turns of the queue it takes to finish.
      return request(scope);
    }, delayMs);
    if (retryTimer && retryTimer.unref) retryTimer.unref();
  }

  /**
   * The application as the node holds it NOW, judged on the fields that are plaintext
   * on the stored record.
   *
   * A pass spaces its removals, so minutes separate the decision from the act. The
   * record can move in between - a redeploy onto a different image, a specification
   * update - and a verdict reached against the old one is a verdict about an
   * application this node is no longer running.
   *
   * Images are the one field this cannot re-derive: reading them means decrypting an
   * enterprise specification, which is the work the pass already did. They are carried
   * forward only while the record they came from is unchanged, and dropped the moment
   * its hash moves - a redeployed application is judged on what can still be read of
   * it, and the next pass judges the rest.
   *
   * TWO FACTS, TWO FIELDS. A record that could not be read and a record that says the
   * node does not hold it are different answers, and the second one ends a blocked
   * application's claim on this pass. One value for both leaves a caller to guess.
   *
   * @returns {Promise<{answered: boolean, subject: object|null}>} answered is false when
   *   the record could not be read, which carries no claim about the application. A null
   *   subject is the record answering that the node does not hold it.
   */
  async function subjectNow(appName, decided) {
    const installedAppsRes = await installedApps(appName).catch(() => null);
    if (!installedAppsRes || installedAppsRes.status !== 'success' || !Array.isArray(installedAppsRes.data)) {
      return { answered: false, subject: null };
    }
    const row = installedAppsRes.data.find((app) => app.name === appName);
    if (!row) return { answered: true, subject: null };
    return {
      answered: true,
      subject: {
        name: row.name,
        owner: row.owner,
        hash: row.hash,
        images: row.hash === decided.hash ? decided.images : imagesOf(row),
      },
    };
  }

  /**
   * One pass: judge what the node holds and remove what the network refuses.
   *
   * @param {Set<string>} [scope] Only these applications. Every installed one when absent.
   * @returns {Promise<void>}
   */
  async function runPass(scope = null) {
    try {
      // THE LIST THIS ACTS ON HAS TO BE THE NETWORK'S, not whatever this node last held.
      // A bundle restored from disk answers the blocklist without anything having
      // established that it is still current, so a ban lifted while this node was down
      // still reads as a ban - and what follows is an uninstall, broadcast to the
      // network, of an application that is now permitted.
      //
      // The same bar every other judgement is held to: the spawner will not acquire, the
      // validator will not answer a live submission and the installer will not pull while
      // this is shut. Removing an application is the most destructive of the four.
      if (!policy.policyReady) {
        log.info('Network policy not confirmed; leaving installed applications as they are this pass');
        holdEverything();
        return;
      }
      // A MESSAGE ENVELOPE, not rows: a status, and the applications under it.
      const installedAppsRes = await installedApps();
      if (installedAppsRes.status !== 'success') {
        holdEverything();
        throw new Error('Failed to get installed Apps');
      }
      const entries = blocklist();
      if (!entries) {
        // Removing on this would tear down every application on the node the first time
        // the document was unreadable.
        log.warn('Blocklist unavailable; leaving installed applications as they are this pass');
        holdEverything();
        return;
      }

      const subjects = scope
        ? installedAppsRes.data.filter((app) => scope.has(app.name))
        : installedAppsRes.data;
      // AN APPLICATION THE NODE NO LONGER HOLDS HAS NOTHING LEFT TO ANSWER FOR, whether
      // this pass is about it or not: owing it buys a wakeup and a pass for something
      // that is gone. Asked of the whole table, which every pass reads, rather than of
      // the few names a scoped one narrows to.
      const installed = new Set(installedAppsRes.data.map((app) => app.name));
      [...owed.keys()].forEach((name) => { if (!installed.has(name)) owed.delete(name); });

      const toRemove = new Map();

      // Name, owner and hash are plaintext on the stored record, so a ban on any of them
      // is answered for every installed application - including one whose specification
      // this node cannot decrypt. They are asked before the decrypt for exactly that
      // reason: an application dropped from the readable set must still be judged on
      // what it is.
      subjects.forEach((app) => {
        const subject = {
          name: app.name, owner: app.owner, hash: app.hash, images: null,
        };
        const reason = blockedReasonFor(entries, subject);
        if (reason) toRemove.set(app.name, { reason, subject });
      });

      // Images are the part that genuinely needs the specification: an enterprise
      // application carries its components inside the encrypted blob. One that cannot be
      // read is owed a later pass, and says so - it is not cleared.
      const { readable, unreadable } = await decryptApps(subjects);
      if (unreadable.length) {
        log.warn(`Cannot check blocked images for undecryptable apps: ${unreadable.map((app) => app.name).join(', ')}`);
      }
      unreadable.forEach((app) => {
        if (toRemove.has(app.name)) return;
        hold(app.name, 'deferred');
      });
      readable.forEach((app) => {
        if (toRemove.has(app.name)) return;
        const subject = {
          name: app.name, owner: app.owner, hash: app.hash, images: imagesOf(app),
        };
        const reason = blockedReasonFor(entries, subject);
        if (reason) {
          toRemove.set(app.name, { reason, subject });
          return;
        }
        // Read, and answered on every field, with nothing owed. An application that IS
        // blocked is answered for by its removal and not before.
        owed.delete(app.name);
      });

      const removals = [...toRemove.entries()];
      // eslint-disable-next-line no-restricted-syntax
      for (const [index, [appName, decided]] of removals.entries()) {
        // ASKED AGAIN FOR EACH ONE, against the list as it stands now and the record as
        // it stands now. Spacing holds a pass open for minutes and neither half of what
        // it decided at the top survives that: an entry lifted while the pass ran would
        // otherwise still be acted on, and an application redeployed onto a different
        // image would be judged on the one it no longer runs.
        //
        // WHAT IT COULD NOT ASK IS OWED, never assumed either way. A pass that stops
        // here leaves the applications after this one unexamined.
        if (!policy.policyReady) {
          log.warn('Network policy no longer confirmed; ending this pass');
          removals.slice(index).forEach(([name]) => hold(name, 'unexamined'));
          return;
        }
        const current = blocklist();
        if (!current) {
          log.warn('Blocklist no longer available; ending this pass');
          removals.slice(index).forEach(([name]) => hold(name, 'unexamined'));
          return;
        }
        // eslint-disable-next-line no-await-in-loop
        const { answered, subject } = await subjectNow(appName, decided.subject);
        if (!answered) {
          // A RECORD THAT DID NOT ANSWER IS NOT A RECORD SAYING THE APPLICATION IS GONE.
          // Taken as gone, a blocked application is struck off with nothing coming back
          // for it.
          log.warn(`Could not read the record for ${appName}; asking again`);
          hold(appName, 'unread');
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!subject) {
          // The node no longer holds it, so there is nothing left to refuse.
          owed.delete(appName);
          // eslint-disable-next-line no-continue
          continue;
        }
        const reason = blockedReasonFor(current, subject);
        if (!reason) {
          log.info(`Application ${appName} is no longer blocked, leaving it installed`);
          owed.delete(appName);
          // eslint-disable-next-line no-continue
          continue;
        }
        log.warn(`Application ${appName} is blacklisted, removing`);
        log.warn(`REMOVAL REASON: Blocked by network policy - ${reason} (imageManager)`);
        // eslint-disable-next-line no-await-in-loop
        const outcome = await removeAppLocally(appName, null, false, true, true);
        if (outcome === RemovalOutcome.REMOVED || outcome === RemovalOutcome.NOT_INSTALLED) {
          owed.delete(appName);
        } else {
          // BUSY says nothing about the application - the node was doing something else -
          // and FAILED says it may still be here. Neither is a removal, and reading
          // either as one leaves a blocked application running with nothing coming back
          // for it.
          log.warn(`Application ${appName} was not removed (${outcome}); asking again`);
          hold(appName, outcome === RemovalOutcome.BUSY ? 'busy' : 'failed');
        }
        if (index < removals.length - 1) {
          // eslint-disable-next-line no-await-in-loop
          await wait(spacingMs);
        }
      }
    } catch (error) {
      log.error(error);
    }
  }

  /**
   * Run a pass, and once more if anything asked for one while it ran.
   *
   * COALESCED RATHER THAN QUEUED. A pass is a function of the blocklist this node holds
   * now, so requests arriving during one are all answered by a single further pass - a
   * queue of them would each re-read the same final state and walk the whole local app
   * table again. A scoped request coalesces into a full pass rather than narrowing it:
   * the full pass answers everything the scoped one would have.
   *
   * @param {Set<string>} [scope] Only these applications. Every installed one when absent.
   * @returns {Promise<void>} The run in progress, so a caller can wait for it.
   */
  function request(scope = null) {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    let mine = null;
    mine = (async () => {
      let next = scope;
      do {
        // Cleared BEFORE the pass, so a request arriving during it is not read as one
        // this pass already accounted for.
        again = false;
        // eslint-disable-next-line no-await-in-loop
        await runPass(next);
        // Whatever asked for another pass did not say which applications it was about,
        // so the pass it gets is the whole node.
        next = null;
      } while (again);
      armRetry();
    })().finally(() => { if (inFlight === mine) inFlight = null; });
    inFlight = mine;
    return mine;
  }

  /**
   * Sweep whenever the policy this node enforces changes.
   *
   * TWO TRIGGERS, BECAUSE NEITHER COVERS THE OTHER. The gate opening is what makes the
   * blocklist safe to act on at all, and it opens without the bundle changing - a node
   * confirmed by its peers holds exactly what it restored. A bundle changing is what
   * makes an already-safe blocklist say something different, and that happens for the
   * rest of the node's life.
   *
   * BOTH ARE STAGGERED, because adopting a bundle fires both: policyStore.adopt opens
   * the gate before it announces, and the gate drains its waiters synchronously, so an
   * unstaggered gate trigger would run first and put the whole fleet's removals - and
   * the broadcast of each one - into the same instant.
   *
   * NOTHING WAITS ON THIS. It uninstalls applications, so it runs only on policy this
   * node has established is the network's, which may be a long time coming.
   *
   * @returns {Function} Ends the subscription.
   */
  function start() {
    const stagger = () => {
      // One is enough: a pass that has not started yet already reads whatever arrives
      // before it does.
      if (staggerTimer) return;
      staggerTimer = timers.set(() => {
        staggerTimer = null;
        return request();
      }, Math.floor(Math.random() * staggerMs));
      if (staggerTimer && staggerTimer.unref) staggerTimer.unref();
    };
    const unsubscribe = bundle.onBundleChanged(() => {
      // A bundle this node may not act on yet changes nothing it may do. The gate
      // opening carries its own trigger.
      if (!policy.policyReady) return;
      stagger();
    });
    policy.waitForPolicyReady().then(stagger);
    return unsubscribe;
  }

  /**
   * Drop the timers and everything owed.
   *
   * A pass already running is not cancellable - it is awaiting a removal - so it is
   * disowned rather than stopped: its handle is dropped, and it can no longer clear the
   * handle of whatever starts next.
   */
  function stop() {
    if (staggerTimer) timers.clear(staggerTimer);
    if (retryTimer) timers.clear(retryTimer);
    staggerTimer = null;
    retryTimer = null;
    retryDelayMs = retryBaseMs;
    owedWhenLastArmed = null;
    owedWholeNode = false;
    inFlight = null;
    again = false;
    owed.clear();
  }

  return {
    runPass, request, start, stop,
  };
}

// The sweeper this node is running. A module-level reference rather than module-level
// state: one object, created at boot, that the redeploy path can ask for a scoped pass
// without building a second one over the same node.
let activeSweeper = null;

/**
 * Start the node's compliance sweeper. Called once, at boot.
 * @param {Function} installedApps - Function to get installed apps
 * @param {Function} removeAppLocally - Function to remove app locally
 * @returns {Function} Ends the subscription.
 */
function startComplianceSweeps(installedApps, removeAppLocally) {
  activeSweeper = createComplianceSweeper({ installedApps, removeAppLocally });
  return activeSweeper.start();
}

/**
 * Ask the running sweeper for a pass. Does nothing before boot has started one - there
 * is no node state to act on, and building a sweeper here would make a second one.
 * @param {Set<string>} [scope] Only these applications
 * @returns {Promise<void>}
 */
function requestComplianceSweep(scope = null) {
  if (!activeSweeper) return Promise.resolve();
  return activeSweeper.request(scope);
}

/**
 * One pass, now, with nothing scheduled. For a caller that wants the judgement without
 * the sweeper that repeats it.
 * @param {Function} installedApps - Function to get installed apps
 * @param {Function} removeAppLocally - Function to remove app locally
 * @param {Set<string>} [scope] Only these applications
 * @returns {Promise<void>}
 */
function checkApplicationsCompliance(installedApps, removeAppLocally, scope = null) {
  return createComplianceSweeper({ installedApps, removeAppLocally }).runPass(scope);
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
  createComplianceSweeper,
  requestComplianceSweep,
  startComplianceSweeps,
};
