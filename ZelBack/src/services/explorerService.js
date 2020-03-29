const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');

const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

const utxoIndexCollection = config.database.zelcash.collections.utxoIndex;
const transactionIndexCollection = config.database.zelcash.collections.transactionIndex;
const addressIndexCollection = config.database.zelcash.collections.addressIndex;
const scannedHeightCollection = config.database.zelcash.collections.scannedHeight;
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

  const sender = txContent.vout;
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
    await Promise.all(txContent.data.vout.map(async (vout, index) => {
      // we need only txid, vout and height. voutIndex is used for identification too.
      const utxoDetail = {
        txid: txContent.data.txid,
        voutIndex: index,
        vout,
        height: txContent.data.height,
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
    console.log('dropping collection');
    const result = await serviceHelper.dropCollection(database, utxoIndexCollection).catch((error) => {
      if (error.message !== 'ns not found') {
        db.close();
        log.error(error);
        throw error;
      }
    });
    console.log(result);
    database.collection(utxoIndexCollection).createIndex({ txid: 1, voutIndex: 1 }, { name: 'query for getting utxo' });
    database.collection(utxoIndexCollection).createIndex({ txid: 1 }, { name: 'query for utxos for specific txid' });
    database.collection(utxoIndexCollection).createIndex({ height: 1 }, { name: 'query for utxos created on specific height' });
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
  // now we have verbose transactions of the block extended for senders (vout type). So we go through senders (basically better vin) and vout.
  // and can create addressIndex.
  if (blockData.height % 1000 === 0) {
    console.log(transactions);
  }
  if (blockHeight % 5000 === 0) {
    const database = db.db(config.database.zelcash.database);
    const result = await serviceHelper.collectionStats(database, utxoIndexCollection).catch((error) => {
      db.close();
      log.error(error);
      throw error;
    });
    console.log(result);
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
