/* eslint-disable no-restricted-syntax */
const chai = require('chai');
const sinon = require('sinon');
const config = require('config');
const { ObjectId } = require('mongodb');
const proxyquire = require('proxyquire');

const { expect } = chai;

const log = require('../../ZelBack/src/lib/log');
const dbHelper = require('../../ZelBack/src/services/dbHelper');

const adminConfig = {
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    testnet: true,
  },
};

const runCmdStub = sinon.stub();
const utilFake = { promisify: () => runCmdStub };

const serviceHelper = proxyquire(
  '../../ZelBack/src/services/serviceHelper',
  { '../../../config/userconfig': adminConfig, 'node:util': utilFake },
);

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

  describe('commandStringToArray tests', () => {
    beforeEach(() => { });
    afterEach(() => { });

    it('should split double quoted string', () => {
      const i = " I  said 'I am sorry.', and he said \"it doesn't matter.\" ";
      const o = serviceHelper.commandStringToArray(i);
      expect(o).to.have.lengthOf(7);
      expect(o[0]).to.equal('I');
      expect(o[1]).to.equal('said');
      expect(o[2]).to.equal('I am sorry.,');
      expect(o[3]).to.equal('and');
      expect(o[4]).to.equal('he');
      expect(o[5]).to.equal('said');
      expect(o[6]).to.equal("it doesn't matter.");
    });

    it('should split pure double quoted string', () => {
      const i = 'I said "I am sorry.", and he said "it doesn\'t matter."';
      const o = serviceHelper.commandStringToArray(i);
      expect(o).to.have.lengthOf(7);
      expect(o[0]).to.equal('I');
      expect(o[1]).to.equal('said');
      expect(o[2]).to.equal('I am sorry.,');
      expect(o[3]).to.equal('and');
      expect(o[4]).to.equal('he');
      expect(o[5]).to.equal('said');
      expect(o[6]).to.equal("it doesn't matter.");
    });

    it('should split single quoted string', () => {
      const i = 'I said "I am sorry.", and he said "it doesn\'t matter."';
      const o = serviceHelper.commandStringToArray(i);
      expect(o).to.have.lengthOf(7);
      expect(o[0]).to.equal('I');
      expect(o[1]).to.equal('said');
      expect(o[2]).to.equal('I am sorry.,');
      expect(o[3]).to.equal('and');
      expect(o[4]).to.equal('he');
      expect(o[5]).to.equal('said');
      expect(o[6]).to.equal("it doesn't matter.");
    });

    it('should split pure single quoted string', () => {
      const i = "I said 'I am sorry.', and he said \"it doesn't matter.\"";
      const o = serviceHelper.commandStringToArray(i);
      expect(o).to.have.lengthOf(7);
      expect(o[0]).to.equal('I');
      expect(o[1]).to.equal('said');
      expect(o[2]).to.equal('I am sorry.,');
      expect(o[3]).to.equal('and');
      expect(o[4]).to.equal('he');
      expect(o[5]).to.equal('said');
      expect(o[6]).to.equal("it doesn't matter.");
    });
  });
  describe('runCommand tests', () => {
    let debugSpy;
    let infoSpy;
    let errorSpy;

    beforeEach(() => {
      debugSpy = sinon.spy(log, 'debug');
      infoSpy = sinon.spy(log, 'info');
      errorSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
      // this must be called as sinon.restore() doesn't work when the stub is
      // passed into proxy
      runCmdStub.reset();
    });

    it('should return error if no command is passed', async () => {
      const expected = {
        error: new Error('Command must be present'),
        stdout: null,
        stderr: null,
      };

      const response = await serviceHelper.runCommand();

      expect(response).to.be.deep.equal(expected);
    });

    it('should return error if params are not an Array', async () => {
      const expected = {
        error: new Error(
          'Invalid params for command, must be an Array of strings',
        ),
        stdout: null,
        stderr: null,
      };

      const response = await serviceHelper.runCommand('testCmd', { params: {} });

      expect(response).to.be.deep.equal(expected);
    });

    it('should return error if param elements are not of correct type', async () => {
      const expected = {
        error: new Error(
          'Invalid params for command, must be an Array of strings',
        ),
        stdout: null,
        stderr: null,
      };

      const response = await serviceHelper.runCommand('testCmd', { params: ['test', {}] });

      expect(response).to.be.deep.equal(expected);
    });

    it('should run command as sudo if runAsRoot options passed', async () => {
      const expected = {
        error: null,
        stdout: 'test output',
        stderr: null,
      };

      runCmdStub.resolves({ stdout: 'test output', stderr: null, error: null });

      const response = await serviceHelper.runCommand('testCmd', { runAsRoot: true });

      expect(response).to.be.deep.equal(expected);
      sinon.assert.calledOnceWithExactly(runCmdStub, 'sudo', ['testCmd'], {});
      sinon.assert.calledOnceWithExactly(debugSpy, 'Run Cmd: sudo testCmd');
    });

    it('should set async lock if command is run exclusively', async () => {
      const expected = {
        error: null,
        stdout: 'test output',
        stderr: null,
      };

      const clock = sinon.useFakeTimers();

      // a dummy command that takes 5 seconds
      const timeout = () => new Promise((r) => { setTimeout(() => r(expected), 5000); });

      runCmdStub.callsFake(timeout);

      const promises = [];

      promises.push(serviceHelper.runCommand('testCmd', { exclusive: true }));
      promises.push(serviceHelper.runCommand('testCmd', { exclusive: true }));

      // the runCmdStub waits 5 seconds, since the commands run one after the other,
      // we would expect at this point for the stub to only have been called once.
      await clock.tickAsync(3000);
      sinon.assert.calledOnce(runCmdStub);
      // advance to 6 seconds, should have been called again
      await clock.tickAsync(3000);
      sinon.assert.calledTwice(runCmdStub);
      // run out the rest of the clock
      await clock.tickAsync(4000);

      const responses = await Promise.all(promises);

      expect(responses[0]).to.be.deep.equal(expected);
      expect(responses[1]).to.be.deep.equal(expected);

      // check log order too
      expect(infoSpy.getCall(0).calledWithExactly('Exclusive lock enabled for command: testCmd'));
      expect(infoSpy.getCall(1).calledWithExactly('Exclusive lock disabled for command: testCmd'));
      expect(infoSpy.getCall(2).calledWithExactly('Exclusive lock enabled for command: testCmd'));
      expect(infoSpy.getCall(3).calledWithExactly('Exclusive lock disabled for command: testCmd'));
    });

    it('should return stdout and stderr', async () => {
      const expected = {
        error: null,
        stdout: 'test output',
        stderr: 'test stderr message',
      };

      runCmdStub.resolves({ stdout: 'test output', stderr: 'test stderr message', error: null });

      const response = await serviceHelper.runCommand('testCmd');

      expect(response).to.be.deep.equal(expected);
      sinon.assert.calledOnceWithExactly(runCmdStub, 'testCmd', [], {});
      sinon.assert.calledOnceWithExactly(debugSpy, 'Run Cmd: testCmd ');
    });

    it('should return error and log it if command causes an error', async () => {
      const expected = {
        error: new Error('Test Error'),
        stdout: '',
        stderr: '',
      };

      const error = new Error('Test Error');
      error.stdout = '';
      error.stderr = '';
      runCmdStub.rejects(error);

      const response = await serviceHelper.runCommand('testCmd');

      expect(response).to.be.deep.equal(expected);
      sinon.assert.calledOnceWithExactly(runCmdStub, 'testCmd', [], {});
      sinon.assert.calledOnceWithExactly(errorSpy, error);
    });
    it('should return error and not log it if command causes an error and logError is false', async () => {
      const expected = {
        error: new Error('Test Error'),
        stdout: '',
        stderr: '',
      };

      const error = new Error('Test Error');
      error.stdout = '';
      error.stderr = '';
      runCmdStub.rejects(error);

      const response = await serviceHelper.runCommand('testCmd', { logError: false });

      expect(response).to.be.deep.equal(expected);
      sinon.assert.calledOnceWithExactly(runCmdStub, 'testCmd', [], {});
      sinon.assert.notCalled(errorSpy);
    });
    it('should pass along any exec options to execFile', async () => {
      const expected = {
        error: null,
        stdout: 'Test output',
        stderr: null,
      };

      runCmdStub.resolves(expected);

      const response = await serviceHelper.runCommand('testCmd', { cwd: '/home/testuser' });

      expect(response).to.be.deep.equal(expected);
      sinon.assert.calledOnceWithExactly(runCmdStub, 'testCmd', [], { cwd: '/home/testuser' });
      sinon.assert.notCalled(errorSpy);
    });
  });
});
