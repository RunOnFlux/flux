const { expect } = require('chai');
const sinon = require('sinon');
const config = require('config');
const deploymentInfoService = require('../../ZelBack/src/services/appQuery/deploymentInfoService');
const messageHelper = require('../../ZelBack/src/services/messageHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const chainUtilities = require('../../ZelBack/src/services/utils/chainUtilities');

describe('deploymentInfoService tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('deploymentInformation tests', () => {
    it('should return deployment information with original address', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: 100000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves([
        { height: 0, price: 1000 },
      ]);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.address).to.equal(config.fluxapps.address);
      expect(response.data.portMin).to.exist;
      expect(response.data.portMax).to.exist;
      expect(response.data.price).to.be.an('array');
    });

    it('should use multisig address after enforcement height', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const enforcementHeight = config.fluxapps.appSpecsEnforcementHeights[6];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: enforcementHeight + 1000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves([
        { height: 0, price: 1000 },
      ]);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.address).to.equal(config.fluxapps.addressMultisig);
    });

    it('should use multisig B address after change height', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const changeHeight = config.fluxapps.multisigAddressChange;

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: changeHeight + 1000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves([
        { height: 0, price: 1000 },
      ]);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.address).to.equal(config.fluxapps.addressMultisigB);
    });

    it('should include all deployment configuration', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: 100000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves([
        { height: 0, price: 1000 },
      ]);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data).to.have.property('price');
      expect(response.data).to.have.property('appSpecsEnforcementHeights');
      expect(response.data).to.have.property('address');
      expect(response.data).to.have.property('portMin');
      expect(response.data).to.have.property('portMax');
      expect(response.data).to.have.property('enterprisePorts');
      expect(response.data).to.have.property('bannedPorts');
      expect(response.data).to.have.property('maxImageSize');
      expect(response.data).to.have.property('minimumInstances');
      expect(response.data).to.have.property('maximumInstances');
      expect(response.data).to.have.property('blocksLasting');
      expect(response.data).to.have.property('minBlocksAllowance');
      expect(response.data).to.have.property('maxBlocksAllowance');
      expect(response.data).to.have.property('blocksAllowanceInterval');
    });

    it('should use post-PON max blocks allowance after fork', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const forkHeight = config.fluxapps.daemonPONFork;

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: forkHeight + 1000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves([
        { height: 0, price: 1000 },
      ]);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.maxBlocksAllowance).to.equal(config.fluxapps.postPonMaxBlocksAllowance);
    });

    it('should use pre-PON max blocks allowance before fork', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const forkHeight = config.fluxapps.daemonPONFork;

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: forkHeight - 1000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves([
        { height: 0, price: 1000 },
      ]);

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.maxBlocksAllowance).to.equal(config.fluxapps.maxBlocksAllowance);
    });

    it('should handle errors gracefully', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').throws(new Error('Daemon error'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should handle price retrieval errors', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: 100000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').rejects(new Error('Price error'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should return correct port ranges', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: 100000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves([]);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.portMin).to.equal(config.fluxapps.portMin);
      expect(response.data.portMax).to.equal(config.fluxapps.portMax);
    });

    it('should include enterprise and banned ports', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: 100000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves([]);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.enterprisePorts).to.be.an('array');
      expect(response.data.bannedPorts).to.be.an('array');
    });

    it('should return price updates array', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      const priceUpdates = [
        { height: 0, price: 1000 },
        { height: 50000, price: 2000 },
        { height: 100000, price: 3000 },
      ];

      sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced').returns({
        status: 'success',
        data: { height: 100000, synced: true },
      });

      sinon.stub(chainUtilities, 'getChainParamsPriceUpdates').resolves(priceUpdates);
      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.deploymentInformation(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data.price).to.deep.equal(priceUpdates);
    });
  });

  describe('getAppSpecsUSDPrice tests', () => {
    it('should return USD price configuration', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.getAppSpecsUSDPrice(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('success');
      expect(response.data).to.exist;
    });

    it('should return config.fluxapps.usdprice', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.getAppSpecsUSDPrice(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.data).to.equal(config.fluxapps.usdprice);
    });

    it('should handle errors gracefully', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      // Force an error by stubbing messageHelper to throw
      messageHelper.createDataMessage.restore?.();
      sinon.stub(messageHelper, 'createDataMessage').throws(new Error('Test error'));
      sinon.stub(messageHelper, 'createErrorMessage').returns({ status: 'error' });

      await deploymentInfoService.getAppSpecsUSDPrice(req, res);

      sinon.assert.calledOnce(res.json);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });

    it('should include price object structure', async () => {
      const req = {};
      const res = {
        json: sinon.stub(),
      };

      sinon.stub(messageHelper, 'createDataMessage').callsFake((data) => ({ status: 'success', data }));

      await deploymentInfoService.getAppSpecsUSDPrice(req, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      // The price object should exist and be an object
      expect(typeof response.data).to.equal('object');
    });
  });
});
