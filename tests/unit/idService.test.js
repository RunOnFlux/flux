import chai from 'chai';
import sinon from 'sinon';
import chaiAsPromised from 'chai-as-promised';
import os from 'os';
import bitcoinMessage from 'bitcoinjs-message';
import proxyquire from 'proxyquire';
import { PassThrough } from 'stream';
import log from '../../ZelBack/src/lib/log.js';
log.default;

import dbHelper from '../../ZelBack/src/services/dbHelper.js';
dbHelper.default;
import verificationHelper from '../../ZelBack/src/services/verificationHelper.js';
verificationHelper.default;
import serviceHelper from '../../ZelBack/src/services/serviceHelper.js';
import generalService from '../../ZelBack/src/services/generalService.js';
generalService.default;
import dockerService from '../../ZelBack/src/services/dockerService.js';
dockerService.default;
import fluxNetworkHelper from '../../ZelBack/src/services/fluxNetworkHelper.js';

const adminConfig = {
  fluxTeamZelId: '1zasdfg',
  initial: {
    ipaddress: '83.51.212.243',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    kadena: '1234kadena',
    cruxid: '12345678',
    apiport: '5550',
    testnet: true,
  },
};

const idService = proxyquire('../../ZelBack/src/services/idService',
  { '../../../config/userconfig': adminConfig });

chai.use(chaiAsPromised);
const { expect } = chai;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  res.download = sinon.fake(() => 'File downloaded');
  return res;
};

describe('idService tests', () => {
  describe('confirmNodeTierHardware tests', () => {
    let osTotalmemStub;
    let osCpusStub;
    let tierStub;
    let collateralStub;
    let logSpy;

    beforeEach(() => {
      osTotalmemStub = sinon.stub(os, 'totalmem');
      osCpusStub = sinon.stub(os, 'cpus');
      tierStub = sinon.stub(generalService, 'nodeTier');
      collateralStub = sinon.stub(generalService, 'nodeCollateral');
      logSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false and log error if stratus (100000) has less than 8 cpu threads', async () => {
      tierStub.resolves('bamf');
      collateralStub.resolves(100000);
      osTotalmemStub.returns(30 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Cpu Threads (4) below Stratus requirements')));
    });

    it('should return false and log error if stratus (100000) has less than 30gb ram', async () => {
      tierStub.resolves('bamf');
      collateralStub.resolves(100000);
      osTotalmemStub.returns(29 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Total Ram (29) below Stratus requirements')));
    });

    it('should return true if stratus (100000) matches requirements', async () => {
      tierStub.resolves('bamf');
      collateralStub.resolves(100000);
      osTotalmemStub.returns(30 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should return false and log error if stratus (40000) has less than 16 cpu threads', async () => {
      tierStub.resolves('bamf');
      collateralStub.resolves(40000);
      osTotalmemStub.returns(61 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Cpu Threads (15) below new Stratus requirements')));
    });

    it('should return false and log error if stratus (40000) has less than 61gb ram', async () => {
      tierStub.resolves('bamf');
      collateralStub.resolves(40000);
      osTotalmemStub.returns(60 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Total Ram (60) below new Stratus requirements')));
    });

    it('should return true if stratus (40000) matches requirements', async () => {
      tierStub.resolves('bamf');
      collateralStub.resolves(40000);
      osTotalmemStub.returns(61 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should return false and log error if Nimbus (25000) has less than 4 cpu threads', async () => {
      tierStub.resolves('super');
      collateralStub.resolves(25000);
      osTotalmemStub.returns(7 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Cpu Threads (3) below Nimbus requirements')));
    });

    it('should return false and log error if Nimbus (25000) has less than 7gb ram', async () => {
      tierStub.resolves('super');
      collateralStub.resolves(25000);
      osTotalmemStub.returns(6 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Total Ram (6) below Nimbus requirements')));
    });

    it('should return true if Nimbus (25000) matches requirements', async () => {
      tierStub.resolves('super');
      collateralStub.resolves(25000);
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should return false and log error if Nimbus (12500) has less than 8 cpu threads', async () => {
      tierStub.resolves('super');
      collateralStub.resolves(12500);
      osTotalmemStub.returns(30 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Cpu Threads (7) below new Nimbus requirements')));
    });

    it('should return false and log error if Nimbus (12500) has less than 30gb ram', async () => {
      tierStub.resolves('super');
      collateralStub.resolves(12500);
      osTotalmemStub.returns(29 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Total Ram (29) below new Nimbus requirements')));
    });

    it('should return true if Nimbus (12500) matches requirements', async () => {
      tierStub.resolves('super');
      collateralStub.resolves(12500);
      osTotalmemStub.returns(30 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1, 1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should return false and log error if Cumulus (10000) has less than 2 cpu threads', async () => {
      tierStub.resolves('basic');
      collateralStub.resolves(10000);
      osTotalmemStub.returns(3 * 1024 ** 3);
      osCpusStub.returns([1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Cpu Threads (1) below Cumulus requirements')));
    });

    it('should return false and log error if Cumulus (10000) has less than 3gb ram', async () => {
      tierStub.resolves('basic');
      collateralStub.resolves(10000);
      osTotalmemStub.returns(2 * 1024 ** 3);
      osCpusStub.returns([1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Total Ram (2) below Cumulus requirements')));
    });

    it('should return true if Cumulus (10000) matches requirements', async () => {
      tierStub.resolves('basic');
      collateralStub.resolves(10000);
      osTotalmemStub.returns(3 * 1024 ** 3);
      osCpusStub.returns([1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(true);
      sinon.assert.notCalled(logSpy);
    });

    it('should return false and log error if Cumulus (1000) has less than 4 cpu threads', async () => {
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(3 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Cpu Threads (3) below new Cumulus requirements')));
    });

    it('should return false and log error if Cumulus (1000) has less than 3gb ram', async () => {
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(2 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(false);
      sinon.assert.calledWith(logSpy, sinon.match.instanceOf(Error).and(sinon.match.has('message', 'Node Total Ram (2) below new Cumulus requirements')));
    });

    it('should return true if Cumulus (1000) matches requirements', async () => {
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(3 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      const response = await idService.confirmNodeTierHardware();

      expect(response).to.eql(true);
      sinon.assert.notCalled(logSpy);
    });
  });

  describe('loginPhrase tests', () => {
    let osTotalmemStub;
    let osCpusStub;
    let tierStub;
    let collateralStub;
    let getDOSStateStub;

    beforeEach(() => {
      osTotalmemStub = sinon.stub(os, 'totalmem');
      osCpusStub = sinon.stub(os, 'cpus');
      tierStub = sinon.stub(generalService, 'nodeTier');
      collateralStub = sinon.stub(generalService, 'nodeCollateral');
      getDOSStateStub = sinon.stub(fluxNetworkHelper, 'getDOSState');
      // only checks for docker availablity
      sinon.stub(dockerService, 'dockerListImages').returns(true);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if hw reqs are not met', async () => {
      const res = generateResponse();
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(1 * 1024 ** 3);
      osCpusStub.returns([1]);
      const expectedResponse = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Node hardware requirements not met',
        },
      };

      await idService.loginPhrase(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if dos status returns an error', async () => {
      const res = generateResponse();
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      getDOSStateStub.returns({
        status: 'error',
        data: {
          dosState: null,
          dosMessage: null,
        },
      });

      const expectedResponse = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Unable to check DOS state',
        },
      };

      await idService.loginPhrase(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if dosState > 11 and message is Flux IP detection failed', async () => {
      const res = generateResponse();
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      getDOSStateStub.returns({
        status: 'success',
        data: {
          dosState: 11,
          dosMessage: 'Flux IP detection failed',
          nodeHardwareSpecsGood: true,
        },
      });

      const expectedResponse = {
        status: 'error',
        data: {
          code: 11,
          name: 'DOS',
          message: 'Flux IP detection failed',
        },
      };

      await idService.loginPhrase(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return error if dosState > 11 and message is Flux collision detection', async () => {
      const res = generateResponse();
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      getDOSStateStub.returns({
        status: 'success',
        data: {
          dosState: 11,
          dosMessage: 'Flux collision detection',
          nodeHardwareSpecsGood: true,
        },
      });

      const expectedResponse = {
        status: 'error',
        data: {
          code: 11,
          name: 'DOS',
          message: 'Flux collision detection',
        },
      };

      await idService.loginPhrase(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return CONNERROR error if dosState > 11 and message is anything else', async () => {
      const res = generateResponse();
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      getDOSStateStub.returns({
        status: 'success',
        data: {
          dosState: 11,
          dosMessage: 'test',
          nodeHardwareSpecsGood: true,
        },
      });

      const expectedResponse = {
        status: 'error',
        data: {
          code: 11,
          name: 'CONNERROR',
          message: 'test',
        },
      };

      await idService.loginPhrase(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return  error if nodeHardwareSpecsGood is false', async () => {
      const res = generateResponse();
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      getDOSStateStub.returns({
        status: 'success',
        data: {
          dosState: 11,
          dosMessage: 'test',
          nodeHardwareSpecsGood: false,
        },
      });

      const expectedResponse = {
        status: 'error',
        data: {
          code: 100,
          name: 'DOS',
          message: 'Minimum hardware required for FluxNode tier not met',
        },
      };

      await idService.loginPhrase(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return write new phrase into the db', async () => {
      const insertintoDBStub = sinon.stub(dbHelper, 'insertOneToDatabase').returns(true);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const res = generateResponse();
      tierStub.resolves('basic');
      collateralStub.resolves(1000);
      osTotalmemStub.returns(8 * 1024 ** 3);
      osCpusStub.returns([1, 1, 1, 1]);
      getDOSStateStub.returns({
        status: 'success',
        data: {
          dosState: 0,
          dosMessage: null,
          nodeHardwareSpecsGood: true,
        },
      });

      await idService.loginPhrase(undefined, res);

      sinon.assert.calledOnce(insertintoDBStub);
      sinon.assert.calledOnceWithMatch(res.json, { status: 'success', data: sinon.match.string });
    });
  });

  describe('emergencyPhrase tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should return error if db insert throws error', async () => {
      sinon.stub(dbHelper, 'insertOneToDatabase').throws('DB insert error', 'some message');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const res = generateResponse();
      const expectedResponse = {
        status: 'error',
        data: {
          code: undefined,
          name: 'DB insert error',
          message: 'some message',
        },
      };

      await idService.emergencyPhrase(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return write new emergency phrase into the db', async () => {
      const insertintoDBStub = sinon.stub(dbHelper, 'insertOneToDatabase').returns(true);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const res = generateResponse();

      await idService.emergencyPhrase(undefined, res);

      sinon.assert.calledOnce(insertintoDBStub);
      sinon.assert.calledOnceWithMatch(res.json, { status: 'success', data: sinon.match.string });
    });
  });

  describe('verifyLogin tests', () => {
    let bitcoinMessageStub;

    beforeEach(() => {
      bitcoinMessageStub = sinon.stub(bitcoinMessage, 'verify');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if neither zelId nor address are specified', async () => {
      const req = {
        signature: '1234356asdf',
        loginPhrase: 'loginphrase',
        message: 'message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No ZelID is specified',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if zelID does not start with 1', async () => {
      const req = {
        zelid: '2Z123434',
        signature: '1234356asdf',
        loginPhrase: 'loginphrase',
        message: 'message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'ZelID is not valid',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if zelID is less than 25 chars long', async () => {
      const req = {
        zelid: '1Z123434',
        signature: '1234356asdf',
        loginPhrase: 'loginphrase',
        message: 'message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'ZelID is not valid',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if zelID is more than 34 chars long', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341Z12',
        signature: '1234356asdf',
        loginPhrase: 'loginphrase',
        message: 'message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'ZelID is not valid',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if the message is empty', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: '',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message is specified',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if message is undefined', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message is specified',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if message is less than 40 chars', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: '1234',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Signed message is not valid',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if message first 13 chars timestamp is too low', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: '111111111111111111111111111111111111111111111',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Signed message is not valid',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if message first 13 chars timestamp is too high', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: '999999999999911111111111111111111111111111111',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Signed message is not valid',
        },
      };

      await idService.verifyLogin(mockStream, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedError);
    });

    it('should return error if database returns nothing', async () => {
      sinon.stub(dbHelper, 'findOneInDatabase').resolves(null);
      const timestamp = new Date().getTime();
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: `${timestamp - 300000}11111111111111111111111111111`,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Signed message is no longer valid. Please request a new one.',
        },
      };

      await idService.verifyLogin(mockStream, res);
      await serviceHelper.delay(100);

      sinon.assert.calledOnceWithExactly(res.json, expectedError);
    });

    it('should return error if signature in database is invalid', async () => {
      const timestamp = new Date().getTime();
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        loginPhrase: `${timestamp + 10000}11111111111111111111111111111`,
      });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: `${timestamp - 300000}11111111111111111111111111111`,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Signed message is no longer valid. Please request a new one.',
        },
      };

      await idService.verifyLogin(mockStream, res);
      await serviceHelper.delay(100);

      sinon.assert.calledOnceWithExactly(res.json, expectedError);
    });

    it('should return error if signature verification failed', async () => {
      bitcoinMessageStub.returns(false);
      const timestamp = new Date().getTime();
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        loginPhrase: `${timestamp - 10000}11111111111111111111111111111`,
      });
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: `${timestamp - 300000}11111111111111111111111111111`,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Invalid signature',
        },
      };

      await idService.verifyLogin(mockStream, res);
      await serviceHelper.delay(100);

      sinon.assert.calledOnceWithExactly(res.json, expectedError);
    });

    it('should return success message if everything is okay', async () => {
      bitcoinMessageStub.returns(true);
      const timestamp = new Date().getTime();
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        loginPhrase: `${timestamp - 10000}11111111111111111111111111111`,
      });
      sinon.stub(dbHelper, 'insertOneToDatabase').resolves(true);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: `${timestamp - 300000}11111111111111111111111111111`,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'success',
        data: {
          message: 'Successfully logged in',
          zelid: '1Z1234341Z1234341Z1234341Z1234341',
          loginPhrase: sinon.match.string,
          signature: '1234356asdf',
          privilage: 'user',
        },
      };

      await idService.verifyLogin(mockStream, res);
      await serviceHelper.delay(100);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });
  });

  describe('provideSign tests', () => {
    let bitcoinMessageStub;

    beforeEach(() => {
      bitcoinMessageStub = sinon.stub(bitcoinMessage, 'verify');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if neither zelId nor address are specified', async () => {
      const req = {
        signature: '1234356asdf',
        loginPhrase: 'loginphrase',
        message: 'message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No ZelID is specified',
        },
      };

      await idService.provideSign(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if zelID does not start with 1', async () => {
      const req = {
        zelid: '2Z123434',
        signature: '1234356asdf',
        loginPhrase: 'loginphrase',
        message: 'message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'ZelID is not valid',
        },
      };

      await idService.provideSign(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if zelID is less than 25 chars long', async () => {
      const req = {
        zelid: '1Z123434',
        signature: '1234356asdf',
        loginPhrase: 'loginphrase',
        message: 'message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'ZelID is not valid',
        },
      };

      await idService.provideSign(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if zelID is more than 34 chars long', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341Z12',
        signature: '1234356asdf',
        loginPhrase: 'loginphrase',
        message: 'message',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'ZelID is not valid',
        },
      };

      await idService.provideSign(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if the message is empty', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: '',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message is specified',
        },
      };

      await idService.provideSign(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if message is undefined', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No message is specified',
        },
      };

      await idService.provideSign(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return error if message is less than 40 chars', async () => {
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: '1234',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'Signed message is not valid',
        },
      };

      await idService.provideSign(mockStream, res);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });

    it('should return success message if everything is okay', async () => {
      bitcoinMessageStub.returns(true);
      const timestamp = new Date().getTime();
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({
        loginPhrase: `${timestamp - 10000}11111111111111111111111111111`,
      });
      sinon.stub(dbHelper, 'insertOneToDatabase').resolves(true);
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const req = {
        zelid: '1Z1234341Z1234341Z1234341Z1234341',
        signature: '1234356asdf',
        message: `${timestamp - 300000}11111111111111111111111111111`,
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(req));
      mockStream.end();
      const res = generateResponse();
      const expectedError = {
        status: 'success',
        data: {
          identifier: '1Z1234341Z1234341Z1234341Z12343411111111111111',
          signature: '1234356asdf',
        },
      };

      await idService.provideSign(mockStream, res);
      await serviceHelper.delay(100);

      sinon.assert.calledOnceWithMatch(res.json, expectedError);
    });
  });

  describe('loggedUsers tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await idService.loggedUsers(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return the found item from DB', async () => {
      verifyPrivilegeStub.returns(true);
      const dbStub = sinon.stub(dbHelper, 'findInDatabase').resolves('item found');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const res = generateResponse();

      await idService.loggedUsers(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 'item found' });
      sinon.assert.calledOnce(dbStub);
    });
  });

  describe('loggedSessions tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await idService.loggedSessions(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return the found item from DB', async () => {
      verifyPrivilegeStub.returns(true);
      const dbStub = sinon.stub(dbHelper, 'findInDatabase').resolves('item found');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const res = generateResponse();
      const req = {
        headers: {
          zelidauth: 'zelidauth',
        },
      };

      await idService.loggedSessions(req, res);

      sinon.assert.calledOnceWithExactly(res.json, { status: 'success', data: 'item found' });
      sinon.assert.calledOnce(dbStub);
    });
  });

  describe('logoutCurrentSession tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await idService.logoutCurrentSession(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return the found item from DB', async () => {
      verifyPrivilegeStub.returns(true);
      const dbStub = sinon.stub(dbHelper, 'findOneAndDeleteInDatabase').resolves('item removed');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const res = generateResponse();
      const req = {
        headers: {
          zelidauth: 'zelidauth',
        },
      };

      await idService.logoutCurrentSession(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Successfully logged out',
        },
      });
      sinon.assert.calledOnce(dbStub);
    });
  });

  describe('logoutAllSessions tests', () => {
    let verifyPrivilegeStub;

    beforeEach(() => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error when unauthorized ', async () => {
      const res = generateResponse();
      verifyPrivilegeStub.returns(false);
      const expectedResponse = {
        data: {
          code: 401,
          message: 'Unauthorized. Access denied.',
          name: 'Unauthorized',
        },
        status: 'error',
      };
      await idService.logoutAllSessions(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResponse);
    });

    it('should return the found item from DB', async () => {
      verifyPrivilegeStub.returns(true);
      const dbStub = sinon.stub(dbHelper, 'removeDocumentsFromCollection').resolves('doc removed');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
      const res = generateResponse();
      const req = {
        headers: {
          zelidauth: 'zelidauth',
        },
      };

      await idService.logoutAllSessions(req, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Successfully logged out all sessions',
        },
      });
      sinon.assert.calledOnce(dbStub);
    });
  });

  describe('wsRespondLoginPhrase tests', () => {
    const generateWebsocket = () => {
      const ws = {};
      ws.send = sinon.stub().returns('okay');
      ws.close = sinon.stub().returns('okay');
      return ws;
    };
    let dbStub;

    beforeEach(async () => {
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if db rejects promise', async () => {
      dbStub.rejects('myerrromessage');
      const ws = generateWebsocket();
      const req = {
        params: {
          loginphrase: '12345',
        },
      };

      await idService.wsRespondLoginPhrase(ws, req);

      sinon.assert.calledOnceWithExactly(ws.send, 'status=error&data%5Bname%5D=myerrromessage&data%5Bmessage%5D=Unknown%20error');
    });

    it('should return proper message if user is fluxTeamZelId', async () => {
      dbStub.resolves({
        zelid: adminConfig.fluxTeamZelId,
        loginPhrase: '12333345656',
        signature: 'signature1',
        createdAt: '168450311',
        expireAt: '168460311',
      });
      const ws = generateWebsocket();
      const req = {
        params: {
          loginphrase: '12345',
        },
      };

      await idService.wsRespondLoginPhrase(ws, req);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(ws.send, 'status=success&data%5Bmessage%5D=Successfully%20logged%20in&data%5Bzelid%5D=1zasdfg&data%5BloginPhrase%5D=12333345656&data%5Bsignature%5D=signature1&data%5Bprivilage%5D=user&data%5BcreatedAt%5D=168450311&data%5BexpireAt%5D=168460311');
    });

    it('should return proper message if user is admin', async () => {
      dbStub.resolves({
        zelid: adminConfig.initial.zelid,
        loginPhrase: '12333345656',
        signature: 'signature1',
        createdAt: '168450311',
        expireAt: '168460311',
      });
      const ws = generateWebsocket();
      const req = {
        params: {
          loginphrase: '12345',
        },
      };

      await idService.wsRespondLoginPhrase(ws, req);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(ws.send,
        'status=success&data%5Bmessage%5D=Successfully%20logged%20in&data%5Bzelid%5D=1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC&data%5BloginPhrase%5D=12333345656&data%5Bsignature%5D=signature1&data%5Bprivilage%5D=admin&data%5BcreatedAt%5D=168450311&data%5BexpireAt%5D=168460311');
    });

    it('should return error message if 2nd db call throws error', async () => {
      dbStub.onCall(0).resolves(null);
      dbStub.onCall(1).rejects('error message');
      const ws = generateWebsocket();
      const req = {
        params: {
          loginphrase: '12345',
        },
      };

      await idService.wsRespondLoginPhrase(ws, req);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(ws.send,
        'status=error&data%5Bname%5D=error%20message&data%5Bmessage%5D=Unknown%20error');
    });
  });

  describe('wsRespondSignature tests', () => {
    const generateWebsocket = () => {
      const ws = {};
      ws.send = sinon.stub().returns('okay');
      ws.close = sinon.stub().returns('okay');
      return ws;
    };
    let dbStub;

    beforeEach(async () => {
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error if db rejects promise', async () => {
      dbStub.rejects('myerrromessage');
      const ws = generateWebsocket();
      const req = {
        params: {
          message: 'message',
        },
      };

      await idService.wsRespondSignature(ws, req);

      sinon.assert.calledOnceWithExactly(ws.send, 'status=error&data%5Bname%5D=myerrromessage&data%5Bmessage%5D=Unknown%20error');
    });

    it('should return proper message if user is fluxTeamZelId', async () => {
      dbStub.resolves('found');
      const ws = generateWebsocket();
      const req = {
        params: {
          message: 'message',
        },
      };

      await idService.wsRespondSignature(ws, req);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(ws.send, 'status=success&data=found');
    });
  });

  describe('checkLoggedUser tests', () => {
    let verifyPrivilegeStub;

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return error message if no zelid parameter is passed', async () => {
      const res = generateResponse();
      const params = {
        loginPhrase: 'phrase',
        signature: 'signature',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();

      await idService.checkLoggedUser(mockStream, res);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No user ZelID specificed',
        },
      });
    });

    it('should return error message if no loggedPhrase parameter is passed', async () => {
      const res = generateResponse();
      const params = {
        zelid: '1zel12343434',
        signature: 'signature',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();

      await idService.checkLoggedUser(mockStream, res);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No user loginPhrase specificed',
        },
      });
    });

    it('should return error message if no loggedPhrase parameter is passed', async () => {
      const res = generateResponse();
      const params = {
        zelid: '1zel12343434',
        loginPhrase: 'loginphrase',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();

      await idService.checkLoggedUser(mockStream, res);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: {
          code: undefined,
          name: 'Error',
          message: 'No user ZelID signature specificed',
        },
      });
    });

    it('should return peroper success message if user is an admin', async () => {
      verifyPrivilegeStub.withArgs('admin', sinon.match.object).returns(true);
      const res = generateResponse();
      const params = {
        zelid: '1zel12343434',
        loginPhrase: 'loginphrase',
        signature: 'signature',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();

      await idService.checkLoggedUser(mockStream, res);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'admin' },
      });
    });

    it('should return peroper success message if user is fluxteam', async () => {
      verifyPrivilegeStub.withArgs('admin', sinon.match.object).returns(false);
      verifyPrivilegeStub.withArgs('fluxteam', sinon.match.object).returns(true);
      const res = generateResponse();
      const params = {
        zelid: '1zel12343434',
        loginPhrase: 'loginphrase',
        signature: 'signature',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();

      await idService.checkLoggedUser(mockStream, res);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'fluxteam' },
      });
    });

    it('should return peroper success message if user is an ordinary user', async () => {
      verifyPrivilegeStub.withArgs('admin', sinon.match.object).returns(false);
      verifyPrivilegeStub.withArgs('fluxteam', sinon.match.object).returns(false);
      verifyPrivilegeStub.withArgs('user', sinon.match.object).returns(true);
      const res = generateResponse();
      const params = {
        zelid: '1zel12343434',
        loginPhrase: 'loginphrase',
        signature: 'signature',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();

      await idService.checkLoggedUser(mockStream, res);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'success',
        data: { code: undefined, name: undefined, message: 'user' },
      });
    });

    it('should return error message if user has no privileges', async () => {
      verifyPrivilegeStub.withArgs('admin', sinon.match.object).returns(false);
      verifyPrivilegeStub.withArgs('fluxteam', sinon.match.object).returns(false);
      verifyPrivilegeStub.withArgs('user', sinon.match.object).returns(false);
      const res = generateResponse();
      const params = {
        zelid: '1zel12343434',
        loginPhrase: 'loginphrase',
        signature: 'signature',
      };
      const mockStream = new PassThrough();
      mockStream.push(JSON.stringify(params));
      mockStream.end();

      await idService.checkLoggedUser(mockStream, res);
      await serviceHelper.delay(150);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: { code: undefined, name: undefined, message: 'none' },
      });
    });
  });
});
