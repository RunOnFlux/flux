const config = require('config');

const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const daemonServiceUtils = require('../daemonService/daemonServiceUtils');
const messageVerifier = require('../appMessaging/messageVerifier');
const { appPaymentPositions } = require('../appPaymentPositions');

// Records written per round trip: each batch is one bulkWrite, so a fleet's
// worth of records never rides on a single call.
const BACKFILL_BATCH = 5000;

// The payment records the backfill reads: those without a position. A record
// already marked notOnChain is decided: if its transaction is mined later, the
// explorer records the payment from that block. Read through the collection's
// txIndex index (explorerService.prepareCollections), so a node whose records all
// have positions reads none of them.
const UNPOSITIONED = { txIndex: { $exists: false }, notOnChain: { $ne: true } };

/**
 * Gives every app payment record without a position in its block the position
 * and the height the daemon's address index holds for its transaction: one call
 * over the payment addresses from the first height a payment is recorded at to
 * the chain tip, so a transaction the index does not hold is not on the chain.
 * Such a record is marked `notOnChain`, is no payment, and is not read again. A record above the
 * daemon's tip is left for a later run: the daemon has not reached its block.
 *
 * The height is the chain's, not the one recorded: a record written from a block
 * that later left the chain carries a height its transaction is not at. Both are
 * set in one write. A stored message whose record's height is corrected is moved
 * to it before the records are written, so a run that stops between the two finds
 * them again at the next start; the registry row of its app is written after
 * them, since which message governs reads their positions
 * (messageVerifier.moveStoredMessagesToPayments, storeGoverningAppSpecifications).
 * The records are written BACKFILL_BATCH at a time; a run that stops part way
 * leaves the rest without a position, and the next run takes them.
 * @returns {Promise<{positioned: number, heightsCorrected: number, notOnChain: number, aboveTip: number}>}
 */
async function backfillPaymentPositions() {
  const database = dbHelper.databaseConnection().db(config.database.daemon.database);
  const collection = config.database.daemon.collections.appsHashes;
  const missing = await dbHelper.findInDatabase(
    database, collection, UNPOSITIONED, {
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
  const moved = await messageVerifier.moveStoredMessagesToPayments(corrected);
  for (let i = 0; i < operations.length; i += BACKFILL_BATCH) {
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.bulkWriteInDatabase(database, collection, operations.slice(i, i + BACKFILL_BATCH));
  }
  await messageVerifier.storeGoverningAppSpecifications(moved);
  log.info(`migrations - payment positions: ${operations.length - notOnChain} positioned, ${heightsCorrected} of them at the chain's height rather than the recorded one, ${notOnChain} not on the chain, ${aboveTip} above the daemon's tip`);
  return {
    positioned: operations.length - notOnChain, heightsCorrected, notOnChain, aboveTip,
  };
}

module.exports = { backfillPaymentPositions, BACKFILL_BATCH, UNPOSITIONED };
