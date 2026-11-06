const config = require('config');
const EventEmitter = require('node:events');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceAddressRpcs = require('./daemonService/daemonServiceAddressRpcs');
const daemonServiceBlockchainRpcs = require('./daemonService/daemonServiceBlockchainRpcs');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const chainUtilities = require('./utils/chainUtilities');
const messageVerifier = require('./appMessaging/messageVerifier');
const registryManager = require('./appDatabase/registryManager');
const { appPaymentPositions } = require('./appPaymentPositions');
const advancedWorkflows = require('./appLifecycle/advancedWorkflows');
const benchmarkService = require('./benchmarkService');
const fluxNetworkhelper = require('./fluxNetworkHelper');
const { extractIp } = require('./utils/socketAddressUtils');
const fluxEventBus = require('./utils/fluxEventBus');
const fluxnodeAddressRecord = require('./fluxnodeAddressRecord');
const globalState = require('./utils/globalState');
const { appSyncEvents, EVENTS: SYNC_EVENTS } = require('./utils/appSyncEvents');
const { Privilege, authOf } = require('./utils/privileges');
const { BlockCadence } = require('./utils/blockCadence');
const { FluxController } = require('./utils/fluxController');

const appsHashesCollection = config.database.daemon.collections.appsHashes;
const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const chainParamsMessagesCollection = config.database.chainparams.collections.chainMessages;
const appsMessagesCollection = config.database.appsglobal.collections.appsMessages;

// The block processor runs one step at a time. Each step says which step runs
// next and how long to wait first; the controller's loop does every wait, so a
// stop cancels the wait and, once the step in flight has finished, runs nothing
// more. One loop at a time: a start while one runs or stops is refused.
const processor = new FluxController();
let nextStep = null;
let zelAppSpecsMigrationDone = false;
let explorerReadyEmitted = false;
let operationBlocked = false;
// Payments whose messages are requested at the next block at the tip. They are only a prompt:
// hash sync finds every payment without a message.
let paymentsToRequest = [];
let isSynced = false;
// The last block the explorer processed: the explorer's records hold the chain up
// to it, so the next block must name its hash as parent. Null when no block has
// been processed since the scanned height was last set without a hash.
let lastScannedBlock = null;

// fluxd refuses a reorganisation of this many blocks or more (MAX_REORG_LENGTH, main.h).
const MAX_REORG_BLOCKS = 40;

// updateFluxAppsPeriod can be between every 4 to 9 blocks
let updateFluxAppsPeriod = Math.floor(Math.random() * 6 + 4);
// When the work below that is paced by the chain is due.
let cadence = new BlockCadence();

/**
 * Whether work paced by the chain runs at this tip block, published when it does.
 * @param {string} job
 * @param {number} height
 * @param {number} period blocks between runs
 * @returns {boolean}
 */
function blockWorkDue(job, height, period) {
  if (!cadence.due(job, height, period)) return false;
  fluxEventBus.publish('blockWork:ran', { job, height });
  return true;
}

const blockEmitter = new EventEmitter();

function getBlockEmitter() {
  return blockEmitter;
}


/**
 * To get the details of a verbose block.
 * @param {(number|string)} heightOrHash Block height or block hash.
 * @param {number} verbosity Verbosity level.
 * @returns {object} Block data from block cache.
 */
async function getVerboseBlock(heightOrHash, verbosity = 2) {
  const req = {
    params: {
      hashheight: heightOrHash,
      verbosity,
    },
  };
  const blockInfo = await daemonServiceBlockchainRpcs.getBlock(req);
  if (blockInfo.status === 'success') {
    return blockInfo.data;
  }
  throw blockInfo.data;
}

// fluxd refuses a call outright while it starts and while its RPC work queue is
// full, so the bootstrap and the record's rebuild ask again before they give up.
const DAEMON_ATTEMPTS = 5;
const DAEMON_RETRY_MS = 2_000;
// How long after a bootstrap fails it runs again.
const BOOTSTRAP_RETRY_MS = 60_000;
// How long after a recovery fails it runs again.
const RECOVERY_RETRY_MS = 15 * 60 * 1000;
// How long a block waits for fluxd to sync before it is asked for again.
const BLOCK_SYNC_RETRY_MS = 2 * 60 * 1000;

/**
 * The block processor's steps. Each step function answers `{ next, waitMs }`:
 * the step that runs next, and how long the processor waits before it.
 */
const Step = {
  init: (restoreDatabase, deepRestore) => ({ run: 'init', restoreDatabase, deepRestore }),
  block: (height) => ({ run: 'block', height }),
  poll: () => ({ run: 'poll' }),
  recover: (restoreDatabase, deepRestore) => ({ run: 'recover', restoreDatabase, deepRestore }),
};
const after = (next, waitMs = 0) => ({ next, waitMs });

/**
 * What a call to fluxd answers, asked again while it fails.
 * @param {function(): Promise<*>} call Rejects when fluxd does not answer.
 * @returns {Promise<*>} Rejects once every attempt has failed.
 */
async function askDaemon(call) {
  let answer = null;
  let answered = false;
  for (let attempt = 1; !answered; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      answer = await call();
      answered = true;
    } catch (error) {
      if (attempt === DAEMON_ATTEMPTS) throw error;
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(DAEMON_RETRY_MS);
    }
  }
  return answer;
}

/**
 * The verbose transactions with these ids, from one batch call. The ones fluxd
 * does not return are asked for again, alone.
 * @param {string[]} txids
 * @returns {Promise<object[]>} In the order of `txids`; rejects once a
 *   transaction has failed every attempt.
 */
async function getRawTransactions(txids) {
  const transactions = [];
  let pending = txids.map((txid, index) => ({ txid, index }));
  let failure = null;
  for (let attempt = 1; pending.length; attempt += 1) {
    if (attempt > DAEMON_ATTEMPTS) {
      throw new Error(`getrawtransaction failed for ${pending.length} transactions, ${pending[0].txid} first: ${failure}`);
    }
    if (attempt > 1) {
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(DAEMON_RETRY_MS);
    }
    // eslint-disable-next-line no-await-in-loop
    const batch = await daemonServiceUtils.executeBatchCall(pending.map(({ txid }) => ({ method: 'getrawtransaction', params: [txid, 1] })));
    if (batch.status !== 'success') {
      failure = batch.data?.message ?? batch.data;
    } else {
      const failed = [];
      pending.forEach((transaction, i) => {
        const { result, error } = batch.data[i] ?? {};
        if (result && !error) {
          transactions[transaction.index] = result;
        } else {
          failed.push(transaction);
          failure = error?.message ?? 'no transaction returned';
        }
      });
      pending = failed;
    }
  }
  return transactions;
}

/**
 * To decode a message from Unicode values to text characters.
 * @param {string} asm UTF-16 value.
 * @returns {string} Message.
 */
function decodeMessage(asm) {
  const parts = asm.split('OP_RETURN ', 2);
  let message = '';
  if (parts[1]) {
    const encodedMessage = parts[1];
    const hexx = encodedMessage.toString(); // force conversion
    for (let k = 0; k < hexx.length && hexx.slice(k, k + 2) !== '00'; k += 2) {
      message += String.fromCharCode(
        parseInt(hexx.slice(k, k + 2), 16),
      );
    }
  }
  return message;
}

/**
 * To process soft fork messages and reactin upon observing one
 * @param {string} txid TXID of soft fork message occurance
 * @param {number} heightBlockchain height of soft fork message occurance
 * @param {string} message Already decoded message.
 */
async function processSoftFork(txid, height, message) {
  // Process soft fork messages - errors are caught in calling functions
  const splittedMess = message.split('_');
  const version = splittedMess[0];
  if (!version || splittedMess.length < 2) {
    log.info('Ignoring non valid Soft Fork message.');
    log.info(`${txid}_${height}_${message}`);
    return;
  }
  const data = {
    txid,
    height,
    message,
    version,
  };
  log.info('New Soft Fork message received');
  log.info(`${txid}_${height}_${message}`);
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.chainparams.database);
  const query = { txid }; // unique
  const update = { $set: data };
  const options = {
    upsert: true,
  };
  await dbHelper.updateOneInDatabase(database, chainParamsMessagesCollection, query, update, options);
}

/**
 * Records a block's payment of an app message hash, unless a payment this node holds stands. A
 * record whose transaction the chain does not hold (notOnChain), or whose block a reorganisation
 * replaced (replaced), does not stand; one write overwrites it, so a later reorganisation finds
 * one record or the other.
 * @param {object} database the daemon database
 * @param {object} payment the record to write
 * @returns {Promise<boolean>} whether the payment was recorded
 */
async function recordAppPayment(database, payment) {
  const { hash, height } = payment;
  const held = await dbHelper.findOneInDatabase(database, appsHashesCollection, { hash }, {
    projection: {
      _id: 0, txid: 1, height: 1, notOnChain: 1, replaced: 1,
    },
  });
  if (held && !held.notOnChain && held.replaced === undefined) return false;
  await dbHelper.replaceOneInDatabase(database, appsHashesCollection, { hash }, payment, { upsert: true });
  if (held) log.info(`Explorer - payment of ${hash} at height ${height} takes the place of the record at txid ${held.txid} height ${held.height}`);
  return true;
}

/**
 * To process verbose block data for entry to Insight database.
 * @param {object} blockDataVerbose Verbose block data.
 * @param {string} database Database.
 */
async function processInsight(blockDataVerbose, database) {
  // get Block Deltas information
  const txs = blockDataVerbose.tx;
  // go through each transaction in deltas. The index is the transaction's position
  // in the block: a verbose block lists its transactions in block order.
  // eslint-disable-next-line no-restricted-syntax
  for (const [txIndex, tx] of txs.entries()) {
    if (tx.version < 5 && tx.version > 0) {
      let message = '';
      let isFluxAppMessageValue = 0;
      let isSenderFoundation = false;
      let isReceiverFounation = false;

      tx.vin.forEach((sender) => {
        if (sender.address === config.fluxapps.addressMultisig || sender.address === config.fluxapps.addressMultisigB) { // coinbase vin.addr is undefined
          isSenderFoundation = true;
        }
      });

      tx.vout.forEach((receiver) => {
        if (receiver.scriptPubKey.addresses) { // count for messages
          if (receiver.scriptPubKey.addresses[0] === config.fluxapps.address
            || (receiver.scriptPubKey.addresses[0] === config.fluxapps.addressMultisig && blockDataVerbose.height >= config.fluxapps.appSpecsEnforcementHeights[6])
            || (receiver.scriptPubKey.addresses[0] === config.fluxapps.addressMultisigB && blockDataVerbose.height >= config.fluxapps.multisigAddressChange)
            || (receiver.scriptPubKey.addresses[0] === config.fluxapps.addressDevelopment && config.development)) { // DEVELOPMENT MODE
            // it is an app message. Get Satoshi amount
            isFluxAppMessageValue += receiver.valueSat;
          }
          if (receiver.scriptPubKey.addresses[0] === config.fluxapps.addressMultisig || receiver.scriptPubKey.addresses[0] === config.fluxapps.addressMultisigB) {
            isReceiverFounation = true;
          }
        }
        if (receiver.scriptPubKey.asm) {
          message = decodeMessage(receiver.scriptPubKey.asm);
        }
      });
      if (isFluxAppMessageValue) {
        // eslint-disable-next-line no-await-in-loop
        const appPrices = await chainUtilities.getChainParamsPriceUpdates();
        const intervals = appPrices.filter((i) => i.height < blockDataVerbose.height);
        const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
        // MAY contain App transaction. Store it.
        if (isFluxAppMessageValue >= (priceSpecifications.minPrice * 1e8) && message.length === 64 && blockDataVerbose.height >= config.fluxapps.epochstart) { // min of X flux had to be paid for us bothering checking
          const appTxRecord = {
            txid: tx.txid, height: blockDataVerbose.height, txIndex, hash: message, value: isFluxAppMessageValue, message: false, // message is boolean saying if we already have it stored as permanent message
            syncAttempts: 0, nextRetryHeight: blockDataVerbose.height,
          };
          // A hash is paid once: a payment this node already holds stands.
          // eslint-disable-next-line no-await-in-loop
          if (await recordAppPayment(database, appTxRecord)) {
            paymentsToRequest.push(appTxRecord);
          } else {
            log.error(`Hash ${message} already exists. Not adding at height ${blockDataVerbose.height}`);
          }
        }
      }
      // check for softForks
      const isSoftFork = isSenderFoundation && isReceiverFounation && message;
      if (isSoftFork) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await processSoftFork(tx.txid, blockDataVerbose.height, message);
        } catch (error) {
          // A message that cannot be read is skipped. One that could not be written is not:
          // the block is reprocessed, or this node prices apps without that fork for good.
          if (dbHelper.isDatabaseError(error)) throw error;
          log.error('Error processing soft fork message:', error);
        }
      }
    }
  }
}

/**
 * Records the app payments of the blocks processed since the last write. A payment that could
 * not be recorded rejects, so the block processor reprocesses its block instead of moving its
 * scanned height past it: a payment with no record is never resolved, and the app message it
 * paid for never reaches this node.
 * @param {object[]} transactions
 * @param {object} database
 * @returns {Promise<void>}
 */
async function insertTransactions(transactions, database) {
  if (transactions.length > 0) {
    log.info(`Explorer - insertTransactions - Inserting ${transactions.length} transactions to apps hashes collection`);
    let unrecorded = null;
    try {
      const options = {
        ordered: false,
      };
      await dbHelper.insertManyToDatabase(database, appsHashesCollection, transactions, options);
    } catch (error) {
      log.error(`Explorer- insertTransactions - Inserting ${transactions.length} - transactions error - ${error}`);
      // eslint-disable-next-line no-restricted-syntax
      for (const transaction of transactions) {
        try {
          const query = { hash: transaction.hash, height: transaction.height };
          const update = { $set: transaction };
          const options = {
            upsert: true,
          };
          // eslint-disable-next-line no-await-in-loop
          await dbHelper.updateOneInDatabase(database, appsHashesCollection, query, update, options);
        } catch (errorTx) {
          log.error(`Explorer - insertTransactions - Inserting ${transaction.hash} - transaction error - ${errorTx}`);
          unrecorded = unrecorded ?? errorTx;
        }
      }
    }
    if (unrecorded) throw unrecorded;
  }
}

/**
 * To process transactions inserts on database and calling app messages.
 * @param {array} apps array with appstransactions to be processed.
 * @param {string} database Database.
 */
/**
 * Stores or requests the messages of a block's app payments. Runs from a timer
 * nothing awaits, so it logs its own failure: the hashes it leaves unresolved
 * are found again by hash sync.
 * @param {array} apps the block's app payments.
 * @returns {Promise<void>}
 */
async function requestAppHashes(apps) {
  try {
    const appsToRemove = [];
    let hasUnresolved = false;
    // eslint-disable-next-line no-restricted-syntax
    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      const messageReceived = await messageVerifier.checkAndRequestApp(app.hash, app.txid, app.height, app.value, 2);
      if (messageReceived) {
        appsToRemove.push(app);
      } else {
        hasUnresolved = true;
      }
    }
    if (hasUnresolved) {
      appSyncEvents.emit(SYNC_EVENTS.HASH_UNRESOLVED);
    }
    const remaining = apps.filter((item) => !appsToRemove.includes(item));
    while (remaining.length > 500) {
      messageVerifier.checkAndRequestMultipleApps(remaining.splice(0, 500));
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(30 * 1000); // delay 30 seconds
    }
    if (remaining.length > 0) {
      messageVerifier.checkAndRequestMultipleApps(remaining);
    }
  } catch (error) {
    log.error(`Explorer - requestAppHashes - ${apps.length} app payments: ${error.message}`);
  }
}

/**
 * The time of a block at or below the tip, from the tip itself when it is that block.
 * @param {{height: number, time: number}} tipBlock the block being processed at the tip
 * @param {number} height
 * @returns {Promise<number>} epoch seconds
 */
async function blockTimeAt(tipBlock, height) {
  if (height === tipBlock.height) return tipBlock.time;
  return (await getVerboseBlock(height, 1)).time;
}

/**
 * To process block data for entry to Insight database.
 * @param {number} blockHeight Block height.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
/**
 * Schedules the multiport bench for the multiple of `period` at or below this tip block.
 *
 * Every node behind the same ip benchmarks at the same instant, so nodes sharing one
 * machine or connection are measured together; the network is spread out (grouped by
 * ip) over 4 hours so the speedtest servers are not hit at once.
 *
 * The instant is the due block's time plus a delay seeded by the ip and the due
 * block's height: the same on every node behind that ip, whenever each processed the
 * block. A node that reaches the tip after that instant has passed skips this bench
 * rather than run it alone.
 *
 * Mainnet block times, which the instant relies on:
 *
 * | a block's time                          | written by its producer, the same on every node  |
 * | consecutive block times                 | 6 to 120 s apart, 30 s typical, never decreasing |
 * | a node receives a block, after its time | 1.4 s typical, 2.6 s at p99, under 10 s          |
 *
 * @param {{height: number, time: number}} tipBlock the block being processed at the tip
 * @param {number} period blocks between benches
 * @returns {Promise<void>}
 */
async function scheduleUpnpBench(tipBlock, period) {
  try {
    const maxBenchDelay = 4 * 3_600_000;
    const dueHeight = Math.floor(tipBlock.height / period) * period;
    const dueBlockTime = await blockTimeAt(tipBlock, dueHeight);
    const socketAddress = await fluxNetworkhelper.getLocalSocketAddress();

    // socketAddress can be null. If it is, we just use an empty string. This
    // has the effect of creating an initializer of just the block number. If
    // this happens, every node on the network that uses the block number will
    // run the bench at the same time. However this is an extreme edge case, as
    // all nodes should just return the ip.
    const localIp = socketAddress ? extractIp(socketAddress) : '';
    // This is: string + number = string
    const initializer = localIp + dueHeight;
    const benchAtMs = dueBlockTime * 1000 + serviceHelper.randomDelayMs(maxBenchDelay, { initializer });
    const benchDelayMs = benchAtMs - Date.now();

    if (benchDelayMs < 0 && dueHeight !== tipBlock.height) {
      log.info(`Random seed: ${initializer}. Multiport bench skipped: its start passed ${Math.round(-benchDelayMs / 1000)}s ago, before this node reached the tip`);
      return;
    }
    const startInMs = Math.max(benchDelayMs, 0);
    log.info(`Random seed: ${initializer}. Starting multiport bench in: ${Math.round(startInMs / 10) / 100}s`);
    setTimeout(benchmarkService.executeUpnpBench, startInMs);
  } catch (error) {
    log.error(error);
  }
}

/**
 * The block processor's step for one block.
 * @param {number} blockHeight
 * @returns {Promise<{next: object, waitMs: number}>} The next block while fluxd
 *   holds one, the poll at the tip, the recovery when this block fails.
 */
async function processBlock(blockHeight) {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) return after(Step.block(blockHeight), BLOCK_SYNC_RETRY_MS);
    await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.EXPLORER_BEFORE_BLOCK, blockHeight);
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);
    // get Block information
    const verbosity = 2;
    const blockDataVerbose = await getVerboseBlock(blockHeight, verbosity);
    const parent = await scannedBlockAt(database, blockDataVerbose.height - 1);
    if (parent && blockDataVerbose.previousblockhash !== parent.hash) {
      const restoredHeight = await rewindToFork(database, parent);
      return after(Step.block(restoredHeight + 1));
    }
    cadence.processed(blockDataVerbose.height);
    if (blockDataVerbose.height % 50 === 0) {
      log.info(`Processing Explorer Block Height: ${blockDataVerbose.height}`);
    }
    if (blockDataVerbose.height > 699420 && blockDataVerbose.height < 862002) {
      // speed up sync as there were no app messages between these two blocks
      return after(Step.block(862002));
    }
    await processInsight(blockDataVerbose, database);
    await fluxnodeAddressRecord.recordBlock(blockDataVerbose);
    // After fork block, chain runs 4x faster, so multiply periods by 4
    const speedMultiplier = blockHeight >= config.fluxapps.daemonPONFork ? 4 : 1;

    const scannedHeight = blockDataVerbose.height;
    // update scanned Height in scannedBlockHeightCollection
    const query = { generalScannedHeight: { $gte: 0 } };
    const update = { $set: { generalScannedHeight: scannedHeight, generalScannedHash: blockDataVerbose.hash } };
    const options = {
      upsert: true,
    };
    // True when this block was still the chain tip at the moment it was fetched,
    // which is NOT the same as "the node is synced". The tip is read from a
    // cache refreshed every daemonInfoIntervalMs, and the branch at the end of
    // this function chains straight into the next block whenever it is behind -
    // so a burst of blocks arriving between two refreshes is processed back to
    // back and only the LAST of them is processed at the tip. The work paced by
    // the chain below asks the cadence whether it is due, so a period the burst
    // passed is run once, on that last block.
    isSynced = !(blockDataVerbose.confirmations >= 2);
    if (isSynced) {
      blockEmitter.emit('blocksProcessed', scannedHeight);

      if (globalState.dbReady && blockDataVerbose.height >= config.fluxapps.epochstart) {
        if (blockWorkDue('expireGlobalApplications', blockHeight, 2 * speedMultiplier)) {
          await registryManager.expireGlobalApplications();
        }
        const giveUpPeriod = config.fluxapps.removeFluxAppsPeriod * speedMultiplier;
        if (blockWorkDue('checkAndRemoveApplicationInstance', blockHeight, giveUpPeriod)) {
          // Judged at the times of the blocks the pass and the one before it
          // fell due on, which every node reads the same however late it runs.
          const dueHeight = Math.floor(blockHeight / giveUpPeriod) * giveUpPeriod;
          try {
            const [time, previousTime] = await Promise.all([
              blockTimeAt(blockDataVerbose, dueHeight),
              blockTimeAt(blockDataVerbose, dueHeight - giveUpPeriod),
            ]);
            advancedWorkflows.checkAndRemoveApplicationInstance({
              height: blockHeight, period: giveUpPeriod, time, previousTime,
            });
          } catch (error) {
            log.error(`Give-up-an-app pass for ${dueHeight} not run: its block times could not be read: ${error?.message ?? error}`);
          }
        }
        if (blockWorkDue('reinstallOldApplications', blockHeight, updateFluxAppsPeriod * speedMultiplier)) {
          advancedWorkflows.reinstallOldApplications();
          updateFluxAppsPeriod = Math.floor(Math.random() * 6 + 4);
        }
      }
      const benchPeriod = config.fluxapps.benchUpnpPeriod * speedMultiplier;
      if (blockWorkDue('benchUpnp', blockDataVerbose.height, benchPeriod)) {
        await scheduleUpnpBench(blockDataVerbose, benchPeriod);
      }
      if (paymentsToRequest.length) {
        setTimeout(requestAppHashes, 1, paymentsToRequest);
        paymentsToRequest = [];
      }
      await dbHelper.updateOneInDatabase(database, scannedHeightCollection, query, update, options);
      await settleReplacedPayments(database, scannedHeight);
      fluxEventBus.publish('block:processed', { height: scannedHeight });
    } else if (blockDataVerbose.height % 500 === 0) {
      await registryManager.expireGlobalApplications(); // in case node was shutdown for a while and it is started
      paymentsToRequest = [];
      await dbHelper.updateOneInDatabase(database, scannedHeightCollection, query, update, options);
      fluxEventBus.publish('block:processed', { height: scannedHeight });
      blockEmitter.emit('syncProgress', scannedHeight);
    }
    lastScannedBlock = { height: scannedHeight, hash: blockDataVerbose.hash };
    if (blockDataVerbose.confirmations > 1) return after(Step.block(blockDataVerbose.height + 1));
    const daemonBlockCount = await daemonServiceBlockchainRpcs.getBlockCount();
    if (daemonBlockCount.status !== 'success') {
      throw new Error(daemonBlockCount.data.message || daemonBlockCount.data);
    }
    if (daemonBlockCount.data > blockDataVerbose.height) return after(Step.block(blockDataVerbose.height + 1));
    return after(Step.poll());
  } catch (error) {
    log.error('Block processor encountered an error.');
    log.error(error);
    const deep = Boolean(error.message && error.message.includes('duplicate key'));
    return after(Step.recover(true, deep));
  }
}

/**
 * Removes every payment record but the one a scan keeps for each app message
 * hash, and answers how many it removed: a payment this node already holds
 * stands (recordAppPayment), so a scan keeps the earliest, and a record
 * whose transaction the chain does not hold is no payment and gives way to one
 * that is. The stored message of each such hash moves to the record kept before
 * the others are removed, and the registry rebuild at boot writes its app's row
 * from it. The recovery the unique hash index is built with.
 * @param {object} collection the appsHashes collection
 * @returns {Promise<number>}
 */
async function keepEarliestPayment(collection) {
  const groups = await collection.aggregate([
    { $addFields: { offChain: { $cond: [{ $eq: ['$notOnChain', true] }, 1, 0] } } },
    { $sort: { offChain: 1, height: 1, txIndex: 1, _id: 1 } },
    {
      $group: {
        _id: '$hash',
        rows: {
          $push: {
            id: '$_id', txid: '$txid', height: '$height', value: '$value',
          },
        },
      },
    },
    { $match: { 'rows.1': { $exists: true } } },
  ]).toArray();
  const toRemove = groups.flatMap((group) => group.rows.slice(1).map((row) => row.id));
  if (!toRemove.length) return 0;
  // the messages first: until the duplicates are gone, a failure here is found
  // again by the next build of the unique index, which runs this again
  await messageVerifier.moveStoredMessagesToPayments(groups.map(({ _id: hash, rows: [kept] }) => ({
    hash, txid: kept.txid, height: kept.height, value: kept.value,
  })));
  await collection.deleteMany({ _id: { $in: toRemove } });
  return toRemove.length;
}

/**
 * Asserts every index the explorer's collections need. Boot runs it on every
 * start, and a scan from zero runs it after emptying them; an index that
 * already exists costs a catalog check. Runs on the maintenance client.
 * @returns {Promise<void>}
 */
async function prepareCollections() {
  const db = dbHelper.databaseConnection();
  const database = dbHelper.onMaintenanceClient(db.db(config.database.daemon.database));
  const databaseUpdates = dbHelper.onMaintenanceClient(db.db(config.database.chainparams.database));
  await fluxnodeAddressRecord.ensureIndexes(database);
  await dbHelper.ensureIndexes(database.collection(appsHashesCollection), [
    { key: { txid: 1 }, name: 'query for getting txid' },
    { key: { height: 1 }, name: 'query for getting height' },
    {
      key: { hash: 1 }, name: 'query for getting app hash', unique: true, recover: keepEarliestPayment,
    },
    { key: { message: 1 }, name: 'query for getting app hashes depending if we have message' },
    { key: { replaced: 1 }, name: 'query for getting replaced app payments', sparse: true },
    // a record without a position is indexed under null, so the boot backfill reads only those
    { key: { txIndex: 1 }, name: 'query for getting app hashes without a position' },
  ]);
  await dbHelper.ensureIndexes(databaseUpdates.collection(chainParamsMessagesCollection), [
    { key: { txid: 1 }, name: 'query for getting txid of some chain parameters update message' },
    { key: { height: 1 }, name: 'query for getting height of some chain parameters update message' },
    { key: { message: 1 }, name: 'query for getting message of some chain parameters update message' },
    { key: { version: 1 }, name: 'query for getting version of some chain parameters update message' },
  ]);
}

/**
 * Empties the explorer's collections and asserts their indexes, for a scan
 * from zero. Rejects when either fails, and the scan does not start.
 * @returns {Promise<void>}
 */
async function resetExplorerCollections() {
  log.info('Preparing daemon collections');
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const databaseUpdates = db.db(config.database.chainparams.database);
  const empty = [
    [database, appsHashesCollection],
    [databaseUpdates, chainParamsMessagesCollection],
  ];
  // eslint-disable-next-line no-restricted-syntax
  for (const [owner, collection] of empty) {
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.dropCollection(owner, collection).catch((error) => {
      if (error.message !== 'ns not found') throw error;
    });
  }
  await fluxnodeAddressRecord.drop(dbHelper.onMaintenanceClient(database));
  await prepareCollections();
  log.info('Preparation done');
}

/**
 * To restore database to specified block height.
 * @param {number} height Block height.
 * @returns {boolean} Value set to true after database is restored.
 */
async function restoreDatabaseToBlockheightState(height) {
  if (!Number.isInteger(height) || height < 0) {
    throw new Error('No valid blockheight for restoring provided');
  }
  paymentsToRequest = paymentsToRequest.filter((payment) => payment.height <= height);
  // Whole-collection deletes and updates: they run on the maintenance client.
  const dbopen = dbHelper.databaseConnection();
  const database = dbHelper.onMaintenanceClient(dbopen.db(config.database.daemon.database));

  const query = { height: { $gt: height } };

  // restore appsHashes collection
  await dbHelper.removeDocumentsFromCollection(database, appsHashesCollection, { ...query, replaced: { $exists: false } });
  await fluxnodeAddressRecord.restoreToHeight(height, database);
  log.info('Rescanning Blockchain Parameters!');
  const databaseUpdates = dbHelper.onMaintenanceClient(dbopen.db(config.database.chainparams.database));
  await dbHelper.removeDocumentsFromCollection(databaseUpdates, chainParamsMessagesCollection, query);
  log.info('Rescan completed');
  return true;
}

/**
 * Removes duplicate scannedheight documents, keeping only the one with the highest block height.
 * This cleans up legacy seeded documents that may exist on nodes.
 * @param {object} database MongoDB database connection.
 * @returns {Promise<void>}
 */
async function cleanupDuplicateScannedHeight(database) {
  try {
    const count = await dbHelper.countInDatabase(database, scannedHeightCollection, {});

    if (count <= 1) {
      return; // No duplicates, nothing to clean
    }

    log.warn(`Found ${count} scannedheight documents, cleaning up duplicates...`);

    // Get the document with highest block height (MongoDB sorts it)
    const highestArr = await dbHelper.findInDatabase(database, scannedHeightCollection, {}, {
      sort: { generalScannedHeight: -1 },
      limit: 1,
    });

    const highest = highestArr[0];

    log.info(`Keeping scannedheight document with height ${highest.generalScannedHeight} (_id: ${highest._id})`);

    // Delete all EXCEPT the highest
    const deleteResult = await dbHelper.removeDocumentsFromCollection(database, scannedHeightCollection, {
      _id: { $ne: highest._id },
    });

    log.info(`Removed ${deleteResult.deletedCount} duplicate scannedheight documents`);
  } catch (error) {
    log.error(`Error cleaning up duplicate scannedheight documents: ${error.message}`);
  }
}

// One-time migration for nodes carrying records from before the Feb 2021
// zelAppSpecifications → appSpecifications rename: bring data at rest in line
// with the field name the rest of the code now reads exclusively, and drop the
// indexes that backed the old field name. Idempotent (matches zero docs once
// migrated). Safe to remove, along with the gating flag, once the whole fleet
// has run it.
async function migrateZelAppSpecifications(databaseGlobal) {
  const col = databaseGlobal.collection(config.database.appsglobal.collections.appsMessages);
  const result = await col.updateMany(
    { zelAppSpecifications: { $exists: true } },
    { $rename: { zelAppSpecifications: 'appSpecifications' } },
  );
  if (result.modifiedCount > 0) {
    log.info(`Migrated ${result.modifiedCount} records from zelAppSpecifications to appSpecifications`);
  }
  const existingIndexes = await col.indexes();
  const legacyIndexNames = [
    'query for getting zelapp message based on zelapp specs name',
    'query for getting zelapp message based on zelapp specs owner',
    'query for getting zelapp message based on image',
  ];
  for (const idx of existingIndexes) {
    if (legacyIndexNames.includes(idx.name)) {
      // eslint-disable-next-line no-await-in-loop
      await col.dropIndex(idx.name);
      log.info(`Dropped legacy index: ${idx.name}`);
    }
  }
}

/**
 * To start the block processor.
 * @param {boolean} restoreDatabase True if database is to be restored.
 * @param {boolean} deepRestore True if a deep restore is required.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */

function getPriceSpecForHeight(priceSpecs, height) {
  let lo = 0;
  let hi = priceSpecs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (priceSpecs[mid].height < height) lo = mid;
    else hi = mid - 1;
  }
  return priceSpecs[lo];
}

async function bootstrapSoftForks(currentDaemonHeight) {
  const multisigAddresses = [config.fluxapps.addressMultisig, config.fluxapps.addressMultisigB];
  const deltas = await askDaemon(async () => {
    const result = await daemonServiceUtils.executeCall('getaddressdeltas', [{
      addresses: multisigAddresses,
      start: config.fluxapps.epochstart,
      end: currentDaemonHeight,
    }], { useCache: false });
    if (result.status !== 'success') throw new Error(`getaddressdeltas failed: ${result.data?.message ?? result.data}`);
    return result.data;
  });

  const byTx = new Map();
  for (const d of deltas) {
    if (!byTx.has(d.txid)) byTx.set(d.txid, []);
    byTx.get(d.txid).push(d);
  }
  const selfSendTxids = [];
  for (const [txid, deltas] of byTx) {
    const hasSpend = deltas.some((d) => d.satoshis < 0);
    const hasReceive = deltas.some((d) => d.satoshis > 0);
    if (hasSpend && hasReceive) selfSendTxids.push(txid);
  }

  if (selfSendTxids.length === 0) return;
  log.info(`Bootstrap: Found ${selfSendTxids.length} foundation self-send transactions, checking for soft forks`);

  const BATCH_SIZE = 500;
  const multisigSet = new Set(multisigAddresses);
  let totalForks = 0;
  for (let i = 0; i < selfSendTxids.length; i += BATCH_SIZE) {
    // eslint-disable-next-line no-await-in-loop
    const transactions = await getRawTransactions(selfSendTxids.slice(i, i + BATCH_SIZE));
    for (const tx of transactions) {
      let senderFoundation = false;
      let receiverFoundation = false;
      let message = '';

      for (const vin of (tx.vin || [])) {
        if (vin.address && multisigSet.has(vin.address)) { senderFoundation = true; break; }
      }
      for (const vout of tx.vout) {
        if (vout.scriptPubKey.addresses) {
          for (const addr of vout.scriptPubKey.addresses) {
            if (multisigSet.has(addr)) receiverFoundation = true;
          }
        }
        if (vout.scriptPubKey.asm) {
          const decoded = decodeMessage(vout.scriptPubKey.asm);
          if (decoded) message = decoded;
        }
      }

      if (senderFoundation && receiverFoundation && message) {
        // eslint-disable-next-line no-await-in-loop
        await processSoftFork(tx.txid, tx.height, message);
        totalForks += 1;
      }
    }
  }
  log.info(`Bootstrap: Stored ${totalForks} soft fork messages`);
}

/**
 * Records the app payment a transaction makes, unless its hash already has one.
 * @param {object} tx Verbose transaction
 * @param {Array<{height: number, minPrice: number}>} priceSpecs
 * @param {Set<string>} seenHashes Hashes already recorded
 * @param {object[]} hashBatch Records to insert
 * @param {number} txIndex The transaction's position in its block
 */
function processBootstrapTx(tx, priceSpecs, seenHashes, hashBatch, txIndex) {
  if (tx.version >= 5 || tx.version <= 0) return;
  const { height } = tx;
  if (!height) return;

  let message = '';
  let appValue = 0;

  for (const vout of tx.vout) {
    if (vout.scriptPubKey.addresses) {
      const addr = vout.scriptPubKey.addresses[0];
      if (addr === config.fluxapps.address
        || (addr === config.fluxapps.addressMultisig && height >= config.fluxapps.appSpecsEnforcementHeights[6])
        || (addr === config.fluxapps.addressMultisigB && height >= config.fluxapps.multisigAddressChange)
        || (addr === config.fluxapps.addressDevelopment && config.development)) {
        appValue += vout.valueSat;
      }
    }
    if (vout.scriptPubKey.asm) {
      message = decodeMessage(vout.scriptPubKey.asm);
    }
  }

  if (appValue > 0) {
    const priceSpec = getPriceSpecForHeight(priceSpecs, height);
    if (appValue >= (priceSpec.minPrice * 1e8) && message.length === 64
      && height >= config.fluxapps.epochstart && !seenHashes.has(message)) {
      seenHashes.add(message);
      hashBatch.push({
        txid: tx.txid, height, txIndex, hash: message, value: appValue,
        message: false, syncAttempts: 0, nextRetryHeight: height,
      });
    }
  }

}

/**
 * Records every app payment from `epochstart` to a height without scanning
 * blocks: each hash's first payment in chain order (height, then position in
 * the block).
 * @param {number} currentDaemonHeight
 * @returns {Promise<void>} Rejects when fluxd fails a call every time it is
 *   asked; nothing is skipped, and the scanned height is written last.
 */
async function bootstrapAppHashes(currentDaemonHeight) {
  log.info(`Bootstrap: Fetching app payments from height ${config.fluxapps.epochstart} to ${currentDaemonHeight}`);
  const positions = await askDaemon(() => appPaymentPositions(config.fluxapps.epochstart, currentDaemonHeight));
  const allTxids = [...positions.keys()].sort((a, b) => positions.get(a).height - positions.get(b).height
    || positions.get(a).txIndex - positions.get(b).txIndex);
  log.info(`Bootstrap: ${allTxids.length} unique txids to process`);

  await bootstrapSoftForks(currentDaemonHeight);
  const priceSpecs = await chainUtilities.getChainParamsPriceUpdates();

  const seenHashes = new Set();
  let hashBatch = [];
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);

  const BATCH_SIZE = 500;
  const INSERT_THRESHOLD = 5000;
  let totalHashes = 0;

  for (let i = 0; i < allTxids.length; i += BATCH_SIZE) {
    // eslint-disable-next-line no-await-in-loop
    const transactions = await getRawTransactions(allTxids.slice(i, i + BATCH_SIZE));
    for (const tx of transactions) {
      processBootstrapTx(tx, priceSpecs, seenHashes, hashBatch, positions.get(tx.txid).txIndex);
    }

    if (hashBatch.length >= INSERT_THRESHOLD || i + BATCH_SIZE >= allTxids.length) {
      if (hashBatch.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await insertTransactions(hashBatch, database);
        totalHashes += hashBatch.length;
        hashBatch = [];
      }
    }

    const processed = Math.min(i + BATCH_SIZE, allTxids.length);
    if (processed % 5000 < BATCH_SIZE || processed === allTxids.length) {
      log.info(`Bootstrap: ${processed}/${allTxids.length} txids processed, ${totalHashes + hashBatch.length} hashes`);
    }
  }

  await setScannedHeight(database, currentDaemonHeight);

  log.info(`Bootstrap complete: ${totalHashes} app hashes, scanned to height ${currentDaemonHeight}`);
}

/**
 * How long a step that needs fluxd synced waits before it runs again.
 * @returns {number} 0 when fluxd is synced.
 */
function untilDaemonSyncedMs() {
  if (daemonServiceMiscRpcs.isDaemonSynced().data.synced) return 0;
  const retryMs = config.fluxapps.explorerSyncRetryMs ?? 120000;
  log.info(`Explorer - Daemon not synced, retrying in ${retryMs / 1000}s`);
  return retryMs;
}

async function getScannedBlockHeightFromDb(database) {
  const query = { generalScannedHeight: { $gte: 0 } };
  const projection = { projection: { _id: 0, generalScannedHeight: 1 } };
  const current = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
  return current?.generalScannedHeight ?? 0;
}

/**
 * Sets the height the explorer's collections are complete to, from anywhere but
 * the processing of that block. Its hash is not known here, so the stored hash is
 * removed with it and the next block is processed without a parent check.
 * @param {object} database The daemon database.
 * @param {number} height
 * @returns {Promise<void>}
 */
async function setScannedHeight(database, height) {
  await dbHelper.updateOneInDatabase(database, scannedHeightCollection,
    { generalScannedHeight: { $gte: 0 } },
    { $set: { generalScannedHeight: height }, $unset: { generalScannedHash: '' } },
    { upsert: true });
  lastScannedBlock = null;
}

/**
 * The block the explorer processed at `height`, when its hash is known: the last
 * block processed, or the stored scanned height's.
 * @param {object} database The daemon database.
 * @param {number} height
 * @returns {Promise<{height: number, hash: string}|null>}
 */
async function scannedBlockAt(database, height) {
  if (lastScannedBlock?.height === height) return lastScannedBlock;
  const stored = await dbHelper.findOneInDatabase(database, scannedHeightCollection,
    { generalScannedHeight: { $gte: 0 } },
    { projection: { _id: 0, generalScannedHeight: 1, generalScannedHash: 1 } });
  if (stored?.generalScannedHeight === height && stored.generalScannedHash) {
    return { height, hash: stored.generalScannedHash };
  }
  return null;
}

/**
 * The highest block the explorer processed that is still on fluxd's active chain,
 * found by walking back from `block` along the branch it was on: one getblockhash
 * per height, and one getblockheader per block left behind, for no more blocks than
 * fluxd reorganises.
 * @param {{height: number, hash: string}} block A processed block no longer on the active chain.
 * @returns {Promise<{height: number, hash: string}|null>} Null when fluxd does not
 *   know a block of the branch, or the walk passes the deepest reorganisation.
 */
async function forkPoint(block) {
  let { height, hash } = block;
  const deepest = Math.max(block.height - MAX_REORG_BLOCKS, 0);
  while (height > 0 && height >= deepest) {
    // eslint-disable-next-line no-await-in-loop
    const active = await daemonServiceBlockchainRpcs.getBlockHash({ params: { index: height } });
    if (active.status !== 'success') return null;
    if (active.data === hash) return { height, hash };
    // eslint-disable-next-line no-await-in-loop
    const header = await daemonServiceBlockchainRpcs.getBlockHeader({ params: { hash, verbose: true } });
    if (header.status !== 'success' || !header.data?.previousblockhash) return null;
    hash = header.data.previousblockhash;
    height -= 1;
  }
  return null;
}

/**
 * Keeps the payment records above `height` as replaced: a reorganisation returns
 * their transactions to fluxd's mempool, so each still counts as paid until it is mined
 * again, or leaves the mempool (settleReplacedPayments).
 * @param {object} database The daemon database.
 * @param {number} height The height being restored to.
 * @param {number} tip The last block processed on the replaced branch.
 * @returns {Promise<void>}
 */
async function markReplacedPayments(database, height, tip) {
  await dbHelper.updateInDatabase(database, appsHashesCollection,
    { height: { $gt: height }, notOnChain: { $ne: true }, replaced: { $exists: false } },
    { $set: { replaced: tip } });
}

/**
 * Past the branch a reorganisation replaced, a replaced payment no block has paid again and
 * fluxd's mempool does not hold will not be mined: it is not on the chain. The registry is
 * rebuilt without it when this node stores its message; it reads only stored messages. The
 * mempool is asked afresh, as a cached answer may name a transaction
 * since dropped. An unanswered call is asked again on the next block.
 * @param {object} database The daemon database.
 * @param {number} height The block just processed.
 * @returns {Promise<void>}
 */
async function settleReplacedPayments(database, height) {
  try {
    const replaced = await dbHelper.findInDatabase(database, appsHashesCollection,
      { replaced: { $lt: height } }, { projection: { _id: 0, hash: 1, txid: 1 } });
    if (!replaced.length) return;
    const mempool = await daemonServiceUtils.executeCall('getRawMemPool', [false], { useCache: false });
    if (mempool.status !== 'success') throw new Error(mempool.data?.message ?? 'fluxd did not answer');
    const pending = new Set(mempool.data);
    const hashes = replaced.filter(({ txid }) => !pending.has(txid)).map(({ hash }) => hash);
    if (!hashes.length) return;
    const appsDatabase = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    const stored = await dbHelper.findOneInDatabase(appsDatabase, appsMessagesCollection,
      { hash: { $in: hashes } }, { projection: { _id: 0, hash: 1 } });
    await dbHelper.updateInDatabase(database, appsHashesCollection, { hash: { $in: hashes } },
      { $set: { notOnChain: true }, $unset: { replaced: '' } });
    log.warn(`Explorer - ${hashes.length} replaced app payments were not mined again`);
    if (stored) await registryManager.reindexGlobalAppsInformation();
    fluxEventBus.publish('explorer:paymentsDropped', { hashes });
  } catch (error) {
    log.error(`Explorer - replaced payments not settled: ${error.message}`);
  }
}

/**
 * Restores the explorer's collections to the last processed block still on
 * fluxd's active chain, or explorerDeepRestoreBlocks below `parent` when that
 * block is not found. fluxd refuses a reorganisation of MAX_REORG_BLOCKS or more,
 * so that restore lies below any fork fluxd can make; the block after it is
 * processed without a parent check, and a chain rewound past the restore by hand
 * is not detected.
 * @param {object} database The daemon database.
 * @param {{height: number, hash: string}} parent The processed block the next block does not follow.
 * @returns {Promise<number>} The height restored to.
 */
async function rewindToFork(database, parent) {
  const deepRestoreBlocks = config.fluxapps.explorerDeepRestoreBlocks ?? 100;
  const fork = await forkPoint(parent);
  const height = fork ? fork.height : Math.max(parent.height - deepRestoreBlocks, 0);
  log.warn(`Explorer - block ${parent.height + 1} does not follow ${parent.hash}: chain reorganised, `
    + `${fork ? `restoring to ${fork.height}` : `fork not found, restoring to ${height}`}`);
  await markReplacedPayments(database, height, parent.height);
  await restoreDatabaseToBlockheightState(height);
  if (fork) {
    await dbHelper.updateOneInDatabase(database, scannedHeightCollection,
      { generalScannedHeight: { $gte: 0 } },
      { $set: { generalScannedHeight: fork.height, generalScannedHash: fork.hash } },
      { upsert: true });
    lastScannedBlock = fork;
  } else {
    await setScannedHeight(database, height);
  }
  // Once the restored height is stored, so a reader of the event finds it.
  fluxEventBus.publish('explorer:reorganised', { parentHeight: parent.height, restoredTo: height, forkFound: Boolean(fork) });
  log.info('Database restored OK');
  return height;
}

// How long the explorer waits before asking again whether the chain has moved.
//
// This is the floor on how fast a node can process blocks: a block is not looked
// at until the next poll, so nothing downstream of block processing - expiring
// app records, trimming surplus instances, the give-up pass - can run more often
// than this however fast blocks are produced. Production wants 5s against a 30s
// block; a harness driving its own chain wants it far shorter, and had no way to
// say so.
const POLL_INTERVAL_MS = config.fluxapps.explorerPollIntervalMs ?? 5000;

/**
 * The block processor's step at the tip: whether fluxd holds a block the
 * explorer has not processed, or a reorganisation moved the explorer back.
 * @returns {Promise<{next: object, waitMs: number}>}
 */
async function pollForNewBlocks() {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) return after(Step.poll(), POLL_INTERVAL_MS);

    const daemonHeight = syncStatus.data.height;
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);
    const scannedBlockHeight = await getScannedBlockHeightFromDb(database);

    if (daemonHeight > scannedBlockHeight) return after(Step.block(scannedBlockHeight + 1));

    // Said on every poll, so a listener started after the scan reached the tip hears it.
    if (daemonHeight === scannedBlockHeight) {
      isSynced = true;
      blockEmitter.emit('explorerAtTip', scannedBlockHeight);
    }

    return after(Step.poll(), POLL_INTERVAL_MS);
  } catch (error) {
    log.error(`Explorer poll error: ${error.message}`);
    return after(Step.poll(), POLL_INTERVAL_MS);
  }
}

/**
 * The block processor's step after a failure: the database put back to a
 * height it holds, then the block after it.
 * @param {boolean} restoreDatabase
 * @param {boolean} deepRestore Restore explorerDeepRestoreBlocks below the scanned height.
 * @returns {Promise<{next: object, waitMs: number}>} The setup again, after
 *   BOOTSTRAP_RETRY_MS, when nothing is scanned.
 */
async function recoverAndRestart(restoreDatabase, deepRestore) {
  const syncWaitMs = untilDaemonSyncedMs();
  if (syncWaitMs) return after(Step.recover(restoreDatabase, deepRestore), syncWaitMs);
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);
    let scannedBlockHeight = await getScannedBlockHeightFromDb(database);
    if (scannedBlockHeight === 0) {
      log.info(`Explorer has scanned nothing, bootstrapping again in ${BOOTSTRAP_RETRY_MS / 1000}s`);
      return after(Step.init(false, false), BOOTSTRAP_RETRY_MS);
    }

    if (restoreDatabase) {
      const deepRestoreBlocks = config.fluxapps.explorerDeepRestoreBlocks ?? 100;
      if (deepRestore && deepRestoreBlocks > 0) {
        log.info('Deep restoring of database...');
        scannedBlockHeight = Math.max(scannedBlockHeight - deepRestoreBlocks, 0);
        await restoreDatabaseToBlockheightState(scannedBlockHeight);
        await setScannedHeight(database, scannedBlockHeight);
      } else {
        log.info('Restoring database...');
        await restoreDatabaseToBlockheightState(scannedBlockHeight);
      }
      log.info('Database restored OK');
    }

    if (scannedBlockHeight < config.fluxapps.epochstart - 1) {
      scannedBlockHeight = config.fluxapps.epochstart - 1;
    }
    return after(Step.block(scannedBlockHeight + 1));
  } catch (error) {
    log.error(`Recovery failed: ${error.message}`);
    return after(Step.recover(true, true), RECOVERY_RETRY_MS);
  }
}

/**
 * The block processor's first step: the collections and records the scan needs,
 * then the bootstrap from the address index when nothing is scanned.
 * @param {boolean} restoreDatabase
 * @param {boolean} deepRestore Restore explorerDeepRestoreBlocks below the scanned height.
 * @returns {Promise<{next: object, waitMs: number}>}
 */
async function initialiseBlockProcessor(restoreDatabase, deepRestore) {
  const syncWaitMs = untilDaemonSyncedMs();
  if (syncWaitMs) return after(Step.init(restoreDatabase, deepRestore), syncWaitMs);
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);

    await cleanupDuplicateScannedHeight(database);

    if (!zelAppSpecsMigrationDone) {
      // Wrapped so a malformed or fresh-sync DB (e.g. col.indexes() on a
      // not-yet-created collection) can't stall block-processor init.
      try {
        const globalDb = db.db(config.database.appsglobal.database);
        await migrateZelAppSpecifications(globalDb);
        zelAppSpecsMigrationDone = true;
      } catch (error) {
        log.error(`zelAppSpecifications migration failed: ${error.message}`);
      }
    }

    let scannedBlockHeight = await getScannedBlockHeightFromDb(database);

    const daemonBlockCount = await daemonServiceBlockchainRpcs.getBlockCount();
    if (daemonBlockCount.status !== 'success') {
      throw new Error(daemonBlockCount.data.message || daemonBlockCount.data);
    }
    const daemonHeight = daemonBlockCount.data;

    // A scan from zero starts on empty collections holding every index.
    if (scannedBlockHeight === 0) await resetExplorerCollections();

    if (daemonHeight > scannedBlockHeight) {
      if (scannedBlockHeight !== 0 && restoreDatabase) {
        const deepRestoreBlocks = config.fluxapps.explorerDeepRestoreBlocks ?? 100;
        if (deepRestore && deepRestoreBlocks > 0) {
          log.info('Deep restoring of database...');
          scannedBlockHeight = Math.max(scannedBlockHeight - deepRestoreBlocks, 0);
          await restoreDatabaseToBlockheightState(scannedBlockHeight);
          await setScannedHeight(database, scannedBlockHeight);
          log.info('Database restored OK');
        } else if (!deepRestore) {
          log.info('Restoring database...');
          await restoreDatabaseToBlockheightState(scannedBlockHeight);
          log.info('Database restored OK');
        }
      }
    }

    // An explorer further behind passes the record's blocks in order as it catches up.
    if (await fluxnodeAddressRecord.isBuilt()) {
      fluxnodeAddressRecord.resumeAt(scannedBlockHeight);
    } else if (daemonHeight - scannedBlockHeight < fluxnodeAddressRecord.RECORD_BLOCKS) {
      log.info(`Building the fluxnode address record from the blocks up to ${scannedBlockHeight}`);
      try {
        await fluxnodeAddressRecord.rebuild(scannedBlockHeight, (height) => askDaemon(() => getVerboseBlock(height)), dbHelper.onMaintenanceClient(database));
      } catch (error) {
        // The record then starts at the blocks the explorer processes next.
        log.error(`The fluxnode address record was not built: ${error?.message ?? error}`);
      }
    }

    if (!explorerReadyEmitted) {
      explorerReadyEmitted = true;
      fluxEventBus.publish('explorer:ready', { height: scannedBlockHeight });
    }

    if (daemonHeight <= scannedBlockHeight) {
      return after(Step.poll());
    }

    // The bootstrap stops the record's blocks short of the tip: processing them
    // records them, with the app payments they carry.
    const bootstrapHeight = daemonHeight - fluxnodeAddressRecord.RECORD_BLOCKS;
    if (scannedBlockHeight === 0 && bootstrapHeight >= config.fluxapps.epochstart) {
      // A bootstrap that fails leaves nothing scanned, so the recovery runs it again.
      log.info('Bootstrap: Using address-index fast path');
      await bootstrapAppHashes(bootstrapHeight);
      log.info(`Bootstrap complete, processing the blocks from ${bootstrapHeight + 1}`);
      return after(Step.block(bootstrapHeight + 1));
    }
    if (scannedBlockHeight < config.fluxapps.epochstart - 1) {
      scannedBlockHeight = config.fluxapps.epochstart - 1;
    }
    return after(Step.block(scannedBlockHeight + 1));
  } catch (error) {
    log.error(error);
    return after(Step.recover(true, true));
  }
}

const STEPS = {
  init: ({ restoreDatabase, deepRestore }) => initialiseBlockProcessor(restoreDatabase, deepRestore),
  block: ({ height }) => processBlock(height),
  poll: () => pollForNewBlocks(),
  recover: ({ restoreDatabase, deepRestore }) => recoverAndRestart(restoreDatabase, deepRestore),
};

/**
 * One step of the block processor, under the controller's lock so a stop waits
 * for it. Answers how long the loop waits before the next.
 * @returns {Promise<number>}
 */
async function runBlockProcessorStep() {
  await processor.lock.enable();
  try {
    const { next, waitMs } = await STEPS[nextStep.run](nextStep);
    nextStep = next;
    return waitMs;
  } finally {
    processor.lock.disable();
  }
}

/**
 * Start the block processor at its setup step.
 * @param {boolean} restoreDatabase
 * @param {boolean} deepRestore Restore explorerDeepRestoreBlocks below the scanned height.
 * @returns {boolean} False when it is already running or stopping.
 */
function initiateBlockProcessor(restoreDatabase, deepRestore) {
  if (processor.running) return false;
  nextStep = Step.init(restoreDatabase, deepRestore);
  return processor.startLoop(runBlockProcessorStep);
}

/**
 * Stop the block processor: no wait is left pending, and nothing runs after the
 * step in flight, which this waits for.
 * @returns {Promise<void>}
 */
function stopBlockProcessor() {
  return processor.abort();
}

/**
 * @returns {boolean} Whether the block processor is running or stopping.
 */
function isBlockProcessorRunning() {
  return processor.running;
}

// The answer of an endpoint whose data the daemon's address index does not hold.
const DEPRECATED = messageHelper.createErrorMessage('Data unavailable. Deprecated', 'Error');

/**
 * To get all UTXOs (unspent transaction outputs).
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAllUtxos(req, res) {
  res.json(DEPRECATED);
}

/**
 * To get all Fusion/Coinbase transactions.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAllFusionCoinbase(req, res) {
  res.json(DEPRECATED);
}

/**
 * To get all addresses with transactions.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAllAddressesWithTransactions(req, res) {
  res.json(DEPRECATED);
}

/**
 * To get all addresses.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAllAddresses(req, res) {
  res.json(DEPRECATED);
}

/**
 * To get all UTXOs for a specific address.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAddressUtxos(req, res) {
  try {
    let { address } = req?.params || {}; // we accept both help/command and help?command=getinfo
    address = address || req?.query?.address;
    if (!address) {
      throw new Error('No address provided');
    }
    const daemonRequest = {
      params: {
        address,
      },
      query: {},
    };
    const insightResult = await daemonServiceAddressRpcs.getSingleAddressUtxos(daemonRequest);
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    const curHeight = syncStatus.data.height;
    const utxos = [];
    insightResult.data.forEach((utxo) => {
      const adjustedUtxo = {
        address: utxo.address,
        txid: utxo.txid,
        vout: utxo.outputIndex,
        height: utxo.height,
        satoshis: utxo.satoshis,
        scriptPubKey: utxo.script,
        confirmations: curHeight - utxo.height, // HERE DIFFERS, insight more compatible with zelcore as coinbase is spendable after 100
      };
      utxos.push(adjustedUtxo);
    });
    const resMessage = messageHelper.createDataMessage(utxos);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get UTXOs for a specific Fusion/Coinbase address.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAddressFusionCoinbase(req, res) {
  res.json(DEPRECATED);
}

/**
 * To get transactions for a specific address.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAddressTransactions(req, res) {
  try {
    let { address } = req.params || {}; // we accept both help/command and help?command=getinfo
    address = address || req.query.address;
    if (!address) {
      throw new Error('No address provided');
    }
    const daemonRequest = {
      params: {
        address,
      },
      query: {},
    };
    const insightResult = await daemonServiceAddressRpcs.getSingleAddresssTxids(daemonRequest);
    const txids = insightResult.data.reverse(); // from newest txid to lastest [{txid:'abc'}, {txid: 'efg'}]
    const txidsOK = [];
    txids.forEach((txid) => {
      txidsOK.push({
        txid,
      });
    });
    const resMessage = messageHelper.createDataMessage(txidsOK);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get scanned block height.
 * @param {object} req Reqest.
 * @param {object} res Response.
 */
async function getScannedHeight(req, res) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const resMessage = messageHelper.createDataMessage(result);
    return res ? res.json(resMessage) : resMessage;
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    return res ? res.json(errMessage) : errMessage;
  }
}

/**
 * To stop block processing. Flux team only. Answers once the step in flight has
 * finished; nothing runs after it until a start or a restart.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function stopBlockProcessing(req, res) {
  const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
  if (authorized !== true) {
    res.json(messageHelper.errUnauthorizedMessage());
    return;
  }
  await stopBlockProcessor();
  res.json(messageHelper.createSuccessMessage('Block processing is stopped'));
}

/**
 * To start block processing when it is stopped. Flux team only.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function startBlockProcessing(req, res) {
  const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
  if (authorized !== true) {
    res.json(messageHelper.errUnauthorizedMessage());
    return;
  }
  if (!initiateBlockProcessor(true, false)) {
    res.json(messageHelper.createErrorMessage('Block processing is already running'));
    return;
  }
  res.json(messageHelper.createSuccessMessage('Block processing initiated'));
}

/**
 * To stop block processing and start it again. Flux team only.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function restartBlockProcessing(req, res) {
  const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
  if (authorized !== true) {
    res.json(messageHelper.errUnauthorizedMessage());
    return;
  }
  await stopBlockProcessor();
  initiateBlockProcessor(true, false);
  res.json(messageHelper.createSuccessMessage('Block processing initiated'));
}

/**
 * Refuse the apps flag of an explorer reindex or rescan. The explorer reset
 * covers chain data only: the app messages come from the network, not the chain,
 * and the registry has its own rebuild, which keeps the live registry until the
 * new one is complete.
 * @param {object} res Response.
 * @returns {*} the sent response
 */
function refuseAppsFlag(res) {
  const errMessage = messageHelper.createErrorMessage(
    'The explorer reset covers chain data only. Rebuild the app registry with /apps/reindexglobalappsinformation.',
    'BadRequest',
    400,
  );
  return res.status(400).json(errMessage);
}

/**
 * To reindex Flux explorer database.
 *
 * Flux team only. Chain data only: the apps flag is refused (refuseAppsFlag).
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexExplorer(req, res) {
  const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
  if (authorized === true) {
    const { reindexapps } = req?.params || {};
    if (serviceHelper.ensureBoolean(reindexapps ?? req?.query?.rescanapps ?? false)) {
      refuseAppsFlag(res);
      return;
    }
    if (operationBlocked) {
      res.json(messageHelper.createErrorMessage('Operation blocked'));
      return;
    }
    operationBlocked = true;
    await stopBlockProcessor();
    try {
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      await dbHelper.dropCollection(database, scannedHeightCollection).catch((error) => {
        // A collection that is already gone is the reindex's starting point.
        if (error.message !== 'ns not found') throw error;
      });
    } catch (error) {
      log.error(error);
      res.json(messageHelper.createErrorMessage(error.message, error.name, error.code));
      return;
    } finally {
      operationBlocked = false;
      initiateBlockProcessor(true, false);
    }
    res.json(messageHelper.createSuccessMessage('Explorer database reindex initiated'));
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

/**
 * To rescan Flux explorer database from a specific block height.
 *
 * Flux team only. Chain data only: the apps flag is refused (refuseAppsFlag).
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function rescanExplorer(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
    if (authorized === true) {
      const { rescanapps } = req?.params || {};
      if (serviceHelper.ensureBoolean(rescanapps ?? req?.query?.rescanapps ?? false)) {
        refuseAppsFlag(res);
        return;
      }
      // since what blockheight
      let { blockheight } = req?.params || {}; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req?.query?.blockheight;
      if (!blockheight) {
        const errMessage = messageHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
        return;
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
      if (!currentHeight) {
        throw new Error('No scanned height found');
      }
      if (currentHeight.generalScannedHeight <= blockheight) {
        throw new Error('Block height shall be lower than currently scanned');
      }
      if (blockheight < 0) {
        throw new Error('BlockHeight lower than 0');
      }
      if (operationBlocked) {
        res.json(messageHelper.createErrorMessage('Operation blocked'));
        return;
      }
      operationBlocked = true;
      await stopBlockProcessor();
      try {
        await setScannedHeight(database, blockheight);
      } catch (error) {
        log.error(error);
        res.json(messageHelper.createErrorMessage(error.message, error.name, error.code));
        return;
      } finally {
        operationBlocked = false;
        initiateBlockProcessor(true, false);
      }
      res.json(messageHelper.createSuccessMessage(`Explorer rescan from blockheight ${blockheight} initiated`));
    } else {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    operationBlocked = false;
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get the Flux balance for a specific address.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAddressBalance(req, res) {
  try {
    let { address } = req.params; // we accept both help/command and help?command=getinfo
    address = address || req.query.address || '';
    if (!address) {
      throw new Error('No address provided');
    }
    const daemonRequest = {
      params: {
        address,
      },
      query: {},
    };
    const insightResult = await daemonServiceAddressRpcs.getSingleAddressBalance(daemonRequest);
    const { balance } = insightResult.data;
    const resMessage = messageHelper.createDataMessage(balance);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get if explorer is synced.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function isExplorerSynced(req, res) {
  const resMessage = messageHelper.createDataMessage(isSynced);
  res.json(resMessage);
}

// testing purposes: one step, outside the processor's loop
function runStep(step) {
  return STEPS[step.run](step);
}

// testing purposes
function setZelAppSpecsMigrationDone(value) {
  zelAppSpecsMigrationDone = value;
}

module.exports = {
  prepareCollections,
  resetExplorerCollections,
  keepEarliestPayment,
  initiateBlockProcessor,
  processBlock,
  scheduleUpnpBench,
  // Test seam: each unit test starts from a node that has processed no block.
  resetBlockCadenceForTests: () => { cadence = new BlockCadence(); },
  settleReplacedPayments,
  forgetScannedBlockForTests: () => { lastScannedBlock = null; },
  reindexExplorer,
  rescanExplorer,
  stopBlockProcessing,
  startBlockProcessing,
  restartBlockProcessing,
  stopBlockProcessor,
  isBlockProcessorRunning,
  Step,
  runStep,
  getAllUtxos,
  getAllAddressesWithTransactions,
  getAllAddresses,
  getAddressUtxos,
  getAddressTransactions,
  getAddressBalance,
  getScannedHeight,
  getAllFusionCoinbase,
  getAddressFusionCoinbase,
  getBlockEmitter,

  // exports for testing purposes
  bootstrapSoftForks,
  bootstrapAppHashes,
  getPriceSpecForHeight,
  processBootstrapTx,
  getVerboseBlock,
  decodeMessage,
  processInsight,
  insertTransactions,
  setZelAppSpecsMigrationDone,
  restoreDatabaseToBlockheightState,

  isExplorerSynced,
  pollForNewBlocks,
};
