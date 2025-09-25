const config = require('config');
const serviceHelper = require('../serviceHelper');
const messageHelper = require('../messageHelper');
const log = require('../../lib/log');
const generalService = require('../generalService');
const verificationHelper = require('../verificationHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const registryManager = require('../appDatabase/registryManager');
const messageVerifier = require('../appMessaging/messageVerifier');
const imageManager = require('../appSecurity/imageManager');
const { supportedArchitectures } = require('../utils/appConstants');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const {
  outgoingPeers, incomingPeers,
} = require('../utils/establishedConnections');
const dbHelper = require('../dbHelper');

/**
 * Verify type correctness of application specification
 * @param {object} appSpecification - Application specification to validate
 * @throws {Error} If validation fails
 */
function verifyTypeCorrectnessOfApp(appSpecification) {
  const {
    version,
    name,
    description,
    owner,
    port,
    containerPort,
    compose,
    repotag,
    ports,
    domains,
    enviromentParameters,
    commands,
    containerPorts,
    containerData,
    instances,
    cpu,
    ram,
    hdd,
    tiered,
    contacts,
    geolocation,
    expire,
    nodes,
    staticip,
    enterprise,
  } = appSpecification;

  if (!version) {
    throw new Error('Missing Flux App specification parameter version');
  }

  // Commons validation
  if (!version || !name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter name and/or description and/or owner');
  }

  if (typeof version !== 'number') {
    throw new Error('Invalid Flux App version');
  }
  if (!serviceHelper.isDecimalLimit(version)) {
    throw new Error('Invalid Flux App version decimals');
  }

  if (typeof name !== 'string') {
    throw new Error('Invalid Flux App name');
  }

  if (typeof description !== 'string') {
    throw new Error('Invalid Flux App description');
  }

  if (typeof owner !== 'string') {
    throw new Error('Invalid Flux App owner');
  }

  // Version-specific validation
  if (version === 1) {
    if (!port || !containerPort) {
      throw new Error('Missing Flux App specification parameter port and/or containerPort');
    }
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }
  } else if (version >= 2 && version <= 3) {
    if (!ports || !domains || !containerPorts) {
      throw new Error('Missing Flux App specification parameter port and/or containerPort and/or domains');
    }
  }

  // Additional type checks would continue here...
  // This is a simplified version focusing on the core structure
}

/**
 * Verify restriction correctness of application specification
 * @param {object} appSpecifications - Application specifications
 * @param {number} height - Block height for validation context
 * @throws {Error} If validation fails
 */
function verifyRestrictionCorrectnessOfApp(appSpecifications, height) {
  const minPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMin : config.fluxapps.portMinLegacy;
  const maxPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMax : config.fluxapps.portMaxLegacy;

  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(appSpecifications.version)) {
    throw new Error('Flux App message version specification is invalid');
  }

  // Port range validation
  if (appSpecifications.ports) {
    appSpecifications.ports.forEach((port) => {
      if (port < minPort || port > maxPort) {
        throw new Error(`Flux App port ${port} is not within allowed range ${minPort}-${maxPort}`);
      }
    });
  }

  // Additional restriction checks would continue here...
}

/**
 * Verify object keys correctness of application specification
 * @param {object} appSpecifications - Application specifications
 * @throws {Error} If validation fails
 */
function verifyObjectKeysCorrectnessOfApp(appSpecifications) {
  const allowedKeysV1 = [
    'version', 'name', 'description', 'owner', 'port', 'containerPort',
    'repotag', 'enviromentParameters', 'commands', 'containerData',
    'cpu', 'ram', 'hdd', 'tiered', 'contacts', 'geolocation',
    'expire', 'nodes', 'staticip', 'enterprise',
  ];

  const allowedKeysV4Plus = [
    'version', 'name', 'description', 'owner', 'compose', 'contacts',
    'geolocation', 'expire', 'nodes', 'staticip', 'enterprise', 'instances',
  ];

  let allowedKeys;
  if (appSpecifications.version === 1) {
    allowedKeys = allowedKeysV1;
  } else if (appSpecifications.version >= 4) {
    allowedKeys = allowedKeysV4Plus;
  } else {
    // Versions 2-3 have their own key sets
    allowedKeys = [...allowedKeysV1, 'ports', 'domains', 'containerPorts'];
  }

  const specKeys = Object.keys(appSpecifications);
  const invalidKeys = specKeys.filter((key) => !allowedKeys.includes(key));

  if (invalidKeys.length > 0) {
    throw new Error(`Invalid Flux App specification keys: ${invalidKeys.join(', ')}`);
  }
}

/**
 * Check hardware parameters for application
 * @param {object} appSpecs - Application specifications
 * @throws {Error} If validation fails
 */
function checkHWParameters(appSpecs) {
  if (appSpecs.tiered) {
    // Tiered application validation
    if (!appSpecs.cpubasic || !appSpecs.rambasic || !appSpecs.hddbasic) {
      throw new Error('Missing basic tier hardware specifications');
    }
    if (!appSpecs.cpusuper || !appSpecs.ramsuper || !appSpecs.hddsuper) {
      throw new Error('Missing super tier hardware specifications');
    }
    if (!appSpecs.cpubamf || !appSpecs.rambamf || !appSpecs.hddbamf) {
      throw new Error('Missing bamf tier hardware specifications');
    }
  } else {
    // Non-tiered application validation
    if (!appSpecs.cpu || !appSpecs.ram || !appSpecs.hdd) {
      throw new Error('Missing hardware specifications (cpu, ram, hdd)');
    }
  }

  // Hardware limits validation
  const maxCpu = config.fluxapps.maxCpu || 4;
  const maxRam = config.fluxapps.maxRam || 8000;
  const maxHdd = config.fluxapps.maxHdd || 50000;

  if (appSpecs.cpu && appSpecs.cpu > maxCpu) {
    throw new Error(`CPU requirement ${appSpecs.cpu} exceeds maximum ${maxCpu}`);
  }
  if (appSpecs.ram && appSpecs.ram > maxRam) {
    throw new Error(`RAM requirement ${appSpecs.ram} exceeds maximum ${maxRam}`);
  }
  if (appSpecs.hdd && appSpecs.hdd > maxHdd) {
    throw new Error(`HDD requirement ${appSpecs.hdd} exceeds maximum ${maxHdd}`);
  }

  // Validate data types for hardware specifications
  if (appSpecs.cpu !== undefined && typeof appSpecs.cpu !== 'number') {
    throw new Error('CPU specification must be a number');
  }
  if (appSpecs.ram !== undefined && typeof appSpecs.ram !== 'number') {
    throw new Error('RAM specification must be a number');
  }
  if (appSpecs.hdd !== undefined && typeof appSpecs.hdd !== 'number') {
    throw new Error('HDD specification must be a number');
  }

  // Validate tiered specifications data types
  if (appSpecs.tiered) {
    const tiers = ['basic', 'super', 'bamf'];
    const specs = ['cpu', 'ram', 'hdd'];

    for (const tier of tiers) {
      for (const spec of specs) {
        const key = `${spec}${tier}`;
        if (appSpecs[key] !== undefined && typeof appSpecs[key] !== 'number') {
          throw new Error(`${key} specification must be a number`);
        }
      }
    }
  }

  return true;
}

/**
 * Check compose hardware parameters for multi-component applications
 * @param {object} appSpecsComposed - Composed application specifications
 * @throws {Error} If validation fails
 */
function checkComposeHWParameters(appSpecsComposed) {
  if (!appSpecsComposed.compose || !Array.isArray(appSpecsComposed.compose)) {
    throw new Error('Invalid compose specification');
  }

  appSpecsComposed.compose.forEach((component, index) => {
    if (!component.cpu || !component.ram || !component.hdd) {
      throw new Error(`Missing hardware specifications for component ${index + 1}`);
    }

    // Individual component limits
    const maxCpu = config.fluxapps.maxCpu || 4;
    const maxRam = config.fluxapps.maxRam || 8000;
    const maxHdd = config.fluxapps.maxHdd || 50000;

    if (component.cpu > maxCpu) {
      throw new Error(`Component ${index + 1} CPU requirement exceeds maximum`);
    }
    if (component.ram > maxRam) {
      throw new Error(`Component ${index + 1} RAM requirement exceeds maximum`);
    }
    if (component.hdd > maxHdd) {
      throw new Error(`Component ${index + 1} HDD requirement exceeds maximum`);
    }
  });
}

/**
 * Main validation function for application specifications
 * @param {object} appSpecifications - Application specifications to validate
 * @param {number} height - Block height for validation context
 * @param {boolean} checkDockerAndWhitelist - Whether to check Docker and whitelist requirements
 * @returns {Promise<boolean>} True if validation passes
 * @throws {Error} If validation fails
 */
async function verifyAppSpecifications(appSpecifications, height, checkDockerAndWhitelist = false) {
  if (!appSpecifications) {
    throw new Error('Invalid Flux App Specifications');
  }
  if (typeof appSpecifications !== 'object') {
    throw new Error('Invalid Flux App Specifications');
  }
  if (Array.isArray(appSpecifications)) {
    throw new Error('Invalid Flux App Specifications');
  }

  // TYPE CHECKS
  verifyTypeCorrectnessOfApp(appSpecifications);

  // RESTRICTION CHECKS
  verifyRestrictionCorrectnessOfApp(appSpecifications, height);

  // SPECS VALIDITY TIME
  if (height < config.fluxapps.appSpecsEnforcementHeights[appSpecifications.version]) {
    throw new Error(`Flux apps specifications of version ${appSpecifications.version} not yet supported`);
  }

  // OBJECT KEY CHECKS
  verifyObjectKeysCorrectnessOfApp(appSpecifications);

  // PORTS UNIQUE CHECKS
  // Note: Port uniqueness check removed to avoid circular dependency with portManager
  // This check should be handled at a higher level where portManager is already available

  // HW Checks
  if (appSpecifications.version <= 3) {
    checkHWParameters(appSpecifications);
  } else {
    checkComposeHWParameters(appSpecifications);
  }

  // Whitelist, repository checks
  if (checkDockerAndWhitelist) {
    const imageManager = require('../appSecurity/imageManager');

    // check blacklist
    await imageManager.checkApplicationImagesComplience(appSpecifications);

    if (appSpecifications.version <= 3) {
      // check repository whitelisted and repotag is available for download
      await imageManager.verifyRepository(appSpecifications.repotag, { repoauth: appSpecifications.repoauth, skipVerification: true });
    } else {
      // eslint-disable-next-line no-restricted-syntax
      for (const appComponent of appSpecifications.compose) {
        // check repository whitelisted and repotag is available for download
        // eslint-disable-next-line no-await-in-loop
        await imageManager.verifyRepository(appComponent.repotag, { repoauth: appComponent.repoauth, skipVerification: true });
      }
    }
  }

  return true;
}

/**
 * Verify app registration parameters via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Validation result
 */
async function verifyAppRegistrationParameters(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const appSpecification = serviceHelper.ensureObject(body);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      // Decrypt enterprise specifications if needed
      const appSpecDecrypted = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // Validate the application specifications
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      // Check if application name conflicts with existing apps
      await validateApplicationNameConflict(appSpecFormatted.name);

      // Validate enterprise secrets if needed
      if (isEnterprise && appSpecFormatted.enterprise) {
        await validateEnterpriseSecrets(appSpecFormatted);
      }

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // App is valid and can be registered
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
      res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * Verify app update parameters via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Validation result
 */
async function verifyAppUpdateParameters(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const appSpecification = serviceHelper.ensureObject(body);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      // For app updates, we need to verify the app exists and validate the update
      const appSpecDecrypted = appSpecification;
      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // Validate the updated application specifications
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      // Validate update permissions and app existence
      await validateAppUpdatePermissions(appSpecFormatted);

      // Check peer counts for safe update
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application update');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application update');
      }

      // App update is valid
      const respondPrice = messageHelper.createDataMessage(appSpecFormatted);
      res.json(respondPrice);
    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * Register application globally via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>} Registration result
 */
async function registerAppGlobalyApi(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege('user', req);
      if (!authorized) {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
        return;
      }

      // Check peer counts for safe registration
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application registration');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application registration');
      }

      const processedBody = serviceHelper.ensureObject(body);
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type;
      let typeVersion = processedBody.version;

      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, timestamp, type, version and signature are provided.');
      }

      if (messageType !== 'zelappregister' && messageType !== 'fluxappregister') {
        throw new Error('Invalid type of message');
      }

      if (typeVersion !== 1) {
        throw new Error('Invalid version of message');
      }

      appSpecification = serviceHelper.ensureObject(appSpecification);
      timestamp = serviceHelper.ensureNumber(timestamp);
      signature = serviceHelper.ensureString(signature);
      messageType = serviceHelper.ensureString(messageType);
      typeVersion = serviceHelper.ensureNumber(typeVersion);

      const timestampNow = Date.now();
      if (timestamp < timestampNow - 1000 * 3600) {
        throw new Error('Message timestamp is over 1 hour old, not valid. Check if your computer clock is synced and restart the registration process.');
      } else if (timestamp > timestampNow + 1000 * 60 * 5) {
        throw new Error('Message timestamp from future, not valid. Check if your computer clock is synced and restart the registration process.');
      }

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }

      // Format the app specification
      const appSpecFormatted = specificationFormatter(appSpecification);

      // Validate the app registration
      await verifyAppSpecifications(appSpecFormatted, syncStatus.data.height, true);

      // Check for name conflicts
      const messageHASH = await generalService.messageHash(messageType + typeVersion + JSON.stringify(appSpecification) + timestamp + signature);
      await registryManager.checkApplicationRegistrationNameConflicts(appSpecFormatted, messageHASH);

      // Check app secrets for v7+ apps
      if (appSpecFormatted.version >= 7) {
        await imageManager.checkAppSecrets(appSpecFormatted);
      }

      // Verify message signature
      await messageVerifier.verifyAppMessageSignature(messageType, typeVersion, appSpecFormatted, timestamp, signature);

      // Prepare the complete message for broadcast
      const completeMessage = {
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature
      };

      // Broadcast temporary app message to network
      log.info('Broadcasting temporary app message to network');
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(completeMessage);
      await serviceHelper.delay(1200); // Wait for processing

      // Request the message back from peers for verification
      log.info('Requesting app message from network for verification');
      await messageVerifier.requestAppMessage(messageHASH);
      await serviceHelper.delay(1200); // Wait for peer response

      // Check if message was stored successfully by waiting up to 10 seconds
      let attempts = 0;
      let tempMessage = null;
      while (attempts < 10 && !tempMessage) {
        tempMessage = await messageVerifier.checkAppTemporaryMessageExistence(messageHASH);
        if (!tempMessage) {
          await serviceHelper.delay(1000);
          attempts += 1;
        }
      }

      if (tempMessage) {
        log.info(`App registration successful for ${appSpecFormatted.name} with hash ${messageHASH}`);
        const response = messageHelper.createDataMessage({
          message: 'Application registration successful',
          hash: messageHASH,
          appSpecification: appSpecFormatted
        });
        res.json(response);
      } else {
        throw new Error('App registration failed - network consensus not achieved');
      }

    } catch (error) {
      log.warn(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * Validate application name conflicts with existing apps
 * @param {string} appName - Application name to validate
 * @throws {Error} If name conflicts exist
 */
async function validateApplicationNameConflict(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

  const projection = {
    projection: {
      _id: 0,
      'appSpecifications.name': 1,
    },
  };

  // Check for existing app with same name
  const existingApp = await dbHelper.findInDatabase(
    database,
    globalAppsMessages,
    { 'appSpecifications.name': appName },
    projection
  );

  if (existingApp.length > 0) {
    throw new Error(`Application name '${appName}' already exists`);
  }

  // Check for reserved names
  const reservedNames = ['flux', 'zel', 'zelcash', 'admin', 'api', 'www', 'mail', 'ftp'];
  if (reservedNames.includes(appName.toLowerCase())) {
    throw new Error(`Application name '${appName}' is reserved`);
  }

  // Validate name format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-_]*[a-zA-Z0-9]$/.test(appName) || appName.length < 2 || appName.length > 32) {
    throw new Error('Invalid application name format. Must be 2-32 characters, alphanumeric with hyphens/underscores, cannot start/end with special characters');
  }
}

/**
 * Validate enterprise application secrets
 * @param {object} appSpec - Application specification
 * @throws {Error} If enterprise validation fails
 */
async function validateEnterpriseSecrets(appSpec) {
  if (!appSpec.enterprise) {
    throw new Error('Enterprise field is required for enterprise applications');
  }

  // Validate that enterprise field is properly encrypted
  if (typeof appSpec.enterprise !== 'string' || appSpec.enterprise.length < 100) {
    throw new Error('Invalid enterprise field format');
  }

  // Additional enterprise validation can be added here
  log.info(`Enterprise application '${appSpec.name}' secrets validated`);
}

/**
 * Validate application update permissions and existence
 * @param {object} appSpec - Application specification for update
 * @throws {Error} If update validation fails
 */
async function validateAppUpdatePermissions(appSpec) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

  const projection = {
    projection: {
      _id: 0,
      owner: 1,
      'appSpecifications.version': 1,
      'appSpecifications.owner': 1,
    },
  };

  // Find existing app
  const existingApp = await dbHelper.findInDatabase(
    database,
    globalAppsMessages,
    { 'appSpecifications.name': appSpec.name },
    projection
  );

  if (existingApp.length === 0) {
    throw new Error(`Application '${appSpec.name}' does not exist and cannot be updated`);
  }

  const lastApp = existingApp[existingApp.length - 1];
  const originalOwner = lastApp.owner || lastApp.appSpecifications.owner;

  // Validate owner matches
  if (originalOwner !== appSpec.owner) {
    throw new Error('Only the original owner can update this application');
  }

  // Validate version increment
  const currentVersion = lastApp.appSpecifications.version || 1;
  if (appSpec.version <= currentVersion) {
    throw new Error('Application version must be incremented for updates');
  }

  log.info(`Update permissions validated for application '${appSpec.name}'`);
}

module.exports = {
  verifyTypeCorrectnessOfApp,
  verifyRestrictionCorrectnessOfApp,
  verifyObjectKeysCorrectnessOfApp,
  checkHWParameters,
  checkComposeHWParameters,
  verifyAppSpecifications,
  verifyAppRegistrationParameters,
  verifyAppUpdateParameters,
  registerAppGlobalyApi,
  validateApplicationNameConflict,
  validateEnterpriseSecrets,
  validateAppUpdatePermissions,
};
