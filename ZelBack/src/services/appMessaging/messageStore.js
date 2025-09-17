const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const {
  globalAppsMessages,
  globalAppsTempMessages,
  globalAppsLocations,
  globalAppsInstallingLocations
} = require('../utils/appConstants');

/**
 * Store temporary app message
 * @param {object} message - Message to store
 * @param {boolean} furtherVerification - Whether further verification is needed
 * @returns {Promise<object>} Storage result
 */
async function storeAppTemporaryMessage(message, furtherVerification = false) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    // Add timestamp and verification status
    const messageToStore = {
      ...message,
      storedAt: Date.now(),
      furtherVerification: furtherVerification || false,
    };

    await dbHelper.insertOneToDatabase(database, globalAppsTempMessages, messageToStore);

    log.info(`Temporary app message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Temporary message stored' };
  } catch (error) {
    log.error(`Error storing temporary app message: ${error.message}`);
    throw error;
  }
}

/**
 * Store permanent app message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppPermanentMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const messageToStore = {
      ...message,
      storedAt: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsMessages, messageToStore);

    log.info(`Permanent app message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Permanent message stored' };
  } catch (error) {
    log.error(`Error storing permanent app message: ${error.message}`);
    throw error;
  }
}

/**
 * Store app running message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppRunningMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const locationMessage = {
      ...message,
      status: 'running',
      timestamp: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsLocations, locationMessage);

    log.info(`App running message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Running message stored' };
  } catch (error) {
    log.error(`Error storing app running message: ${error.message}`);
    throw error;
  }
}

/**
 * Store app installing message
 * @param {object} message - Message to store
 * @returns {Promise<object>} Storage result
 */
async function storeAppInstallingMessage(message) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const installingMessage = {
      ...message,
      status: 'installing',
      timestamp: Date.now(),
    };

    await dbHelper.insertOneToDatabase(database, globalAppsInstallingLocations, installingMessage);

    log.info(`App installing message stored for ${message.appName || 'unknown'}`);
    return { status: 'success', message: 'Installing message stored' };
  } catch (error) {
    log.error(`Error storing app installing message: ${error.message}`);
    throw error;
  }
}

/**
 * Check if app message already exists
 * @param {string} hash - Message hash
 * @returns {Promise<boolean>} True if message exists
 */
async function checkAppMessageExistence(hash) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { hash };
    const message = await dbHelper.findOneInDatabase(database, globalAppsMessages, query);

    return !!message;
  } catch (error) {
    log.error(`Error checking app message existence: ${error.message}`);
    return false;
  }
}

/**
 * Check if temporary app message exists
 * @param {string} hash - Message hash
 * @returns {Promise<boolean>} True if temporary message exists
 */
async function checkAppTemporaryMessageExistence(hash) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const query = { hash };
    const message = await dbHelper.findOneInDatabase(database, globalAppsTempMessages, query);

    return !!message;
  } catch (error) {
    log.error(`Error checking temporary app message existence: ${error.message}`);
    return false;
  }
}

/**
 * Get temporary app messages
 * @param {object} filter - Filter criteria
 * @returns {Promise<Array>} Array of temporary messages
 */
async function getAppsTemporaryMessages(filter = {}) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const messages = await dbHelper.findInDatabase(database, globalAppsTempMessages, filter);
    return messages;
  } catch (error) {
    log.error(`Error getting temporary app messages: ${error.message}`);
    return [];
  }
}

/**
 * Get permanent app messages
 * @param {object} filter - Filter criteria
 * @returns {Promise<Array>} Array of permanent messages
 */
async function getAppsPermanentMessages(filter = {}) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const messages = await dbHelper.findInDatabase(database, globalAppsMessages, filter);
    return messages;
  } catch (error) {
    log.error(`Error getting permanent app messages: ${error.message}`);
    return [];
  }
}

/**
 * Clean up old temporary messages
 * @param {number} maxAge - Maximum age in milliseconds
 * @returns {Promise<number>} Number of messages cleaned up
 */
async function cleanupOldTemporaryMessages(maxAge = 24 * 60 * 60 * 1000) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);

    const cutoffTime = Date.now() - maxAge;
    const query = { storedAt: { $lt: cutoffTime } };

    const result = await dbHelper.removeInDatabase(database, globalAppsTempMessages, query);
    log.info(`Cleaned up ${result.deletedCount || 0} old temporary messages`);

    return result.deletedCount || 0;
  } catch (error) {
    log.error(`Error cleaning up old temporary messages: ${error.message}`);
    return 0;
  }
}

module.exports = {
  storeAppTemporaryMessage,
  storeAppPermanentMessage,
  storeAppRunningMessage,
  storeAppInstallingMessage,
  checkAppMessageExistence,
  checkAppTemporaryMessageExistence,
  getAppsTemporaryMessages,
  getAppsPermanentMessages,
  cleanupOldTemporaryMessages,
};