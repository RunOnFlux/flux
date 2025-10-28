const log = require('../lib/log');

/**
 * @module Helper module used for all interactions with database
 */

const mongodb = require('mongodb');
const config = require('config');

const { MongoClient } = mongodb;
const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

/**
 * @type {mongodb.MongoClient}
 */
let openDBConnection = null;

/**
 * Returns MongoDB connection, if it was initiated before, otherwise returns null.
 *
 * @returns {mongodb.MongoClient | null}
 */
function databaseConnection() {
  return openDBConnection;
}

/**
 * Initiates connection with the database.
 *
 * @param {string} [url]
 *
 * @returns {Promise<mongodb.MongoClient>}
 */
async function connectMongoDb(url) {
  const connectUrl = url || mongoUrl;
  const mongoSettings = {
    maxPoolSize: 100,
  };
  const client = await MongoClient.connect(connectUrl, mongoSettings);
  return client;
}

/**
 * Initiates default db connection.
 * @returns true
 */
async function initiateDB() {
  if (!openDBConnection) openDBConnection = await connectMongoDb();
  return true;
}

/**
 * Closes DB connection if exists.
 */
async function closeDbConnection() {
  if (openDBConnection) {
    await openDBConnection.close();
    openDBConnection = null;
  }
}

/**
 * Returns an array of distinct values in a given collection.
 *
 * @param {string} database
 * @param {string} collection
 * @param {string} distinct - field name
 * @param {object} [query]
 *
 * @returns array
 */
async function distinctDatabase(database, collection, distinct, query) {
  const results = await database.collection(collection).distinct(distinct, query);
  return results;
}

/**
 * Returns array of documents from the DB based on the query and the projection.
 *
 * @param {mongodb.Db} database
 * @param {string} collection
 * @param {object} query
 * @param {object} options
 *
 * @returns {Promise<Arrray>}
 */
async function findInDatabase(database, collection, query = {}, options = {}) {
  const results = await database.collection(collection).find(query, options).toArray();
  return results;
}

/**
 * Returns either a db cursor or array of documents based on pipeline aggregate.
 *
 * @param {mongodb.Db} database
 * @param {string} collection
 * @param {Array<Object>} pipeline
 * @param {{returnArray?: boolean}} options
 *
 * @returns {Promise<mongodb.AggregationCursor | Array>}
 */
async function aggregateInDatabase(database, collection, pipeline, options = {}) {
  const returnArray = options.returnArray ?? true;

  const dbCursor = database.collection(collection).aggregate(pipeline);

  const returnValue = returnArray ? await dbCursor.toArray() : dbCursor;

  return returnValue;
}

/**
 * Returns document from the DB based on the query and the projection.
 *
 * @param {mongodb.Db} database
 * @param {string} collection
 * @param {Object} query
 * @param {Object} projection
 * @returns {Object}
 */
async function findOneInDatabase(database, collection, query = {}, projection = {}) {
  const result = await database.collection(collection).findOne(query, projection);
  return result;
}

/**
 * Executes bulkwrite operations on database.
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} operations
 * @returns void
 */
async function bulkWriteInDatabase(database, collection, operations) {
  if (!operations || operations.length === 0) {
    return {
      insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0,
    };
  }
  const result = await database.collection(collection).bulkWrite(operations);
  return result;
}

/**
 * Updates document from the DB based on the query and update operators and returns it.
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} query
 * @param {object} update - must contain only update operator expressions
 * @param {object} [options] - {
     projection: {document},
     sort: {document},
     maxTimeMS: {number},
     upsert: {boolean},
     returnNewDocument: {string} - 'before' / 'after',
     collation: {document},
     arrayFilters: [ {filterdocument1}, ... ]
   }
 *
 * @returns document
 */
async function findOneAndUpdateInDatabase(database, collection, query, update, options) {
  const passedOptions = options || {};
  const result = await database.collection(collection).findOneAndUpdate(query, update, passedOptions);
  return result;
}

/**
 * Counts document from the DB based on the query
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} query
 *
 * @returns count of documents
 */
async function countInDatabase(database, collection, query) {
  const result = await database.collection(collection).countDocuments(query);
  return result;
}

/**
 * Inserts one document into the database, into a specific collection.
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} value
 *
 * @returns document
 */
async function insertOneToDatabase(database, collection, value) {
  const result = await database.collection(collection).insertOne(value).catch((error) => {
    if (!(error.message && error.message.includes('duplicate key'))) {
      throw error;
    }
  });
  return result;
}

/**
 * Inserts array of documents into the database.
 *
 * @param {string} database
 * @param {string} collection
 * @param {array} values
 * @param {object} [options]
 *
 * @returns object
 */
async function insertManyToDatabase(database, collection, values, options = {}) {
  const result = await database.collection(collection).insertMany(values, options).catch((error) => {
    if (!(error.message && error.message.includes('duplicate key'))) {
      throw error;
    }
  });
  return result;
}

/**
 * Updates document from the DB based on the query and update operators.
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} query
 * @param {object} update
 * @param {object} [options]
 *
 * @returns object
 */
async function updateOneInDatabase(database, collection, query, update, options) {
  const passedOptions = options || {};
  const result = await database.collection(collection).updateOne(query, update, passedOptions);
  return result;
}

/**
 * Updates many documents in the collection
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} query
 * @param {object} updateFilter
 *
 * @returns object
 */
async function updateInDatabase(database, collection, query, updateFilter) {
  const result = await database.collection(collection).updateMany(query, updateFilter);
  return result;
}

/**
 * Deletes and returns a document based on query and projection
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} query
 * @param {object} [projection]
 *
 * @returns object
 */
async function findOneAndDeleteInDatabase(database, collection, query, projection) {
  const result = await database.collection(collection).findOneAndDelete(query, projection);
  return result;
}

/**
 * Deletes many documents from the collection.
 * To remove all documents from a collection pass an empty object as a query.
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} query
 *
 * @returns object
 */
async function removeDocumentsFromCollection(database, collection, query) {
  const result = await database.collection(collection).deleteMany(query);
  return result;
}

/**
 * Drops the whole collection.
 *
 * @param {string} database
 * @param {string} collection
 *
 * @returns object
 */
async function dropCollection(database, collection) {
  const result = await database.collection(collection).drop();
  return result;
}

/**
 * Returns collection statistics
 *
 * @param {string} database
 * @param {string} collection
 *
 * @returns object
 */
async function collectionStats(database, collection) {
  try {
    // In MongoDB v4+, use $collStats aggregation instead of .stats()
    const result = await database.collection(collection).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
    if (result[0] && result[0].storageStats) {
      const stats = result[0].storageStats;
      // Add namespace manually for compatibility with old tests
      stats.ns = `${database.databaseName}.${collection}`;
      return stats;
    }
    // Return compatible empty structure for non-existent collections
    return {
      ns: `${database.databaseName}.${collection}`,
      count: 0,
      avgObjSize: undefined,
    };
  } catch (error) {
    // Fallback for older MongoDB versions or if collection doesn't exist
    return {
      ns: `${database.databaseName}.${collection}`,
      count: 0,
      avgObjSize: undefined,
    };
  }
}

async function findValueSatNanInAppsMessages() {
  const {
    database: {
      appsglobal: {
        database: dbName, collections: { appsMessages: collectionName },
      },
    },
  } = config;

  const client = databaseConnection();
  const db = client.db(dbName);
  const query = { valueSat: NaN };
  const options = { projection: { _id: 0, hash: 1 } };

  const result = await findInDatabase(db, collectionName, query, options);

  // ToDo: Fix the db helper so this is configurable
  const brokenMessageHashes = result.map((item) => item.hash);

  return brokenMessageHashes;
}

async function findValueSatInAppsHashes() {
  const {
    database: {
      daemon: {
        database: dbName, collections: { appsHashes: collectionName },
      },
    },
  } = config;

  const client = databaseConnection();
  const db = client.db(dbName);
  const query = {};
  const options = { projection: { _id: 0, hash: 1, value: 1 } };

  const results = await findInDatabase(db, collectionName, query, options);

  const hashToValueMap = new Map();

  results.forEach((result) => {
    hashToValueMap.set(result.hash, result.value);
  });

  return hashToValueMap;
}

async function updateValueSatInAppsMessages(brokenHashes, hashMap) {
  const {
    database: {
      appsglobal: {
        database: dbName, collections: { appsMessages: collectionName },
      },
    },
  } = config;

  const client = databaseConnection();
  const db = client.db(dbName);

  const updateChunk = async (hashes) => {
    const operations = [];

    hashes.forEach((hash) => {
      const valueSat = hashMap.get(hash);

      if (valueSat) {
        const operation = {
          updateOne: {
            filter: { hash },
            update: { $set: { valueSat } },
            upsert: true,
          },
        };

        operations.push(operation);
      }
    });

    await bulkWriteInDatabase(db, collectionName, operations);
  };

  const hashCount = brokenHashes.length;
  const chunkSize = 5000;
  let startIndex = 0;
  let endIndex = Math.min(chunkSize, hashCount);

  while (startIndex < hashCount) {
    const chunk = brokenHashes.slice(startIndex, endIndex);
    // eslint-disable-next-line no-await-in-loop
    await updateChunk(chunk);

    startIndex = endIndex;
    endIndex += chunk.length;
  }
}

async function repairNanInAppsMessagesDb() {
  const brokenHashes = await findValueSatNanInAppsMessages();

  if (!brokenHashes.length) return;

  const hashMap = await findValueSatInAppsHashes();

  await updateValueSatInAppsMessages(brokenHashes, hashMap);
}

/**
 *
 * @param {mongodb.Db} appsGlobalDb
 * @param {string} appsMessagesCol mongo collection name
 * @param {string} appsInformationCol mongo collection name
 * @param {number} scannedHeight
 * @returns {Promise<boolean>}
 */
async function isReindexAppsInformationRequired(
  appsGlobalDb,
  appsMessagesCol,
  appsInformationCol,
  scannedHeight,
) {
  const appsMessagesPipeline = [
    { $sort: { 'appSpecifications.name': 1, height: -1 } },
    {
      $group: {
        _id: '$appSpecifications.name',
        maxHeightMsg: { $first: '$$ROOT' },
      },
    },
    {
      $match: {
        $expr: {
          $gt: [
            {
              $add: [
                '$maxHeightMsg.height',
                {
                  $ifNull: [
                    '$maxHeightMsg.appSpecifications.expire',
                    {
                      $cond: {
                        if: { $gte: ['$maxHeightMsg.height', config.fluxapps.daemonPONFork] },
                        then: 88000,
                        else: 22000,
                      },
                    },
                  ],
                },
              ],
            },
            scannedHeight,
          ],
        },
      },
    },
    {
      $count: 'count',
    },
  ];

  const appsInformationPipeline = [
    {
      $set: {
        expireHeight: {
          $add: [
            '$height',
            {
              $ifNull: [
                '$expire',
                {
                  $cond: {
                    if: { $gte: ['$height', config.fluxapps.daemonPONFork] },
                    then: 88000,
                    else: 22000,
                  },
                },
              ],
            },
          ],
        },
      },
    },
    {
      $match: {
        expireHeight: { $gt: scannedHeight },
      },
    },
    {
      $count: 'count',
    },
  ];

  try {
    await appsGlobalDb
      .collection(appsMessagesCol)
      .createIndex(
        {
          'appSpecifications.name': 1,
          height: -1,
        },
        { name: 'sortAppMessagesForGroupBy' },
      );

    const messagesCursor = await aggregateInDatabase(
      appsGlobalDb,
      appsMessagesCol,
      appsMessagesPipeline,
      { returnArray: false },
    );
    const informationCursor = await aggregateInDatabase(
      appsGlobalDb,
      appsInformationCol,
      appsInformationPipeline,
      { returnArray: false },
    );

    const appsFromMessages = await messagesCursor.next();
    const appsFromInformation = await informationCursor.next();

    if (!appsFromMessages) {
      log.warning('No apps from apps messages found, unable to validate apps information');
      return false;
    }

    if (!appsFromInformation) {
      log.info('No apps information apps found, reindexing colleciton');
      return true;
    }

    log.info(
      `Apps reindex validation. Found ${appsFromMessages.count} apps from appsMessages.`
      + ` Found ${appsFromInformation.count} apps from appsInformation`,
    );

    const reindexRequired = appsFromMessages.count !== appsFromInformation.count;

    return reindexRequired;
  } catch (err) {
    log.error(`isReindexAppsInformationRequired - Mongodb Error: ${err}`);
    return false;
  }
}

/**
 * Rebuilds the appsInformation collection from a dbCursor containing the appropriate
 * preformed records.
 * @param {mongodb.AggregationCursor} appsDbCursor
 * @param {mongodb.Db} globalDb
 * @param {mongodb.Db} localDb
 * @param {string} globalAppsInformationCol mongo collection name
 * @param {string} localAppsInformationCol mongo collection name
 * @returns {Promise<Array<string>} Any installed app (by name) that need to be removed
 */
async function syncAppsInformationCollection(
  appsDbCursor,
  globalDb,
  localDb,
  globalAppsInformationCol,
  localAppsInformationCol,
) {
  const installedAppsArray = await findInDatabase(
    localDb,
    localAppsInformationCol,
  );
  const installedApps = new Set(installedAppsArray.map((app) => app.name));

  const insertChunk = async (appInfos) => {
    await insertManyToDatabase(
      globalDb,
      globalAppsInformationCol,
      appInfos,
    );
  };

  const chunkSize = 500;
  const appInfoChunk = [];

  // eslint-disable-next-line no-restricted-syntax
  for await (const appInfo of appsDbCursor) {
    appInfoChunk.push(appInfo);

    if (installedApps.has(appInfo.name)) installedApps.delete(appInfo.name);

    if (appInfoChunk.length >= chunkSize) {
      await insertChunk(appInfoChunk);
      appInfoChunk.length = 0;
    }
  }

  if (appInfoChunk.length) await insertChunk(appInfoChunk);

  return Array.from(installedApps);
}

// NOTE: The reindexGlobalAppsInformation function has been moved to registryManager.js
// as part of the modularization effort.

/**
 * Verifies the app count based on an aggregation from appsmessages and compares it to the
 * app count in appsinformation. If they differ - the appsinformation collection is dropped and
 * rebuilt from the appsmessages. The entire process takes about 500-700ms.
 * @returns {Promise<{validated: boolean, reindexed: boolean, appsToRemove: Array<string>}>}
 */
async function validateAppsInformation() {
  const response = { validated: false, reindexed: false, appsToRemove: [] };

  const {
    database: {
      appsglobal: {
        database: appsGlobalDbName,
        collections: {
          appsInformation: globalAppsInformationCol,
          appsMessages: globalAppsMessagesCol,
        },
      },
      appslocal: {
        database: appsLocalDbName,
        collections: {
          appsInformation: localAppsInformationCol,
        },
      },
      daemon: {
        database: daemonDbName,
        collections: { scannedHeight: scannedHeightCol },
      },
    },
  } = config;

  const client = databaseConnection();

  if (!client) {
    log.warn('Unable to validate apps information collection, no client');
    return response;
  }

  try {
    const appsGlobalDb = client.db(appsGlobalDbName);
    const appsLocalDb = client.db(appsLocalDbName);
    const daemonDb = client.db(daemonDbName);

    const scannedHeightResult = await findOneInDatabase(
      daemonDb,
      scannedHeightCol,
    );
    const { generalScannedHeight: scannedHeight = null } = scannedHeightResult;

    if (!scannedHeight) return response;

    const reindexRequired = await isReindexAppsInformationRequired(
      appsGlobalDb,
      globalAppsMessagesCol,
      globalAppsInformationCol,
      scannedHeight,
    );

    log.info(`validateAppsInformation reindexRequired: ${reindexRequired}`);

    if (!reindexRequired) {
      response.validated = true;
      return response;
    }

    // Use the new registryManager reindexGlobalAppsInformation function
    // Import registryManager here to avoid circular dependency
    const registryManager = require('./appDatabase/registryManager');
    await registryManager.reindexGlobalAppsInformation();

    response.reindexed = true;
    response.appsToRemove = []; // The new function doesn't return apps to remove
  } catch (err) {
    log.error(`Unable to validate apps information. Error: ${err}`);
  }
  return response;
}

/**
 *
 * @param {string} command
 * @returns {Promise<void>}
 */
async function main(command) {
  const initiated = await initiateDB().catch(() => false);

  if (!initiated) return;

  if (command === 'validateInfoCol') {
    await validateAppsInformation();
  } else if (command === 'repairMessagesCol') {
    await repairNanInAppsMessagesDb();
  }

  const client = databaseConnection();

  await client.close();
}

if (require.main === module) {
  // eslint-disable-next-line global-require
  const { parseArgs } = require('node:util');

  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
  });

  const validCommands = ['validateInfoCol', 'repairMessagesCol'];
  const command = positionals[0];

  if (!command || !validCommands.includes(command)) {
    console.error(`Error: Invalid command. Expected one of: ${validCommands.join(', ')}`);
    process.exit(1);
  }

  main(command);
}

module.exports = {
  aggregateInDatabase,
  bulkWriteInDatabase,
  closeDbConnection,
  collectionStats,
  connectMongoDb,
  countInDatabase,
  databaseConnection,
  distinctDatabase,
  dropCollection,
  findInDatabase,
  findOneAndDeleteInDatabase,
  findOneAndUpdateInDatabase,
  findOneInDatabase,
  initiateDB,
  insertManyToDatabase,
  insertOneToDatabase,
  removeDocumentsFromCollection,
  repairNanInAppsMessagesDb,
  updateInDatabase,
  updateOneInDatabase,
  validateAppsInformation,
};
