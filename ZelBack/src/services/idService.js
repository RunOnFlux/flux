const { EventEmitter } = require('node:events');
const config = require('config');
const qs = require('qs');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');
const verificationHelper = require('./verificationHelper');
const verificationHelperUtils = require('./verificationHelperUtils');
const nodeHealthService = require('./nodeHealthService');
const signatureVerifier = require('./signatureVerifier');
const { Privilege, authOf } = require('./utils/privileges');

/**
 * What /id/checkprivilege answers.
 *
 * A published contract, not an internal name: the frontend branches on these
 * four strings in fourteen places, in a separately deployed repo, and reads them
 * out of the response body whether the status says success or error. They are
 * deliberately not Privilege's values - that enum is what a route requires
 * internally, and the two are free to diverge.
 */
const PRIVILEGE_RESPONSE = Object.freeze({
  NODE_OPERATOR: 'admin',
  FLUX_TEAM: 'fluxteam',
  USER: 'user',
  NONE: 'none',
});

// How long a login phrase is valid for once issued; the activeLoginPhrases TTL
// index removes it then.
const LOGIN_PHRASE_VALID_MS = 15 * 60 * 1000;

// The outcome of a login, published by verifyLogin under the phrase it used:
// { data } with what the login answered, or { error } once the phrase is used
// and the login was not written. The login websocket waits on it.
const loginOutcomes = new EventEmitter();
loginOutcomes.setMaxListeners(0);
// For each phrase, how many logins are between trying to use it and ending. A login
// is counted before it tries the phrase and until after it has published how it
// ended, so a used phrase nobody is counted against has ended without a login or
// with one already written.
const loginsInProgress = new Map();
// A phrase not yet used by a login.
const UNUSED_PHRASE = { usedAt: { $exists: false } };

function enterLogin(phrase) {
  loginsInProgress.set(phrase, (loginsInProgress.get(phrase) ?? 0) + 1);
}

function leaveLogin(phrase) {
  const held = loginsInProgress.get(phrase);
  if (held > 1) {
    loginsInProgress.set(phrase, held - 1);
    return;
  }
  loginsInProgress.delete(phrase);
  // a page waiting on the phrase reads again: no login is left to publish anything
  loginOutcomes.emit(phrase, { ended: true });
}

/**
 * Publish how a login that used its phrase ended.
 * @param {string} phrase
 * @param {{data?: object, error?: object}} outcome
 */
function publishLoginOutcome(phrase, outcome) {
  loginOutcomes.emit(phrase, outcome);
}

/**
 * Marks a login phrase used, so that it signs in once: of the logins that try it,
 * one marks it. The record stays until its TTL removes it, so a login page reads
 * a used phrase as used rather than as never issued.
 * @param {string} phrase
 * @returns {Promise<boolean>} Whether this call marked it. Rejects when the
 *   database does not answer.
 */
async function claimLoginPhrase(phrase) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.activeLoginPhrases;
  return Boolean(await dbHelper.findOneAndUpdateInDatabase(
    database,
    collection,
    { loginPhrase: phrase, ...UNUSED_PHRASE },
    { $set: { usedAt: new Date() } },
  ));
}


/**
 * To return a JSON response with the user's login phrase.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function loginPhrase(req, res) {
  try {
    const fitness = await nodeHealthService.checkNodeFitness();
    if (!fitness.ok) {
      res.json(messageHelper.createErrorMessage(fitness.error.message, fitness.error.name, fitness.error.code));
      return;
    }

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activeLoginPhrases;

    const timestamp = Date.now();
    const validTill = timestamp + LOGIN_PHRASE_VALID_MS;
    const phrase = timestamp + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const newLoginPhrase = {
      loginPhrase: phrase,
      createdAt: new Date(timestamp),
      expireAt: new Date(validTill),
    };
    await dbHelper.insertOneToDatabase(database, collection, newLoginPhrase);

    const phraseResponse = messageHelper.createDataMessage(phrase);
    res.json(phraseResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return a JSON response with the user's emergency login phrase.
 * @param {object} req Request.
 * @param {object} res Response.
 */
// loginPhrase without status checks
async function emergencyPhrase(req, res) {
  try {
    const timestamp = Date.now();
    const validTill = timestamp + LOGIN_PHRASE_VALID_MS;
    const phrase = timestamp + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activeLoginPhrases;
    const newLoginPhrase = {
      loginPhrase: phrase,
      createdAt: new Date(timestamp),
      expireAt: new Date(validTill),
    };
    const value = newLoginPhrase;
    await dbHelper.insertOneToDatabase(database, collection, value);
    const phraseResponse = messageHelper.createDataMessage(phrase);
    res.json(phraseResponse);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return a JSON response to show the user if they have logged in successfully or not. In order to successfully log in, a series of checks are performed on the Flux ID and signature.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function verifyLogin(req, res) {
  // Phase 2 - check that request is valid
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    // set once this request has used the phrase, which no other can then use
    let usedPhrase = null;
    let triedPhrase = null;
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const address = processedBody.zelid || processedBody.address;
      const { signature } = processedBody;
      const message = processedBody.loginPhrase || processedBody.message;
      const timestamp = Date.now();

      // First check that this message is valid - for example, it does not have an old timestamp, it is at least 40 chars and was generated by us (as in it is stored in our db)
      if (address === undefined || address === '') {
        throw new Error('No Flux ID is specified');
      }

      if (!signatureVerifier.isValidSigningIdentity(address)) {
        throw new Error('Flux ID is not valid');
      }

      if (message === undefined || message === '') {
        throw new Error('No message is specified');
      }

      if (message.length < 40) {
        throw new Error('Signed message is not valid');
      }

      if (+message.substring(0, 13) < (timestamp - 900000) || +message.substring(0, 13) > timestamp) {
        throw new Error('Signed message is not valid');
      }

      if (signature === undefined || signature === '') {
        throw new Error('No signature is specified');
      }
      // Basic checks passed. First check if message is in our activeLoginPhrases collection

      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.activeLoginPhrases;
      const query = { loginPhrase: message, ...UNUSED_PHRASE };
      const projection = {};
      const result = await dbHelper.findOneInDatabase(database, collection, query, projection);

      if (result) {
        // It is present in our database
        if (+result.loginPhrase.substring(0, 13) < timestamp) {
          // Second verify that this address signed this message
          let valid = false;
          try {
            valid = signatureVerifier.verifySignature(message, address, signature);
          } catch (error) {
            throw new Error('Invalid signature');
          }
          if (valid) {
            // Third associate address with message in our database
            const createdAt = new Date(+result.loginPhrase.substring(0, 13));
            const validTill = +result.loginPhrase.substring(0, 13) + (14 * 24 * 60 * 60 * 1000); // valid for 14 days
            const expireAt = new Date(validTill);
            const newLogin = {
              zelid: address,
              loginPhrase: message,
              createdAt,
              expireAt,
            };
            const adminZelid = verificationHelperUtils.nodeOperatorZelid();
            if (!adminZelid) {
              // The node answers HTTP before it has read its own configuration, so
              // this window is reachable on any restart. Granting 'user' here would
              // hand the operator a session with their own rights stripped and no
              // indication why; refusing says what is true and costs one retry.
              throw new Error('Node is still starting and cannot establish privileges yet');
            }
            let privilage = PRIVILEGE_RESPONSE.USER;
            if (address === config.fluxTeamFluxID || verificationHelperUtils.isFluxSupportTeamZelid(address)) {
              privilage = PRIVILEGE_RESPONSE.FLUX_TEAM;
            } else if (address === adminZelid) {
              privilage = PRIVILEGE_RESPONSE.NODE_OPERATOR;
            }
            // A phrase signs in once: the login is written only by the request that
            // marked it used.
            triedPhrase = message;
            enterLogin(message);
            if (!await claimLoginPhrase(message)) {
              throw new Error('Signed message is no longer valid. Please request a new one.');
            }
            usedPhrase = message;
            // The signature is the session's credential. The login websocket hands it
            // to whoever holds the login phrase, so it is kept apart from the login,
            // in a collection whose TTL index expires it a minute after the login. It
            // is written first, so the websocket finds it as soon as it finds the login.
            await dbHelper.insertOneToDatabase(database, config.database.local.collections.loginSignatures, {
              loginPhrase: message,
              signature,
              createdAt: new Date(),
            });
            const loggedUsersCollection = config.database.local.collections.loggedUsers;
            const value = newLogin;
            await dbHelper.insertOneToDatabase(database, loggedUsersCollection, value);
            const resData = {
              message: 'Successfully logged in',
              zelid: address,
              loginPhrase: message,
              signature,
              privilage,
              createdAt,
              expireAt,
            };
            const resMessage = messageHelper.createDataMessage(resData);
            publishLoginOutcome(message, { data: resData });
            res.json(resMessage);
          } else {
            throw new Error('Invalid signature');
          }
        } else {
          throw new Error('Signed message is no longer valid. Please request a new one.');
        }
      } else {
        throw new Error('Signed message is no longer valid. Please request a new one.');
      }
    } catch (error) {
      log.error(error);
      const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
      if (usedPhrase) publishLoginOutcome(usedPhrase, { error: errMessage });
      res.json(errMessage);
    } finally {
      if (triedPhrase) leaveLogin(triedPhrase);
    }
  });
}

/**
 * To return a JSON response with a new signature for the user. A series of checks are performed on the Flux ID and signature.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function provideSign(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const address = processedBody.zelid || processedBody.address;
      const { signature } = processedBody;
      const message = processedBody.loginPhrase || processedBody.message;

      if (address === undefined || address === '') {
        throw new Error('No Flux ID is specified');
      }

      if (!signatureVerifier.isValidSigningIdentity(address)) {
        throw new Error('Flux ID is not valid');
      }

      if (message === undefined || message === '') {
        throw new Error('No message is specified');
      }

      if (message.length < 40) {
        throw new Error('Signed message is not valid');
      }

      if (signature === undefined || signature === '') {
        throw new Error('No signature is specified');
      }
      const timestamp = Date.now();
      const validTill = timestamp + (15 * 60 * 1000); // 15 minutes
      const identifier = address + message.slice(-13);

      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.activeSignatures;
      const newSignature = {
        signature,
        identifier,
        createdAt: new Date(timestamp),
        expireAt: new Date(validTill),
      };
      const value = newSignature;
      await dbHelper.insertOneToDatabase(database, collection, value);
      // all is ok
      const phraseResponse = messageHelper.createDataMessage(newSignature);
      res.json(phraseResponse);
    } catch (error) {
      log.error(error);
      const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errMessage);
    }
  });
}

/**
 * To return a JSON response with a list of active login phrases. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function activeLoginPhrases(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR, authOf(req));
    if (authorized === true) {
      const db = dbHelper.databaseConnection();

      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.activeLoginPhrases;
      const query = UNUSED_PHRASE;
      const projection = {
        projection: {
          _id: 0, loginPhrase: 1, createdAt: 1, expireAt: 1,
        },
      };
      const results = await dbHelper.findInDatabase(database, collection, query, projection);
      const resultsResponse = messageHelper.createDataMessage(results);
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return a JSON response with a list of logged in users. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function loggedUsers(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR, authOf(req));
    if (authorized === true) {
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const query = {};
      const projection = {
        projection: {
          _id: 0, zelid: 1, loginPhrase: 1, createdAt: 1, expireAt: 1,
        },
      };
      const results = await dbHelper.findInDatabase(database, collection, query, projection);
      const resultsResponse = messageHelper.createDataMessage(results);
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return a JSON response with a list of logged sessions. Only accessible by the Flux ID owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function loggedSessions(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.USER, authOf(req));
    if (authorized === true) {
      const db = dbHelper.databaseConnection();

      const auth = serviceHelper.ensureObject(authOf(req));
      const queryFluxID = auth.zelid;
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const query = { zelid: queryFluxID };
      const projection = {
        projection: {
          _id: 0, zelid: 1, loginPhrase: 1, createdAt: 1, expireAt: 1,
        },
      };
      const results = await dbHelper.findInDatabase(database, collection, query, projection);
      const resultsResponse = messageHelper.createDataMessage(results);
      res.json(resultsResponse);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return a JSON response to show the user if they have logged out of the current session successfully or not. Only accessible by the Flux ID owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function logoutCurrentSession(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.USER, authOf(req));
    if (authorized === true) {
      const auth = serviceHelper.ensureObject(authOf(req));
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
      const projection = {};
      await dbHelper.findOneAndDeleteInDatabase(database, collection, query, projection);
      // console.log(results)
      const message = messageHelper.createSuccessMessage('Successfully logged out');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return a JSON response to show the user if they have logged out of a specific session successfully or not. Only accessible by the Flux ID owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function logoutSpecificSession(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const authorized = await verificationHelper.verifyPrivilege(Privilege.USER, authOf(req));
      if (authorized === true) {
        const processedBody = serviceHelper.ensureObject(body);
        const obtainedLoginPhrase = processedBody.loginPhrase;
        const db = dbHelper.databaseConnection();
        const database = db.db(config.database.local.database);
        const collection = config.database.local.collections.loggedUsers;
        const query = { loginPhrase: obtainedLoginPhrase };
        const projection = {};
        const result = await dbHelper.findOneAndDeleteInDatabase(database, collection, query, projection);
        if (result.value === null) {
          const message = messageHelper.createWarningMessage('Specified user was already logged out');
          res.json(message);
        }
        const message = messageHelper.createSuccessMessage('Session successfully logged out');
        res.json(message);
      } else {
        const errMessage = messageHelper.errUnauthorizedMessage();
        res.json(errMessage);
      }
    } catch (error) {
      log.error(error);
      const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errMessage);
    }
  });
}

/**
 * To return a JSON response to show the user if they have logged out from all sessions successfully or not. Only accessible by the Flux ID owner.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function logoutAllSessions(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.USER, authOf(req));
    if (authorized === true) {
      const auth = serviceHelper.ensureObject(authOf(req));
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const query = { zelid: auth.zelid };
      await dbHelper.removeDocumentsFromCollection(database, collection, query);
      // console.log(result)
      const message = messageHelper.createSuccessMessage('Successfully logged out all sessions');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To return a JSON response to show the admin user if they have logged out all users successfully or not. Only accessible by admins.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function logoutAllUsers(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR, authOf(req));
    if (authorized === true) {
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const query = {};
      await dbHelper.removeDocumentsFromCollection(database, collection, query);
      const message = messageHelper.createSuccessMessage('Successfully logged out all users');
      res.json(message);
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * Answers a login page waiting on its phrase: with the login once the phrase signs
 * in, or with why it no longer can. The answer is the outcome verifyLogin
 * publishes for the phrase; a page that connects after the login reads it instead.
 * A page waiting on a used phrase reads again once no login is counted against it.
 * @param {object} ws Web socket.
 * @param {string} loginphrase
 */
async function wsRespondLoginPhrase(ws, loginphrase) {
  let settled = false;
  let expiry = null;
  const noLongerValid = () => messageHelper.createErrorMessage('Signed message is no longer valid. Please request a new one.');
  const database = dbHelper.databaseConnection().db(config.database.local.database);
  const query = { loginPhrase: loginphrase };

  function stop() {
    settled = true;
    loginOutcomes.removeListener(loginphrase, onOutcome);
    clearTimeout(expiry);
  }
  function finish(message, code) {
    if (settled) return;
    stop();
    try {
      ws.send(qs.stringify(message));
      ws.close(code);
    } catch (error) {
      log.error(error);
    }
  }

  // Reads what the phrase has come to and answers it, or waits for the login that
  // is to use it.
  async function decide() {
    let login;
    try {
      login = await dbHelper.findOneInDatabase(database, config.database.local.collections.loggedUsers, query, {});
    } catch (error) {
      log.error(error);
      finish(messageHelper.createErrorMessage(error.message, error.name, error.code), 4011);
      return;
    }
    if (settled) return;
    if (login) {
      try {
        const loginSignature = await dbHelper.findOneInDatabase(database, config.database.local.collections.loginSignatures, query, {});
        const adminZelid = verificationHelperUtils.nodeOperatorZelid();
        if (!adminZelid) {
          throw new Error('Node is still starting and cannot establish privileges yet');
        }
        let privilage = PRIVILEGE_RESPONSE.USER;
        if (login.zelid === config.fluxTeamFluxID || verificationHelperUtils.isFluxSupportTeamZelid(login.zelid)) {
          privilage = PRIVILEGE_RESPONSE.FLUX_TEAM;
        } else if (login.zelid === adminZelid) {
          privilage = PRIVILEGE_RESPONSE.NODE_OPERATOR;
        }
        finish(messageHelper.createDataMessage({
          message: 'Successfully logged in',
          zelid: login.zelid,
          loginPhrase: login.loginPhrase,
          signature: loginSignature ? loginSignature.signature : undefined,
          privilage,
          createdAt: login.createdAt,
          expireAt: login.expireAt,
        }), 4012);
      } catch (error) {
        log.error(error);
        finish(messageHelper.createErrorMessage(error.message, error.name, error.code), 4011);
      }
      return;
    }

    let phrase;
    try {
      phrase = await dbHelper.findOneInDatabase(database, config.database.local.collections.activeLoginPhrases, query, {});
    } catch (error) {
      log.error(error);
      finish(messageHelper.createErrorMessage(error.message, error.name, error.code), 4013);
      return;
    }
    if (settled) return;
    // A phrase never issued, or expired, no login will use. A used one with no login
    // counted against it ended without the login read above. A login still counted
    // publishes how it ends.
    if (!phrase || (phrase.usedAt && !loginsInProgress.has(loginphrase))) {
      finish(noLongerValid());
      return;
    }
    if (expiry) return;
    const issuedAt = +loginphrase.substring(0, 13);
    expiry = setTimeout(() => finish(noLongerValid()), Math.max(issuedAt + LOGIN_PHRASE_VALID_MS - Date.now(), 0));
    if (expiry.unref) expiry.unref();
  }

  function onOutcome({ data, error, ended }) {
    if (ended) {
      if (!settled) decide();
      return;
    }
    if (data) finish(messageHelper.createDataMessage(data), 4012);
    else finish(error);
  }

  // eslint-disable-next-line no-param-reassign
  ws.onclose = stop;
  // eslint-disable-next-line no-param-reassign
  ws.onerror = (evt) => {
    log.error(evt.code);
    stop();
  };
  // before the reads, so a login that finishes while they run is not missed
  loginOutcomes.on(loginphrase, onOutcome);
  await decide();
}

/**
 * To check if a signature exists.
 * @param {object} ws Web socket.
 * @param {object} req Request.
 */
async function wsRespondSignature(ws, message) {
  console.log(message);

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

  const db = dbHelper.databaseConnection();

  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.activeSignatures;
  const query = { identifier: message };
  const projection = {};
  async function searchDatabase() {
    try {
      const result = await dbHelper.findOneInDatabase(database, collection, query, projection).catch((error) => {
        const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
        ws.send(qs.stringify(errMessage));
        ws.close(4014);
        throw error;
      });

      if (result) {
        // signature exists
        const response = messageHelper.createDataMessage(result);
        if (!connclosed) {
          try {
            ws.send(qs.stringify(response));
            ws.close(4015);
          } catch (e) {
            log.error(e);
          }
        }
      } else {
        setTimeout(() => {
          if (!connclosed) {
            searchDatabase();
          }
        }, 500);
      }
    } catch (error) {
      log.error(error);
    }
  }
  searchDatabase();
}

/**
 * To check the privilege level a user (Flux ID). The privilege level is either admin, flux team or user.
 * @param {object} req Request.
 * @param {object} res Response.
 */

async function checkLoggedUser(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      const { zelid, signature } = processedBody;
      const loggedPhrase = processedBody.loginPhrase;
      if (!zelid) {
        throw new Error('No user Flux ID specificed');
      }
      if (!loggedPhrase) {
        throw new Error('No user loginPhrase specificed');
      }
      if (!signature) {
        throw new Error('No user Flux ID signature specificed');
      }
      // Serialised because a privilege check takes the header's value, and a
      // header value is a string. ensureObject parses it back on the other side.
      const zelidauth = JSON.stringify({ zelid, loginPhrase: loggedPhrase, signature });
      const isAdmin = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR, zelidauth);
      if (isAdmin) {
        const message = messageHelper.createSuccessMessage(PRIVILEGE_RESPONSE.NODE_OPERATOR);
        res.json(message);
        return;
      }
      const isFluxTeam = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, zelidauth);
      if (isFluxTeam) {
        const message = messageHelper.createSuccessMessage(PRIVILEGE_RESPONSE.FLUX_TEAM);
        res.json(message);
        return;
      }
      const isUser = await verificationHelper.verifyPrivilege(Privilege.USER, zelidauth);
      if (isUser) {
        const message = messageHelper.createSuccessMessage(PRIVILEGE_RESPONSE.USER);
        res.json(message);
        return;
      }
      const message = messageHelper.createErrorMessage(PRIVILEGE_RESPONSE.NONE);
      res.json(message);
    } catch (error) {
      log.error(error);
      // `message` stays inside the PRIVILEGE_RESPONSE contract even here, because
      // the frontend reads it AS the privilege whether the status says success or
      // error, and logs the user out on exactly 'none' (fluxos-frontend
      // guards.js). A thrown error's text landing in that field set the privilege
      // to something like 'No user Flux ID specificed' - not 'none' - so the stale
      // zelidauth stayed in localStorage instead of being cleared, and every later
      // navigation repeated the same failure. Access still failed closed, since no
      // route's privilege list contains an error string, but the session never
      // ended.
      //
      // The error is not lost. It is logged above, and `name`/`code` still
      // separate a failure from a plain refusal, which carries neither.
      const errMessage = messageHelper.createErrorMessage(PRIVILEGE_RESPONSE.NONE, error.name, error.code);
      res.json(errMessage);
    }
  });
}

module.exports = {
  PRIVILEGE_RESPONSE,
  loginPhrase,
  emergencyPhrase,
  verifyLogin,
  provideSign,
  activeLoginPhrases,
  loggedUsers,
  loggedSessions,
  logoutCurrentSession,
  logoutSpecificSession,
  logoutAllSessions,
  logoutAllUsers,
  wsRespondLoginPhrase,
  wsRespondSignature,
  checkLoggedUser,
};
