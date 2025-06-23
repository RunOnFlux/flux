const config = require('config');
const dbHelper = require('./dbHelper');

const globalAppsMessages = config.database.appsglobal.collections.appsMessages;
const globalAppsTempMessages = config.database.appsglobal.collections.appsTemporaryMessages;
/**
 * To check if an app message hash exists.
 * @param {string} hash Message hash.
 * @returns {(object|boolean)} Returns document object if it exists in the database. Otherwise returns false.
 */
async function checkAppMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { hash };
  const appsProjection = {};
  // a permanent global zelappmessage looks like this:
  // const permanentAppMessage = {
  //   type: messageType,
  //   version: typeVersion,
  //   zelAppSpecifications: appSpecFormatted,
  //   appSpecifications: appSpecFormatted,
  //   hash: messageHASH,
  //   timestamp,
  //   signature,
  //   txid,
  //   height,
  //   valueSat,
  // };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsMessages, appsQuery, appsProjection);
  if (appResult) {
    return appResult;
  }
  return false;
}

/**
 * To check if an app temporary message hash exists.
 * @param {string} hash Message hash.
 * @returns {(object|boolean)} Returns document object if it exists in the database. Otherwise returns false.
 */
async function checkAppTemporaryMessageExistence(hash) {
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appsglobal.database);
  const appsQuery = { hash };
  const appsProjection = {};
  // a temporary zelappmessage looks like this:
  // const newMessage = {
  //   appSpecifications: message.appSpecifications,
  //   type: message.type,
  //   version: message.version,
  //   hash: message.hash,
  //   timestamp: message.timestamp,
  //   signature: message.signature,
  //   createdAt: new Date(message.timestamp),
  //   expireAt: new Date(validTill),
  // };
  const appResult = await dbHelper.findOneInDatabase(appsDatabase, globalAppsTempMessages, appsQuery, appsProjection);
  if (appResult) {
    return appResult;
  }
  return false;
}

module.exports = {
  checkAppMessageExistence,
  checkAppTemporaryMessageExistence,
};
