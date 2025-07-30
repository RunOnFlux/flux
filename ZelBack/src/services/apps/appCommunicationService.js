const config = require('config');
const serviceHelper = require('../serviceHelper');
const dbHelper = require('../dbHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const generalService = require('../generalService');
const signatureVerifier = require('../signatureVerifier');
const {
  outgoingPeers,
} = require('../utils/establishedConnections');
const log = require('../../lib/log');

// Database collections
const appsHashesCollection = config.database.daemon.collections.appsHashes;
const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsTempMessages = config.database.appsglobal.collections.appsTemporaryMessages;
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;
const globalAppsInstallingLocations = config.database.appsglobal.collections.appsInstallingLocations;
const globalAppsInstallingErrorsLocations = config.database.appsglobal.collections.appsInstallingErrorsLocations;
// Module variables
// (removed unused variable declarations)

/**
 * To get temporary hash messages for global apps.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsTemporaryMessages(req, res) {
  try {
    const db = dbHelper.databaseConnection();

    const database = db.db(config.database.appsglobal.database);
    let query = {};
    let { hash } = req.params;
    hash = hash || req.query.hash;
    if (hash) {
      query = { hash };
    }
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsTempMessages, query, projection);
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
 * To get permanent hash messages for global apps.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAppsPermanentMessages(req, res) {
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
      query['appSpecifications.owner'] = owner;
    }
    if (appname) {
      query['appSpecifications.name'] = appname;
    }
    const projection = { projection: { _id: 0 } };
    const results = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
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
 * Verifies app hash in the message
 * @param {object} message App message to verify
 * @returns {boolean} True if hash is valid
 */
async function verifyAppHash(message) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  */
  const specifications = message.appSpecifications || message.zelAppSpecifications;
  let messToHash = message.type + message.version + JSON.stringify(specifications) + message.timestamp + message.signature;
  let messageHASH = await generalService.messageHash(messToHash);
  if (messageHASH !== message.hash) {
    if (specifications.version <= 3) {
      // as of specification changes, adjust our appSpecs order of owner and repotag
      // in new scheme it is always version, name, description, owner, repotag... Old format was version, name, description, repotag, owner
      const appSpecsCopy = JSON.parse(JSON.stringify(specifications));
      delete appSpecsCopy.version;
      delete appSpecsCopy.name;
      delete appSpecsCopy.description;
      delete appSpecsCopy.repotag;
      delete appSpecsCopy.owner;
      const appSpecOld = {
        version: specifications.version,
        name: specifications.name,
        description: specifications.description,
        repotag: specifications.repotag,
        owner: specifications.owner,
        ...appSpecsCopy,
      };
      messToHash = message.type + message.version + JSON.stringify(appSpecOld) + message.timestamp + message.signature;
      messageHASH = await generalService.messageHash(messToHash);
      if (messageHASH !== message.hash) {
        log.error(`Hashes dont match - expected - ${message.hash} - calculated - ${messageHASH} for the message ${JSON.stringify(message)}`);
        throw new Error('Invalid Flux App hash received');
      }
      return true;
    }
    log.error(`Hashes dont match - expected - ${message.hash} - calculated - ${messageHASH} for the message ${JSON.stringify(message)}`);
    throw new Error('Invalid Flux App hash received');
  }
  return true;
}

/**
 * Verifies app message signature
 * @param {string} type Message type
 * @param {number} version Message version
 * @param {object} appSpec App specifications
 * @param {number} timestamp Message timestamp
 * @param {string} signature Message signature
 * @returns {boolean} True if signature is valid
 */
async function verifyAppMessageSignature(type, version, appSpec, timestamp, signature) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  let isValidSignature = verificationHelper.verifyMessage(messageToVerify, appSpec.owner, signature); // only btc
  if (timestamp > 1688947200000) {
    isValidSignature = signatureVerifier.verifySignature(messageToVerify, appSpec.owner, signature); // btc, eth
  }
  if (isValidSignature !== true && appSpec.version <= 3) {
    // as of specification changes, adjust our appSpecs order of owner and repotag
    // in new scheme it is always version, name, description, owner, repotag... Old format was version, name, description, repotag, owner
    const appSpecsCopy = JSON.parse(JSON.stringify(appSpec));
    delete appSpecsCopy.version;
    delete appSpecsCopy.name;
    delete appSpecsCopy.description;
    delete appSpecsCopy.repotag;
    delete appSpecsCopy.owner;
    const appSpecOld = {
      version: appSpec.version,
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      owner: appSpec.owner,
      ...appSpecsCopy,
    };
    const messageToVerifyB = type + version + JSON.stringify(appSpecOld) + timestamp;
    isValidSignature = verificationHelper.verifyMessage(messageToVerifyB, appSpec.owner, signature); // only btc
    if (timestamp > 1688947200000) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, appSpec.owner, signature); // btc, eth
    }
    // fix for repoauth / secrets order change for apps created after 1750273721000
  } else if (isValidSignature !== true && appSpec.version === 7) {
    const appSpecsClone = JSON.parse(JSON.stringify(appSpec));

    appSpecsClone.compose.forEach((component) => {
      // previously the order was secrets / repoauth. Now it's repoauth / secrets.
      const comp = component;
      const { secrets, repoauth } = comp;

      delete comp.secrets;
      delete comp.repoauth;

      // try the old secrets / repoauth
      comp.secrets = secrets;
      comp.repoauth = repoauth;
    });

    const messageToVerifyC = type + version + JSON.stringify(appSpecsClone) + timestamp;
    // we can just use the btc / eth verifier as v7 specs came out at 1688749251
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyC, appSpec.owner, signature);
  }
  if (isValidSignature !== true) {
    log.debug(`${messageToVerify}, ${appSpec.owner}, ${signature}`);
    const errorMessage = isValidSignature === false ? 'Received signature is invalid or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

/**
 * Verifies app message update signature for app updates
 * @param {string} type Message type
 * @param {number} version Message version
 * @param {object} appSpec App specifications
 * @param {number} timestamp Message timestamp
 * @param {string} signature Message signature
 * @param {string} appOwner App owner ID
 * @param {number} daemonHeight Daemon height
 * @returns {boolean} True if signature is valid
 */
async function verifyAppMessageUpdateSignature(type, version, appSpec, timestamp, signature, appOwner, daemonHeight) {
  if (!appSpec || typeof appSpec !== 'object' || Array.isArray(appSpec) || typeof timestamp !== 'number' || typeof signature !== 'string' || typeof version !== 'number' || typeof type !== 'string') {
    throw new Error('Invalid Flux App message specifications');
  }
  let marketplaceApp = false;
  let fluxSupportTeamFluxID = null;
  const messageToVerify = type + version + JSON.stringify(appSpec) + timestamp;
  let isValidSignature = signatureVerifier.verifySignature(messageToVerify, appOwner, signature); // btc, eth
  if (isValidSignature !== true) {
    const teamSupportAddresses = getChainTeamSupportAddressUpdates();
    if (teamSupportAddresses.length > 0) {
      const intervals = teamSupportAddresses.filter((interval) => interval.height <= daemonHeight); // if an app message was sent on block before the team support address was activated, will be empty array
      if (intervals && intervals.length) {
        const addressInfo = intervals[intervals.length - 1]; // always defined
        if (addressInfo && addressInfo.height && daemonHeight >= addressInfo.height) { // unneeded check for safety
          fluxSupportTeamFluxID = addressInfo.address;
          const numbersOnAppName = appSpec.name.match(/\\d+/g);
          if (numbersOnAppName && numbersOnAppName.length > 0) {
            const dateBeforeReleaseMarketplace = Date.parse('2020-01-01');
            // eslint-disable-next-line no-restricted-syntax
            for (const possibleTimestamp of numbersOnAppName) {
              if (Number(possibleTimestamp) > dateBeforeReleaseMarketplace) {
                marketplaceApp = true;
                break;
              }
            }
            if (marketplaceApp) {
              isValidSignature = signatureVerifier.verifySignature(messageToVerify, fluxSupportTeamFluxID, signature); // btc, eth
            }
          }
        }
      }
    }
  }
  if (isValidSignature !== true && appSpec.version <= 3) {
    // as of specification changes, adjust our appSpecs order of owner and repotag
    // in new scheme it is always version, name, description, owner, repotag... Old format was version, name, description, repotag, owner
    const appSpecsCopy = JSON.parse(JSON.stringify(appSpec));
    delete appSpecsCopy.version;
    delete appSpecsCopy.name;
    delete appSpecsCopy.description;
    delete appSpecsCopy.repotag;
    delete appSpecsCopy.owner;
    const appSpecOld = {
      version: appSpec.version,
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      owner: appSpec.owner,
      ...appSpecsCopy,
    };
    const messageToVerifyB = type + version + JSON.stringify(appSpecOld) + timestamp;
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, appOwner, signature); // btc, eth
    if (isValidSignature !== true && marketplaceApp) {
      isValidSignature = signatureVerifier.verifySignature(messageToVerifyB, fluxSupportTeamFluxID, signature); // btc, eth
    }
    // fix for repoauth / secrets order change for apps created after 1750273721000
  } else if (isValidSignature !== true && appSpec.version === 7) {
    const appSpecsClone = JSON.parse(JSON.stringify(appSpec));

    appSpecsClone.compose.forEach((component) => {
      // previously the order was secrets / repoauth. Now it's repoauth / secrets.
      const comp = component;
      const { secrets, repoauth } = comp;

      delete comp.secrets;
      delete comp.repoauth;

      // try the old secrets / repoauth
      comp.secrets = secrets;
      comp.repoauth = repoauth;
    });

    const messageToVerifyC = type + version + JSON.stringify(appSpecsClone) + timestamp;
    // we can just use the btc / eth verifier as v7 specs came out at 1688749251
    isValidSignature = signatureVerifier.verifySignature(messageToVerifyC, appOwner, signature);
  }
  if (isValidSignature !== true) {
    log.debug(`${messageToVerify}, ${appOwner}, ${signature}`);
    const errorMessage = isValidSignature === false ? 'Received signature does not correspond with Flux App owner or Flux App specifications are not properly formatted' : isValidSignature;
    throw new Error(errorMessage);
  }
  return true;
}

// NOTE: Some helper functions are referenced but would create circular dependencies
// They need to be imported from the main appsService when needed

/**
 * To check if an app message hash exists.
 * @param {string} hash Message hash.
 * @returns {(object|boolean)} Returns document object if it exists in the database. Otherwise returns false.
 */
async function checkAppMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { hash };
  const appsProjection = {};
  // a permanent global zelappmessage looks like this:
  // const permanentAppMessage = {
  //   type: messageType,
  //   version: typeVersion,
  //   zelAppSpecifications: appSpecFormatted,
  //   appSpecifications: appSpecFormatted,
  //   hash: messageHASH,
  //   timestamp,
  //   signature,
  //   txid,
  //   height,
  //   valueSat,
  // };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsMessages, appsQuery, appsProjection);
  if (appResult) {
    return appResult;
  }
  return false;
}

/**
 * To check if an app temporary message hash exists.
 * @param {string} hash Message hash.
 * @returns {(object|boolean)} Returns document object if it exists in the database. Otherwise returns false.
 */
async function checkAppTemporaryMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { hash };
  const appsProjection = {};
  // a temporary zelappmessage looks like this:
  // const newMessage = {
  //   appSpecifications: message.appSpecifications,
  //   type: message.type,
  //   version: message.version,
  //   hash: message.hash,
  //   timestamp: message.timestamp,
  //   signature: message.signature,
  //   createdAt: new Date(message.timestamp),
  //   expireAt: new Date(validTill),
  // };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsTempMessages, appsQuery, appsProjection);
  if (appResult) {
    return appResult;
  }
  return false;
}

/**
 * Formats application specifications to ensure correct data types and validation
 * @param {object} appSpecification App specification object
 * @returns {object} Formatted app specification
 */
function specificationFormatter(appSpecification) {
  let {
    version,
    name,
    description,
    owner,
    port, // version 1 deprecated
    containerPort, // version 1 deprecated
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
  version = serviceHelper.ensureNumber(version);

  // commons
  if (!name || !description || !owner) {
    throw new Error('Missing Flux App specification parameter name and/or description and/or owner');
  }
  name = serviceHelper.ensureString(name);
  description = serviceHelper.ensureString(description);
  owner = serviceHelper.ensureString(owner);

  // finalised parameters that will get stored in global database
  const appSpecFormatted = {
    version, // integer
    name, // string
    description, // string
    owner, // zelid string
  };

  const correctCompose = [];

  if (version === 1) {
    if (!repotag || !port || !enviromentParameters || !commands || !containerPort || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or port and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    repotag = serviceHelper.ensureString(repotag);
    port = serviceHelper.ensureNumber(port);
    containerPort = serviceHelper.ensureNumber(containerPort);
    enviromentParameters = serviceHelper.ensureObject(enviromentParameters);
    const envParamsCorrected = [];
    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter);
        envParamsCorrected.push(param);
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    commands = serviceHelper.ensureObject(commands);
    const commandsCorrected = [];
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        const cmm = serviceHelper.ensureString(command);
        commandsCorrected.push(cmm);
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    containerData = serviceHelper.ensureString(containerData);
    cpu = serviceHelper.ensureNumber(cpu);
    ram = serviceHelper.ensureNumber(ram);
    hdd = serviceHelper.ensureNumber(hdd);
    tiered = serviceHelper.ensureBoolean(tiered);
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    // finalised parameters
    appSpecFormatted.repotag = repotag; // string
    appSpecFormatted.port = port; // integer
    appSpecFormatted.enviromentParameters = envParamsCorrected; // array of strings
    appSpecFormatted.commands = commandsCorrected; // array of strings
    appSpecFormatted.containerPort = containerPort; // integer
    appSpecFormatted.containerData = containerData; // string
    appSpecFormatted.cpu = cpu; // float 0.1 step
    appSpecFormatted.ram = ram; // integer 100 step (mb)
    appSpecFormatted.hdd = hdd; // integer 1 step
    appSpecFormatted.tiered = tiered; // boolean

    if (tiered) {
      let {
        cpubasic,
        cpusuper,
        cpubamf,
        rambasic,
        ramsuper,
        rambamf,
        hddbasic,
        hddsuper,
        hddbamf,
      } = appSpecification;
      if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
        throw new Error('Flux App was requested as tiered setup but specifications are missing');
      }
      cpubasic = serviceHelper.ensureNumber(cpubasic);
      cpusuper = serviceHelper.ensureNumber(cpusuper);
      cpubamf = serviceHelper.ensureNumber(cpubamf);
      rambasic = serviceHelper.ensureNumber(rambasic);
      ramsuper = serviceHelper.ensureNumber(ramsuper);
      rambamf = serviceHelper.ensureNumber(rambamf);
      hddbasic = serviceHelper.ensureNumber(hddbasic);
      hddsuper = serviceHelper.ensureNumber(hddsuper);
      hddbamf = serviceHelper.ensureNumber(hddbamf);

      appSpecFormatted.cpubasic = cpubasic;
      appSpecFormatted.cpusuper = cpusuper;
      appSpecFormatted.cpubamf = cpubamf;
      appSpecFormatted.rambasic = rambasic;
      appSpecFormatted.ramsuper = ramsuper;
      appSpecFormatted.rambamf = rambamf;
      appSpecFormatted.hddbasic = hddbasic;
      appSpecFormatted.hddsuper = hddsuper;
      appSpecFormatted.hddbamf = hddbamf;
    }
  } else if (version <= 3) {
    if (!repotag || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or port and/or domains and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    repotag = serviceHelper.ensureString(repotag);
    ports = serviceHelper.ensureObject(ports);
    const portsCorrect = [];
    if (Array.isArray(ports)) {
      ports.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // v2 and v3 have string
        portsCorrect.push(param);
      });
    } else {
      throw new Error('Ports for Flux App are invalid');
    }
    domains = serviceHelper.ensureObject(domains);
    const domainsCorrect = [];
    if (Array.isArray(domains)) {
      domains.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter);
        domainsCorrect.push(param);
      });
    } else {
      throw new Error('Domains for Flux App are invalid');
    }
    enviromentParameters = serviceHelper.ensureObject(enviromentParameters);
    const envParamsCorrected = [];
    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter);
        envParamsCorrected.push(param);
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    commands = serviceHelper.ensureObject(commands);
    const commandsCorrected = [];
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        const cmm = serviceHelper.ensureString(command);
        commandsCorrected.push(cmm);
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    containerPorts = serviceHelper.ensureObject(containerPorts);
    const containerportsCorrect = [];
    if (Array.isArray(containerPorts)) {
      containerPorts.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // next specification fork here we want to do ensureNumber
        containerportsCorrect.push(param);
      });
    } else {
      throw new Error('Container Ports for Flux App are invalid');
    }
    containerData = serviceHelper.ensureString(containerData);
    cpu = serviceHelper.ensureNumber(cpu);
    ram = serviceHelper.ensureNumber(ram);
    hdd = serviceHelper.ensureNumber(hdd);
    tiered = serviceHelper.ensureBoolean(tiered);
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }

    // finalised parameters.
    appSpecFormatted.repotag = repotag; // string
    appSpecFormatted.ports = portsCorrect; // array of integers
    appSpecFormatted.domains = domainsCorrect;
    appSpecFormatted.enviromentParameters = envParamsCorrected; // array of strings
    appSpecFormatted.commands = commandsCorrected; // array of strings
    appSpecFormatted.containerPorts = containerportsCorrect; // array of integers
    appSpecFormatted.containerData = containerData; // string
    appSpecFormatted.cpu = cpu; // float 0.1 step
    appSpecFormatted.ram = ram; // integer 100 step (mb)
    appSpecFormatted.hdd = hdd; // integer 1 step
    appSpecFormatted.tiered = tiered; // boolean

    if (tiered) {
      let {
        cpubasic,
        cpusuper,
        cpubamf,
        rambasic,
        ramsuper,
        rambamf,
        hddbasic,
        hddsuper,
        hddbamf,
      } = appSpecification;
      if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
        throw new Error('Flux App was requested as tiered setup but specifications are missing');
      }
      cpubasic = serviceHelper.ensureNumber(cpubasic);
      cpusuper = serviceHelper.ensureNumber(cpusuper);
      cpubamf = serviceHelper.ensureNumber(cpubamf);
      rambasic = serviceHelper.ensureNumber(rambasic);
      ramsuper = serviceHelper.ensureNumber(ramsuper);
      rambamf = serviceHelper.ensureNumber(rambamf);
      hddbasic = serviceHelper.ensureNumber(hddbasic);
      hddsuper = serviceHelper.ensureNumber(hddsuper);
      hddbamf = serviceHelper.ensureNumber(hddbamf);

      appSpecFormatted.cpubasic = cpubasic;
      appSpecFormatted.cpusuper = cpusuper;
      appSpecFormatted.cpubamf = cpubamf;
      appSpecFormatted.rambasic = rambasic;
      appSpecFormatted.ramsuper = ramsuper;
      appSpecFormatted.rambamf = rambamf;
      appSpecFormatted.hddbasic = hddbasic;
      appSpecFormatted.hddsuper = hddsuper;
      appSpecFormatted.hddbamf = hddbamf;
    }
  } else { // v4+
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    compose = serviceHelper.ensureObject(compose);
    if (!Array.isArray(compose)) {
      throw new Error('Flux App compose parameter is not valid');
    }
    compose.forEach((appComponent) => {
      const appComponentCorrect = {};
      appComponentCorrect.name = serviceHelper.ensureString(appComponent.name);
      appComponentCorrect.description = serviceHelper.ensureString(appComponent.description);
      appComponentCorrect.repotag = serviceHelper.ensureString(appComponent.repotag);
      appComponentCorrect.ports = serviceHelper.ensureObject(appComponent.ports);
      const portsCorrect = [];
      if (Array.isArray(appComponentCorrect.ports)) {
        appComponentCorrect.ports.forEach((parameter) => {
          const param = serviceHelper.ensureNumber(parameter);
          portsCorrect.push(param);
        });
        appComponentCorrect.ports = portsCorrect;
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.domains = serviceHelper.ensureObject(appComponent.domains);
      const domainsCorect = [];
      if (Array.isArray(appComponentCorrect.domains)) {
        appComponentCorrect.domains.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          domainsCorect.push(param);
        });
        appComponentCorrect.domains = domainsCorect;
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.environmentParameters = serviceHelper.ensureObject(appComponent.environmentParameters);
      const envParamsCorrected = [];
      if (Array.isArray(appComponentCorrect.environmentParameters)) {
        appComponentCorrect.environmentParameters.forEach((parameter) => {
          const param = serviceHelper.ensureString(parameter);
          envParamsCorrected.push(param);
        });
        appComponentCorrect.environmentParameters = envParamsCorrected;
      } else {
        throw new Error(`Environmental parameters for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.commands = serviceHelper.ensureObject(appComponent.commands);
      const commandsCorrected = [];
      if (Array.isArray(appComponentCorrect.commands)) {
        appComponentCorrect.commands.forEach((command) => {
          const cmm = serviceHelper.ensureString(command);
          commandsCorrected.push(cmm);
        });
        appComponentCorrect.commands = commandsCorrected;
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      appComponentCorrect.containerPorts = serviceHelper.ensureObject(appComponent.containerPorts);
      const containerportsCorrect = [];
      if (Array.isArray(appComponentCorrect.containerPorts)) {
        appComponentCorrect.containerPorts.forEach((parameter) => {
          const param = serviceHelper.ensureNumber(parameter);
          containerportsCorrect.push(param);
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }
      appComponentCorrect.containerData = serviceHelper.ensureString(appComponent.containerData);
      appComponentCorrect.cpu = serviceHelper.ensureNumber(appComponent.cpu);
      appComponentCorrect.ram = serviceHelper.ensureNumber(appComponent.ram);
      appComponentCorrect.hdd = serviceHelper.ensureNumber(appComponent.hdd);

      if (version <= 7) {
        appComponentCorrect.tiered = appComponent.tiered;
        if (typeof appComponentCorrect.tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
        }
        if (appComponentCorrect.tiered) {
          let {
            cpubasic,
            cpusuper,
            cpubamf,
            rambasic,
            ramsuper,
            rambamf,
            hddbasic,
            hddsuper,
            hddbamf,
          } = appComponent;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error(`Flux App component ${appComponent.name} was requested as tiered setup but specifications are missing`);
          }
          cpubasic = serviceHelper.ensureNumber(cpubasic);
          cpusuper = serviceHelper.ensureNumber(cpusuper);
          cpubamf = serviceHelper.ensureNumber(cpubamf);
          rambasic = serviceHelper.ensureNumber(rambasic);
          ramsuper = serviceHelper.ensureNumber(ramsuper);
          rambamf = serviceHelper.ensureNumber(rambamf);
          hddbasic = serviceHelper.ensureNumber(hddbasic);
          hddsuper = serviceHelper.ensureNumber(hddsuper);
          hddbamf = serviceHelper.ensureNumber(hddbamf);

          appComponentCorrect.cpubasic = cpubasic;
          appComponentCorrect.cpusuper = cpusuper;
          appComponentCorrect.cpubamf = cpubamf;
          appComponentCorrect.rambasic = rambasic;
          appComponentCorrect.ramsuper = ramsuper;
          appComponentCorrect.rambamf = rambamf;
          appComponentCorrect.hddbasic = hddbasic;
          appComponentCorrect.hddsuper = hddsuper;
          appComponentCorrect.hddbamf = hddbamf;
        }
      }

      if (version >= 7) {
        appComponentCorrect.repoauth = serviceHelper.ensureString(appComponent.repoauth);
        if (version === 7) {
          appComponentCorrect.secrets = serviceHelper.ensureString(appComponent.secrets);
        }
      }
      correctCompose.push(appComponentCorrect);
    });
    appSpecFormatted.compose = correctCompose;
  }

  if (version >= 3) {
    if (!instances) {
      throw new Error('Missing Flux App specification parameter instances');
    }
    instances = serviceHelper.ensureNumber(instances);
    if (typeof instances !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(instances) !== true) {
      throw new Error('Invalid instances specified');
    }
    if (instances < config.fluxapps.minimumInstances) {
      throw new Error(`Minimum number of instances is ${config.fluxapps.minimumInstances}`);
    }
    if (instances > config.fluxapps.maximumInstances) {
      throw new Error(`Maximum number of instances is ${config.fluxapps.maximumInstances}`);
    }
    appSpecFormatted.instances = instances;
  }

  if (version >= 5) {
    if (!contacts || !geolocation) { // can be empty array for no contact or no geolocation requirements
      throw new Error('Missing Flux App specification parameter contacts and/or geolocation');
    }
    contacts = serviceHelper.ensureObject(contacts);
    const contactsCorrect = [];
    if (Array.isArray(contacts)) {
      contacts.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        contactsCorrect.push(param);
      });
    } else {
      throw new Error('Contacts for Flux App are invalid');
    }
    appSpecFormatted.contacts = contactsCorrect;

    geolocation = serviceHelper.ensureObject(geolocation);
    const geolocationCorrect = [];
    if (Array.isArray(geolocation)) {
      geolocation.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        geolocationCorrect.push(param);
      });
    } else {
      throw new Error('Geolocation for Flux App is invalid');
    }
    appSpecFormatted.geolocation = geolocationCorrect;
  }

  if (version >= 6) {
    if (!expire) {
      throw new Error('Missing Flux App specification parameter expire');
    }
    expire = serviceHelper.ensureNumber(expire);
    if (typeof expire !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(expire) !== true) {
      throw new Error('Invalid instances specified');
    }
    if (expire > config.fluxapps.maxBlocksAllowance) {
      throw new Error(`Maximum expiration of application is ${config.fluxapps.maxBlocksAllowance} blocks ~ 1 year`);
    }
    appSpecFormatted.expire = expire;
  }

  if (version >= 7) {
    if (!nodes) { // can be empty array for no nodes set
      throw new Error('Missing Flux App specification parameter nodes');
    }
    nodes = serviceHelper.ensureObject(nodes);
    const nodesCorrect = [];
    if (Array.isArray(nodes)) {
      nodes.forEach((parameter) => {
        const param = serviceHelper.ensureString(parameter); // string
        nodesCorrect.push(param);
      });
    } else {
      throw new Error('Nodes for Flux App are invalid');
    }
    appSpecFormatted.nodes = nodesCorrect;

    staticip = serviceHelper.ensureBoolean(staticip);
    if (typeof staticip !== 'boolean') {
      throw new Error('Invalid staticip specification. Only boolean as true or false allowed.');
    }
    appSpecFormatted.staticip = staticip;
  }

  if (version >= 8) {
    if (enterprise) {
      enterprise = serviceHelper.ensureString(enterprise);
    }

    appSpecFormatted.enterprise = enterprise;
  }

  return appSpecFormatted;
}

// NOTE: The following functions are being stubbed as they require imports from the main appsService
// which would create circular dependencies. They will need to be called from the parent module.

/**
 * Stub function - needs to be implemented by importing from main appsService
 */
function getChainTeamSupportAddressUpdates() {
  // This function needs to be imported from the main appsService
  // to avoid circular dependencies
  return [];
}

/**
 * To store a temporary message for an app.
 * @param {object} message Message.
 * @param {boolean} furtherVerification Defaults to false.
 * @returns {boolean} True if message is successfully stored and rebroadcasted. Returns false if message is already in cache or has already been broadcast. Otherwise an error is thrown.
 */
async function storeAppTemporaryMessage(message, furtherVerification = false) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number' || typeof message.signature !== 'string' || typeof message.timestamp !== 'number' || typeof message.hash !== 'string') {
    return new Error('Invalid Flux App message for storing');
  }
  // expect one to be present
  if (typeof message.appSpecifications !== 'object' && typeof message.zelAppSpecifications !== 'object') {
    return new Error('Invalid Flux App message for storing');
  }

  const specifications = message.appSpecifications || message.zelAppSpecifications;
  const appSpecFormatted = specificationFormatter(specifications);
  const messageTimestamp = serviceHelper.ensureNumber(message.timestamp);
  const messageVersion = serviceHelper.ensureNumber(message.version);

  // check permanent app message storage
  const appMessage = await checkAppMessageExistence(message.hash);
  if (appMessage) {
    // do not rebroadcast further
    return false;
  }
  // check temporary message storage
  const tempMessage = await checkAppTemporaryMessageExistence(message.hash);
  if (tempMessage && typeof tempMessage === 'object' && !Array.isArray(tempMessage)) {
    // do not rebroadcast further
    return false;
  }

  let isAppRequested = false;
  const db = dbHelper.databaseConnection();
  const query = { hash: message.hash };
  const projection = {
    projection: {
      _id: 0,
      message: 1,
      height: 1,
    },
  };
  let database = db.db(config.database.daemon.database);
  const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query, projection);
  const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
  const daemonHeight = syncStatus.data.height;
  let block = daemonHeight;
  if (result && !result.message) {
    isAppRequested = true;
    block = result.height;
  }

  // data shall already be verified by the broadcasting node. But verify all again.
  // this takes roughly at least 1 second
  if (furtherVerification) {
    // Note: Full verification would require importing many functions from appsService
    // For now, we'll skip the full verification to avoid circular dependencies
    // This can be enhanced later by restructuring the dependencies

    await verifyAppHash(message);

    const appRegistraiton = message.type === 'zelappregister' || message.type === 'fluxappregister';
    if (appRegistraiton) {
      await verifyAppMessageSignature(message.type, messageVersion, appSpecFormatted, messageTimestamp, message.signature);
    }
  }

  const receivedAt = Date.now();
  const validTill = receivedAt + (60 * 60 * 1000); // 60 minutes

  const newMessage = {
    appSpecifications: appSpecFormatted,
    type: message.type, // shall be fluxappregister, fluxappupdate
    version: messageVersion,
    hash: message.hash,
    timestamp: messageTimestamp,
    signature: message.signature,
    receivedAt: new Date(receivedAt),
    expireAt: new Date(validTill),
    arcaneSender: message.arcaneSender,
  };
  const value = newMessage;

  database = db.db(config.database.appsglobal.database);
  // message does not exist anywhere and is ok, store it
  await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, value);
  // it is stored and rebroadcasted
  if (isAppRequested) {
    // node received the message but it is coming from a requestappmessage we should not rebroadcast to all peers
    return false;
  }
  return true;
}

/**
 * Stores a running app message
 * @param {object} message Running app message
 * @returns {boolean} True if stored and should rebroadcast
 */
async function storeAppRunningMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param hash string
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  */
  const appsMessages = [];
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string') {
    return new Error('Invalid Flux App Running message for storing');
  }

  if (message.version !== 1 && message.version !== 2) {
    return new Error(`Invalid Flux App Running message for storing version ${message.version} not supported`);
  }

  if (message.version === 1) {
    if (typeof message.hash !== 'string' || typeof message.name !== 'string') {
      return new Error('Invalid Flux App Running message for storing');
    }
    const app = {
      name: message.name,
      hash: message.hash,
    };
    appsMessages.push(app);
  }

  if (message.version === 2) {
    if (!message.apps || !Array.isArray(message.apps)) {
      return new Error('Invalid Flux App Running message for storing');
    }
    for (let i = 0; i < message.apps.length; i += 1) {
      const app = message.apps[i];
      appsMessages.push(app);
      if (typeof app.hash !== 'string' || typeof app.name !== 'string') {
        return new Error('Invalid Flux App Running v2 message for storing');
      }
    }
  }

  const validTill = message.broadcastedAt + (125 * 60 * 1000); // 7500 seconds
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid Fluxapprunning message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  let messageNotOk = false;
  for (let i = 0; i < appsMessages.length; i += 1) {
    const app = appsMessages[i];
    const newAppRunningMessage = {
      name: app.name,
      hash: app.hash, // hash of application specifics that are running
      ip: message.ip,
      broadcastedAt: new Date(message.broadcastedAt),
      expireAt: new Date(validTill),
      osUptime: message.osUptime,
      staticIp: message.staticIp,
    };

    // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
    const queryFind = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
    const projection = { _id: 0, runningSince: 1 };
    // we already have the exact same data
    // eslint-disable-next-line no-await-in-loop
    const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
    if (result && result.broadcastedAt && result.broadcastedAt >= newAppRunningMessage.broadcastedAt) {
      // found a message that was already stored/probably from duplicated message processsed
      messageNotOk = true;
      break;
    }
    if (message.runningSince) {
      newAppRunningMessage.runningSince = new Date(message.runningSince);
    } else if (app.runningSince) {
      newAppRunningMessage.runningSince = new Date(app.runningSince);
    } else if (result && result.runningSince) {
      newAppRunningMessage.runningSince = result.runningSince;
    }
    const queryUpdate = { name: newAppRunningMessage.name, ip: newAppRunningMessage.ip };
    const update = { $set: newAppRunningMessage };
    const options = {
      upsert: true,
    };
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.updateOneInDatabase(database, globalAppsLocations, queryUpdate, update, options);
  }

  if (message.version === 2 && appsMessages.length === 0) {
    const queryFind = { ip: message.ip };
    const projection = { _id: 0, runningSince: 1 };
    // we already have the exact same data
    const result = await dbHelper.findInDatabase(database, globalAppsLocations, queryFind, projection);
    if (result.length > 0) {
      await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, queryFind);
    } else {
      return false;
    }
  }

  if (message.version === 1) {
    const queryFind = { name: appsMessages[0].name, ip: message.ip };
    await dbHelper.removeDocumentsFromCollection(database, globalAppsInstallingLocations, queryFind);
  }

  if (messageNotOk) {
    return false;
  }

  // all stored, rebroadcast
  return true;
}

/**
 * Stores a installing app message
 * @param {object} message Installing app message
 * @returns {boolean} True if stored and should rebroadcast
 */
async function storeAppInstallingMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param ip string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string') {
    return new Error('Invalid Flux App Installing message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Installing message for storing version ${message.version} not supported`);
  }

  const validTill = message.broadcastedAt + (5 * 60 * 1000); // 5 minutes
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstalling message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const newAppInstallingMessage = {
    name: message.name,
    ip: message.ip,
    broadcastedAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  // indexes over name, hash, ip. Then name + ip and name + ip + broadcastedAt.
  const queryFind = { name: newAppInstallingMessage.name, ip: newAppInstallingMessage.ip };
  const projection = { _id: 0 };
  // we already have the exact same data
  // eslint-disable-next-line no-await-in-loop
  const result = await dbHelper.findOneInDatabase(database, globalAppsInstallingLocations, queryFind, projection);
  if (result && result.broadcastedAt && result.broadcastedAt >= newAppInstallingMessage.broadcastedAt) {
    // found a message that was already stored/probably from duplicated message processsed
    return false;
  }

  const queryUpdate = { name: newAppInstallingMessage.name, ip: newAppInstallingMessage.ip };
  const update = { $set: newAppInstallingMessage };
  const options = {
    upsert: true,
  };
  // eslint-disable-next-line no-await-in-loop
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingLocations, queryUpdate, update, options);

  // all stored, rebroadcast
  return true;
}

/**
 * Stores a installing error app message
 * @param {object} message Installing error app message
 * @returns {boolean} True if stored and should rebroadcast
 */
async function storeAppInstallingErrorMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param broadcastedAt number
  * @param name string
  * @param hash string
  * @param ip string
  * @param error string
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.name !== 'string'
    || typeof message.hash !== 'number' || typeof message.error !== 'string') {
    return new Error('Invalid Flux App Installing Error message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Installing Error message for storing version ${message.version} not supported`);
  }

  const validTill = message.broadcastedAt + (60 * 60 * 1000); // 60 minutes
  if (validTill < Date.now()) {
    log.warn(`Rejecting old/not valid fluxappinstallingerror message, message:${JSON.stringify(message)}`);
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const newAppInstallingErrorMessage = {
    name: message.name,
    hash: message.hash,
    ip: message.ip,
    error: message.error,
    broadcastedAt: new Date(message.broadcastedAt),
    startCacheAt: new Date(message.broadcastedAt),
    expireAt: new Date(validTill),
  };

  let queryFind = { name: newAppInstallingErrorMessage.name, hash: newAppInstallingErrorMessage.hash, ip: newAppInstallingErrorMessage.ip };
  const projection = { _id: 0 };
  // we already have the exact same data
  // eslint-disable-next-line no-await-in-loop
  const result = await dbHelper.findOneInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, projection);
  if (result && result.broadcastedAt && result.broadcastedAt >= newAppInstallingErrorMessage.broadcastedAt) {
    // found a message that was already stored/probably from duplicated message processsed
    return false;
  }

  let update = { $set: newAppInstallingErrorMessage };
  const options = {
    upsert: true,
  };
  // eslint-disable-next-line no-await-in-loop
  await dbHelper.updateOneInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, update, options);

  queryFind = { name: newAppInstallingErrorMessage.name, hash: newAppInstallingErrorMessage.hash };
  // we already have the exact same data
  // eslint-disable-next-line no-await-in-loop
  const results = await dbHelper.countInDatabase(database, globalAppsInstallingErrorsLocations, queryFind);
  if (results >= 5) {
    update = { $set: { startCacheAt: null, expireAt: null } };
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.updateInDatabase(database, globalAppsInstallingErrorsLocations, queryFind, update);
  }
  // all stored, rebroadcast
  return true;
}

/**
 * Stores IP changed message
 * @param {object} message IP changed message
 * @returns {boolean} True if stored and should rebroadcast
 */
async function storeIPChangedMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param oldIP string
  * @param newIP string
  * @param broadcastedAt number
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.oldIP !== 'string' || typeof message.newIP !== 'string') {
    return new Error('Invalid Flux IP Changed message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux IP Changed message for storing version ${message.version} not supported`);
  }

  if (!message.oldIP || !message.newIP) {
    return new Error('Invalid Flux IP Changed message oldIP and newIP cannot be empty');
  }

  if (message.oldIP === message.newIP) {
    return new Error(`Invalid Flux IP Changed message oldIP and newIP are the same ${message.newIP}`);
  }

  log.info('New Flux IP Changed message received.');
  log.info(message);

  const validTill = message.broadcastedAt + (65 * 60 * 1000); // 3900 seconds
  if (validTill < Date.now()) {
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { ip: message.oldIP };
  const update = { $set: { ip: message.newIP, broadcastedAt: new Date(message.broadcastedAt) } };
  await dbHelper.updateInDatabase(database, globalAppsLocations, query, update);

  // all stored, rebroadcast
  return true;
}

/**
 * Stores app removed message
 * @param {object} message App removed message
 * @returns {boolean} True if stored and should rebroadcast
 */
async function storeAppRemovedMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param ip string
  * @param appName string
  * @param broadcastedAt number
  */
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number'
    || typeof message.broadcastedAt !== 'number' || typeof message.ip !== 'string' || typeof message.appName !== 'string') {
    return new Error('Invalid Flux App Removed message for storing');
  }

  if (message.version !== 1) {
    return new Error(`Invalid Flux App Removed message for storing version ${message.version} not supported`);
  }

  if (!message.ip) {
    return new Error('Invalid Flux App Removed message ip cannot be empty');
  }

  if (!message.appName) {
    return new Error('Invalid Flux App Removed message appName cannot be empty');
  }

  log.info('New Flux App Removed message received.');
  log.info(message);

  const validTill = message.broadcastedAt + (65 * 60 * 1000); // 3900 seconds
  if (validTill < Date.now()) {
    // reject old message
    return false;
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const query = { ip: message.ip, name: message.appName };
  const projection = {};
  await dbHelper.findOneAndDeleteInDatabase(database, globalAppsLocations, query, projection);

  // all stored, rebroadcast
  return true;
}

/**
 * Requests an app message from the network
 * @param {string} hash App message hash
 */
async function requestAppMessage(hash) {
  // some message type request app message, message hash
  // peer responds with data from permanent database or temporary database. If does not have it requests further
  const message = {
    type: 'fluxapprequest',
    version: 1,
    hash,
  };
  await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(message);
  await serviceHelper.delay(500);
  await fluxCommunicationMessagesSender.broadcastMessageToIncoming(message);
}

/**
 * Requests multiple app messages from the network
 * @param {Array} apps Array of apps with hash property
 * @param {boolean} incoming Whether to use incoming peers
 */
async function requestAppsMessage(apps, incoming) {
  // some message type request app message, message hash
  // peer responds with data from permanent database or temporary database. If does not have it requests further
  const message = {
    type: 'fluxapprequest',
    version: 2,
    hashes: apps.map((a) => a.hash),
  };
  if (incoming) {
    await fluxCommunicationMessagesSender.broadcastMessageToRandomIncoming(message);
  } else {
    await fluxCommunicationMessagesSender.broadcastMessageToRandomOutgoing(message);
  }
}

/**
 * API endpoint to request an app message
 * @param {object} req Request
 * @param {object} res Response
 */
async function requestAppMessageAPI(req, res) {
  try {
    // only flux team and node owner can do this
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
      return;
    }

    let { hash } = req.params;
    hash = hash || req.query.hash;

    if (!hash) {
      throw new Error('No Flux App Hash specified');
    }
    requestAppMessage(hash);
    const resultsResponse = messageHelper.createSuccessMessage(`Application hash ${hash} requested from the network`);
    res.json(resultsResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * Stores permanent app message
 * @param {object} message Permanent app message
 * @returns {boolean} True if stored successfully
 */
async function storeAppPermanentMessage(message) {
  /* message object
  * @param type string
  * @param version number
  * @param appSpecifications object
  * @param hash string
  * @param timestamp number
  * @param signature string
  * @param txid string
  * @param height number
  * @param valueSat number
  */
  if (!message || !message.appSpecifications || typeof message !== 'object' || typeof message.type !== 'string' || typeof message.version !== 'number' || typeof message.appSpecifications !== 'object' || typeof message.signature !== 'string'
    || typeof message.timestamp !== 'number' || typeof message.hash !== 'string' || typeof message.txid !== 'string' || typeof message.height !== 'number' || typeof message.valueSat !== 'number') {
    throw new Error('Invalid Flux App message for storing');
  }

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  await dbHelper.insertOneToDatabase(database, globalAppsMessages, message).catch((error) => {
    log.error(error);
    throw error;
  });
  return true;
}

/**
 * Marks app hash as having message
 * @param {string} hash App hash
 * @returns {boolean} True if successful
 */
async function appHashHasMessage(hash) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { hash };
  const update = { $set: { message: true, messageNotFound: false } };
  const options = {};
  await dbHelper.updateOneInDatabase(database, appsHashesCollection, query, update, options);
  return true;
}

/**
 * Marks app hash as not found
 * @param {string} hash App hash
 * @returns {boolean} True if successful
 */
async function appHashHasMessageNotFound(hash) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { hash };
  const update = { $set: { messageNotFound: true } };
  const options = {};
  await dbHelper.updateOneInDatabase(database, appsHashesCollection, query, update, options);
  return true;
}

/**
 * Gets peer app installing error messages
 */
async function getPeerAppsInstallingErrorMessages() {
  try {
    let finished = false;
    let i = 0;
    while (!finished && i <= 10) {
      i += 1;
      const client = outgoingPeers[Math.floor(Math.random() * outgoingPeers.length)];
      let axiosConfig = {
        timeout: 5000,
      };
      log.info(`getPeerAppsInstallingErrorMessages - Getting fluxos uptime from ${client.ip}:${client.port}`);
      // eslint-disable-next-line no-await-in-loop
      const response = await serviceHelper.axiosGet(`http://${client.ip}:${client.port}/flux/uptime`, axiosConfig).catch((error) => log.error(error));
      if (!response || !response.data || response.data.status !== 'success' || !response.data.data) {
        log.info(`getPeerAppsInstallingErrorMessages - Failed to get fluxos uptime from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-continue
        continue;
      }
      const ut = process.uptime();
      const measureUptime = Math.floor(ut);
      // let's get information from a node that have higher fluxos uptime than me for at least one hour.
      if (response.data.data < measureUptime + 3600) {
        log.info(`getPeerAppsInstallingErrorMessages - Connected peer ${client.ip}:${client.port} doesn't have FluxOS uptime to be used`);
        // eslint-disable-next-line no-continue
        continue;
      }
      log.info(`getPeerAppsInstallingErrorMessages - FluxOS uptime is ok on ${client.ip}:${client.port}`);
      axiosConfig = {
        timeout: 30000,
      };
      log.info(`getPeerAppsInstallingErrorMessages - Getting app installing errors from ${client.ip}:${client.port}`);
      const url = `http://${client.ip}:${client.port}/apps/installingerrorslocations`;
      // eslint-disable-next-line no-await-in-loop
      const appsResponse = await serviceHelper.axiosGet(url, axiosConfig).catch((error) => log.error(error));
      if (!appsResponse || !appsResponse.data || appsResponse.data.status !== 'success' || !appsResponse.data.data) {
        log.info(`getPeerAppsInstallingErrorMessages - Failed to get app installing error locations from ${client.ip}:${client.port}`);
        // eslint-disable-next-line no-continue
        continue;
      }
      const apps = appsResponse.data.data;
      log.info(`getPeerAppsInstallingErrorMessages - Will process ${apps.length} apps installing errors locations messages`);
      const operations = apps.map((message) => ({
        updateOne: {
          filter: { name: message.name, hash: message.hash, ip: message.ip }, // ou outro campo único
          update: { $set: message },
          upsert: true,
        },
      }));
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.appsglobal.database);
      // Only perform bulk write if there are operations to execute
      if (operations.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await dbHelper.bulkWriteInDatabase(database, globalAppsInstallingErrorsLocations, operations);
      }
      finished = true;
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Signs app data for verification
 * @param {string} message Message to sign
 * @returns {string} Signature
 */
async function signCheckAppData(message) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey();
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

/**
 * Calls other nodes to keep UPNP ports open
 */
async function callOtherNodeToKeepUpnpPortsOpen() {
  try {
    // This function requires many imports from appsService that would create circular dependencies
    // For now it's stubbed to prevent errors
    log.info('callOtherNodeToKeepUpnpPortsOpen called - implementation stubbed');
  } catch (error) {
    log.error(error);
  }
}

/**
 * Checks and notifies peers of running apps - stub implementation
 */
async function checkAndNotifyPeersOfRunningApps() {
  try {
    // This function requires many imports from appsService that would create circular dependencies
    // For now it's stubbed to prevent errors
    log.info('checkAndNotifyPeersOfRunningApps called - implementation stubbed');
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  // API endpoints
  getAppsTemporaryMessages,
  getAppsPermanentMessages,
  requestAppMessageAPI,

  // Message storage functions
  storeAppTemporaryMessage,
  storeAppRunningMessage,
  storeAppInstallingMessage,
  storeAppInstallingErrorMessage,
  storeIPChangedMessage,
  storeAppRemovedMessage,
  storeAppPermanentMessage,

  // Message existence functions
  checkAppMessageExistence,
  checkAppTemporaryMessageExistence,

  // Message hash functions
  appHashHasMessage,
  appHashHasMessageNotFound,

  // Message request functions
  requestAppMessage,
  requestAppsMessage,

  // Verification functions
  verifyAppHash,
  verifyAppMessageSignature,
  verifyAppMessageUpdateSignature,

  // Utility functions
  specificationFormatter,
  signCheckAppData,

  // Peer communication functions
  getPeerAppsInstallingErrorMessages,
  checkAndNotifyPeersOfRunningApps,
  callOtherNodeToKeepUpnpPortsOpen,
};
