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
function nodeOperatorZelid() {
  return configManager.getConfigValue('initial.zelid') ?? null;
}

/**
 * The Flux IDs the support team holds, as a list.
 *
 * The config value is a list so support can be granted to more than one identity
 * without a code change, but it is read defensively: a node whose own config still
 * carries the single string this used to be must keep working, and reading that
 * string as though it were an array would match nothing and lock support out of
 * the node entirely rather than fail visibly.
 *
 * Falsy entries are dropped. An empty or missing value yields an empty list, which
 * is the safe answer - it grants no one.
 *
 * @returns {string[]}
 */
function fluxSupportTeamZelids() {
  const configured = config.fluxSupportTeamFluxID;
  if (Array.isArray(configured)) return configured.filter(Boolean);
  return configured ? [configured] : [];
}

/**
 * Whether a Flux ID belongs to the support team.
 *
 * @param {string} zelid
 * @returns {boolean}
 */
function isFluxSupportTeamZelid(zelid) {
  return Boolean(zelid) && fluxSupportTeamZelids().includes(zelid);
}

/**
 * Verifies admin session
 * @param {string|object} zelidauth - the value of the zelidauth header
 *
 * @returns {Promise<boolean>}
 */
async function verifyNodeOperatorSession(zelidauth) {
  if (!zelidauth) return false;
  const auth = serviceHelper.ensureObject(zelidauth);
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  if (auth.zelid !== nodeOperatorZelid()) return false;

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
 * @param {string|object} zelidauth - the value of the zelidauth header
 *
 * @returns {Promise<boolean>}
 */
async function verifyUserSession(zelidauth) {
  if (!zelidauth) return false;
  const auth = serviceHelper.ensureObject(zelidauth);
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
 * @param {string|object} zelidauth - the value of the zelidauth header
 *
 * @returns {Promise<boolean>}
 */
async function verifyFluxTeamSession(zelidauth) {
  if (!zelidauth) return false;
  const auth = serviceHelper.ensureObject(zelidauth);
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  if (auth.zelid !== config.fluxTeamFluxID && !isFluxSupportTeamZelid(auth.zelid)) return false;

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
 * @param {string|object} zelidauth - the value of the zelidauth header
 *
 * @returns {Promise<boolean>}
 */
async function verifyNodeOperatorOrFluxTeamSession(zelidauth) {
  if (!zelidauth) return false;
  const auth = serviceHelper.ensureObject(zelidauth);
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  if (auth.zelid !== config.fluxTeamFluxID && auth.zelid !== nodeOperatorZelid() && !isFluxSupportTeamZelid(auth.zelid)) return false; // admin is considered as fluxTeam

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
 * @param {string|object} zelidauth - the value of the zelidauth header
 *
 * @returns {Promise<boolean>}
 */
async function verifyAppOwnerSession(zelidauth, appName) {
  if (!zelidauth || !appName) return false;
  const auth = serviceHelper.ensureObject(zelidauth);
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
 * Verifies an app-owner or flux-team session: the app's owner and the flux team,
 * but NOT the node operator.
 *
 * This is the gate for every app-scoped endpoint: the verbs that decide whether
 * someone else's app runs or keeps its data - start, stop, restart, kill,
 * redeploy, remove, the volume operations and backup/restore - and everything
 * that discloses what is inside it - logs, inspect, stats, the process list, the
 * file listings and downloads, and a decrypted enterprise spec.
 *
 * The node operator is the node's own admin, so verifyNodeOperatorSession admits them
 * and this must not.
 *
 * Hosting an app is not owning it, and the two halves of that have the same
 * answer. On run state: an app cannot exceed what was bought - dockerService
 * sets NanoCPUs and Memory/MemorySwap on the container from the spec - so an app
 * inside its allocation is spending cycles the operator sold, and an app outside
 * one is a containment defect to fix in the limits rather than to paper over on
 * a single node with a button. The operator is paid whether the container runs
 * or not, so a per-app stop withholds the service and keeps the payment;
 * stopping FluxOS forfeits the payment along with the obligation, which is what
 * makes it the honest lever.
 *
 * On disclosure: hosting is a reason to know what an app COSTS you, which
 * /apps/appsresources answers unauthenticated and in aggregate. It is not a
 * reason to read the customer's environment variables, files or logs. That the
 * operator may also have local access to the disk is not an argument for
 * serving the same data over an authenticated API - remote, scriptable across a
 * fleet, and exposed with the operator's zelid rather than with their machine.
 *
 * @param {string|object} zelidauth - the value of the zelidauth header
 * @param {string} appName
 * @returns {Promise<boolean>} authorized
 */
async function verifyAppOwnerOrFluxTeamSession(zelidauth, appName) {
  if (!zelidauth || !appName) return false;
  const auth = serviceHelper.ensureObject(zelidauth);
  if (!auth.zelid || !auth.signature || !auth.loginPhrase) return false;
  // Use dynamic require to avoid circular dependency
  // eslint-disable-next-line global-require
  const registryManager = require('./appDatabase/registryManager');
  const ownerFluxID = await registryManager.getApplicationOwner(appName);
  if (auth.zelid !== ownerFluxID && auth.zelid !== config.fluxTeamFluxID && !isFluxSupportTeamZelid(auth.zelid)) return false;

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
  fluxSupportTeamZelids,
  isFluxSupportTeamZelid,
  nodeOperatorZelid,
  verifyNodeOperatorOrFluxTeamSession,
  verifyNodeOperatorSession,
  verifyAppOwnerOrFluxTeamSession,
  verifyAppOwnerSession,
  verifyFluxTeamSession,
  verifyUserSession,
};
