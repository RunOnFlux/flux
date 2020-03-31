const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');

const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

const utxoIndexCollection = config.database.zelcash.collections.utxoIndex;
const addressTransactionIndexCollection = config.database.zelcash.collections.addressTransactionIndex;
const scannedHeightCollection = config.database.zelcash.collections.scannedHeight;
const zelnodeTransactionCollection = config.database.zelcash.collections.zelnodeTransactions;
let db = null;
let blockProccessingCanContinue = true;

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

async function getSender(txid, vout) {
  const database = db.db(config.database.zelcash.database);
  const query = { $and: [{ txid }, { voutIndex: vout }] };
  // we do not need other data as we are just asking what the sender address is.
  const projection = {
    projection: {
      _id: 0,
      // txid: 1,
      // voutIndex: 1,
      // height: 1,
      address: 1,
      // satoshis: 1,
      // scriptPubKey: 1,
      // coinbase: 1,
    },
  };

  // find and delete the utxo from global utxo list
  const txContent = await serviceHelper.findOneAndDeleteInDatabase(database, utxoIndexCollection, query, projection).catch((error) => {
    db.close();
    log.error(error);
    throw error;
  });
  if (!txContent.value) {
    // we are spending it anyway so it wont affect users balance
    log.error(`Transaction ${txid} ${vout} not found in database. Falling back to blockchain data`);
    const zelcashSender = await getSenderTransactionFromZelCash(txid).catch((error) => {
      log.error(error);
      throw error;
    });
    const senderData = zelcashSender.vout[vout];
    const zelcashTxContent = {
      // txid,
      // voutIndex: vout,
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

async function getTransaction(hash) {
  const database = db.db(config.database.zelcash.database);
  let transactionDetail = {};
  const verbose = 1;
  const req = {
    params: {
      txid: hash,
      verbose,
    },
  };
  const txContent = await zelcashService.getRawTransaction(req);
  if (txContent.status === 'success') {
    transactionDetail = txContent.data;
    if (txContent.data.version < 5 && txContent.data.version > 0) {
      // if transaction has no vouts, it cannot be an utxo. Do not store it.
      await Promise.all(transactionDetail.vout.map(async (vout, index) => {
        // we need only utxo related information
        // TODO if tx.vin is type of coinbase!
        let coinbase = false;
        if (transactionDetail.vin[0]) {
          if (transactionDetail.vin[0].coinbase) {
            coinbase = true;
          }
        }
        // account for messages
        if (vout.scriptPubKey.addresses) {
          const utxoDetail = {
            txid: txContent.data.txid,
            voutIndex: index,
            height: txContent.data.height,
            address: vout.scriptPubKey.addresses[0],
            satoshis: vout.valueSat,
            scriptPubKey: vout.scriptPubKey.hex,
            coinbase,
          };
          // put the utxo to our mongoDB utxoIndex collection.
          await serviceHelper.insertOneToDatabase(database, utxoIndexCollection, utxoDetail).catch((error) => {
            db.close();
            log.error(error);
            throw error;
          });
        }
      }));

      // fetch senders from our mongoDatabase
      const sendersToFetch = [];

      txContent.data.vin.forEach((vin) => {
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
    // transactionDetail now contains senders. So then going through senders and vouts when generating indexes.
    return transactionDetail;
  }
  throw txContent.data;
}

async function getBlockTransactions(txidsArray) {
  const transactions = [];
  // parallel reading causes zelcash to fail with error 500
  // await Promise.all(txidsArray.map(async (transaction) => {
  //   const txContent = await getTransaction(transaction);
  //   transactions.push(txContent);
  // }));
  // eslint-disable-next-line no-restricted-syntax
  for (const transaction of txidsArray) {
    // eslint-disable-next-line no-await-in-loop
    const txContent = await getTransaction(transaction);
    transactions.push(txContent);
  }
  return transactions;
}

async function getBlock(heightOrHash) {
  const verbosity = 1;
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

async function processBlock(blockHeight) {
  // prepare database

  // get Block information
  const blockData = await getBlock(blockHeight).catch((error) => {
    log.error(error);
    throw error;
  });
  if (blockData.height % 50 === 0) {
    console.log(blockData.height);
  }
  // get Block transactions information
  const transactions = await getBlockTransactions(blockData.tx).catch((error) => {
    log.error(error);
    throw error;
  });
  // now we have verbose transactions of the block extended for senders - object of
  // utxoDetail = { txid, voutIndex, height, address, satoshis, scriptPubKey )
  // and can create addressTransactionIndex.
  // amount in address can be calculated from utxos. We do not need to store it.
  await Promise.all(transactions.map(async (tx) => {
    const database = db.db(config.database.zelcash.database);
    // normal transactions
    if (tx.version < 5 && tx.version > 0) {
      const addresses = [];
      tx.senders.forEach((sender) => {
        addresses.push(sender.address);
      });
      tx.vout.forEach((receiver) => {
        if (receiver.scriptPubKey.addresses) { // count for messages
          addresses.push(receiver.scriptPubKey.addresses[0]);
        }
      });
      const addressesOK = [...new Set(addresses)];
      const transactionRecord = { txid: tx.txid, height: tx.height };
      // update addresses from addressesOK array in our database. We need blockheight there too. transac
      await Promise.all(addressesOK.map(async (address) => {
        const query = { address };
        const update = { $set: { address }, $push: { transactions: transactionRecord } };
        const options = { upsert: true };
        await serviceHelper.findOneAndUpdateInDatabase(database, addressTransactionIndexCollection, query, update, options).catch((error) => {
          db.close();
          log.error(error);
          throw error;
        });
      }));
    }
    // tx version 5 are zelnode transactions. Put them into zelnode
    if (tx.version === 5) {
      // todo. We can get an address from getSender method too as that utxo was not spent yet.
      await serviceHelper.insertOneToDatabase(database, zelnodeTransactionCollection, tx).catch((error) => {
        db.close();
        log.error(error);
        throw error;
      });
    }
  }));
  // addressTransactionIndex shall contains object of address: address, transactions: [txids]
  // if (blockData.height % 999 === 0) {
  //   console.log(transactions);
  // }
  if (blockHeight % 100 === 0) {
    const database = db.db(config.database.zelcash.database);
    const result = await serviceHelper.collectionStats(database, utxoIndexCollection).catch((error) => {
      db.close();
      log.error(error);
      throw error;
    });
    const resultB = await serviceHelper.collectionStats(database, addressTransactionIndexCollection).catch((error) => {
      db.close();
      log.error(error);
      throw error;
    });
    console.log('UTXO', result.size, result.count, result.avgObjSize);
    console.log('ADDR', resultB.size, resultB.count, resultB.avgObjSize);
  }
  const scannedHeight = blockData.height;
  // update scanned Height in scannedBlockHeightCollection
  const database = db.db(config.database.zelcash.database);
  const query = { generalScannedHeight: { $gte: 0 } };
  const update = { $set: { generalScannedHeight: scannedHeight } };
  const options = { upsert: true };
  await serviceHelper.findOneAndUpdateInDatabase(database, scannedHeightCollection, query, update, options).catch((error) => {
    db.close();
    log.error(error);
    throw error;
  });
  if (blockProccessingCanContinue) {
    if (blockData.confirmations > 1) {
      processBlock(blockData.height + 1);
    } else {
      db.close();
      setTimeout(() => {
        if (blockProccessingCanContinue) { // just a precaution because maybe it is just waiting
          // eslint-disable-next-line no-use-before-define
          initiateBlockProcessor();
        } else {
          blockProccessingCanContinue = true;
        }
      }, 5000);
    }
  } else {
    db.close();
    blockProccessingCanContinue = true;
  }
}

async function restoreDatabaseToBlockheightState(height) {
  if (!height) {
    throw new Error('No blockheight for restoring provided');
  }
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    throw error;
  });
  const database = dbopen.db(config.database.zelcash.database);

  const query = { height: { $gt: height } };
  const queryForAddresses = {}; // we need to remove those transactions in transactions field that have height greater than height
  const queryForAddressesDeletion = { transactions: { $exists: true, $size: 0 } };
  const projection = { $pull: { transactions: { height: { $gt: height } } } };

  // restore utxoDatabase
  await serviceHelper.removeDocumentsFromCollection(database, utxoIndexCollection, query).catch((error) => {
    log.error(error);
    throw error;
  });
  // restore addressTransactionIndex database
  // remove transactions with height bigger than our scanned height
  await serviceHelper.updateInDatabase(database, addressTransactionIndexCollection, queryForAddresses, projection).catch((error) => {
    log.error(error);
    throw error;
  });
  // remove addresses with 0 transactions
  await serviceHelper.removeDocumentsFromCollection(database, addressTransactionIndexCollection, queryForAddressesDeletion).catch((error) => {
    log.error(error);
    throw error;
  });
  // restore zelnodeTransactions database
  await serviceHelper.removeDocumentsFromCollection(database, zelnodeTransactionCollection, query).catch((error) => {
    log.error(error);
    throw error;
  });
  return true;
}

async function initiateBlockProcessor() {
  db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    log.error(error);
    throw error;
  });
  const database = db.db(config.database.zelcash.database);
  const query = {};
  const projection = {
    projection: {
      _id: 0,
      generalScannedHeight: 1,
    },
  };
  let scannedBlockHeight = 0;
  const scannedBlockHeightsResult = await serviceHelper.findInDatabase(database, scannedHeightCollection, query, projection).catch((error) => {
    log.error(error);
    throw error;
  });
  if (scannedBlockHeightsResult[0]) {
    scannedBlockHeight = scannedBlockHeightsResult[0].generalScannedHeight;
  }
  const zelcashGetInfo = await zelcashService.getInfo();
  let zelcashHeight = 0;
  if (zelcashGetInfo.status === 'success') {
    zelcashHeight = zelcashGetInfo.data.blocks;
  } else {
    log.error(zelcashGetInfo.data);
    throw new Error(zelcashGetInfo.data);
  }
  // get scanned height from our database;
  // get height from blockchain?
  if (scannedBlockHeight === 0) {
    console.log('dropping collections');
    const result = await serviceHelper.dropCollection(database, utxoIndexCollection).catch((error) => {
      if (error.message !== 'ns not found') {
        db.close();
        log.error(error);
        throw error;
      }
    });
    const resultB = await serviceHelper.dropCollection(database, addressTransactionIndexCollection).catch((error) => {
      if (error.message !== 'ns not found') {
        db.close();
        log.error(error);
        throw error;
      }
    });
    const resultC = await serviceHelper.dropCollection(database, zelnodeTransactionCollection).catch((error) => {
      if (error.message !== 'ns not found') {
        db.close();
        log.error(error);
        throw error;
      }
    });
    console.log(result, resultB, resultC);
    database.collection(utxoIndexCollection).createIndex({ txid: 1, voutIndex: 1 }, { name: 'query for getting utxo' });
    database.collection(utxoIndexCollection).createIndex({ address: 1 }, { name: 'query for addresses utxo' });
    database.collection(utxoIndexCollection).createIndex({ scriptPubKey: 1 }, { name: 'query for scriptPubKey utxo' });
    database.collection(addressTransactionIndexCollection).createIndex({ address: 1 }, { name: 'query for addresses transactions' });
    // database.collection(zelnodeTransactionCollection).createIndex({ ip: 1 }, { name: 'query for getting list of zelnode txs associated to IP address' });
  } else {
    const databaseRestored = await restoreDatabaseToBlockheightState(scannedBlockHeight);
    console.log(`Database restore status: ${databaseRestored}`);
    if (!databaseRestored) {
      log.error('Error restoring database!');
      throw new Error('Error restoring database!');
    }
  }
  if (zelcashHeight > scannedBlockHeight) {
    processBlock(scannedBlockHeight + 1);
  } else {
    db.close();
    setTimeout(() => {
      initiateBlockProcessor();
    }, 5000);
  }
}

async function getAllUtxos(req, res) {
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = dbopen.db(config.database.zelcash.database);
  const query = {};
  const projection = {
    projection: {
      _id: 0,
      txid: 1,
      voutIndex: 1,
      height: 1,
      address: 1,
      satoshis: 1,
      scriptPubKey: 1,
      coinbase: 1,
    },
  };
  const results = await serviceHelper.findInDatabase(database, utxoIndexCollection, query, projection).catch((error) => {
    dbopen.close();
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  dbopen.close();
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAllZelNodeTransactions(req, res) {
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = dbopen.db(config.database.zelcash.database);
  const query = {};
  const projection = {
    projection: {
      _id: 0,
      hex: 1,
      txid: 1,
      version: 1,
      type: 1,
      collateral_output: 1,
      sigtime: 1,
      sig: 1,
      ip: 1,
      update_type: 1,
      benchmark_tier: 1,
      benchmark_sigtime: 1,
      benchmark_sig: 1,
      collateral_pubkey: 1,
      zelnode_pubkey: 1,
      // blockhash: 0,
      height: 1,
      // confirmations: 0,
      // time: 0,
      // blocktime: 0,
    },
  };
  const results = await serviceHelper.findInDatabase(database, zelnodeTransactionCollection, query, projection).catch((error) => {
    dbopen.close();
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  dbopen.close();
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAllAddressesWithTransactions(req, res) {
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = dbopen.db(config.database.zelcash.database);
  const query = {};
  const projection = {
    projection: {
      _id: 0,
      transactions: 1,
      address: 1,
    },
  };
  const results = await serviceHelper.findInDatabase(database, addressTransactionIndexCollection, query, projection).catch((error) => {
    dbopen.close();
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  dbopen.close();
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAllAddresses(req, res) {
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = dbopen.db(config.database.zelcash.database);
  const query = {};
  const projection = {
    projection: {
      _id: 0,
      address: 1,
    },
  };
  const results = await serviceHelper.findInDatabase(database, addressTransactionIndexCollection, query, projection).catch((error) => {
    dbopen.close();
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  dbopen.close();
  const resMessage = serviceHelper.createDataMessage(results);
  return res.json(resMessage);
}

async function getAddressUtxos(req, res) {
  let { address } = req.params; // we accept both help/command and help?command=getinfo
  address = address || req.query.command || '';
  if (!address) {
    const errMessage = serviceHelper.createErrorMessage('No address provided');
    return res.json(errMessage);
  }
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = dbopen.db(config.database.zelcash.database);
  const query = { address };
  const projection = {
    projection: {
      _id: 0,
      txid: 1,
      voutIndex: 1,
      height: 1,
      address: 1,
      satoshis: 1,
      scriptPubKey: 1,
      coinbase: 1,
    },
  };
  const result = await serviceHelper.findOneInDatabase(database, utxoIndexCollection, query, projection).catch((error) => {
    dbopen.close();
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  dbopen.close();
  const resMessage = serviceHelper.createDataMessage(result);
  return res.json(resMessage);
}

async function getAddressTransactions(req, res) {
  let { address } = req.params; // we accept both help/command and help?command=getinfo
  address = address || req.query.command || '';
  if (!address) {
    const errMessage = serviceHelper.createErrorMessage('No address provided');
    return res.json(errMessage);
  }
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = dbopen.db(config.database.zelcash.database);
  const query = { address };
  const projection = {
    projection: {
      _id: 0,
      transactions: 1,
      address: 1,
    },
  };
  const result = await serviceHelper.findOneInDatabase(database, addressTransactionIndexCollection, query, projection).catch((error) => {
    dbopen.close();
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  dbopen.close();
  const resMessage = serviceHelper.createDataMessage(result);
  return res.json(resMessage);
}

async function getScannedHeight(req, res) {
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
  const database = db.db(config.database.zelcash.database);
  const query = { generalScannedHeight: { $gte: 0 } };
  const projection = {
    projection: {
      _id: 0,
      generalScannedHeight: 1,
    },
  };
  const result = await serviceHelper.findOneInDatabase(database, scannedHeightCollection, query, projection).catch((error) => {
    dbopen.close();
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    throw error;
  });
  dbopen.close();
  if (!result) {
    const errMessage = serviceHelper.createErrorMessage('Scanning not initiated');
    res.json(errMessage);
    throw new Error('Scanning not initiated');
  }
  const resMessage = serviceHelper.createDataMessage(result);
  return res.json(resMessage);
}

async function checkBlockProcessingStopping(i, callback) {
  if (blockProccessingCanContinue) {
    const succMessage = serviceHelper.createSuccessMessage('Block processing is stopped');
    callback(succMessage);
  } else {
    setTimeout(() => {
      const j = i + 1;
      if (j < 10) {
        checkBlockProcessingStopping(j, callback);
      } else {
        const errMessage = serviceHelper.createErrorMessage('Unknown error occured. Try again later.');
        callback(errMessage);
      }
    }, 1000);
  }
}

async function stopBlockProcessing(req, res) {
  const i = 0;
  blockProccessingCanContinue = false;
  checkBlockProcessingStopping(i, async (response) => {
    // put blockProccessingCanContinue status to true.
    res.json(response);
  });
}

async function restartBlockProcessing(req, res) {
  const i = 0;
  blockProccessingCanContinue = false;
  checkBlockProcessingStopping(i, async () => {
    blockProccessingCanContinue = true;
    initiateBlockProcessor();
    const message = serviceHelper.createSuccessMessage('Block processing initiated');
    res.json(message);
  });
}


async function reindexExplorer(req, res) {
  // stop block processing
  blockProccessingCanContinue = false;
  const i = 0;
  checkBlockProcessingStopping(i, async (response) => {
    if (response.status === 'error') {
      res.json(response);
    } else {
      const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
        const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
        log.error(errMessage);
        return res.json(errMessage);
      });
      const database = dbopen.db(config.database.zelcash.database);
      const resultOfDropping = await serviceHelper.dropCollection(database, scannedHeightCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          dbopen.close();
          log.error(error);
          const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
          res.json(errMessage);
        }
      });
      dbopen.close();
      if (resultOfDropping === true || resultOfDropping === undefined) {
        initiateBlockProcessor();
        const message = serviceHelper.createSuccessMessage('Explorer database reindex initiated');
        res.json(message);
      } else {
        const errMessage = serviceHelper.createErrorMessage(resultOfDropping, 'Collection dropping error');
        res.json(errMessage);
      }
    }
  });
}

async function rescanExplorer(req, res) {
  // since what blockheight
  let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
  blockheight = blockheight || req.query.command || '';
  if (!blockheight) {
    const errMessage = serviceHelper.createErrorMessage('No blockheight provided');
    res.json(errMessage);
  }
  // stop block processing
  blockProccessingCanContinue = false;
  const i = 0;
  if (blockheight) {
    checkBlockProcessingStopping(i, async (response) => {
      if (response.status === 'error') {
        res.json(response);
      } else {
        const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
          const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
          log.error(errMessage);
          return res.json(errMessage);
        });
        const scannedHeight = serviceHelper.ensureNumber(blockheight);
        // update scanned Height in scannedBlockHeightCollection
        const database = dbopen.db(config.database.zelcash.database);
        const query = { generalScannedHeight: { $gte: 0 } };
        const update = { $set: { generalScannedHeight: scannedHeight } };
        const options = { upsert: true };
        await serviceHelper.findOneAndUpdateInDatabase(database, scannedHeightCollection, query, update, options).catch((error) => {
          dbopen.close();
          log.error(error);
          const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
          return res.json(errMessage);
        });
        dbopen.close();
        initiateBlockProcessor();
        const message = serviceHelper.createSuccessMessage(`Explorer rescan from blockheight ${blockheight} initiated`);
        res.json(message);
      }
    });
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
  getAllZelNodeTransactions,
  getAddressUtxos,
  getAddressTransactions,
  getScannedHeight,
};
