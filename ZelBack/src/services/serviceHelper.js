const axios = require('axios');
const mongodb = require('mongodb');
const config = require('config');
const bitcoinMessage = require('bitcoinjs-message');
const bitcoinjs = require('bitcoinjs-lib');
const zeltrezjs = require('zeltrezjs');
const { randomBytes } = require('crypto');
const qs = require('qs');

const userconfig = require('../../../config/userconfig');
const log = require('../lib/log');

const { MongoClient } = mongodb;
const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

let openDBConnection = null;

function databaseConnection() {
  return openDBConnection;
}

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
  let param;
  try {
    param = JSON.parse(parameter);
  } catch (e) {
    param = qs.parse(parameter);
  }
  return param;
}

function ensureString(parameter) {
  return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
}

// MongoDB functions
async function connectMongoDb(url) {
  const connectUrl = url || mongoUrl;
  const mongoSettings = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    poolSize: 10,
  };
  const db = await MongoClient.connect(connectUrl, mongoSettings).catch((error) => { throw error; });
  return db;
}

async function initiateDB() {
  openDBConnection = await connectMongoDb();
  return true;
}

async function distinctDatabase(database, collection, distinct, query) {
  const results = await database.collection(collection).distinct(distinct, query).catch((error) => { throw error; });
  return results;
}

async function findInDatabase(database, collection, query, projection) {
  const results = await database.collection(collection).find(query, projection).toArray().catch((error) => { throw error; });
  return results;
}

async function findOneInDatabase(database, collection, query, projection) {
  const result = await database.collection(collection).findOne(query, projection).catch((error) => { throw error; });
  return result;
}

async function findOneAndUpdateInDatabase(database, collection, query, update, options) {
  const passedOptions = options || {};
  const result = await database.collection(collection).findOneAndUpdate(query, update, passedOptions).catch((error) => { throw error; });
  return result;
}

async function insertOneToDatabase(database, collection, value) {
  const result = await database.collection(collection).insertOne(value).catch((error) => { throw error; });
  return result;
}

async function updateOneInDatabase(database, collection, query, update, options) {
  const passedOptions = options || {};
  const result = await database.collection(collection).updateOne(query, update, passedOptions).catch((error) => { throw error; });
  return result;
}

async function updateInDatabase(database, collection, query, projection) {
  const result = await database.collection(collection).updateMany(query, projection).catch((error) => { throw error; });
  return result;
}

async function findOneAndDeleteInDatabase(database, collection, query, projection) {
  const result = await database.collection(collection).findOneAndDelete(query, projection).catch((error) => { throw error; });
  return result;
}

async function removeDocumentsFromCollection(database, collection, query) {
  // to remove all documents from collection, the query is just {}
  const result = await database.collection(collection).deleteMany(query).catch((error) => { throw error; });
  return result;
}

async function dropCollection(database, collection) {
  const result = await database.collection(collection).drop().catch((error) => { throw error; });
  return result;
}

async function collectionStats(database, collection) {
  // to remove all documents from collection, the query is just {}
  const result = await database.collection(collection).stats().catch((error) => { throw error; });
  return result;
}

// Verification functions
async function verifyAdminSession(headers) {
  if (headers && headers.zelidauth) {
    const auth = ensureObject(headers.zelidauth);
    console.log(auth);
    if (auth.zelid && auth.signature) {
      console.log(auth.zelid);
      console.log(auth.signature);
      console.log(userconfig.initial.zelid);
      if (auth.zelid === userconfig.initial.zelid) {
        const db = databaseConnection;
        const database = db.db(config.database.local.database);
        const collection = config.database.local.collections.loggedUsers;
        const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
        const projection = {};
        const result = await findOneInDatabase(database, collection, query, projection);
        const loggedUser = result;
        // console.log(result)
        if (loggedUser) {
          // check if signature corresponds to message with that zelid
          let valid = false;
          try {
            valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
          } catch (error) {
            return false;
          }
          // console.log(valid)
          if (valid) {
            // now we know this is indeed a logged admin
            return true;
          }
        } else {
          return false;
        }
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
  return false;
}

async function verifyUserSession(headers) {
  if (headers && headers.zelidauth) {
    const auth = ensureObject(headers.zelidauth);
    console.log(auth);
    if (auth.zelid && auth.signature) {
      const db = databaseConnection;
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
      const projection = {};
      const result = await findOneInDatabase(database, collection, query, projection);
      const loggedUser = result;
      // console.log(result)
      if (loggedUser) {
        // check if signature corresponds to message with that zelid
        let valid = false;
        try {
          valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
        } catch (error) {
          return false;
        }
        // console.log(valid)
        if (valid) {
          // now we know this is indeed a logged admin
          return true;
        }
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
  return false;
}

async function verifyZelTeamSession(headers) {
  if (headers && headers.zelidauth) {
    const auth = ensureObject(headers.zelidauth);
    if (auth.zelid && auth.signature) {
      if (auth.zelid === config.zelTeamZelId || auth.zelid === userconfig.initial.zelid) { // admin is considered as zelTeam
        const db = databaseConnection;
        const database = db.db(config.database.local.database);
        const collection = config.database.local.collections.loggedUsers;
        const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
        const projection = {};
        const result = await findOneInDatabase(database, collection, query, projection);
        const loggedUser = result;
        if (loggedUser) {
          // check if signature corresponds to message with that zelid
          let valid = false;
          try {
            valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
          } catch (error) {
            return false;
          }
          if (valid) {
            // now we know this is indeed a logged admin
            return true;
          }
        } else {
          return false;
        }
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
  return false;
}

async function verifyPrivilege(privilege, req) {
  let authorized;
  switch (privilege) {
    case 'admin':
      authorized = await verifyAdminSession(req.headers).catch((error) => { throw error; });
      break;
    case 'zelteam':
      authorized = await verifyZelTeamSession(req.headers).catch((error) => { throw error; });
      break;
    case 'user':
      authorized = await verifyUserSession(req.headers).catch((error) => { throw error; });
      break;
    default:
      authorized = false;
      break;
  }
  return authorized;
}

function verifyZelID(address) {
  let isValid = false;
  try {
    if (!address) {
      throw new Error({ message: 'Missing parameters for message verification' });
    }

    if (address.length > 36) {
      const btcPubKeyHash = '00';
      zeltrezjs.address.pubKeyToAddr(address, btcPubKeyHash);
    }
    isValid = true;
  } catch (e) {
    log.error(e);
    isValid = e;
  }
  return isValid;
}

function verifyMessage(message, address, signature) {
  let isValid = false;
  let signingAddress = address;
  try {
    if (!address || !message || !signature) {
      throw new Error({ message: 'Missing parameters for message verification' });
    }

    if (address.length > 36) {
      const btcPubKeyHash = '00';
      const sigAddress = zeltrezjs.address.pubKeyToAddr(address, btcPubKeyHash);
      // const publicKeyBuffer = Buffer.from(address, 'hex');
      // const publicKey = bitcoinjs.ECPair.fromPublicKeyBuffer(publicKeyBuffer);
      // const sigAddress = bitcoinjs.payments.p2pkh({ pubkey: publicKeyBuffer }).address);
      signingAddress = sigAddress;
    }
    isValid = bitcoinMessage.verify(message, signingAddress, signature);
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
  connectMongoDb,
  distinctDatabase,
  findInDatabase,
  findOneInDatabase,
  findOneAndUpdateInDatabase,
  insertOneToDatabase,
  updateInDatabase,
  updateOneInDatabase,
  findOneAndDeleteInDatabase,
  removeDocumentsFromCollection,
  dropCollection,
  collectionStats,
  verifyAdminSession,
  verifyUserSession,
  verifyZelTeamSession,
  verifyPrivilege,
  signMessage,
  verifyMessage,
  createDataMessage,
  createSuccessMessage,
  createWarningMessage,
  createErrorMessage,
  errUnauthorizedMessage,
  axiosGet,
  verifyZelID,
  delay,
  initiateDB,
  databaseConnection,
};
