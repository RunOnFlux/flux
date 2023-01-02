import { expect } from 'chai';
import { config } from '../../config/default.js';
import { ObjectId } from 'mongodb';

import dbHelper from '../../ZelBack/src/services/dbHelper.js';
dbHelper.default;

const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

const testInsert = [{
  _id: ObjectId('5f99562a09aef91cd19fbb93'),
  name: 'App1',
  description: 'Test',
  owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6W',
}, {
  _id: ObjectId('5fa25bf73ba9312a4d83712d'),
  name: 'App1',
  description: 'Test',
  owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6d',
}, {
  _id: ObjectId('5fb48e724b82682e2bd22269'),
  name: 'App2',
  description: 'Test3',
  owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6h',
}, {
  _id: ObjectId('5fec239ec4ef4d416e70ac61'),
  name: 'App3',
  description: 'Test3',
  owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6w',
}];

describe('dbHelper tests', () => {
  describe('connectMongoDb tests', async () => {
    it('should default to config url when called without params', async () => {
      await dbHelper.initiateDB();

      const dbConnection = await dbHelper.connectMongoDb();

      expect(dbConnection.s.url).to.equal(mongoUrl);
    });
  });

  describe('databaseConnection tests', () => {
    beforeEach(async () => {
      await dbHelper.closeDbConnection();
    });
    it('should default to null if no connection was established', () => {
      expect(dbHelper.databaseConnection()).to.be.null;
    });

    it('should return a db connection if established', async () => {
      await dbHelper.initiateDB();

      const dbConnection = dbHelper.databaseConnection();

      expect(dbConnection).to.not.be.null;
      expect(dbConnection.s.url).to.equal(mongoUrl);
    });
  });

  describe('distinctDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.local.database);
      collection = config.database.local.collections.loggedUsers;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should return proper distinct values from database without a filter', async () => {
      const expectedDistinctValues = ['Test', 'Test3'];

      const distinctResults = await dbHelper.distinctDatabase(database, collection, 'description');

      expect(distinctResults).to.eql(expectedDistinctValues);
    });

    it('should return proper distinct values from database with a filter', async () => {
      const expectedDistinctValues = ['Test'];
      const filter = { name: 'App1' };

      const distinctResults = await dbHelper.distinctDatabase(database, collection, 'description', filter);

      expect(distinctResults).to.eql(expectedDistinctValues);
    });

    it('should return no values when the field name is wrong', async () => {
      const distinctResults = await dbHelper.distinctDatabase(database, collection, 'test');

      expect(distinctResults).to.be.empty;
    });
  });

  describe('findInDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should return proper array of documents from database', async () => {
      const query = { name: 'App1' };
      const expectedResult = [
        {
          _id: new ObjectId('5f99562a09aef91cd19fbb93'),
          name: 'App1',
          description: 'Test',
          owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6W',
        },
        {
          _id: new ObjectId('5fa25bf73ba9312a4d83712d'),
          name: 'App1',
          description: 'Test',
          owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6d',
        },
      ];

      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      expect(findInDatabaseResult).to.eql(expectedResult);
    });

    it('should return proper array of documents from database with a projection', async () => {
      const query = { name: 'App1' };
      const queryProjection = {
        projection: {
          _id: 0,
          name: 1,
          owner: 1,
        },
      };
      const expectedResult = [
        {
          name: 'App1',
          owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6W',
        },
        {
          name: 'App1',
          owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6d',
        },
      ];

      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query, queryProjection);

      expect(findInDatabaseResult).to.eql(expectedResult);
    });

    it('should return no values when the field name is wrong', async () => {
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, { name: 'test' });

      expect(findInDatabaseResult).to.be.empty;
    });
  });

  describe('findOneinDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should return results based on the query without projection', async () => {
      const query = { name: 'App1' };
      const expectedResult = {
        _id: ObjectId('5f99562a09aef91cd19fbb93'),
        name: 'App1',
        description: 'Test',
        owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6W',
      };

      const findOneInDatabaseResult = await dbHelper.findOneInDatabase(database, collection, query);

      expect(findOneInDatabaseResult).to.eql(expectedResult);
    });

    it('should return results based on the query with projection', async () => {
      const query = { name: 'App1' };
      const queryProjection = {
        projection: {
          _id: 0,
          name: 1,
          owner: 1,
        },
      };
      const expectedResult = {
        name: 'App1',
        owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6W',
      };

      const findOneInDatabaseResult = await dbHelper.findOneInDatabase(database, collection, query, queryProjection);

      expect(findOneInDatabaseResult).to.eql(expectedResult);
    });

    it('should return empty if query yields no results', async () => {
      const query = { name: 'Test1234' };

      const findOneInDatabaseResult = await dbHelper.findOneInDatabase(database, collection, query);

      expect(findOneInDatabaseResult).to.be.null;
    });
  });

  describe('findOneAndUpdateInDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should find and update the document based on query and updateExpression', async () => {
      const query = { _id: ObjectId('5f99562a09aef91cd19fbb93') };
      const updateExpression = { $set: { description: 'New Description', owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a' } };
      const expectedResult = {
        _id: ObjectId('5f99562a09aef91cd19fbb93'),
        name: 'App1',
        description: 'New Description',
        owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a',
      };

      const findOneAndUpdateInDatabaseResponse = await dbHelper.findOneAndUpdateInDatabase(database, collection, query, updateExpression);
      const findOneInDatabaseResult = await dbHelper.findOneInDatabase(database, collection, query);

      expect(findOneAndUpdateInDatabaseResponse.ok).to.eql(1);
      expect(findOneInDatabaseResult).to.eql(expectedResult);
    });

    it('should find and update the document and return the new document', async () => {
      const query = { _id: ObjectId('5f99562a09aef91cd19fbb93') };
      const updateExpression = { $set: { description: 'New Description', owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a' } };
      const options = { returnDocument: 'after' };
      const expectedResult = {
        _id: ObjectId('5f99562a09aef91cd19fbb93'),
        name: 'App1',
        description: 'New Description',
        owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a',
      };

      const findOneAndUpdateInDatabaseResponse = await dbHelper.findOneAndUpdateInDatabase(database, collection, query, updateExpression, options);

      expect(findOneAndUpdateInDatabaseResponse.ok).to.equal(1);
      expect(findOneAndUpdateInDatabaseResponse.value).to.eql(expectedResult);
    });

    it('should return null if the document does not exist', async () => {
      const query = { _id: ObjectId('5f91562a011ef91cd19fbb93') };
      const updateExpression = { $set: { description: 'New Description', owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a' } };

      const findOneAndUpdateInDatabaseResponse = await dbHelper.findOneAndUpdateInDatabase(database, collection, query, updateExpression);

      expect(findOneAndUpdateInDatabaseResponse.value).to.be.null;
      expect(findOneAndUpdateInDatabaseResponse.ok).to.equal(1);
    });
  });

  describe('insertOneToDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should insert object into database if called properly', async () => {
      const documentToInsert = {
        _id: ObjectId('4f99562a09aef92cd1afbe93'),
        name: 'App5',
        description: 'Test3',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdoKNSi9e',
      };
      const query = { _id: ObjectId('4f99562a09aef92cd1afbe93') };

      const insertOneResponse = await dbHelper.insertOneToDatabase(database, collection, documentToInsert);
      const getOneFromDatabase = await dbHelper.findOneInDatabase(database, collection, query);

      expect(insertOneResponse.acknowledged).to.be.true;
      // eslint-disable-next-line no-underscore-dangle
      expect(insertOneResponse.insertedId).to.be.eql(documentToInsert._id);
      expect(getOneFromDatabase).to.eql(documentToInsert);
    });

    it('should return undefined if the key already exists', async () => {
      const documentToInsert = {
        _id: ObjectId('5fa25bf73ba9312a4d83712d'),
        name: 'App5',
        description: 'Test3',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdoKNSi9e',
      };

      expect(await dbHelper.insertOneToDatabase(database, collection, documentToInsert)).to.be.undefined;
    });
  });

  describe('insertManyToDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should insert documents into database if called properly', async () => {
      const documentsToInsert = [{
        _id: ObjectId('4f99562a09aef92cd1afbe93'),
        name: 'App5',
        description: 'Test3',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdoKNSi9e',
      }, {
        _id: ObjectId('4f89562a09aef92cd1afbe96'),
        name: 'App5',
        description: 'Test4',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLsoKNSi6e',
      }, {
        _id: ObjectId('4f79562a09aef92cd1afbe97'),
        name: 'App5',
        description: 'Test5',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdzKNSi3e',
      }];
      const query = { name: 'App5' };

      const insertManyToDatabaseResponse = await dbHelper.insertManyToDatabase(database, collection, documentsToInsert);
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      expect(insertManyToDatabaseResponse.acknowledged).to.be.true;
      expect(insertManyToDatabaseResponse.insertedCount).to.equal(3);
      // eslint-disable-next-line no-underscore-dangle
      expect(findInDatabaseResult).to.eql(documentsToInsert);
    });

    it('should not insert any of docs if one of them has duplicate ID if ordered option is set to true', async () => {
      const options = { ordered: true }; // If true, when an insert fails, don't execute the remaining writes. If false, continue with remaining inserts when one fails.
      const documentsToInsert = [{
        _id: ObjectId('5f99562a09aef91cd19fbb93'), // duplicate ID
        name: 'App5',
        description: 'Test3',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdoKNSi9e',
      }, {
        _id: ObjectId('4f89562a09aef92cd1afbe96'),
        name: 'App5',
        description: 'Test4',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLsoKNSi6e',
      }, {
        _id: ObjectId('4f79562a09aef92cd1afbe97'),
        name: 'App5',
        description: 'Test5',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdzKNSi3e',
      }];

      const query = { name: 'App5' };

      await dbHelper.insertManyToDatabase(database, collection, documentsToInsert, options);
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      // eslint-disable-next-line no-underscore-dangle
      expect(findInDatabaseResult).to.be.empty;
    });

    it('should insert docs, except for the one that had duplicate ID', async () => {
      const options = { ordered: false }; // If true, when an insert fails, don't execute the remaining writes. If false, continue with remaining inserts when one fails.
      const documentsToInsert = [{
        _id: ObjectId('5f99562a09aef91cd19fbb93'), // duplicate ID
        name: 'App5',
        description: 'Test3',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdoKNSi9e',
      }, {
        _id: ObjectId('4f89562a09aef92cd1afbe96'),
        name: 'App5',
        description: 'Test4',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLsoKNSi6e',
      }, {
        _id: ObjectId('4f79562a09aef92cd1afbe97'),
        name: 'App5',
        description: 'Test5',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdzKNSi3e',
      }];
      const expectedResult = [{
        _id: ObjectId('4f89562a09aef92cd1afbe96'),
        name: 'App5',
        description: 'Test4',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLsoKNSi6e',
      }, {
        _id: ObjectId('4f79562a09aef92cd1afbe97'),
        name: 'App5',
        description: 'Test5',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdzKNSi3e',
      }];

      const query = { name: 'App5' };

      await dbHelper.insertManyToDatabase(database, collection, documentsToInsert, options);
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      // eslint-disable-next-line no-underscore-dangle
      expect(findInDatabaseResult).to.eql(expectedResult);
    });

    it('should return undefined if there are duplicate keys', async () => {
      const documentsToInsert = [{
        _id: ObjectId('4f99562a09aef92cd1afbe93'),
        name: 'App5',
        description: 'Test3',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLdoKNSi9e',
      }, {
        _id: ObjectId('4f99562a09aef92cd1afbe93'),
        name: 'App5',
        description: 'Test4',
        owner: '1SZe3AUYQC4aT5Y0LhgEcH2nLLsoKNSi6e',
      }];

      expect(await dbHelper.insertManyToDatabase(database, collection, documentsToInsert)).to.be.undefined;
    });
  });

  describe('updateOneInDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should update the document based on query and updateExpression', async () => {
      const query = { _id: ObjectId('5f99562a09aef91cd19fbb93') };
      const updateExpression = { $set: { description: 'New Description', owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a' } };
      const expectedResult = {
        _id: ObjectId('5f99562a09aef91cd19fbb93'),
        name: 'App1',
        description: 'New Description',
        owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a',
      };

      const updateOneInDatabaseResponse = await dbHelper.updateOneInDatabase(database, collection, query, updateExpression);
      const findOneInDatabaseResult = await dbHelper.findOneInDatabase(database, collection, query);

      expect(updateOneInDatabaseResponse.modifiedCount).to.eql(1);
      expect(updateOneInDatabaseResponse.matchedCount).to.eql(1);
      expect(updateOneInDatabaseResponse.acknowledged).to.eql(true);
      expect(findOneInDatabaseResult).to.eql(expectedResult);
    });

    it('should return null if the document does not exist', async () => {
      const query = { _id: ObjectId('5f91562a011ef91cd19fbb93') };
      const updateExpression = { $set: { description: 'New Description', owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a' } };

      const updateOneInDatabaseResponse = await dbHelper.updateOneInDatabase(database, collection, query, updateExpression);

      expect(updateOneInDatabaseResponse.modifiedCount).to.eql(0);
      expect(updateOneInDatabaseResponse.matchedCount).to.eql(0);
      expect(updateOneInDatabaseResponse.acknowledged).to.eql(true);
    });
  });

  describe('updateInDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should update multiple documents based on query and updateExpression', async () => {
      const query = { name: 'App1' };
      const updateExpression = { $set: { description: 'New Description', owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a' } };
      const expectedResult = [
        {
          _id: new ObjectId('5f99562a09aef91cd19fbb93'),
          name: 'App1',
          description: 'New Description',
          owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a',
        },
        {
          _id: new ObjectId('5fa25bf73ba9312a4d83712d'),
          name: 'App1',
          description: 'New Description',
          owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a',
        },
      ];

      const updateInDatabaseResponse = await dbHelper.updateInDatabase(database, collection, query, updateExpression);
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      expect(updateInDatabaseResponse.modifiedCount).to.eql(2);
      expect(updateInDatabaseResponse.matchedCount).to.eql(2);
      expect(updateInDatabaseResponse.acknowledged).to.eql(true);
      expect(findInDatabaseResult).to.eql(expectedResult);
    });

    it('should update nothing if query was wrong', async () => {
      const query = { name: 'Test 123' };
      const updateExpression = { $set: { description: 'New Description', owner: '1SZe3AUYQC4aT5YWLhgEcH1nLLdoKNSi9a' } };

      const updateInDatabaseResponse = await dbHelper.updateInDatabase(database, collection, query, updateExpression);

      expect(updateInDatabaseResponse.modifiedCount).to.eql(0);
      expect(updateInDatabaseResponse.matchedCount).to.eql(0);
      expect(updateInDatabaseResponse.acknowledged).to.eql(true);
    });
  });

  describe('findOneAndDeleteInDatabase tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should delete a document and return it', async () => {
      const query = { _id: ObjectId('5f99562a09aef91cd19fbb93') };
      const expectedResult = {
        _id: ObjectId('5f99562a09aef91cd19fbb93'),
        name: 'App1',
        description: 'Test',
        owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6W',
      };

      const findOneAndDeleteInDatabaseResponse = await dbHelper.findOneAndDeleteInDatabase(database, collection, query);
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      expect(findOneAndDeleteInDatabaseResponse.ok).to.eql(1);
      expect(findOneAndDeleteInDatabaseResponse.value).to.eql(expectedResult);
      expect(findInDatabaseResult).to.be.empty;
    });

    it('should delete a document and return it according to projection', async () => {
      const query = { _id: ObjectId('5f99562a09aef91cd19fbb93') };
      const expectedResult = {
        name: 'App1',
        owner: '1KPKzyp9VyB9ouAA4spZ48x8g32sxLVK6W',
      };
      const queryProjection = {
        projection: {
          _id: 0,
          name: 1,
          owner: 1,
        },
      };

      const findOneAndDeleteInDatabaseResponse = await dbHelper.findOneAndDeleteInDatabase(database, collection, query, queryProjection);
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      expect(findOneAndDeleteInDatabaseResponse.ok).to.eql(1);
      expect(findOneAndDeleteInDatabaseResponse.value).to.eql(expectedResult);
      expect(findInDatabaseResult).to.be.empty;
    });
  });

  describe('removeDocumentsFromCollection tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should delete documents matching the query', async () => {
      const query = { name: 'App1' };

      const removeDocumentsFromCollectionResponse = await dbHelper.removeDocumentsFromCollection(database, collection, query);
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      expect(removeDocumentsFromCollectionResponse.acknowledged).to.eql(true);
      expect(removeDocumentsFromCollectionResponse.deletedCount).to.eql(2);
      expect(findInDatabaseResult).to.be.empty;
    });

    it('should delete all documents from the collection', async () => {
      const query = {};

      const removeDocumentsFromCollectionResponse = await dbHelper.removeDocumentsFromCollection(database, collection, query);
      const findInDatabaseResult = await dbHelper.findInDatabase(database, collection, query);

      expect(removeDocumentsFromCollectionResponse.acknowledged).to.eql(true);
      expect(removeDocumentsFromCollectionResponse.deletedCount).to.eql(4);
      expect(findInDatabaseResult).to.be.empty;
    });

    it('should delete nothing if query is not matched', async () => {
      const query = { name: 'test1234' };

      const removeDocumentsFromCollectionResponse = await dbHelper.removeDocumentsFromCollection(database, collection, query);

      expect(removeDocumentsFromCollectionResponse.acknowledged).to.eql(true);
      expect(removeDocumentsFromCollectionResponse.deletedCount).to.eql(0);
    });
  });

  describe('collectionStats tests', () => {
    let database;
    let collection;
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      database = db.db(config.database.appsglobal.database);
      collection = config.database.appsglobal.collections.appsInformation;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertMany(testInsert);
    });

    it('should return collection statistics', async () => {
      const collectionStatsResponse = await dbHelper.collectionStats(database, collection);

      expect(collectionStatsResponse.count).to.eql(4);
      expect(collectionStatsResponse.ns).to.eql('globalzelappstest.zelappsinformation');
      expect(collectionStatsResponse.avgObjSize).to.eql(105);
    });

    it('should return empty if collection is empty', async () => {
      const collectionStatsResponse = await dbHelper.collectionStats(database, 'test1234');

      expect(collectionStatsResponse.count).to.eql(0);
      expect(collectionStatsResponse.ns).to.eql('globalzelappstest.test1234');
      expect(collectionStatsResponse.avgObjSize).to.be.undefined;
    });
  });
});
