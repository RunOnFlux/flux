/* eslint-disable no-restricted-syntax */
import chai from 'chai';
import { config } from '../../config/default.js';
import { ObjectId } from 'mongodb';
import proxyquire from 'proxyquire';

const { expect } = chai;

import serviceHelper from '../../ZelBack/src/services/serviceHelper.js';
import dbHelper from '../../ZelBack/src/services/dbHelper.js';
dbHelper.default;

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    testnet: true,
  },
};
serviceHelper = proxyquire('../../ZelBack/src/services/serviceHelper',
  { '../../../config/userconfig': adminConfig });

describe('serviceHelper tests', () => {
  describe('ensureBoolean function tests', () => {
    const falseBools = ['false', false, 0, '0'];
    const trueBools = ['true', true, 1, '1'];
    const restOfTruthyValues = [3, 3n, 'test', [1, 2], { name: 'testobject' }];
    const restOfFalsyValues = [0n, null, undefined, NaN, ''];

    for (const falseBool of falseBools) {
      it(`parameter ${falseBool} of type ${typeof falseBool} should return false`, () => {
        expect(serviceHelper.ensureBoolean(falseBool)).to.equal(false);
      });
    }

    for (const trueBool of trueBools) {
      it(`parameter ${trueBool} of type ${typeof trueBool}  should return false`, () => {
        expect(serviceHelper.ensureBoolean(trueBool)).to.equal(true);
      });
    }

    for (const truthyValue of restOfTruthyValues) {
      it(`parameter ${truthyValue} of type ${typeof truthyValue}  should return undefined`, () => {
        expect(serviceHelper.ensureBoolean(truthyValue)).to.be.undefined;
      });
    }

    for (const falsyValue of restOfFalsyValues) {
      it(`parameter ${falsyValue} of type ${typeof falsyValue}  should return undefined`, () => {
        expect(serviceHelper.ensureBoolean(falsyValue)).to.be.undefined;
      });
    }

    it('empty parameter should return undefined', () => {
      expect(serviceHelper.ensureBoolean()).to.be.undefined;
    });
  });

  describe('ensureNumber function tests', () => {
    const numbersList = [1, '1', 2.5, '2.5'];

    for (const number of numbersList) {
      it(`parameter ${number} should return number value`, () => {
        const ensureNumberOutput = serviceHelper.ensureNumber(1);

        expect(ensureNumberOutput).to.be.a('number');
      });
    }

    it('parameter "test" of type string should return NaN', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber('test');

      expect(ensureNumberOutput).to.be.NaN;
    });
    it('parameter {name: 1} of type object should return NaN', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber({ name: 1 });

      expect(ensureNumberOutput).to.be.NaN;
    });
  });

  describe('ensureObject tests', () => {
    it('parameter of type object should return the same object', () => {
      const testObject = {
        id: 1,
        username: 'Testing user',
      };

      const ensureObjectOutput = serviceHelper.ensureObject(testObject);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.equal(testObject);
    });

    it('empty parameter should return an empty object', () => {
      const ensureObjectOutput = serviceHelper.ensureObject();

      expect(ensureObjectOutput).to.be.an('object').that.is.empty;
    });

    it('parameter of type json string should return an object', () => {
      const stringObject = JSON.stringify({ id: 1, username: 'Testing user' });
      const expected = {
        id: 1,
        username: 'Testing user',
      };

      const ensureObjectOutput = serviceHelper.ensureObject(stringObject);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.eql(expected);
    });

    it('parameter of type query string should return an object', () => {
      const queryString = 'username=Tester&id=1';
      const expected = {
        id: '1',
        username: 'Tester',
      };

      const ensureObjectOutput = serviceHelper.ensureObject(queryString);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.eql(expected);
    });

    it('parameter of type string should return an object', () => {
      const testString = 'test';
      const expected = {
        test: '',
      };

      const ensureObjectOutput = serviceHelper.ensureObject(testString);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.eql(expected);
    });

    it('parameter of type array should return an array', () => {
      const testArr = ['1', 'testing', 3];

      const ensureObjectOutput = serviceHelper.ensureObject(testArr);

      expect(ensureObjectOutput).to.be.an('array');
      expect(ensureObjectOutput).to.eql(testArr);
    });

    it('parameter of type null should return null', () => {
      const ensureObjectOutput = serviceHelper.ensureObject(null);

      expect(ensureObjectOutput).to.be.null;
    });

    const otherTypes = [1, true, undefined];
    for (const param of otherTypes) {
      it(`parameter of type ${typeof param} should return empty object`, () => {
        expect(serviceHelper.ensureObject(param)).to.be.an('object').that.is.empty;
      });
    }
  });

  describe('ensureString tests', () => {
    it('parameter of type string should return a string', () => {
      const testString = 'testing string';

      const ensureStringOutput = serviceHelper.ensureString(testString);

      expect(ensureStringOutput).to.be.a('string');
      expect(ensureStringOutput).to.eql(testString);
    });

    it('parameter of type object should return a string', () => {
      const testObject = {
        id: 1,
        username: 'Testing user',
      };
      const expected = '{"id":1,"username":"Testing user"}';

      const ensureStringOutput = serviceHelper.ensureString(testObject);

      expect(ensureStringOutput).to.be.a('string');
      expect(ensureStringOutput).to.eql(expected);
    });

    it('parameter of type number should return a string', () => {
      const testNumber = 42;
      const expected = '42';

      const ensureStringOutput = serviceHelper.ensureString(testNumber);

      expect(ensureStringOutput).to.be.a('string');
      expect(ensureStringOutput).to.eql(expected);
    });

    it('empty parameter should return undefined', () => {
      const ensureStringOutput = serviceHelper.ensureString();

      expect(ensureStringOutput).to.be.undefined;
    });
  });

  describe('getApplicationOwner tests', () => {
    beforeEach(async () => {
      await dbHelper.initiateDB();
      const db = dbHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database);
      const collection = config.database.appsglobal.collections.appsInformation;
      const insertApp = {
        _id: ObjectId('6147045cd774409b374d253d'),
        name: 'PolkadotNode',
        description: 'Polkadot is a heterogeneous multi-chain interchange.',
        owner: '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH',
      };

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }
      await dbHelper.insertOneToDatabase(database, collection, insertApp);
    });

    it('should return application owner if app exists in database', async () => {
      const appOwner = '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH';
      const getOwnerResult = await serviceHelper.getApplicationOwner('PolkadotNode');

      expect(getOwnerResult).to.equal(appOwner);
    });

    it('should return application owner if app is in available apps, but not in db', async () => {
      const appOwner = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
      const getOwnerResult = await serviceHelper.getApplicationOwner('FoldingAtHomeB');

      expect(getOwnerResult).to.equal(appOwner);
    });

    it('should return null if the app does not exist', async () => {
      const getOwnerResult = await serviceHelper.getApplicationOwner('testing');

      expect(getOwnerResult).to.be.null;
    });
  });

  describe('deleteLoginPhrase tests', () => {
    const query = { loginPhrase: { $eq: '1644935809116x5fpl862o5fnyl29vfpmd9vzmgaddlgqbud8cxks8hj' } };
    const loginPhrase = {
      _id: ObjectId('620bba81c04b4966674013a4'),
      loginPhrase: '1644935809116x5fpl862o5fnyl29vfpmd9vzmgaddlgqbud8cxks8hj',
      createdAt: new Date('2022-02-15T14:36:49.116Z'),
      expireAt: new Date('2022-02-15T14:51:49.116Z'),
    };
    let db;
    let database;
    let collection;

    beforeEach(async () => {
      await dbHelper.initiateDB();
      db = dbHelper.databaseConnection();
      database = db.db(config.database.local.database);
      collection = config.database.local.collections.activeLoginPhrases;

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await database.collection(collection).insertOne(loginPhrase);

      const initialInsert = await database.collection(collection).findOne(query);
      expect(initialInsert).to.eql(loginPhrase);
    });

    it('should delete the login phrase properly', async () => {
      await serviceHelper.deleteLoginPhrase('1644935809116x5fpl862o5fnyl29vfpmd9vzmgaddlgqbud8cxks8hj');
      const afterDeletionResult = await database.collection(collection).findOne(query);
      expect(afterDeletionResult).to.be.null;
    });
  });

  describe('isDecimalLimit function tests', () => {
    const falseBools = [3.123456789, '0.1234567890', 'number', undefined, NaN, '3.123.3', '7.000000000'];
    const trueBools = [1.123, 4.12345678, '4324.123453', 4, '6', 4.00, '5.000', null];

    for (const falseBool of falseBools) {
      it(`parameter ${falseBool} should return false`, () => {
        expect(serviceHelper.isDecimalLimit(falseBool)).to.equal(false);
      });
    }

    for (const trueBool of trueBools) {
      it(`parameter ${trueBool} should return true`, () => {
        expect(serviceHelper.isDecimalLimit(trueBool)).to.equal(true);
      });
    }

    it('custom decimal places ok', () => {
      expect(serviceHelper.isDecimalLimit(3.42, 2)).to.equal(true);
    });

    it('custom decimal places ok B', () => {
      expect(serviceHelper.isDecimalLimit(3.0, 0)).to.equal(true);
    });

    it('custom decimal places false', () => {
      expect(serviceHelper.isDecimalLimit(3.1, 0)).to.equal(false);
    });

    it('custom decimal places false B', () => {
      expect(serviceHelper.isDecimalLimit(3.2342342341, 2)).to.equal(false);
    });
  });
});
