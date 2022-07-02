const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const os = require('os');
const proxyquire = require('proxyquire');
const log = require('../../ZelBack/src/lib/log');

const generalService = require('../../ZelBack/src/services/generalService');

const adminConfig = {
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

describe.only('idService tests', () => {
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
});
