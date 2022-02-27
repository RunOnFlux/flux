/**
 * @module Helper module used for all interactions with database
 */

const mongodb = require('mongodb');
const config = require('config');

const { MongoClient } = mongodb;
const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

let openDBConnection = null;
/**
 * Returns MongoDB connection, if it was initiated before, otherwise returns null.
 *
 * @returns openDbConnection
 */
function databaseConnection() {
  return openDBConnection;
}

/**
 * Initiates connection with the database.
 *
 * @param {string} [url]
 *
 * @returns {object} mongodb.MongoClient
 */
async function connectMongoDb(url) {
  const connectUrl = url || mongoUrl;
  const mongoSettings = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 100,
  };
  const db = await MongoClient.connect(connectUrl, mongoSettings);
  return db;
}

/**
 * Initiates default db connection.
 * @returns true
 */
async function initiateDB() {
  openDBConnection = await connectMongoDb();
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
 * @param {string} database
 * @param {string} collection
 * @param {object} query
 * @param {object} [projection]
 *
 * @returns array
 */
async function findInDatabase(database, collection, query, projection) {
  const results = await database.collection(collection).find(query, projection).toArray();
  return results;
}

/**
 * Returns document from the DB based on the query and the projection.
 *
 * @param {string} database
 * @param {string} collection
 * @param {object} query
 * @param {object} [projection]
 * @returns document
 */
async function findOneInDatabase(database, collection, query, projection) {
  const result = await database.collection(collection).findOne(query, projection);
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
  const result = await database.collection(collection).stats();
  return result;
}

module.exports = {
  databaseConnection,
  connectMongoDb,
  initiateDB,
  distinctDatabase,
  findInDatabase,
  findOneInDatabase,
  findOneAndUpdateInDatabase,
  findOneAndDeleteInDatabase,
  insertOneToDatabase,
  updateOneInDatabase,
  updateInDatabase,
  removeDocumentsFromCollection,
  dropCollection,
  collectionStats,
  closeDbConnection,
  insertManyToDatabase,
};
