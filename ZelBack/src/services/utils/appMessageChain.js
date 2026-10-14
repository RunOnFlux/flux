// Which of an app's permanent messages is in force: the one rule shared by block-by-block
// promotion (registryManager), the expiry pass and the rebuild of globalAppsInformation from the
// message log (dbHelper). They must agree, or two nodes holding the same messages end up with a
// different set of apps.
//
// The rule: the newest message for the name that counts, in (height, timestamp) order, is in force
// while its own term runs. An update carries the app on whether or not the app had expired when
// it confirmed, so an owner renews an expired app by updating it.
//
// Who holds a name is decided by the chain, never by a signer's timestamp: a registration counts
// only when its owner is the owner of the app in force at its block, or no app is in force there.
// When registrations from different owners land in one block for a name no app holds, the one
// earliest in the block holds it. The log keeps a registration that does not count; every reader
// of the log asks messagesThatCount.

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

const isRegistration = (message) => message.type === 'fluxappregister' || message.type === 'zelappregister';

/**
 * (height, timestamp) order, then hash, so equal timestamps in one block order the same way on
 * every node.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareMessages(a, b) {
  const byChain = (a.height || 0) - (b.height || 0) || (a.timestamp || 0) - (b.timestamp || 0);
  if (byChain) return byChain;
  if (a.hash === b.hash) return 0;
  return a.hash < b.hash ? -1 : 1;
}

/**
 * The owner whose registration is earliest in its block among one block's registrations, or
 * null when the block registers nothing. A registration whose position is unknown comes after
 * every one whose position is known; registrations at one position keep their timestamp order.
 * @param {object[]} block one block's messages, in timestamp order
 * @param {Map<string, number>} positions txIndex by message hash
 * @returns {string|null}
 */
function firstRegistrant(block, positions) {
  const position = (message) => positions.get(message.hash) ?? Infinity;
  const first = block.filter(isRegistration).reduce((held, message) => (!held || position(message) < position(held) ? message : held), null);
  return first ? first.appSpecifications.owner : null;
}

/**
 * The messages of one app name that count, oldest first in (height, timestamp) order.
 * @param {object[]} messages the name's permanent messages, in any order
 * @param {Map<string, number>} [positions] txIndex by message hash; consulted only for
 *   registrations of a name no app holds
 * @returns {object[]}
 */
function messagesThatCount(messages, positions = new Map()) {
  const ordered = [...messages].sort(compareMessages);
  const counted = [];
  let i = 0;
  while (i < ordered.length) {
    const { height } = ordered[i];
    const block = [];
    while (i < ordered.length && ordered[i].height === height) {
      block.push(ordered[i]);
      i += 1;
    }
    const governing = counted[counted.length - 1];
    const holder = governing && isInForce(governing.height, governing.appSpecifications.expire, height)
      ? governing.appSpecifications.owner
      : firstRegistrant(block, positions);
    block.forEach((message) => {
      if (isRegistration(message) && holder !== null && message.appSpecifications.owner !== holder) return;
      counted.push(message);
    });
  }
  return counted;
}

/**
 * The message in force for one app name: the newest that counts, whether or not its term still
 * runs (isInForce answers that).
 * @param {object[]} messages the name's permanent messages
 * @param {Map<string, number>} [positions] txIndex by message hash
 * @returns {object|null}
 */
function governingMessage(messages, positions) {
  const counted = messagesThatCount(messages, positions);
  return counted.length ? counted[counted.length - 1] : null;
}

module.exports = {
  appExpirationHeight,
  compareMessages,
  governingMessage,
  isBefore,
  isInForce,
  messagesThatCount,
};
