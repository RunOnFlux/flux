/**
 * @module
 * Contains utility functions to be used only by verificationHelper.
 * To verify privilege use verifyPrivilege from verificationHelper module.
 */

import pkg from 'config';
const { database: _database, fluxTeamZelId } = pkg;
import { verify } from 'bitcoinjs-message';
import serviceHelper from './serviceHelper.js';
import dbHelper from './dbHelper.js';
import { initial } from '../../../config/userconfig.js';

/**
 * Verifies admin session
 * @param {object} headers
 *
 * @returns {Promise<boolean>}
 */
async function verifyAdminSession(headers) {
  if (!headers || !headers.zelidauth) return false;
  const auth = serviceHelper.ensureObject(headers.zelidauth);
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  if (auth.zelid !== initial.zelid) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(_database.local.database);
  const collection = _database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = verify(auth.loginPhrase, auth.zelid, auth.signature);
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
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(_database.local.database);
  const collection = _database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  // if not logged, check if not older than 16 hours
  if (!loggedUser) {
    const timestamp = new Date().getTime();
    const message = auth.loginPhrase;
    const maxHours = 16 * 60 * 60 * 1000;
    if (Number(message.substring(0, 13)) < (timestamp - maxHours) || Number(message.substring(0, 13)) > timestamp || message.length > 70 || message.length < 40) {
      return false;
    }
  }

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = verify(auth.loginPhrase, auth.zelid, auth.signature);
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
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  if (auth.zelid !== fluxTeamZelId) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(_database.local.database);
  const collection = _database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const result = await dbHelper.findOneInDatabase(database, collection, query, projection);
  const loggedUser = result;
  if (!loggedUser) return false;
  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = verify(auth.loginPhrase, auth.zelid, auth.signature);
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
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  if (auth.zelid !== fluxTeamZelId && auth.zelid !== initial.zelid) return false; // admin is considered as fluxTeam

  const db = dbHelper.databaseConnection();
  const database = db.db(_database.local.database);
  const collection = _database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = verify(auth.loginPhrase, auth.zelid, auth.signature);
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
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  const ownerZelID = await serviceHelper.getApplicationOwner(appName);
  if (auth.zelid !== ownerZelID) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(_database.local.database);
  const collection = _database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  // if not logged, check if not older than 2 hours
  if (!loggedUser) {
    const timestamp = new Date().getTime();
    const message = auth.loginPhrase;
    const twoHours = 2 * 60 * 60 * 1000;
    if (Number(message.substring(0, 13)) < (timestamp - twoHours) || Number(message.substring(0, 13)) > timestamp || message.length > 70 || message.length < 40) {
      return false;
    }
  }
  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = verify(auth.loginPhrase, auth.zelid, auth.signature);
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
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  const ownerZelID = await serviceHelper.getApplicationOwner(appName);
  if (auth.zelid !== ownerZelID && auth.zelid !== fluxTeamZelId && auth.zelid !== initial.zelid) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(_database.local.database);
  const collection = _database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  // if not logged, check if not older than 2 hours
  if (!loggedUser) {
    const timestamp = new Date().getTime();
    const message = auth.loginPhrase;
    const maxHours = 2 * 60 * 60 * 1000;
    if (Number(message.substring(0, 13)) < (timestamp - maxHours) || Number(message.substring(0, 13)) > timestamp || message.length > 70 || message.length < 40) {
      return false;
    }
  }

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = verify(auth.loginPhrase, auth.zelid, auth.signature);
  } catch (error) {
    return false;
  }
  if (valid) {
    // now we know this is indeed a logged application owner
    return true;
  }
  return false;
}

export {
  verifyAdminAndFluxTeamSession,
  verifyAdminSession,
  verifyAppOwnerOrHigherSession,
  verifyAppOwnerSession,
  verifyFluxTeamSession,
  verifyUserSession,
};
