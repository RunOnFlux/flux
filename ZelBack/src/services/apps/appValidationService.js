const config = require('config');
const crypto = require('node:crypto');
const axios = require('axios');
const serviceHelper = require('../serviceHelper');
const dbHelper = require('../dbHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const dockerService = require('../dockerService');
const generalService = require('../generalService');
const pgpService = require('../pgpService');
const signatureVerifier = require('../signatureVerifier');
const imageVerifier = require('../utils/imageVerifier');
const log = require('../../lib/log');
const cacheManager = require('../utils/cacheManager').default;

const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsInformation = config.database.appsglobal.collections.appsInformation;

const myLongCache = cacheManager.appPriceBlockedRepoCache;
const supportedArchitectures = ['amd64', 'arm64'];

// Cache for user blocked repositories
let cacheUserBlockedRepos;

// Helper function to get team support address updates - extracted from appsService.js
function getChainTeamSupportAddressUpdates() {
  return config.fluxapps.fluxTeamZelId.map((addr) => ({ address: addr, height: 0 }));
}

/**
 * To check if a node's hardware is suitable for running the assigned app.
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if no errors are thrown.
 */
function checkHWParameters(appSpecs) {
  // check specs parameters. JS precision
  if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
    throw new Error(`CPU badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || appSpecs.ram < 100) {
    throw new Error(`RAM badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || appSpecs.hdd < 1) {
    throw new Error(`SSD badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.tiered) {
    if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
      throw new Error(`CPU for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram) || appSpecs.rambasic < 100) {
      throw new Error(`RAM for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
      throw new Error(`SSD for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
      throw new Error(`CPU for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
      throw new Error(`RAM for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
      throw new Error(`SSD for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
      throw new Error(`CPU for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || appSpecs.rambamf < 100) {
      throw new Error(`RAM for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
      throw new Error(`SSD for Stratus badly assigned for ${appSpecs.name}`);
    }
  }
  return true;
}

/**
 * To check if a node's hardware is suitable for running the assigned Docker Compose app. Advises if too much resources being assigned to an app.
 * @param {object} appSpecsComposed App specifications composed.
 * @returns {boolean} True if no errors are thrown.
 */
function checkComposeHWParameters(appSpecsComposed) {
  // calculate total HW assigned
  let totalCpu = 0;
  let totalRam = 0;
  let totalHdd = 0;
  let totalCpuBasic = 0;
  let totalCpuSuper = 0;
  let totalCpuBamf = 0;
  let totalRamBasic = 0;
  let totalRamSuper = 0;
  let totalRamBamf = 0;
  let totalHddBasic = 0;
  let totalHddSuper = 0;
  let totalHddBamf = 0;
  const isTiered = appSpecsComposed.compose.find((appComponent) => appComponent.tiered === true);
  appSpecsComposed.compose.forEach((appComponent) => {
    if (isTiered) {
      totalCpuBamf += ((appComponent.cpubamf || appComponent.cpu) * 10);
      totalRamBamf += appComponent.rambamf || appComponent.ram;
      totalHddBamf += appComponent.hddbamf || appComponent.hdd;
      totalCpuSuper += ((appComponent.cpusuper || appComponent.cpu) * 10);
      totalRamSuper += appComponent.ramsuper || appComponent.ram;
      totalHddSuper += appComponent.hddsuper || appComponent.hdd;
      totalCpuBasic += ((appComponent.cpubasic || appComponent.cpu) * 10);
      totalRamBasic += appComponent.rambasic || appComponent.ram;
      totalHddBasic += appComponent.hddbasic || appComponent.hdd;
    } else {
      totalCpu += (appComponent.cpu * 10);
      totalRam += appComponent.ram;
      totalHdd += appComponent.hdd;
    }
  });
  // check specs parameters. JS precision
  if (totalCpu > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu)) {
    throw new Error(`Too much CPU resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalRam > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram)) {
    throw new Error(`Too much RAM resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalHdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd)) {
    throw new Error(`Too much SSD resources assigned for ${appSpecsComposed.name}`);
  }
  if (isTiered) {
    if (totalCpuBasic > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuSuper > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamSuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddSuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuBamf > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
  }
  return true;
}

/**
 * To verify an app hash message.
 * @param {object} message Message.
 * @returns {boolean} True if no error is thrown.
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
 * To verify an app message signature.
 * @param {string} type Type.
 * @param {number} version Version.
 * @param {object} appSpec App specifications.
 * @param {number} timestamp Time stamp.
 * @param {string} signature Signature.
 * @returns {Promise<boolean>} True if no error is thrown.
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
 * To verify an app message signature update.
 * @param {string} type Type.
 * @param {number} version Version.
 * @param {object} appSpec App specifications.
 * @param {number} timestamp Time stamp.
 * @param {string} signature Signature.
 * @param {string} appOwner App owner.
 * @param {number} daemonHeight Daemon height.
 * @returns {boolean} True if no errors are thrown.
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
          const numbersOnAppName = appSpec.name.match(/\d+/g);
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

/**
 * Checks that the supplied Docker Image Tag is in the Flux Whitelist, if auth is provided,
 * that it is in the correct format, and verifies that the image can run on the Flux network,
 * and that it can run on this specific node (architecture match). Throws if requirements not met.
 * @param {string} repotag The Docker Image Tag
 * @param {{repoauth?:string, skipVerification?:boolean, architecture:string}} options
 * @returns {Promise<void>}
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
 * Check secrets, if they are being used return exception
 * @param {string} appName App name.
 * @param {object} appComponentSpecs App specifications.
 * @param {string} appOwner owner Id of the app.
 */
async function checkAppSecrets(appName, appComponentSpecs, appOwner) {
  // Normalize PGP secrets string
  const normalizePGP = (pgpMessage) => {
    if (!pgpMessage) return '';
    return pgpMessage.replace(/\s+/g, '').replace(/\\n/g, '').trim();
  };

  const appComponentSecrets = normalizePGP(appComponentSpecs.secrets);

  // Database connection
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = { projection: { _id: 0 } };
  // Query permanent app messages
  const appsQuery = {
    $and: [
      { 'appSpecifications.version': 7 },
      { 'appSpecifications.nodes': { $exists: true, $ne: [] } },
    ],
  };

  const permanentAppMessages = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);

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
}

/**
 * To check compliance of app images (including images for each component if a Docker Compose app). Checks Flux OS's GitHub repository for list of blocked Docker Hub/Github/Google repositories.
 * @param {object} appSpecs App specifications.
 * @returns {Promise<boolean>} True if no errors are thrown.
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

  // blacklist works also for zelid and app hash
  if (pureImagesOrOrganisationsRepos.includes(appSpecs.hash)) {
    throw new Error(`${appSpecs.hash} is not allowed to be spawned`);
  }
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
 * To check if application image is part of blocked repositories
 * @param {object} appSpecs App specifications.
 * @returns {boolean, string} False if blocked, String of reason if yes
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
        isBlocked = `Image ${image} is blocked. Application ${appSpecs.name} connot be spawned.`;
      }
    });
    organisations.forEach((org) => {
      if (pureImagesOrOrganisationsRepos.includes(org)) {
        isBlocked = `Organisation ${org} is blocked. Application ${appSpecs.name} connot be spawned.`;
      }
    });
  }

  if (!isBlocked && userBlockedRepos) {
    log.info(`userBlockedRepos: ${JSON.stringify(userBlockedRepos)}`);
    organisations.forEach((org) => {
      if (userBlockedRepos.includes(org.toLowerCase())) {
        isBlocked = `Organisation ${org} is user blocked. Application ${appSpecs.name} connot be spawned.`;
      }
    });
    if (!isBlocked) {
      images.forEach((image) => {
        if (userBlockedRepos.includes(image.toLowerCase())) {
          isBlocked = `Image ${image} is user blocked. Application ${appSpecs.name} connot be spawned.`;
        }
      });
    }
  }

  return isBlocked;
}

/**
 * To verify correctness of attribute values within an app specification object. Checks for types and that required attributes exist.
 * @param {object} appSpecification App specifications.
 * @returns {boolean} True if no errors are thrown.
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

  // commons
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

  if (version === 1) {
    if (!port || !containerPort) {
      throw new Error('Missing Flux App specification parameter port and/or containerPort');
    }
  } else if (version >= 2 && version <= 3) {
    if (!ports || !domains || !containerPorts) {
      throw new Error('Missing Flux App specification parameter port and/or containerPort and/or domains');
    }
  }

  if (version === 1) {
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    if (typeof port !== 'number') {
      throw new Error('Port for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(port, 0)) {
      throw new Error('Ports for Flux App are invalid decimals');
    }

    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Environmental parameters for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        if (typeof command !== 'string') {
          throw new Error('Flux App commands are invalid');
        }
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    if (typeof containerPort !== 'number') {
      throw new Error('Container Port for Flux App is invalid');
    }
    if (!serviceHelper.isDecimalLimit(containerPort, 0)) {
      throw new Error('Ports for Flux App are invalid decimals');
    }
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    if (typeof cpu !== 'number' || typeof hdd !== 'number' || typeof ram !== 'number') {
      throw new Error('Invalid HW specifications');
    }
    if (!serviceHelper.isDecimalLimit(cpu) || !serviceHelper.isDecimalLimit(hdd) || !serviceHelper.isDecimalLimit(ram)) {
      throw new Error('Invalid HW specifications decimal limits');
    }

    if (tiered) {
      const {
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
      if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
        || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
        || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
        throw new Error('Invalid tiered HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
        || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
        || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
        throw new Error('Invalid tiered HW specifications');
      }
    }
  } else if (version <= 3) {
    if (!repotag || !enviromentParameters || !commands || !containerData || !cpu || !ram || !hdd) {
      throw new Error('Missing Flux App specification parameter repotag and/or enviromentParameters and/or commands and/or containerData and/or cpu and/or ram and/or hdd');
    }

    if (Array.isArray(ports)) {
      ports.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Port of Flux App is invalid');
        }
        if (!serviceHelper.isDecimalLimit(parameter, 0)) {
          throw new Error('Ports for Flux App are invalid decimals');
        }
      });
    } else {
      throw new Error('Ports for Flux App are invalid');
    }
    if (Array.isArray(domains)) {
      domains.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Domains for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Domains for Flux App are invalid');
    }
    if (Array.isArray(enviromentParameters)) {
      enviromentParameters.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Environmental parameters for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Environmental parameters for Flux App are invalid');
    }
    if (Array.isArray(commands)) {
      commands.forEach((command) => {
        if (typeof command !== 'string') {
          throw new Error('Flux App commands are invalid');
        }
      });
    } else {
      throw new Error('Flux App commands are invalid');
    }
    if (Array.isArray(containerPorts)) {
      containerPorts.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Container Port of Flux App is invalid');
        }
        if (!serviceHelper.isDecimalLimit(parameter, 0)) {
          throw new Error('Container Ports for Flux App are invalid decimals');
        }
      });
    } else {
      throw new Error('Container Ports for Flux App are invalid');
    }
    if (typeof tiered !== 'boolean') {
      throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
    }
    if (typeof cpu !== 'number' || typeof hdd !== 'number' || typeof ram !== 'number') {
      throw new Error('Invalid HW specifications');
    }
    if (!serviceHelper.isDecimalLimit(cpu) || !serviceHelper.isDecimalLimit(hdd) || !serviceHelper.isDecimalLimit(ram)) {
      throw new Error('Invalid HW specifications decimal limits');
    }

    if (tiered) {
      const {
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
      if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
        || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
        || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
        throw new Error('Invalid tiered HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
        || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
        || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
        throw new Error('Invalid tiered HW specifications');
      }
    }
  } else if (version <= 7) { // v4 to v7
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    if (typeof compose !== 'object') {
      throw new Error('Invalid Flux App Specifications');
    }
    if (!Array.isArray(compose)) {
      throw new Error('Invalid Flux App Specifications');
    }
    compose.forEach((appComponent) => {
      if (Array.isArray(appComponent)) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent.name !== 'string') {
        throw new Error('Invalid Flux App component name');
      }
      if (typeof appComponent.description !== 'string') {
        throw new Error(`Invalid Flux App component ${appComponent.name} description`);
      }
      if (Array.isArray(appComponent.ports)) {
        appComponent.ports.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.domains)) {
        appComponent.domains.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.environmentParameters)) {
        appComponent.environmentParameters.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.commands)) {
        appComponent.commands.forEach((command) => {
          if (typeof command !== 'string') {
            throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
          }
        });
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      if (Array.isArray(appComponent.containerPorts)) {
        appComponent.containerPorts.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (typeof appComponent.tiered !== 'boolean') {
        throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
      }
      const cpuB = appComponent.cpu;
      const ramB = appComponent.ram;
      const hddB = appComponent.hdd;
      if (typeof cpuB !== 'number' || typeof ramB !== 'number' || typeof hddB !== 'number') {
        throw new Error('Invalid HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpuB) || !serviceHelper.isDecimalLimit(ramB) || !serviceHelper.isDecimalLimit(hddB)) {
        throw new Error('Invalid HW specifications decimal limits');
      }
      if (appComponent.tiered) {
        const {
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
        if (typeof cpubasic !== 'number' || typeof cpusuper !== 'number' || typeof cpubamf !== 'number'
          || typeof rambasic !== 'number' || typeof ramsuper !== 'number' || typeof rambamf !== 'number'
          || typeof hddbasic !== 'number' || typeof hddsuper !== 'number' || typeof hddbamf !== 'number') {
          throw new Error('Invalid tiered HW specifications');
        }
        if (!serviceHelper.isDecimalLimit(cpubasic) || !serviceHelper.isDecimalLimit(cpusuper) || !serviceHelper.isDecimalLimit(cpubamf)
          || !serviceHelper.isDecimalLimit(rambasic) || !serviceHelper.isDecimalLimit(ramsuper) || !serviceHelper.isDecimalLimit(rambamf)
          || !serviceHelper.isDecimalLimit(hddbasic) || !serviceHelper.isDecimalLimit(hddsuper) || !serviceHelper.isDecimalLimit(hddbamf)) {
          throw new Error('Invalid tiered HW specifications');
        }
      }

      if (version === 7) {
        if (typeof appComponent.secrets !== 'string') {
          throw new Error(`Secrets for Flux App component ${appComponent.name} are invalid`);
        }

        if (typeof appComponent.repoauth !== 'string') {
          throw new Error(`Repository Authentication for Flux App component ${appComponent.name} are invalid`);
        }
      }
    });
  } else { // v8+
    if (enterprise === null || enterprise === undefined) { // enterprise can be false or a encrypted string with a object with contacts and components
      throw new Error('Missing enterprise property');
    }
    if (!enterprise && nodes && nodes.length > 0) {
      throw new Error('Nodes can only be used in enterprise apps');
    }
    if (!compose) {
      throw new Error('Missing Flux App specification parameter compose');
    }
    if (typeof compose !== 'object') {
      throw new Error('Invalid Flux App Specifications');
    }
    if (!Array.isArray(compose)) {
      throw new Error('Invalid Flux App Specifications');
    }
    compose.forEach((appComponent) => {
      if (Array.isArray(appComponent)) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent.name !== 'string') {
        throw new Error('Invalid Flux App component name');
      }
      if (typeof appComponent.description !== 'string') {
        throw new Error(`Invalid Flux App component ${appComponent.name} description`);
      }
      if (Array.isArray(appComponent.ports)) {
        appComponent.ports.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Ports for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.domains)) {
        appComponent.domains.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Domains for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.environmentParameters)) {
        appComponent.environmentParameters.forEach((parameter) => {
          if (typeof parameter !== 'string') {
            throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
          }
        });
      } else {
        throw new Error(`Environment parameters for Flux App component ${appComponent.name} are invalid`);
      }
      if (Array.isArray(appComponent.commands)) {
        appComponent.commands.forEach((command) => {
          if (typeof command !== 'string') {
            throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
          }
        });
      } else {
        throw new Error(`Flux App component ${appComponent.name} commands are invalid`);
      }
      if (Array.isArray(appComponent.containerPorts)) {
        appComponent.containerPorts.forEach((parameter) => {
          if (typeof parameter !== 'number') {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
          }
          if (!serviceHelper.isDecimalLimit(parameter, 0)) {
            throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid decimals`);
          }
        });
      } else {
        throw new Error(`Container Ports for Flux App component ${appComponent.name} are invalid`);
      }

      const cpuB = appComponent.cpu;
      const ramB = appComponent.ram;
      const hddB = appComponent.hdd;
      if (typeof cpuB !== 'number' || typeof ramB !== 'number' || typeof hddB !== 'number') {
        throw new Error('Invalid HW specifications');
      }
      if (!serviceHelper.isDecimalLimit(cpuB) || !serviceHelper.isDecimalLimit(ramB) || !serviceHelper.isDecimalLimit(hddB)) {
        throw new Error('Invalid HW specifications decimal limits');
      }

      if (typeof appComponent.repoauth !== 'string') {
        throw new Error(`Repository Authentication for Flux App component ${appComponent.name} are invalid`);
      }
    });
  }

  if (version >= 3) {
    if (!instances) {
      throw new Error('Missing Flux App specification parameter instances');
    }
    if (typeof instances !== 'number') {
      throw new Error('Invalid instances specification');
    }
    if (Number.isInteger(instances) !== true) {
      throw new Error('Invalid instances specified');
    }
    if (!serviceHelper.isDecimalLimit(instances, 0)) {
      throw new Error('Invalid instances specified');
    }
  }

  if (version >= 5) {
    if (Array.isArray(contacts)) {
      contacts.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Contacts for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Contacts for Flux App are invalid');
    }
    if (Array.isArray(geolocation)) {
      geolocation.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Geolocation for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Geolocation for Flux App are invalid');
    }
  }

  if (version >= 6) {
    if (!expire) {
      throw new Error('Missing Flux App specification parameter expire');
    }
    if (typeof expire !== 'number') {
      throw new Error('Invalid expire specification');
    }
    if (Number.isInteger(expire) !== true) {
      throw new Error('Invalid expire specified');
    }
    if (!serviceHelper.isDecimalLimit(expire, 0)) {
      throw new Error('Invalid expire specified');
    }
  }

  if (version >= 7) {
    if (!nodes) {
      throw new Error('Missing Flux App specification parameter nodes');
    }
    if (Array.isArray(nodes)) {
      nodes.forEach((parameter) => {
        if (typeof parameter !== 'string') {
          throw new Error('Nodes for Flux App are invalid');
        }
      });
    } else {
      throw new Error('Nodes for Flux App are invalid');
    }

    if (typeof staticip !== 'boolean') {
      throw new Error('Invalid static ip value obtained. Only boolean as true or false allowed.');
    }
  }

  return true;
}

/**
 * To verify correctness of attribute values within an app specification object. Checks for if restrictions of specs are valid.
 * @param {object} appSpecification App specifications.
 * @returns {boolean} True if no errors are thrown.
 */
function verifyRestrictionCorrectnessOfApp(appSpecifications, height) {
  const minPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMin : config.fluxapps.portMinLegacy;
  const maxPort = height >= config.fluxapps.portBlockheightChange ? config.fluxapps.portMax : config.fluxapps.portMaxLegacy;
  if (appSpecifications.version !== 1 && appSpecifications.version !== 2 && appSpecifications.version !== 3 && appSpecifications.version !== 4 && appSpecifications.version !== 5 && appSpecifications.version !== 6 && appSpecifications.version !== 7 && appSpecifications.version !== 8) {
    throw new Error('Flux App message version specification is invalid');
  }
  if (appSpecifications.name.length > 32) {
    throw new Error('Flux App name is too long');
  }
  // furthermore name cannot contain any special character
  if (!appSpecifications.name) {
    throw new Error('Please provide a valid Flux App name');
  }
  if (!appSpecifications.name.match(/^[a-zA-Z0-9]+$/)) {
    throw new Error('Flux App name contains special characters. Only a-z, A-Z and 0-9 are allowed');
  }
  if (appSpecifications.name.startsWith('zel')) {
    throw new Error('Flux App name can not start with zel');
  }
  if (appSpecifications.name.toLowerCase() === 'watchtower') {
    throw new Error('Flux App name is conflicting with another application');
  }
  if (appSpecifications.name.startsWith('flux')) {
    throw new Error('Flux App name can not start with flux');
  }
  if (appSpecifications.description.length > 256) {
    throw new Error('Description is too long. Maximum of 256 characters is allowed');
  }

  if (appSpecifications.version === 1) {
    // check port is within range
    if (appSpecifications.port < minPort || appSpecifications.port > maxPort) {
      throw new Error(`Assigned port ${appSpecifications.port} is not within Flux Apps range ${minPort}-${maxPort}`);
    }
    const iBP = fluxNetworkHelper.isPortBanned(appSpecifications.port);
    if (iBP) {
      throw new Error(`Assigned port ${appSpecifications.port} is not allowed for Flux Apps`);
    }
    // check if containerPort makes sense
    if (appSpecifications.containerPort < 0 || appSpecifications.containerPort > 65535) {
      throw new Error(`Container Port ${appSpecifications.containerPort} is not within system limits 0-65535`);
    }
  } else if (appSpecifications.version <= 3) {
    // check port is within range
    appSpecifications.ports.forEach((port) => {
      if (port < minPort || port > maxPort) {
        throw new Error(`Assigned port ${port} is not within Flux Apps range ${minPort}-${maxPort}`);
      }
      const iBP = fluxNetworkHelper.isPortBanned(port);
      if (iBP) {
        throw new Error(`Assigned port ${port} is not allowed for Flux Apps`);
      }
    });
    // check if containerPort makes sense
    appSpecifications.containerPorts.forEach((port) => {
      if (port < 0 || port > 65535) {
        throw new Error(`Container Port ${port} is not within system limits 0-65535`);
      }
    });
    if (appSpecifications.containerPorts.length !== appSpecifications.ports.length) {
      throw new Error('Ports specifications do not match');
    }
    if (appSpecifications.domains.length !== appSpecifications.ports.length) {
      throw new Error('Domains specifications do not match available ports');
    }
    if (appSpecifications.ports.length > 5) {
      throw new Error('Too many ports defined. Maximum of 5 allowed.');
    }
    appSpecifications.domains.forEach((dom) => {
      if (dom.length > 253) {
        throw new Error(`App ${appSpecifications.name} domain ${dom} is too long. Maximum of 253 characters is allowed`);
      }
    });
  }

  if (appSpecifications.version <= 3) {
    // check wheter shared Folder is not root
    if (appSpecifications.containerData.length < 2) {
      throw new Error('Flux App container data folder not specified. If no data folder is whished, use /tmp');
    }
    if (appSpecifications.containerData.length > 200) {
      throw new Error('Flux App Container Data is too long. Maximum of 200 characters is allowed');
    }
    if (appSpecifications.repotag.length > 200) {
      throw new Error('Flux App Repository is too long. Maximum of 200 characters is allowed.');
    }
    if (appSpecifications.enviromentParameters.length > 20) {
      throw new Error(`App ${appSpecifications.name} environment invalid. Maximum of 20 environment variables allowed.`);
    }
    appSpecifications.enviromentParameters.forEach((env) => {
      if (env.length > 400) {
        throw new Error(`App ${appSpecifications.name} environment ${env} is too long. Maximum of 400 characters is allowed`);
      }
    });
    if (appSpecifications.commands.length > 20) {
      throw new Error(`App ${appSpecifications.name} commands invalid. Maximum of 20 commands allowed.`);
    }
    appSpecifications.commands.forEach((com) => {
      if (com.length > 400) {
        throw new Error(`App ${appSpecifications.name} command ${com} is too long. Maximum of 400 characters is allowed`);
      }
    });
  } else {
    if (appSpecifications.compose.length < 1) {
      throw new Error('Flux App does not contain any composition');
    }
    let maxComponents = 10;
    if (height < config.fluxapps.appSpecsEnforcementHeights[6]) {
      maxComponents = 5;
    }
    if (appSpecifications.compose.length > maxComponents) {
      throw new Error('Flux App has too many components');
    }
    // check port is within range
    const usedNames = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const appComponent of appSpecifications.compose) {
      if (!appComponent) {
        throw new Error('Invalid Flux App Specifications');
      }
      if (typeof appComponent !== 'object') {
        throw new Error('Invalid Flux App Specifications');
      }
      if (!appComponent.name) {
        throw new Error('Please provide a valid Flux App Component name');
      }
      if (appComponent.name.length > 32) {
        throw new Error('Flux App name is too long');
      }
      if (appComponent.name.startsWith('zel')) {
        throw new Error('Flux App Component name can not start with zel');
      }
      if (appComponent.name.startsWith('flux')) {
        throw new Error('Flux App Component name can not start with flux');
      }
      // furthermore name cannot contain any special character
      if (!appComponent.name.match(/^[a-zA-Z0-9]+$/)) {
        throw new Error('Flux App component name contains special characters. Only a-z, A-Z and 0-9 are allowed');
      }
      if (usedNames.includes(appComponent.name)) {
        throw new Error(`Flux App component ${appComponent.name} already assigned. Use different name.`);
      }
      usedNames.push(appComponent.name);
      if (appComponent.description.length > 256) {
        throw new Error('Description is too long. Maximum of 256 characters is allowed.');
      }
      appComponent.ports.forEach((port) => {
        if (port < minPort || port > maxPort) {
          throw new Error(`Assigned port ${port} is not within Flux Apps range ${minPort}-${maxPort}`);
        }
        const iBP = fluxNetworkHelper.isPortBanned(port);
        if (iBP) {
          throw new Error(`Assigned port ${port} is not allowed for Flux Apps`);
        }
      });
      if (appComponent.repotag.length > 200) {
        throw new Error('Flux App Repository is too long. Maximum of 200 characters is allowed.');
      }
      if (appComponent.containerData.length > 200) {
        throw new Error('Flux App Container Data is too long. Maximum of 200 characters is allowed');
      }
      if (appComponent.environmentParameters.length > 20) {
        throw new Error(`App component ${appComponent.name} environment invalid. Maximum of 20 environment variables allowed.`);
      }
      appComponent.environmentParameters.forEach((env) => {
        if (env.length > 400) {
          throw new Error(`App component ${appComponent.name} environment ${env} is too long. Maximum of 400 characters is allowed`);
        }
      });
      if (appComponent.commands.length > 20) {
        throw new Error(`App component ${appComponent.name} commands invalid. Maximum of 20 commands allowed.`);
      }
      appComponent.commands.forEach((com) => {
        if (com.length > 400) {
          throw new Error(`App component ${appComponent.name} command ${com} is too long. Maximum of 400 characters is allowed`);
        }
      });
      appComponent.domains.forEach((dom) => {
        if (dom.length > 253) {
          throw new Error(`App component ${appComponent.name} domain ${dom} is too long. Maximum of 253 characters is allowed`);
        }
      });
      // check if containerPort makes sense
      appComponent.containerPorts.forEach((port) => {
        if (port < 0 || port > 65535) {
          throw new Error(`Container Port ${port} in in ${appComponent.name} is not within system limits 0-65535`);
        }
      });
      if (appComponent.containerPorts.length !== appComponent.ports.length) {
        throw new Error(`Ports specifications in ${appComponent.name} do not match`);
      }
      if (appComponent.domains.length !== appComponent.ports.length) {
        throw new Error(`Domains specifications in ${appComponent.name} do not match available ports`);
      }
      if (appComponent.ports.length > 5) {
        throw new Error(`Too many ports defined in ${appComponent.name}. Maximum of 5 allowed.`);
      }
      // check wheter shared Folder is not root
      if (appComponent.containerData.length < 2) {
        throw new Error(`Flux App container data folder not specified in in ${appComponent.name}. If no data folder is whished, use /tmp`);
      }

      if (appSpecifications.version === 7) {
        if (!appSpecifications.nodes.length) { // this is NOT an enterprise app, no nodes scoping
          if (appComponent.secrets.length) { // pgp encrypted message. Every signature encryption of node is about 100 characters. For 100 selected nodes, this gives ~5k chars limit
            throw new Error('Secrets can not be defined for non Enterprise Applications');
          }
          if (appComponent.repoauth.length) { // pgp encrypted message.
            throw new Error('Private repositories are only allowed for Enterprise Applications');
          }
        } else {
          if (appComponent.secrets.length > 15000) { // pgp encrypted message. Every signature encryption of node is about 100 characters. For 100 selected nodes, this gives ~5k chars limit
            throw new Error('Maximum length of secrets is 15000. Consider uploading to Flux Storage for bigger payload.');
          }
          if (appComponent.repoauth.length > 15000) { // pgp encrypted message.
            throw new Error('Maximum length of repoauth is 15000.');
          }
        }
      }
      if (appSpecifications.version >= 8) {
        if (!appSpecifications.enterpise) { // this is NOT an enterprise app
          if (appComponent.repoauth.length) { // pgp encrypted message.
            throw new Error('Private repositories are only allowed for Enterprise Applications');
          }
        } else if (appComponent.repoauth.length > 15000) { // pgp encrypted message.
          throw new Error('Maximum length of repoauth is 15000.');
        }
      }
    }
  }

  if (appSpecifications.version >= 3) {
    if (appSpecifications.instances < config.fluxapps.minimumInstances) {
      throw new Error(`Minimum number of instances is ${config.fluxapps.minimumInstances}`);
    }
    if (appSpecifications.instances > config.fluxapps.maximumInstances) {
      throw new Error(`Maximum number of instances is ${config.fluxapps.maximumInstances}`);
    }
  }

  if (appSpecifications.version >= 5) {
    if (appSpecifications.contacts.length > 5) {
      throw new Error('Too many contacts defined. Maximum of 5 allowed.');
    }
    appSpecifications.contacts.forEach((contact) => {
      if (contact.length > 75) {
        throw new Error(`Contact ${contact} is too long. Maximum of 75 characters is allowed.`);
      }
    });
    if (appSpecifications.geolocation.length > 10) { // we only expect 2
      throw new Error('Invalid geolocation submited.'); // for now we are only accepting continent and country.
    }
    appSpecifications.geolocation.forEach((geo) => {
      const maxGeoLength = 50;
      if (geo.length > maxGeoLength) { // for now we only treat aXX and bXX as continent and country specs.
        throw new Error(`Geolocation ${geo} is not valid.`); // firt letter for what represents and next two for the code
      }
    });
  }

  if (appSpecifications.version >= 6) {
    if (height < config.fluxapps.newMinBlocksAllowanceBlock) {
      if (appSpecifications.expire < config.fluxapps.minBlocksAllowance) {
        throw new Error(`Minimum expiration of application is ${config.fluxapps.minBlocksAllowance} blocks ~ 1 week`);
      }
    } else if (height < config.fluxapps.cancel1BlockMinBlocksAllowanceBlock) {
      if (appSpecifications.expire < config.fluxapps.newMinBlocksAllowance) {
        throw new Error(`Minimum expiration of application is ${config.fluxapps.newMinBlocksAllowance} blocks ~ 3 hours`);
      }
    } else if (appSpecifications.expire < config.fluxapps.cancel1BlockMinBlocksAllowance) {
      throw new Error(`Minimum expiration of application is ${config.fluxapps.cancel1BlockMinBlocksAllowance} blocks`);
    }
    if (appSpecifications.expire > config.fluxapps.maxBlocksAllowance) {
      throw new Error(`Maximum expiration of application is ${config.fluxapps.maxBlocksAllowance} blocks ~ 1 year`);
    }
    if (height < config.fluxapps.removeBlocksAllowanceIntervalBlock) {
      if (appSpecifications.expire % config.fluxapps.blocksAllowanceInterval !== 0) {
        throw new Error(`Expiration of application has to be a multiple of ${config.fluxapps.blocksAllowanceInterval} blocks ~ 1 day`);
      }
    }
  }

  if (appSpecifications.version >= 7) {
    if (appSpecifications.nodes.length > 120) {
      throw new Error('Maximum number of selecteed nodes is 120');
    }
    appSpecifications.nodes.forEach((node) => {
      if (node.length > 70) { // 64 for txhash, : separator, max 5 for outidx
        throw new Error('Invalid node length');
      }
    });
  }
}

/**
 * To verify correctness of attribute values within an app specification object. Checks if all object keys are assigned and no excess present
 * @param {object} appSpecification App specifications.
 * @returns {boolean} True if no errors are thrown.
 */
function verifyObjectKeysCorrectnessOfApp(appSpecifications) {
  if (appSpecifications.version === 1) {
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
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'port', 'containerPort', 'enviromentParameters', 'commands', 'containerData',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v1 app specifications');
      }
    });
  } else if (appSpecifications.version === 2) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v2 app specifications');
      }
    });
  } else if (appSpecifications.version === 3) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains', 'instances',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v3 app specifications');
      }
    });
  } else if (appSpecifications.version === 4) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v4 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v4 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 5) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v5 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v5 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 6) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v6 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v6 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 7) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire', 'nodes', 'staticip',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains', 'secrets', 'repoauth',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v7 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v7 app specifications');
        }
      });
    });
  } else if (appSpecifications.version === 8) {
    const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts',
      'geolocation', 'expire', 'nodes', 'staticip', 'enterprise',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains', 'repoauth',
      'cpu', 'ram', 'hdd',
    ];
    const specsKeys = Object.keys(appSpecifications);
    specsKeys.forEach((sKey) => {
      if (!specifications.includes((sKey))) {
        throw new Error('Unsupported parameter for v8 app specifications');
      }
    });
    appSpecifications.compose.forEach((appComponent) => {
      const specsKeysComponent = Object.keys(appComponent);
      specsKeysComponent.forEach((sKey) => {
        if (!componentSpecifications.includes((sKey))) {
          throw new Error('Unsupported parameter for v8 app specifications');
        }
      });
    });
  } else {
    throw new Error(`Invalid version specification of ${appSpecifications.version}`);
  }
}

/**
 * To verify app specifications. Checks the attribute values of the appSpecifications object.
 * @param {object} appSpecifications App specifications.
 * @param {number} height Block height.
 * @param {boolean} checkDockerAndWhitelist Defaults to false.
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

  // SPECS VALIDIT TIME
  if (height < config.fluxapps.appSpecsEnforcementHeights[appSpecifications.version]) {
    throw new Error(`Flux apps specifications of version ${appSpecifications.version} not yet supported`);
  }

  // OBJECT KEY CHECKS
  // check for Object.keys in applications. App can have only the fields that are in the version specification.
  verifyObjectKeysCorrectnessOfApp(appSpecifications);

  // PORTS UNIQUE CHECKS
  // verify ports are unique accross app
  ensureAppUniquePorts(appSpecifications);

  // HW Checks
  if (appSpecifications.version <= 3) {
    checkHWParameters(appSpecifications);
  } else {
    checkComposeHWParameters(appSpecifications);
  }

  // Whitelist, repository checks
  if (checkDockerAndWhitelist) {
    // check blacklist
    await checkApplicationImagesComplience(appSpecifications);

    if (appSpecifications.version <= 3) {
      // check repository whitelisted and repotag is available for download
      await verifyRepository(appSpecifications.repotag, { repoauth: appSpecifications.repoauth, skipVerification: true });
    } else {
      // eslint-disable-next-line no-restricted-syntax
      for (const appComponent of appSpecifications.compose) {
        // check repository whitelisted and repotag is available for download
        // eslint-disable-next-line no-await-in-loop
        await verifyRepository(appComponent.repotag, { repoauth: appComponent.repoauth, skipVerification: true });
      }
    }
  }
}

/**
 * To check if app name already registered. App names must be unique.
 * @param {object} appSpecFormatted App specifications.
 * @param {hash} string hash of App specifications.
 * @param {number} timestamp Timestamp of App specifications message.
 * @returns {boolean} True if no errors are thrown.
 */
async function checkApplicationRegistrationNameConflicts(appSpecFormatted, hash) {
  // check if name is not yet registered
  const dbopen = dbHelper.databaseConnection();

  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { name: new RegExp(`^${appSpecFormatted.name}$`, 'i') }; // case insensitive
  const appsProjection = {
    projection: {
      _id: 0,
      name: 1,
      height: 1,
      expire: 1,
    },
  };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsInformation, appsQuery, appsProjection);

  if (appResult) {
    // in this case, check if hash of the message is older than our current app
    if (hash) {
      // check if we have the hash of the app in our db
      const query = { hash };
      const projection = {
        projection: {
          _id: 0,
          txid: 1,
          hash: 1,
          height: 1,
        },
      };
      const database = dbopen.db(config.database.daemon.database);
      const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, query, projection);
      if (!result) {
        throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash not found in collection.`);
      }
      if (appResult.height <= result.height) {
        log.debug(appResult);
        log.debug(result);
        const currentExpiration = appResult.height + (appResult.expire || 22000);
        if (currentExpiration >= result.height) {
          throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name. Hash is not older than our current app.`);
        } else {
          log.warn(`Flux App ${appSpecFormatted.name} active specifications are outdated. Will be cleaned on next expiration`);
        }
      }
    } else {
      throw new Error(`Flux App ${appSpecFormatted.name} already registered. Flux App has to be registered under different name.`);
    }
  }

  const localApps = await availableApps();
  const appExists = localApps.find((localApp) => localApp.name.toLowerCase() === appSpecFormatted.name.toLowerCase());
  if (appExists) {
    throw new Error(`Flux App ${appSpecFormatted.name} already assigned to local application. Flux App has to be registered under different name.`);
  }
  if (appSpecFormatted.name.toLowerCase() === 'share') {
    throw new Error(`Flux App ${appSpecFormatted.name} already assigned to Flux main application. Flux App has to be registered under different name.`);
  }
  return true;
}

/**
 * To check for any conflicts with the latest permenent app registration message and any app update messages.
 * @param {object} specifications App specifications.
 * @param {number} verificationTimestamp Verifiaction time stamp.
 * @returns {Promise<boolean>} True if no errors are thrown.
 */
async function checkApplicationUpdateNameRepositoryConflicts(specifications, verificationTimestamp) {
  // eslint-disable-next-line no-use-before-define
  const appSpecs = await getPreviousAppSpecifications(specifications, verificationTimestamp);
  if (specifications.version >= 4) {
    if (appSpecs.version >= 4) {
      // update and current are both v4 compositions
      // must be same amount of copmositions
      // must be same names
      if (specifications.compose.length !== appSpecs.compose.length) {
        throw new Error(`Flux App ${specifications.name} change of components is not allowed`);
      }
      appSpecs.compose.forEach((appComponent) => {
        const newSpecComponentFound = specifications.compose.find((appComponentNew) => appComponentNew.name === appComponent.name);
        if (!newSpecComponentFound) {
          throw new Error(`Flux App ${specifications.name} change of component name is not allowed`);
        }
        // v4 allows for changes of repotag
      });
    } else { // update is v4+ and current app have v1,2,3
      throw new Error(`Flux App ${specifications.name} on update to different specifications is not possible`);
    }
  } else if (appSpecs.version >= 4) {
    throw new Error(`Flux App ${specifications.name} update to different specifications is not possible`);
  } else { // bot update and current app have v1,2,3
    // eslint-disable-next-line no-lonely-if
    if (appSpecs.repotag !== specifications.repotag) { // v1,2,3 does not allow repotag change
      throw new Error(`Flux App ${specifications.name} update of repotag is not allowed`);
    }
  }
  return true;
}

/**
 * To format app specification object. Checks that all parameters exist and are correct.
 * @param {object} appSpecification App specification.
 * @returns {object} Returns formatted app specification to be stored in global database. Otherwise throws error.
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

/**
 * Decrypts content with aes key
 * @param {string} appName application name.
 * @param {String} base64NonceCiphertextTag base64 encoded encrypted data
 * @param {String} base64AesKey base64 encoded AesKey
 * @returns {any} decrypted data
 */
function decryptWithAesSession(appName, base64NonceCiphertextTag, base64AesKey) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }

  try {
    const key = Buffer.from(base64AesKey, 'base64');
    const nonceCiphertextTag = Buffer.from(base64NonceCiphertextTag, 'base64');

    const nonce = nonceCiphertextTag.subarray(0, 12);
    const ciphertext = nonceCiphertextTag.subarray(12, -16);
    const tag = nonceCiphertextTag.subarray(-16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);

    const decrypted = decipher.update(ciphertext, '', 'utf8') + decipher.final('utf8');

    return decrypted;
  } catch (error) {
    log.error(`Error decrypting ${appName}`);
    throw error;
  }
}

/**
 * Encrypts content with aes key
 * @param {String} appName application name
 * @param {any} dataToEncrypt data to encrypt
 * @param {String} base64AesKey encoded AES key
 * @returns {String} Return base64 encrypted nonce + cyphertext + tag
 */
function encryptWithAesSession(appName, dataToEncrypt, base64AesKey) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  try {
    const key = Buffer.from(base64AesKey, 'base64');
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

    const encryptedStart = cipher.update(dataToEncrypt, 'utf8');
    const encryptedEnd = cipher.final();

    const nonceCyphertextTag = Buffer.concat([
      nonce,
      encryptedStart,
      encryptedEnd,
      cipher.getAuthTag(),
    ]);

    const base64NonceCyphertextTag = nonceCyphertextTag.toString('base64');
    return base64NonceCyphertextTag;
  } catch (error) {
    log.error(`Error encrypting ${appName}`);
    throw error;
  }
}

/**
 * Decrypts aes key
 * @param {string} appName application name.
 * @param {integer} daemonHeight daemon block height.
 * @param {string} owner original owner of the application
 * @param {string} enterpriseKey base64 RSA encrypted AES key used to encrypt enterprise app data
 * @returns {object} Return enterprise object decrypted.
 */
async function decryptAesKeyWithRsaKey(appName, daemonHeight, enterpriseKey, owner = null) {
  const block = daemonHeight;
  let appOwner = owner;

  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  if (!enterpriseKey) {
    throw new Error('enterpriseKey is mandatory for enterprise Apps.');
  }
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appsQuery = null;
  if (!appOwner) {
    log.info(`Searching register permanent messages for ${appName} to get registration message`);
    appsQuery = {
      'appSpecifications.name': appName,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
    appOwner = lastAppRegistration.appSpecifications.owner;
  }
  const inputData = JSON.stringify({
    fluxID: appOwner,
    appName,
    message: enterpriseKey,
    blockHeight: block,
  });
  const dataReturned = await benchmarkService.decryptRSAMessage(inputData);
  const { status, data } = dataReturned;
  if (status === 'success') {
    const dataParsed = JSON.parse(data);
    const base64AesKey = dataParsed.status === 'ok' ? dataParsed.message : null;
    if (base64AesKey) return base64AesKey;

    throw new Error('Error decrypting AES key.');
  } else {
    throw new Error('Error getting decrypted AES key.');
  }
}

/**
 * Decrypts app specs from api request. It is expected that the caller of this
 * endpoint has aes-256-gcm encrypted the app specs with a random aes key,
 * encrypted with the RSA public key received via prior api call.
 *
 * The enterpise field is in this format:
 * base64(rsa encrypted aes key + nonce + aes-256-gcm(base64(json(enterprise specs))) + authTag)
 *
 * We do this so that we don't have to double JSON encode, and we have the
 * nonce + cyphertext + tag all in one entry
 *
 * The enterpriseKey is in this format:
 * base64(rsa(base64(aes key bytes))))
 *
 * We base64 encode the key so that were not passing around raw bytes
 *
 * @param {string} base64Encrypted enterprise encrypted content (decrypted is a JSON string)
 * @param {string} appName application name
 * @param {integer} daemonHeight daemon block height
 * @param {string} owner original owner of the application
 * @returns {Promise<object>} Return enterprise object decrypted.
 */
async function decryptEnterpriseFromSession(base64Encrypted, appName, daemonHeight, owner = null) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }

  const enterpriseBuf = Buffer.from(base64Encrypted, 'base64');
  const aesKeyEncrypted = enterpriseBuf.subarray(0, 256);
  const nonceCiphertextTag = enterpriseBuf.subarray(256);

  // we encode this as we are passing it as an api call
  const base64EncryptedAesKey = aesKeyEncrypted.toString('base64');

  const base64AesKey = await decryptAesKeyWithRsaKey(
    appName,
    daemonHeight,
    base64EncryptedAesKey,
    owner,
  );

  const jsonEnterprise = decryptWithAesSession(
    appName,
    nonceCiphertextTag,
    base64AesKey,
  );

  const decryptedEnterprise = JSON.parse(jsonEnterprise);

  if (decryptedEnterprise) {
    return decryptedEnterprise;
  }
  throw new Error('Error decrypting enterprise object.');
}

/**
 * Decrypts app specs if they are encrypted
 * @param {object} appSpec application specifications.
 * @param {integer} daemonHeight daemon block height.
 * @param {{daemonHeight?: Number, owner?: string}} options daemonHeight - block height  \
 *    owner - the application owner
 * @returns {Promise<object>} Return appSpecs decrypted if it is enterprise.
 */
async function checkAndDecryptAppSpecs(appSpec, options = {}) {
  if (!appSpec || appSpec.version < 8 || !appSpec.enterprise) {
    return appSpec;
  }

  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }

  // move to structuredClone when we are at > nodeJS 17.0.0
  // we do this so we can have a copy of both formatted and decrypted
  const appSpecs = JSON.parse(JSON.stringify(appSpec));

  let daemonHeight = options.daemonHeight || null;
  let appOwner = options.owner || null;

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appsQuery = null;

  if (!appOwner) {
    log.info(`Searching register permanent messages for ${appSpecs.name} to get registration message`);
    appsQuery = {
      'appSpecifications.name': appSpecs.name,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    if (permanentAppMessage.length > 0) {
      const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
      appOwner = lastAppRegistration.owner;
    } else {
      appOwner = appSpec.owner;
    }
  }

  if (!daemonHeight) {
    log.info(`Searching register permanent messages for ${appSpecs.name} to get latest update`);
    appsQuery = {
      'appSpecifications.name': appSpecs.name,
    };
    const allPermanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastUpdate = allPermanentAppMessage[allPermanentAppMessage.length - 1];
    daemonHeight = lastUpdate.height;
  }

  const enterprise = await decryptEnterpriseFromSession(
    appSpecs.enterprise,
    appSpecs.name,
    daemonHeight,
    appSpecs.owner,
  );

  appSpecs.contacts = enterprise.contacts;
  appSpecs.compose = enterprise.compose;

  return appSpecs;
}

/**
 * Encrypts app specs
 * @param {object} enterprise content to be encrypted.
 * @param {string} appName name of the app.
 * @param {integer} daemonHeight daemon block height.
 * @param {string} owner original owner of the application.
 * @returns {Promise<string>} Return enteprise content encrypted.
 */
async function encryptEnterpriseWithAes(enterprise, appName, daemonHeight = null, owner = null) {
  let block = daemonHeight;
  let appOwner = owner;

  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);
  const projection = {
    projection: {
      _id: 0,
    },
  };
  let appsQuery = null;
  if (!appOwner) {
    log.info(`Searching register permanent messages for ${appName} to get registration message`);
    appsQuery = {
      'appSpecifications.name': appName,
      type: 'fluxappregister',
    };
    const permanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastAppRegistration = permanentAppMessage[permanentAppMessage.length - 1];
    appOwner = lastAppRegistration.owner;
  }
  if (!block) {
    log.info(`Searching register permanent messages for ${appName} to get latest update`);
    appsQuery = {
      'appSpecifications.name': appName,
    };
    const allPermanentAppMessage = await dbHelper.findInDatabase(database, globalAppsMessages, appsQuery, projection);
    const lastUpdate = allPermanentAppMessage[allPermanentAppMessage.length - 1];
    block = lastUpdate.height;
  }

  const jsonEnterprise = JSON.stringify(enterprise);
  const base64JsonEnterprise = Buffer.from(jsonEnterprise).toString('base64');

  const inputData = JSON.stringify({
    fluxID: appOwner,
    appName,
    message: base64JsonEnterprise,
    blockHeight: block,
  });
  const dataReturned = await benchmarkService.encryptMessage(inputData);
  const { status, data } = dataReturned;
  if (status === 'success') {
    const dataParsed = JSON.parse(data);
    const newEnterprise = status === 'success' && dataParsed.status === 'ok' ? dataParsed.message : null;
    if (newEnterprise) {
      return newEnterprise;
    }
    throw new Error('Error decrypting applications specifications.');
  } else {
    throw new Error('Error getting public key to encrypt app enterprise content.');
  }
}

/**
 * @param {string} enterpriseKey enterprise key encrypted used to encrypt encrypt enterprise app.
 * @returns {Promise<object>} Return app specs copy with enterprise object encrypted (and sensitive content removed)
 */
async function encryptEnterpriseFromSession(appSpec, daemonHeight, enterpriseKey) {
  if (!isArcane) {
    throw new Error('Application Specifications can only be validated on a node running Arcane OS.');
  }
  if (!enterpriseKey) {
    throw new Error('enterpriseKey is mandatory for enterprise Apps.');
  }

  const appName = appSpec.name;

  const enterpriseSpec = {
    contacts: appSpec.contacts,
    compose: appSpec.compose,
  };

  const encoded = JSON.stringify(enterpriseSpec);

  const base64AesKey = await decryptAesKeyWithRsaKey(appName, daemonHeight, enterpriseKey);
  const encryptedEnterprise = encryptWithAesSession(appSpec.enterprise, encoded, base64AesKey);
  if (encryptedEnterprise) {
    return encryptedEnterprise;
  }
  throw new Error('Error encrypting enterprise object.');
}

/**
 * To get app specifications updated to the latest version of the network.
 * @param {object} appSpec original specifications.
 * @return {object} appSpec update to the latest version.
 */
function updateToLatestAppSpecifications(appSpec) {
  // current latest version is 8
  if (appSpec.version === 1) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'port', 'containerPort', 'enviromentParameters', 'commands', 'containerData',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: [appSpec.port],
      containerPorts: [appSpec.containerPort],
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: 3,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 2) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: appSpec.ports,
      containerPorts: appSpec.containerPorts,
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      domains: appSpec.domains,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: 3,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 3) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'repotag', 'ports', 'containerPorts', 'enviromentParameters', 'commands', 'containerData', 'domains', 'instances',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ];
    ]; */
    const component = {
      name: appSpec.name,
      description: appSpec.description,
      repotag: appSpec.repotag,
      ports: appSpec.ports,
      containerPorts: appSpec.containerPorts,
      environmentParameters: appSpec.enviromentParameters,
      commands: appSpec.commands,
      domains: appSpec.domains,
      containerData: appSpec.containerData,
      cpu: appSpec.cpu || 0,
      ram: appSpec.ram || 0,
      hdd: appSpec.hdd || 0,
      repoauth: '',
    };
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: appSpec.instances,
      nodes: [],
      owner: appSpec.owner,
      staticip: false,
      compose: [component],
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    return newAppSpec;
  } if (appSpec.version === 4) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: [],
      expire: 22000,
      geolocation: [],
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 5) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: 22000,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 6) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: appSpec.expire,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [],
      staticip: false,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: '',
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 7) {
    /* const specifications = [
      'version', 'name', 'description', 'owner', 'compose', 'instances', 'contacts', 'geolocation', 'expire', 'nodes', 'staticip',
    ];
    const componentSpecifications = [
      'name', 'description', 'repotag', 'ports', 'containerPorts', 'environmentParameters', 'commands', 'containerData', 'domains', 'secrets', 'repoauth',
      'cpu', 'ram', 'hdd', 'tiered', 'cpubasic', 'rambasic', 'hddbasic', 'cpusuper', 'ramsuper', 'hddsuper', 'cpubamf', 'rambamf', 'hddbamf',
    ]; */
    const newAppSpec = {
      version: 8,
      name: appSpec.name,
      description: appSpec.description,
      contacts: appSpec.contacts,
      expire: appSpec.expire,
      geolocation: appSpec.geolocation,
      istances: appSpec.instances,
      nodes: [], // we don't fill the nodes as they were used for different thing.
      staticip: appSpec.staticip,
      enterprise: '',
      hash: appSpec.hash,
      height: appSpec.height,
    };
    const components = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const component of appSpec.compose) {
      const newComponent = {
        name: component.name,
        description: component.description,
        repotag: component.repotag,
        ports: component.ports,
        containerPorts: component.containerPorts,
        environmentParameters: component.environmentParameters,
        commands: component.commands,
        domains: component.domains,
        containerData: component.containerData,
        cpu: component.cpu || 0,
        ram: component.ram || 0,
        hdd: component.hdd || 0,
        repoauth: component.repoauth,
      };
      components.push(newComponent);
    }
    newAppSpec.compose = components;
    return newAppSpec;
  } if (appSpec.version === 8) {
    return appSpec;
  }
  throw new Error('Original application version not recognized');
}

/**
 * To verify app registration parameters. Checks for correct format, specs and non-duplication of values/resources.
 * @param {express.Request} req Request
 * @param {express.Response} res Response
 * @returns {Promise<void>}
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

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // app is valid and can be registered
      // respond with formatted specifications
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
 * To verify app update parameters. Checks for correct format, specs and non-duplication of values/resources.
 * @param {express.Request} req Request.
 * @param {express.Response} res Response.
 * @returns {Promise<void>} Message.
 */
async function verifyAppUpdateParameters(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      let appSpecification = processedBody;
      appSpecification = serviceHelper.ensureObject(appSpecification);

      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        throw new Error('Daemon not yet synced.');
      }
      const daemonHeight = syncStatus.data.height;

      const isEnterprise = Boolean(
        appSpecification.version >= 8 && appSpecification.enterprise,
      );

      const decryptedSpecs = await checkAndDecryptAppSpecs(appSpecification, { daemonHeight });

      const appSpecFormatted = specificationFormatter(decryptedSpecs);

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
      const timestamp = Date.now();
      await checkApplicationUpdateNameRepositoryConflicts(appSpecFormatted, timestamp);

      if (isEnterprise) {
        appSpecFormatted.contacts = [];
        appSpecFormatted.compose = [];
      }

      // app is valid and can be registered
      // respond with formatted specifications
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

module.exports = {
  checkHWParameters,
  checkComposeHWParameters,
  verifyAppHash,
  verifyAppMessageSignature,
  verifyAppMessageUpdateSignature,
  verifyRepository,
  checkApplicationImagesComplience,
  checkApplicationImagesBlocked,
  getBlockedRepositores,
  getUserBlockedRepositores,
  verifyTypeCorrectnessOfApp,
  verifyRestrictionCorrectnessOfApp,
  verifyObjectKeysCorrectnessOfApp,
  checkApplicationRegistrationNameConflicts,
  checkApplicationUpdateNameRepositoryConflicts,
  checkAppSecrets,
  verifyAppRegistrationParameters,
  verifyAppUpdateParameters,
  specificationFormatter,
  checkAndDecryptAppSpecs,
  decryptWithAesSession,
  encryptWithAesSession,
  decryptAesKeyWithRsaKey,
  decryptEnterpriseFromSession,
  encryptEnterpriseWithAes,
  encryptEnterpriseFromSession,
  updateToLatestAppSpecifications,
  verifyAppSpecifications,
};
