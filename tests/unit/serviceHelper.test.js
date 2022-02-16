process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/testconfig`;
const chai = require('chai');
const config = require('config');
const { ObjectId, MongoClient } = require('mongodb');
const expect = chai.expect;
const serviceHelper = require("../../ZelBack/src/services/serviceHelper");

describe('serviceHelper tests', () => {
  describe('ensureBoolean function tests', () => {
    const falseBools = ['false', false, 0, '0'];
    const trueBools = ['true', true, 1, '1'];
    const restOfTruthyValues = [3, 3n, 'test', [1, 2], { name: 'testobject' }];
    const restOfFalsyValues = [0n, null, undefined, NaN, ''];

    for (let falseBool of falseBools) {
      it(`parameter ${typeof falseBool === 'string' ? `"${falseBool}"` : falseBool} should return false`, () => {
        expect(serviceHelper.ensureBoolean(falseBool)).to.equal(false);
      });
    }
    for (let trueBool of trueBools) {
      it(`parameter ${typeof trueBool === 'string' ? `"${trueBool}"` : trueBool} should return false`, () => {
        expect(serviceHelper.ensureBoolean(trueBool)).to.equal(true);
      });
    }
    for (let truthyValue of restOfTruthyValues) {
      it(`parameter ${typeof truthyValue === 'string' ? `"${truthyValue}"` : truthyValue} should return undefined`, () => {
        expect(serviceHelper.ensureBoolean(truthyValue)).to.be.undefined;
      });
    }
    for (let falsyValue of restOfFalsyValues) {
      it(`parameter ${typeof falsyValue === 'string' ? `"${falsyValue}"` : falsyValue} should return undefined`, () => {
        expect(serviceHelper.ensureBoolean(falsyValue)).to.be.undefined;
      });
    }
    it('empty parameter should return undefined', () => {
      expect(serviceHelper.ensureBoolean()).to.be.undefined;
    });
  });

  describe('ensureNumber function tests', () => {
    it('parameter 1 should return 1', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber(1);
      const expected = 1;

      expect(ensureNumberOutput).to.equal(expected)
      expect(ensureNumberOutput).to.be.a('number')
    });
    it('parameter "1" should return 1', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber("1");
      const expected = 1;

      expect(ensureNumberOutput).to.equal(expected)
      expect(ensureNumberOutput).to.be.a('number')
    });
    it('parameter "2.5" should return 2.5', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber("2.5");
      const expected = 2.5;

      expect(ensureNumberOutput).to.equal(expected)
      expect(ensureNumberOutput).to.be.a('number')
    });
    it('parameter 2.5 should return 2.5', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber(2.5);
      const expected = 2.5;

      expect(ensureNumberOutput).to.equal(expected)
      expect(ensureNumberOutput).to.be.a('number')
    });
    it('parameter "test" should return NaN', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber("test");

      expect(ensureNumberOutput).to.be.NaN
    });
    it('parameter {name: 1} should return NaN', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber({ name: 1 });

      expect(ensureNumberOutput).to.be.NaN
    });
  });

  describe('ensureObject tests', () => {
    it('parameter of type object should return the same object', () => {
      const testObject = {
        id: 1,
        username: 'Testing user'
      }

      const ensureObjectOutput = serviceHelper.ensureObject(testObject);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.equal(testObject);
    });

    it('empty parameter should return an empty object', () => {
      const ensureObjectOutput = serviceHelper.ensureObject();

      expect(ensureObjectOutput).to.be.an('object').that.is.empty;
    });

    it('parameter of type json string should return an object', () => {
      const stringObject = '{"id": 1,"username": "Testing user"}';
      const expected = {
        id: 1,
        username: 'Testing user'
      }

      const ensureObjectOutput = serviceHelper.ensureObject(stringObject);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.eql(expected);
    });

    it('parameter of type query string should return an object', () => {
      const queryString = 'username=Tester&id=1';
      const expected = {
        id: '1',
        username: 'Tester'
      }

      const ensureObjectOutput = serviceHelper.ensureObject(queryString);

      expect(ensureObjectOutput).to.be.an('object');
      expect(ensureObjectOutput).to.eql(expected);
    });

    it('parameter of type string should return an object', () => {
      const testString = 'test';
      const expected = {
        test: "",
      }

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

    const otherTypes = [1, true]
    for (let param of otherTypes) {
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
        username: 'Testing user'
      }
      const expected = '{"id":1,"username":"Testing user"}'

      const ensureStringOutput = serviceHelper.ensureString(testObject);

      expect(ensureStringOutput).to.be.a('string');
      expect(ensureStringOutput).to.eql(expected);
    });

    it('parameter of type number should return a string', () => {
      const testNumber = 42;
      const expected = '42'

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

      const createDataMessageOutput = serviceHelper.createDataMessage(testData);

      expect(createDataMessageOutput.status).to.equal('success');
      expect(createDataMessageOutput.data).to.equal(testData);
    });
  });

  describe('createSuccessMessage tests', () => {
    it('should return a proper data message when called correctly', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = 'Your funds were transfered properly!';

      const createSuccessMessageOutput = serviceHelper.createSuccessMessage(message, name, code);

      expect(createSuccessMessageOutput.status).to.equal('success');
      expect(createSuccessMessageOutput.data.code).to.equal(code);
      expect(createSuccessMessageOutput.data.name).to.equal(name);
      expect(createSuccessMessageOutput.data.message).to.equal(message);
    });
  });

  describe('createSuccessMessage tests', () => {
    it('should return a proper success message when called with all parameters', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = 'Your funds were transfered properly!';

      const createSuccessMessageOutput = serviceHelper.createSuccessMessage(message, name, code);

      expect(createSuccessMessageOutput.status).to.equal('success');
      expect(createSuccessMessageOutput.data.code).to.equal(code);
      expect(createSuccessMessageOutput.data.name).to.equal(name);
      expect(createSuccessMessageOutput.data.message).to.equal(message);
    });

    it('should return a proper success message when called with empty message', () => {
      const code = 200;
      const name = 'Successful transfer';
      const message = '';

      const createSuccessMessageOutput = serviceHelper.createSuccessMessage(message, name, code);

      expect(createSuccessMessageOutput.status).to.equal('success');
      expect(createSuccessMessageOutput.data.code).to.equal(code);
      expect(createSuccessMessageOutput.data.name).to.equal(name);
      expect(createSuccessMessageOutput.data.message).to.equal(message);
    });
  });

  describe('createWarningMessage tests', () => {
    it('should return a proper warning message when called with all parameters', () => {
      const code = 214;
      const name = 'Warning!';
      const message = 'There was a slight issue!';

      const createWarningMessageOutput = serviceHelper.createWarningMessage(message, name, code);

      expect(createWarningMessageOutput.status).to.equal('warning');
      expect(createWarningMessageOutput.data.code).to.equal(code);
      expect(createWarningMessageOutput.data.name).to.equal(name);
      expect(createWarningMessageOutput.data.message).to.equal(message);
    });

    it('should return a proper warning message when called with empty message', () => {
      const code = 214;
      const name = 'Warning!';
      const message = '';

      const createSuccessMessageOutput = serviceHelper.createWarningMessage(message, name, code);

      expect(createSuccessMessageOutput.status).to.equal('warning');
      expect(createSuccessMessageOutput.data.code).to.equal(code);
      expect(createSuccessMessageOutput.data.name).to.equal(name);
      expect(createSuccessMessageOutput.data.message).to.equal(message);
    });
  });

  describe('createErrorMessage tests', () => {
    it('should return a proper error message when called with all parameters', () => {
      const code = 503;
      const name = 'Error happened!!';
      const message = 'There was a big error!';

      const createErrorMessageOutput = serviceHelper.createErrorMessage(message, name, code);

      expect(createErrorMessageOutput.status).to.equal('error');
      expect(createErrorMessageOutput.data.code).to.equal(code);
      expect(createErrorMessageOutput.data.name).to.equal(name);
      expect(createErrorMessageOutput.data.message).to.equal(message);
    });

    it('should return a proper error message when called with empty message', () => {
      const code = 503;
      const name = 'Error happened!!';
      const message = '';
      const expectedMessage = 'Unknown error';

      const createErrorMessageOutput = serviceHelper.createErrorMessage(message, name, code);

      expect(createErrorMessageOutput.status).to.equal('error');
      expect(createErrorMessageOutput.data.code).to.equal(code);
      expect(createErrorMessageOutput.data.name).to.equal(name);
      expect(createErrorMessageOutput.data.message).to.equal(expectedMessage);
    });
  });

  describe('errUnauthorizedMessage tests', () => {
    it('should return a proper unauthorized message when called', () => {
      const code = 401;
      const name = 'Unauthorized';
      const message = 'Unauthorized. Access denied.';

      const errUnauthorizedMessageOutput = serviceHelper.errUnauthorizedMessage(message, name, code);

      expect(errUnauthorizedMessageOutput.status).to.equal('error');
      expect(errUnauthorizedMessageOutput.data.code).to.equal(code);
      expect(errUnauthorizedMessageOutput.data.name).to.equal(name);
      expect(errUnauthorizedMessageOutput.data.message).to.equal(message);
    });
  });

  describe('getApplicationOwner tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.appsglobal.database)
      const collection = config.database.appsglobal.collections.appsInformation
      const insertApp = {
        "_id": ObjectId("6147045cd774409b374d253d"),
        "name": "PolkadotNode",
        "commands": [],
        "containerData": "/chaindata",
        "containerPorts": [
          "30333",
          "9933",
          "9944"
        ],
        "cpu": 0.8,
        "description": "Polkadot is a heterogeneous multi-chain interchange.",
        "domains": [
          "polkadot.runonflux.io",
          "polkadot.runonflux.io",
          "polkadot.runonflux.io"
        ],
        "enviromentParameters": [],
        "hash": "6f03b288240df90eb0d5a77c17c8fbea091619926ae66062da639b798fcf4ee5",
        "hdd": 20,
        "height": 988063,
        "owner": "196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH",
        "ports": [
          "31116",
          "31115",
          "31114"
        ],
        "ram": 1800,
        "repotag": "runonflux/polkadot-docker:latest",
        "tiered": false,
        "version": 2
      }

      await database.collection(collection).drop();
      await serviceHelper.insertOneToDatabase(database, collection, insertApp);
    });

    it("should return application owner if app exists in database", async () => {
      const appOwner = '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH';
      const getOwnerResult = await serviceHelper.getApplicationOwner('PolkadotNode');

      expect(getOwnerResult).to.equal(appOwner);
    });

    it("should return application owner if app is in available apps, but not in db", async () => {
      const appOwner = '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC';
      const getOwnerResult = await serviceHelper.getApplicationOwner('FoldingAtHomeB');

      expect(getOwnerResult).to.equal(appOwner);
    });

    it("should return null if the app does not exist", async () => {
      const getOwnerResult = await serviceHelper.getApplicationOwner('testing');

      expect(getOwnerResult).to.be.null;
    });
  });

  
});

