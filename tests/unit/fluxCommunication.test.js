const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const { expect } = chai;

let fluxCommunication = require('../../ZelBack/src/services/fluxCommunication');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonService = require('../../ZelBack/src/services/daemonService');
const fluxList = require('./data/listfluxnodes.json');

describe('fluxCommunication tests', () => {
  describe('isFluxAvailable tests', () => {
    let stub;
    const ip = '127.0.0.1';
    const port = '16125';
    const axiosConfig = {
      timeout: 5000,
    };

    afterEach(() => {
      serviceHelper.axiosGet.restore();
    });

    it('Should return true if node is running flux, port taken from config', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '3.10.0',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(true);
    });

    it('Should return true if node is running flux, port provided explicitly', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '3.10.0',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(true);
    });

    it('Should return false if node if flux version is lower than expected', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '2.01.0', // minimum allowed version is 3.10.0
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });

    it('Should return false if response status is not success', async () => {
      const mockResponse = {
        data: {
          status: 'error',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });

    it('Should return false if axios request throws error', async () => {
      stub = sinon.stub(serviceHelper, 'axiosGet').throws();
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxCommunication.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });
  });

  describe('checkFluxAvailability tests', () => {
    let stub;
    const axiosConfig = {
      timeout: 5000,
    };
    const fluxAvailabilitySuccessResponse = {
      data: {
        status: 'success',
        data: '3.10.0',
      },
    };
    const fluxAvailabilityErrorResponse = {
      data: {
        status: 'error',
        data: '3.10.0',
      },
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    afterEach(() => {
      serviceHelper.axiosGet.restore();
    });

    it('Should return success message if proper parameters are passed in params', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
          ip: '127.0.0.1',
          port: '16125',
        },
        query: {
          test2: 'test2',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilitySuccessResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';
      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is available',
        },
      };

      const checkFluxAvailabilityResult = await fluxCommunication.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });

    it('Should return success message if proper parameters are passed in query', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
        },
        query: {
          test2: 'test2',
          ip: '127.0.0.1',
          port: '16125',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilitySuccessResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';
      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is available',
        },
      };

      const checkFluxAvailabilityResult = await fluxCommunication.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });

    it('Should return error message if flux is not available', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
        },
        query: {
          test2: 'test2',
          ip: '127.0.0.1',
          port: '16125',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilityErrorResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';
      const expectedMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is not available',
        },
      };

      const checkFluxAvailabilityResult = await fluxCommunication.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });

    it('Should return error message if no ip is provided', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
        },
        query: {
          test2: 'test2',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilitySuccessResponse);
      const expectedMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'No ip specified.',
        },
      };

      const checkFluxAvailabilityResult = await fluxCommunication.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });
  });

  describe('getMyFluxIPandPort tests', () => {
    const daemonStub = sinon.stub(daemonService, 'getBenchmarks');

    afterEach(() => {
      daemonStub.restore();
    });

    it('should return IP and Port if benchmark response is correct', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      daemonStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxCommunication.getMyFluxIPandPort();

      expect(getIpResult).to.equal(ip);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return null if daemon\'s response is invalid', async () => {
      const getBenchmarkResponseData = {
        status: 'error',
      };
      daemonStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxCommunication.getMyFluxIPandPort();

      expect(getIpResult).to.be.null;
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return null if daemon\'s response IP is too short', async () => {
      const ip = '12734';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      daemonStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxCommunication.getMyFluxIPandPort();

      expect(getIpResult).to.be.null;
      sinon.assert.calledOnce(daemonStub);
    });
  });

  describe('deterministicFluxList tests', () => {
    const deterministicZelnodeListResponseBase = {
      data: [
        {
          collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: '47.199.51.61:16137',
          network: '',
          added_height: 1076533,
          confirmed_height: 1076535,
          last_confirmed_height: 1079888,
          last_paid_height: 1077653,
          tier: 'CUMULUS',
          payment_address: 't1Z6mWoCrFC2g3iTCFdFkYdTfwtG84E3y2o',
          pubkey: '04378c8585d45861c8783f9c8cd0c85478164c12ce3fd13af1b44ebc8fe1ad6c786e92b211cb9566c596b6e2454d394a06bc44f748afb3c9ee48caa096d704abac',
          activesince: '1647197272',
          lastpaid: '1647333786',
          amount: '1000.00',
          rank: 0,
        },
        {
          collateral: 'COutPoint(46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
          txhash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
          outidx: '0',
          ip: '47.199.51.61:16147',
          network: '',
          added_height: 1079638,
          confirmed_height: 1079642,
          last_confirmed_height: 1079889,
          last_paid_height: 0,
          tier: 'CUMULUS',
          payment_address: 't1UHecy6WiSJXs4Zqt5UvVdRDF7PMbZJK7q',
          pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
          activesince: '1647572455',
          lastpaid: '1516980000',
          amount: '1000.00',
          rank: 1,
        },
        {
          collateral: 'COutPoint(43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8, 0)',
          txhash: '43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8',
          outidx: '0',
          ip: '44.192.51.11:16147',
          network: '',
          added_height: 123456,
          confirmed_height: 1234567,
          last_confirmed_height: 123456,
          last_paid_height: 0,
          tier: 'CUMULUS',
          payment_address: 't1UHecyqtF7PMb6WiSJXs4ZZJK7q5UvVdRD',
          pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
          activesince: '1647572455',
          lastpaid: '1516980000',
          amount: '2000.00',
          rank: 1,
        },
      ],
    };
    const daemonStub = sinon.stub(daemonService, 'viewDeterministicZelNodeList');

    afterEach(() => {
      sinon.restore();
    });

    it('should return the whole list if the filter was not provided', async () => {
      const deterministicZelnodeListResponse = {
        ...deterministicZelnodeListResponseBase,
        status: 'success',
      };
      daemonStub.resolves(deterministicZelnodeListResponse);

      const deterministicFluxListResult = await fluxCommunication.deterministicFluxList();

      expect(deterministicFluxListResult).to.eql(deterministicZelnodeListResponse.data);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return the list filtered out with proper public key', async () => {
      const filteredPubKey = '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';
      const expectedResult = [{
        collateral: 'COutPoint(46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
        txhash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
        outidx: '0',
        ip: '47.199.51.61:16147',
        network: '',
        added_height: 1079638,
        confirmed_height: 1079642,
        last_confirmed_height: 1079889,
        last_paid_height: 0,
        tier: 'CUMULUS',
        payment_address: 't1UHecy6WiSJXs4Zqt5UvVdRDF7PMbZJK7q',
        pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
        activesince: '1647572455',
        lastpaid: '1516980000',
        amount: '1000.00',
        rank: 1,
      },
      {
        collateral: 'COutPoint(43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8, 0)',
        txhash: '43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8',
        outidx: '0',
        ip: '44.192.51.11:16147',
        network: '',
        added_height: 123456,
        confirmed_height: 1234567,
        last_confirmed_height: 123456,
        last_paid_height: 0,
        tier: 'CUMULUS',
        payment_address: 't1UHecyqtF7PMb6WiSJXs4ZZJK7q5UvVdRD',
        pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
        activesince: '1647572455',
        lastpaid: '1516980000',
        amount: '2000.00',
        rank: 1,
      }];

      const deterministicZelnodeListResponse = {
        ...deterministicZelnodeListResponseBase,
        status: 'success',
      };
      daemonStub.resolves(deterministicZelnodeListResponse);

      const deterministicFluxListResult = await fluxCommunication.deterministicFluxList(filteredPubKey);

      expect(deterministicFluxListResult).to.eql(expectedResult);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return an empty list if the public key does not match', async () => {
      const filteredPubKey = '04d50620a31f045c61be42bad44b7a9424asdfde37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';
      const expectedResult = [];

      const deterministicZelnodeListResponse = {
        ...deterministicZelnodeListResponseBase,
        status: 'success',
      };
      daemonStub.resolves(deterministicZelnodeListResponse);

      const deterministicFluxListResult = await fluxCommunication.deterministicFluxList(filteredPubKey);

      expect(deterministicFluxListResult).to.eql(expectedResult);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should get list from cache with no filter applied', async () => {
      // Stub cache to simulate the actual lru-cache called
      const getCacheStub = sinon.stub();
      const stubCache = sinon.stub().callsFake(() => ({
        get: getCacheStub,
      }));
      getCacheStub.withArgs('fluxList').returns(deterministicZelnodeListResponseBase.data);
      fluxCommunication = proxyquire('../../ZelBack/src/services/fluxCommunication',
        { 'lru-cache': stubCache });

      const deterministicFluxListResult = await fluxCommunication.deterministicFluxList();

      expect(deterministicFluxListResult).to.eql(deterministicZelnodeListResponseBase.data);
      sinon.assert.calledOnceWithExactly(getCacheStub, 'fluxList');
    });

    it('should get list from cache with filter applied', async () => {
      const filteredPubKey = '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc';
      const expectedResult = [{
        collateral: 'COutPoint(46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7, 0)',
        txhash: '46c9ae0313fc128d0fb4327f5babc7868fe557035b58e0a7cb475cfd8819f8c7',
        outidx: '0',
        ip: '47.199.51.61:16147',
        network: '',
        added_height: 1079638,
        confirmed_height: 1079642,
        last_confirmed_height: 1079889,
        last_paid_height: 0,
        tier: 'CUMULUS',
        payment_address: 't1UHecy6WiSJXs4Zqt5UvVdRDF7PMbZJK7q',
        pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
        activesince: '1647572455',
        lastpaid: '1516980000',
        amount: '1000.00',
        rank: 1,
      },
      {
        collateral: 'COutPoint(43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8, 0)',
        txhash: '43c9ae0313fc128d0fb4327f5babc7868fe557135b58e0a7cb475cdd8819f8c8',
        outidx: '0',
        ip: '44.192.51.11:16147',
        network: '',
        added_height: 123456,
        confirmed_height: 1234567,
        last_confirmed_height: 123456,
        last_paid_height: 0,
        tier: 'CUMULUS',
        payment_address: 't1UHecyqtF7PMb6WiSJXs4ZZJK7q5UvVdRD',
        pubkey: '04d50620a31f045c61be42bad44b7a9424ffb6de37bf256b88f00e118e59736165255f2f4585b36c7e1f8f3e20db4fa4e55e61cc01dc7a5cd2b2ed0153627588dc',
        activesince: '1647572455',
        lastpaid: '1516980000',
        amount: '2000.00',
        rank: 1,
      }];
      // Stub cache to simulate the actual lru-cache called
      const getCacheStub = sinon.stub();
      const stubCache = sinon.stub().callsFake(() => ({
        get: getCacheStub,
      }));
      getCacheStub.withArgs(`fluxList${filteredPubKey}`).returns(expectedResult);
      fluxCommunication = proxyquire('../../ZelBack/src/services/fluxCommunication',
        { 'lru-cache': stubCache });

      const deterministicFluxListResult = await fluxCommunication.deterministicFluxList(filteredPubKey);

      expect(deterministicFluxListResult).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(getCacheStub, `fluxList${filteredPubKey}`);
    });
  });

  describe('getFluxNodePrivateKey tests', () => {
    let daemonStub;

    beforeEach(() => {
      daemonStub = sinon.stub(daemonService, 'getConfigValue');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return the same private key as provided as an argument', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';

      const getKeyResult = await fluxCommunication.getFluxNodePrivateKey(privateKey);

      expect(getKeyResult).to.equal(privateKey);
      sinon.assert.neverCalledWith(daemonStub);
    });

    it('should return a private key if argument was not provided', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      daemonStub.resolves(mockedPrivKey);

      const getKeyResult = await fluxCommunication.getFluxNodePrivateKey();

      expect(getKeyResult).to.equal(mockedPrivKey);
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });
  });

  describe('getFluxMessageSignature tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('Should properly return signature if private key is provided', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const message = 'testing1234';

      const signature = await fluxCommunication.getFluxMessageSignature(message, privateKey);

      expect(signature).to.be.a('string');
    });

    it('Should properly return signature if private key is taken from config', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const message = 'testing1234';
      const daemonStub = sinon.stub(daemonService, 'getConfigValue').resolves(mockedPrivKey);

      const signature = await fluxCommunication.getFluxMessageSignature(message);

      expect(signature).to.be.a('string');
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });

    it('Should throw error if private key is invalid', async () => {
      const privateKey = 'asdf';
      const message = 'testing1234';

      expect(async () => { await fluxCommunication.getFluxMessageSignature(message, privateKey); }).to.throw;
    });
  });

  describe('getFluxNodePublicKey tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('Should properly return publicKey if private key is provided', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const expectedPublicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const publicKey = await fluxCommunication.getFluxNodePublicKey(privateKey);

      expect(publicKey).to.be.equal(expectedPublicKey);
    });

    it('Should properly return signature if private key is taken from config', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const expectedPublicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
      const daemonStub = sinon.stub(daemonService, 'getConfigValue').resolves(mockedPrivKey);

      const publicKey = await fluxCommunication.getFluxNodePublicKey();

      expect(publicKey).to.be.equal(expectedPublicKey);
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });

    it('Should throw error if private key is invalid', async () => {
      const privateKey = 'asdf';

      expect(async () => { await fluxCommunication.getFluxNodePublicKey(privateKey); }).to.throw;
    });
  });

  describe('verifyFluxBroadcast tests', () => {
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const badPubKey = '074eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const data = {
      app: 'testapp',
      data: 'test',
    };
    const message = JSON.stringify(data);

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if broadcast is verifiable, flux node list provided', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunication.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return true if broadcast is verifiable, flux node list from deterministicFluxList', async () => {
      const deterministicZelnodeListResponse = {
        status: 'success',
        data: [
          {
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
            txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
            outidx: '0',
            ip: '47.199.51.61:16137',
            network: '',
            added_height: 1076533,
            confirmed_height: 1076535,
            last_confirmed_height: 1079888,
            last_paid_height: 1077653,
            tier: 'CUMULUS',
            payment_address: 't1Z6mWoCrFC2g3iTCFdFkYdTfwtG84E3y2o',
            pubkey: '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab',
            activesince: '1647197272',
            lastpaid: '1647333786',
            amount: '1000.00',
            rank: 0,
          },
        ],
      };
      sinon.stub(daemonService, 'viewDeterministicZelNodeList').resolves(deterministicZelnodeListResponse);
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunication.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return false if public key is invalid', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunication.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey: badPubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if version is not 1', async () => {
      const timeStamp = Date.now();
      const version = 2;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunication.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if the message has timestamp greater than 120s in the future', async () => {
      const timeStamp = Date.now() + 240000;
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunication.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });

    it('should return false if the signature is invalid', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature: 'test12341234567',
      };

      const isValid = await fluxCommunication.verifyFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });
  });

  describe.only('verifyOriginalFluxBroadcast tests', () => {
    // Function extends the verifyFluxBroadcast function, only adding time verification.
    // Message can't be older than 5 minutes.
    const privKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
    const pubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
    const data = {
      app: 'testapp',
      data: 'test',
    };
    const message = JSON.stringify(data);

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if broadcast is verifiable, flux node list provided', async () => {
      const timeStamp = Date.now();
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunication.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyOriginalFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(true);
    });

    it('should return false if the message has been sent more than 5 minutes ago', async () => {
      const timeStamp = Date.now() - 340000;
      const version = 1;
      const messageToSign = version + message + timeStamp;
      const signature = await fluxCommunication.getFluxMessageSignature(messageToSign, privKey);
      const dataToSend = {
        version,
        pubKey,
        timestamp: timeStamp,
        data,
        signature,
      };

      const isValid = await fluxCommunication.verifyOriginalFluxBroadcast(dataToSend, fluxList);

      expect(isValid).to.equal(false);
    });
  });

  describe.only('verifyTimestampInFluxBroadcast tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should return true if message timestamp is now, no current timestamp provided', async () => {
      const timeStamp = Date.now();
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunication.verifyTimestampInFluxBroadcast(data);

      expect(isValid).to.equal(true);
    });

    it('should return true if message timestamp is now, timestamp provided', async () => {
      const timeStamp = Date.now();
      const providedTimestamp = Date.now() + 100;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunication.verifyTimestampInFluxBroadcast(data, providedTimestamp);

      expect(isValid).to.equal(true);
    });

    it('should return false if message timestamp is more than 5 minutes ago, current timestamp provided', async () => {
      const timeStamp = Date.now() - 340000;
      const providedTimestamp = Date.now() + 100;
      const data = {
        timestamp: timeStamp,
      };

      const isValid = await fluxCommunication.verifyTimestampInFluxBroadcast(data, providedTimestamp);

      expect(isValid).to.equal(false);
    });
  });
});
