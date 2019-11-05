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
function connectMongoDb(url, callback) {
  // eslint-disable-next-line no-param-reassign
  url = url || mongoUrl;
  MongoClient.connect(url, (err, db) => {
    if (err) {
      callback(err);
    } else {
      callback(null, db);
    }
  });
}

function findInDatabase(database, collection, query, projection, callback) {
  database.collection(collection).find(query, projection)
    .toArray((err, results) => {
      if (err) {
        callback(err);
      } else {
        callback(null, results);
      }
    });
}

function findOneInDatabase(database, collection, query, projection, callback) {
  database.collection(collection).findOne(query, projection, (err, result) => {
    if (err) {
      callback(err);
    } else {
      callback(null, result);
    }
  });
}

function insertOneToDatabase(database, collection, value, callback) {
  database.collection(collection).insertOne(value, (err, result) => {
    if (err) {
      callback(err);
    } else {
      callback(null, result);
    }
  });
}

function findOneAndDeleteInDatabase(database, collection, query, projection, callback) {
  database.collection(collection).findOneAndDelete(query, projection, (err, result) => {
    if (err) {
      callback(err);
    } else {
      callback(null, result);
    }
  });
}

function removeDocumentsFromCollection(database, collection, query, callback) {
  // to remove all documents from collection, the query is just {}
  database.collection(collection).remove(query, (err, result) => {
    if (err) {
      callback(err);
    } else {
      callback(null, result);
    }
  });
}

// Verification functions
function verifyAdminSession(headers, callback) {
  if (headers && headers.zelidauth) {
    const auth = qs.parse(headers.zelidauth);
    console.log(auth);
    if (auth.zelid && auth.signature) {
      console.log(auth.zelid);
      console.log(auth.signature);
      console.log(userconfig.initial.zelid);
      if (auth.zelid === userconfig.initial.zelid) {
        connectMongoDb(mongoUrl, (err, db) => {
          if (err) {
            log.error('Cannot reach MongoDB');
            log.error(err);
            callback(null, false);
          }
          const database = db.db(config.database.local.database);
          const collection = config.database.local.collections.loggedUsers;
          const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
          const projection = {};
          // eslint-disable-next-line no-shadow
          findOneInDatabase(database, collection, query, projection, (err, result) => {
            if (err) {
              log.error('Error accessing local zelID collection');
              log.error(err);
              db.close();
              callback(null, false);
            }
            const loggedUser = result;
            // console.log(result)
            db.close();
            if (loggedUser) {
              // check if signature corresponds to message with that zelid
              let valid = false;
              try {
                valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
              } catch (error) {
                callback(null, false);
              }
              // console.log(valid)
              if (valid) {
                // now we know this is indeed a logged admin
                // console.log('here')
                callback(null, true);
              }
            } else {
              callback(null, false);
            }
          });
        });
      } else {
        callback(null, false);
      }
    } else {
      callback(null, false);
    }
  } else {
    callback(null, false);
  }
}

function verifyUserSession(headers, callback) {
  if (headers && headers.zelidauth) {
    const auth = qs.parse(headers.zelidauth);
    console.log(auth);
    if (auth.zelid && auth.signature) {
      connectMongoDb(mongoUrl, (err, db) => {
        if (err) {
          log.error('Cannot reach MongoDB');
          log.error(err);
          callback(null, false);
        }
        const database = db.db(config.database.local.database);
        const collection = config.database.local.collections.loggedUsers;
        const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
        const projection = {};
        // eslint-disable-next-line no-shadow
        findOneInDatabase(database, collection, query, projection, (err, result) => {
          if (err) {
            log.error('Error accessing local zelID collection');
            log.error(err);
            db.close();
            callback(null, false);
          }
          const loggedUser = result;
          // console.log(result)
          db.close();
          if (loggedUser) {
            // check if signature corresponds to message with that zelid
            let valid = false;
            try {
              valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
            } catch (error) {
              callback(null, false);
            }
            // console.log(valid)
            if (valid) {
              // now we know this is indeed a logged admin
              // console.log('here')
              callback(null, true);
            }
          } else {
            callback(null, false);
          }
        });
      });
    } else {
      callback(null, false);
    }
  } else {
    callback(null, false);
  }
}

function verifyZelTeamSession(headers, callback) {
  if (headers && headers.zelidauth) {
    const auth = qs.parse(headers.zelidauth);
    console.log(auth);
    if (auth.zelid && auth.signature) {
      if (auth.zelid === config.zelTeamZelId || auth.zelid === userconfig.initial.zelid) { // admin is considered as zelTeam
        connectMongoDb(mongoUrl, (err, db) => {
          if (err) {
            log.error('Cannot reach MongoDB');
            log.error(err);
            callback(null, false);
          }
          const database = db.db(config.database.local.database);
          const collection = config.database.local.collections.loggedUsers;
          const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
          const projection = {};
          // eslint-disable-next-line no-shadow
          findOneInDatabase(database, collection, query, projection, (err, result) => {
            if (err) {
              log.error('Error accessing local zelID collection');
              log.error(err);
              db.close();
              callback(null, false);
            }
            const loggedUser = result;
            // console.log(result)
            db.close();
            if (loggedUser) {
              // check if signature corresponds to message with that zelid
              let valid = false;
              try {
                valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
              } catch (error) {
                callback(null, false);
              }
              // console.log(valid)
              if (valid) {
                // now we know this is indeed a logged admin
                // console.log('here')
                callback(null, true);
              }
            } else {
              callback(null, false);
            }
          });
        });
      } else {
        callback(null, false);
      }
    } else {
      callback(null, false);
    }
  } else {
    callback(null, false);
  }
}

async function verifyPrivilege(privilege, req, res) { // move to helper
  let isAuthorized;
  switch (privilege) {
    case 'admin':
      // eslint-disable-next-line consistent-return
      await verifyAdminSession(req.headers, async (error, authorized) => {
        if (error) {
          return res.json(error);
        }
        isAuthorized = authorized;
      });
      return isAuthorized;
    case 'zelteam':
      // eslint-disable-next-line consistent-return
      await verifyZelTeamSession(req.headers, async (error, authorized) => {
        if (error) {
          return res.json(error);
        }
        isAuthorized = authorized;
      });
      return isAuthorized;
    case 'user':
      // eslint-disable-next-line consistent-return
      await verifyUserSession(req.headers, async (error, authorized) => {
        if (error) {
          return res.json(error);
        }
        isAuthorized = authorized;
      });
      return isAuthorized;
    default:
      return false;
  }
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
