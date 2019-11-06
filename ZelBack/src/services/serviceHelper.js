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

// MongoDB functions
async function connectMongoDb(url) {
  // eslint-disable-next-line no-param-reassign
  url = url || mongoUrl;
  const db = await MongoClient.connect(url);
  return db;
}

async function findInDatabase(database, collection, query, projection) {
  const results = await database.collection(collection).find(query, projection).toArray();
  return results;
}

async function findOneInDatabase(database, collection, query, projection) {
  const result = await database.collection(collection).findOne(query, projection);
  return result;
}

async function insertOneToDatabase(database, collection, value) {
  const result = await database.collection(collection).insertOne(value);
  return result;
}

async function findOneAndDeleteInDatabase(database, collection, query, projection) {
  const result = await database.collection(collection).findOneAndDelete(query, projection);
  return result;
}

async function removeDocumentsFromCollection(database, collection, query) {
  // to remove all documents from collection, the query is just {}
  const result = await database.collection(collection).remove(query);
  return result;
}

// Verification functions
// eslint-disable-next-line consistent-return
async function verifyAdminSession(headers) {
  if (headers && headers.zelidauth) {
    const auth = qs.parse(headers.zelidauth);
    console.log(auth);
    if (auth.zelid && auth.signature) {
      console.log(auth.zelid);
      console.log(auth.signature);
      console.log(userconfig.initial.zelid);
      if (auth.zelid === userconfig.initial.zelid) {
        const db = await connectMongoDb(mongoUrl);
        const database = db.db(config.database.local.database);
        const collection = config.database.local.collections.loggedUsers;
        const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
        const projection = {};
        // eslint-disable-next-line no-shadow
        const result = await findOneInDatabase(database, collection, query, projection);
        const loggedUser = result;
        // console.log(result)
        db.close();
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
            console.log('here2');
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
  } else {
    return false;
  }
}

// eslint-disable-next-line consistent-return
async function verifyUserSession(headers) {
  if (headers && headers.zelidauth) {
    const auth = qs.parse(headers.zelidauth);
    console.log(auth);
    if (auth.zelid && auth.signature) {
      const db = await connectMongoDb(mongoUrl);
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
      const projection = {};
      // eslint-disable-next-line no-shadow
      const result = await findOneInDatabase(database, collection, query, projection);
      const loggedUser = result;
      // console.log(result)
      db.close();
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

// eslint-disable-next-line consistent-return
async function verifyZelTeamSession(headers) {
  if (headers && headers.zelidauth) {
    const auth = qs.parse(headers.zelidauth);
    console.log(auth);
    if (auth.zelid && auth.signature) {
      if (auth.zelid === config.zelTeamZelId || auth.zelid === userconfig.initial.zelid) { // admin is considered as zelTeam
        const db = await connectMongoDb(mongoUrl);
        const database = db.db(config.database.local.database);
        const collection = config.database.local.collections.loggedUsers;
        const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
        const projection = {};
        // eslint-disable-next-line no-shadow
        const result = await findOneInDatabase(database, collection, query, projection);
        const loggedUser = result;
        console.log(result);
        db.close();
        if (loggedUser) {
          // check if signature corresponds to message with that zelid
          let valid = false;
          try {
            valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
          } catch (error) {
            return false;
          }
          console.log(valid);
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
  } else {
    return false;
  }
}

async function verifyPrivilege(privilege, req) {
  console.log('here');
  let authorized;
  switch (privilege) {
    case 'admin':
      authorized = await verifyAdminSession(req.headers);
      break;
    case 'zelteam':
      authorized = await verifyZelTeamSession(req.headers);
      break;
    case 'user':
      authorized = await verifyUserSession(req.headers);
      break;
    default:
      authorized = false;
      break;
  }
  return authorized;
}


function verifyMessage(message, address, signature) {
  let isValid = false;
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
      // eslint-disable-next-line no-param-reassign
      address = sigAddress;
    }
    isValid = bitcoinMessage.verify(message, address, signature);
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

module.exports = {
  connectMongoDb,
  findInDatabase,
  findOneInDatabase,
  insertOneToDatabase,
  findOneAndDeleteInDatabase,
  removeDocumentsFromCollection,
  verifyAdminSession,
  verifyUserSession,
  verifyZelTeamSession,
  verifyPrivilege,
  signMessage,
  verifyMessage,
};
