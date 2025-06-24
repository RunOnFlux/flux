const config = require('config');
const crypto = require('node:crypto');

const dbHelper = require('./dbHelper');
const log = require('../lib/log');
const pgpService = require('./pgpService');
const imageVerifier = require('./utils/imageVerifier');
const benchmarkService = require('./benchmarkService');

const supportedArchitectures = ['amd64', 'arm64'];

const isArcane = Boolean(process.env.FLUXOS_PATH);

const globalAppsMessages = config.database.appsglobal.collections.appsMessages;

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
    appOwner = lastAppRegistration.owner;
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
    const base64AesKey = status === 'success' && dataParsed.status === 'ok' ? dataParsed.message : null;
    if (base64AesKey) {
      return base64AesKey;
    }
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
 * Encrypts app specs for api request
 * @param {object} appSpec App spec that needs contacts / compose encrypted
* @param {integer} daemonHeight daemon block height.
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

  const base64AesKey = await decryptAesKeyWithRsaKey(appName, daemonHeight, enterpriseKey);
  const encryptedEnterprise = encryptWithAesSession(appSpec.enterprise, base64AesKey);
  if (encryptedEnterprise) {
    return encryptedEnterprise;
  }
  throw new Error('Error encrypting enterprise object.');
}

module.exports = {
  checkAndDecryptAppSpecs,
  decryptEnterpriseFromSession,
  decryptAesKeyWithRsaKey,
  decryptWithAesSession,
  verifyRepository,
  checkAppSecrets,
  encryptWithAesSession,
  encryptEnterpriseFromSession,
};
