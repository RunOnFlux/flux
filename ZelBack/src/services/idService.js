const config = require('config');
const qs = require('qs');
const os = require('os');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');
const verificationHelper = require('./verificationHelper');
const verificationHelperUtils = require('./verificationHelperUtils');
const generalService = require('./generalService');
const dockerService = require('./dockerService');
const syncthingService = require('./syncthingService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const appInspector = require('./appManagement/appInspector');
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

let syncthingWorking = false;

/**
 * To check if the hardware specification requirements of the node tier are being met by the node (RAM and CPU threads).
 * @returns {boolean} True or an error is thrown.
 */
async function confirmNodeTierHardware() {
  try {
    const tier = await generalService.nodeTier().catch((error) => {
      log.error(error);
    });

    const collateral = await generalService.nodeCollateral().catch((error) => {
      log.error(error);
    });
    const nodeRam = os.totalmem() / 1024 / 1024 / 1024;
    const nodeCpuThreads = os.cpus().length;
    log.info(`Node Tier: ${tier}`);
    log.info(`Node Collateral: ${collateral}`);
    log.info(`Node Total Ram: ${nodeRam}`);
    log.info(`Node Cpu Threads: ${nodeCpuThreads}`);
    if (tier === 'bamf' && collateral === 100000) {
      if (nodeRam < 30) {
        throw new Error(`Node Total Ram (${nodeRam}) below Stratus requirements`);
      }
      if (nodeCpuThreads < 8) {
        throw new Error(`Node Cpu Threads (${nodeCpuThreads}) below Stratus requirements`);
      }
    } else if (tier === 'super' && collateral === 25000) {
      if (nodeRam < 7) {
        throw new Error(`Node Total Ram (${nodeRam}) below Nimbus requirements`);
      }
      if (nodeCpuThreads < 4) {
        throw new Error(`Node Cpu Threads (${nodeCpuThreads}) below Nimbus requirements`);
      }
    } else if (tier === 'basic' && collateral === 10000) {
      if (nodeRam < 3) {
        throw new Error(`Node Total Ram (${nodeRam}) below Cumulus requirements`);
      }
      if (nodeCpuThreads < 2) {
        throw new Error(`Node Cpu Threads (${nodeCpuThreads}) below Cumulus requirements`);
      }
    } else if (tier === 'bamf' && collateral === 40000) {
      if (nodeRam < 61) {
        throw new Error(`Node Total Ram (${nodeRam}) below new Stratus requirements`);
      }
      if (nodeCpuThreads < 16) {
        throw new Error(`Node Cpu Threads (${nodeCpuThreads}) below new Stratus requirements`);
      }
    } else if (tier === 'super' && collateral === 12500) {
      if (nodeRam < 30) {
        throw new Error(`Node Total Ram (${nodeRam}) below new Nimbus requirements`);
      }
      if (nodeCpuThreads < 8) {
        throw new Error(`Node Cpu Threads (${nodeCpuThreads}) below new Nimbus requirements`);
      }
    } else if (tier === 'basic' && collateral === 1000) {
      if (nodeRam < 3) {
        throw new Error(`Node Total Ram (${nodeRam}) below new Cumulus requirements`);
      }
      if (nodeCpuThreads < 4) {
        throw new Error(`Node Cpu Threads (${nodeCpuThreads}) below new Cumulus requirements`);
      }
    }
    return true;
  } catch (error) {
    log.error(error);
    return false;
  }
}

/**
 * To return a JSON response with the user's login phrase.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
let firstLoginPhraseExecution = true;
async function loginPhrase(req, res) {
  try {
    // check db
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activeLoginPhrases;
    const query = { loginPhrase: 'TestLoginPhraseForDBTest' };
    const projection = {};
    await dbHelper.findOneInDatabase(database, collection, query, projection); // fast find call for db test

    // check synthing availability
    if (!syncthingService.isRunning() && !firstLoginPhraseExecution) {
      if (syncthingWorking) {
        syncthingWorking = false;
      } else {
        throw new Error('Syncthing is not running properly');
      }
    } else {
      syncthingWorking = true;
    }
    firstLoginPhraseExecution = false;
    // check docker availablility
    await dockerService.dockerListImages();
    // check Node Hardware Requirements are ok.
    const hwPassed = await confirmNodeTierHardware();
    if (hwPassed === false) {
      throw new Error('Node hardware requirements not met');
    }
    // check DOS state (contains daemon checks)
    const dosState = fluxNetworkHelper.getDOSState();
    if (dosState.status === 'error') {
      const errorMessage = 'Unable to check DOS state';
      const errMessage = messageHelper.createErrorMessage(errorMessage);
      res.json(errMessage);
      return;
    }
    if (dosState.status === 'success') {
      // nodeHardwareSpecsGood is not part of response yet
      if (dosState.data.dosState > 10 || dosState.data.dosMessage !== null || dosState.data.nodeHardwareSpecsGood === false) {
        let errMessage = messageHelper.createErrorMessage(dosState.data.dosMessage, 'DOS', dosState.data.dosState);
        if (dosState.data.dosMessage !== 'Flux IP detection failed' && dosState.data.dosMessage !== 'Flux collision detection. Another ip:port is confirmed on flux network with the same collateral transaction information.') {
          errMessage = messageHelper.createErrorMessage(dosState.data.dosMessage, 'CONNERROR', dosState.data.dosState);
        }
        if (dosState.data.nodeHardwareSpecsGood === false) {
          errMessage = messageHelper.createErrorMessage('Minimum hardware required for FluxNode tier not met', 'DOS', 100);
        }
        res.json(errMessage);
        return;
      }
    }

    // check Apps DOS state
    const dosAppsState = appInspector.getAppsDOSState();
    if (dosAppsState.status === 'success') {
      // nodeHardwareSpecsGood is not part of response yet
      if (dosAppsState.data.dosState >= 100) {
        const errMessage = messageHelper.createErrorMessage(dosAppsState.data.dosMessage, 'DOS', dosAppsState.data.dosState);
        log.error(errMessage);
        res.json(errMessage);
        return;
      }
    }

    const timestamp = Date.now();
    const validTill = timestamp + (15 * 60 * 1000); // 15 minutes
    const phrase = timestamp + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    /* const activeLoginPhrases = [
       {
         loginPhrase: 1565356121335e9obp7h17bykbbvub0ts488wnnmd12fe1pq88mq0v,
         createdAt: 2019-08-09T13:08:41.335Z,
         expireAt: 2019-08-09T13:23:41.335Z
       }
    ] */
    // insert to db
    const newLoginPhrase = {
      loginPhrase: phrase,
      createdAt: new Date(timestamp),
      expireAt: new Date(validTill),
    };
    const value = newLoginPhrase;
    await dbHelper.insertOneToDatabase(database, collection, value);

    // all is ok
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
    const validTill = timestamp + (15 * 60 * 1000); // 15 minutes
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
      const query = { loginPhrase: message };
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
              signature,
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
            res.json(resMessage);
            deleteLoginPhrase(message);
            setTimeout(async () => {
              // after 1 minute remove signature from database
              const updatedDocument = {
                signature: '',
              };
              const update = { $unset: updatedDocument };
              const options = {
                upsert: false,
              };
              await dbHelper.updateOneInDatabase(database, loggedUsersCollection, query, update, options);
            }, 60000);
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
      res.json(errMessage);
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
      const query = {};
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
 * To check if a login phrase is currently active. The user's Flux ID, login phrase, signature and privilege level are returned if the login phrase is active.
 * @param {object} ws Web socket.
 * @param {object} req Request.
 */
async function wsRespondLoginPhrase(ws, loginphrase) {
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
  const db = dbHelper.databaseConnection();

  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { loginPhrase: loginphrase };
  const projection = {};
  // eslint-disable-next-line no-inner-declarations
  async function searchDatabase() {
    try {
      const result = await dbHelper.findOneInDatabase(database, collection, query, projection).catch((error) => {
        const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
        ws.send(qs.stringify(errMessage));
        ws.close(4011);
        throw error;
      });
      if (result) {
        // user is logged, all ok
        const adminZelid = verificationHelperUtils.nodeOperatorZelid();
        if (!adminZelid) {
          throw new Error('Node is still starting and cannot establish privileges yet');
        }
        let privilage = PRIVILEGE_RESPONSE.USER;
        if (result.zelid === config.fluxTeamFluxID || verificationHelperUtils.isFluxSupportTeamZelid(result.zelid)) {
          privilage = PRIVILEGE_RESPONSE.FLUX_TEAM;
        } else if (result.zelid === adminZelid) {
          privilage = PRIVILEGE_RESPONSE.NODE_OPERATOR;
        }
        const resData = {
          message: 'Successfully logged in',
          zelid: result.zelid,
          loginPhrase: result.loginPhrase,
          signature: result.signature,
          privilage,
          createdAt: result.createdAt,
          expireAt: result.expireAt,
        };
        const message = messageHelper.createDataMessage(resData);
        if (!connclosed) {
          try {
            ws.send(qs.stringify(message));
            ws.close(4012);
          } catch (e) {
            log.error(e);
          }
        }
      } else {
        // check if this loginPhrase is still active. If so rerun this searching process
        const activeLoginPhrasesCollection = config.database.local.collections.activeLoginPhrases;
        const resultB = await dbHelper.findOneInDatabase(database, activeLoginPhrasesCollection, query, projection).catch((error) => {
          const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
          ws.send(qs.stringify(errMessage));
          ws.close(4013);
          throw error;
        });
        if (resultB) {
          setTimeout(() => {
            if (!connclosed) {
              searchDatabase();
            }
          }, 500);
        } else {
          const errMessage = messageHelper.createErrorMessage('Signed message is no longer valid. Please request a new one.');
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
    } catch (error) {
      log.error(error);
    }
  }
  searchDatabase();
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

  // exports for testing purposes
  confirmNodeTierHardware,
};
