const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const generalService = require('../../ZelBack/src/services/generalService');
const daemonServiceZelnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceZelnodeRpcs');
const daemonServiceTransactionRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceTransactionRpcs');

chai.use(chaiAsPromised);
const { expect } = chai;

describe.only('generalService tests', () => {
  describe('getCollateralInfo tests', () => {
    it('should split and return the values properly', () => {
      const collateralOutpoint = 'COutPoint(6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d, 0)';

      const result = generalService.getCollateralInfo(collateralOutpoint);

      expect(result).to.eql({ txhash: '6b2f0b581698337758cd045ead702f4cf6d9c96e8a0288bed526146a005ddd0d', txindex: 0 });
    });
  });

  describe('nodeTier tests', () => {
    let getZelNodeStatusStub;
    let getRawTransactionStub;

    beforeEach(() => {
      getZelNodeStatusStub = sinon.stub(daemonServiceZelnodeRpcs, 'getZelNodeStatus');
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

    it('should throw if getZelnodeStatus returns error', async () => {
      getZelNodeStatusStub.returns(
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
      getZelNodeStatusStub.returns(
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
      getZelNodeStatusStub.returns(
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
      getZelNodeStatusStub.returns(
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
      getZelNodeStatusStub.returns(
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
      getZelNodeStatusStub.returns(
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
      getZelNodeStatusStub.returns(
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
      getZelNodeStatusStub.returns(
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
      getZelNodeStatusStub.returns(
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
});
