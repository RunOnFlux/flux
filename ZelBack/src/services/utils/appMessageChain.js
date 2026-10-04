// Which of an app's permanent messages is in force: the one rule shared by the block-by-block
// promotion (messageVerifier), the expiry pass (registryManager) and the rebuild of
// globalAppsInformation from the message log (dbHelper). They must agree, or two nodes holding
// the same messages end up with a different set of apps - which is how a renewal confirmed after
// its app had expired left the app alive on some nodes and gone on the rest.
//
// The rule: a registration starts an app; an update carries it on only while it is alive. Once
// an app has expired it is over - its name is free - and an update that confirms afterwards
// changes nothing, even if it was signed and paid for while the app still ran.
//
// From expiredAppUpdatesIgnoredBlock on. Below it the history is read as the network always read
// it - the newest message carries the app on, expired or not - because live apps rest on it:
// seven long-lived apps were renewed a few dozen blocks late in 2022 and have been renewed ever
// since. Applying the rule to the past would end them on the first rebuild after an upgrade.

const config = require('config');

const REGISTRATION_TYPES = ['zelappregister', 'fluxappregister'];

/**
 * The first block at which an update confirmed after its app expired is not applied.
 * @returns {number}
 */
function expiredAppUpdatesIgnoredBlock() {
  return config.fluxapps.expiredAppUpdatesIgnoredBlock ?? 3050000;
}
const UPDATE_TYPES = ['zelappupdate', 'fluxappupdate'];

/**
 * The last block an app is alive at: height + expire. Blocks of a pre-fork registration that
 * fall after the PON fork count 4x, because the chain moves 4x faster since - the same
 * arithmetic as dbHelper.expireHeightExpr. An app is alive at block h while h <= this.
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

/**
 * Orders one app's messages by block, a same-block tie by timestamp.
 * @param {object[]} messages
 * @returns {object[]} a new array
 */
function sortAppMessages(messages) {
  return [...messages].sort((a, b) => ((a.height || 0) - (b.height || 0)) || ((a.timestamp || 0) - (b.timestamp || 0)));
}

/**
 * The message in force for one app just before a block: the last registration, followed by
 * every update that confirmed while the app was still alive. An update that confirmed after the
 * app had expired is skipped, and so is everything after it until a new registration.
 * @param {object[]} messages every permanent message of ONE app name, any order
 * @param {number} [beforeHeight] only messages before this block; all of them when omitted
 * @param {number} [beforeTimestamp] and, in that block, signed before this
 * @returns {object|null} the governing message, or null when no app was ever started
 */
function governingAppMessage(messages, beforeHeight = Infinity, beforeTimestamp = -Infinity) {
  let governing = null;
  sortAppMessages(messages).forEach((message) => {
    const height = message.height || 0;
    if (!isBefore(message, beforeHeight, beforeTimestamp)) return;
    if (REGISTRATION_TYPES.includes(message.type)) {
      governing = message;
    } else if (UPDATE_TYPES.includes(message.type)) {
      // before the activation block the newest message carried the app on, as it always did
      if (height < expiredAppUpdatesIgnoredBlock()) {
        governing = message;
      } else if (governing) {
        const spec = governing.appSpecifications || {};
        if (appExpirationHeight(governing.height || 0, spec.expire) >= height) governing = message;
      }
    }
  });
  return governing;
}

/**
 * Whether an update at this block carries its app on: the app was alive when it confirmed.
 * @param {object[]} messages every permanent message of the app
 * @param {number} height block the update confirmed in
 * @param {number} [timestamp] the update's own timestamp, so a registration in the same block
 *   counts as before it
 * @returns {boolean}
 */
function isUpdateInForce(messages, height, timestamp = -Infinity) {
  // before the activation block an update applied wherever its app was still held, as before
  if (height < expiredAppUpdatesIgnoredBlock()) return true;
  const governing = governingAppMessage(messages, height, timestamp);
  if (!governing) return false;
  return appExpirationHeight(governing.height || 0, (governing.appSpecifications || {}).expire) >= height;
}

/**
 * How close to its expiry an app can still be updated. A signed update waits in the temporary
 * store for its payment for up to an hour of wall clock (120 blocks of 30 s); one submitted
 * later than that before expiry could be paid for after the app is over, and buy nothing. The
 * margin is counted in blocks, so it carries headroom for blocks faster than 30 s.
 * @returns {number} blocks
 */
function updateExpiryMarginBlocks() {
  return config.fluxapps.updateExpiryMarginBlocks ?? 150;
}

/**
 * Refuses an update that might confirm after its app expires, before anyone signs or pays.
 * @param {{name: string, height: number, expire?: number}} appInfo the app's live spec
 * @param {number} daemonHeight current block
 * @throws {Error} when fewer than updateExpiryMarginBlocks blocks are left
 */
function assertUpdateConfirmsBeforeExpiry(appInfo, daemonHeight) {
  const margin = updateExpiryMarginBlocks();
  const left = appExpirationHeight(appInfo.height, appInfo.expire) - daemonHeight;
  if (left < margin) {
    throw new Error(`Flux App ${appInfo.name} expires in ${Math.max(left, 0)} blocks. An update has to be submitted at least `
      + `${margin} blocks (${Math.round((margin * 30) / 60)} minutes) before its app expires, because a payment confirmed after `
      + 'the expiry buys nothing. This app can no longer be updated or renewed.');
  }
}

module.exports = {
  appExpirationHeight,
  assertUpdateConfirmsBeforeExpiry,
  expiredAppUpdatesIgnoredBlock,
  governingAppMessage,
  isBefore,
  isUpdateInForce,
  sortAppMessages,
  updateExpiryMarginBlocks,
};
