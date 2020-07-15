const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');
const zelappsService = require('./zelappsService');

const utxoIndexCollection = config.database.zelcash.collections.utxoIndex;
const zelappsHashesCollection =
  config.database.zelcash.collections.zelappsHashes;
const addressTransactionIndexCollection =
  config.database.zelcash.collections.addressTransactionIndex;
const scannedHeightCollection =
  config.database.zelcash.collections.scannedHeight;
const zelnodeTransactionCollection =
  config.database.zelcash.collections.zelnodeTransactions;
let blockProccessingCanContinue = true;
let someBlockIsProcessing = false;
let isInInitiationOfBP = false;
let operationBlocked = false;
let initBPfromNoBlockTimeout;
let initBPfromErrorTimeout;

// function getCollateralHash(hexOfZelNodeTx) {
//   const hex = hexOfZelNodeTx.slice(10, 74);
//   const buf = Buffer.from(hex, 'hex').reverse();
//   return buf.toString('hex');
// }

// function getCollateralIndex(hexOfZelNodeTx) {
//   const hex = hexOfZelNodeTx.slice(74, 82);
//   const buf = Buffer.from(hex, 'hex').reverse();
//   return parseInt(buf.toString('hex'), 16);
// }

async function getSenderTransactionFromZelCash(txid) {
  const verbose = 1;
  const req = {
    params: {
      txid,
      verbose,
    },
  };

  const txContent = await zelcashService.getRawTransaction(req);
  if (txContent.status === 'success') {
    const sender = txContent.data;
    return sender;
  }
  throw txContent.data;
}

async function getSenderForZelNodeTx(txid, vout) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelcash.database);
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
      },
    ],
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
  let txContent = await serviceHelper
    .findOneInDatabase(database, utxoIndexCollection, query, projection)
    .catch((error) => {
      log.error(error);
      throw error;
    });
  if (!txContent) {
    log.info(
      `Transaction ${txid} ${vout} not found in database. Falling back to previous ZelNode transaction`
    );
    const queryZelNode = {
      $and: [
        { collateralHash: new RegExp(`^${txid}`) },
        { collateralIndex: vout },
        {
          $or: [
            { lockedAmount: 1000000000000 },
            { lockedAmount: 2500000000000 },
            { lockedAmount: 10000000000000 },
          ],
        },
      ],
    };
    // we do not need other data as we are just asking what the sender address
    // is.
    const projectionZelNode = {
      projection: {
        _id: 0,
        collateralHash: 1,
        zelAddress: 1,
        lockedAmount: 1,
      },
    };
    // find previous zelnode transaction that
    txContent = await serviceHelper
      .findOneInDatabase(
        database,
        zelnodeTransactionCollection,
        queryZelNode,
        projectionZelNode
      )
      .catch((error) => {
        log.error(error);
        throw error;
      });
  }
  if (!txContent) {
    log.warn(
      `Transaction ${txid} ${vout} was not found anywhere. Uncomplete tx!`
    );
    const zelcashTxContent = {
      txid: undefined,
      // vout,
      // height: zelcashSender.height,
      address: undefined,
      satoshis: undefined,
      // scriptPubKey: senderData.scriptPubKey.hex,
    };
    return zelcashTxContent;
  }
  const sender = txContent;
  return sender;
}

async function getSender(txid, vout) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelcash.database);
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
  const txContent = await serviceHelper
    .findOneAndDeleteInDatabase(
      database,
      utxoIndexCollection,
      query,
      projection
    )
    .catch((error) => {
      log.error(error);
      throw error;
    });
  if (!txContent.value) {
    // we are spending it anyway so it wont affect users balance
    log.info(
      `Transaction ${txid} ${vout} not found in database. Falling back to blockchain data`
    );
    const zelcashSender = await getSenderTransactionFromZelCash(txid).catch(
      (error) => {
        log.error(error);
        throw error;
      }
    );
    const senderData = zelcashSender.vout[vout];
    const zelcashTxContent = {
      // txid,
      // vout,
      // height: zelcashSender.height,
      address: senderData.scriptPubKey.addresses[0], // always exists as it is utxo.
      // satoshis: senderData.valueSat,
      // scriptPubKey: senderData.scriptPubKey.hex,
    };
    return zelcashTxContent;
  }
  const sender = txContent.value;
  return sender;
}

async function processTransaction(txContent, height) {
  const db = serviceHelper.databaseConnection();
  const database = db.db(config.database.zelcash.database);
  let transactionDetail = {};
  transactionDetail = txContent;
  if (txContent.version < 5 && txContent.version > 0) {
    // if transaction has no vouts, it cannot be an utxo. Do not store it.
    await Promise.all(
      transactionDetail.vout.map(async (vout, index) => {
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
          await serviceHelper
            .insertOneToDatabase(database, utxoIndexCollection, utxoDetail)
            .catch((error) => {
              log.error(error);
              throw error;
            });
        }
      })
    );

    // fetch senders from our mongoDatabase
    const sendersToFetch = [];

    txContent.vin.forEach((vin) => {
      if (!vin.coinbase) {
        // we need an address who sent those coins and amount of it.
        sendersToFetch.push(vin);
      }
    });

    const senders = []; // Can put just value and address
    // parallel reading causes zelcash to fail with error 500
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
  // transactionDetail now contains senders. So then going through senders and
  // vouts when generating indexes.
  return transactionDetail;
}

async function processBlockTransactions(txs, height) {
  const transactions = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const transaction of txs) {
    // eslint-disable-next-line no-await-in-loop
    const txContent = await processTransaction(transaction, height);
    transactions.push(txContent);
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
  const blockInfo = await zelcashService.getBlock(req);
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
      message += String.fromCharCode(parseInt(hexx.substr(k, 2), 16));
    }
  }
  return message;
}

async function processBlock(blockHeight) {
  try {
    someBlockIsProcessing = true;
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.zelcash.database);
    // get Block information
    const blockDataVerbose = await getVerboseBlock(blockHeight);
    if (blockDataVerbose.height % 50 === 0) {
      console.log(blockDataVerbose.height);
    }
    // get Block transactions information
    const transactions = await processBlockTransactions(
      blockDataVerbose.tx,
      blockDataVerbose.height
    );
    // now we have verbose transactions of the block extended for senders -
    // object of utxoDetail = { txid, vout, height, address, satoshis,
    // scriptPubKey ) and can create addressTransactionIndex. amount in address
    // can be calculated from utxos. We do not need to store it.
    await Promise.all(
      transactions.map(async (tx) => {
        // normal transactions
        if (tx.version < 5 && tx.version > 0) {
          let message = '';
          let isZelAppMessageValue = 0;

          const addresses = [];
          tx.senders.forEach((sender) => {
            addresses.push(sender.address);
          });
          tx.vout.forEach((receiver) => {
            if (receiver.scriptPubKey.addresses) {
              // count for messages
              addresses.push(receiver.scriptPubKey.addresses[0]);
              if (
                receiver.scriptPubKey.addresses[0] === config.zelapps.address
              ) {
                // it is a zelapp message. Get Satoshi amount
                isZelAppMessageValue = receiver.valueSat;
              }
            }
            if (receiver.scriptPubKey.asm) {
              message = decodeMessage(receiver.scriptPubKey.asm);
            }
          });
          const addressesOK = [...new Set(addresses)];
          const transactionRecord = {
            txid: tx.txid,
            height: blockDataVerbose.height,
          };
          // update addresses from addressesOK array in our database. We need
          // blockheight there too. transac
          await Promise.all(
            addressesOK.map(async (address) => {
              // maximum of 10000 txs per address in one document
              const query = { address, count: { $lt: 10000 } };
              const update = {
                $set: { address },
                $push: { transactions: transactionRecord },
                $inc: { count: 1 },
              };
              const options = {
                upsert: true,
              };
              await serviceHelper.updateOneInDatabase(
                database,
                addressTransactionIndexCollection,
                query,
                update,
                options
              );
            })
          );
          // MAY contain ZelApp transaction. Store it.
          if (
            isZelAppMessageValue >= 10 &&
            message.length === 64 &&
            blockDataVerbose.height >= config.zelapps.epochstart
          ) {
            // min of 10 zel had to be paid for
            // us bothering checking
            const zelappTxRecord = {
              txid: tx.txid,
              height: blockDataVerbose.height,
              hash: message,
              value: isZelAppMessageValue,
              message: false, // message is boolean saying if we already have it
              // stored as permanent message
            };
            await serviceHelper.insertOneToDatabase(
              database,
              zelappsHashesCollection,
              zelappTxRecord
            );
            zelappsService.checkAndRequestZelApp(
              message,
              tx.txid,
              blockDataVerbose.height,
              isZelAppMessageValue
            );
          }
        }
        // tx version 5 are zelnode transactions. Put them into zelnode
        if (tx.version === 5) {
          // todo include to zelcash better information about hash and index and
          // preferably address associated
          const collateral = tx.collateral_output;
          const partialCollateralHash = collateral
            .split('COutPoint(')[1]
            .split(', ')[0];
          const collateralIndex = Number(
            collateral.split(', ')[1].split(')')[0]
          );
          const senderInfo = await getSenderForZelNodeTx(
            partialCollateralHash,
            collateralIndex
          );
          const zelnodeTxData = {
            txid: tx.txid,
            version: tx.version,
            type: tx.type,
            updateType: tx.update_type,
            ip: tx.ip,
            benchTier: tx.benchmark_tier,
            collateralHash:
              senderInfo.txid ||
              senderInfo.collateralHash ||
              partialCollateralHash,
            collateralIndex,
            zelAddress: senderInfo.address || senderInfo.zelAddress,
            lockedAmount: senderInfo.satoshis || senderInfo.lockedAmount,
            height: blockDataVerbose.height,
          };
          await serviceHelper.insertOneToDatabase(
            database,
            zelnodeTransactionCollection,
            zelnodeTxData
          );
        }
      })
    );
    // addressTransactionIndex shall contains object of address: address,
    // transactions: [txids] if (blockData.height % 999 === 0) {
    //   console.log(transactions);
    // }
    if (blockHeight % 100 === 0) {
      const result = await serviceHelper.collectionStats(
        database,
        utxoIndexCollection
      );
      const resultB = await serviceHelper.collectionStats(
        database,
        addressTransactionIndexCollection
      );
      const resultC = await serviceHelper.collectionStats(
        database,
        zelnodeTransactionCollection
      );
      log.info('UTXO documents', result.size, result.count, result.avgObjSize);
      log.info(
        'ADDR documents',
        resultB.size,
        resultB.count,
        resultB.avgObjSize
      );
      log.info(
        'ZELNODE documents',
        resultC.size,
        resultC.count,
        resultC.avgObjSize
      );
    }
    const scannedHeight = blockDataVerbose.height;
    // update scanned Height in scannedBlockHeightCollection
    const query = { generalScannedHeight: { $gte: 0 } };
    const update = { $set: { generalScannedHeight: scannedHeight } };
    const options = {
      upsert: true,
    };
    await serviceHelper.updateOneInDatabase(
      database,
      scannedHeightCollection,
      query,
      update,
      options
    );
    someBlockIsProcessing = false;
    if (blockProccessingCanContinue) {
      if (blockDataVerbose.confirmations > 1) {
        processBlock(blockDataVerbose.height + 1);
      } else {
        // eslint-disable-next-line no-use-before-define
        initiateBlockProcessor(false, false);
      }
    }
  } catch (error) {
    someBlockIsProcessing = false;
    log.error('Block processor encountered an error.');
    log.error(error);
    if (blockProccessingCanContinue) {
      // eslint-disable-next-line no-use-before-define
      initiateBlockProcessor(true, false);
    }
  }
}

async function restoreDatabaseToBlockheightState(
  height,
  rescanGlobalApps = false
) {
  if (!height) {
    throw new Error('No blockheight for restoring provided');
  }
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);

  const query = { height: { $gt: height } };
  const queryForAddresses = {}; // we need to remove those transactions in transactions field that
  // have height greater than height
  const queryForAddressesDeletion = {
    transactions: { $exists: true, $size: 0 },
  };
  const projection = { $pull: { transactions: { height: { $gt: height } } } };

  // restore utxoDatabase collection
  await serviceHelper
    .removeDocumentsFromCollection(database, utxoIndexCollection, query)
    .catch((error) => {
      log.error(error);
      throw error;
    });
  // restore addressTransactionIndex collection
  // remove transactions with height bigger than our scanned height
  await serviceHelper
    .updateInDatabase(
      database,
      addressTransactionIndexCollection,
      queryForAddresses,
      projection
    )
    .catch((error) => {
      log.error(error);
      throw error;
    });
  // remove addresses with 0 transactions
  await serviceHelper
    .removeDocumentsFromCollection(
      database,
      addressTransactionIndexCollection,
      queryForAddressesDeletion
    )
    .catch((error) => {
      log.error(error);
      throw error;
    });
  // restore zelnodeTransactions collection
  await serviceHelper
    .removeDocumentsFromCollection(
      database,
      zelnodeTransactionCollection,
      query
    )
    .catch((error) => {
      log.error(error);
      throw error;
    });
  // restore zelappsHashes collection
  await serviceHelper
    .removeDocumentsFromCollection(database, zelappsHashesCollection, query)
    .catch((error) => {
      log.error(error);
      throw error;
    });
  if (rescanGlobalApps === true) {
    const databaseGlobal = dbopen.db(config.database.zelappsglobal.database);
    log.info('Rescanning Apps!');
    await serviceHelper
      .removeDocumentsFromCollection(
        databaseGlobal,
        config.database.zelappsglobal.collections.zelappsMessages,
        query
      )
      .catch((error) => {
        log.error(error);
        throw error;
      });
    await serviceHelper
      .removeDocumentsFromCollection(
        databaseGlobal,
        config.database.zelappsglobal.collections.zelappsInformation,
        query
      )
      .catch((error) => {
        log.error(error);
        throw error;
      });
  }
  log.info('Rescan completed');
  return true;
}

// do a deepRestore of 100 blocks if ZelCash daemon if enouncters an error
// (mostly zel daemon was down) or if its initial start of flux use
// reindexGlobalApps with caution!!!
async function initiateBlockProcessor(
  restoreDatabase,
  deepRestore,
  reindexOrRescanGlobalApps
) {
  try {
    if (isInInitiationOfBP) {
      return;
    }
    isInInitiationOfBP = true;
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.zelcash.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const projection = {
      projection: {
        _id: 0,
        generalScannedHeight: 1,
      },
    };
    let scannedBlockHeight = 0;
    const currentHeight = await serviceHelper.findOneInDatabase(
      database,
      scannedHeightCollection,
      query,
      projection
    );
    if (currentHeight && currentHeight.generalScannedHeight) {
      scannedBlockHeight = currentHeight.generalScannedHeight;
    }
    const zelcashGetInfo = await zelcashService.getInfo();
    let zelcashHeight = 0;
    if (zelcashGetInfo.status === 'success') {
      zelcashHeight = zelcashGetInfo.data.blocks;
    } else {
      throw new Error(zelcashGetInfo.data);
    }
    // get scanned height from our database;
    // get height from blockchain?
    if (scannedBlockHeight === 0) {
      log.info('Preparing zelcash collections');
      const result = await serviceHelper
        .dropCollection(database, utxoIndexCollection)
        .catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
      const resultB = await serviceHelper
        .dropCollection(database, addressTransactionIndexCollection)
        .catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
      const resultC = await serviceHelper
        .dropCollection(database, zelnodeTransactionCollection)
        .catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
      const resultD = await serviceHelper
        .dropCollection(database, zelappsHashesCollection)
        .catch((error) => {
          if (error.message !== 'ns not found') {
            throw error;
          }
        });
      log.info(result, resultB, resultC, resultD);

      await database
        .collection(utxoIndexCollection)
        .createIndex(
          { txid: 1, vout: 1 },
          { name: 'query for getting utxo', unique: true }
        );
      await database
        .collection(utxoIndexCollection)
        .createIndex(
          { txid: 1, vout: 1, satoshis: 1 },
          { name: 'query for getting utxo for zelnode tx', unique: true }
        );
      await database
        .collection(utxoIndexCollection)
        .createIndex({ address: 1 }, { name: 'query for addresses utxo' });
      await database
        .collection(utxoIndexCollection)
        .createIndex(
          { scriptPubKey: 1 },
          { name: 'query for scriptPubKey utxo' }
        );
      await database
        .collection(addressTransactionIndexCollection)
        .createIndex(
          { address: 1 },
          { name: 'query for addresses transactions' }
        );
      await database
        .collection(addressTransactionIndexCollection)
        .createIndex(
          { address: 1, count: 1 },
          { name: 'query for addresses transactions with count' }
        );
      await database.collection(zelnodeTransactionCollection).createIndex(
        { ip: 1 },
        {
          name:
            'query for getting list of zelnode txs associated to IP address',
        }
      );
      await database.collection(zelnodeTransactionCollection).createIndex(
        { zelAddress: 1 },
        {
          name:
            'query for getting list of zelnode txs associated to ZEL address',
        }
      );
      await database.collection(zelnodeTransactionCollection).createIndex(
        { tier: 1 },
        {
          name:
            'query for getting list of zelnode txs according to benchmarking tier',
        }
      );
      await database.collection(zelnodeTransactionCollection).createIndex(
        { type: 1 },
        {
          name:
            'query for getting all zelnode txs according to type of transaction',
        }
      );
      await database.collection(zelnodeTransactionCollection).createIndex(
        { collateralHash: 1, collateralIndex: 1 },
        {
          name:
            'query for getting list of zelnode txs associated to specific collateral',
        }
      );
      await database
        .collection(zelappsHashesCollection)
        .createIndex({ txid: 1 }, { name: 'query for getting txid' });
      await database
        .collection(zelappsHashesCollection)
        .createIndex({ height: 1 }, { name: 'query for getting height' });
      await database
        .collection(zelappsHashesCollection)
        .createIndex({ hash: 1 }, { name: 'query for getting app hash' });
      await database.collection(zelappsHashesCollection).createIndex(
        { message: 1 },
        {
          name: 'query for getting app hashes depending if we have message',
        }
      );

      const databaseGlobal = db.db(config.database.zelappsglobal.database);
      log.info('Preparing apps collections');
      if (reindexOrRescanGlobalApps === true) {
        const resultE = await serviceHelper
          .dropCollection(
            databaseGlobal,
            config.database.zelappsglobal.collections.zelappsMessages
          )
          .catch((error) => {
            if (error.message !== 'ns not found') {
              throw error;
            }
          });
        const resultF = await serviceHelper
          .dropCollection(
            databaseGlobal,
            config.database.zelappsglobal.collections.zelappsInformation
          )
          .catch((error) => {
            if (error.message !== 'ns not found') {
              throw error;
            }
          });
        log.info(resultE, resultF);
      }
      await databaseGlobal
        .collection(config.database.zelappsglobal.collections.zelappsMessages)
        .createIndex(
          { hash: 1 },
          {
            name: 'query for getting zelapp message based on hash',
          }
        ); // , unique: true
      await databaseGlobal
        .collection(config.database.zelappsglobal.collections.zelappsMessages)
        .createIndex(
          { txid: 1 },
          { name: 'query for getting zelapp message based on txid' }
        );
      await databaseGlobal
        .collection(config.database.zelappsglobal.collections.zelappsMessages)
        .createIndex(
          { height: 1 },
          { name: 'query for getting zelapp message based on height' }
        );
      await databaseGlobal
        .collection(config.database.zelappsglobal.collections.zelappsMessages)
        .createIndex(
          { 'zelAppSpecifications.name': 1 },
          {
            name: 'query for getting zelapp message based on zelapp specs name',
          }
        ); // , unique: true
      await databaseGlobal
        .collection(config.database.zelappsglobal.collections.zelappsMessages)
        .createIndex(
          { 'zelAppSpecifications.owner': 1 },
          {
            name:
              'query for getting zelapp message based on zelapp specs owner',
          }
        );
      await databaseGlobal
        .collection(config.database.zelappsglobal.collections.zelappsMessages)
        .createIndex(
          { 'zelAppSpecifications.repotag': 1 },
          { name: 'query for getting zelapp message based on image' }
        );
      await databaseGlobal
        .collection(
          config.database.zelappsglobal.collections.zelappsInformation
        )
        .createIndex(
          { name: 1 },
          {
            name: 'query for getting zelapp based on zelapp specs name',
          }
        ); // , unique: true
      await databaseGlobal
        .collection(
          config.database.zelappsglobal.collections.zelappsInformation
        )
        .createIndex(
          { owner: 1 },
          { name: 'query for getting zelapp based on zelapp specs owner' }
        );
      await databaseGlobal
        .collection(
          config.database.zelappsglobal.collections.zelappsInformation
        )
        .createIndex(
          { repotag: 1 },
          { name: 'query for getting zelapp based on image' }
        );
      await databaseGlobal
        .collection(
          config.database.zelappsglobal.collections.zelappsInformation
        )
        .createIndex(
          { height: 1 },
          {
            name: 'query for getting zelapp based on last height update',
          }
        ); // we need to know the height of app adjustment
      await databaseGlobal
        .collection(
          config.database.zelappsglobal.collections.zelappsInformation
        )
        .createIndex(
          { hash: 1 },
          {
            name: 'query for getting zelapp based on last hash',
          }
        ); // , unique: true // we need to know the hash of the last message
      // update which is the true identifier
      // what if 2 app adjustment come in the same block?
      // log.info(resultE, resultF);
      log.info('Preparation done');
    }
    if (zelcashHeight > scannedBlockHeight) {
      if (scannedBlockHeight !== 0 && restoreDatabase === true) {
        try {
          // adjust for initial reorg
          if (deepRestore === true) {
            log.info('Deep restoring of database...');
            scannedBlockHeight = Math.max(scannedBlockHeight - 100, 0);
            await restoreDatabaseToBlockheightState(
              scannedBlockHeight,
              reindexOrRescanGlobalApps
            );
            const queryHeight = { generalScannedHeight: { $gte: 0 } };
            const update = {
              $set: { generalScannedHeight: scannedBlockHeight },
            };
            const options = {
              upsert: true,
            };
            await serviceHelper.updateOneInDatabase(
              database,
              scannedHeightCollection,
              queryHeight,
              update,
              options
            );
            log.info('Database restored OK');
          } else {
            log.info('Restoring database...');
            await restoreDatabaseToBlockheightState(
              scannedBlockHeight,
              reindexOrRescanGlobalApps
            );
            log.info('Database restored OK');
          }
        } catch (e) {
          log.error('Error restoring database!');
          throw e;
        }
      } else if (scannedBlockHeight > config.zelcash.chainValidHeight) {
        const zelcashGetChainTips = await zelcashService.getChainTips();
        if (zelcashGetChainTips.status !== 'success') {
          throw new Error(zelcashGetChainTips.data);
        }
        const reorganisations = zelcashGetChainTips.data;
        // database can be off for up to 2 blocks compared to zel chain
        const reorgDepth = scannedBlockHeight - 2;
        const reorgs = reorganisations.filter(
          (reorg) =>
            reorg.status === 'valid-fork' && reorg.height === reorgDepth
        );
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
            log.warn(
              `Potential chain reorganisation spotted at height ${reorgDepth}. Rescanning last ${rescanDepth} blocks...`
            );
            scannedBlockHeight = Math.max(scannedBlockHeight - rescanDepth, 0);
            await restoreDatabaseToBlockheightState(
              scannedBlockHeight,
              reindexOrRescanGlobalApps
            );
            const queryHeight = { generalScannedHeight: { $gte: 0 } };
            const update = {
              $set: { generalScannedHeight: scannedBlockHeight },
            };
            const options = {
              upsert: true,
            };
            await serviceHelper.updateOneInDatabase(
              database,
              scannedHeightCollection,
              queryHeight,
              update,
              options
            );
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
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
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
  const results = await serviceHelper
    .findInDatabase(database, utxoIndexCollection, query, projection)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAllZelNodeTransactions(req, res) {
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
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
  const results = await serviceHelper
    .findInDatabase(database, zelnodeTransactionCollection, query, projection)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAllAddressesWithTransactions(req, res) {
  // FIXME outputs all documents in the collection. We shall group same
  // addresses. But this call is disabled and for testing purposes anyway
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
  const query = {};
  const projection = {
    projection: {
      _id: 0,
      transactions: 1,
      address: 1,
      count: 1,
    },
  };
  const results = await serviceHelper
    .findInDatabase(
      database,
      addressTransactionIndexCollection,
      query,
      projection
    )
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAllAddresses(req, res) {
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
  const variable = 'address';
  const results = await serviceHelper
    .distinctDatabase(database, addressTransactionIndexCollection, variable)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAddressUtxos(req, res) {
  let { address } = req.params; // we accept both help/command and help?command=getinfo
  address = address || req.query.address;
  if (!address) {
    const errMessage = serviceHelper.createErrorMessage('No address provided');
    return res.json(errMessage);
  }
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
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
  const results = await serviceHelper
    .findInDatabase(database, utxoIndexCollection, query, projection)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getFilteredZelNodeTxs(req, res) {
  let { filter } = req.params; // we accept both help/command and help?command=getinfo
  filter = filter || req.query.filter;
  let query = {};
  if (!filter) {
    const errMessage = serviceHelper.createErrorMessage('No filter provided');
    return res.json(errMessage);
  }
  if (filter.includes('.')) {
    // IP address case
    query = { ip: filter };
  } else if (filter.length === 64) {
    // collateralHash case
    query = { collateralHash: filter };
  } else if (filter.length >= 30 && filter.length < 38) {
    // zelAddress case
    query = { zelAddress: filter };
  } else {
    const errMessage = serviceHelper.createErrorMessage(
      'It is possible to only filter via IP address, Zel address and Collateral hash.'
    );
    return res.json(errMessage);
  }
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
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
  const results = await serviceHelper
    .findInDatabase(database, zelnodeTransactionCollection, query, projection)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAddressTransactions(req, res) {
  let { address } = req.params; // we accept both help/command and help?command=getinfo
  address = address || req.query.address;
  if (!address) {
    const errMessage = serviceHelper.createErrorMessage('No address provided');
    return res.json(errMessage);
  }
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
  const query = { address };
  const distinct = 'transactions';
  const results = await serviceHelper
    .distinctDatabase(
      database,
      addressTransactionIndexCollection,
      distinct,
      query
    )
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  // TODO FIX documentation. UPDATE for an amount of last txs needed.
  // now we have array of transactions [{txid, height}, {}...]
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getScannedHeight(req, res) {
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
  const query = { generalScannedHeight: { $gte: 0 } };
  const projection = {
    projection: {
      _id: 0,
      generalScannedHeight: 1,
    },
  };
  const result = await serviceHelper
    .findOneInDatabase(database, scannedHeightCollection, query, projection)
    .catch((error) => {
      log.error(error);
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      throw error;
    });
  if (!result) {
    const errMessage = serviceHelper.createErrorMessage(
      'Scanning not initiated'
    );
    res.json(errMessage);
    throw new Error('Scanning not initiated');
  }
  const resMessage = serviceHelper.createDataMessage(result);
  return res.json(resMessage);
}

async function checkBlockProcessingStopped(i, callback) {
  blockProccessingCanContinue = false;
  clearTimeout(initBPfromErrorTimeout);
  clearTimeout(initBPfromNoBlockTimeout);
  if (someBlockIsProcessing === false && isInInitiationOfBP === false) {
    const succMessage = serviceHelper.createSuccessMessage(
      'Block processing is stopped'
    );
    blockProccessingCanContinue = true;
    callback(succMessage);
  } else {
    setTimeout(() => {
      const j = i + 1;
      if (j < 12) {
        checkBlockProcessingStopped(j, callback);
      } else {
        const errMessage = serviceHelper.createErrorMessage(
          'Unknown error occured. Try again later.'
        );
        callback(errMessage);
      }
    }, 1000);
  }
}

async function stopBlockProcessing(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (authorized === true) {
    const i = 0;
    checkBlockProcessingStopped(i, async () => {
      initiateBlockProcessor(true, false);
      const message = serviceHelper.createSuccessMessage(
        'Block processing initiated'
      );
      res.json(message);
    });
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
    res.json(errMessage);
  }
}

async function reindexExplorer(req, res) {
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
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
        const errMessage = serviceHelper.createErrorMessage(
          'Operation blocked'
        );
        res.json(errMessage);
      } else {
        operationBlocked = true;
        const dbopen = serviceHelper.databaseConnection();
        const database = dbopen.db(config.database.zelcash.database);
        const resultOfDropping = await serviceHelper
          .dropCollection(database, scannedHeightCollection)
          .catch((error) => {
            if (error.message !== 'ns not found') {
              operationBlocked = false;
              log.error(error);
              const errMessage = serviceHelper.createErrorMessage(
                error.message,
                error.name,
                error.code
              );
              res.json(errMessage);
            }
          });
        operationBlocked = false;
        if (resultOfDropping === true || resultOfDropping === undefined) {
          initiateBlockProcessor(true, false, reindexapps); // restore database and possibly do reindex of apps
          const message = serviceHelper.createSuccessMessage(
            'Explorer database reindex initiated'
          );
          res.json(message);
        } else {
          const errMessage = serviceHelper.createErrorMessage(
            resultOfDropping,
            'Collection dropping error'
          );
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
    const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
    if (authorized === true) {
      // since what blockheight
      let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
      blockheight = blockheight || req.query.blockheight;
      if (!blockheight) {
        const errMessage = serviceHelper.createErrorMessage(
          'No blockheight provided'
        );
        res.json(errMessage);
      }
      blockheight = serviceHelper.ensureNumber(blockheight);
      const dbopen = serviceHelper.databaseConnection();
      const database = dbopen.db(config.database.zelcash.database);
      const query = { generalScannedHeight: { $gte: 0 } };
      const projection = {
        projection: {
          _id: 0,
          generalScannedHeight: 1,
        },
      };
      const currentHeight = await serviceHelper.findOneInDatabase(
        database,
        scannedHeightCollection,
        query,
        projection
      );
      if (!currentHeight) {
        throw new Error('No scanned height found');
      }
      if (currentHeight.generalScannedHeight <= blockheight) {
        throw new Error('Block height shall be lower than currently scanned');
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
          await serviceHelper.updateOneInDatabase(
            database,
            scannedHeightCollection,
            query,
            update,
            options
          );
          operationBlocked = false;
          initiateBlockProcessor(true, false, rescanapps); // restore database and possibly do rescan of apps
          const message = serviceHelper.createSuccessMessage(
            `Explorer rescan from blockheight ${blockheight} initiated`
          );
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code
    );
    res.json(errMessage);
  }
}

async function getAddressBalance(req, res) {
  let { address } = req.params; // we accept both help/command and help?command=getinfo
  address = address || req.query.address || '';
  if (!address) {
    const errMessage = serviceHelper.createErrorMessage('No address provided');
    return res.json(errMessage);
  }
  const dbopen = serviceHelper.databaseConnection();
  const database = dbopen.db(config.database.zelcash.database);
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
  const results = await serviceHelper
    .findInDatabase(database, utxoIndexCollection, query, projection)
    .catch((error) => {
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code
      );
      res.json(errMessage);
      log.error(error);
      throw error;
    });
  let balance = 0;
  results.forEach((utxo) => {
    balance += utxo.satoshis;
  });
  const resMessage = serviceHelper.createDataMessage(balance);
  return res.json(resMessage);
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
  getAllZelNodeTransactions,
  getAddressUtxos,
  getAddressTransactions,
  getAddressBalance,
  getFilteredZelNodeTxs,
  getScannedHeight,
};
