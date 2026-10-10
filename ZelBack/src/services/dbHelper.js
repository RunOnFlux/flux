const log = require('../lib/log');

/**
 * @module Helper module used for all interactions with database
 */

const mongodb = require('mongodb');
const config = require('config');

const serviceHelper = require('./serviceHelper');
const { withRegistryWrite } = require('./appDatabase/registryWriteLock');
const appMessageChain = require('./utils/appMessageChain');

const { MongoClient } = mongodb;
const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

/**
 * @type {mongodb.MongoClient}
 */
let openDBConnection = null;

/**
 * Cached MongoDB server version, populated once per connection.
 * @type {string | null}
 */
let mongoDbVersion = null;

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
  if (!openDBConnection) {
    openDBConnection = await connectMongoDb();
    // Read the server version once, on the initial connect. It is informational
    // and the getter swallows its own errors, so this cannot fail the connect.
    await getMongoDbVersion();
  }
  return true;
}

/**
 * Returns the connected MongoDB server version, fetching and caching it on
 * first use. The driver handshake only exposes the wire-protocol version, so
 * the human-readable version is read once via a buildInfo command and reused.
 * The version is informational: on any failure this resolves to null rather
 * than throwing, so a transient read never sinks its callers, and a later
 * call retries.
 *
 * @returns {Promise<string | null>} Server version, or null if unavailable.
 */
async function getMongoDbVersion() {
  if (mongoDbVersion) return mongoDbVersion;
  if (!openDBConnection) return null;
  try {
    const { version } = await openDBConnection.db('admin').command({ buildInfo: 1 });
    mongoDbVersion = version;
  } catch (error) {
    log.warn(`Unable to read MongoDB version: ${error.message}`);
  }
  return mongoDbVersion;
}

/**
 * Waits for MongoDB to become available, retrying indefinitely.
 * Logs on first attempt, then every ~60 seconds.
 * @returns {Promise<void>}
 */
async function waitForMongo() {
  const RETRY_DELAY_MS = 5000;
  const LOG_INTERVAL_MS = 60000;
  let lastLogAt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await initiateDB();
      log.info('MongoDB connected');
      return;
    } catch (error) {
      const now = Date.now();
      if (!lastLogAt || now - lastLogAt >= LOG_INTERVAL_MS) {
        log.info(`Waiting for MongoDB... (${error.message})`);
        lastLogAt = now;
      }
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(RETRY_DELAY_MS);
    }
  }
}

/**
 * Closes DB connection if exists.
 */
async function closeDbConnection() {
  if (openDBConnection) {
    await openDBConnection.close();
    openDBConnection = null;
    mongoDbVersion = null;
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
 * @param {object} [options] countDocuments options, such as an index `hint`
 *
 * @returns count of documents
 */
async function countInDatabase(database, collection, query, options = {}) {
  const result = await database.collection(collection).countDocuments(query, options);
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
    if (error.message && error.message.includes('duplicate key')) {
      // Log duplicate key errors for debugging instead of silently swallowing them
      // eslint-disable-next-line no-underscore-dangle
      const docIdentifier = value.name || value._id || JSON.stringify(value).slice(0, 100);
      log.error(`Duplicate key error inserting into ${collection}: ${docIdentifier}`);
      log.error(`Full error: ${error.message}`);
      // Still swallow the error to maintain backward compatibility, but now we can see it in logs
      return undefined;
    }
    throw error;
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
 * Replaces a single document in the collection. Unlike updateOne with $set,
 * replaceOne completely replaces the document (except _id), preventing
 * accumulation of stale fields from prior updates.
 *
 * @param {mongodb.Db} database
 * @param {string} collection
 * @param {object} query
 * @param {object} replacement
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function replaceOneInDatabase(database, collection, query, replacement, options) {
  const passedOptions = options || {};
  const result = await database.collection(collection).replaceOne(query, replacement, passedOptions);
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
 * Returns an aggregation expression that computes the actual expiration block
 * for a given (height, expire) pair, applying the PON fork rate adjustment.
 *
 * Pre-fork the chain runs at 1x. Post-fork (height >= daemonPONFork) it runs
 * 4x faster. Apps registered before the fork whose original expiration straddles
 * the fork have their post-fork tail multiplied by 4 so they get the same
 * wall-clock lifetime they paid for.
 *
 * Mirrors the JS logic in registryManager.expireGlobalApplications so the
 * count comparison and the rebuild stay consistent.
 *
 * @param {string} heightField mongo field reference, e.g. '$height'
 * @param {string} expireField mongo field reference, e.g. '$expire'
 * @returns {object} mongo aggregation expression
 */
function expireHeightExpr(heightField, expireField) {
  const PON_FORK = config.fluxapps.daemonPONFork;
  const PRE_FORK_DEFAULT_EXPIRE = config.fluxapps.blocksLasting;
  const POST_FORK_DEFAULT_EXPIRE = PRE_FORK_DEFAULT_EXPIRE * 4;

  return {
    $let: {
      vars: {
        h: heightField,
        e: {
          $ifNull: [
            expireField,
            {
              $cond: {
                if: { $gte: [heightField, PON_FORK] },
                then: POST_FORK_DEFAULT_EXPIRE,
                else: PRE_FORK_DEFAULT_EXPIRE,
              },
            },
          ],
        },
      },
      in: {
        $cond: {
          if: { $gte: ['$$h', PON_FORK] },
          // post-fork registration: straightforward
          then: { $add: ['$$h', '$$e'] },
          // pre-fork registration: if expiration crosses the fork, multiply
          // the post-fork tail by 4 to preserve wall-clock lifetime
          else: {
            $cond: {
              if: { $gt: [{ $add: ['$$h', '$$e'] }, PON_FORK] },
              then: {
                $add: [
                  PON_FORK,
                  {
                    $multiply: [
                      { $subtract: [{ $add: ['$$h', '$$e'] }, PON_FORK] },
                      4,
                    ],
                  },
                ],
              },
              else: { $add: ['$$h', '$$e'] },
            },
          },
        },
      },
    },
  };
}

/**
 * Each app's messages newest first: by block, a same-block tie by timestamp. The first message
 * per name in this order is the one in force (appMessageChain).
 */
const NEWEST_APP_MESSAGE_SORT = { 'appSpecifications.name': 1, height: -1, timestamp: -1 };
const NEWEST_APP_MESSAGE_INDEX = 'newestAppMessageByName';

/**
 * Ensures the index NEWEST_APP_MESSAGE_SORT reads from, and drops the name+height index it
 * covers.
 * @param {mongodb.Collection} appsMessagesCollection
 * @returns {Promise<void>}
 */
async function ensureNewestAppMessageIndex(appsMessagesCollection) {
  await appsMessagesCollection.createIndex(NEWEST_APP_MESSAGE_SORT, { name: NEWEST_APP_MESSAGE_INDEX });
  await appsMessagesCollection.dropIndex('sortAppMessagesForGroupBy').catch(() => {});
}

/**
 * This node's payment facts for app messages, from its payment records: each hash's position in
 * its block, and the hashes whose transaction is not on the chain.
 * @param {mongodb.Db} daemonDb
 * @param {string[]} hashes
 * @returns {Promise<{positions: Map<string, number>, notOnChain: Set<string>}>}
 */
async function appPaymentFacts(daemonDb, hashes) {
  const records = await findInDatabase(
    daemonDb,
    config.database.daemon.collections.appsHashes,
    { hash: { $in: hashes } },
    { projection: { _id: 0, hash: 1, txIndex: 1, notOnChain: 1 } },
  );
  const positions = new Map();
  const notOnChain = new Set();
  records.forEach((record) => {
    if (record.notOnChain === true) notOnChain.add(record.hash);
    else if (Number.isInteger(record.txIndex)) positions.set(record.hash, record.txIndex);
  });
  return { positions, notOnChain };
}

/**
 * The messages of one app name that count (appMessageChain.messagesThatCount), leaving out a
 * message whose payment is not on the chain.
 * @param {mongodb.Db} daemonDb
 * @param {object[]} messages the name's permanent messages
 * @returns {Promise<object[]>} oldest first
 */
async function appMessagesThatCount(daemonDb, messages) {
  const { positions, notOnChain } = await appPaymentFacts(daemonDb, messages.map((message) => message.hash));
  return appMessageChain.messagesThatCount(messages.filter((message) => !notOnChain.has(message.hash)), positions);
}

/**
 * The app names whose message in force can differ from their newest message: a name registered
 * by more than one owner, and a name with a message whose payment is not on the chain.
 * @param {mongodb.Db} appsGlobalDb
 * @param {string} appsMessagesCol
 * @param {mongodb.Db} daemonDb
 * @returns {Promise<string[]>}
 */
async function appNamesTheNameRuleDecides(appsGlobalDb, appsMessagesCol, daemonDb) {
  const contested = await aggregateInDatabase(appsGlobalDb, appsMessagesCol, [
    { $match: { type: { $in: ['fluxappregister', 'zelappregister'] } } },
    { $group: { _id: '$appSpecifications.name', owners: { $addToSet: '$appSpecifications.owner' } } },
    { $match: { 'owners.1': { $exists: true } } },
  ]);
  const notOnChainHashes = (await findInDatabase(
    daemonDb,
    config.database.daemon.collections.appsHashes,
    { notOnChain: true },
    { projection: { _id: 0, hash: 1 } },
  )).map((record) => record.hash);
  const unpaid = notOnChainHashes.length ? await findInDatabase(
    appsGlobalDb,
    appsMessagesCol,
    { hash: { $in: notOnChainHashes } },
    { projection: { _id: 0, 'appSpecifications.name': 1 } },
  ) : [];
  return [...new Set([...contested.map((group) => group._id), ...unpaid.map((message) => message.appSpecifications.name)])];
}

/**
 * The registry row for one app name under appMessageChain: its message in force while that
 * message's term runs at the height, or null.
 * @param {mongodb.Db} appsGlobalDb
 * @param {string} appsMessagesCol
 * @param {mongodb.Db} daemonDb
 * @param {string} name
 * @param {number} scannedHeight
 * @returns {Promise<object|null>}
 */
async function liveAppRow(appsGlobalDb, appsMessagesCol, daemonDb, name, scannedHeight) {
  const messages = await findInDatabase(appsGlobalDb, appsMessagesCol, { 'appSpecifications.name': name }, { projection: { _id: 0 } });
  const counted = await appMessagesThatCount(daemonDb, messages);
  const governing = counted[counted.length - 1];
  if (!governing || !appMessageChain.isInForce(governing.height, governing.appSpecifications.expire, scannedHeight)) return null;
  return { ...governing.appSpecifications, hash: governing.hash, height: governing.height };
}

/**
 * Whether the registry holds a different number of live apps than the messages give: each name's
 * newest message, and for a name the name rule decides (appNamesTheNameRuleDecides), its message
 * in force (liveAppRow), as the rebuild takes them.
 * @param {mongodb.Db} appsGlobalDb
 * @param {string} appsMessagesCol mongo collection name
 * @param {string} appsInformationCol mongo collection name
 * @param {number} scannedHeight
 * @param {mongodb.Db} daemonDb the payment records' database
 * @returns {Promise<boolean>}
 */
async function isReindexAppsInformationRequired(
  appsGlobalDb,
  appsMessagesCol,
  appsInformationCol,
  scannedHeight,
  daemonDb,
) {
  const decided = await appNamesTheNameRuleDecides(appsGlobalDb, appsMessagesCol, daemonDb);
  let decidedLive = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const name of decided) {
    // eslint-disable-next-line no-await-in-loop
    if (await liveAppRow(appsGlobalDb, appsMessagesCol, daemonDb, name, scannedHeight)) decidedLive += 1;
  }

  const appsMessagesPipeline = [
    { $sort: NEWEST_APP_MESSAGE_SORT },
    {
      $group: {
        _id: '$appSpecifications.name',
        maxHeightMsg: { $first: '$$ROOT' },
      },
    },
    { $match: { _id: { $nin: decided } } },
    {
      $match: {
        $expr: {
          $gt: [
            expireHeightExpr(
              '$maxHeightMsg.height',
              '$maxHeightMsg.appSpecifications.expire',
            ),
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
        expireHeight: expireHeightExpr('$height', '$expire'),
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
    await ensureNewestAppMessageIndex(appsGlobalDb.collection(appsMessagesCol));

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

    const newestLive = await messagesCursor.next();
    const appsFromInformation = await informationCursor.next();
    const appsFromMessagesCount = (newestLive?.count ?? 0) + decidedLive;

    if (!appsFromMessagesCount) {
      log.warn('No apps from apps messages found, unable to validate apps information');
      return false;
    }

    if (!appsFromInformation) {
      log.info('No apps information apps found, reindexing colleciton');
      return true;
    }

    log.info(
      `Apps reindex validation. Found ${appsFromMessagesCount} apps from appsMessages.`
      + ` Found ${appsFromInformation.count} apps from appsInformation`,
    );

    if (appsFromMessagesCount !== appsFromInformation.count) {
      return true;
    }

    // Detect ghost flat fields on v4+ specs caused by $set accumulating
    // fields from prior spec versions. Fixed by replaceOne in registryManager.
    const ghostCount = await countInDatabase(appsGlobalDb, appsInformationCol, {
      version: { $gte: 4 },
      repotag: { $exists: true },
    });
    if (ghostCount > 0) {
      log.info(`Found ${ghostCount} v4+ specs with ghost fields from prior versions, reindex required`);
      return true;
    }

    return false;
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

/**
 * Rebuilds the appsInformation collection from appsMessages in a single mongo
 * aggregation and chunked bulk inserts.
 *
 * The new registry is built in a staging collection and renamed over the live
 * one in one step, so a reader sees the old registry or the new one and never an
 * empty or partial one. The rebuild holds the registry write lock throughout: a
 * promotion or expiry arriving meanwhile waits and writes to the collection this
 * produced.
 *
 * The aggregation takes each name's newest message. A name whose message in
 * force can differ from it (appNamesTheNameRuleDecides) is then decided by
 * appMessageChain from its full history. Filtering for currently-alive apps
 * happens inside the aggregation via expireHeightExpr (full PON fork rate
 * adjustment), and by appMessageChain.isInForce for the names decided after it,
 * so there is no separate expire pass.
 *
 * @param {mongodb.Db} appsGlobalDb
 * @param {mongodb.Db} appsLocalDb
 * @param {string} globalAppsMessagesCol
 * @param {string} globalAppsInformationCol
 * @param {string} localAppsInformationCol
 * @param {number} scannedHeight
 * @param {mongodb.Db} daemonDb the payment records' database
 * @returns {Promise<Array<string>>} installed app names that are no longer in
 *   the live spec set (caller is responsible for removing them locally)
 */
async function reindexGlobalAppsInformation(
  appsGlobalDb,
  appsLocalDb,
  globalAppsMessagesCol,
  globalAppsInformationCol,
  localAppsInformationCol,
  scannedHeight,
  daemonDb,
) {
  return withRegistryWrite(async () => {
    const stagingCol = `${globalAppsInformationCol}_rebuild`;
    // A staging collection left by a rebuild that did not finish is discarded;
    // the live registry was never touched by it.
    await dropCollection(appsGlobalDb, stagingCol).catch((error) => {
      if (error.message !== 'ns not found') throw error;
    });

    const infoCol = appsGlobalDb.collection(stagingCol);
    await infoCol.createIndexes([
      { key: { name: 1 }, name: 'query for getting zelapp based on zelapp specs name' },
      { key: { owner: 1 }, name: 'query for getting zelapp based on zelapp specs owner' },
      { key: { repotag: 1 }, name: 'query for getting zelapp based on image' },
      { key: { height: 1 }, name: 'query for getting zelapp based on last height update' },
      { key: { hash: 1 }, name: 'query for getting zelapp based on last hash' },
    ]);
    await ensureNewestAppMessageIndex(appsGlobalDb.collection(globalAppsMessagesCol));

    const pipeline = [
      { $sort: NEWEST_APP_MESSAGE_SORT },
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
              expireHeightExpr(
                '$maxHeightMsg.height',
                '$maxHeightMsg.appSpecifications.expire',
              ),
              scannedHeight,
            ],
          },
        },
      },
      {
        $replaceWith: {
          $mergeObjects: [
            '$maxHeightMsg.appSpecifications',
            {
              hash: '$maxHeightMsg.hash',
              height: '$maxHeightMsg.height',
            },
          ],
        },
      },
    ];

    const resultCursor = await aggregateInDatabase(
      appsGlobalDb,
      globalAppsMessagesCol,
      pipeline,
      { returnArray: false },
    );

    const appsToRemove = await syncAppsInformationCollection(
      resultCursor,
      appsGlobalDb,
      appsLocalDb,
      stagingCol,
      localAppsInformationCol,
    );

    const decided = await appNamesTheNameRuleDecides(appsGlobalDb, globalAppsMessagesCol, daemonDb);
    // eslint-disable-next-line no-restricted-syntax
    for (const name of decided) {
      // eslint-disable-next-line no-await-in-loop
      const row = await liveAppRow(appsGlobalDb, globalAppsMessagesCol, daemonDb, name, scannedHeight);
      const removalAt = appsToRemove.indexOf(name);
      if (row) {
        // eslint-disable-next-line no-await-in-loop
        await infoCol.replaceOne({ name }, row, { upsert: true });
        if (removalAt !== -1) appsToRemove.splice(removalAt, 1);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await infoCol.deleteOne({ name });
        // eslint-disable-next-line no-await-in-loop
        const installed = await findOneInDatabase(appsLocalDb, localAppsInformationCol, { name }, { projection: { _id: 0, name: 1 } });
        if (installed && removalAt === -1) appsToRemove.push(name);
      }
    }

    await infoCol.rename(globalAppsInformationCol, { dropTarget: true });

    log.info(
      `Reindexing of global applications finished. Local apps to be removed: ${JSON.stringify(appsToRemove)}`,
    );

    return appsToRemove;
  });
}

/**
 * Verifies the app count based on an aggregation from appsmessages and compares it to the
 * app count in appsinformation. If they differ - the appsinformation collection is dropped and
 * rebuilt from the appsmessages. The entire process takes about 500-700ms.
 * @returns {Promise<{validated: boolean, reindexed: boolean}>}
 */
async function validateAppsInformation() {
  const response = { validated: false, reindexed: false };

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
      daemonDb,
    );

    log.info(`validateAppsInformation reindexRequired: ${reindexRequired}`);

    if (!reindexRequired) {
      response.validated = true;
      return response;
    }

    await reindexGlobalAppsInformation(
      appsGlobalDb,
      appsLocalDb,
      globalAppsMessagesCol,
      globalAppsInformationCol,
      localAppsInformationCol,
      scannedHeight,
      daemonDb,
    );

    response.reindexed = true;
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
  appMessagesThatCount,
  appPaymentFacts,
  bulkWriteInDatabase,
  closeDbConnection,
  collectionStats,
  connectMongoDb,
  countInDatabase,
  databaseConnection,
  distinctDatabase,
  dropCollection,
  ensureNewestAppMessageIndex,
  findInDatabase,
  findOneAndDeleteInDatabase,
  findOneAndUpdateInDatabase,
  findOneInDatabase,
  getMongoDbVersion,
  initiateDB,
  insertManyToDatabase,
  insertOneToDatabase,
  isReindexAppsInformationRequired,
  reindexGlobalAppsInformation,
  removeDocumentsFromCollection,
  repairNanInAppsMessagesDb,
  replaceOneInDatabase,
  updateInDatabase,
  updateOneInDatabase,
  validateAppsInformation,
  waitForMongo,
  NEWEST_APP_MESSAGE_SORT,
};
