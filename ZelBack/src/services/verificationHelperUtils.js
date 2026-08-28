/**
 * @module
 * Contains utility functions to be used only by verificationHelper.
 * To verify privilege use verifyPrivilege from verificationHelper module.
 */

const config = require('config');
const signatureVerifier = require('./signatureVerifier');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const configManager = require('./utils/configManager');
// Removed registryManager to avoid circular dependency - will use dynamic require where needed

/**
 * The Flux ID this node's operator administers it with, or null when the node
 * has not read its own configuration yet.
 *
 * Read through configManager rather than off globalThis. The manager loads the
 * file in its own constructor, so requiring it is what guarantees the config has
 * been read at all - a module that only reads the global is relying on some other
 * module having imported the manager first, and a privilege check that runs before
 * that import sees nothing and throws.
 *
 * Null still has to be handled, because a load that fails installs defaults
 * carrying no zelid rather than a config. It is the only safe answer there: a
 * comparison against an identity we do not hold must fail rather than pass, and
 * must never quietly resolve the caller to a lesser privilege as though the
 * question had been answered. Callers that grant privileges on the result
 * therefore refuse outright while it is null.
 *
 * @returns {string|null}
 */
function nodeAdminZelid() {
  return configManager.getConfigValue('initial.zelid') ?? null;
}

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
  if (auth.zelid !== nodeAdminZelid()) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = signatureVerifier.verifySignature(auth.loginPhrase, auth.zelid, auth.signature);
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
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  // if not logged, check if not older than 16 hours
  if (!loggedUser) {
    const timestamp = Date.now();
    const message = auth.loginPhrase;
    const maxHours = 16 * 60 * 60 * 1000;
    if (Number(message.substring(0, 13)) < (timestamp - maxHours) || Number(message.substring(0, 13)) > timestamp || message.length > 70 || message.length < 40) {
      return false;
    }
  }

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = signatureVerifier.verifySignature(auth.loginPhrase, auth.zelid, auth.signature);
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
  if (auth.zelid !== config.fluxTeamFluxID && auth.zelid !== config.fluxSupportTeamFluxID) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const result = await dbHelper.findOneInDatabase(database, collection, query, projection);
  const loggedUser = result;
  if (!loggedUser) return false;
  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = signatureVerifier.verifySignature(auth.loginPhrase, auth.zelid, auth.signature);
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
  if (auth.zelid !== config.fluxTeamFluxID && auth.zelid !== nodeAdminZelid() && auth.zelid !== config.fluxSupportTeamFluxID) return false; // admin is considered as fluxTeam

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  if (!loggedUser) return false;
  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = signatureVerifier.verifySignature(auth.loginPhrase, auth.zelid, auth.signature);
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
  // Use dynamic require to avoid circular dependency
  // eslint-disable-next-line global-require
  const registryManager = require('./appDatabase/registryManager');
  const ownerFluxID = await registryManager.getApplicationOwner(appName);
  if (auth.zelid !== ownerFluxID) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  // if not logged, check if not older than 2 hours
  if (!loggedUser) {
    const timestamp = Date.now();
    const message = auth.loginPhrase;
    const twoHours = 2 * 60 * 60 * 1000;
    if (Number(message.substring(0, 13)) < (timestamp - twoHours) || Number(message.substring(0, 13)) > timestamp || message.length > 70 || message.length < 40) {
      return false;
    }
  }
  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = signatureVerifier.verifySignature(auth.loginPhrase, auth.zelid, auth.signature);
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
  // Use dynamic require to avoid circular dependency
  // eslint-disable-next-line global-require
  const registryManager = require('./appDatabase/registryManager');
  const ownerFluxID = await registryManager.getApplicationOwner(appName);
  if (auth.zelid !== ownerFluxID && auth.zelid !== config.fluxTeamFluxID && auth.zelid !== nodeAdminZelid() && auth.zelid !== config.fluxSupportTeamFluxID) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  // if not logged, check if not older than 2 hours
  if (!loggedUser) {
    const timestamp = Date.now();
    const message = auth.loginPhrase;
    const maxHours = 2 * 60 * 60 * 1000;
    if (Number(message.substring(0, 13)) < (timestamp - maxHours) || Number(message.substring(0, 13)) > timestamp || message.length > 70 || message.length < 40) {
      return false;
    }
  }

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = signatureVerifier.verifySignature(auth.loginPhrase, auth.zelid, auth.signature);
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
 * Verifies an app-owner or flux-team session: the app's owner and the flux team,
 * but NOT the node operator.
 *
 * This is the gate for every verb that decides whether someone else's app runs,
 * or whether it keeps its data - start, stop, restart, kill, redeploy and remove.
 * verifyAppOwnerOrHigherSession admits the node's own admin as well, which these
 * must not.
 *
 * The operator has no run-state case to make. An app cannot exceed what was
 * bought - dockerService sets NanoCPUs and Memory/MemorySwap on the container
 * from the spec - so an app inside its allocation is spending cycles the operator
 * sold, and an app outside one is a containment defect to fix in the limits
 * rather than to paper over on a single node with a button. And the operator is
 * paid whether the container runs or not, so a per-app stop withholds the service
 * and keeps the payment. Stopping FluxOS is the honest lever precisely because it
 * forfeits the payment along with the obligation.
 *
 * @param {object} headers
 * @param {string} appName
 * @returns {Promise<boolean>} authorized
 */
async function verifyAppOwnerOrFluxTeamSession(headers, appName) {
  if (!headers || !headers.zelidauth || !appName) return false;
  const auth = serviceHelper.ensureObject(headers.zelidauth);
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  // Use dynamic require to avoid circular dependency
  // eslint-disable-next-line global-require
  const registryManager = require('./appDatabase/registryManager');
  const ownerFluxID = await registryManager.getApplicationOwner(appName);
  if (auth.zelid !== ownerFluxID && auth.zelid !== config.fluxTeamFluxID && auth.zelid !== config.fluxSupportTeamFluxID) return false;

  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  const collection = config.database.local.collections.loggedUsers;
  const query = { $and: [{ loginPhrase: auth.loginPhrase }, { zelid: auth.zelid }] };
  const projection = {};
  const loggedUser = await dbHelper.findOneInDatabase(database, collection, query, projection);
  // if not logged, check if not older than 2 hours
  if (!loggedUser) {
    const timestamp = Date.now();
    const message = auth.loginPhrase;
    const maxHours = 2 * 60 * 60 * 1000;
    if (Number(message.substring(0, 13)) < (timestamp - maxHours) || Number(message.substring(0, 13)) > timestamp || message.length > 70 || message.length < 40) {
      return false;
    }
  }

  // check if signature corresponds to message with that zelid
  let valid = false;
  try {
    valid = signatureVerifier.verifySignature(auth.loginPhrase, auth.zelid, auth.signature);
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
  nodeAdminZelid,
  verifyAdminAndFluxTeamSession,
  verifyAdminSession,
  verifyAppOwnerOrFluxTeamSession,
  verifyAppOwnerOrHigherSession,
  verifyAppOwnerSession,
  verifyFluxTeamSession,
  verifyUserSession,
};
