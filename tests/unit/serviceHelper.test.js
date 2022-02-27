/* eslint-disable no-restricted-syntax */
const chai = require('chai');
const config = require('config');
const { ObjectId } = require('mongodb');
const proxyquire = require('proxyquire');

const { expect } = chai;

let serviceHelper = require('../../ZelBack/src/services/serviceHelper');

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

    const otherTypes = [1, true];
    for (const param of otherTypes) {
      it(`parameter of type ${typeof param} should return undefined`, () => {
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

  describe('createDataMessage tests', () => {
    it('should return a proper data message when called correctly', () => {
      const testData = { id: 55, message: 'this is my test message' };

      const { status, data } = serviceHelper.createDataMessage(testData);

      expect(status).to.equal('success');
      expect(data).to.equal(testData);
    });
  });

  describe('createSuccessMessage tests', () => {
    it('should return a proper data message when called correctly', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = 'Your funds were transfered properly!';

      const { status, data } = serviceHelper.createSuccessMessage(message, name, code);

      expect(status).to.equal('success');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });
  });

  describe('createSuccessMessage tests', () => {
    it('should return a proper success message when called with all parameters', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = 'Your funds were transfered properly!';

      const { status, data } = serviceHelper.createSuccessMessage(message, name, code);

      expect(status).to.equal('success');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });

    it('should return a proper success message when called with empty message', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = '';

      const { status, data } = serviceHelper.createSuccessMessage(message, name, code);

      expect(status).to.equal('success');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });
  });

  describe('createWarningMessage tests', () => {
    it('should return a proper warning message when called with all parameters', () => {
      const code = 214;
      const name = 'Warning!';
      const message = 'There was a slight issue!';

      const { status, data } = serviceHelper.createWarningMessage(message, name, code);

      expect(status).to.equal('warning');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });

    it('should return a proper warning message when called with empty message', () => {
      const code = 214;
      const name = 'Warning!';
      const message = '';

      const { status, data } = serviceHelper.createWarningMessage(message, name, code);

      expect(status).to.equal('warning');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });
  });

  describe('createErrorMessage tests', () => {
    it('should return a proper error message when called with all parameters', () => {
      const code = 503;
      const name = 'Error happened!!';
      const message = 'There was a big error!';

      const { status, data } = serviceHelper.createErrorMessage(message, name, code);

      expect(status).to.equal('error');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });

    it('should return a proper error message when called with empty message', () => {
      const code = 503;
      const name = 'Error happened!!';
      const message = '';
      const expectedMessage = 'Unknown error';

      const { status, data } = serviceHelper.createErrorMessage(message, name, code);

      expect(status).to.equal('error');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(expectedMessage);
    });
  });

  describe('errUnauthorizedMessage tests', () => {
    it('should return a proper unauthorized message when called', () => {
      const code = 401;
      const name = 'Unauthorized';
      const message = 'Unauthorized. Access denied.';

      const { status, data } = serviceHelper.errUnauthorizedMessage(message, name, code);

      expect(status).to.equal('error');
      expect(data.code).to.equal(code);
      expect(data.name).to.equal(name);
      expect(data.message).to.equal(message);
    });
  });

  describe('getApplicationOwner tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
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
      await serviceHelper.insertOneToDatabase(database, collection, insertApp);
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

  describe('verifyZelID tests', () => {
    it('should throw error if ZelID is empty', () => {
      const isValid = serviceHelper.verifyZelID();
      expect(isValid).to.be.an('error');
    });

    it('should return throw error if ZelID is invalid', () => {
      const isValid = serviceHelper.verifyZelID('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo');
      expect(isValid).to.be.an('error');
    });

    it('should return true if ZelID is valid', () => {
      const isValid = serviceHelper.verifyZelID('1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ');
      expect(isValid).to.be.true;
    });
  });

  describe('verifyMessage tests', () => {
    const message = 'test';
    const publicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const validSignature = 'G6wvdaMqtuQYqa5BAtKsLHFCYQwB4PXoTwG0YSGtWU6ude/brDNM5MraSBfT64HU3XPhObGohFjLLo6KjtMgnlc=';
    const address = '1KoXq8mLxpNt3BSnNLq2HzKC39Ne2pVJtF';

    it('should return true if message is signed properly with a public key', () => {
      const verification = serviceHelper.verifyMessage(message, publicKey, validSignature);
      expect(verification).to.be.true;
    });

    it('should return true if message is signed properly with an address', () => {
      const verification = serviceHelper.verifyMessage(message, address, validSignature);
      expect(verification).to.be.true;
    });

    it('should return error if the address is invalid', () => {
      const verification = serviceHelper.verifyMessage(message, '12355', validSignature);
      expect(verification).to.be.an('error');
    });

    it('should return false if the publicKey is invalid', () => {
      const verification = serviceHelper.verifyMessage(message, '0474eb4690689bb408139249eda7f361b7881c4254ccbe30', validSignature);
      expect(verification).to.be.false;
    });

    it('should return error if there is no signature', () => {
      const verification = serviceHelper.verifyMessage(message, address);
      expect(verification).to.be.an('error');
    });

    it('should return false if the address is wrong', () => {
      const verification = serviceHelper.verifyMessage(message, '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', validSignature);
      expect(verification).to.be.false;
    });

    it('should return error if the signature is invalid', () => {
      const verification = serviceHelper.verifyMessage(message, address, '1234567ASDFG');
      expect(verification).to.be.an('error');
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
      await serviceHelper.initiateDB();
      db = serviceHelper.databaseConnection();
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
});
