const chai = require('chai');
const config = require('config');
const { ObjectId } = require('mongodb');
var proxyquire = require('proxyquire');
const expect = chai.expect;

let serviceHelper = require("../../ZelBack/src/services/serviceHelper");

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    testnet: true
  }
}
serviceHelper = proxyquire('../../ZelBack/src/services/serviceHelper',
  { '../../../config/userconfig': adminConfig });


describe('serviceHelper tests', () => {
  describe('ensureBoolean function tests', () => {
    const falseBools = ['false', false, 0, '0'];
    const trueBools = ['true', true, 1, '1'];
    const restOfTruthyValues = [3, 3n, 'test', [1, 2], { name: 'testobject' }];
    const restOfFalsyValues = [0n, null, undefined, NaN, ''];

    for (let falseBool of falseBools) {
      it(`parameter ${falseBool} of type ${typeof falseBool} should return false`, () => {
        expect(serviceHelper.ensureBoolean(falseBool)).to.equal(false);
      });
    }

    for (let trueBool of trueBools) {
      it(`parameter ${trueBool} of type ${typeof trueBool}  should return false`, () => {
        expect(serviceHelper.ensureBoolean(trueBool)).to.equal(true);
      });
    }

    for (let truthyValue of restOfTruthyValues) {
      it(`parameter ${truthyValue} of type ${typeof truthyValue}  should return undefined`, () => {
        expect(serviceHelper.ensureBoolean(truthyValue)).to.be.undefined;
      });
    }

    for (let falsyValue of restOfFalsyValues) {
      it(`parameter ${falsyValue} of type ${typeof falsyValue}  should return undefined`, () => {
        expect(serviceHelper.ensureBoolean(falsyValue)).to.be.undefined;
      });
    }

    it('empty parameter should return undefined', () => {
      expect(serviceHelper.ensureBoolean()).to.be.undefined;
    });
  });

  describe('ensureNumber function tests', () => {
    const numbersList = [1, '1', 2.5, '2.5']

    for (let number of numbersList) {
      it(`parameter ${number} should return number value`, () => {
        const ensureNumberOutput = serviceHelper.ensureNumber(1);

        expect(ensureNumberOutput).to.be.a('number')
      });
    }

    it('parameter "test" of type string should return NaN', () => {
      const ensureNumberOutput = serviceHelper.ensureNumber("test");

      expect(ensureNumberOutput).to.be.NaN
    });
    it('parameter {name: 1} of type object should return NaN', () => {
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
      stringObject = JSON.stringify({ "id": 1, "username": "Testing user" })
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
        "_id": ObjectId("6147045cd774409b374d253d"),
        "name": "PolkadotNode",
        "description": "Polkadot is a heterogeneous multi-chain interchange.",
        "owner": "196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH",
      }

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }
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

  describe('verifyAdminSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const insertUsers = [{
        "_id": ObjectId("60cad0767247ac0a779fb3f0"),
        "zelid": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC", // admin
        "loginPhrase": "16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9",
        "signature": "IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc="
      }, {
        "_id": ObjectId("6108fbb9f04dfe1ef624b819"),
        "zelid": "1hjy4bCYBJr4mny4zCE85J94RXa8W6q37",  // regular user
        "loginPhrase": "162797868130153vt9r89dzjjjfg6kf34ntf1d8aa5zqlk04j3zy8z40ni",
        "signature": "H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4="
      }];

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      for (let insertUser of insertUsers) {
        await serviceHelper.insertOneToDatabase(database, collection, insertUser);
      }
    });

    it("should return true when requested by admin", async () => {
      const headers = {
        zelidauth: {
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      }

      const isAdmin = await serviceHelper.verifyAdminSession(headers);

      expect(isAdmin).to.be.true;
    });

    it("should return false when requested by regular user", async () => {
      const headers = {
        zelidauth: {
          zelid: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
          signature: 'H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4='
        }
      }

      const isAdmin = await serviceHelper.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });

    it("should return false if signature is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtzMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      }

      const isAdmin = await serviceHelper.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });

    it("should return false if zelID is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '2CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      }

      const isAdmin = await serviceHelper.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });

    it("should return false if header values are empty", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      }

      const isAdmin = await serviceHelper.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });

    it("should return false if header is empty", async () => {
      const headers = {}

      const isAdmin = await serviceHelper.verifyAdminSession(headers);

      expect(isAdmin).to.be.false;
    });
  });

  describe('verifyUserSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const insertUser = {
        "_id": ObjectId("601f403878cbf33af2b07e63"),
        "zelid": "1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t",
        "loginPhrase": "16126607802409ki3t43zmwinlys5p0dxaokf420w59gvrio2bij61dzs",
        "signature": "IMDMG1GuDasjPMkrGaRQhkLpFO0saBV+v+N6h3wP6/QlF3J9ymLAPZy7DCBd/RnOSzUxmTHruenVeR7LghzRnHA="
      }

      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      await serviceHelper.insertOneToDatabase(database, collection, insertUser);
    });

    it("should return true when requested by logged user", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'IMDMG1GuDasjPMkrGaRQhkLpFO0saBV+v+N6h3wP6/QlF3J9ymLAPZy7DCBd/RnOSzUxmTHruenVeR7LghzRnHA='
        }
      }

      const isLoggedUser = await serviceHelper.verifyUserSession(headers);

      expect(isLoggedUser).to.be.true;
    });

    it("should return false if called with a wrong zelid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBu9t',
          signature: 'IMDMG1GuDasjPMkrGaRQhkLpFO0saBV+v+N6h3wP6/QlF3J9ymLAPZy7DCBd/RnOSzUxmTHruenVeR7LghzRnHA='
        }
      }

      const isLoggedUser = await serviceHelper.verifyUserSession(headers);

      expect(isLoggedUser).to.be.false;
    });

    it("should return false if called with a wrong signature", async () => {
      const headers = {
        zelidauth: {
          zelid: '1LZe3AUYQC4aT5YWLhgEcH1nLLdoKNBi9t',
          signature: 'IMDMG1GuDasjPMkrGaRQhkLpFO0saBZ+v+N6h3wP6/QlF3J9ymLAPZy7DCBd/RnOSzUxmTHruenVeR7LghzRnHA='
        }
      }

      const isLoggedUser = await serviceHelper.verifyUserSession(headers);

      expect(isLoggedUser).to.be.false;
    });
    it("should return false if called with no header", async () => {
      const isLoggedUser = await serviceHelper.verifyUserSession();

      expect(isLoggedUser).to.be.false;
    });

    it("should return false if called with empty data", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      }

      const isLoggedUser = await serviceHelper.verifyUserSession(headers);

      expect(isLoggedUser).to.be.false;
    });
  });

  describe('verifyFluxTeamSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const insertUsers = [{
        "_id": ObjectId("60cad0767247ac0a779fb3f0"),
        "zelid": "1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM",  // flux team
        "loginPhrase": "1623904359736pja76q7y68deb4264olbml6o8gyhot2yvj5oevgv9k2",
        "signature": "H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II="
      }, {
        "_id": ObjectId("6108fbb9f04dfe1ef624b819"),
        "zelid": "1hjy4bCYBJr4mny4zCE85J94RXa8W6q37", // regular user
        "loginPhrase": "162797868130153vt9r89dzjjjfg6kf34ntf1d8aa5zqlk04j3zy8z40ni",
        "signature": "H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4="
      }];
      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      for (let insertUser of insertUsers) {
        await serviceHelper.insertOneToDatabase(database, collection, insertUser);
      }
    });

    it("should return true when requested by the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isFluxTeamSession = await serviceHelper.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.true;
    });

    it("should return false when zelid is not the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
          signature: 'H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4='
        }
      };

      const isFluxTeamSession = await serviceHelper.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });


    it("should return false when signature is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'N4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isFluxTeamSession = await serviceHelper.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when zelid is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP1z5Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isFluxTeamSession = await serviceHelper.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when data is empty", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      };

      const isFluxTeamSession = await serviceHelper.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when data are true bools", async () => {
      const headers = {
        zelidauth: {
          zelid: true,
          signature: true
        }
      };

      const isFluxTeamSession = await serviceHelper.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when header is empty", async () => {
      const headers = {};

      const isFluxTeamSession = await serviceHelper.verifyFluxTeamSession(headers);

      expect(isFluxTeamSession).to.be.false;
    });

    it("should return false when no header is passed", async () => {
      const isFluxTeamSession = await serviceHelper.verifyFluxTeamSession();

      expect(isFluxTeamSession).to.be.false;
    });
  });

  describe('verifyAdminAndFluxTeamSession tests', () => {
    beforeEach(async () => {
      await serviceHelper.initiateDB();
      const db = serviceHelper.databaseConnection();
      const database = db.db(config.database.local.database);
      const collection = config.database.local.collections.loggedUsers;
      const insertUsers = [{
        "_id": ObjectId("61967125f3178f082a296100"),
        "zelid": "1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM",   // Flux team
        "loginPhrase": "1623904359736pja76q7y68deb4264olbml6o8gyhot2yvj5oevgv9k2",
        "signature": "H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II="
      }, {
        "_id": ObjectId("6108fbb9f04dfe1ef624b819"),
        "zelid": "1hjy4bCYBJr4mny4zCE85J94RXa8W6q37",  // regular user
        "loginPhrase": "162797868130153vt9r89dzjjjfg6kf34ntf1d8aa5zqlk04j3zy8z40ni",
        "signature": "H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4="
      }, {
        "_id": ObjectId("60cad0767247ac0a779fb3f0"),
        "zelid": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC", // admin
        "loginPhrase": "16125160820394ddsh5skgwv0ipodku92y0jbwvpyj17bh68lzrjlxq9",
        "signature": "IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc="
      }
      ];
      try {
        await database.collection(collection).drop();
      } catch (err) {
        console.log('Collection not found.');
      }

      for (let insertUser of insertUsers) {
        await serviceHelper.insertOneToDatabase(database, collection, insertUser);
      }
    });

    it("should return true when requested by the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.true;
    });

    it("should return true when requested by the admin", async () => {
      const headers = {
        zelidauth: {
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          signature: 'IH9d68fk/dYQtuMlNN7ioc52MJ6ryRT0IYss6h/KCwVWGcbVNFoI8Jh6hIklRq+w2itV/6vs/xzCWp4TUdSWDBc='
        }
      };

      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.true;
    });

    it("should return false when zelid is not the flux team", async () => {
      const headers = {
        zelidauth: {
          zelid: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
          signature: 'H9oD/ZA7mEVQMWYWNIGDF7T2J++R/EG8tYPfB+fQ+XvQIbOXIcBEhxZwPYmh0HRj531oMc/HfcXPAYjWlN9wCn4='
        }
      };

      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });


    it("should return false when signature is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'N4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when zelid is invalid", async () => {
      const headers = {
        zelidauth: {
          zelid: '1NH9BP1z5Rp3HSf5ef6NpUbE8JcyLRruAM',
          signature: 'H4lWS4PcrR1tMo8RCLzeYYrd042tsJC9PteIKZvn091ZAYE4K9ydfri8M1KKWe905NHdS4LPPsClqvA4nY/G+II='
        }
      };

      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when data is empty", async () => {
      const headers = {
        zelidauth: {
          zelid: '',
          signature: ''
        }
      };

      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when data are true bools", async () => {
      const headers = {
        zelidauth: {
          zelid: true,
          signature: true
        }
      };

      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when header is empty", async () => {
      const headers = {};

      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession(headers);

      expect(isAdminOrFluxTeam).to.be.false;
    });

    it("should return false when no header is passed", async () => {
      const isAdminOrFluxTeam = await serviceHelper.verifyAdminAndFluxTeamSession();

      expect(isAdminOrFluxTeam).to.be.false;
    });
  });
});

