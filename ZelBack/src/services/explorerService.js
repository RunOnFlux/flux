const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');
const zelappsService = require('./zelappsService');

const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

const utxoIndexCollection = config.database.zelcash.collections.utxoIndex;
const zelappsHashesCollection = config.database.zelcash.collections.zelappsHashes;
const addressTransactionIndexCollection = config.database.zelcash.collections.addressTransactionIndex;
const scannedHeightCollection = config.database.zelcash.collections.scannedHeight;
const zelnodeTransactionCollection = config.database.zelcash.collections.zelnodeTransactions;
let db = null;
let blockProccessingCanContinue = true;

function getCollateralHash(hexOfZelNodeTx) {
  const hex = hexOfZelNodeTx.slice(10, 74);
  const buf = Buffer.from(hex, 'hex').reverse();
  return buf.toString('hex');
}

function getCollateralIndex(hexOfZelNodeTx) {
  const hex = hexOfZelNodeTx.slice(74, 82);
  const buf = Buffer.from(hex, 'hex').reverse();
  return parseInt(buf.toString('hex'), 16);
}

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

async function getSenderWithoutDelete(txid, vout) {
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
      satoshis: 1,
      // scriptPubKey: 1,
      // coinbase: 1,
    },
  };

  // find the utxo from global utxo list
  const txContent = await serviceHelper.findOneInDatabase(database, utxoIndexCollection, query, projection).catch((error) => {
    db.close();
    log.error(error);
    throw error;
  });
  if (!txContent) {
    // we are spending it anyway so it wont affect users balance
    log.info(`Transaction ${txid} ${vout} not found in database. Falling back to blockchain data`);
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
      satoshis: senderData.valueSat,
      // scriptPubKey: senderData.scriptPubKey.hex,
    };
    return zelcashTxContent;
  }
  const sender = txContent;
  return sender;
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
    log.info(`Transaction ${txid} ${vout} not found in database. Falling back to blockchain data`);
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
    // get Block information
    const blockData = await getBlock(blockHeight).catch((error) => {
      throw error;
    });
    if (blockData.height % 50 === 0) {
      console.log(blockData.height);
    }
    // get Block transactions information
    const transactions = await getBlockTransactions(blockData.tx).catch((error) => {
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
        let message = '';
        const addresses = [];
        tx.senders.forEach((sender) => {
          addresses.push(sender.address);
        });
        tx.vout.forEach((receiver) => {
          if (receiver.scriptPubKey.addresses) { // count for messages
            addresses.push(receiver.scriptPubKey.addresses[0]);
          }
          if (receiver.scriptPubKey.asm) {
            message = decodeMessage(receiver.scriptPubKey.asm); // TODO adding messages to database so we can then get all messages from blockchain
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
            throw error;
          });
        }));
        // MAY contain ZelApp transaction. Store it.
        if (addressesOK.indexOf(config.zelapps.address) > -1 && message.length === 64) { // todo sha256 hash length
          const zelappTxRecord = { txid: tx.txid, height: tx.height, zelapphash: message };
          zelappsService.checkAndRequestZelApp(message);
          await serviceHelper.insertOneToDatabase(database, zelappsHashesCollection, zelappTxRecord).catch((error) => {
            db.close();
            throw error;
          });
        }
      }
      // tx version 5 are zelnode transactions. Put them into zelnode
      if (tx.version === 5) {
        // todo. We can get an address from getSender method too as that utxo was not spent yet.
        const collateralHash = getCollateralHash(tx.hex);
        const collateralIndex = getCollateralIndex(tx.hex);
        const senderInfo = await getSenderWithoutDelete(collateralHash, collateralIndex);
        const zelnodeTxData = {
          txid: tx.txid,
          version: tx.version,
          type: tx.type,
          updateType: tx.update_type,
          ip: tx.ip,
          benchTier: tx.benchmark_tier,
          collateralHash,
          collateralIndex,
          zelAddress: senderInfo.address,
          lockedAmount: senderInfo.satoshis,
          height: tx.height,
        };
        await serviceHelper.insertOneToDatabase(database, zelnodeTransactionCollection, zelnodeTxData).catch((error) => {
          db.close();
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
        throw error;
      });
      const resultB = await serviceHelper.collectionStats(database, addressTransactionIndexCollection).catch((error) => {
        db.close();
        throw error;
      });
      const resultC = await serviceHelper.collectionStats(database, zelnodeTransactionCollection).catch((error) => {
        db.close();
        throw error;
      });
      log.info('UTXO', result.size, result.count, result.avgObjSize);
      log.info('ADDR', resultB.size, resultB.count, resultB.avgObjSize);
      log.info('ZELNODE', resultC.size, resultC.count, resultC.avgObjSize);
    }
    const scannedHeight = blockData.height;
    // update scanned Height in scannedBlockHeightCollection
    const database = db.db(config.database.zelcash.database);
    const query = { generalScannedHeight: { $gte: 0 } };
    const update = { $set: { generalScannedHeight: scannedHeight } };
    const options = { upsert: true };
    await serviceHelper.findOneAndUpdateInDatabase(database, scannedHeightCollection, query, update, options).catch((error) => {
      db.close();
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
            initiateBlockProcessor(false);
          } else {
            blockProccessingCanContinue = true;
          }
        }, 5000);
      }
    } else {
      db.close();
      blockProccessingCanContinue = true;
    }
  } catch (error) {
    log.error('Block processor encountered an error.');
    log.error(error);
    setImmediate(() => {
      log.info('Reinitiating Block Processing');
      // eslint-disable-next-line no-use-before-define
      initiateBlockProcessor(true);
    }, 3 * 60 * 1000);
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

  // restore utxoDatabase collection
  await serviceHelper.removeDocumentsFromCollection(database, utxoIndexCollection, query).catch((error) => {
    log.error(error);
    throw error;
  });
  // restore addressTransactionIndex collection
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
  // restore zelnodeTransactions collection
  await serviceHelper.removeDocumentsFromCollection(database, zelnodeTransactionCollection, query).catch((error) => {
    log.error(error);
    throw error;
  });
  // restore zelappsHashes collection
  await serviceHelper.removeDocumentsFromCollection(database, zelappsHashesCollection, query).catch((error) => {
    log.error(error);
    throw error;
  });
  return true;
}

async function initiateBlockProcessor(restoreDatabase) {
  try {
    db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
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
      throw new Error(zelcashGetInfo.data);
    }
    // get scanned height from our database;
    // get height from blockchain?
    if (scannedBlockHeight === 0) {
      console.log('dropping collections');
      const result = await serviceHelper.dropCollection(database, utxoIndexCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          db.close();
          throw error;
        }
      });
      const resultB = await serviceHelper.dropCollection(database, addressTransactionIndexCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          db.close();
          throw error;
        }
      });
      const resultC = await serviceHelper.dropCollection(database, zelnodeTransactionCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          db.close();
          throw error;
        }
      });
      const resultD = await serviceHelper.dropCollection(database, zelappsHashesCollection).catch((error) => {
        if (error.message !== 'ns not found') {
          db.close();
          throw error;
        }
      });
      console.log(result, resultB, resultC, resultD);
      database.collection(utxoIndexCollection).createIndex({ txid: 1, voutIndex: 1 }, { name: 'query for getting utxo' });
      database.collection(utxoIndexCollection).createIndex({ address: 1 }, { name: 'query for addresses utxo' });
      database.collection(utxoIndexCollection).createIndex({ scriptPubKey: 1 }, { name: 'query for scriptPubKey utxo' });
      database.collection(addressTransactionIndexCollection).createIndex({ address: 1 }, { name: 'query for addresses transactions' });
      database.collection(zelnodeTransactionCollection).createIndex({ ip: 1 }, { name: 'query for getting list of zelnode txs associated to IP address' });
      database.collection(zelnodeTransactionCollection).createIndex({ zelAddress: 1 }, { name: 'query for getting list of zelnode txs associated to ZEL address' });
      database.collection(zelnodeTransactionCollection).createIndex({ tier: 1 }, { name: 'query for getting list of zelnode txs according to benchmarking tier' });
      database.collection(zelnodeTransactionCollection).createIndex({ type: 1 }, { name: 'query for getting all zelnode txs according to type of transaction' });
      database.collection(zelnodeTransactionCollection).createIndex({ collateralHash: 1, collateralIndex: 1 }, { name: 'query for getting list of zelnode txs associated to specific collateral' });
      database.collection(zelappsHashesCollection).createIndex({ txid: 1 }, { name: 'query for getting txid' });
      database.collection(zelappsHashesCollection).createIndex({ height: 1 }, { name: 'query for getting height' });
      database.collection(zelappsHashesCollection).createIndex({ zelapphash: 1 }, { name: 'query for getting zelapphash' });
    }
    if (zelcashHeight > scannedBlockHeight) {
      if (zelcashHeight === config.zelapps.epochstart) {
        // needed to create index on nodes not syncing from scratch. Remove after zelapps epoch start passes.
        database.collection(zelappsHashesCollection).createIndex({ txid: 1 }, { name: 'query for getting txid' });
        database.collection(zelappsHashesCollection).createIndex({ height: 1 }, { name: 'query for getting height' });
        database.collection(zelappsHashesCollection).createIndex({ zelapphash: 1 }, { name: 'query for getting zelapphash' });
      }
      if (scannedBlockHeight !== 0 && restoreDatabase) {
        try {
          await restoreDatabaseToBlockheightState(scannedBlockHeight);
          log.info('Database restored OK');
        } catch (e) {
          log.error('Error restoring database!');
          throw e;
        }
      }
      processBlock(scannedBlockHeight + 1);
    } else {
      db.close();
      setTimeout(() => {
        initiateBlockProcessor(false);
      }, 5000);
    }
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      initiateBlockProcessor(true);
    }, 15 * 60 * 1000);
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
  address = address || req.query.address;
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
    const errMessage = serviceHelper.createErrorMessage('It is possible to only filter via IP address, Zel address and Collateral hash.');
    return res.json(errMessage);
  }
  const dbopen = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
    res.json(errMessage);
    log.error(error);
    throw error;
  });
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

async function getAddressTransactions(req, res) {
  let { address } = req.params; // we accept both help/command and help?command=getinfo
  address = address || req.query.address;
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
  const database = dbopen.db(config.database.zelcash.database);
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
  const authorized = await serviceHelper.verifyPrivilege('zelteam', req);
  if (authorized === true) {
    const i = 0;
    blockProccessingCanContinue = false;
    checkBlockProcessingStopping(i, async (response) => {
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
    blockProccessingCanContinue = false;
    checkBlockProcessingStopping(i, async () => {
      blockProccessingCanContinue = true;
      initiateBlockProcessor(true);
      const message = serviceHelper.createSuccessMessage('Block processing initiated');
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
          initiateBlockProcessor(true);
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
  const authorized = true; // await serviceHelper.verifyPrivilege('zelteam', req);
  if (authorized === true) {
    // since what blockheight
    let { blockheight } = req.params; // we accept both help/command and help?command=getinfo
    blockheight = blockheight || req.query.blockheight;
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
          initiateBlockProcessor(true);
          const message = serviceHelper.createSuccessMessage(`Explorer rescan from blockheight ${blockheight} initiated`);
          res.json(message);
        }
      });
    }
  } else {
    const errMessage = serviceHelper.errUnauthorizedMessage();
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
      // txid: 1,
      // voutIndex: 1,
      // height: 1,
      // address: 1,
      satoshis: 1,
      // scriptPubKey: 1,
      // coinbase: 1,
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
