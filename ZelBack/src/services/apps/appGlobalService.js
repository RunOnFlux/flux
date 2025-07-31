/**
 * App Global Service
 *
 * This service handles global app management, including:
 * - Global app registry and specifications
 * - App hashing and verification
 * - Inter-node synchronization
 * - Distributed app lifecycle management
 * - App location tracking across the network
 *
 * Dependencies are properly resolved through individual service imports:
 * - Validation functions: appValidationService
 * - Communication functions: appCommunicationService
 * - Installation functions: appInstallationService
 * - File operations: appFileService
 * - Container operations: appContainerService
 */

const config = require('config');
const path = require('node:path');

const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const {
  outgoingPeers, incomingPeers,
} = require('../utils/establishedConnections');
const serviceHelper = require('../serviceHelper');
const dbHelper = require('../dbHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const benchmarkService = require('../benchmarkService');
const generalService = require('../generalService');
const log = require('../../lib/log');
const cacheManager = require('../utils/cacheManager').default;

// Lazy loading to avoid circular dependencies
let appValidationService;
let appCommunicationService; 
let appInstallationService;
let appFileService;
let appContainerService;
let appMonitoringService;
let appPricingService;

const fluxDirPath = path.join(__dirname, '../../../../');

const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const appsHashesCollection = config.database.daemon.collections.appsHashes;

const localAppsInformation = config.database.appslocal.collections.appsInformation;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;
const globalAppsInstallingLocations = config.database.appsglobal.collections.appsInstallingLocations;
const globalAppsInstallingErrorsLocations = config.database.appsglobal.collections.appsInstallingErrorsLocations;

const spawnErrorsLongerAppCache = cacheManager.appSpawnErrorCache;
const trySpawningGlobalAppCache = cacheManager.appSpawnCache;

const isArcane = Boolean(process.env.FLUXOS_PATH);

// Variable to track reindexing status
let reindexRunning = false;

// Hash numbers search tracking
const hashesNumberOfSearchs = new Map();

// Lazy load services to avoid circular dependencies
function getServices() {
  if (!appValidationService) {
    appValidationService = require('./appValidationService');
    appCommunicationService = require('./appCommunicationService');
    appInstallationService = require('./appInstallationService');
    appFileService = require('./appFileService');
    appContainerService = require('./appContainerService');
    appMonitoringService = require('./appMonitoringService');
    appPricingService = require('./appPricingService');
  }
  return {
    appValidationService,
    appCommunicationService,
    appInstallationService,
    appFileService,
    appContainerService,
    appMonitoringService,
    appPricingService,
  };
}
let userconfig;
try {
  // eslint-disable-next-line import/no-dynamic-require
  userconfig = require(path.join(fluxDirPath, 'config/userconfig.js'));
} catch (error) {
  log.error('Failed to load userconfig:', error);
  userconfig = { initial: { zelid: '' } };
}

// Delegated functions that call the appropriate services
function checkAndDecryptAppSpecs(...args) {
  const { appValidationService: service } = getServices();
  return service.checkAndDecryptAppSpecs(...args);
}

function specificationFormatter(...args) {
  const { appValidationService: service } = getServices();
  return service.specificationFormatter(...args);
}

function verifyAppSpecifications(...args) {
  const { appValidationService: service } = getServices();
  return service.verifyAppSpecifications(...args);
}

function checkAppSecrets(...args) {
  const { appValidationService: service } = getServices();
  return service.checkAppSecrets(...args);
}

function checkApplicationRegistrationNameConflicts(...args) {
  const { appValidationService: service } = getServices();
  return service.checkApplicationRegistrationNameConflicts(...args);
}

function verifyAppMessageSignature(...args) {
  const { appCommunicationService: service } = getServices();
  return service.verifyAppMessageSignature(...args);
}

function requestAppMessage(...args) {
  const { appCommunicationService: service } = getServices();
  return service.requestAppMessage(...args);
}

function checkAppTemporaryMessageExistence(...args) {
  const { appCommunicationService: service } = getServices();
  return service.checkAppTemporaryMessageExistence(...args);
}

function verifyAppMessageUpdateSignature(...args) {
  const { appCommunicationService: service } = getServices();
  return service.verifyAppMessageUpdateSignature(...args);
}

function checkApplicationUpdateNameRepositoryConflicts(...args) {
  const { appValidationService: service } = getServices();
  return service.checkApplicationUpdateNameRepositoryConflicts(...args);
}

function checkAppMessageExistence(...args) {
  const { appCommunicationService: service } = getServices();
  return service.checkAppMessageExistence(...args);
}

function storeAppPermanentMessage(...args) {
  const { appCommunicationService: service } = getServices();
  return service.storeAppPermanentMessage(...args);
}

function appHashHasMessage(...args) {
  const { appCommunicationService: service } = getServices();
  return service.appHashHasMessage(...args);
}

function appPricePerMonth(...args) {
  const { appPricingService: service } = getServices();
  return service.appPricePerMonth(...args);
}

function requestAppsMessage(...args) {
  const { appCommunicationService: service } = getServices();
  return service.requestAppsMessage(...args);
}

function storeAppTemporaryMessage(...args) {
  const { appCommunicationService: service } = getServices();
  return service.storeAppTemporaryMessage(...args);
}

function checkForAppFluxUpdates(...args) {
  const { appMonitoringService: service } = getServices();
  return service.checkForAppFluxUpdates(...args);
}

function removeAppLocally(...args) {
  const { appInstallationService: service } = getServices();
  return service.removeAppLocally(...args);
}

function runAppContainer(...args) {
  const { appContainerService: service } = getServices();
  return service.runAppContainer(...args);
}

function installApplicationFromSettings(...args) {
  const { appInstallationService: service } = getServices();
  return service.installApplicationFromSettings(...args);
}

function ensureAppUniquePorts(...args) {
  const { appValidationService: service } = getServices();
  return service.ensureAppUniquePorts(...args);
}

function availableApps(...args) {
  const { appContainerService: service } = getServices();
  return service.availableApps(...args);
}

function getPreviousAppSpecifications(...args) {
  const { appValidationService: service } = getServices();
  return service.getPreviousAppSpecifications(...args);
}

// Variables for tracking continuous hash checks
let continuousFluxAppHashesCheckRunning = false;
let firstContinuousFluxAppHashesCheckRun = false;

/**
 * To get specifications for global apps.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getGlobalAppsSpecifications(req, res) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    let { hash } = req.params;
    hash = hash || req.query.hash;
    let { owner } = req.params;
    owner = owner || req.query.owner;
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (hash) {
      query.hash = hash;
    }
    if (owner) {
      query.owner = owner;
    }
    if (appname) {
      query.name = appname;
    }
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return available apps.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {(object|object[])} Returns a response or an array of app objects.
 */
async function availableApps(req, res) {
  // calls to global mongo db
  // simulate a similar response
  const apps = [
    { // app specifications
      version: 2,
      name: 'FoldingAtHomeB',
      description: 'Folding @ Home for AMD64 Devices. Folding@home is a project focused on disease research. Client Visit was disabled, to check your stats go to https://stats.foldingathome.org/donor and search for your zelid.',
      repotag: 'yurinnick/folding-at-home:latest',
      owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
      tiered: true,
      ports: [30000],
      containerPorts: [7396],
      domains: [''],
      cpu: 0.5,
      ram: 500,
      hdd: 5,
      cpubasic: 0.5,
      cpusuper: 1,
      cpubamf: 2,
      rambasic: 500,
      ramsuper: 500,
      rambamf: 500,
      hddbasic: 5,
      hddsuper: 5,
      hddbamf: 5,
      enviromentParameters: [`USER=${userconfig.initial.zelid}`, 'TEAM=262156', 'ENABLE_GPU=false', 'ENABLE_SMP=true'],
      commands: [],
      containerData: '/config',
      hash: 'localappinstancehashABCDEF', // hash of app message
      height: 0, // height of tx on which it was
    },
    { // app specifications
      version: 2,
      name: 'FoldingAtHomeArm64',
      description: 'Folding @ Home For ARM64. Folding@home is a project focused on disease research. Client Visit was disabled, to check your stats go to https://stats.foldingathome.org/donor and search for your zelid.',
      repotag: 'beastob/foldingathome-arm64',
      owner: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
      tiered: true,
      ports: [30000],
      containerPorts: [7396],
      domains: [''],
      cpu: 1,
      ram: 500,
      hdd: 5,
      cpubasic: 1,
      cpusuper: 2,
      cpubamf: 2,
      rambasic: 500,
      ramsuper: 500,
      rambamf: 500,
      hddbasic: 5,
      hddsuper: 5,
      hddbamf: 5,
      enviromentParameters: [`FOLD_USER=${userconfig.initial.zelid}`, 'FOLD_TEAM=262156', 'FOLD_ANON=false'],
      commands: [],
      containerData: '/config',
      hash: 'localSpecificationsFoldingVersion1', // hash of app message
      height: 0, // height of tx on which it was
    },
  ];

  const dataResponse = messageHelper.createDataMessage(apps);
  return res ? res.json(dataResponse) : apps;
}

/**
 *
 * @param {express.Request} req
 * @param {express.Response} res
 */
async function getlatestApplicationSpecificationAPI(req, res) {
  const latestSpec = config.fluxapps.latestAppSpecification || 1;

  const message = messageHelper.createDataMessage(latestSpec);

  res.json(message);
}

/**
 * To register an app globally via API. Performs various checks before the app can be registered. Only accessible by users.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
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
      // first check if this node is available for application registration
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application registration');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application registration');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and port HAVE to be unique for application. Check if they don't exist in global database
      // first let's check if all fields are present and have proper format except tiered and tiered specifications and those can be omitted
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, type, version, timestamp and signature are provided.');
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
      const daemonHeight = syncStatus.data.height;

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
          owner: appSpecification.owner,
        },
      );

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // check if name is not yet registered
      await checkApplicationRegistrationNameConflicts(appSpecFormatted);

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? specificationFormatter(appSpecification)
        : appSpecFormatted;

      // check if zelid owner is correct ( done in message verification )
      // if signature is not correct, then specifications are not correct type or bad message received. Respond with 'Received message is invalid';
      await verifyAppMessageSignature(messageType, typeVersion, toVerify, timestamp, signature);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may pose some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);

      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
        arcaneSender: isArcane,
      };
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);
      // above takes 2-3 seconds
      await serviceHelper.delay(1200); // it takes receiving node at least 1 second to process the message. Add 1200 ms mas for processing
      // this operations takes 2.5-3.5 seconds and is heavy, message gets verified again.
      await requestAppMessage(messageHASH); // this itself verifies that Peers received our message broadcast AND peers send us the message back. By peers sending the message back we finally store it to our temporary message storage and rebroadcast it again
      // request app message is quite slow and from performance testing message will appear roughly 5 seconds after ask
      await serviceHelper.delay(1200); // 1200 ms mas for processing - peer sends message back to us
      // check temporary message storage
      let tempMessage = await checkAppTemporaryMessageExistence(messageHASH); // Cumulus measurement: after roughly 8 seconds here
      for (let i = 0; i < 20; i += 1) { // ask for up to 20 times - 10 seconds. Must have been processed by that time or it failed. Cumulus measurement: Approx 5-6 seconds
        if (!tempMessage) {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          tempMessage = await checkAppTemporaryMessageExistence(messageHASH);
        }
      }
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const responseHash = messageHelper.createDataMessage(tempMessage.hash);
        res.json(responseHash); // all ok
        return;
      }
      throw new Error('Unable to register application on the network. Try again later.');
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
 * To update an app globally via API. Performs various checks before the app can be updated. Price handled in UI and available in API. Only accessible by users.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function updateAppGlobalyApi(req, res) {
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
      // first check if this node is available for application update
      if (outgoingPeers.length < config.fluxapps.minOutgoing) {
        throw new Error('Sorry, This Flux does not have enough outgoing peers for safe application update');
      }
      if (incomingPeers.length < config.fluxapps.minIncoming) {
        throw new Error('Sorry, This Flux does not have enough incoming peers for safe application update');
      }
      const processedBody = serviceHelper.ensureObject(body);
      // Note. Actually signature, timestamp is not needed. But we require it only to verify that user indeed has access to the private key of the owner zelid.
      // name and ports HAVE to be unique for application. Check if they don't exist in global database
      // first let's check if all fields are present and have proper format except tiered and tiered specifications and those can be omitted
      let { appSpecification, timestamp, signature } = processedBody;
      let messageType = processedBody.type; // determines how data is treated in the future
      let typeVersion = processedBody.version; // further determines how data is treated in the future
      if (!appSpecification || !timestamp || !signature || !messageType || !typeVersion) {
        throw new Error('Incomplete message received. Check if appSpecification, timestamp, type, version and signature are provided.');
      }
      if (messageType !== 'zelappupdate' && messageType !== 'fluxappupdate') {
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
      const daemonHeight = syncStatus.data.height;

      const appSpecDecrypted = await checkAndDecryptAppSpecs(
        appSpecification,
        {
          daemonHeight,
        },
      );

      const appSpecFormatted = specificationFormatter(appSpecDecrypted);

      // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
      await verifyAppSpecifications(appSpecFormatted, daemonHeight, true);

      if (appSpecFormatted.version === 7 && appSpecFormatted.nodes.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const appComponent of appSpecFormatted.compose) {
          if (appComponent.secrets) {
            // eslint-disable-next-line no-await-in-loop
            await checkAppSecrets(appSpecFormatted.name, appComponent, appSpecFormatted.owner);
          }
        }
      }

      // verify that app exists, does not change repotag and is signed by app owner.
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      // may throw
      const query = { name: appSpecFormatted.name };
      const projection = {
        projection: {
          _id: 0,
        },
      };
      const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
      if (!appInfo) {
        throw new Error('Flux App update received but application to update does not exist!');
      }
      if (appInfo.repotag !== appSpecFormatted.repotag) { // this is OK. <= v3 cannot change, v4 can but does not have this in specifications as its compose
        throw new Error('Flux App update of repotag is not allowed');
      }
      const appOwner = appInfo.owner; // ensure previous app owner is signing this message

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const toVerify = isEnterprise
        ? specificationFormatter(appSpecification)
        : appSpecFormatted;

      // here signature is checked against PREVIOUS app owner
      await verifyAppMessageUpdateSignature(messageType, typeVersion, toVerify, timestamp, signature, appOwner, daemonHeight);

      // verify that app exists, does not change repotag (for v1-v3), does not change name and does not change component names
      await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, timestamp);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // if all ok, then sha256 hash of entire message = message + timestamp + signature. We are hashing all to have always unique value.
      // If hashing just specificiations, if application goes back to previous specifications, it may pose some issues if we have indeed correct state
      // We respond with a hash that is supposed to go to transaction.
      const message = messageType + typeVersion + JSON.stringify(appSpecFormatted) + timestamp + signature;
      const messageHASH = await generalService.messageHash(message);

      // now all is great. Store appSpecFormatted, timestamp, signature and hash in appsTemporaryMessages. with 1 hours expiration time. Broadcast this message to all outgoing connections.
      const temporaryAppMessage = { // specification of temp message
        type: messageType,
        version: typeVersion,
        appSpecifications: appSpecFormatted,
        hash: messageHASH,
        timestamp,
        signature,
        arcaneSender: isArcane,
      };
      await fluxCommunicationMessagesSender.broadcastTemporaryAppMessage(temporaryAppMessage);
      // above takes 2-3 seconds
      await serviceHelper.delay(1200); // it takes receiving node at least 1 second to process the message. Add 1200 ms mas for processing
      // this operations takes 2.5-3.5 seconds and is heavy, message gets verified again.
      await requestAppMessage(messageHASH); // this itself verifies that Peers received our message broadcast AND peers send us the message back. By peers sending the message back we finally store it to our temporary message storage and rebroadcast it again
      await serviceHelper.delay(1200); // 1200 ms mas for processing - peer sends message back to us
      // check temporary message storage
      let tempMessage = await checkAppTemporaryMessageExistence(messageHASH);
      for (let i = 0; i < 20; i += 1) { // ask for up to 20 times - 10 seconds. Must have been processed by that time or it failed.
        if (!tempMessage) {
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          tempMessage = await checkAppTemporaryMessageExistence(messageHASH);
        }
      }
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const responseHash = messageHelper.createDataMessage(tempMessage.hash);
        res.json(responseHash); // all ok
        return;
      }
      throw new Error('Unable to update application on the network. Try again later.');
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
 * To update app specifications.
 * @param {object} appSpecs App specifications.
 */
async function updateAppSpecifications(appSpecs) {
  try {
    // appSpecs: {
    //   version: 3,
    //   name: 'FoldingAtHomeB',
    //   description: 'Folding @ Home is cool :)',
    //   repotag: 'yurinnick/folding-at-home:latest',
    //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    //   ports: '[30001]',
    //   containerPorts: '[7396]',
    //   domains: '[""]',
    //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
    //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
    //   containerData: '/config',
    //   cpu: 0.5,
    //   ram: 500,
    //   hdd: 5,
    //   tiered: true,
    //   cpubasic: 0.5,
    //   rambasic: 500,
    //   hddbasic: 5,
    //   cpusuper: 1,
    //   ramsuper: 1000,
    //   hddsuper: 5,
    //   cpubamf: 2,
    //   rambamf: 2000,
    //   hddbamf: 5,
    //   instances: 10, // version 3 fork
    //   hash: hash of message that has these paramenters,
    //   height: height containing the message
    // };
    // const appSpecs = {
    //   version: 4, // int
    //   name: 'FoldingAtHomeB', // string
    //   description: 'Folding @ Home is cool :)', // string
    //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC', // string
    //   compose: [ // array of max 5 objects of following specs
    //     {
    //       name: 'Daemon', // string
    //       description: 'Main ddaemon for foldingAtHome', // string
    //       repotag: 'yurinnick/folding-at-home:latest',
    //       ports: '[30001]', // array of ints
    //       containerPorts: '[7396]', // array of ints
    //       domains: '[""]', // array of strings
    //       environmentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // array of strings
    //       commands: '["--allow","0/0","--web-allow","0/0"]', // array of strings
    //       containerData: '/config', // string
    //       cpu: 0.5, // float
    //       ram: 500, // int
    //       hdd: 5, // int
    //       tiered: true, // bool
    //       cpubasic: 0.5, // float
    //       rambasic: 500, // int
    //       hddbasic: 5, // int
    //       cpusuper: 1, // float
    //       ramsuper: 1000, // int
    //       hddsuper: 5, // int
    //       cpubamf: 2, // float
    //       rambamf: 2000, // int
    //       hddbamf: 5, // int
    //     },
    //   ],
    //   instances: 10, // int
    // };
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { name: appSpecs.name };
    const update = { $set: appSpecs };
    const options = {
      upsert: true,
    };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
    if (appInfo) {
      if (appInfo.height < appSpecs.height) {
        await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
      }
    } else {
      await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
    }
    const queryDeleteAppErrors = { name: appSpecs.name };
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingErrorsLocations, queryDeleteAppErrors);
  } catch (error) {
    // retry
    log.error(error);
    await serviceHelper.delay(60 * 1000);
    updateAppSpecifications(appSpecs);
  }
}

/**
 * To update app specifications for rescan/reindex.
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True.
 */
async function updateAppSpecsForRescanReindex(appSpecs) {
  // appSpecs: {
  //   version: 3,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   ports: '[30001]',
  //   containerPorts: '[7396]',
  //   domains: '[""]',
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
  //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
  //   containerData: '/config',
  //   cpu: 0.5,
  //   ram: 500,
  //   hdd: 5,
  //   tiered: true,
  //   cpubasic: 0.5,
  //   rambasic: 500,
  //   hddbasic: 5,
  //   cpusuper: 1,
  //   ramsuper: 1000,
  //   hddsuper: 5,
  //   cpubamf: 2,
  //   rambamf: 2000,
  //   hddbamf: 5,
  //   instances: 10, // version 3 fork
  //   hash: hash of message that has these paramenters,
  //   height: height containing the message
  // };
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: appSpecs.name };
  const update = { $set: appSpecs };
  const options = {
    upsert: true,
  };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (appInfo) {
    if (appInfo.height < appSpecs.height) {
      await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
    }
  } else {
    await dbHelper.updateOneInDatabase(database, globalAppsInformation, query, update, options);
  }
  return true;
}

/**
 * To check and request an app. Handles fluxappregister type and fluxappupdate type.
 * Verification of specification was already done except the price which is done here
 * @param {object} hash Hash object containing app information.
 * @param {string} txid Transaction ID.
 * @param {number} height Block height.
 * @param {number} valueSat Satoshi denomination (100 millionth of 1 Flux).
 * @param {number} i Defaults to value of 0.
 * @returns {boolean} Return true if app message is already present otherwise else.
 */
async function checkAndRequestApp(hash, txid, height, valueSat, i = 0) {
  try {
    if (height < config.fluxapps.epochstart) { // do not request testing apps
      return false;
    }
    const appMessageExists = await checkAppMessageExistence(hash);
    if (appMessageExists === false) { // otherwise do nothing
      // we surely do not have that message in permanent storaage.
      // check temporary message storage
      // if we have it in temporary storage, get the temporary message
      const tempMessage = await checkAppTemporaryMessageExistence(hash);
      if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
        const specifications = tempMessage.appSpecifications || tempMessage.zelAppSpecifications;
        // temp message means its all ok. store it as permanent app message
        const permanentAppMessage = {
          type: tempMessage.type,
          version: tempMessage.version,
          appSpecifications: specifications,
          hash: tempMessage.hash,
          timestamp: tempMessage.timestamp,
          signature: tempMessage.signature,
          txid: serviceHelper.ensureString(txid),
          height: serviceHelper.ensureNumber(height),
          valueSat: serviceHelper.ensureNumber(valueSat),
        };
        await storeAppPermanentMessage(permanentAppMessage);
        // await update zelapphashes that we already have it stored
        await appHashHasMessage(hash);

        const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
        const daemonHeight = syncStatus.data.height;
        const expire = specifications.expire || 22000;
        if (height + expire > daemonHeight) {
          // we only do this validations if the app can still be currently running to insert it or update it in globalappspecifications
          const appPrices = await getChainParamsPriceUpdates();
          const intervals = appPrices.filter((interval) => interval.height < height);
          const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
          if (tempMessage.type === 'zelappregister' || tempMessage.type === 'fluxappregister') {
            // check if value is optimal or higher
            let appPrice = await appPricePerMonth(specifications, height, appPrices);
            const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
            const expireIn = specifications.expire || defaultExpire;
            // app prices are ceiled to highest 0.01
            const multiplier = expireIn / defaultExpire;
            appPrice *= multiplier;
            appPrice = Math.ceil(appPrice * 100) / 100;
            if (appPrice < priceSpecifications.minPrice) {
              appPrice = priceSpecifications.minPrice;
            }
            if (valueSat >= appPrice * 1e8) {
              const updateForSpecifications = permanentAppMessage.appSpecifications;
              updateForSpecifications.hash = permanentAppMessage.hash;
              updateForSpecifications.height = permanentAppMessage.height;
              // object of appSpecifications extended for hash and height
              await updateAppSpecifications(updateForSpecifications);
              // every time we ask for a missing app message that is a appregister call after expireGlobalApplications to make sure we don't have on
            } else {
              log.warn(`Apps message ${permanentAppMessage.hash} is underpaid ${valueSat} < ${appPrice * 1e8} - priceSpecs ${JSON.stringify(priceSpecifications)} - specs ${JSON.stringify(specifications)}`);
            }
          } else if (tempMessage.type === 'zelappupdate' || tempMessage.type === 'fluxappupdate') {
            // appSpecifications.name as identifier
            const db = dbHelper.databaseConnection();
            const database = db.db(config.database.appsglobal.database);
            const projection = {
              projection: {
                _id: 0,
              },
            };
            // we may not have the application in global apps. This can happen when we receive the message after the app has already expired AND we need to get message right before our message. Thus using messages system that is accurate
            const appsQuery = {
              'appSpecifications.name': specifications.name,
            };
            const findPermAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
            let latestPermanentRegistrationMessage;
            findPermAppMessage.forEach((foundMessage) => {
              // has to be registration message
              if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
                if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= tempMessage.timestamp) { // no message and found message is not newer than our message
                  latestPermanentRegistrationMessage = foundMessage;
                } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
                  if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= tempMessage.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
                    latestPermanentRegistrationMessage = foundMessage;
                  }
                }
              }
            });
            // some early app have zelAppSepcifications
            const appsQueryB = {
              'zelAppSpecifications.name': specifications.name,
            };
            const findPermAppMessageB = await dbHelper.findInDatabase(database, globalAppsMessages, appsQueryB, projection);
            findPermAppMessageB.forEach((foundMessage) => {
              // has to be registration message
              if (foundMessage.type === 'zelappregister' || foundMessage.type === 'fluxappregister' || foundMessage.type === 'zelappupdate' || foundMessage.type === 'fluxappupdate') { // can be any type
                if (!latestPermanentRegistrationMessage && foundMessage.timestamp <= tempMessage.timestamp) { // no message and found message is not newer than our message
                  latestPermanentRegistrationMessage = foundMessage;
                } else if (latestPermanentRegistrationMessage && latestPermanentRegistrationMessage.height <= foundMessage.height) { // we have some message and the message is quite new
                  if (latestPermanentRegistrationMessage.timestamp < foundMessage.timestamp && foundMessage.timestamp <= tempMessage.timestamp) { // but our message is newer. foundMessage has to have lower timestamp than our new message
                    latestPermanentRegistrationMessage = foundMessage;
                  }
                }
              }
            });
            const messageInfo = latestPermanentRegistrationMessage;
            if (!messageInfo) {
              log.error(`Last permanent message for ${specifications.name} not found`);
              return true;
            }
            const previousSpecs = messageInfo.appSpecifications || messageInfo.zelAppSpecifications;
            // here comparison of height differences and specifications
            // price shall be price for standard registration plus minus already paid price according to old specifics. height remains height valid for 22000 blocks
            let appPrice = await appPricePerMonth(specifications, height, appPrices);
            let previousSpecsPrice = await appPricePerMonth(previousSpecs, messageInfo.height || height, appPrices);
            const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
            const currentExpireIn = specifications.expire || defaultExpire;
            const previousExpireIn = previousSpecs.expire || defaultExpire;
            // app prices are ceiled to highest 0.01
            const multiplierCurrent = currentExpireIn / defaultExpire;
            appPrice *= multiplierCurrent;
            appPrice = Math.ceil(appPrice * 100) / 100;
            const multiplierPrevious = previousExpireIn / defaultExpire;
            previousSpecsPrice *= multiplierPrevious;
            previousSpecsPrice = Math.ceil(previousSpecsPrice * 100) / 100;
            // what is the height difference
            const heightDifference = permanentAppMessage.height - messageInfo.height;
            // currentExpireIn is always higher than heightDifference
            const perc = (previousExpireIn - heightDifference) / previousExpireIn; // how much of previous specs was not used yet
            let actualPriceToPay = appPrice * 0.9;
            if (perc > 0) {
              actualPriceToPay = (appPrice - (perc * previousSpecsPrice)) * 0.9; // discount for missing heights. Allow 90%
            }
            actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
            if (actualPriceToPay < priceSpecifications.minPrice) {
              actualPriceToPay = priceSpecifications.minPrice;
            }
            if (valueSat >= actualPriceToPay * 1e8) {
              const updateForSpecifications = permanentAppMessage.appSpecifications;
              updateForSpecifications.hash = permanentAppMessage.hash;
              updateForSpecifications.height = permanentAppMessage.height;
              // object of appSpecifications extended for hash and height
              // do not await this
              updateAppSpecifications(updateForSpecifications);
            } else {
              log.warn(`Apps message ${permanentAppMessage.hash} is underpaid ${valueSat} < ${appPrice * 1e8}`);
            }
          }
        }
        return true;
      }
      if (i < 2) {
        // request the message and broadcast the message further to our connected peers.
        // rerun this after 1 min delay
        // We ask to the connected nodes 2 times in 1 minute interval for the app message, if connected nodes don't
        // have the app message we will ask for it again when continuousFluxAppHashesCheck executes again.
        // in total we ask to the connected nodes 10 (30m interval) x 2 (1m interval) = 20 times before apphash is marked as not found
        await requestAppMessage(hash);
        await serviceHelper.delay(60 * 1000);
        return checkAndRequestApp(hash, txid, height, valueSat, i + 1);
        // additional requesting of missing app messages is done on rescans
      }
      return false;
    }
    // update apphashes that we already have it stored
    await appHashHasMessage(hash);
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To check and request an app. Handles fluxappregister type and fluxappupdate type.
 * Verification of specification was already done except the price which is done here
 * @param {object} apps array list with list of apps that are missing.
 * @param {boolean} incoming If true the message will be asked to a incoming peer, if false to an outgoing peer.
 * @param {number} i Defaults to value of 1.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkAndRequestMultipleApps(apps, incoming = false, i = 1) {
  try {
    const numberOfPeers = fluxNetworkHelper.getNumberOfPeers();
    if (numberOfPeers < 12) {
      log.info('checkAndRequestMultipleApps - Not enough connected peers to request missing Flux App messages');
      return;
    }
    await requestAppsMessage(apps, incoming);
    await serviceHelper.delay(30 * 1000);
    const appsToRemove = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      const messageReceived = await checkAndRequestApp(app.hash, app.txid, app.height, app.value, 2);
      if (messageReceived) {
        appsToRemove.push(app);
      }
    }
    apps.filter((item) => !appsToRemove.includes(item));
    if (apps.length > 0 && i < 5) {
      await checkAndRequestMultipleApps(apps, i % 2 === 0, i + 1);
    }
  } catch (error) {
    log.error(error);
  }
}

async function reindexGlobalAppsInformation() {
  try {
    if (reindexRunning) {
      return 'Previous app reindex not yet finished. Skipping.';
    }
    reindexRunning = true;
    log.info('Reindexing global application list');
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsInformation).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    await database.collection(globalAppsInformation).createIndex({ name: 1 }, { name: 'query for getting zelapp based on zelapp specs name' });
    await database.collection(globalAppsInformation).createIndex({ owner: 1 }, { name: 'query for getting zelapp based on zelapp specs owner' });
    await database.collection(globalAppsInformation).createIndex({ repotag: 1 }, { name: 'query for getting zelapp based on image' });
    await database.collection(globalAppsInformation).createIndex({ height: 1 }, { name: 'query for getting zelapp based on last height update' }); // we need to know the height of app adjustment
    await database.collection(globalAppsInformation).createIndex({ hash: 1 }, { name: 'query for getting zelapp based on last hash' }); // we need to know the hash of the last message update which is the true identifier
    const query = {};
    const projection = { projection: { _id: 0 }, sort: { height: 1 } }; // sort from oldest to newest
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
    // eslint-disable-next-line no-restricted-syntax
    for (const message of results) {
      const updateForSpecifications = message.appSpecifications || message.zelAppSpecifications;
      updateForSpecifications.hash = message.hash;
      updateForSpecifications.height = message.height;
      // eslint-disable-next-line no-await-in-loop
      await updateAppSpecsForRescanReindex(updateForSpecifications);
    }
    log.info('Reindexing of global application list finished. Starting expiring global apps.');
    // eslint-disable-next-line no-use-before-define
    await expireGlobalApplications();
    log.info('Expiration of global application list finished. Done.');
    reindexRunning = false;
    return true;
  } catch (error) {
    reindexRunning = false;
    log.error(error);
    throw error;
  }
}

/**
 * To drop information about running apps and rebuild indexes.
 * @returns {boolean} True or thorws an error.
 */
async function reindexGlobalAppsLocation() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsLocations).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    await database.collection(globalAppsLocations).createIndex({ name: 1 }, { name: 'query for getting zelapp location based on zelapp specs name' });
    await database.collection(globalAppsLocations).createIndex({ hash: 1 }, { name: 'query for getting zelapp location based on zelapp hash' });
    await database.collection(globalAppsLocations).createIndex({ ip: 1 }, { name: 'query for getting zelapp location based on ip' });
    await database.collection(globalAppsLocations).createIndex({ name: 1, ip: 1 }, { name: 'query for getting app based on ip and name' });
    await database.collection(globalAppsLocations).createIndex({ name: 1, ip: 1, broadcastedAt: 1 }, { name: 'query for getting app to ensure we possess a message' });
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To iterate over all global apps messages and update global apps information database.
 * @param {number} height Defaults to value of 0.
 * @param {boolean} removeLastInformation Defaults to false.
 * @returns {boolean} True or thorws an error.
 */
async function rescanGlobalAppsInformation(height = 0, removeLastInformation = false) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    await dbHelper.dropCollection(database, globalAppsInformation).catch((error) => {
      if (error.message !== 'ns not found') {
        throw error;
      }
    });
    const query = { height: { $gte: height } };
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);

    if (removeLastInformation === true) {
      await dbHelper.removeDocumentsFromCollection(database, globalAppsInformation, query);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const message of results) {
      const updateForSpecifications = message.appSpecifications || message.zelAppSpecifications;
      updateForSpecifications.hash = message.hash;
      updateForSpecifications.height = message.height;
      // eslint-disable-next-line no-await-in-loop
      await updateAppSpecsForRescanReindex(updateForSpecifications);
    }
    // eslint-disable-next-line no-use-before-define
    expireGlobalApplications();
    return true;
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/**
 * To reindex global apps location via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsLocationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsLocation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
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
 * To reindex global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      await reindexGlobalAppsInformation();
      const message = messageHelper.createSuccessMessage('Reindex successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
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
 * To rescan global apps information via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function rescanGlobalAppsInformationAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = messageHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
      if (!currentHeight) {
        throw new Error('No scanned height found');
      }
      if (currentHeight.generalScannedHeight <= blockheight) {
        throw new Error('Block height shall be lower than currently scanned');
      }
      if (blockheight < 0) {
        throw new Error('BlockHeight lower than 0');
      }
      let { removelastinformation } = req.params;
      removelastinformation = removelastinformation || req.query.removelastinformation || false;
      removelastinformation = serviceHelper.ensureBoolean(removelastinformation);
      await rescanGlobalAppsInformation(blockheight, removelastinformation);
      const message = messageHelper.createSuccessMessage('Rescan successfull');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
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

async function checkAndSyncAppHashes() {
  try {
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    // get flux app hashes that do not have a message;
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        message: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const numberOfMissingApps = results.filter((app) => app.message === false).length;
    if (numberOfMissingApps > results.length * 0.95) {
      let finished = false;
      let i = 0;
      while (!finished && i <= 5) {
        i += 1;
        const client = outgoingPeers[Math.floor(Math.random() * outgoingPeers.length)];
        let axiosConfig = {
          timeout: 5000,
        };
        log.info(`checkAndSyncAppHashes - Getting explorer sync status from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-await-in-loop
        const response = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/explorer/issynced`, axiosConfig).catch((error) => log.error(error));
        if (!response || !response.data || response.data.status !== 'success') {
          log.info(`checkAndSyncAppHashes - Failed to get explorer sync status from ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!response.data.data) {
          log.info(`checkAndSyncAppHashes - Explorer is not synced on ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        log.info(`checkAndSyncAppHashes - Explorer is synced on ${client.ip}:${client.port}`);
        axiosConfig = {
          timeout: 120000,
        };
        log.info(`checkAndSyncAppHashes - Getting permanent app messages from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-await-in-loop
        const appsResponse = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/apps/permanentmessages`, axiosConfig).catch((error) => log.error(error));
        if (!appsResponse || !appsResponse.data || appsResponse.data.status !== 'success' || !appsResponse.data.data) {
          log.info(`checkAndSyncAppHashes - Failed to get permanent app messages from ${client.ip}:${client.port}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        const apps = appsResponse.data.data;
        log.info(`checkAndSyncAppHashes - Will process ${apps.length} apps messages`);
        // sort it by height, so we process oldest messages first
        apps.sort((a, b) => a.height - b.height);
        let y = 0;
        // eslint-disable-next-line no-restricted-syntax
        for (const appMessage of apps) {
          y += 1;
          try {
            // eslint-disable-next-line no-await-in-loop
            await storeAppTemporaryMessage(appMessage, true);
            // eslint-disable-next-line no-await-in-loop
            await checkAndRequestApp(appMessage.hash, appMessage.txid, appMessage.height, appMessage.value, 2);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(50);
          } catch (error) {
            log.error(error);
          }
          if (y % 500 === 0) {
            log.info(`checkAndSyncAppHashes - ${y} were already processed`);
          }
        }
        finished = true;
        // eslint-disable-next-line no-await-in-loop, no-use-before-define
        await expireGlobalApplications();
        log.info('checkAndSyncAppHashes - Process finished');
      }
    }
    checkAndSyncAppHashesWasEverExecuted = true;
  } catch (error) {
    log.error(error);
    checkAndSyncAppHashesWasEverExecuted = true;
  }
}

async function continuousFluxAppHashesCheck(force = false) {
  try {
    if (continuousFluxAppHashesCheckRunning) {
      return;
    }
    log.info('Requesting missing Flux App messages');
    continuousFluxAppHashesCheckRunning = true;
    const numberOfPeers = fluxNetworkHelper.getNumberOfPeers();
    if (numberOfPeers < 12) {
      log.info('Not enough connected peers to request missing Flux App messages');
      continuousFluxAppHashesCheckRunning = false;
      return;
    }

    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      continuousFluxAppHashesCheckRunning = false;
      return;
    }

    if (firstContinuousFluxAppHashesCheckRun && !checkAndSyncAppHashesWasEverExecuted) {
      await checkAndSyncAppHashes();
    }

    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const queryHeight = { generalScannedHeight: { $gte: 0 } };
    const projectionHeight = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const scanHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, queryHeight, projectionHeight);
    if (!scanHeight) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(scanHeight.generalScannedHeight);

    // get flux app hashes that do not have a message;
    const query = { message: false };
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        hash: 1,
        height: 1,
        value: 1,
        message: 1,
        messageNotFound: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    // sort it by height, so we request oldest messages first
    results.sort((a, b) => a.height - b.height);
    let appsMessagesMissing = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const result of results) {
      if (!result.messageNotFound || force || firstContinuousFluxAppHashesCheckRun) { // most likely wrong data, if no message found. This attribute is cleaned every reconstructAppMessagesHashPeriod blocks so all nodes search again for missing messages
        let heightDifference = explorerHeight - result.height;
        if (heightDifference < 0) {
          heightDifference = 0;
        }
        let maturity = Math.round(heightDifference / config.fluxapps.blocksLasting);
        if (maturity > 12) {
          maturity = 16; // maturity of max 16 representing its older than 1 year. Old messages will only be searched 3 times, newer messages more oftenly
        }
        if (invalidMessages.find((message) => message.hash === result.hash && message.txid === result.txid)) {
          if (!force) {
            maturity = 30; // do not request known invalid messages.
          }
        }
        // every config.fluxapps.blocksLasting increment maturity by 2;
        let numberOfSearches = maturity;
        if (hashesNumberOfSearchs.has(result.hash)) {
          numberOfSearches = hashesNumberOfSearchs.get(result.hash) + 2; // max 10 tries
        }
        hashesNumberOfSearchs.set(result.hash, numberOfSearches);
        log.info(`Requesting missing Flux App message: ${result.hash}, ${result.txid}, ${result.height}`);
        if (numberOfSearches <= 20) { // up to 10 searches
          const appMessageInformation = {
            hash: result.hash,
            txid: result.txid,
            height: result.height,
            value: result.value,
          };
          appsMessagesMissing.push(appMessageInformation);
          if (appsMessagesMissing.length === 500) {
            log.info('Requesting 500 app messages');
            checkAndRequestMultipleApps(appsMessagesMissing);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(2 * 60 * 1000); // delay 2 minutes to give enough time to process all messages received
            appsMessagesMissing = [];
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          await appHashHasMessageNotFound(result.hash); // mark message as not found
          hashesNumberOfSearchs.delete(result.hash); // remove from our map
        }
      }
    }
    if (appsMessagesMissing.length > 0) {
      log.info(`Requesting ${appsMessagesMissing.length} app messages`);
      checkAndRequestMultipleApps(appsMessagesMissing);
    }
    continuousFluxAppHashesCheckRunning = false;
    firstContinuousFluxAppHashesCheckRun = false;
  } catch (error) {
    log.error(error);
    continuousFluxAppHashesCheckRunning = false;
    firstContinuousFluxAppHashesCheckRun = false;
  }
}

/**
 * To manually request app message over api
 * @param {req} req api request
 * @param {res} res api response
 */
async function triggerAppHashesCheckAPI(req, res) {
  try {
    // only flux team and node owner can do this
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    continuousFluxAppHashesCheck(true);
    const resultsResponse = messageHelper.createSuccessMessage('Running check on missing application messages ');
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get app hashes.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppHashes(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        hash: 1,
        height: 1,
        value: 1,
        message: 1,
        messageNotFound: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, appsHashesCollection, query, projection);
    const resultsResponse = messageHelper.createDataMessage(results);
    return res ? res.json(resultsResponse) : resultsResponse;
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
 * To get all global app names.
 * @param {array} proj Array of wanted projection to get, If not submitted, all fields.
 * @returns {string[]} Array of app specifications or an empty array if an error is caught.
 */
async function getAllGlobalApplications(proj = []) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    const query = {};
    const wantedProjection = {
      _id: 0,
    };
    proj.forEach((field) => {
      wantedProjection[field] = 1;
    });
    const projection = { projection: wantedProjection, sort: { height: 1 } }; // ensure sort from oldest to newest
    const results = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection);
    return results;
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * To get app specifications for a specific global app.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationGlobalSpecifications(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  const dbAppSpec = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);

  // This is abusing the spec formatter. It's not meant for this. This whole thing
  // is kind of broken. The reason we have to use the spec formatter here is the
  // frontend is passing properties as strings (then stringify the whole object)
  // the frontend should parse the strings up front, and just pass an encrypted,
  // stringified object.
  //
  // Will fix this in v9 specs. Move to model based specs with pre sorted keys.
  let appSpec = await checkAndDecryptAppSpecs(dbAppSpec);
  if (appSpec && appSpec.version >= 8 && appSpec.enterprise) {
    const { height, hash } = appSpec;
    appSpec = specificationFormatter(appSpec);
    appSpec.height = height;
    appSpec.hash = hash;
  }
  return appSpec;
}

/**
 * To get app specifications for a specific local app.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationLocalSpecifications(appName) {
  const allApps = await availableApps();
  const appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  return appInfo;
}

/**
 * To get app specifications for a specific app if global/local status is unkown. First searches global apps and if not found then searches local apps.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getApplicationSpecifications(appName) {
  // appSpecs: {
  //   version: 2,
  //   name: 'FoldingAtHomeB',
  //   description: 'Folding @ Home is cool :)',
  //   repotag: 'yurinnick/folding-at-home:latest',
  //   owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
  //   ports: '[30001]', // []
  //   containerPorts: '[7396]', // []
  //   domains: '[""]', // []
  //   enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
  //   commands: '["--allow","0/0","--web-allow","0/0"]', // []
  //   containerData: '/config',
  //   cpu: 0.5,
  //   ram: 500,
  //   hdd: 5,
  //   tiered: true,
  //   cpubasic: 0.5,
  //   rambasic: 500,
  //   hddbasic: 5,
  //   cpusuper: 1,
  //   ramsuper: 1000,
  //   hddsuper: 5,
  //   cpubamf: 2,
  //   rambamf: 2000,
  //   hddbamf: 5,
  //   hash: hash of message that has these paramenters,
  //   height: height containing the message
  // };
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (!appInfo) {
    const allApps = await availableApps();
    appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  }

  // This is abusing the spec formatter. It's not meant for this. This whole thing
  // is kind of broken. The reason we have to use the spec formatter here is the
  // frontend is passing properties as strings (then stringify the whole object)
  // the frontend should parse the strings up front, and just pass an encrypted,
  // stringified object.
  //
  // Will fix this in v9 specs. Move to model based specs with pre sorted keys.
  appInfo = await checkAndDecryptAppSpecs(appInfo);
  if (appInfo && appInfo.version >= 8 && appInfo.enterprise) {
    const { height, hash } = appInfo;
    appInfo = specificationFormatter(appInfo);
    appInfo.height = height;
    appInfo.hash = hash;
  }
  return appInfo;
}

/**
 * To get app specifications for a specific app (case sensitive) if global/local status is unkown. First searches global apps and if not found then searches local apps.
 * @param {string} appName App name.
 * @returns {object} Document with app info.
 */
async function getStrictApplicationSpecifications(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: appName };
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appInfo = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (!appInfo) {
    const allApps = await availableApps();
    appInfo = allApps.find((app) => app.name === appName);
  }

  // we don't need the height here, but just to keep things the same, we add it
  appInfo = await checkAndDecryptAppSpecs(appInfo);
  if (appInfo && appInfo.version >= 8 && appInfo.enterprise) {
    const { height, hash } = appInfo;
    appInfo = specificationFormatter(appInfo);
    appInfo.height = height;
    appInfo.hash = hash;
  }
  return appInfo;
}

/**
 * To get app specifications for a specific app (global or local) via API. If it's
 * a v8+ app, can request the specs with the original encryption, or reencrypted with
 * a session key provided by the client in the Enterprise-Key header. If the client
 * is flux support, we allow a partial decryption of the app specs.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>}
 */
async function getApplicationSpecificationAPI(req, res) {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    const { data: { height: daemonHeight } } = syncStatus;

    let { appname, decrypt } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Application Name specified');
    }

    // query params take precedence over params (they were set explictly)
    decrypt = req.query.decrypt || decrypt;

    const specifications = await getApplicationSpecifications(appname);
    const mainAppName = appname.split('_')[1] || appname;

    if (!specifications) {
      throw new Error('Application not found');
    }

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    if (!decrypt) {
      if (isEnterprise) {
        specifications.compose = [];
        specifications.contacts = [];
      }

      const specResponse = messageHelper.createDataMessage(specifications);
      res.json(specResponse);
      return null;
    }

    if (!isEnterprise) {
      throw new Error('App spec decryption is only possible for version 8+ Apps.');
    }

    const encryptedEnterpriseKey = req.headers['enterprise-key'];
    if (!encryptedEnterpriseKey) {
      throw new Error('Header with enterpriseKey is mandatory for enterprise Apps.');
    }

    const ownerAuthorized = await verificationHelper.verifyPrivilege(
      'appowner',
      req,
      mainAppName,
    );

    const fluxTeamAuthorized = ownerAuthorized === true
      ? false
      : await verificationHelper.verifyPrivilege(
        'appownerabove',
        req,
        mainAppName,
      );

    if (ownerAuthorized !== true && fluxTeamAuthorized !== true) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return null;
    }

    if (fluxTeamAuthorized) {
      specifications.compose.forEach((component) => {
        const comp = component;
        comp.environmentParameters = [];
        comp.repoauth = '';
      });
    }

    // this seems a bit weird, but the client can ask for the specs encrypted or decrypted.
    // If decrypted, they pass us another session key and we use that to encrypt.
    specifications.enterprise = await encryptEnterpriseFromSession(
      specifications,
      daemonHeight,
      encryptedEnterpriseKey,
    );

    specifications.contacts = [];
    specifications.compose = [];

    const specResponse = messageHelper.createDataMessage(specifications);
    res.json(specResponse);
  } catch (error) {
    log.error(error);

    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );

    res.json(errorResponse);
  }

  return null;
}

/**
 * To update specifications to the latest version. (This is futureproofed, i.e.
 * clients can update from 8 to 8+, by passing encryption key)
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 */
async function updateApplicationSpecificationAPI(req, res) {
  try {
    const { appname } = req.params;
    if (!appname) {
      throw new Error('appname parameter is mandatory');
    }

    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      throw new Error('Daemon not yet synced.');
    }

    const { data: { daemonHeight } } = syncStatus;

    const specifications = await getApplicationSpecifications(appname);
    if (!specifications) {
      throw new Error('Application not found');
    }

    const mainAppName = appname.split('_')[1] || appname;

    const isEnterprise = Boolean(
      specifications.version >= 8 && specifications.enterprise,
    );

    let encryptedEnterpriseKey = null;
    if (isEnterprise) {
      encryptedEnterpriseKey = req.headers['enterprise-key'];
      if (!encryptedEnterpriseKey) {
        throw new Error('Header with enterpriseKey is mandatory for enterprise Apps.');
      }
    }

    const authorized = await verificationHelper.verifyPrivilege(
      'appownerabove',
      req,
      mainAppName,
    );

    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return null;
    }

    const updatedSpecs = updateToLatestAppSpecifications(specifications);

    if (isEnterprise) {
      const enterprise = await encryptEnterpriseFromSession(
        updatedSpecs,
        daemonHeight,
        encryptedEnterpriseKey,
      );

      updatedSpecs.enterprise = enterprise;
      updatedSpecs.contact = [];
      updatedSpecs.compose = [];
    }

    const specResponse = messageHelper.createDataMessage(updatedSpecs);
    res.json(specResponse);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
  return null;
}

/**
 * To get app owner for a specific app (global or local) via API.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getApplicationOwnerAPI(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Application Name specified');
    }
    const owner = await serviceHelper.getApplicationOwner(appname);
    if (!owner) {
      throw new Error('Application not found');
    }
    const ownerResponse = messageHelper.createDataMessage(owner);
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
 * To get app original owner for a specific app (global or local) via API.
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

async function trySpawningGlobalApplication() {
  try {
    // how do we continue with this function?
    // we have globalapplication specifics list
    // check if we are synced
    const synced = await generalService.checkSynced();
    if (synced !== true) {
      log.info('Flux not yet synced');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    if (!checkAndSyncAppHashesWasEverExecuted) {
      log.info('Flux not yet synced');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Global applications will not be installed');
      fluxNodeWasNotConfirmedOnLastCheck = true;
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }

    if (firstExecutionAfterItsSynced === true) {
      log.info('Explorer Synced, checking for expired apps');
      // eslint-disable-next-line no-use-before-define
      await expireGlobalApplications();
      firstExecutionAfterItsSynced = false;
      await getPeerAppsInstallingErrorMessages();
    }

    if (fluxNodeWasAlreadyConfirmed && fluxNodeWasNotConfirmedOnLastCheck) {
      fluxNodeWasNotConfirmedOnLastCheck = false;
      setTimeout(() => {
        // after 125 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
        // 125 minutes should give enough time for node receive currently two times the apprunning messages
        trySpawningGlobalApplication();
      }, 125 * 60 * 1000);
      return;
    }
    fluxNodeWasAlreadyConfirmed = true;

    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (benchmarkResponse.status === 'error') {
      log.info('FluxBench status Error. Global applications will not be installed');
      await serviceHelper.delay(config.fluxapps.installation.delay * 1000);
      trySpawningGlobalApplication();
      return;
    }
    if (benchmarkResponse.data.thunder) {
      log.info('Flux Node is a Fractus Storage Node. Global applications will not be installed');
      await serviceHelper.delay(24 * 3600 * 1000); // check again in one day as changing from and to only requires the restart of flux daemon
      trySpawningGlobalApplication();
      return;
    }

    // get my external IP and check that it is longer than 5 in length.
    let myIP = null;
    if (benchmarkResponse.data.ipaddress) {
      log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
      myIP = benchmarkResponse.data.ipaddress.length > 5 ? benchmarkResponse.data.ipaddress : null;
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }

    // get all the applications list names missing instances
    const pipeline = [
      {
        $lookup: {
          from: 'zelappslocation',
          localField: 'name',
          foreignField: 'name',
          as: 'locations',
        },
      },
      {
        $addFields: {
          actual: { $size: '$locations.name' },
        },
      },
      {
        $match: {
          $expr: { $lt: ['$actual', { $ifNull: ['$instances', 3] }] },
        },
      },
      {
        $project: {
          _id: 0,
          name: '$name',
          actual: '$actual',
          required: '$instances',
          nodes: { $ifNull: ['$nodes', []] },
          geolocation: { $ifNull: ['$geolocation', []] },
          hash: '$hash',
          version: '$version',
          enterprise: '$enterprise',
        },
      },
      { $sort: { name: 1 } },
    ];

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    log.info('trySpawningGlobalApplication - Checking for apps that are missing instances on the network.');
    let globalAppNamesLocation = await dbHelper.aggregateInDatabase(database, globalAppsInformation, pipeline);
    const numberOfGlobalApps = globalAppNamesLocation.length;
    if (!numberOfGlobalApps) {
      log.info('No installable application found');
      await serviceHelper.delay(30 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }
    log.info(`trySpawningGlobalApplication - Found ${numberOfGlobalApps} apps that are missing instances on the network.`);

    let appToRun = null;
    let appToRunAux = null;
    let minInstances = null;
    let appHash = null;
    let appFromAppsToBeCheckedLater = false;
    let appFromAppsSyncthingToBeCheckedLater = false;
    const appIndex = appsToBeCheckedLater.findIndex((app) => app.timeToCheck >= Date.now());
    const appSyncthingIndex = appsSyncthingToBeCheckedLater.findIndex((app) => app.timeToCheck >= Date.now());
    let runningAppList = [];
    let installingAppList = [];
    if (appIndex >= 0) {
      appToRun = appsToBeCheckedLater[appIndex].appName;
      appHash = appsToBeCheckedLater[appIndex].hash;
      minInstances = appsToBeCheckedLater[appIndex].required;
      appsToBeCheckedLater.splice(appIndex, 1);
      appFromAppsToBeCheckedLater = true;
    } else if (appSyncthingIndex >= 0) {
      appToRun = appsSyncthingToBeCheckedLater[appSyncthingIndex].appName;
      appHash = appsSyncthingToBeCheckedLater[appSyncthingIndex].hash;
      minInstances = appsSyncthingToBeCheckedLater[appSyncthingIndex].required;
      appsSyncthingToBeCheckedLater.splice(appSyncthingIndex, 1);
      appFromAppsSyncthingToBeCheckedLater = true;
    } else {
      const myNodeLocation = nodeFullGeolocation();

      const runningApps = await listRunningApps();
      if (runningApps.status !== 'success') {
        throw new Error('trySpawningGlobalApplication - Unable to check running apps on this Flux');
      }

      // filter apps that failed to install before
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => !runningApps.data.find((appsRunning) => appsRunning.Names[0].slice(5) === app.name)
      && !spawnErrorsLongerAppCache.has(app.hash)
      && !trySpawningGlobalAppCache.has(app.hash)
      && !appsToBeCheckedLater.includes((appAux) => appAux.appName === app.name));
      // filter apps that are non enterprise or are marked to install on my node
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => app.nodes.length === 0 || app.nodes.find((ip) => ip === myIP) || app.version >= 8);
      // filter apps that dont have geolocation or that are forbidden to spawn on my node geolocation
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('a!c')).length === 0 || !app.geolocation.find((loc) => loc.startsWith('a!c') && `a!c${myNodeLocation}`.startsWith(loc.replace('_NONE', '')))));
      // filter apps that dont have geolocation or have and match my node geolocation
      globalAppNamesLocation = globalAppNamesLocation.filter((app) => (app.geolocation.length === 0 || app.geolocation.filter((loc) => loc.startsWith('ac')).length === 0 || app.geolocation.find((loc) => loc.startsWith('ac') && `ac${myNodeLocation}`.startsWith(loc))));
      if (globalAppNamesLocation.length === 0) {
        log.info('trySpawningGlobalApplication - No app currently to be processed');
        await serviceHelper.delay(30 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
      log.info(`trySpawningGlobalApplication - Found ${globalAppNamesLocation.length} apps that are missing instances on the network and can be selected to try to spawn on my node.`);
      let random = Math.floor(Math.random() * globalAppNamesLocation.length);
      appToRunAux = globalAppNamesLocation[random];
      const filterAppsWithNyNodeIP = globalAppNamesLocation.filter((app) => app.nodes.find((ip) => ip === myIP));
      if (filterAppsWithNyNodeIP.length > 0) {
        random = Math.floor(Math.random() * filterAppsWithNyNodeIP.length);
        appToRunAux = filterAppsWithNyNodeIP[random];
      }

      appToRun = appToRunAux.name;
      appHash = appToRunAux.hash;
      minInstances = appToRunAux.required;

      log.info(`trySpawningGlobalApplication - Application ${appToRun} selected to try to spawn. Reported as been running in ${appToRunAux.actual} instances and ${appToRunAux.required} are required.`);
      runningAppList = await appLocation(appToRun);
      installingAppList = await appInstallingLocation(appToRun);
      if (runningAppList.length + installingAppList.length > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
      if (appToRunAux.enterprise && !isArcane) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} can only install on ArcaneOS`);
        spawnErrorsLongerAppCache.set(appHash, '');
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
    }

    trySpawningGlobalAppCache.set(appHash, '');
    log.info(`trySpawningGlobalApplication - App ${appToRun} hash: ${appHash}`);

    const installingAppErrorsList = await appInstallingErrorsLocation(appToRun);
    if (installingAppErrorsList.find((app) => !app.expireAt && app.hash === appHash)) {
      spawnErrorsLongerAppCache.set(appHash, '');
      throw new Error(`trySpawningGlobalApplication - App ${appToRun} is marked as having errors on app installing errors locations.`);
    }

    runningAppList = await appLocation(appToRun);

    const adjustedIP = myIP.split(':')[0]; // just IP address
    // check if app not running on this device
    if (runningAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already running on this Flux IP`);
      await serviceHelper.delay(30 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }
    if (installingAppList.find((document) => document.ip.includes(adjustedIP))) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is reported as already being installed on this Flux IP`);
      await serviceHelper.delay(30 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    // get app specifications
    const appSpecifications = await getApplicationGlobalSpecifications(appToRun);
    if (!appSpecifications) {
      throw new Error(`trySpawningGlobalApplication - Specifications for application ${appToRun} were not found!`);
    }

    // eslint-disable-next-line no-restricted-syntax
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const appsQuery = {}; // all
    const appsProjection = {
      projection: {
        _id: 0,
        name: 1,
        version: 1,
        repotag: 1,
        compose: 1,
      },
    };
    const apps = await dbHelper.findInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    const appExists = apps.find((app) => app.name === appSpecifications.name);
    if (appExists) { // double checked in installation process.
      log.info(`trySpawningGlobalApplication - Application ${appSpecifications.name} is already installed`);
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    // verify app compliance
    await checkApplicationImagesComplience(appSpecifications).catch((error) => {
      if (error.message !== 'Unable to communicate with Flux Services! Try again later.') {
        spawnErrorsLongerAppCache.set(appHash, '');
      }
      throw error;
    });

    // verify requirements
    await checkAppRequirements(appSpecifications);

    // ensure ports unused
    // appNames on Ip
    const runningAppsIp = await getRunningAppIpList(adjustedIP);
    const runningAppsNames = [];
    runningAppsIp.forEach((app) => {
      runningAppsNames.push(app.name);
    });

    await ensureApplicationPortsNotUsed(appSpecifications, runningAppsNames);

    const appPorts = getAppPorts(appSpecifications);
    // check port is not user blocked
    appPorts.forEach((port) => {
      const isUserBlocked = fluxNetworkHelper.isPortUserBlocked(port);
      if (isUserBlocked) {
        spawnErrorsLongerAppCache.set(appHash, '');
        throw new Error(`trySpawningGlobalApplication - Port ${port} is blocked by user. Installation aborted.`);
      }
    });
    // eslint-disable-next-line no-use-before-define
    const portsPubliclyAvailable = await checkInstallingAppPortAvailable(appPorts);
    if (portsPubliclyAvailable === false) {
      log.error(`trySpawningGlobalApplication - Some of application ports of ${appSpecifications.name} are not available publicly. Installation aborted.`);
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    // double check if app is installed on the number of instances requested
    runningAppList = await appLocation(appToRun);
    installingAppList = await appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    let syncthingApp = false;
    if (appSpecifications.version <= 3) {
      syncthingApp = appSpecifications.containerData.includes('g:') || appSpecifications.containerData.includes('r:') || appSpecifications.containerData.includes('s:');
    } else {
      syncthingApp = appSpecifications.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:') || comp.containerData.includes('s:'));
    }

    if (syncthingApp) {
      const myIpWithoutPort = myIP.split(':')[0];
      const lastIndex = myIpWithoutPort.lastIndexOf('.');
      const secondLastIndex = myIpWithoutPort.substring(0, lastIndex).lastIndexOf('.');
      const sameIpRangeNode = runningAppList.find((location) => location.ip.includes(myIpWithoutPort.substring(0, secondLastIndex)));
      if (sameIpRangeNode) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and it is already spawned on Fluxnode with same ip range`);
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
      if (!appFromAppsToBeCheckedLater && !appFromAppsSyncthingToBeCheckedLater && runningAppList.length < 6) {
        // check if there are connectivity to all nodes
        // eslint-disable-next-line no-restricted-syntax
        for (const node of runningAppList) {
          const ip = node.ip.split(':')[0];
          const port = node.ip.split(':')[1] || '16127';
          // eslint-disable-next-line no-await-in-loop
          const isOpen = await fluxNetworkHelper.isPortOpen(ip, port);
          if (!isOpen) {
            log.info(`trySpawningGlobalApplication - Application ${appToRun} uses syncthing and instance running on ${ip}:${port} is not reachable, possible conenctivity issue, will be installed in 30m if remaining missing instances`);
            const appToCheck = {
              timeToCheck: Date.now() + 0.45 * 60 * 60 * 1000,
              appName: appToRun,
              hash: appHash,
              required: minInstances,
            };
            appsSyncthingToBeCheckedLater.push(appToCheck);
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(5 * 60 * 1000);
            trySpawningGlobalAppCache.delete(appHash);
            trySpawningGlobalApplication();
            return;
          }
        }
      }
    }

    if (!appFromAppsToBeCheckedLater) {
      const tier = await generalService.nodeTier();
      const appHWrequirements = totalAppHWRequirements(appSpecifications, tier);
      let delay = false;
      if (!appToRunAux.enterprise && isArcane) {
        const appToCheck = {
          timeToCheck: Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs not enterprise, will check in around 1h if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length > 0 && !appToRunAux.nodes.find((ip) => ip === myIP)) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.5 * 60 * 60 * 1000 : Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs have target ips, will check in around 0.5h if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.5 * 60 * 60 * 1000 : Date.now() + 1.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around 2h if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'bamf' && appHWrequirements.cpu < 7 && appHWrequirements.ram < 29000 && appHWrequirements.hdd < 370) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.35 * 60 * 60 * 1000 : Date.now() + 1.45 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from nimbus, will check in around 1h30 if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      } else if (appToRunAux.nodes.length === 0 && tier === 'super' && appHWrequirements.cpu < 3 && appHWrequirements.ram < 6000 && appHWrequirements.hdd < 150) {
        const appToCheck = {
          timeToCheck: appToRunAux.enterprise ? Date.now() + 0.2 * 60 * 60 * 1000 : Date.now() + 0.95 * 60 * 60 * 1000,
          appName: appToRun,
          hash: appHash,
          required: minInstances,
        };
        log.info(`trySpawningGlobalApplication - App ${appToRun} specs are from cumulus, will check in around 1h if instances are still missing`);
        appsToBeCheckedLater.push(appToCheck);
        trySpawningGlobalAppCache.delete(appHash);
        delay = true;
      }
      if (delay) {
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
    }

    // ToDo: Move this to global
    const architecture = await systemArchitecture();

    // TODO evaluate later to move to more broad check as image can be shared among multiple apps
    const compositedSpecification = appSpecifications.compose || [appSpecifications]; // use compose array if v4+ OR if not defined its <= 3 do an array of appSpecs.
    // eslint-disable-next-line no-restricted-syntax
    for (const componentToInstall of compositedSpecification) {
      // check image is whitelisted and repotag is available for download
      // eslint-disable-next-line no-await-in-loop
      await verifyRepository(componentToInstall.repotag, { repoauth: componentToInstall.repoauth, architecture }).catch((error) => {
        spawnErrorsLongerAppCache.set(appHash, '');
        throw error;
      });
    }

    // triple check if app is installed on the number of instances requested
    runningAppList = await appLocation(appToRun);
    installingAppList = await appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances.`);
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    // an application was selected and checked that it can run on this node. try to install and run it locally
    // lets broadcast to the network the app is going to be installed on this node, so we don't get lot's of intances installed when it's not needed
    let broadcastedAt = Date.now();
    const newAppInstallingMessage = {
      type: 'fluxappinstalling',
      version: 1,
      name: appSpecifications.name,
      ip: myIP,
      broadcastedAt,
    };

    // store it in local database first
    // eslint-disable-next-line no-await-in-loop, no-use-before-define
    await storeAppInstallingMessage(newAppInstallingMessage);
    // broadcast messages about running apps to all peers
    await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppInstallingMessage);
    await serviceHelper.delay(500);
    await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppInstallingMessage);
    // broadcast messages about running apps to all peers

    await serviceHelper.delay(30 * 1000); // give it time so messages are propagated on the network

    // double check if app is installed in more of the instances requested
    runningAppList = await appLocation(appToRun);
    installingAppList = await appInstallingLocation(appToRun);
    if (runningAppList.length + installingAppList.length > minInstances) {
      installingAppList.sort((a, b) => {
        if (a.broadcastedAt < b.broadcastedAt) {
          return -1;
        }
        if (a.broadcastedAt > b.broadcastedAt) {
          return 1;
        }
        return 0;
      });
      broadcastedAt = Date.now();
      const index = installingAppList.findIndex((x) => x.ip === myIP);
      if (runningAppList.length + index + 1 > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned or being installed on ${runningAppList.length + installingAppList.length} instances, my instance is number ${runningAppList.length + index + 1}`);
        await serviceHelper.delay(5 * 60 * 1000);
        trySpawningGlobalApplication();
        return;
      }
    }

    // install the app
    let registerOk = false;
    try {
      registerOk = await registerAppLocally(appSpecifications, null, null, false); // can throw
    } catch (error) {
      log.error(error);
      registerOk = false;
    }
    if (!registerOk) {
      log.info('trySpawningGlobalApplication - Error on registerAppLocally');
      await serviceHelper.delay(5 * 60 * 1000);
      trySpawningGlobalApplication();
      return;
    }

    await serviceHelper.delay(1 * 60 * 1000); // await 1 minute to give time for messages to be propagated on the network
    // double check if app is installed in more of the instances requested
    runningAppList = await appLocation(appToRun);
    if (runningAppList.length > minInstances) {
      runningAppList.sort((a, b) => {
        if (!a.runningSince && b.runningSince) {
          return -1;
        }
        if (a.runningSince && !b.runningSince) {
          return 1;
        }
        if (a.runningSince < b.runningSince) {
          return -1;
        }
        if (a.runningSince > b.runningSince) {
          return 1;
        }
        return 0;
      });
      const index = runningAppList.findIndex((x) => x.ip === myIP);
      log.info(`trySpawningGlobalApplication - Application ${appToRun} is already spawned on ${runningAppList.length} instances, my instance is number ${index + 1}`);
      if (index + 1 > minInstances) {
        log.info(`trySpawningGlobalApplication - Application ${appToRun} is going to be removed as already passed the instances required.`);
        trySpawningGlobalAppCache.delete(appHash);
        removeAppLocally(appSpecifications.name, null, true, null, true).catch((error) => log.error(error));
      }
    }

    await serviceHelper.delay(30 * 60 * 1000);
    log.info('trySpawningGlobalApplication - Reinitiating possible app installation');
    trySpawningGlobalApplication();
  } catch (error) {
    log.error(error);
    await serviceHelper.delay(5 * 60 * 1000);
    trySpawningGlobalApplication();
  }
}

/**
 * To find and remove expired global applications. Finds applications that are registered on lower height than current height minus default blocksLasting
 * or set by their expire blockheight specification, then deletes them from global database and do potential uninstall.
 * Also adjusted for trial apps
 */
async function expireGlobalApplications() {
  // check if synced
  try {
    // get current height
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const explorerHeight = serviceHelper.ensureNumber(result.generalScannedHeight);
    let minExpirationHeight = explorerHeight - config.fluxapps.newMinBlocksAllowance; // do a pre search in db as every app has to live for at least newMinBlocksAllowance
    if (explorerHeight < config.fluxapps.newMinBlocksAllowanceBlock) {
      minExpirationHeight = explorerHeight - config.fluxapps.minBlocksAllowance; // do a pre search in db as every app has to live for at least minBlocksAllowance
    }
    // get global applications specification that have up to date data
    // find applications that have specifications height lower than minExpirationHeight
    const databaseApps = dbopen.db(config.database.appsglobal.database);
    const queryApps = { height: { $lt: minExpirationHeight } };
    const projectionApps = {
      projection: {
        _id: 0, name: 1, hash: 1, expire: 1, height: 1,
      },
    };
    const results = await dbHelper.findInDatabase(databaseApps, globalAppsInformation, queryApps, projectionApps);
    const appsToExpire = [];
    const defaultExpire = config.fluxapps.blocksLasting; // if expire is not set in specs, use this default value
    results.forEach((appSpecs) => {
      const expireIn = appSpecs.expire || defaultExpire;
      if (appSpecs.height + expireIn < explorerHeight) { // registered/updated on height, expires in expireIn is lower than current height
        appsToExpire.push(appSpecs);
      }
    });
    const appNamesToExpire = appsToExpire.map((res) => res.name);
    // remove appNamesToExpire apps from global database
    // eslint-disable-next-line no-restricted-syntax
    for (const app of appsToExpire) {
      log.info(`Expiring application ${app.name}`);
      const queryDeleteApp = { name: app.name };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.findOneAndDeleteInDatabase(databaseApps, globalAppsInformation, queryDeleteApp, projectionApps);

      const queryDeleteAppErrors = { name: app.name };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.removeDocumentsFromCollection(databaseApps, globalAppsInstallingErrorsLocations, queryDeleteAppErrors);
    }

    // get list of locally installed apps.
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const appsInstalled = installedAppsRes.data;
    // remove any installed app which height is lower (or not present) but is not infinite app
    const appsToRemove = [];
    appsInstalled.forEach((app) => {
      if (appNamesToExpire.includes(app.name)) {
        appsToRemove.push(app);
      } else if (!app.height) {
        appsToRemove.push(app);
      } else if (app.height === 0) {
        // do nothing, forever lasting local app
      } else {
        const expireIn = app.expire || defaultExpire;
        if (app.height + expireIn < explorerHeight) {
          appsToRemove.push(app);
        }
      }
    });
    const appsToRemoveNames = appsToRemove.map((app) => app.name);

    // remove appsToRemoveNames apps from locally running
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appsToRemoveNames) {
      log.warn(`Application ${appName} is expired, removing`);
      // eslint-disable-next-line no-await-in-loop
      await removeAppLocally(appName, null, false, true, true);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(1 * 60 * 1000); // wait for 1 min
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To reconstruct app messages hash collection. Checks if globalAppsMessages has the message or not.
 * @returns {string} Reconstruct success message.
 */
async function reconstructAppMessagesHashCollection() {
  // go through our appsHashesCollection and check if globalAppsMessages truly has the message or not
  const db = dbHelper.databaseConnection();
  const databaseApps = db.db(config.database.appsglobal.database);
  const databaseDaemon = db.db(config.database.daemon.database);
  const query = {};
  const projection = { projection: { _id: 0 } };
  const permanentMessages = await dbHelper.findInDatabase(databaseApps, globalAppsMessages, query, projection);
  const appHashes = await dbHelper.findInDatabase(databaseDaemon, appsHashesCollection, query, projection);
  // eslint-disable-next-line no-restricted-syntax
  for (const appHash of appHashes) {
    const options = {};
    const queryUpdate = {
      hash: appHash.hash,
      txid: appHash.txid,
    };
    const permanentMessageFound = permanentMessages.find((message) => message.hash === appHash.hash);
    if (permanentMessageFound) {
      // update that we have the message
      const update = { $set: { message: true, messageNotFound: false } };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.updateOneInDatabase(databaseDaemon, appsHashesCollection, queryUpdate, update, options);
    } else {
      // update that we do not have the message
      const update = { $set: { message: false, messageNotFound: false } };
      // eslint-disable-next-line no-await-in-loop
      await dbHelper.updateOneInDatabase(databaseDaemon, appsHashesCollection, queryUpdate, update, options);
    }
  }
  return 'Reconstruct success';
}

/**
 * To reconstruct app messages hash collection via API. Checks if globalAppsMessages has the message or not. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reconstructAppMessagesHashCollectionAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized) {
      const result = await reconstructAppMessagesHashCollection();
      const message = messageHelper.createSuccessMessage(result);
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
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
 * Helper function to get app locations from database
 * @param {string} appname Optional app name to filter by
 * @returns {Array} Array of app locations
 */
async function appLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
      runningSince: 1,
      osUptime: 1,
      staticIp: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsLocations, query, projection);
  return results;
}

/**
 * Helper function to get app installing locations from database
 * @param {string} appname Optional app name to filter by
 * @returns {Array} Array of app installing locations
 */
async function appInstallingLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      ip: 1,
      broadcastedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingLocations, query, projection);
  return results;
}

/**
 * Helper function to get app installing errors locations from database
 * @param {string} appname Optional app name to filter by
 * @returns {Array} Array of app installing errors locations
 */
async function appInstallingErrorsLocation(appname) {
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.appsglobal.database);
  let query = {};
  if (appname) {
    query = { name: new RegExp(`^${appname}$`, 'i') }; // case insensitive
  }
  const projection = {
    projection: {
      _id: 0,
      name: 1,
      hash: 1,
      ip: 1,
      error: 1,
      broadcastedAt: 1,
      cachedAt: 1,
      expireAt: 1,
    },
  };
  const results = await dbHelper.findInDatabase(database, globalAppsInstallingErrorsLocations, query, projection);
  return results;
}

/**
 * Helper function to get chain params price updates
 * @returns {Array} Array of price updates
 */
async function getChainParamsPriceUpdates() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.chainparams.database);
    const chainParamsMessagesCollection = config.database.chainparams.collections.chainMessages;
    const query = { version: 'p' };
    const projection = {
      projection: {
        _id: 0,
      },
    };
    const priceMessages = await dbHelper.findInDatabase(database, chainParamsMessagesCollection, query, projection);
    const priceForks = [];
    config.fluxapps.price.forEach((price) => {
      priceForks.push(price);
    });
    priceMessages.forEach((data) => {
      const splittedMess = data.message.split('_');
      if (splittedMess[4]) {
        const dataPoint = {
          height: +data.height,
          cpu: +splittedMess[1],
          ram: +splittedMess[2],
          hdd: +splittedMess[3],
          minPrice: +splittedMess[4],
          port: +splittedMess[5] || 2,
          scope: +splittedMess[6] || 6,
          staticip: +splittedMess[7] || 3,
        };
        priceForks.push(dataPoint);
      }
    });
    priceForks.sort((a, b) => a.height - b.height);
    return priceForks;
  } catch (error) {
    log.error(error);
    return config.fluxapps.price;
  }
}

/**
 * API endpoint to get registration information
 * @param {object} req Request object
 * @param {object} res Response object
 */
function registrationInformation(req, res) {
  try {
    const data = config.fluxapps;
    const response = messageHelper.createDataMessage(data);
    res.json(response);
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
 * API endpoint to get deployment information
 * @param {object} req Request object
 * @param {object} res Response object
 */
async function deploymentInformation(req, res) {
  try {
    // respond with information needed for application deployment regarding specification limitation and prices
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const daemonHeight = syncStatus.data.height;
    let deployAddr = config.fluxapps.address;
    if (daemonHeight >= config.fluxapps.appSpecsEnforcementHeights[6]) {
      deployAddr = config.fluxapps.addressMultisig;
    }
    if (daemonHeight >= config.fluxapps.multisigAddressChange) {
      deployAddr = config.fluxapps.addressMultisigB;
    }
    // search in chainparams db for chainmessages of p version
    const appPrices = await getChainParamsPriceUpdates();
    const { fluxapps: { minPort, maxPort } } = config;
    const information = {
      price: appPrices,
      appSpecsEnforcementHeights: config.fluxapps.appSpecsEnforcementHeights,
      address: deployAddr,
      portMin: minPort,
      portMax: maxPort,
    };
    const response = messageHelper.createDataMessage(information);
    res.json(response);
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
 * API endpoint to get app locations for a specific app
 * @param {object} req Request object
 * @param {object} res Response object
 */
async function getAppsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appLocation(appname);
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
 * API endpoint to get all app locations
 * @param {object} req Request object
 * @param {object} res Response object
 */
async function getAppsLocations(req, res) {
  try {
    const results = await appLocation();
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
 * API endpoint to get app installing location for a specific app
 * @param {object} req Request object
 * @param {object} res Response object
 */
async function getAppInstallingLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appInstallingLocation(appname);
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
 * API endpoint to get all app installing locations
 * @param {object} req Request object
 * @param {object} res Response object
 */
async function getAppsInstallingLocations(req, res) {
  try {
    const results = await appInstallingLocation();
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
 * API endpoint to get app installing errors location for a specific app
 * @param {object} req Request object
 * @param {object} res Response object
 */
async function getAppInstallingErrorsLocation(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    if (!appname) {
      throw new Error('No Flux App name specified');
    }
    const results = await appInstallingErrorsLocation(appname);
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
 * API endpoint to get all app installing errors locations
 * @param {object} req Request object
 * @param {object} res Response object
 */
async function getAppsInstallingErrorsLocations(req, res) {
  try {
    const results = await appInstallingErrorsLocation();
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
 * API endpoint to get public key for app verification
 * @param {object} req Request object
 * @param {object} res Response object
 */
async function getPublicKey(req, res) {
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

      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;
      appSpecification = serviceHelper.ensureObject(appSpecification);

      if (!appSpecification.name) {
        throw new Error('Application name is required');
      }

      const pubKey = await generalService.getPublicKey(appSpecification.name);
      const response = messageHelper.createDataMessage(pubKey);
      res.json(response);
    } catch (error) {
      log.error(error);
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

module.exports = {
  // API endpoints
  registerAppGlobalyApi,
  updateAppGlobalyApi,
  getGlobalAppsSpecifications,
  availableApps,
  getlatestApplicationSpecificationAPI,
  reindexGlobalAppsLocationAPI,
  reindexGlobalAppsInformationAPI,
  rescanGlobalAppsInformationAPI,
  triggerAppHashesCheckAPI,
  getAppHashes,
  getApplicationSpecificationAPI,
  updateApplicationSpecificationAPI,
  getApplicationOwnerAPI,
  getApplicationOriginalOwner,
  reconstructAppMessagesHashCollectionAPI,
  registrationInformation,
  deploymentInformation,
  getAppsLocation,
  getAppsLocations,
  getAppInstallingLocation,
  getAppsInstallingLocations,
  getAppInstallingErrorsLocation,
  getAppsInstallingErrorsLocations,
  getPublicKey,

  // Core functions
  getAllGlobalApplications,
  reindexGlobalAppsInformation,
  rescanGlobalAppsInformation,
  reindexGlobalAppsLocation,
  trySpawningGlobalApplication,
  expireGlobalApplications,
  reconstructAppMessagesHashCollection,
  checkAndSyncAppHashes,
  continuousFluxAppHashesCheck,
  checkAndRequestApp,
  checkAndRequestMultipleApps,
  updateAppSpecifications,
  updateAppSpecsForRescanReindex,

  // Helper functions
  getApplicationGlobalSpecifications,
  getApplicationLocalSpecifications,
  getApplicationSpecifications,
  getStrictApplicationSpecifications,
};
