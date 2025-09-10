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
        _id: new ObjectId('6147045cd774409b374d253d'),
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
      _id: new ObjectId('620bba81c04b4966674013a4'),
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
        stdout: '',
        stderr: '',
      };

      const response = await serviceHelper.runCommand();

      expect(response).to.be.deep.equal(expected);
    });

    it('should return error if params are not an Array', async () => {
      const expected = {
        error: new Error(
          'Invalid params for command, must be an Array of strings',
        ),
        stdout: '',
        stderr: '',
      };

      const response = await serviceHelper.runCommand('testCmd', { params: {} });

      expect(response).to.be.deep.equal(expected);
    });

    it('should return error if param elements are not of correct type', async () => {
      const expected = {
        error: new Error(
          'Invalid params for command, must be an Array of strings',
        ),
        stdout: '',
        stderr: '',
      };

      const response = await serviceHelper.runCommand('testCmd', { params: ['test', {}] });

      expect(response).to.be.deep.equal(expected);
    });

    it('should run command as sudo if runAsRoot options passed', async () => {
      const expected = {
        error: null,
        stdout: 'test output',
        stderr: '',
      };

      runCmdStub.resolves({ stdout: 'test output', stderr: '', error: null });

      const response = await serviceHelper.runCommand('testCmd', { runAsRoot: true });

      expect(response).to.be.deep.equal(expected);
      sinon.assert.calledOnceWithExactly(runCmdStub, 'sudo', ['testCmd'], { timeout: 900000 });
      sinon.assert.calledOnceWithExactly(debugSpy, 'Run Cmd: sudo testCmd');
    });

    it('should set async lock if command is run exclusively', async () => {
      const expected = {
        error: null,
        stdout: 'test output',
        stderr: '',
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
      sinon.assert.calledOnceWithExactly(runCmdStub, 'testCmd', [], { timeout: 900000 });
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
      sinon.assert.calledOnceWithExactly(runCmdStub, 'testCmd', [], { timeout: 900000 });
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
      sinon.assert.calledOnceWithExactly(runCmdStub, 'testCmd', [], { timeout: 900000 });
      sinon.assert.notCalled(errorSpy);
    });
    it('should pass along any exec options to execFile', async () => {
      const expected = {
        error: null,
        stdout: 'Test output',
        stderr: '',
      };

      runCmdStub.resolves(expected);

      const response = await serviceHelper.runCommand('testCmd', { cwd: '/home/testuser' });

      expect(response).to.be.deep.equal(expected);
      sinon.assert.calledOnceWithExactly(runCmdStub, 'testCmd', [], { cwd: '/home/testuser', timeout: 900000 });
      sinon.assert.notCalled(errorSpy);
    });
  });

  describe('minVersionSatisfy tests', () => {
    const minimalVersion = '3.4.12';
    const majorMinorOnly = '3.4';
    const majorOnly = '20230311';

    it('should return true if major version is higher than minimalVersion', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('5.0.0', minimalVersion);

      expect(versionAllowed).to.equal(true);
    });

    it('should return true if minor version is higher than minimalVersion', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('3.6.0', minimalVersion);

      expect(versionAllowed).to.equal(true);
    });

    it('should return true if patch version is higher than minimalVersion', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('3.4.13', minimalVersion);

      expect(versionAllowed).to.equal(true);
    });

    it('should return true if patch version is equal to minimalVersion', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('3.4.12', minimalVersion);

      expect(versionAllowed).to.equal(true);
    });

    it('should return false if patch version is below to minimalVersion', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('3.4.11', minimalVersion);

      expect(versionAllowed).to.equal(false);
    });

    it('should return false if minor version is below to minimalVersion', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('3.3.11', minimalVersion);

      expect(versionAllowed).to.equal(false);
    });

    it('should return false if major version is below to minimalVersion', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('2.3.11', minimalVersion);

      expect(versionAllowed).to.equal(false);
    });

    it('should return false if minor version is below to minimalVersion and no patch', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('3.3', majorMinorOnly);

      expect(versionAllowed).to.equal(false);
    });

    it('should return false if major version is below to minimalVersion and no patch', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('2.3', majorMinorOnly);

      expect(versionAllowed).to.equal(false);
    });

    it('should return true if major version is higher than minimalVersion and no patch', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('4.0', majorMinorOnly);

      expect(versionAllowed).to.equal(true);
    });

    it('should return true if minor version is higher than minimalVersion and no patch', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('3.6', majorMinorOnly);

      expect(versionAllowed).to.equal(true);
    });

    it('should return true if major version is higher than minimalVersion and no minor or patch', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('20240507', majorOnly);

      expect(versionAllowed).to.equal(true);
    });

    it('should return false if major version is lower than minimalVersion and no minor or patch', async () => {
      const versionAllowed = await serviceHelper.minVersionSatisfy('20221023', majorOnly);

      expect(versionAllowed).to.equal(false);
    });
  });

  describe('parseVersion tests', () => {
    it('should parse all semantic versions and also dpkg versions', () => {
      const versions = [
        ['20230311ubuntu0.22.04.1', '20230311'],
        ['1.2', '1.2'],
        ['5.7-prerelease', '5.7'],
        ['1.218-4ubuntu1', '1.218'],
        ['1.219~d12', '1.219'],
        ['0.0.4', '0.0.4'],
        ['1.2.3', '1.2.3'],
        ['10.20.30', '10.20.30'],
        ['1.1.2-prerelease+meta', '1.1.2'],
        ['1.1.2+meta', '1.1.2'],
        ['1.0.0-alpha', '1.0.0'],
        ['1.0.0-alpha.beta', '1.0.0'],
        ['1.0.0-alpha.1', '1.0.0'],
        ['1.0.0-alpha.0valid', '1.0.0'],
        ['1.0.0-rc.1+build.1', '1.0.0'],
        ['1.2.3-beta', '1.2.3'],
        ['10.2.3-DEV-SNAPSHOT', '10.2.3'],
        ['1.2.3-SNAPSHOT-123', '1.2.3'],
        ['1.0.0', '1.0.0'],
        ['2.0.0+build.1848', '2.0.0'],
        ['2.0.1-alpha.1227', '2.0.1'],
        ['1.0.0-alpha+beta', '1.0.0'],
        ['1.2.3----RC-SNAPSHOT.12.9.1--.12+788', '1.2.3'],
        ['5:26.1.3-1~ubuntu.22.04~jammy', '26.1.3'],
      ];

      for (let index = 0; index < versions.length; index += 1) {
        const { version } = serviceHelper.parseVersion(versions[index][0]);
        expect(version).to.equal(versions[index][1]);
      }
    });
  });

  describe('parseInterval tests', () => {
    it('should parse all time intervals', () => {
      const failureValue = 1_000;

      const intervals = [
        [{ bad: 'input' }, failureValue],
        [['bad', 'input'], failureValue],
        [new Error('Bad input'), failureValue],
        ['', failureValue],
        [-3600, failureValue],
        ['-3600', failureValue],
        ['bad timer', failureValue],
        ['3 minutes 30', failureValue],
        ['0 minutes 0 seconds', 0],
        ['0sec', 0],
        ['0', 0],
        [0, 0],
        [null, failureValue],
        [undefined, failureValue],
        ['5 years', failureValue],
        ['-5 minutes', failureValue],
        ['-123.55', failureValue],
        ['123..55', failureValue],
        ['12.3.55', failureValue],
        [123.55, 123],
        ['123.55', 123],
        [300, 300],
        [+300, 300],
        ['3600', 3600],
        ['+3600', 3600],
        ['15s', 15_000],
        ['15sec', 15_000],
        ['15secs', 15_000],
        ['15second', 15_000],
        ['15seconds', 15_000],
        ['15 seconds', 15_000],
        [' 15    seconds ', 15_000],
        ['3 minutes 30 seconds', 210_000],
        ['3m30s', 210_000],
        ['3M30S', 210_000],
        ['3M30s', 210_000],
        ['3 minute 30 sec', 210_000],
        ['3minute 30 sec', 210_000],
        ['3minute 30 seconds', 210_000],
        ['3MINUTES 30 SECONDS', 210_000],
        ['3 hours 3 minutes 30 seconds', 11_010_000],
        ['1 day 3 hours 3 minutes 30 seconds', 97_410_000],
        ['1 days 3 hours 3 minutes 30 seconds', 97_410_000],
        ['1day', 86_400_000],
        ['6hrs', 21_600_000],
        ['6hours', 21_600_000],
        ['3days 3 hours', 270_000_000],
        ['30000 days', 2_147_483_647],
      ];

      for (let index = 0; index < intervals.length; index += 1) {
        const interval = serviceHelper.parseInterval(intervals[index][0]);
        expect(interval).to.equal(intervals[index][1]);
      }
    });
  });

  describe('randomDelayMs tests', () => {
    it('should return the same delay for the same initializer', () => {
      const initializer = '1.1.1.11976543';

      const result1 = serviceHelper.randomDelayMs(10_000, { initializer });
      const result2 = serviceHelper.randomDelayMs(10_000, { initializer });
      expect(result1).to.equal(result2);
    });

    it('should return a different delay for a different initializer', () => {
      const initializer1 = '1.1.1.11976543';
      const initializer2 = '1.1.1.11976544';

      const result1 = serviceHelper.randomDelayMs(10_000, { initializer1 });
      const result2 = serviceHelper.randomDelayMs(10_000, { initializer2 });
      expect(result1).to.not.equal(result2);
    });

    it('should always return a random delay between the min and max', () => {
      const ip = '1.1.1.1';
      const block = 2_000_000;

      const minSize = 10_000;
      const maxSize = 100_000;

      for (let i = 0; i < 10_000; i += 1) {
        const initializer = ip + (block + i);
        const result = serviceHelper.randomDelayMs(
          maxSize,
          { initializer, minDelayMs: minSize },
        );

        expect(result).to.be.greaterThanOrEqual(minSize);
        expect(result).to.be.lessThanOrEqual(maxSize);
      }
    });

    it('should return a different random number if no initializer is used', () => {
      const maxSize = Number.MAX_VALUE;

      const valueCount = 1000;
      // since we are using random, there is a chance, lol, like a small chance,
      // that we can get the same number. To make sure this chance is essentially
      // zero, we allow for 5 same numbers
      const expectedCount = 995;

      const numbers = Array(valueCount).fill().map(
        () => serviceHelper.randomDelayMs(maxSize),
      );

      const unique = new Set(numbers);

      expect(unique.size).to.be.greaterThanOrEqual(expectedCount);
    });
  });
});
