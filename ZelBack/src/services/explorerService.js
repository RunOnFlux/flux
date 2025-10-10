const config = require('config');
const EventEmitter = require('node:events');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const verificationHelper = require('./verificationHelper');
const messageHelper = require('./messageHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceControlRpcs = require('./daemonService/daemonServiceControlRpcs');
const daemonServiceAddressRpcs = require('./daemonService/daemonServiceAddressRpcs');
const daemonServiceTransactionRpcs = require('./daemonService/daemonServiceTransactionRpcs');
const daemonServiceBlockchainRpcs = require('./daemonService/daemonServiceBlockchainRpcs');
const appsService = require('./appsService');
const benchmarkService = require('./benchmarkService');
const fluxNetworkhelper = require('./fluxNetworkHelper');

const coinbaseFusionIndexCollection = config.database.daemon.collections.coinbaseFusionIndex; // fusion
const utxoIndexCollection = config.database.daemon.collections.utxoIndex;
const appsHashesCollection = config.database.daemon.collections.appsHashes;
const addressTransactionIndexCollection = config.database.daemon.collections.addressTransactionIndex;
const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const chainParamsMessagesCollection = config.database.chainparams.collections.chainMessages;

let blockProccessingCanContinue = true;
let someBlockIsProcessing = false;
let isInInitiationOfBP = false;
let operationBlocked = false;
let initBPfromNoBlockTimeout;
let initBPfromErrorTimeout;
let appsTransactions = [];
let isSynced = false;
let cachedDaemonVersion = null; // Cache for daemon version

const blockEmitter = new EventEmitter();

function getBlockEmitter() {
  return blockEmitter;
}

/**
 * To get and cache the daemon version
 * @returns {Promise<number>} Daemon version number
 */
async function getDaemonVersion() {
  if (cachedDaemonVersion !== null) {
    return cachedDaemonVersion;
  }

  try {
    const daemonInfo = await daemonServiceControlRpcs.getInfo();
    if (daemonInfo.status === 'success' && daemonInfo.data && daemonInfo.data.version) {
      cachedDaemonVersion = daemonInfo.data.version;
      return cachedDaemonVersion;
    }
  } catch (error) {
    log.warn(`Failed to get daemon version: ${error.message}`);
  }

  // Default to 0 if unable to get version
  cachedDaemonVersion = 0;
  return cachedDaemonVersion;
}

/**
 * To return the sender's transaction info from the daemon service.
 * @param {string} txid Transaction ID.
 * @returns {object} Transaction obtained from transaction cache.
 */
async function getSenderTransactionFromDaemon(txid) {
  const verbose = 1;
  const req = {
    params: {
      txid,
      verbose,
    },
  };

  const txContent = await daemonServiceTransactionRpcs.getRawTransaction(req);
  if (txContent.status === 'success') {
    const sender = txContent.data;
    return sender;
  }
  throw txContent.data;
}

/**
 * To return the sender address of a transaction (from Flux database or Blockchain).
 * @param {string} txid Transaction ID.
 * @param {number} vout Transaction output number (vector of outputs).
 * @returns {object} Document.
 */
async function getSender(txid, vout) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = { $and: [{ txid }, { vout }] };
  // we do not need other data as we are just asking what the sender address is.
  const projection = {
    projection: {
      _id: 0,
      // txid: 1,
      // vout: 1,
      // height: 1,
      address: 1,
      // satoshis: 1,
      // scriptPubKey: 1,
      // coinbase: 1,
    },
  };

  // find and delete the utxo from global utxo list
  const txContent = await dbHelper.findOneAndDeleteInDatabase(database, utxoIndexCollection, query, projection);
  if (!txContent.value) {
    // we are spending it anyway so it wont affect users balance
    log.info(`Transaction ${txid} ${vout} not found in database. Falling back to blockchain data`);
    const sender = await getSenderTransactionFromDaemon(txid);
    const senderData = sender.vout[vout];
    const simpletxContent = {
      // txid,
      // vout,
      // height: sender.height,
      address: senderData.scriptPubKey.addresses[0], // always exists as it is utxo.
      // satoshis: senderData.valueSat,
      // scriptPubKey: senderData.scriptPubKey.hex,
    };
    return simpletxContent;
  }
  const sender = txContent.value;
  return sender;
}

/**
 * To process a transaction. This checks that a transaction is UTXO and if so, stores it to the database to include the sender.
 * @param {object} txContent Transaction content.
 * @param {number} height Blockchain height.
 * @returns {object} Transaction detail.
 */
async function processTransaction(txContent, height) {
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  let transactionDetail = {};
  transactionDetail = txContent;
  if (txContent.version < 5 && txContent.version > 0) {
    // if transaction has no vouts, it cannot be an utxo. Do not store it.
    await Promise.all(transactionDetail.vout.map(async (vout, index) => {
      // we need only utxo related information
      let coinbase = false;
      if (transactionDetail.vin[0]) {
        if (transactionDetail.vin[0].coinbase) {
          coinbase = true;
        }
      }
      // account for messages
      if (vout.scriptPubKey.addresses) {
        const utxoDetail = {
          txid: txContent.txid,
          vout: index,
          height,
          address: vout.scriptPubKey.addresses[0],
          satoshis: vout.valueSat,
          scriptPubKey: vout.scriptPubKey.hex,
          coinbase,
        };
        // put the utxo to our mongoDB utxoIndex collection.
        await dbHelper.insertOneToDatabase(database, utxoIndexCollection, utxoDetail);
        // track coinbase txs for additional rewards on paralel chains for fusion
        if (coinbase && height > 825000) { // 825000 is snapshot, 825001 is first block eligible for rewards on other chains
          await dbHelper.insertOneToDatabase(database, coinbaseFusionIndexCollection, utxoDetail);
        }
      }
    }));

    // fetch senders from our mongoDatabase
    const sendersToFetch = [];

    txContent.vin.forEach((vin) => {
      if (!vin.coinbase) {
        // we need an address who sent those coins and amount of it.
        sendersToFetch.push(vin);
      }
    });

    const senders = []; // Can put just value and address
    // parallel reading causes daemon to fail with error 500
    // await Promise.all(sendersToFetch.map(async (sender) => {
    //   const senderInformation = await getSender(sender.txid, sender.vout);
    //   senders.push(senderInformation);
    // }));
    // use sequential
    // eslint-disable-next-line no-restricted-syntax
    for (const sender of sendersToFetch) {
      // eslint-disable-next-line no-await-in-loop
      const senderInformation = await getSender(sender.txid, sender.vout);
      senders.push(senderInformation);
    }
    transactionDetail.senders = senders;
  }
  // transactionDetail now contains senders. So then going through senders and vouts when generating indexes.
  return transactionDetail;
}

/**
 * To process a block of transactions.
 * @param {object[]} txs Array of transaction content objects.
 * @param {number} height Blockchain height.
 * @returns {object[]} Array of transaction detail objects.
 */
async function processBlockTransactions(txs, height) {
  const transactions = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const transaction of txs) {
    // eslint-disable-next-line no-await-in-loop
    const txContent = await processTransaction(transaction, height);
    transactions.push(txContent);
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(75); // delay of 75ms to not kill mongodb 800 transactions per minute.
  }
  return transactions;
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
 * To process verbose block data for entry to Insight database.
 * @param {object} blockDataVerbose Verbose block data.
 * @param {string} database Database.
 */
async function processInsight(blockDataVerbose, database) {
  // get Block Deltas information
  const txs = blockDataVerbose.tx;
  // go through each transaction in deltas
  // eslint-disable-next-line no-restricted-syntax
  for (const tx of txs) {
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
        const appPrices = await appsService.getChainParamsPriceUpdates();
        const intervals = appPrices.filter((i) => i.height < blockDataVerbose.height);
        const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
        // MAY contain App transaction. Store it.
        if (isFluxAppMessageValue >= (priceSpecifications.minPrice * 1e8) && message.length === 64 && blockDataVerbose.height >= config.fluxapps.epochstart) { // min of X flux had to be paid for us bothering checking
          const appTxRecord = {
            txid: tx.txid, height: blockDataVerbose.height, hash: message, value: isFluxAppMessageValue, message: false, // message is boolean saying if we already have it stored as permanent message
          };
          // Unique hash - If we already have a hash of this app in our database, do not insert it!
          try {
            // 5501c7dd6516c3fc2e68dee8d4fdd20d92f57f8cfcdc7b4fcbad46499e43ed6f
            const querySearch = {
              hash: message,
            };
            const projectionSearch = {
              projection: {
                _id: 0,
                txid: 1,
                hash: 1,
                height: 1,
                value: 1,
                message: 1,
              },
            };
            // eslint-disable-next-line no-await-in-loop
            const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, querySearch, projectionSearch); // this search can be later removed if nodes rescan apps and reconstruct the index for unique
            if (!result) {
              appsTransactions.push(appTxRecord);
            } else {
              throw new Error(`Found an existing hash app ${serviceHelper.ensureString(result)}`);
            }
          } catch (error) {
            log.error(`Hash ${message} already exists. Not adding at height ${blockDataVerbose.height}`);
            log.error(error);
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
          log.error('Error processing soft fork message:', error);
          // Continue processing other transactions even if soft fork processing fails
        }
      }
    }
  }
}

async function insertTransactions(transactions, database) {
  if (transactions.length > 0) {
    log.info(`Explorer - insertTransactions - Inserting ${transactions.length} transactions to apps hashes collection`);
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
        }
      }
    }
    appsTransactions = [];
  }
}

/**
 * To process transactions inserts on database and calling app messages.
 * @param {array} apps array with appstransactions to be processed.
 * @param {string} database Database.
 */
async function insertAndRequestAppHashes(apps, database) {
  if (apps.length > 0) {
    await insertTransactions(apps, database);
    setTimeout(async () => {
      const appsToRemove = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const app of apps) {
        // eslint-disable-next-line no-await-in-loop
        const messageReceived = await appsService.checkAndRequestApp(app.hash, app.txid, app.height, app.value, 2);
        if (messageReceived) {
          appsToRemove.push(app);
        }
      }
      apps.filter((item) => !appsToRemove.includes(item));
      while (apps.length > 500) {
        appsService.checkAndRequestMultipleApps(apps.splice(0, 500));
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(30 * 1000); // delay 30 seconds
      }
      if (apps.length > 0) {
        appsService.checkAndRequestMultipleApps(apps);
      }
    }, 1);
  }
}
/**
 * To process verbose block data for entry to database.
 * @param {object} blockDataVerbose Verbose block data.
 * @param {string} database Database.
 */
async function processStandard(blockDataVerbose, database) {
  // get Block transactions information
  const transactions = await processBlockTransactions(blockDataVerbose.tx, blockDataVerbose.height);
  // now we have verbose transactions of the block extended for senders - object of
  // utxoDetail = { txid, vout, height, address, satoshis, scriptPubKey )
  // and can create addressTransactionIndex.
  // amount in address can be calculated from utxos. We do not need to store it.
  await Promise.all(transactions.map(async (tx) => {
    // normal transactions
    if (tx.version < 5 && tx.version > 0) {
      let message = '';
      let isFluxAppMessageValue = 0;
      let isSenderFoundation = false;
      let isReceiverFounation = false;

      const addresses = [];
      tx.senders.forEach((sender) => {
        addresses.push(sender.address);
        if (sender.address === config.fluxapps.addressMultisig || sender.address === config.fluxapps.addressMultisigB) {
          isSenderFoundation = true;
        }
      });
      tx.vout.forEach((receiver) => {
        if (receiver.scriptPubKey.addresses) { // count for messages
          addresses.push(receiver.scriptPubKey.addresses[0]);
          if (receiver.scriptPubKey.addresses[0] === config.fluxapps.address
            || (receiver.scriptPubKey.addresses[0] === config.fluxapps.addressMultisig && blockDataVerbose.height >= config.fluxapps.appSpecsEnforcementHeights[6])
            || (receiver.scriptPubKey.addresses[0] === config.fluxapps.addressMultisigB && blockDataVerbose.height >= config.fluxapps.multisigAddressChange)) {
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
      const addressesOK = [...new Set(addresses)];
      const transactionRecord = { txid: tx.txid, height: blockDataVerbose.height };
      // update addresses from addressesOK array in our database. We need blockheight there too. transac
      await Promise.all(addressesOK.map(async (address) => {
        // maximum of 10000 txs per address in one document
        const query = { address, count: { $lt: 10000 } };
        const update = { $set: { address }, $push: { transactions: transactionRecord }, $inc: { count: 1 } };
        const options = {
          upsert: true,
        };
        await dbHelper.updateOneInDatabase(database, addressTransactionIndexCollection, query, update, options);
      }));
      if (isFluxAppMessageValue) {
        const appPrices = await appsService.getChainParamsPriceUpdates();
        const intervals = appPrices.filter((i) => i.height < blockDataVerbose.height);
        const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
        // MAY contain App transaction. Store it.
        if (isFluxAppMessageValue >= (priceSpecifications.minPrice * 1e8) && message.length === 64 && blockDataVerbose.height >= config.fluxapps.epochstart) { // min of 1 flux had to be paid for us bothering checking
          const appTxRecord = {
            txid: tx.txid, height: blockDataVerbose.height, hash: message, value: isFluxAppMessageValue, message: false, // message is boolean saying if we already have it stored as permanent message
          };
          // Unique hash - If we already have a hash of this app in our database, do not insert it!
          try {
            // 5501c7dd6516c3fc2e68dee8d4fdd20d92f57f8cfcdc7b4fcbad46499e43ed6f
            const querySearch = {
              hash: message,
            };
            const projectionSearch = {
              projection: {
                _id: 0,
                txid: 1,
                hash: 1,
                height: 1,
                value: 1,
                message: 1,
              },
            };
            const result = await dbHelper.findOneInDatabase(database, appsHashesCollection, querySearch, projectionSearch); // this search can be later removed if nodes rescan apps and reconstruct the index for unique
            if (!result) {
              appsTransactions.push(appTxRecord);
            } else {
              throw new Error(`Found an existing hash app ${serviceHelper.ensureString(result)}`);
            }
          } catch (error) {
            log.error(`Hash ${message} already exists. Not adding at height ${blockDataVerbose.height}`);
            log.error(error);
          }
        }
      }
      // check for softForks
      const isSoftFork = isSenderFoundation && isReceiverFounation && message;
      if (isSoftFork) {
        try {
          await processSoftFork(tx.txid, blockDataVerbose.height, message);
        } catch (error) {
          log.error('Error processing soft fork message:', error);
          // Continue processing other transactions even if soft fork processing fails
        }
      }
    }
  }));
}

/**
 * To process block data for entry to Insight database.
 * @param {number} blockHeight Block height.
 * @param {boolean} isInsightExplorer True if node is insight explorer based.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function processBlock(blockHeight, isInsightExplorer) {
  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      setTimeout(() => {
        processBlock(blockHeight, isInsightExplorer);
      }, 2 * 60 * 1000);
      return;
    }
    someBlockIsProcessing = true;
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);
    // get Block information
    const verbosity = 2;
    const blockDataVerbose = await getVerboseBlock(blockHeight, verbosity);
    if (blockDataVerbose.height % 50 === 0) {
      log.info(`Processing Explorer Block Height: ${blockDataVerbose.height}`);
    }
    if (isInsightExplorer && blockDataVerbose.height > 699420 && blockDataVerbose.height < 862002) {
      // speed up sync as there were no app messages between these two blocks
      processBlock(862002, isInsightExplorer);
      return;
    }
    if (isInsightExplorer) {
      // only process Flux transactions
      await processInsight(blockDataVerbose, database);
    } else {
      await processStandard(blockDataVerbose, database);
    }
    // After block 2020000, chain runs 4x faster, so multiply periods by 4
    const speedMultiplier = blockHeight >= 2020000 ? 4 : 1;
    if (blockHeight % (config.fluxapps.expireFluxAppsPeriod * speedMultiplier) === 0) {
      if (!isInsightExplorer) {
        const result = await dbHelper.collectionStats(database, utxoIndexCollection);
        const resultB = await dbHelper.collectionStats(database, addressTransactionIndexCollection);
        const resultFusion = await dbHelper.collectionStats(database, coinbaseFusionIndexCollection);
        log.info(`UTXO documents: ${result.size}, ${result.count}, ${result.avgObjSize}`);
        log.info(`ADDR documents: ${resultB.size}, ${resultB.count}, ${resultB.avgObjSize}`);
        log.info(`Fusion documents: ${resultFusion.size}, ${resultFusion.count}, ${resultFusion.avgObjSize}`);
      }
    }

    const scannedHeight = blockDataVerbose.height;
    // update scanned Height in scannedBlockHeightCollection
    const query = { generalScannedHeight: { $gte: 0 } };
    const update = { $set: { generalScannedHeight: scannedHeight } };
    const options = {
      upsert: true,
    };
    // this should run only when node is synced
    isSynced = !(blockDataVerbose.confirmations >= 2);
    if (isSynced) {
      blockEmitter.emit('blockReceived', scannedHeight);
      // updateFluxAppsPeriod can be between every 4 to 9 blocks
      const updateFluxAppsPeriod = Math.floor(Math.random() * 6 + 4);

      if (blockHeight % (2 * speedMultiplier) === 0) {
        if (blockDataVerbose.height >= config.fluxapps.epochstart) {
          await appsService.expireGlobalApplications();
        }
      }
      if (blockHeight % (config.fluxapps.removeFluxAppsPeriod * speedMultiplier) === 0) {
        if (blockDataVerbose.height >= config.fluxapps.epochstart) {
          appsService.checkAndRemoveApplicationInstance();
        }
      }
      if (blockHeight % (updateFluxAppsPeriod * speedMultiplier) === 0) {
        if (blockDataVerbose.height >= config.fluxapps.epochstart) {
          appsService.reinstallOldApplications();
        }
      }
      if (blockDataVerbose.height % (config.fluxapps.reconstructAppMessagesHashPeriod * speedMultiplier) === 0) {
        try {
          appsService.reconstructAppMessagesHashCollection();
          log.info('Validation of App Messages Hash Collection');
        } catch (error) {
          log.error(error);
        }
      }
      if (blockDataVerbose.height % (config.fluxapps.benchUpnpPeriod * speedMultiplier) === 0) {
        try {
          // every node behind the same ip will benchmark at the same time. I.e.
          // we spread the network out (grouped by ip) over 4 hours so we don't
          // absolutely hammer the speedtest servers at the same time.
          const maxBenchDelay = 4 * 3_600_000;
          const socketAddress = await fluxNetworkhelper.getMyFluxIPandPort();

          // socketAddress can be null. If it is, we just use an empty string. This
          // has the effect of creating an initializer of just the block number. If
          // this happens, every node on the network that uses the block number will
          // run the bench at the same time. However this is an extreme edge case, as
          // all nodes should just return the ip.
          const ip = socketAddress ? socketAddress.split(':')[0] : '';
          // This is: string + number = string
          const initializer = ip + blockDataVerbose.height;
          const benchDelayMs = serviceHelper.randomDelayMs(maxBenchDelay, { initializer });
          const benchDelayS = Math.round((benchDelayMs / 1000) * 100) / 100;

          log.info(`Random seed: ${initializer}. Starting multiport bench in: ${benchDelayS}s`);

          setTimeout(benchmarkService.executeUpnpBench, benchDelayMs);
        } catch (error) {
          log.error(error);
        }
      }
      await insertAndRequestAppHashes(appsTransactions, database, true);
      await dbHelper.updateOneInDatabase(database, scannedHeightCollection, query, update, options);
    } else if (blockDataVerbose.height % 500 === 0) {
      log.info(`Processing Explorer Number of Transactions: ${appsTransactions.length}.`);
      await appsService.expireGlobalApplications(); // in case node was shutdown for a while and it is started
      await insertTransactions(appsTransactions, database);
      await dbHelper.updateOneInDatabase(database, scannedHeightCollection, query, update, options);
    }
    someBlockIsProcessing = false;
    if (blockProccessingCanContinue) {
      if (blockDataVerbose.confirmations > 1) {
        processBlock(blockDataVerbose.height + 1, isInsightExplorer);
      } else {
        const daemonBlockCount = await daemonServiceBlockchainRpcs.getBlockCount();
        if (daemonBlockCount.status !== 'success') {
          throw new Error(daemonBlockCount.data.message || daemonBlockCount.data);
        }
        const daemonHeight = daemonBlockCount.data;
        if (daemonHeight > blockDataVerbose.height) {
          processBlock(blockDataVerbose.height + 1, isInsightExplorer);
        } else {
          // eslint-disable-next-line no-use-before-define
          initiateBlockProcessor(false, false);
        }
      }
    }
  } catch (error) {
    someBlockIsProcessing = false;
    log.error('Block processor encountered an error.');
    log.error(error);
    if (blockProccessingCanContinue) {
      if (error.message && error.message.includes('duplicate key')) {
        // do a deep rescan
        // eslint-disable-next-line no-use-before-define
        initiateBlockProcessor(true, true);
      } else {
        // eslint-disable-next-line no-use-before-define
        initiateBlockProcessor(true, false);
      }
    }
  }
}

/**
 * To restore database to specified block height.
 * @param {number} height Block height.
 * @param {boolean} rescanGlobalApps Value set to false on function call.
 * @returns {boolean} Value set to true after database is restored.
 */
async function restoreDatabaseToBlockheightState(height, rescanGlobalApps = false) {
  if (!height) {
    throw new Error('No blockheight for restoring provided');
  }
  const dbopen = dbHelper.databaseConnection();
  const database = dbopen.db(config.database.daemon.database);

  const query = { height: { $gt: height } };
  const queryForAddresses = {}; // we need to remove those transactions in transactions field that have height greater than height
  const queryForAddressesDeletion = { transactions: { $exists: true, $size: 0 } };
  const projection = { $pull: { transactions: { height: { $gt: height } } } };

  // restore utxoDatabase collection
  await dbHelper.removeDocumentsFromCollection(database, utxoIndexCollection, query);
  // restore coinbaseDatabase collection
  await dbHelper.removeDocumentsFromCollection(database, coinbaseFusionIndexCollection, query);
  // restore addressTransactionIndex collection
  // remove transactions with height bigger than our scanned height
  await dbHelper.updateInDatabase(database, addressTransactionIndexCollection, queryForAddresses, projection);
  // remove addresses with 0 transactions
  await dbHelper.removeDocumentsFromCollection(database, addressTransactionIndexCollection, queryForAddressesDeletion);
  // restore appsHashes collection
  await dbHelper.removeDocumentsFromCollection(database, appsHashesCollection, query);
  log.info('Rescanning Blockchain Parameters!');
  const databaseGlobal = dbopen.db(config.database.appsglobal.database);
  const databaseUpdates = dbopen.db(config.database.chainparams.database);
  await dbHelper.removeDocumentsFromCollection(databaseUpdates, chainParamsMessagesCollection, query);
  if (rescanGlobalApps === true) {
    log.info('Rescanning Apps!');
    await dbHelper.removeDocumentsFromCollection(databaseGlobal, config.database.appsglobal.collections.appsMessages, query);
    await dbHelper.removeDocumentsFromCollection(databaseGlobal, config.database.appsglobal.collections.appsInformation, query);
  }
  log.info('Rescan completed');
  return true;
}

let lastchainTipCheck = 0;
/**
 * To start the block processor.
 * @param {boolean} restoreDatabase True if database is to be restored.
 * @param {boolean} deepRestore True if a deep restore is required.
 * @param {boolean} reindexOrRescanGlobalApps True if apps collections are to be reindexed.
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
// do a deepRestore of 100 blocks if daemon if enouncters an error (mostly flux daemon was down) or if its initial start of flux
// use reindexGlobalApps with caution!!!
async function initiateBlockProcessor(restoreDatabase, deepRestore, reindexOrRescanGlobalApps) {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    let scannedBlockHeight = 0;
    const currentHeight = await dbHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (currentHeight && currentHeight.generalScannedHeight) {
      scannedBlockHeight = currentHeight.generalScannedHeight;
    }
    // fix for a node if they have corrupted global app list
    if (scannedBlockHeight >= config.fluxapps.epochstart) {
      const globalAppsSpecs = await appsService.getAllGlobalApplications(['height']); // already sorted from oldest lowest height to newest highest height

      if (globalAppsSpecs.length >= 2) {
        const defaultExpire = config.fluxapps.blocksLasting;
        const minBlockheightDifference = defaultExpire * 0.9; // it is highly unlikely that there was no app registration or an update for default of 2200 blocks ~3days
        const oldestAppHeight = globalAppsSpecs[0].height;
        const youngestAppHeight = globalAppsSpecs.pop().height;
        const blockDifference = youngestAppHeight - oldestAppHeight;

        if (blockDifference < minBlockheightDifference) {
          await appsService.reindexGlobalAppsInformation();
        }
      }
    }
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      setTimeout(() => {
        initiateBlockProcessor(restoreDatabase, deepRestore, reindexOrRescanGlobalApps);
      }, 2 * 60 * 1000);
      return;
    }
    if (isInInitiationOfBP) {
      return;
    }
    isInInitiationOfBP = true;
    const daemonBlockCount = await daemonServiceBlockchainRpcs.getBlockCount();
    if (daemonBlockCount.status !== 'success') {
      throw new Error(daemonBlockCount.data.message || daemonBlockCount.data);
    }
    const daemonHeight = daemonBlockCount.data;
    // get scanned height from our database;
    // get height from blockchain?
    if (scannedBlockHeight === 0) {
      log.info('Preparing daemon collections');
      const result = await dbHelper.dropCollection(database, utxoIndexCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      const resultB = await dbHelper.dropCollection(database, addressTransactionIndexCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      const resultD = await dbHelper.dropCollection(database, appsHashesCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      const resultFusion = await dbHelper.dropCollection(database, coinbaseFusionIndexCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      const databaseUpdates = db.db(config.database.chainparams.database);
      const resultChainParams = await dbHelper.dropCollection(databaseUpdates, chainParamsMessagesCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      log.info(result, resultB, resultD, resultFusion, resultChainParams);

      await database.collection(utxoIndexCollection).createIndex({ txid: 1, vout: 1 }, { name: 'query for getting utxo', unique: true });
      await database.collection(utxoIndexCollection).createIndex({ txid: 1, vout: 1, satoshis: 1 }, { name: 'query for getting utxo for zelnode tx', unique: true });
      await database.collection(utxoIndexCollection).createIndex({ address: 1 }, { name: 'query for addresses utxo' });
      await database.collection(utxoIndexCollection).createIndex({ scriptPubKey: 1 }, { name: 'query for scriptPubKey utxo' });
      await database.collection(coinbaseFusionIndexCollection).createIndex({ txid: 1, vout: 1 }, { name: 'query for getting coinbase fusion utxo', unique: true });
      await database.collection(coinbaseFusionIndexCollection).createIndex({ txid: 1, vout: 1, satoshis: 1 }, { name: 'query for getting coinbase fusion utxo for zelnode tx', unique: true });
      await database.collection(coinbaseFusionIndexCollection).createIndex({ address: 1 }, { name: 'query for addresses coinbase fusion utxo' });
      await database.collection(coinbaseFusionIndexCollection).createIndex({ scriptPubKey: 1 }, { name: 'query for scriptPubKey coinbase fusion utxo' });
      await database.collection(addressTransactionIndexCollection).createIndex({ address: 1 }, { name: 'query for addresses transactions' });
      await database.collection(addressTransactionIndexCollection).createIndex({ address: 1, count: 1 }, { name: 'query for addresses transactions with count' });
      await database.collection(appsHashesCollection).createIndex({ txid: 1 }, { name: 'query for getting txid' });
      await database.collection(appsHashesCollection).createIndex({ height: 1 }, { name: 'query for getting height' });
      await database.collection(appsHashesCollection).createIndex({ hash: 1 }, { name: 'query for getting app hash', unique: true }).catch((error) => {
        // 5501c7dd6516c3fc2e68dee8d4fdd20d92f57f8cfcdc7b4fcbad46499e43ed6f
        log.error('Expected throw on index creation as of new uniquness. Do not remove this check until all nodes have rebuild apps data');
        log.error(error);
      }); // has to be unique!
      await database.collection(appsHashesCollection).createIndex({ message: 1 }, { name: 'query for getting app hashes depending if we have message' });
      await databaseUpdates.collection(chainParamsMessagesCollection).createIndex({ txid: 1 }, { name: 'query for getting txid of some chain parameters update message' });
      await databaseUpdates.collection(chainParamsMessagesCollection).createIndex({ height: 1 }, { name: 'query for getting height of some chain parameters update message' });
      await databaseUpdates.collection(chainParamsMessagesCollection).createIndex({ message: 1 }, { name: 'query for getting message of some chain parameters update message' });
      await databaseUpdates.collection(chainParamsMessagesCollection).createIndex({ version: 1 }, { name: 'query for getting version of some chain parameters update message' });

      const databaseGlobal = db.db(config.database.appsglobal.database);
      log.info('Preparing apps collections');
      if (reindexOrRescanGlobalApps === true) {
        const resultE = await dbHelper.dropCollection(databaseGlobal, config.database.appsglobal.collections.appsMessages).catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
        const resultF = await dbHelper.dropCollection(databaseGlobal, config.database.appsglobal.collections.appsInformation).catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
        const resultG = await dbHelper.dropCollection(databaseGlobal, config.database.appsglobal.collections.appsLocations).catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
        const resultH = await dbHelper.dropCollection(databaseGlobal, config.database.appsglobal.collections.appsInstallingLocations).catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
        const resultI = await dbHelper.dropCollection(databaseGlobal, config.database.appsglobal.collections.appsInstallingErrorsLocations).catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
        log.info(resultE, resultF, resultG, resultH, resultI);
      }
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ hash: 1 }, { name: 'query for getting zelapp message based on hash', unique: true });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ txid: 1 }, { name: 'query for getting zelapp message based on txid' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ height: 1 }, { name: 'query for getting zelapp message based on height' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'zelAppSpecifications.name': 1 }, { name: 'query for getting zelapp message based on zelapp specs name' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'zelAppSpecifications.owner': 1 }, { name: 'query for getting zelapp message based on zelapp specs owner' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'zelAppSpecifications.repotag': 1 }, { name: 'query for getting zelapp message based on image' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.name': 1 }, { name: 'query for getting app message based on zelapp specs name' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.owner': 1 }, { name: 'query for getting app message based on zelapp specs owner' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.repotag': 1 }, { name: 'query for getting app message based on image' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.version': 1 }, { name: 'query for getting app message based on version' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.nodes': 1 }, { name: 'query for getting app message based on nodes' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ name: 1 }, { name: 'query for getting zelapp based on zelapp specs name' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ owner: 1 }, { name: 'query for getting zelapp based on zelapp specs owner' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ repotag: 1 }, { name: 'query for getting zelapp based on image' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ height: 1 }, { name: 'query for getting zelapp based on last height update' }); // we need to know the height of app adjustment
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ hash: 1 }, { name: 'query for getting zelapp based on last hash' }); // todo evaluate unique: true // we need to know the hash of the last message update which is the true identifier
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ name: 1 }, { name: 'query for getting zelapp location based on zelapp specs name' });
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ hash: 1 }, { name: 'query for getting zelapp location based on zelapp hash' });
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ ip: 1 }, { name: 'query for getting zelapp location based on ip' });
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ name: 1, ip: 1 }, { name: 'query for getting app based on ip and name' });
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ name: 1, ip: 1, broadcastedAt: 1 }, { name: 'query for getting app to ensure we possess a message' });
      await database.collection(config.database.appsglobal.collections.appsInstallingLocations).createIndex({ name: 1 }, { name: 'query for getting zelapp install location based on zelapp specs name' });
      await database.collection(config.database.appsglobal.collections.appsInstallingLocations).createIndex({ name: 1, ip: 1 }, { name: 'query for getting flux app install location based on specs name and node ip' });
      await database.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).createIndex({ name: 1 }, { name: 'query for getting flux app install errors location based on specs name' });
      await database.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).createIndex({ name: 1, hash: 1 }, { name: 'query for getting flux app install errors location based on specs name and hash' });
      await database.collection(config.database.appsglobal.collections.appsInstallingErrorsLocations).createIndex({ name: 1, hash: 1, ip: 1 }, { name: 'query for getting flux app install errors location based on specs name and hash and node ip' });
      // what if 2 app adjustment come in the same block?
      // log.info(resultE, resultF);
      log.info('Preparation done');
    }
    if (daemonHeight > scannedBlockHeight) {
      if (scannedBlockHeight !== 0 && restoreDatabase === true) {
        try {
          // adjust for initial reorg
          if (deepRestore === true) {
            log.info('Deep restoring of database...');
            scannedBlockHeight = Math.max(scannedBlockHeight - 100, 0);
            await restoreDatabaseToBlockheightState(scannedBlockHeight, reindexOrRescanGlobalApps);
            const queryHeight = { generalScannedHeight: { $gte: 0 } };
            const update = { $set: { generalScannedHeight: scannedBlockHeight } };
            const options = {
              upsert: true,
            };
            await dbHelper.updateOneInDatabase(database, scannedHeightCollection, queryHeight, update, options);
            log.info('Database restored OK');
          } else {
            log.info('Restoring database...');
            await restoreDatabaseToBlockheightState(scannedBlockHeight, reindexOrRescanGlobalApps);
            log.info('Database restored OK');
          }
        } catch (e) {
          log.error('Error restoring database!');
          throw e;
        }
      }
      isInInitiationOfBP = false;
      const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();

      if (isInsightExplorer) {
        // if node is insight explorer based, we are only processing flux app messages
        if (scannedBlockHeight < config.fluxapps.epochstart - 1) {
          scannedBlockHeight = config.fluxapps.epochstart - 1;
        }
      }
      processBlock(scannedBlockHeight + 1, isInsightExplorer);
    } else if (scannedBlockHeight >= config.daemon.chainValidHeight && lastchainTipCheck !== 0 && lastchainTipCheck + 100 < scannedBlockHeight) {
      log.info(`Explorer - Checking for chain reorganisations - lastchainTipCheck: ${lastchainTipCheck} scannedBlockHeight: ${scannedBlockHeight}`);

      // Check daemon version and conditionally pass parameter to getChainTips
      const daemonVersion = await getDaemonVersion();
      let daemonGetChainTips;

      if (daemonVersion > 7020050) {
        // For newer daemon versions, pass the minheight parameter
        const req = {
          params: {
            minheight: lastchainTipCheck + 1,
          },
        };
        daemonGetChainTips = await daemonServiceBlockchainRpcs.getChainTips(req);
      } else {
        // For older versions, call without parameters
        daemonGetChainTips = await daemonServiceBlockchainRpcs.getChainTips();
      }

      if (daemonGetChainTips.status !== 'success') {
        throw new Error(daemonGetChainTips.data.message || daemonGetChainTips.data);
      }

      const reorganisations = daemonGetChainTips.data;
      let reorgs = reorganisations.filter((reorg) => reorg.status === 'valid-fork' && reorg.height >= lastchainTipCheck + 1);
      let rescanDepth = 0;
      if (reorgs.length > 1) {
        reorgs = reorgs.sort((a, b) => a.height - b.height);
      }

      let reorgBlockHeight;
      let finished = false;
      let index = 0;
      // if more valid forks on the same height. Restore from the longest one
      while (!finished && index < reorgs.length) {
        const reorg = reorgs[index];
        if (!reorgBlockHeight || (reorg.height === reorgBlockHeight && reorg.branchlen > rescanDepth)) {
          rescanDepth = reorg.branchlen;
          reorgBlockHeight = reorg.height;
        } else {
          finished = true;
        }
        index += 1;
      }
      if (rescanDepth > 0) {
        try {
          // restore rescanDepth + 2 more blocks back
          rescanDepth += 2;
          log.warn(`Potential chain reorganisation spotted at height ${reorgBlockHeight}. Rescanning last ${rescanDepth} blocks...`);
          const blockToRescan = Math.max(reorgBlockHeight - rescanDepth, 0);
          // eslint-disable-next-line no-use-before-define
          await restoreDatabaseToBlockheightState(blockToRescan, reindexOrRescanGlobalApps);
          const queryHeight = { generalScannedHeight: { $gte: 0 } };
          const updateAux = { $set: { generalScannedHeight: blockToRescan } };
          const optionsAux = {
            upsert: true,
          };
          await dbHelper.updateOneInDatabase(database, scannedHeightCollection, queryHeight, updateAux, optionsAux);
          log.info('Database restored OK');
        } catch (e) {
          log.error('Error restoring database!');
          throw e;
        }
      }
      isInInitiationOfBP = false;
      lastchainTipCheck = scannedBlockHeight;
      initBPfromNoBlockTimeout = setTimeout(() => {
        // eslint-disable-next-line no-use-before-define
        initiateBlockProcessor(false, false);
      }, 5 * 1000);
    } else {
      if (lastchainTipCheck === 0) {
        lastchainTipCheck = scannedBlockHeight - 1;
      }
      isInInitiationOfBP = false;
      initBPfromNoBlockTimeout = setTimeout(() => {
        initiateBlockProcessor(false, false);
      }, 5 * 1000);
    }
  } catch (error) {
    log.error(error);
    isInInitiationOfBP = false;
    initBPfromErrorTimeout = setTimeout(() => {
      initiateBlockProcessor(true, true);
    }, 15 * 60 * 1000);
  }
}

/**
 * To get all UTXOs (unspent transaction outputs).
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAllUtxos(req, res) {
  try {
    const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();
    if (isInsightExplorer) {
      throw new Error('Data unavailable. Deprecated');
    }
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        vout: 1,
        height: 1,
        address: 1,
        satoshis: 1,
        scriptPubKey: 1,
        coinbase: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, utxoIndexCollection, query, projection);
    const resMessage = messageHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get all Fusion/Coinbase transactions.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAllFusionCoinbase(req, res) {
  try {
    const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();
    if (isInsightExplorer) {
      throw new Error('Data unavailable. Deprecated');
    }
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        vout: 1,
        height: 1,
        address: 1,
        satoshis: 1,
        scriptPubKey: 1,
        coinbase: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, coinbaseFusionIndexCollection, query, projection);
    const resMessage = messageHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get all addresses with transactions.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAllAddressesWithTransactions(req, res) {
  try {
    // FIXME outputs all documents in the collection. We shall group same addresses. But this call is disabled and for testing purposes anyway
    const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();
    if (isInsightExplorer) {
      throw new Error('Data unavailable. Deprecated');
    }
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        transactions: 1,
        address: 1,
        count: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, addressTransactionIndexCollection, query, projection);
    const resMessage = messageHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

/**
 * To get all addresses.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getAllAddresses(req, res) {
  try {
    // FIXME outputs all documents in the collection. We shall group same addresses. But this call is disabled and for testing purposes anyway
    const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();
    if (isInsightExplorer) {
      throw new Error('Data unavailable. Deprecated');
    }
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const variable = 'address';
    const results = await dbHelper.distinctDatabase(database, addressTransactionIndexCollection, variable);
    const resMessage = messageHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
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
    const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();
    if (isInsightExplorer) {
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
    } else {
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { address };
      const projection = {
        projection: {
          _id: 0,
          txid: 1,
          vout: 1,
          height: 1,
          address: 1,
          satoshis: 1,
          scriptPubKey: 1,
          coinbase: 1, // HERE DIFFERS
        },
      };
      const results = await dbHelper.findInDatabase(database, utxoIndexCollection, query, projection);
      const resMessage = messageHelper.createDataMessage(results);
      res.json(resMessage);
    }
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
  try {
    const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();
    if (isInsightExplorer) {
      throw new Error('Data unavailable. Deprecated');
    }
    let { address } = req?.params || {}; // we accept both help/command and help?command=getinfo
    address = address || req?.query?.address;
    if (!address) {
      throw new Error('No address provided');
    }
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { address };
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        vout: 1,
        height: 1,
        address: 1,
        satoshis: 1,
        scriptPubKey: 1,
        coinbase: 1,
      },
    };
    const results = await dbHelper.findInDatabase(database, coinbaseFusionIndexCollection, query, projection);
    const resMessage = messageHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
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
    const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();
    if (isInsightExplorer) {
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
    } else {
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { address };
      const distinct = 'transactions';
      const results = await dbHelper.distinctDatabase(database, addressTransactionIndexCollection, distinct, query);
      // sort by height, newest first
      // only return txids
      results.sort((a, b) => {
        if (a.height > b.height) return -1;
        if (a.height < b.height) return 1;
        return 0;
      });
      // eslint-disable-next-line no-param-reassign
      results.map((tx) => delete tx.height);
      // TODO FIX documentation.
      // now we have array of transactions txids only sorted from newest to latest [{txid}, {}...]
      const resMessage = messageHelper.createDataMessage(results);
      res.json(resMessage);
    }
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
 * To check if block processing has stopped.
 * @param {number} i Value.
 * @param {callback} callback Callback function.
 */
async function checkBlockProcessingStopped(i, callback) {
  blockProccessingCanContinue = false;
  clearTimeout(initBPfromErrorTimeout);
  clearTimeout(initBPfromNoBlockTimeout);
  if (someBlockIsProcessing === false && isInInitiationOfBP === false) {
    const succMessage = messageHelper.createSuccessMessage('Block processing is stopped');
    blockProccessingCanContinue = true;
    callback(succMessage);
  } else {
    setTimeout(() => {
      const j = i + 1;
      if (j < 12) {
        checkBlockProcessingStopped(j, callback);
      } else {
        const errMessage = messageHelper.createErrorMessage('Unknown error occured. Try again later.');
        callback(errMessage);
      }
    }, 1000);
  }
}

/**
 * To stop block processing. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function stopBlockProcessing(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const i = 0;
    checkBlockProcessingStopped(i, async (response) => {
      // put blockProccessingCanContinue status to true.
      res.json(response);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

/**
 * To restart block processing. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function restartBlockProcessing(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const i = 0;
    checkBlockProcessingStopped(i, async () => {
      initiateBlockProcessor(true, false);
      const message = messageHelper.createSuccessMessage('Block processing initiated');
      res.json(message);
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

/**
 * To reindex Flux explorer database. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function reindexExplorer(req, res) {
  const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    // stop block processing
    const i = 0;
    let { reindexapps } = req?.params || {};
    reindexapps = reindexapps ?? req?.query?.rescanapps ?? false;
    reindexapps = serviceHelper.ensureBoolean(reindexapps);
    checkBlockProcessingStopped(i, async (response) => {
      if (response.status === 'error') {
        res.json(response);
      } else if (operationBlocked) {
        const errMessage = messageHelper.createErrorMessage('Operation blocked');
        res.json(errMessage);
      } else {
        operationBlocked = true;
        const dbopen = dbHelper.databaseConnection();
        const database = dbopen.db(config.database.daemon.database);
        const resultOfDropping = await dbHelper.dropCollection(database, scannedHeightCollection).catch((error) => {
          if (error.message !== 'ns not found') {
            operationBlocked = false;
            log.error(error);
            const errMessage = messageHelper.createErrorMessage(error.message, error.name, error.code);
            res.json(errMessage);
          }
        });
        operationBlocked = false;
        if (resultOfDropping === true || resultOfDropping === undefined) {
          initiateBlockProcessor(true, false, reindexapps); // restore database and possibly do reindex of apps
          const message = messageHelper.createSuccessMessage('Explorer database reindex initiated');
          res.json(message);
        } else {
          const errMessage = messageHelper.createErrorMessage(resultOfDropping, 'Collection dropping error');
          res.json(errMessage);
        }
      }
    });
  } else {
    const errMessage = messageHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function fixExplorer(height = 1670000, rescanApps = true) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const blockheight = serviceHelper.ensureNumber(height);
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
    const rescanapps = serviceHelper.ensureBoolean(rescanApps);
    if (blockheight === 0) {
      await dbHelper.dropCollection(database, scannedHeightCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          log.error(error);
        }
      });
    } else {
      // stop block processing
      const update = { $set: { generalScannedHeight: blockheight } };
      const options = {
        upsert: true,
      };
      // update scanned Height in scannedBlockHeightCollection
      await dbHelper.updateOneInDatabase(database, scannedHeightCollection, query, update, options);
    }
    initiateBlockProcessor(true, false, rescanapps); // restore database and possibly do rescan of apps
    const message = messageHelper.createSuccessMessage(`Explorer rescan from blockheight ${blockheight} initiated`);
    log.info(message);
  } catch (error) {
    log.warn(error);
    initiateBlockProcessor(true, true);
  }
}

/**
 * To rescan Flux explorer database from a specific block height. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function rescanExplorer(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      // since what blockheight
      let { blockheight } = req?.params || {}; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req?.query?.blockheight;
      if (!blockheight) {
        const errMessage = messageHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
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
      let { rescanapps } = req?.params || {};
      rescanapps = rescanapps ?? req?.query?.rescanapps ?? false;
      rescanapps = serviceHelper.ensureBoolean(rescanapps);
      // stop block processing
      const i = 0;
      checkBlockProcessingStopped(i, async (response) => {
        if (response.status === 'error') {
          res.json(response);
        } else {
          if (operationBlocked) {
            throw new Error('Operation blocked');
          }
          operationBlocked = true;
          const update = { $set: { generalScannedHeight: blockheight } };
          const options = {
            upsert: true,
          };
          // update scanned Height in scannedBlockHeightCollection
          await dbHelper.updateOneInDatabase(database, scannedHeightCollection, query, update, options);
          operationBlocked = false;
          initiateBlockProcessor(true, false, rescanapps); // restore database and possibly do rescan of apps
          const message = messageHelper.createSuccessMessage(`Explorer rescan from blockheight ${blockheight} initiated`);
          res.json(message);
        }
      });
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
    const isInsightExplorer = daemonServiceMiscRpcs.isInsightExplorer();
    if (isInsightExplorer) {
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
    } else {
      const dbopen = dbHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { address };
      const projection = {
        projection: {
          _id: 0,
          // txid: 1,
          // vout: 1,
          // height: 1,
          // address: 1,
          satoshis: 1,
          // scriptPubKey: 1,
          // coinbase: 1,
        },
      };
      const results = await dbHelper.findInDatabase(database, utxoIndexCollection, query, projection);
      let balance = 0;
      results.forEach((utxo) => {
        balance += utxo.satoshis;
      });
      const resMessage = messageHelper.createDataMessage(balance);
      res.json(resMessage);
    }
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

// testing purposes
function setBlockProccessingCanContinue(value) {
  blockProccessingCanContinue = value;
}

// testing purposes
function setIsInInitiationOfBP(value) {
  isInInitiationOfBP = value;
}

module.exports = {
  initiateBlockProcessor,
  processBlock,
  reindexExplorer,
  rescanExplorer,
  stopBlockProcessing,
  restartBlockProcessing,
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

  // exports for testing puproses
  getSenderTransactionFromDaemon,
  getSender,
  processBlockTransactions,
  getVerboseBlock,
  decodeMessage,
  processInsight,
  processTransaction,
  processStandard,
  setBlockProccessingCanContinue,
  setIsInInitiationOfBP,
  restoreDatabaseToBlockheightState,

  // temporary function
  fixExplorer,
  isExplorerSynced,
};
