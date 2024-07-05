const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const generalService = require('../../ZelBack/src/services/generalService');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceFluxnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceTransactionRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceTransactionRpcs');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');

chai.use(chaiAsPromised);
const { expect } = chai;

const generateResponse = () => {
  const res = { test: 'testing' };
  res.status = sinon.stub().returns(res);
  res.json = sinon.fake((param) => `Response: ${param}`);
  return res;
};

describe('generalService tests', () => {
  describe('getCollateralInfo tests', () => {
    it('should split and return the values properly', () => {
      const collateralOutpoint = 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)';

      const result = generalService.getCollateralInfo(collateralOutpoint);

      expect(result).to.eql({ txhash: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d', txindex: 0 });
    });
  });

  describe('nodeTier tests', () => {
    let getFluxNodeStatusStub;
    let getRawTransactionStub;

    beforeEach(() => {
      getFluxNodeStatusStub = sinon.stub(daemonServiceFluxnodeRpcs, 'getFluxNodeStatus');
      getRawTransactionStub = sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction');
      generalService.setStoredTier(null);
      generalService.setStoredCollateral(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return storedTier if it is set', async () => {
      generalService.setStoredTier('CUMULUS');

      const result = await generalService.nodeTier();

      expect(result).to.equal('CUMULUS');
    });

    it('should throw if getFluxnodeStatus returns error', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'error',
          data: {
            message: 'This is some error!',
          },
        },
      );
      await expect(generalService.nodeTier()).to.eventually.be.rejectedWith({
        data: {
          message: 'This is some error!',
        },
      });
    });

    it('should throw error if getRawTransaction returns error', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'error',
        data: {
          message: 'This is some error2!',
        },
      });

      await expect(generalService.nodeTier()).to.eventually.be.rejectedWith({
        data: {
          message: 'This is some error2!',
        },
      });
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper tier for 10000 - basic', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 10000 }],
        },
      });

      const result = await generalService.nodeTier();

      expect(result).to.equal('basic');
      expect(generalService.getStoredCollateral()).to.eql(10000);
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper tier for 1000 - basic', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 1000 }],
        },
      });

      const result = await generalService.nodeTier();

      expect(result).to.equal('basic');
      expect(generalService.getStoredCollateral()).to.eql(1000);
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper tier for 25000 - super', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 25000 }],
        },
      });

      const result = await generalService.nodeTier();

      expect(result).to.equal('super');
      expect(generalService.getStoredCollateral()).to.eql(25000);
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper tier for 12500 - super', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 12500 }],
        },
      });

      const result = await generalService.nodeTier();

      expect(result).to.equal('super');
      expect(generalService.getStoredCollateral()).to.eql(12500);
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper tier for 100000 - bamf', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 100000 }],
        },
      });

      const result = await generalService.nodeTier();

      expect(result).to.equal('bamf');
      expect(generalService.getStoredCollateral()).to.eql(100000);
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper tier for 40000 - bamf', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 40000 }],
        },
      });

      const result = await generalService.nodeTier();

      expect(result).to.equal('bamf');
      expect(generalService.getStoredCollateral()).to.eql(40000);
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should throw errror for improper collateral', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 12345 }],
        },
      });

      await expect(generalService.nodeTier()).to.eventually.be.rejectedWith('Unrecognised Flux Node tier');
      expect(generalService.getStoredCollateral()).to.eql(null);
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });
  });

  describe('getNewNodeTier tests', () => {
    beforeEach(() => {
      generalService.setStoredTier(null);
    });

    it('should return stratus if node is bamf', async () => {
      generalService.setStoredTier('bamf');

      const result = await generalService.getNewNodeTier();

      expect(result).to.equal('stratus');
    });

    it('should return nimbus if node is super', async () => {
      generalService.setStoredTier('super');

      const result = await generalService.getNewNodeTier();

      expect(result).to.equal('nimbus');
    });

    it('should return cumulus if node is basic', async () => {
      generalService.setStoredTier('basic');

      const result = await generalService.getNewNodeTier();

      expect(result).to.equal('cumulus');
    });
  });

  describe('nodeCollateral tests', () => {
    let getFluxNodeStatusStub;
    let getRawTransactionStub;

    beforeEach(() => {
      getFluxNodeStatusStub = sinon.stub(daemonServiceFluxnodeRpcs, 'getFluxNodeStatus');
      getRawTransactionStub = sinon.stub(daemonServiceTransactionRpcs, 'getRawTransaction');
      generalService.setStoredTier(null);
      generalService.setStoredCollateral(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return storedCollateral if it is set', async () => {
      generalService.setStoredCollateral(10000);

      const result = await generalService.nodeCollateral();

      expect(result).to.equal(10000);
    });

    it('should throw if getFluxnodeStatus returns error', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'error',
          data: {
            message: 'This is some error!',
          },
        },
      );
      await expect(generalService.nodeCollateral()).to.eventually.be.rejectedWith({
        data: {
          message: 'This is some error!',
        },
      });
    });

    it('should throw error if getRawTransaction returns error', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'error',
        data: {
          message: 'This is some error2!',
        },
      });

      await expect(generalService.nodeCollateral()).to.eventually.be.rejectedWith({
        data: {
          message: 'This is some error2!',
        },
      });
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper collateral of 10000 - basic', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 10000 }],
        },
      });

      const result = await generalService.nodeCollateral();

      expect(result).to.equal(10000);
      expect(generalService.getStoredTier()).to.eql('basic');
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper collateral of 1000 - basic', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 1000 }],
        },
      });

      const result = await generalService.nodeCollateral();

      expect(result).to.equal(1000);
      expect(generalService.getStoredTier()).to.eql('basic');
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper collateral of 25000 - super', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 25000 }],
        },
      });

      const result = await generalService.nodeCollateral();

      expect(result).to.equal(25000);
      expect(generalService.getStoredTier()).to.eql('super');
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper collateral of 12500 - super', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 12500 }],
        },
      });

      const result = await generalService.nodeCollateral();

      expect(result).to.equal(12500);
      expect(generalService.getStoredTier()).to.eql('super');
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper collateral of 100000 - bamf', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 100000 }],
        },
      });

      const result = await generalService.nodeCollateral();

      expect(result).to.equal(100000);
      expect(generalService.getStoredTier()).to.eql('bamf');
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should return proper collateral of 40000 - bamf', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 40000 }],
        },
      });

      const result = await generalService.nodeCollateral();

      expect(result).to.equal(40000);
      expect(generalService.getStoredTier()).to.eql('bamf');
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });

    it('should throw errror for improper collateral', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)',
          },
        },
      );
      getRawTransactionStub.returns({
        status: 'success',
        data: {
          vout: [{ value: 12345 }],
        },
      });

      await expect(generalService.nodeCollateral()).to.eventually.be.rejectedWith('Unrecognised Flux Node Collateral');
      expect(generalService.getStoredTier()).to.eql(null);
      sinon.assert.calledOnceWithExactly(getRawTransactionStub, {
        params: {
          txid: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d',
          verbose: 1,
        },
      });
    });
  });

  describe('isNodeStatusConfirmed tests', () => {
    let getFluxNodeStatusStub;

    beforeEach(() => {
      getFluxNodeStatusStub = sinon.stub(daemonServiceFluxnodeRpcs, 'getFluxNodeStatus');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false if getFluxnodeStatus returns error', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'error',
          data: {
            message: 'This is some error!',
          },
        },
      );

      const result = await generalService.isNodeStatusConfirmed();

      expect(result).to.eql(false);
    });

    it('should return true if getFluxnodeStatus returns succcess and confirmed status', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            status: 'CONFIRMED',
          },
        },
      );

      const result = await generalService.isNodeStatusConfirmed();

      expect(result).to.eql(true);
    });

    it('should return false if getFluxnodeStatus returns succcess and any other status', async () => {
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            status: 'NOT CONFIRMED',
          },
        },
      );

      const result = await generalService.isNodeStatusConfirmed();

      expect(result).to.eql(false);
    });
  });

  describe('checkSynced tests', () => {
    let isDaemonSyncedStub;
    let dbStub;

    beforeEach(async () => {
      isDaemonSyncedStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
      dbStub = sinon.stub(dbHelper, 'findOneInDatabase');
      await dbHelper.initiateDB();
      dbHelper.databaseConnection();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false if getFluxnodeStatus returns error', async () => {
      isDaemonSyncedStub.returns(
        {
          data: {
            synced: false,
          },
        },
      );

      const result = await generalService.checkSynced();

      expect(result).to.eql(false);
    });

    it('should return false if db returns no data', async () => {
      isDaemonSyncedStub.returns(
        {
          data: {
            synced: true,
            height: '12345667',
          },
        },
      );
      dbStub.returns({});

      const result = await generalService.checkSynced();

      expect(result).to.eql(false);
    });

    it('should return true if explorerHeight == daemonHeight', async () => {
      isDaemonSyncedStub.returns(
        {
          data: {
            synced: true,
            height: 10,
          },
        },
      );
      dbStub.returns({
        generalScannedHeight: 10,
      });

      const result = await generalService.checkSynced();

      expect(result).to.eql(true);
    });

    it('should return true if explorerHeight + 1 == daemonHeight', async () => {
      isDaemonSyncedStub.returns(
        {
          data: {
            synced: true,
            height: 10,
          },
        },
      );
      dbStub.returns({
        generalScannedHeight: 9,
      });

      const result = await generalService.checkSynced();

      expect(result).to.eql(true);
    });

    it('should return true if explorerHeight - 1 == daemonHeight', async () => {
      isDaemonSyncedStub.returns(
        {
          data: {
            synced: true,
            height: 10,
          },
        },
      );
      dbStub.returns({
        generalScannedHeight: 11,
      });

      const result = await generalService.checkSynced();

      expect(result).to.eql(true);
    });

    it('should return false if explorerHeight + 6 == daemonHeight', async () => {
      isDaemonSyncedStub.returns(
        {
          data: {
            synced: true,
            height: 10,
          },
        },
      );
      dbStub.returns({
        generalScannedHeight: 4,
      });

      const result = await generalService.checkSynced();

      expect(result).to.eql(false);
    });

    it('should return false if explorerHeight - 6 == daemonHeight', async () => {
      isDaemonSyncedStub.returns(
        {
          data: {
            synced: true,
            height: 10,
          },
        },
      );
      dbStub.returns({
        generalScannedHeight: 16,
      });

      const result = await generalService.checkSynced();

      expect(result).to.eql(false);
    });
  });

  describe('whitelistedRepositories tests', () => {
    const axiosProperResponse = {
      status: 'success',
      data: [
        'yurinnick/folding-at-home:latest',
        'kadena/chainweb-node:latest',
        't1dev/dibi-fetch:latest',
        'thetrunk/rates-api:latest',
        'runonflux/kadena-chainweb-node:2.7',
      ],
    };

    afterEach(() => {
      sinon.restore();
    });

    it('should return whitelisted repos', async () => {
      sinon.stub(serviceHelper, 'axiosGet').returns(axiosProperResponse);
      const res = generateResponse();

      await generalService.whitelistedRepositories(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, axiosProperResponse);
    });

    it('should return whitelisted repos', async () => {
      const errResp = {
        name: 'error',
        message: 'error message',
        code: 403,
      };
      sinon.stub(serviceHelper, 'axiosGet').rejects(errResp);
      const res = generateResponse();

      await generalService.whitelistedRepositories(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, {
        status: 'error',
        data: errResp,
      });
    });
  });

  describe('messageHash tests', () => {
    it('should return an error if message is not of type string', async () => {
      const message = 1234;

      const result = await generalService.messageHash(message);

      expect(result).to.be.an('Error');
    });

    it('should return a messagehash if message is not of type string', async () => {
      const message = 'this is test message';

      const result = await generalService.messageHash(message);

      expect(result).to.eql('157e8f3c4022fbc2c54bd60f6f3d6c1c05a5d0118707dcf2b7b1a752d267cb54');
    });
  });
});
