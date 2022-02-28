const axios = require('axios');
const config = require('config');
const bitcoinMessage = require('bitcoinjs-message');
const bitcoinjs = require('bitcoinjs-lib');
const zeltrezjs = require('zeltrezjs');
const { randomBytes } = require('crypto');
const qs = require('qs');

const dbHelper = require('./dbHelper');
const log = require('../lib/log');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDataMessage(data) {
  const successMessage = {
    status: 'success',
    data,
  };
  return successMessage;
}

function createSuccessMessage(message, name, code) {
  const successMessage = {
    status: 'success',
    data: {
      code,
      name,
      message,
    },
  };
  return successMessage;
}

function createWarningMessage(message, name, code) {
  const warningMessage = {
    status: 'warning',
    data: {
      code,
      name,
      message,
    },
  };
  return warningMessage;
}

function createErrorMessage(message, name, code) {
  const errMessage = {
    status: 'error',
    data: {
      code,
      name,
      message: message || 'Unknown error',
    },
  };
  return errMessage;
}

function errUnauthorizedMessage() {
  const errMessage = {
    status: 'error',
    data: {
      code: 401,
      name: 'Unauthorized',
      message: 'Unauthorized. Access denied.',
    },
  };
  return errMessage;
}

function ensureBoolean(parameter) {
  let param;
  if (parameter === 'false' || parameter === 0 || parameter === '0' || parameter === false) {
    param = false;
  }
  if (parameter === 'true' || parameter === 1 || parameter === '1' || parameter === true) {
    param = true;
  }
  return param;
}

function ensureNumber(parameter) {
  return typeof parameter === 'number' ? parameter : Number(parameter);
}

function ensureObject(parameter) {
  if (typeof parameter === 'object') {
    return parameter;
  }
  if (!parameter) {
    return {};
  }
  let param;
  try {
    param = JSON.parse(parameter);
  } catch (e) {
    param = qs.parse(parameter);
  }
  if (typeof param !== 'object') {
    return {};
  }
  return param;
}

function ensureString(parameter) {
  return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
}

// helper owner flux app function
async function getApplicationOwner(appName) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.appsglobal.database);

  const query = { name: new RegExp(`^${appName}$`, 'i') };
  const projection = {
    projection: {
      _id: 0,
      owner: 1,
    },
  };
  const globalAppsInformation = config.database.appsglobal.collections.appsInformation;
  const appSpecs = await dbHelper.findOneInDatabase(database, globalAppsInformation, query, projection);
  if (appSpecs) {
    return appSpecs.owner;
  }
  // eslint-disable-next-line global-require
  const { availableApps } = require('./appsService');
  const allApps = await availableApps();
  const appInfo = allApps.find((app) => app.name.toLowerCase() === appName.toLowerCase());
  if (appInfo) {
    return appInfo.owner;
  }
  return null;
}

function verifyMessage(message, address, signature, strMessageMagic, checkSegwitAlways) {
  let isValid = false;
  let signingAddress = address;
  try {
    if (!address || !message || !signature) {
      throw new Error('Missing parameters for message verification');
    }

    if (address.length > 36) {
      const btcPubKeyHash = '00';
      const sigAddress = zeltrezjs.address.pubKeyToAddr(address, btcPubKeyHash);
      // const publicKeyBuffer = Buffer.from(address, 'hex');
      // const publicKey = bitcoinjs.ECPair.fromPublicKeyBuffer(publicKeyBuffer);
      // const sigAddress = bitcoinjs.payments.p2pkh({ pubkey: publicKeyBuffer }).address);
      signingAddress = sigAddress;
    }
    isValid = bitcoinMessage.verify(message, signingAddress, signature, strMessageMagic, checkSegwitAlways);
  } catch (e) {
    log.error(e);
    isValid = e;
  }
  return isValid;
}

function signMessage(message, pk) {
  let signature;
  try {
    const keyPair = bitcoinjs.ECPair.fromWIF(pk);
    const { privateKey } = keyPair;
    // console.log(keyPair.privateKey.toString('hex'));
    // console.log(keyPair.publicKey.toString('hex'));

    signature = bitcoinMessage.sign(message, privateKey, keyPair.compressed, { extraEntropy: randomBytes(32) });
    signature = signature.toString('base64');
    // => different (but valid) signature each time
  } catch (e) {
    log.error(e);
    signature = e;
  }
  return signature;
}

async function deleteLoginPhrase(phrase) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activeLoginPhrases;
    const query = { loginPhrase: phrase };
    const projection = {};
    await dbHelper.findOneAndDeleteInDatabase(database, collection, query, projection);
  } catch (error) {
    log.error(error);
  }
}

// helper function for timeout on axios connection
const axiosGet = (url, options = {
  timeout: 20000,
}) => {
  const abort = axios.CancelToken.source();
  const id = setTimeout(
    () => abort.cancel(`Timeout of ${options.timeout}ms.`),
    options.timeout,
  );
  return axios
    .get(url, { cancelToken: abort.token, ...options })
    .then((res) => {
      clearTimeout(id);
      return res;
    });
};

module.exports = {
  ensureBoolean,
  ensureNumber,
  ensureObject,
  ensureString,
  signMessage,
  verifyMessage,
  createDataMessage,
  createSuccessMessage,
  createWarningMessage,
  createErrorMessage,
  errUnauthorizedMessage,
  axiosGet,
  delay,
  getApplicationOwner,
  deleteLoginPhrase,
};
