const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const daemonService = require('./daemonService');
const appsService = require('./appsService');

const coinbaseFusionIndexCollection = config.database.daemon.collections.coinbaseFusionIndex; // fusion
const utxoIndexCollection = config.database.daemon.collections.utxoIndex;
const appsHashesCollection = config.database.daemon.collections.appsHashes;
const addressTransactionIndexCollection = config.database.daemon.collections.addressTransactionIndex;
const scannedHeightCollection = config.database.daemon.collections.scannedHeight;
const fluxTransactionCollection = config.database.daemon.collections.fluxTransactions;
let blockProccessingCanContinue = true;
let someBlockIsProcessing = false;
let isInInitiationOfBP = false;
let operationBlocked = false;
let initBPfromNoBlockTimeout;
let initBPfromErrorTimeout;

async function getSenderTransactionFromDaemon(txid) {
  const verbose = 1;
  const req = {
    params: {
      txid,
      verbose,
    },
  };

  const txContent = await daemonService.getRawTransaction(req);
  if (txContent.status === 'success') {
    const sender = txContent.data;
    return sender;
  }
  throw txContent.data;
}

async function getSenderForFluxTx(txid, vout) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.daemon.database);
  const query = {
    $and: [
      { txid: new RegExp(`^${txid}`) },
      { vout },
      {
        $or: [
          { satoshis: 1000000000000 },
          { satoshis: 2500000000000 },
          { satoshis: 10000000000000 },
        ],
      }],
  };
  // we do not need other data as we are just asking what the sender address is.
  const projection = {
    projection: {
      _id: 0,
      txid: 1,
      // vout: 1,
      // height: 1,
      address: 1,
      satoshis: 1,
      // scriptPubKey: 1,
      // coinbase: 1,
    },
  };

  // find the utxo from global utxo list
  let txContent = await serviceHelper.findOneInDatabase(database, utxoIndexCollection, query, projection);
  if (!txContent) {
    log.info(`Transaction ${txid} ${vout} not found in database. Falling back to previous Flux transaction`);
    const queryFluxTx = {
      $and: [
        { collateralHash: new RegExp(`^${txid}`) },
        { collateralIndex: vout },
        {
          $or: [
            { lockedAmount: 1000000000000 },
            { lockedAmount: 2500000000000 },
            { lockedAmount: 10000000000000 },
          ],
        }],
    };
    // we do not need other data as we are just asking what the sender address is.
    const projectionFluxTx = {
      projection: {
        _id: 0,
        collateralHash: 1,
        zelAddress: 1,
        lockedAmount: 1,
      },
    };
    // find previous flux transaction that
    txContent = await serviceHelper.findOneInDatabase(database, fluxTransactionCollection, queryFluxTx, projectionFluxTx);
  }
  if (!txContent) {
    log.warn(`Transaction ${txid} ${vout} was not found anywhere. Uncomplete tx!`);
    const adjustedTxContent = {
      txid: undefined,
      address: undefined,
      satoshis: undefined,
    };
    return adjustedTxContent;
  }
  const sender = txContent;
  return sender;
}

async function getSender(txid, vout) {
  const db = serviceHelper.databaseConnection();
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
  const txContent = await serviceHelper.findOneAndDeleteInDatabase(database, utxoIndexCollection, query, projection);
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

async function processTransaction(txContent, height) {
  const db = serviceHelper.databaseConnection();
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
        await serviceHelper.insertOneToDatabase(database, utxoIndexCollection, utxoDetail);
        // track coinbase txs for additional rewards on paralel chains for fusion
        if (coinbase && height > 825000) { // 825000 is snapshot, 825001 is first block eligible for rewards on other chains
          await serviceHelper.insertOneToDatabase(database, coinbaseFusionIndexCollection, utxoDetail);
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

async function processBlockTransactions(txs, height) {
  const transactions = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const transaction of txs) {
    // eslint-disable-next-line no-await-in-loop
    const txContent = await processTransaction(transaction, height);
    transactions.push(txContent);
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(50); // delay of 50ms to not kill mongodb
  }
  return transactions;
}

async function getVerboseBlock(heightOrHash) {
  const verbosity = 2;
  const req = {
    params: {
      hashheight: heightOrHash,
      verbosity,
    },
  };
  const blockInfo = await daemonService.getBlock(req);
  if (blockInfo.status === 'success') {
    return blockInfo.data;
  }
  throw blockInfo.data;
}

function decodeMessage(asm) {
  const parts = asm.split('OP_RETURN ', 2);
  let message = '';
  if (parts[1]) {
    const encodedMessage = parts[1];
    const hexx = encodedMessage.toString(); // force conversion
    for (let k = 0; k < hexx.length && hexx.substr(k, 2) !== '00'; k += 2) {
      message += String.fromCharCode(
        parseInt(hexx.substr(k, 2), 16),
      );
    }
  }
  return message;
}

async function processBlock(blockHeight) {
  try {
    const syncStatus = await daemonService.isDaemonSynced();
    if (!syncStatus.data.synced) {
      setTimeout(() => {
        processBlock(blockHeight);
      }, 2 * 60 * 1000);
      return;
    }
    someBlockIsProcessing = true;
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);
    // get Block information
    const blockDataVerbose = await getVerboseBlock(blockHeight);
    if (blockDataVerbose.height % 50 === 0) {
      console.log(blockDataVerbose.height);
    }
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

        const addresses = [];
        tx.senders.forEach((sender) => {
          addresses.push(sender.address);
        });
        tx.vout.forEach((receiver) => {
          if (receiver.scriptPubKey.addresses) { // count for messages
            addresses.push(receiver.scriptPubKey.addresses[0]);
            if (receiver.scriptPubKey.addresses[0] === config.fluxapps.address) {
              // it is an app message. Get Satoshi amount
              isFluxAppMessageValue += receiver.valueSat;
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
          await serviceHelper.updateOneInDatabase(database, addressTransactionIndexCollection, query, update, options);
        }));
        // MAY contain App transaction. Store it.
        if (isFluxAppMessageValue >= 1e8 && message.length === 64 && blockDataVerbose.height >= config.fluxapps.epochstart) { // min of 1 flux had to be paid for us bothering checking
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
            const result = await serviceHelper.findOneInDatabase(database, appsHashesCollection, querySearch, projectionSearch); // this search can be later removed if nodes rescan apps and reconstruct the index for unique
            if (!result) {
              await serviceHelper.insertOneToDatabase(database, appsHashesCollection, appTxRecord);
              appsService.checkAndRequestApp(message, tx.txid, blockDataVerbose.height, isFluxAppMessageValue);
            } else {
              throw new Error(`Found an existing hash app ${serviceHelper.ensureString(result)}`);
            }
          } catch (error) {
            log.error(`Hash ${message} already exists. Not adding at height ${blockDataVerbose.height}`);
            log.error(error);
          }
        }
      }
      // tx version 5 are flux transactions. Put them into flux
      if (tx.version === 5) {
        // todo include to daemon better information about hash and index and preferably address associated
        const collateral = tx.collateral_output;
        const partialCollateralHash = collateral.split('COutPoint(')[1].split(', ')[0];
        const collateralIndex = Number(collateral.split(', ')[1].split(')')[0]);
        const senderInfo = await getSenderForFluxTx(partialCollateralHash, collateralIndex);
        const fluxTxData = {
          txid: tx.txid,
          version: tx.version,
          type: tx.type,
          updateType: tx.update_type,
          ip: tx.ip,
          benchTier: tx.benchmark_tier,
          collateralHash: senderInfo.txid || senderInfo.collateralHash || partialCollateralHash,
          collateralIndex,
          zelAddress: senderInfo.address || senderInfo.zelAddress,
          lockedAmount: senderInfo.satoshis || senderInfo.lockedAmount,
          height: blockDataVerbose.height,
        };
        await serviceHelper.insertOneToDatabase(database, fluxTransactionCollection, fluxTxData);
      }
    }));
    // addressTransactionIndex shall contains object of address: address, transactions: [txids]
    // if (blockData.height % 999 === 0) {
    //   console.log(transactions);
    // }
    if (blockHeight % config.fluxapps.expireFluxAppsPeriod === 0) {
      const result = await serviceHelper.collectionStats(database, utxoIndexCollection);
      const resultB = await serviceHelper.collectionStats(database, addressTransactionIndexCollection);
      const resultC = await serviceHelper.collectionStats(database, fluxTransactionCollection);
      log.info(`UTXO documents: ${result.size}, ${result.count}, ${result.avgObjSize}`);
      log.info(`ADDR documents: ${resultB.size}, ${resultB.count}, ${resultB.avgObjSize}`);
      log.info(`FLUX documents: ${resultC.size}, ${resultC.count}, ${resultC.avgObjSize}`);
      const resultFusion = await serviceHelper.collectionStats(database, coinbaseFusionIndexCollection);
      log.info(`Fusion documents: ${resultFusion.size}, ${resultFusion.count}, ${resultFusion.avgObjSize}`);
      if (blockDataVerbose.height >= config.fluxapps.epochstart) {
        appsService.expireGlobalApplications();
      }
    }
    if (blockHeight % config.fluxapps.removeFluxAppsPeriod === 0) {
      if (blockDataVerbose.height >= config.fluxapps.epochstart) {
        appsService.checkAndRemoveApplicationInstance();
      }
    }
    if (blockHeight % config.fluxapps.updateFluxAppsPeriod === 0) {
      if (blockDataVerbose.height >= config.fluxapps.epochstart) {
        appsService.reinstallOldApplications();
      }
    }
    const scannedHeight = blockDataVerbose.height;
    // update scanned Height in scannedBlockHeightCollection
    const query = { generalScannedHeight: { $gte: 0 } };
    const update = { $set: { generalScannedHeight: scannedHeight } };
    const options = {
      upsert: true,
    };
    await serviceHelper.updateOneInDatabase(database, scannedHeightCollection, query, update, options);
    someBlockIsProcessing = false;
    if (blockProccessingCanContinue) {
      if (blockDataVerbose.confirmations > 1) {
        processBlock(blockDataVerbose.height + 1);
      } else {
        const daemonGetInfo = await daemonService.getInfo();
        let daemonHeight = 0;
        if (daemonGetInfo.status === 'success') {
          daemonHeight = daemonGetInfo.data.blocks;
        }
        if (daemonHeight > blockDataVerbose.height) {
          processBlock(blockDataVerbose.height + 1);
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

async function restoreDatabaseToBlockheightState(height, rescanGlobalApps = false) {
  if (!height) {
    throw new Error('No blockheight for restoring provided');
  }
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.daemon.database);

  const query = { height: { $gt: height } };
  const queryForAddresses = {}; // we need to remove those transactions in transactions field that have height greater than height
  const queryForAddressesDeletion = { transactions: { $exists: true, $size: 0 } };
  const projection = { $pull: { transactions: { height: { $gt: height } } } };

  // restore utxoDatabase collection
  await serviceHelper.removeDocumentsFromCollection(database, utxoIndexCollection, query);
  // restore coinbaseDatabase collection
  await serviceHelper.removeDocumentsFromCollection(database, coinbaseFusionIndexCollection, query);
  // restore addressTransactionIndex collection
  // remove transactions with height bigger than our scanned height
  await serviceHelper.updateInDatabase(database, addressTransactionIndexCollection, queryForAddresses, projection);
  // remove addresses with 0 transactions
  await serviceHelper.removeDocumentsFromCollection(database, addressTransactionIndexCollection, queryForAddressesDeletion);
  // restore fluxTransactions collection
  await serviceHelper.removeDocumentsFromCollection(database, fluxTransactionCollection, query);
  // restore appsHashes collection
  await serviceHelper.removeDocumentsFromCollection(database, appsHashesCollection, query);
  if (rescanGlobalApps === true) {
    const databaseGlobal = dbopen.db(config.database.appsglobal.database);
    log.info('Rescanning Apps!');
    await serviceHelper.removeDocumentsFromCollection(databaseGlobal, config.database.appsglobal.collections.appsMessages, query);
    await serviceHelper.removeDocumentsFromCollection(databaseGlobal, config.database.appsglobal.collections.appsInformation, query);
  }
  log.info('Rescan completed');
  return true;
}

// do a deepRestore of 100 blocks if daemon if enouncters an error (mostly flux daemon was down) or if its initial start of flux
// use reindexGlobalApps with caution!!!
async function initiateBlockProcessor(restoreDatabase, deepRestore, reindexOrRescanGlobalApps) {
  try {
    const syncStatus = await daemonService.isDaemonSynced();
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
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    let scannedBlockHeight = 0;
    const currentHeight = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (currentHeight && currentHeight.generalScannedHeight) {
      scannedBlockHeight = currentHeight.generalScannedHeight;
    }
    const daemonGetInfo = await daemonService.getInfo();
    let daemonHeight = 0;
    if (daemonGetInfo.status === 'success') {
      daemonHeight = daemonGetInfo.data.blocks;
    } else {
      throw new Error(daemonGetInfo.data.message || daemonGetInfo.data);
    }
    // get scanned height from our database;
    // get height from blockchain?
    if (scannedBlockHeight === 0) {
      log.info('Preparing daemon collections');
      const result = await serviceHelper.dropCollection(database, utxoIndexCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      const resultB = await serviceHelper.dropCollection(database, addressTransactionIndexCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      const resultC = await serviceHelper.dropCollection(database, fluxTransactionCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      const resultD = await serviceHelper.dropCollection(database, appsHashesCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      const resultFusion = await serviceHelper.dropCollection(database, coinbaseFusionIndexCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          throw error;
        }
      });
      log.info(result, resultB, resultC, resultD, resultFusion);

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
      await database.collection(fluxTransactionCollection).createIndex({ ip: 1 }, { name: 'query for getting list of zelnode txs associated to IP address' });
      await database.collection(fluxTransactionCollection).createIndex({ zelAddress: 1 }, { name: 'query for getting list of zelnode txs associated to ZEL address' });
      await database.collection(fluxTransactionCollection).createIndex({ tier: 1 }, { name: 'query for getting list of zelnode txs according to benchmarking tier' });
      await database.collection(fluxTransactionCollection).createIndex({ type: 1 }, { name: 'query for getting all zelnode txs according to type of transaction' });
      await database.collection(fluxTransactionCollection).createIndex({ collateralHash: 1, collateralIndex: 1 }, { name: 'query for getting list of zelnode txs associated to specific collateral' });
      await database.collection(appsHashesCollection).createIndex({ txid: 1 }, { name: 'query for getting txid' });
      await database.collection(appsHashesCollection).createIndex({ height: 1 }, { name: 'query for getting height' });
      await database.collection(appsHashesCollection).createIndex({ hash: 1 }, { name: 'query for getting app hash', unique: true }).catch((error) => {
        // 5501c7dd6516c3fc2e68dee8d4fdd20d92f57f8cfcdc7b4fcbad46499e43ed6f
        log.error('Expected throw on index creation as of new uniquness. Do not remove this check until all nodes have rebuild apps data');
        log.error(error);
      }); // has to be unique!
      await database.collection(appsHashesCollection).createIndex({ message: 1 }, { name: 'query for getting app hashes depending if we have message' });

      const databaseGlobal = db.db(config.database.appsglobal.database);
      log.info('Preparing apps collections');
      if (reindexOrRescanGlobalApps === true) {
        const resultE = await serviceHelper.dropCollection(databaseGlobal, config.database.appsglobal.collections.appsMessages).catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
        const resultF = await serviceHelper.dropCollection(databaseGlobal, config.database.appsglobal.collections.appsInformation).catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
        const resultG = await serviceHelper.dropCollection(databaseGlobal, config.database.appsglobal.collections.appsLocations).catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
        log.info(resultE, resultF, resultG);
      }
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ hash: 1 }, { name: 'query for getting zelapp message based on hash' }); // , unique: true
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ txid: 1 }, { name: 'query for getting zelapp message based on txid' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ height: 1 }, { name: 'query for getting zelapp message based on height' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'zelAppSpecifications.name': 1 }, { name: 'query for getting zelapp message based on zelapp specs name' }); // , unique: true
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'zelAppSpecifications.owner': 1 }, { name: 'query for getting zelapp message based on zelapp specs owner' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'zelAppSpecifications.repotag': 1 }, { name: 'query for getting zelapp message based on image' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.name': 1 }, { name: 'query for getting app message based on zelapp specs name' }); // , unique: true
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.owner': 1 }, { name: 'query for getting app message based on zelapp specs owner' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsMessages).createIndex({ 'appSpecifications.repotag': 1 }, { name: 'query for getting app message based on image' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ name: 1 }, { name: 'query for getting zelapp based on zelapp specs name' }); // , unique: true
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ owner: 1 }, { name: 'query for getting zelapp based on zelapp specs owner' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ repotag: 1 }, { name: 'query for getting zelapp based on image' });
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ height: 1 }, { name: 'query for getting zelapp based on last height update' }); // we need to know the height of app adjustment
      await databaseGlobal.collection(config.database.appsglobal.collections.appsInformation).createIndex({ hash: 1 }, { name: 'query for getting zelapp based on last hash' }); // , unique: true // we need to know the hash of the last message update which is the true identifier
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ name: 1 }, { name: 'query for getting zelapp location based on zelapp specs name' });
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ hash: 1 }, { name: 'query for getting zelapp location based on zelapp hash' });
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ ip: 1 }, { name: 'query for getting zelapp location based on ip' });
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ name: 1, ip: 1 }, { name: 'query for getting app based on ip and name' });
      await database.collection(config.database.appsglobal.collections.appsLocations).createIndex({ name: 1, ip: 1, broadcastedAt: 1 }, { name: 'query for getting app to ensure we possess a message' });
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
            await serviceHelper.updateOneInDatabase(database, scannedHeightCollection, queryHeight, update, options);
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
      } else if (scannedBlockHeight > config.daemon.chainValidHeight) {
        const daemonGetChainTips = await daemonService.getChainTips();
        if (daemonGetChainTips.status !== 'success') {
          throw new Error(daemonGetChainTips.data.message || daemonGetInfo.data);
        }
        const reorganisations = daemonGetChainTips.data;
        // database can be off for up to 2 blocks compared to daemon
        const reorgDepth = scannedBlockHeight - 2;
        const reorgs = reorganisations.filter((reorg) => reorg.status === 'valid-fork' && reorg.height === reorgDepth);
        let rescanDepth = 0;
        // if more valid forks on the same height. Restore from the longest one
        reorgs.forEach((reorg) => {
          if (reorg.branchlen > rescanDepth) {
            rescanDepth = reorg.branchlen;
          }
        });
        if (rescanDepth > 0) {
          try {
            // restore rescanDepth + 2 more blocks back
            rescanDepth += 2;
            log.warn(`Potential chain reorganisation spotted at height ${reorgDepth}. Rescanning last ${rescanDepth} blocks...`);
            scannedBlockHeight = Math.max(scannedBlockHeight - rescanDepth, 0);
            await restoreDatabaseToBlockheightState(scannedBlockHeight, reindexOrRescanGlobalApps);
            const queryHeight = { generalScannedHeight: { $gte: 0 } };
            const update = { $set: { generalScannedHeight: scannedBlockHeight } };
            const options = {
              upsert: true,
            };
            await serviceHelper.updateOneInDatabase(database, scannedHeightCollection, queryHeight, update, options);
            log.info('Database restored OK');
          } catch (e) {
            log.error('Error restoring database!');
            throw e;
          }
        }
      }
      isInInitiationOfBP = false;
      processBlock(scannedBlockHeight + 1);
    } else {
      isInInitiationOfBP = false;
      initBPfromNoBlockTimeout = setTimeout(() => {
        initiateBlockProcessor(false, false);
      }, 5000);
    }
  } catch (error) {
    log.error(error);
    isInInitiationOfBP = false;
    initBPfromErrorTimeout = setTimeout(() => {
      initiateBlockProcessor(true, true);
    }, 15 * 60 * 1000);
  }
}

async function getAllUtxos(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
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
    const results = await serviceHelper.findInDatabase(database, utxoIndexCollection, query, projection);
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getAllFusionCoinbase(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
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
    const results = await serviceHelper.findInDatabase(database, coinbaseFusionIndexCollection, query, projection);
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getAllFluxTransactions(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = {};
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        version: 1,
        type: 1,
        updateType: 1,
        ip: 1,
        benchTier: 1,
        collateralHash: 1,
        collateralIndex: 1,
        zelAddress: 1,
        lockedAmount: 1,
        height: 1,
      },
    };
    const results = await serviceHelper.findInDatabase(database, fluxTransactionCollection, query, projection);
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getAllAddressesWithTransactions(req, res) {
  try {
    // FIXME outputs all documents in the collection. We shall group same addresses. But this call is disabled and for testing purposes anyway
    const dbopen = serviceHelper.databaseConnection();
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
    const results = await serviceHelper.findInDatabase(database, addressTransactionIndexCollection, query, projection);
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getAllAddresses(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const variable = 'address';
    const results = await serviceHelper.distinctDatabase(database, addressTransactionIndexCollection, variable);
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getAddressUtxos(req, res) {
  try {
    let { address } = req.params; // we accept both help/command and help?command=getinfo
    address = address || req.query.address;
    if (!address) {
      throw new Error('No address provided');
    }
    const dbopen = serviceHelper.databaseConnection();
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
    const results = await serviceHelper.findInDatabase(database, utxoIndexCollection, query, projection);
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getAddressFusionCoinbase(req, res) {
  try {
    let { address } = req.params; // we accept both help/command and help?command=getinfo
    address = address || req.query.address;
    if (!address) {
      throw new Error('No address provided');
    }
    const dbopen = serviceHelper.databaseConnection();
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
    const results = await serviceHelper.findInDatabase(database, coinbaseFusionIndexCollection, query, projection);
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getFilteredFluxTxs(req, res) {
  try {
    let { filter } = req.params; // we accept both help/command and help?command=getinfo
    filter = filter || req.query.filter;
    let query = {};
    if (!filter) {
      throw new Error('No filter provided');
    }
    if (filter.includes('.')) {
      // IP address case
      query = { ip: filter };
    } else if (filter.length === 64) {
      // collateralHash case
      query = { collateralHash: filter };
    } else if (filter.length >= 30 && filter.length < 38) {
      // flux address case
      query = { zelAddress: filter };
    } else {
      throw new Error('It is possible to only filter via IP address, Zel address and Collateral hash.');
    }
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const projection = {
      projection: {
        _id: 0,
        txid: 1,
        version: 1,
        type: 1,
        updateType: 1,
        ip: 1,
        benchTier: 1,
        collateralHash: 1,
        collateralIndex: 1,
        zelAddress: 1,
        lockedAmount: 1,
        height: 1,
      },
    };
    const results = await serviceHelper.findInDatabase(database, fluxTransactionCollection, query, projection);
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getAddressTransactions(req, res) {
  try {
    let { address } = req.params; // we accept both help/command and help?command=getinfo
    address = address || req.query.address;
    if (!address) {
      throw new Error('No address provided');
    }
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { address };
    const distinct = 'transactions';
    const results = await serviceHelper.distinctDatabase(database, addressTransactionIndexCollection, distinct, query);
    // TODO FIX documentation. UPDATE for an amount of last txs needed.
    // now we have array of transactions [{txid, height}, {}...]
    const resMessage = serviceHelper.createDataMessage(results);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getScannedHeight(req, res) {
  try {
    const dbopen = serviceHelper.databaseConnection();
    const database = dbopen.db(config.database.daemon.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    const result = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
    if (!result) {
      throw new Error('Scanning not initiated');
    }
    const resMessage = serviceHelper.createDataMessage(result);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function checkBlockProcessingStopped(i, callback) {
  blockProccessingCanContinue = false;
  clearTimeout(initBPfromErrorTimeout);
  clearTimeout(initBPfromNoBlockTimeout);
  if (someBlockIsProcessing === false && isInInitiationOfBP === false) {
    const succMessage = serviceHelper.createSuccessMessage('Block processing is stopped');
    blockProccessingCanContinue = true;
    callback(succMessage);
  } else {
    setTimeout(() => {
      const j = i + 1;
      if (j < 12) {
        checkBlockProcessingStopped(j, callback);
      } else {
        const errMessage = serviceHelper.createErrorMessage('Unknown error occured. Try again later.');
        callback(errMessage);
      }
    }, 1000);
  }
}

async function stopBlockProcessing(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const i = 0;
    checkBlockProcessingStopped(i, async (response) => {
      // put blockProccessingCanContinue status to true.
      res.json(response);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function restartBlockProcessing(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    const i = 0;
    checkBlockProcessingStopped(i, async () => {
      initiateBlockProcessor(true, false);
      const message = serviceHelper.createSuccessMessage('Block processing initiated');
      res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function reindexExplorer(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
  if (authorized === true) {
    // stop block processing
    const i = 0;
    let { reindexapps } = req.params;
    reindexapps = reindexapps || req.query.rescanapps || false;
    reindexapps = serviceHelper.ensureBoolean(reindexapps);
    checkBlockProcessingStopped(i, async (response) => {
      if (response.status === 'error') {
        res.json(response);
      } else if (operationBlocked) {
        const errMessage = serviceHelper.createErrorMessage('Operation blocked');
        res.json(errMessage);
      } else {
        operationBlocked = true;
        const dbopen = serviceHelper.databaseConnection();
        const database = dbopen.db(config.database.daemon.database);
        const resultOfDropping = await serviceHelper.dropCollection(database, scannedHeightCollection).catch((error) => {
          if (error.message !== 'ns not found') {
            operationBlocked = false;
            log.error(error);
            const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
            res.json(errMessage);
          }
        });
        operationBlocked = false;
        if (resultOfDropping === true || resultOfDropping === undefined) {
          initiateBlockProcessor(true, false, reindexapps); // restore database and possibly do reindex of apps
          const message = serviceHelper.createSuccessMessage('Explorer database reindex initiated');
          res.json(message);
        } else {
          const errMessage = serviceHelper.createErrorMessage(resultOfDropping, 'Collection dropping error');
          res.json(errMessage);
        }
      }
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function rescanExplorer(req, res) {
  try {
    const authorized = await serviceHelper.verifyPrivilege('adminandfluxteam', req);
    if (authorized === true) {
      // since what blockheight
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = serviceHelper.createErrorMessage('No blockheight provided');
        res.json(errMessage);
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = serviceHelper.databaseConnection();
      const database = dbopen.db(config.database.daemon.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection);
      if (!currentHeight) {
        throw new Error('No scanned height found');
      }
      if (currentHeight.generalScannedHeight <= blockheight) {
        throw new Error('Block height shall be lower than currently scanned');
      }
      if (blockheight < 0) {
        throw new Error('BlockHeight lower than 0');
      }
      let { rescanapps } = req.params;
      rescanapps = rescanapps || req.query.rescanapps || false;
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
          await serviceHelper.updateOneInDatabase(database, scannedHeightCollection, query, update, options);
          operationBlocked = false;
          initiateBlockProcessor(true, false, rescanapps); // restore database and possibly do rescan of apps
          const message = serviceHelper.createSuccessMessage(`Explorer rescan from blockheight ${blockheight} initiated`);
          res.json(message);
        }
      });
    } else {
      const errMessage = serviceHelper.errUnauthorizedMessage();
      res.json(errMessage);
    }
  } catch (error) {
    operationBlocked = false;
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
}

async function getAddressBalance(req, res) {
  try {
    let { address } = req.params; // we accept both help/command and help?command=getinfo
    address = address || req.query.address || '';
    if (!address) {
      throw new Error('No address provided');
    }
    const dbopen = serviceHelper.databaseConnection();
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
    const results = await serviceHelper.findInDatabase(database, utxoIndexCollection, query, projection);
    let balance = 0;
    results.forEach((utxo) => {
      balance += utxo.satoshis;
    });
    const resMessage = serviceHelper.createDataMessage(balance);
    res.json(resMessage);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
  }
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
  getAllFluxTransactions,
  getAddressUtxos,
  getAddressTransactions,
  getAddressBalance,
  getFilteredFluxTxs,
  getScannedHeight,
  getAllFusionCoinbase,
  getAddressFusionCoinbase,
};
