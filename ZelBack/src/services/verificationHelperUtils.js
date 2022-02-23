/**
 * @module
 * Contains utility functions to be used only by verificationHelper.
 * To verify privilege use verifyPrivilege from verificationHelper module.
 */

const config = require('config');
const bitcoinMessage = require('bitcoinjs-message');
const serviceHelper = require('./serviceHelper');
const userconfig = require('../../../config/userconfig');

/**
 * Verifies admin session
 * @param {object} headers
 *
 * @returns {Promise<boolean>}
 */
async function verifyAdminSession(headers) {
  if (!headers || !headers.zelidauth) return false;
  const auth = serviceHelper.ensureObject(headers.zelidauth);
  if (!auth.zelid || !auth.signature) return false;
  if (auth.zelid !== userconfig.initial.zelid) return false;

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await serviceHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;

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
  return false;
}

/**
 * Verifies user session
 * @param {object} headers
 *
 * @returns {Promise<boolean>}
 */
async function verifyUserSession(headers) {
  if (!headers || !headers.zelidauth) return false;
  const auth = serviceHelper.ensureObject(headers.zelidauth);
  if (!auth.zelid || !auth.signature) return false;

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await serviceHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;

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
  return false;
}

/**
 * Verifies flux team session
 * @param {object} headers
 *
 * @returns {Promise<boolean>}
 */
async function verifyFluxTeamSession(headers) {
  if (!headers || !headers.zelidauth) return false;
  const auth = serviceHelper.ensureObject(headers.zelidauth);
  if (!auth.zelid || !auth.signature) return false;
  if (auth.zelid !== config.fluxTeamZelId) return false;

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
  const projection = {};
  const result = await serviceHelper.findOneInDatabase(database, collection, query, projection);
  const loggedUser = result;
  if (!loggedUser) return false;
  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
  } catch (error) {
    return false;
  }
  if (valid) {
    // now we know this is indeed a logged fluxteam
    return true;
  }
  return false;
}

/**
 * Verifies admin or flux team session
 * @param {object} headers
 *
 * @returns {Promise<boolean>}
 */
async function verifyAdminAndFluxTeamSession(headers) {
  if (!headers || !headers.zelidauth) return false;
  const auth = serviceHelper.ensureObject(headers.zelidauth);
  if (!auth.zelid || !auth.signature) return false;
  if (auth.zelid !== config.fluxTeamZelId && auth.zelid !== userconfig.initial.zelid) return false; // admin is considered as fluxTeam

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await serviceHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
  } catch (error) {
    return false;
  }
  if (valid) {
    // now we know this is indeed a logged admin or fluxteam
    return true;
  }
  return false;
}

/**
 * Verifies app owner session
 * @param {object} headers
 *
 * @returns {Promise<boolean>}
 */
async function verifyAppOwnerSession(headers, appName) {
  if (!headers || !headers.zelidauth || !appName) return false;
  const auth = serviceHelper.ensureObject(headers.zelidauth);
  if (!auth.zelid || !auth.signature) return false;
  const ownerZelID = await serviceHelper.getApplicationOwner(appName);
  if (auth.zelid !== ownerZelID) return false;

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await serviceHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;
  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
  } catch (error) {
    return false;
  }
  if (valid) {
    // now we know this is indeed a logged application owner
    return true;
  }
  return false;
}

/**
 * Verifies app owner (or higher privilege) session
 * @param {object} headers
 *
 * @returns {Promise<boolean>}
 */
async function verifyAppOwnerOrHigherSession(headers, appName) {
  if (!headers || !headers.zelidauth || !appName) return false;
  const auth = serviceHelper.ensureObject(headers.zelidauth);
  if (!auth.zelid || !auth.signature) return false;
  const ownerZelID = await serviceHelper.getApplicationOwner(appName);
  if (auth.zelid !== ownerZelID && auth.zelid !== config.fluxTeamZelId && auth.zelid !== userconfig.initial.zelid) return false;

  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ signature: auth.signature }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await serviceHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = bitcoinMessage.verify(loggedUser.loginPhrase, auth.zelid, auth.signature);
  } catch (error) {
    return false;
  }
  if (valid) {
    // now we know this is indeed a logged application owner
    return true;
  }
  return false;
}

module.exports = {
  verifyAdminAndFluxTeamSession,
  verifyAdminSession,
  verifyAppOwnerOrHigherSession,
  verifyAppOwnerSession,
  verifyFluxTeamSession,
  verifyUserSession,
};
