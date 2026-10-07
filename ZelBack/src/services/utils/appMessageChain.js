// Which of an app's permanent messages is in force: the one rule shared by block-by-block
// promotion (registryManager), the expiry pass and the rebuild of globalAppsInformation from the
// message log (dbHelper). They must agree, or two nodes holding the same messages end up with a
// different set of apps.
//
// The rule: the newest message for the name, in (height, timestamp) order, is in force while its
// own term runs. An update carries the app on whether or not the app had expired when it
// confirmed, so an owner renews an expired app by updating it.

const config = require('config');

/**
 * The block an app's term ends at: height + expire. Blocks of a pre-fork registration that
 * fall after the PON fork count 4x, because the chain moves 4x faster since - the same
 * arithmetic as dbHelper.expireHeightExpr. The app is expired from this block on (isInForce).
 * @param {number} height block the governing message confirmed in
 * @param {number} [expire] its expire, in blocks
 * @returns {number}
 */
function appExpirationHeight(height, expire) {
  const fork = config.fluxapps.daemonPONFork;
  const defaultExpire = height >= fork ? config.fluxapps.blocksLasting * 4 : config.fluxapps.blocksLasting;
  const end = height + (expire || defaultExpire);
  if (height < fork && end > fork) return fork + ((end - fork) * 4);
  return end;
}

/**
 * Whether an app's term still runs at a block: below its expiration height. The rebuild
 * (dbHelper) and v9 draw the same line.
 * @param {number} height block the governing message confirmed in
 * @param {number} [expire] its expire, in blocks
 * @param {number} atHeight
 * @returns {boolean}
 */
function isInForce(height, expire, atHeight) {
  return atHeight < appExpirationHeight(height, expire);
}

/**
 * Whether a message comes before a point in the log: an earlier block, or the same block and an
 * earlier timestamp. A registration and an update confirmed in one block are in that order.
 * @param {object} message
 * @param {number} height
 * @param {number} [timestamp] -Infinity (the default) leaves the whole block out
 * @returns {boolean}
 */
function isBefore(message, height, timestamp = -Infinity) {
  const messageHeight = message.height || 0;
  return messageHeight < height || (messageHeight === height && (message.timestamp || 0) < timestamp);
}

module.exports = {
  appExpirationHeight,
  isBefore,
  isInForce,
};
