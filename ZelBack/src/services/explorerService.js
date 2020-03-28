const config = require('config');

const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const zelcashService = require('./zelcashService');

const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

const transactionIndexCollection = config.database.zelcash.collections.transactionIndex;
const addressIndexCollection = config.database.zelcash.collections.addressIndex;
const scannedHeightCollection = config.database.zelcash.collections.scannedHeight;

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
  // prepare database
  const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    log.error(error);
    throw error;
  });
  const database = db.db(config.database.zelcash.database);
  const query = { txid };
  const projection = {};
  const txContent = await serviceHelper.findOneInDatabase(database, transactionIndexCollection, query, projection).catch((error) => {
    log.error(error);
    throw error;
  });
  db.close();
  if (!txContent) {
    const errMessage = serviceHelper.createErrorMessage(`Transaction ${txid} not found in database`);
    throw errMessage;
  }
  const sender = txContent.vout[vout];
  return sender;
}

async function getTransaction(hash) {
  // prepare database
  const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
    log.error(error);
    throw error;
  });
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
    // put tarnsaction to our mongoDB transactionIndex.
    await serviceHelper.insertOneToDatabase(database, transactionIndexCollection, transactionDetail).catch((error) => {
      log.error(error);
      throw error;
    });
    db.close();
    // fetch senders from our mongoDatabase
    const sendersToFetch = [];
    if (transactionDetail.version < 5 && transactionDetail.version > 0) {
      transactionDetail.vin.forEach((vin) => {
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
    const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      log.error(error);
      throw error;
    });
    const database = db.db(config.database.zelcash.database);
    console.log('dropping collection');
    const result = await serviceHelper.dropCollection(database, transactionIndexCollection).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
        throw error;
      }
    });
    console.log(result);
    database.collection(transactionIndexCollection).createIndex({ txid: 1 });
    db.close();
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
  if (blockData.height % 1000 === 0) {
    console.log(transactions);
  }
  if (blockHeight === 3000) {
    const db = await serviceHelper.connectMongoDb(mongoUrl).catch((error) => {
      log.error(error);
      throw error;
    });
    const database = db.db(config.database.zelcash.database);
    const result = await serviceHelper.collectionStats(database, transactionIndexCollection).catch((error) => {
      log.error(error);
      throw error;
    });
    console.log(result);
    db.close();
  }
  if (blockData.height < 5000) {
    processBlock(blockData.height + 1);
  }
}

module.exports = {
  processBlock,
};
