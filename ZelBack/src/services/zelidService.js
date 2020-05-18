const config = require('config');
const bitcoinMessage = require('bitcoinjs-message');
const qs = require('qs');

const userconfig = require('../../../config/userconfig');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelappsService = require('./zelappsService');
const zelfluxCommunication = require('./zelfluxCommunication');

const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;
const goodchars = /^[1-9a-km-zA-HJ-NP-Z]+$/;

async function loginPhrase(req, res) {
  // check docker availablility
  await zelappsService.dockerListContainers(false).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  // check DOS state (contains zelcash checks)
  const dosState = await zelfluxCommunication.getDOSState();
  if (dosState.status === 'error') {
    const errorMessage = 'Unable to check DOS state';
    const errMessage = serviceHelper.createErrorMessage(errorMessage);
    res.json(errMessage);
    return;
  }
  if (dosState.status === 'success') {
    if (dosState.data.dosState > 10 || dosState.data.dosMessage !== null) {
      let errMessage = serviceHelper.createErrorMessage(
        dosState.data.dosMessage,
        'DOS',
        dosState.data.dosState
      );
      if (
        dosState.data.dosMessage !== 'Flux IP detection failed' &&
        dosState.data.dosMessage !== 'Flux collision detection'
      ) {
        errMessage = serviceHelper.createErrorMessage(
          dosState.data.dosMessage,
          'CONNERROR',
          dosState.data.dosState
        );
      }
      res.json(errMessage);
      return;
    }
  }

  const timestamp = new Date().getTime();
  const validTill = timestamp + 15 * 60 * 1000; // 15 minutes
  const phrase =
    timestamp +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);

  /* const activeLoginPhrases = [
     {
       loginPhrase: 1565356121335e9obp7h17bykbbvub0ts488wnnmd12fe1pq88mq0v,
       createdAt: 2019-08-09T13:08:41.335Z,
       expireAt: 2019-08-09T13:23:41.335Z
     }
  ] */
  const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.activeLoginPhrases;
  database.collection(collection).createIndex(
    { createdAt: 1 },
    {
      expireAfterSeconds: 900,
    }
  );
  const newLoginPhrase = {
    loginPhrase: phrase,
    createdAt: new Date(timestamp),
    expireAt: new Date(validTill),
  };
  const value = newLoginPhrase;
  await serviceHelper
    .insertOneToDatabase(database, collection, value)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      db.close();
      throw error;
    });
  db.close();
  // all is ok
  const phraseResponse = serviceHelper.createDataMessage(phrase);
  res.json(phraseResponse);
}

// loginPhrase without status checks
async function emergencyPhrase(req, res) {
  const timestamp = new Date().getTime();
  const validTill = timestamp + 15 * 60 * 1000; // 15 minutes
  const phrase =
    timestamp +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);

  const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.activeLoginPhrases;
  database.collection(collection).createIndex(
    { createdAt: 1 },
    {
      expireAfterSeconds: 900,
    }
  );
  const newLoginPhrase = {
    loginPhrase: phrase,
    createdAt: new Date(timestamp),
    expireAt: new Date(validTill),
  };
  const value = newLoginPhrase;
  await serviceHelper
    .insertOneToDatabase(database, collection, value)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      db.close();
      throw error;
    });
  db.close();
  const phraseResponse = serviceHelper.createDataMessage(phrase);
  res.json(phraseResponse);
}

async function verifyLogin(req, res) {
  // Phase 2 - check that request is valid
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    const processedBody = serviceHelper.ensureObject(body);
    const address = processedBody.zelid || processedBody.address;
    const { signature } = processedBody;
    const message = processedBody.loginPhrase || processedBody.message;
    const timestamp = new Date().getTime();

    // First check that this message is valid - for example, it does not have an
    // old timestamp, it is at least 40 chars and was generated by us (as in it
    // is stored in our db)
    if (address === undefined || address === '') {
      const errMessage = serviceHelper.createErrorMessage(
        'No ZelID is specified'
      );
      return res.json(errMessage);
    }

    if (!goodchars.test(address)) {
      const errMessage = serviceHelper.createErrorMessage('ZelID is not valid');
      return res.json(errMessage);
    }

    if (address[0] !== '1') {
      const errMessage = serviceHelper.createErrorMessage('ZelID is not valid');
      return res.json(errMessage);
    }

    if (address.length > 34 || address.length < 25) {
      const errMessage = serviceHelper.createErrorMessage('ZelID is not valid');
      return res.json(errMessage);
    }

    if (message === undefined || message === '') {
      const errMessage = serviceHelper.createErrorMessage(
        'No message is specified'
      );
      return res.json(errMessage);
    }

    if (message.length < 40) {
      const errMessage = serviceHelper.createErrorMessage(
        'Signed message is not valid'
      );
      return res.json(errMessage);
    }

    if (
      message.substring(0, 13) < timestamp - 900000 ||
      message.substring(0, 13) > timestamp
    ) {
      const errMessage = serviceHelper.createErrorMessage(
        'Signed message is not valid'
      );
      return res.json(errMessage);
    }

    if (signature === undefined || signature === '') {
      const errMessage = serviceHelper.createErrorMessage(
        'No signature is specified'
      );
      return res.json(errMessage);
    }
    // Basic checks passed. First check if message is in our activeLoginPhrases
    // collection

    const db = await serviceHelper.connectMongoDb(mongoUrl);
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activeLoginPhrases;
    const query = { loginPhrase: message };
    const projection = {};
    const result = await serviceHelper
      .findOneInDatabase(database, collection, query, projection)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        throw error;
      });

    if (result) {
      // It is present in our database
      if (result.loginPhrase.substring(0, 13) < timestamp) {
        // Second verify that this address signed this message
        let valid = false;
        try {
          valid = bitcoinMessage.verify(message, address, signature);
        } catch (error) {
          const errMessage = serviceHelper.createErrorMessage(
            'Invalid signature'
          );
          return res.json(errMessage);
        }
        if (valid) {
          // Third associate that address, signature and message with our
          // database
          // TODO signature hijacking? What if middleware guy knows all of this?
          // TODO do we want to have some timelimited logins? not needed now
          // Do we want to store sighash too? Nope we are verifying if provided
          // signature is ok. In localStorage we are storing zelid, message,
          // signature const sighash = crypto
          //   .createHash('sha256')
          //   .update(signature)
          //   .digest('hex')
          const newLogin = {
            zelid: address,
            loginPhrase: message,
            signature,
          };
          let privilage = 'user';
          if (address === config.zelTeamZelId) {
            privilage = 'zelteam';
          } else if (address === userconfig.initial.zelid) {
            privilage = 'admin';
          }
          const loggedUsersCollection =
            config.database.local.collections.loggedUsers;
          const value = newLogin;
          await serviceHelper
            .insertOneToDatabase(database, loggedUsersCollection, value)
            .catch((error) => {
              const errMessage = serviceHelper.createErrorMessage(
                error.message,
                error.name,
                error.code
              );
              res.json(errMessage);
              log.error(error);
              db.close();
              throw error;
            });
          db.close();
          const resData = {
            message: 'Successfully logged in',
            zelid: address,
            loginPhrase: message,
            signature,
            privilage,
          };
          const resMessage = serviceHelper.createDataMessage(resData);
          return res.json(resMessage);
        }
        const errMessage = serviceHelper.createErrorMessage(
          'Invalid signature'
        );
        db.close();
        return res.json(errMessage);
      }
      const errMessage = serviceHelper.createErrorMessage(
        'Signed message is no longer valid. Please request a new one.'
      );
      db.close();
      return res.json(errMessage);
    }
    const errMessage = serviceHelper.createErrorMessage(
      'Signed message is no longer valid. Please request a new one.'
    );
    db.close();
    return res.json(errMessage);
  });
}

async function activeLoginPhrases(req, res) {
  const authorized = await serviceHelper
    .verifyAdminSession(req.headers)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  if (authorized === true) {
    const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });

    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activeLoginPhrases;
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        loginPhrase: 1,
        createdAt: 1,
        expireAt: 1,
      },
    };
    const results = await serviceHelper
      .findInDatabase(database, collection, query, projection)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        db.close();
        throw error;
      });
    db.close();
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function loggedUsers(req, res) {
  const authorized = await serviceHelper
    .verifyAdminSession(req.headers)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  if (authorized === true) {
    const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });

    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.loggedUsers;
    const query = {};
    const projection = { projection: { _id: 0, zelid: 1, loginPhrase: 1 } };
    const results = await serviceHelper
      .findInDatabase(database, collection, query, projection)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        db.close();
        throw error;
      });
    db.close();
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function loggedSessions(req, res) {
  const authorized = await serviceHelper
    .verifyUserSession(req.headers)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  if (authorized === true) {
    const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });

    const auth = serviceHelper.ensureObject(req.headers.zelidauth);
    const queryZelID = auth.zelid;
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.loggedUsers;
    const query = { zelid: queryZelID };
    const projection = { projection: { _id: 0, zelid: 1, loginPhrase: 1 } };
    const results = await serviceHelper
      .findInDatabase(database, collection, query, projection)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        db.close();
        throw error;
      });
    db.close();
    const resultsResponse = serviceHelper.createDataMessage(results);
    res.json(resultsResponse);
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function logoutCurrentSession(req, res) {
  const authorized = await serviceHelper
    .verifyUserSession(req.headers)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  if (authorized === true) {
    const auth = serviceHelper.ensureObject(req.headers.zelidauth);
    const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.loggedUsers;
    const query = {
      $and: [{ signature: auth.signature }, { zelid: auth.zelid }],
    };
    const projection = {};
    await serviceHelper
      .findOneAndDeleteInDatabase(database, collection, query, projection)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        db.close();
        throw error;
      });
    db.close();
    // console.log(results)
    const message = serviceHelper.createSuccessMessage(
      'Successfully logged out'
    );
    res.json(message);
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function logoutSpecificSession(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    console.log(req);
    const authorized = await serviceHelper
      .verifyUserSession(req.headers)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        throw error;
      });
    if (authorized === true) {
      const processedBody = serviceHelper.ensureObject(body);
      console.log(processedBody);
      const obtainedLoginPhrase = processedBody.loginPhrase;
      const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        throw error;
      });
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const query = { loginPhrase: obtainedLoginPhrase };
      const projection = {};
      const result = await serviceHelper
        .findOneAndDeleteInDatabase(database, collection, query, projection)
        .catch((error) => {
          const errMessage = serviceHelper.createErrorMessage(
            error.message,
            error.name,
            error.code
          );
          res.json(errMessage);
          log.error(error);
          db.close();
          throw error;
        });
      db.close();
      if (result.value === null) {
        const message = serviceHelper.createWarningMessage(
          'Specified user was already logged out'
        );
        return res.json(message);
      }
      const message = serviceHelper.createSuccessMessage(
        'Session successfully logged out'
      );
      return res.json(message);
    }
    const errMessage = serviceHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  });
}

async function logoutAllSessions(req, res) {
  const authorized = await serviceHelper
    .verifyUserSession(req.headers)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  if (authorized === true) {
    const auth = serviceHelper.ensureObject(req.headers.zelidauth);
    const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.loggedUsers;
    const query = { zelid: auth.zelid };
    await serviceHelper
      .removeDocumentsFromCollection(database, collection, query)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        db.close();
        throw error;
      });
    db.close();
    // console.log(result)
    const message = serviceHelper.createSuccessMessage(
      'Successfully logged out all sessions'
    );
    return res.json(message);
  }
  const errMessage = serviceHelper.errUnauthorizedMessage();
  return res.json(errMessage);
}

async function logoutAllUsers(req, res) {
  const authorized = await serviceHelper
    .verifyAdminSession(req.headers)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  if (authorized === true) {
    const db = await serviceHelper.connectMongoDb(mongoUrl);
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.loggedUsers;
    const query = {};
    await serviceHelper
      .removeDocumentsFromCollection(database, collection, query)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        res.json(errMessage);
        log.error(error);
        db.close();
        throw error;
      });
    db.close();
    const message = serviceHelper.createSuccessMessage(
      'Successfully logged out all users'
    );
    return res.json(message);
  }
  const errMessage = serviceHelper.errUnauthorizedMessage();
  return res.json(errMessage);
}

async function wsRespondLoginPhrase(ws, req) {
  const { loginphrase } = req.params;
  // console.log(loginphrase)
  // respond with object containing address and signature to received message
  let connclosed = false;
  // eslint-disable-next-line no-param-reassign
  ws.onclose = (evt) => {
    console.log(evt.code);
    connclosed = true;
  };
  // eslint-disable-next-line no-param-reassign
  ws.onerror = (evt) => {
    log.error(evt.code);
    connclosed = true;
  };

  const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    ws.send(qs.stringify(errMessage));
    ws.close(1011);
    log.error(error);
    throw error;
  });

  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { loginPhrase: loginphrase };
  const projection = {};
  async function searchDatabase() {
    const result = await serviceHelper
      .findOneInDatabase(database, collection, query, projection)
      .catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(
          error.message,
          error.name,
          error.code
        );
        ws.send(qs.stringify(errMessage));
        ws.close(1011);
        log.error(error);
        throw error;
      });

    if (result) {
      // user is logged, all ok
      let privilage = 'user';
      if (result.zelid === config.zelTeamZelId) {
        privilage = 'zelteam';
      } else if (result.zelid === userconfig.initial.zelid) {
        privilage = 'admin';
      }
      const resData = {
        message: 'Successfully logged in',
        zelid: result.zelid,
        loginPhrase: result.loginPhrase,
        signature: result.signature,
        privilage,
      };
      const message = serviceHelper.createDataMessage(resData);
      if (!connclosed) {
        try {
          ws.send(qs.stringify(message));
          ws.close(1000);
        } catch (e) {
          log.error(e);
        }
      }
      db.close();
    } else {
      // check if this loginPhrase is still active. If so rerun this searching
      // process
      const activeLoginPhrasesCollection =
        config.database.local.collections.activeLoginPhrases;
      const resultB = await serviceHelper
        .findOneInDatabase(
          database,
          activeLoginPhrasesCollection,
          query,
          projection
        )
        .catch((error) => {
          const errMessage = serviceHelper.createErrorMessage(
            error.message,
            error.name,
            error.code
          );
          ws.send(qs.stringify(errMessage));
          ws.close(1011);
          log.error(error);
          throw error;
        });
      if (resultB) {
        setTimeout(() => {
          if (!connclosed) {
            searchDatabase();
          }
        }, 500);
      } else {
        const errMessage = serviceHelper.createErrorMessage(
          'Signed message is no longer valid. Please request a new one.'
        );
        db.close();
        if (!connclosed) {
          try {
            ws.send(qs.stringify(errMessage));
            ws.close();
          } catch (e) {
            log.error(e);
          }
        }
      }
    }
  }
  searchDatabase();
}

module.exports = {
  loginPhrase,
  emergencyPhrase,
  verifyLogin,
  activeLoginPhrases,
  loggedUsers,
  loggedSessions,
  logoutCurrentSession,
  logoutSpecificSession,
  logoutAllSessions,
  logoutAllUsers,
  wsRespondLoginPhrase,
};
