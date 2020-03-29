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

// async function getSender(txid, vout) {
//   const verbose = 1;

//   const req = {
//     params: {
//       txid,
//       verbose,
//     },
//   };
//   const txContent = await zelcashService.getRawTransaction(req);
//   if (txContent.status === 'success') {
//     const sender = txContent.data.vout[vout];
//     return sender;
//   }
//   throw txContent.data;
// }

async function getSender(txid, vout) {
  const database = db.db(config.database.zelcash.database);
  const query = { $and: [{ txid }, { voutIndex: vout }] };
  const projection = {};
  // find the utxo so we know the sender
  const txContent = await serviceHelper.findOneInDatabase(database, utxoIndexCollection, query, projection).catch((error) => {
    db.close();
    log.error(error);
    throw error;
  });
  if (!txContent) {
    const errMessage = serviceHelper.createErrorMessage(`Transaction ${txid} not found in database`);
    throw errMessage;
  }
  // delete the utxo from global utxo list
  await serviceHelper.findOneAndDeleteInDatabase(database, utxoIndexCollection, query, projection).catch((error) => {
    db.close();
    log.error(error);
    throw error;
  });

  const sender = txContent;
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
    // if transaction has no vouts, it cannot be an utxo. Do not store it.
    await Promise.all(transactionDetail.vout.map(async (vout, index) => {
      // we need only utxo related information
      const utxoDetail = {
        txid: txContent.data.txid,
        voutIndex: index,
        height: txContent.data.height,
        address: vout.scriptPubKey.addresses[0],
        satoshis: vout.valueSat,
        scriptPubKey: vout.scriptPubKey.hex,
      };
      // put the utxo to our mongoDB utxoIndex collection.
      await serviceHelper.insertOneToDatabase(database, utxoIndexCollection, utxoDetail).catch((error) => {
        db.close();
        log.error(error);
        throw error;
      });
    }));

    // fetch senders from our mongoDatabase
    const sendersToFetch = [];
    if (txContent.data.version < 5 && txContent.data.version > 0) {
      txContent.data.vin.forEach((vin) => {
        if (!vin.coinbase) {
          // we need an address who sent those coins and amount of it.
          sendersToFetch.push(vin);
        }
      });
    }
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
  if (blockHeight === 1) {
    db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      log.error(error);
      throw error;
    });
    const database = db.db(config.database.zelcash.database);
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
    const resultD = await serviceHelper.dropCollection(database, scannedHeightCollection).catch((error) => {
      if (error.message !== 'ns not found') {
        db.close();
        log.error(error);
        throw error;
      }
    });
    console.log(result, resultB, resultC, resultD);
    database.collection(utxoIndexCollection).createIndex({ txid: 1, voutIndex: 1 }, { name: 'query for getting utxo' });
    database.collection(utxoIndexCollection).createIndex({ address: 1 }, { name: 'query for addresses utxo' });
    database.collection(utxoIndexCollection).createIndex({ scriptPubKey: 1 }, { name: 'query for scriptPubKey utxo' });
    // below is not needed but may be some day
    // database.collection(utxoIndexCollection).createIndex({ txid: 1 }, { name: 'query for utxos for specific txid' });
    // database.collection(utxoIndexCollection).createIndex({ height: 1 }, { name: 'query for utxos created on specific height' });
    // database.collection(zelnodeTransactionCollection).createIndex({ ip: 1 }, { name: 'query for getting list of zelnode txs associated to IP address' });
  }

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
        addresses.push(receiver.scriptPubKey.addresses[0]);
      });
      const addressesOK = [...new Set(addresses)];
      const transactionRecord = { txid: tx.txid, height: tx.height };
      // update addresses from addressesOK array in our database. We need blockheight there too. transac
      await Promise.all(addressesOK.map(async (address) => {
        const query = { address };
        const projection = {};
        const existingAddressRecord = await serviceHelper.findOneInDatabase(database, addressTransactionIndexCollection, query, projection).catch((error) => {
          db.close();
          log.error(error);
          throw error;
        });
        if (existingAddressRecord) {
          const txRecords = existingAddressRecord.transactions;
          txRecords.push(transactionRecord);
          const newValue = {
            address,
            transactions: txRecords,
          };
          await serviceHelper.updateOneInDatabase(database, addressTransactionIndexCollection, query, newValue).catch((error) => {
            db.close();
            log.error(error);
            throw error;
          });
          if (tx.height % 101 === 0) {
            console.log(existingAddressRecord);
          }
        } else {
          const value = {
            address,
            transactions: [transactionRecord],
          };
          await serviceHelper.insertOneToDatabase(database, addressTransactionIndexCollection, value).catch((error) => {
            db.close();
            log.error(error);
            throw error;
          });
        }
      }));
    }
    // tx version 5 are zelnode transactions. Put them into zelnode
    if (tx.version === 5) {
      // todo. We can get an address from getSender method too as that utxo was not spent yet.
    }
  }));
  // addressTransactionIndex shall contains object of address: address, transactions: [txids]
  if (blockData.height % 999 === 0) {
    console.log(transactions);
  }
  if (blockHeight % 5000 === 0) {
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
    console.log(result);
    console.log(resultB);
  }
  if (blockData.height < 100000) {
    processBlock(blockData.height + 1);
  } else {
    db.close();
  }
}

module.exports = {
  processBlock,
};
