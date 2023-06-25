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
    let getZelNodeStatusStub;
    let getRawTransactionStub;

    beforeEach(() => {
      getZelNodeStatusStub = sinon.stub(daemonServiceFluxnodeRpcs, 'getZelNodeStatus');
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

  describe('nodeCollateral tests', () => {
    let getZelNodeStatusStub;
    let getRawTransactionStub;

    beforeEach(() => {
      getZelNodeStatusStub = sinon.stub(daemonServiceFluxnodeRpcs, 'getZelNodeStatus');
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

    it('should throw if getZelnodeStatus returns error', async () => {
      getZelNodeStatusStub.returns(
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
    let getZelNodeStatusStub;

    beforeEach(() => {
      getZelNodeStatusStub = sinon.stub(daemonServiceFluxnodeRpcs, 'getZelNodeStatus');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false if getZelnodeStatus returns error', async () => {
      getZelNodeStatusStub.returns(
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

    it('should return true if getZelnodeStatus returns succcess and confirmed status', async () => {
      getZelNodeStatusStub.returns(
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

    it('should return false if getZelnodeStatus returns succcess and any other status', async () => {
      getZelNodeStatusStub.returns(
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

    it('should return false if getZelnodeStatus returns error', async () => {
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

  describe('checkWhitelistedRepository tests', () => {
    afterEach(() => {
      sinon.restore();
    });
    it('should throw error if repotag is not a string', async () => {
      const repotag = 1234;

      await expect(generalService.checkWhitelistedRepository(repotag)).to.eventually.be.rejectedWith('Invalid repotag');
    });

    it('should throw error axiosGet returns nothing', async () => {
      sinon.stub(serviceHelper, 'axiosGet').returns(null);
      const repotag = 'testing/12343:latest';

      await expect(generalService.checkWhitelistedRepository(repotag)).to.eventually.be.rejectedWith('Unable to communicate with Flux Services! Try again later.');
    });

    it('should throw error if repo is not whitelsited', async () => {
      const repotag = 'testing/12343:latest';

      await expect(generalService.checkWhitelistedRepository(repotag)).to.eventually.be.rejectedWith('Repository is not whitelisted. Please contact Flux Team.');
    });

    it('should throw error if repo is not in a proper format', async () => {
      const repotag = 'improperformat';

      await expect(generalService.checkWhitelistedRepository(repotag)).to.eventually.be.rejectedWith('Repository improperformat is not in valid format namespace/repository:tag');
    });

    it('should return true if repository is whitelisted', async () => {
      const repotag = 'yurinnick/folding-at-home:latest';

      const result = await generalService.checkWhitelistedRepository(repotag);

      expect(result).to.eql(true);
    });

    it('should return true if repository is whitelisted B', async () => {
      const repotag = 'gcr.io/google-samples/node-hello:latest';

      const result = await generalService.checkWhitelistedRepository(repotag);

      expect(result).to.eql(true);
    });

    it('should return true if repository is whitelisted C', async () => {
      const repotag = 'public.ecr.aws/docker/library/hello-world:linux';

      const result = await generalService.checkWhitelistedRepository(repotag);

      expect(result).to.eql(true);
    });

    it('should return true if repository is whitelisted D', async () => {
      const repotag = 'download.lootlink.xyz/wirewrex/kappa:delta';

      const result = await generalService.checkWhitelistedRepository(repotag);

      expect(result).to.eql(true);
    });

    it('should return true if repository namespace is whitelisted', async () => {
      const repotag = 'public.ecr.aws/docker/library/hello-world:notlisted';

      const result = await generalService.checkWhitelistedRepository(repotag);

      expect(result).to.eql(true);
    });

    it('should return true if repository namespace is whitelisted B', async () => {
      const repotag = 'wirewrex/uptimekuma:latest';

      const result = await generalService.checkWhitelistedRepository(repotag);

      expect(result).to.eql(true);
    });

    it('should return true if repository namespace is whitelisted C', async () => {
      const repotag = 'ghcr.io/handshake-org/london:latest';

      const result = await generalService.checkWhitelistedRepository(repotag);

      expect(result).to.eql(true);
    });

    it('should return true if repository namespace is whitelisted D', async () => {
      const repotag = 'mysql:latest';

      const result = await generalService.checkWhitelistedRepository(repotag);

      expect(result).to.eql(true);
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

  describe('splitRepoTag tests', () => {
    it('should split complex repository correctly', async () => {
      const repotag = 'example.repository.com:50000/my/super/complex/namespace/image:latest';

      const result = generalService.splitRepoTag(repotag);

      expect(result.tag).to.eql('latest');
      expect(result.provider).to.eql('example.repository.com');
      expect(result.service).to.eql('example.repository.com');
      expect(result.authentication).to.eql('example.repository.com');
      expect(result.providerName).to.eql('Unkown provider');
      expect(result.port).to.eql('50000');
      expect(result.repository).to.eql('image');
      expect(result.namespace).to.eql('my/super/complex/namespace');
    });

    it('should split basic repository correctly', async () => {
      const repotag = 'runonflux/website:latest';

      const result = generalService.splitRepoTag(repotag);

      expect(result.tag).to.eql('latest');
      expect(result.provider).to.eql('registry-1.docker.io');
      expect(result.service).to.eql('registry.docker.io');
      expect(result.authentication).to.eql('auth.docker.io');
      expect(result.providerName).to.eql('Docker Hub');
      expect(result.port).to.eql('');
      expect(result.repository).to.eql('website');
      expect(result.namespace).to.eql('runonflux');
    });

    it('should split library of docker correctly', async () => {
      const repotag = 'mysql:latest';

      const result = generalService.splitRepoTag(repotag);

      expect(result.tag).to.eql('latest');
      expect(result.provider).to.eql('registry-1.docker.io');
      expect(result.service).to.eql('registry.docker.io');
      expect(result.authentication).to.eql('auth.docker.io');
      expect(result.providerName).to.eql('Docker Hub');
      expect(result.port).to.eql('');
      expect(result.repository).to.eql('mysql');
      expect(result.namespace).to.eql('library');
    });

    it('should split basic docker api correctly', async () => {
      const repotag = 'ghcr.io/iron-fish/ironfish:mytag';

      const result = generalService.splitRepoTag(repotag);

      expect(result.tag).to.eql('mytag');
      expect(result.provider).to.eql('ghcr.io');
      expect(result.service).to.eql('ghcr.io');
      expect(result.authentication).to.eql('ghcr.io');
      expect(result.providerName).to.eql('Github Containers');
      expect(result.port).to.eql('');
      expect(result.repository).to.eql('ironfish');
      expect(result.namespace).to.eql('iron-fish');
    });

    it('should split library of docker api correctly', async () => {
      const repotag = 'public.ecr.aws/docker/library/mongo:latest';

      const result = generalService.splitRepoTag(repotag);

      expect(result.tag).to.eql('latest');
      expect(result.provider).to.eql('public.ecr.aws');
      expect(result.service).to.eql('public.ecr.aws');
      expect(result.authentication).to.eql('public.ecr.aws');
      expect(result.providerName).to.eql('Amazon ECR');
      expect(result.port).to.eql('');
      expect(result.repository).to.eql('mongo');
      expect(result.namespace).to.eql('docker/library');
    });

    it('should fail if not correct repotag', async () => {
      const repotag = 'example';

      // eslint-disable-next-line func-names
      const result = function () { generalService.splitRepoTag(repotag); };

      expect(result).to.throw();
    });
  });
});
