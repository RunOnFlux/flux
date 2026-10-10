const config = require('config');

const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const daemonServiceUtils = require('../daemonService/daemonServiceUtils');
const messageVerifier = require('../appMessaging/messageVerifier');
const { appPaymentPositions } = require('../appPaymentPositions');

/**
 * Gives every app payment record without a position in its block the position
 * and the height the daemon's address index holds for its transaction: one call
 * over the payment addresses from the first height a payment is recorded at to
 * the chain tip, so a transaction the index does not hold is not on the chain.
 * Such a record is marked `notOnChain`, and is no payment. A record above the
 * daemon's tip is left for a later run: the daemon has not reached its block.
 *
 * The height is the chain's, not the one recorded: a record written from a block
 * that later left the chain carries a height its transaction is not at. Both are
 * set in one write, and a stored message whose record's height is corrected
 * follows it (messageVerifier.alignStoredMessagesWithPayments).
 * @returns {Promise<{positioned: number, heightsCorrected: number, notOnChain: number, aboveTip: number}>}
 */
async function backfillPaymentPositions() {
  const database = dbHelper.databaseConnection().db(config.database.daemon.database);
  const collection = config.database.daemon.collections.appsHashes;
  const missing = await dbHelper.findInDatabase(
    database, collection, { txIndex: { $exists: false } }, {
      projection: {
        _id: 0, hash: 1, txid: 1, height: 1, value: 1,
      },
    },
  );
  if (missing.length === 0) return { positioned: 0, heightsCorrected: 0, notOnChain: 0, aboveTip: 0 };

  const tip = await daemonServiceUtils.executeCall('getBlockCount', [], { useCache: false });
  if (tip.status !== 'success' || !Number.isInteger(tip.data)) {
    throw new Error(`getBlockCount failed: ${tip.data?.message ?? tip.data}`);
  }
  const positions = await appPaymentPositions(config.fluxapps.epochstart, tip.data);
  const operations = [];
  const corrected = [];
  let heightsCorrected = 0;
  let notOnChain = 0;
  let aboveTip = 0;
  for (const {
    hash, txid, height, value,
  } of missing) {
    const position = positions.get(txid);
    if (!position && height > tip.data) {
      aboveTip += 1;
    } else if (position) {
      if (position.height !== height) {
        heightsCorrected += 1;
        corrected.push({
          hash, txid, height: position.height, value,
        });
      }
      operations.push({
        updateOne: {
          filter: { txid, txIndex: { $exists: false } },
          update: { $set: { txIndex: position.txIndex, height: position.height } },
        },
      });
    } else {
      notOnChain += 1;
      operations.push({
        updateOne: { filter: { txid, txIndex: { $exists: false } }, update: { $set: { notOnChain: true } } },
      });
    }
  }
  if (operations.length) await dbHelper.bulkWriteInDatabase(database, collection, operations);
  await messageVerifier.alignStoredMessagesWithPayments(corrected);
  log.info(`migrations - payment positions: ${operations.length - notOnChain} positioned, ${heightsCorrected} of them at the chain's height rather than the recorded one, ${notOnChain} not on the chain, ${aboveTip} above the daemon's tip`);
  return {
    positioned: operations.length - notOnChain, heightsCorrected, notOnChain, aboveTip,
  };
}

module.exports = { backfillPaymentPositions };
