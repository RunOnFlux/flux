/* eslint-disable no-underscore-dangle */
const chai = require('chai');
const sinon = require('sinon');
const WebSocket = require('ws');
const proxyquire = require('proxyquire');
const path = require('path');
const chaiAsPromised = require('chai-as-promised');
const fs = require('fs').promises;
const util = require('util');
const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const daemonServiceBenchmarkRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceWalletRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceWalletRpcs');
const daemonServiceZelnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceZelnodeRpcs');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const {
  outgoingConnections, outgoingPeers, incomingPeers, incomingConnections,
} = require('../../ZelBack/src/services/utils/establishedConnections');

const userconfig = {
  initial: {
    ipaddress: '83.52.214.240',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    kadena: '123456789',
    apiport: '16127',
    testnet: true,
    development: false,
    pgpPrivateKey: '',
    pgpPublicKey: '',
  },
};
const fluxNetworkHelper = proxyquire('../../ZelBack/src/services/fluxNetworkHelper',
  { '../../../config/userconfig': userconfig });

chai.use(chaiAsPromised);
const { expect } = chai;

describe('fluxNetworkHelper tests', () => {
  describe('checkFluxAvailability tests', () => {
    let stub;
    const axiosConfig = {
      timeout: 5000,
    };
    const fluxAvailabilitySuccessResponse = {
      data: {
        status: 'success',
        data: '4.20.0',
      },
    };
    const fluxAvailabilityErrorResponse = {
      data: {
        status: 'error',
        data: '4.20.0',
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
      sinon.restore();
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
      const expectedAddressHome = 'http://127.0.0.1:16124';
      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is available',
        },
      };

      const checkFluxAvailabilityResult = await fluxNetworkHelper.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledWithExactly(stub, expectedAddressHome, axiosConfig);
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
      const expectedAddressHome = 'http://127.0.0.1:16124';
      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is available',
        },
      };

      const checkFluxAvailabilityResult = await fluxNetworkHelper.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledWithExactly(stub, expectedAddressHome, axiosConfig);
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

      const checkFluxAvailabilityResult = await fluxNetworkHelper.checkFluxAvailability(req, mockResponse);

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

      const checkFluxAvailabilityResult = await fluxNetworkHelper.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledOnceWithExactly(mockResponse.json, expectedMessage);
      expect(checkFluxAvailabilityResult).to.eql(expectedMessage);
    });
  });

  describe('getMyFluxIPandPort tests', () => {
    let daemonStub;

    beforeEach(() => {
      daemonStub = sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks');
    });

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

      const getIpResult = await fluxNetworkHelper.getMyFluxIPandPort();

      expect(getIpResult).to.equal(ip);
      sinon.assert.calledOnce(daemonStub);
    });

    it('should return null if daemon\'s response is invalid', async () => {
      const getBenchmarkResponseData = {
        status: 'error',
      };
      daemonStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxNetworkHelper.getMyFluxIPandPort();

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

      const getIpResult = await fluxNetworkHelper.getMyFluxIPandPort();

      expect(getIpResult).to.be.null;
      sinon.assert.calledOnce(daemonStub);
    });
  });

  describe('minVersionSatisfy tests', () => {
    const minimalVersion = '3.4.12';

    it('should return true if major version is higher than minimalVersion', async () => {
      const versionAllowed = await fluxNetworkHelper.minVersionSatisfy('4.0.0', minimalVersion);

      expect(versionAllowed).to.equal(true);
    });

    it('should return true if minor version is higher than minimalVersion', async () => {
      const versionAllowed = await fluxNetworkHelper.minVersionSatisfy('3.6.0', minimalVersion);

      expect(versionAllowed).to.equal(true);
    });

    it('should return true if patch version is higher than minimalVersion', async () => {
      const versionAllowed = await fluxNetworkHelper.minVersionSatisfy('3.4.13', minimalVersion);

      expect(versionAllowed).to.equal(true);
    });

    it('should return true if patch version is equal to minimalVersion', async () => {
      const versionAllowed = await fluxNetworkHelper.minVersionSatisfy('3.4.12', minimalVersion);

      expect(versionAllowed).to.equal(true);
    });

    it('should return false if patch version is below to minimalVersion', async () => {
      const versionAllowed = await fluxNetworkHelper.minVersionSatisfy('3.4.11', minimalVersion);

      expect(versionAllowed).to.equal(false);
    });

    it('should return false if minor version is below to minimalVersion', async () => {
      const versionAllowed = await fluxNetworkHelper.minVersionSatisfy('3.3.11', minimalVersion);

      expect(versionAllowed).to.equal(false);
    });

    it('should return false if major version is below to minimalVersion', async () => {
      const versionAllowed = await fluxNetworkHelper.minVersionSatisfy('2.3.11', minimalVersion);

      expect(versionAllowed).to.equal(false);
    });
  });

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
          data: '4.20.0',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';
      const expectedAddressHome = 'http://127.0.0.1:16126';

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledWithExactly(stub, expectedAddressHome, axiosConfig);
      expect(isFluxAvailableResult).to.equal(true);
    });

    it('Should return true if node is running flux, port provided explicitly', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '4.20.0',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';
      const expectedAddressHome = 'http://127.0.0.1:16124';

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip, port);

      sinon.assert.calledWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledWithExactly(stub, expectedAddressHome, axiosConfig);
      expect(isFluxAvailableResult).to.equal(true);
    });

    it('Should return false if node if flux version is lower than expected', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '2.01.0', // minimum allowed version is 3.19.0
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip, port);

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

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });

    it('Should return false if axios request throws error', async () => {
      stub = sinon.stub(serviceHelper, 'axiosGet').throws();
      const expectedAddress = 'http://127.0.0.1:16125/flux/version';

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip, port);

      sinon.assert.calledOnceWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });
  });

  describe('getFluxNodePrivateKey tests', () => {
    let daemonStub;

    beforeEach(() => {
      daemonStub = sinon.stub(daemonServiceUtils, 'getConfigValue');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return the same private key as provided as an argument', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';

      const getKeyResult = await fluxNetworkHelper.getFluxNodePrivateKey(privateKey);

      expect(getKeyResult).to.equal(privateKey);
      sinon.assert.neverCalledWith(daemonStub);
    });

    it('should return a private key if argument was not provided', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      daemonStub.resolves(mockedPrivKey);

      const getKeyResult = await fluxNetworkHelper.getFluxNodePrivateKey();

      expect(getKeyResult).to.equal(mockedPrivKey);
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });
  });

  describe('getFluxNodePublicKey tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('Should properly return publicKey if private key is provided', async () => {
      const privateKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const expectedPublicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';

      const publicKey = await fluxNetworkHelper.getFluxNodePublicKey(privateKey);

      expect(publicKey).to.be.equal(expectedPublicKey);
    });

    it('Should properly return publicKey if private key is taken from config', async () => {
      const mockedPrivKey = '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh';
      const expectedPublicKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
      const daemonStub = sinon.stub(daemonServiceUtils, 'getConfigValue').resolves(mockedPrivKey);

      const publicKey = await fluxNetworkHelper.getFluxNodePublicKey();

      expect(publicKey).to.be.equal(expectedPublicKey);
      sinon.assert.calledWithExactly(daemonStub, 'zelnodeprivkey');
    });

    it('Should throw error if private key is invalid', async () => {
      const privateKey = 'asdf';

      const result = await fluxNetworkHelper.getFluxNodePublicKey(privateKey);

      expect(result).to.be.an('Error');
    });
  });

  describe('getRandomConnection tests', () => {
    let deterministicFluxListStub;
    const ipList = ['47.199.51.61:16137', '47.199.51.61:16147', '44.192.51.11:16128'];
    let deterministicZelnodeListResponse;

    beforeEach(() => {
      deterministicZelnodeListResponse = [
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
          ip: '44.192.51.11:16128',
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
      ];
      deterministicFluxListStub = sinon.stub(fluxCommunicationUtils, 'deterministicFluxList');
      fluxNetworkHelper.setMyFluxIp('83.52.214.240:16167');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return a random ip out of list of nodes', async () => {
      deterministicZelnodeListResponse = deterministicFluxListStub.returns(deterministicZelnodeListResponse);

      const getRandomConnectionResponse = await fluxNetworkHelper.getRandomConnection();

      expect(getRandomConnectionResponse).to.be.oneOf(ipList);
    });

    it('should return null if ip is the same as userconfig.initial.ipaddress', async () => {
      const nodesListWrongIp = deterministicZelnodeListResponse.map((node) => node);
      nodesListWrongIp.forEach((node) => {
        // eslint-disable-next-line no-param-reassign
        node.ip = '83.52.214.240';
      });
      deterministicFluxListStub.returns(deterministicZelnodeListResponse);

      const getRandomConnectionResponse = await fluxNetworkHelper.getRandomConnection();

      expect(getRandomConnectionResponse).to.be.null;
    });

    it('should return null if ip is null', async () => {
      const nodesListWrongIp = deterministicZelnodeListResponse.map((node) => node);
      nodesListWrongIp.forEach((node) => {
        // eslint-disable-next-line no-param-reassign
        node.ip = null;
      });
      deterministicFluxListStub.returns(deterministicZelnodeListResponse);

      const getRandomConnectionResponse = await fluxNetworkHelper.getRandomConnection();

      expect(getRandomConnectionResponse).to.be.null;
    });

    it('should return null if ip is the same as userconfig.initial.ipaddress', async () => {
      const nodesListWrongIp = deterministicZelnodeListResponse.map((node) => node);
      nodesListWrongIp.forEach((node) => {
        // eslint-disable-next-line no-param-reassign
        node.ip = '83.52.214.240:16127';
      });
      deterministicFluxListStub.returns(deterministicZelnodeListResponse);

      const getRandomConnectionResponse = await fluxNetworkHelper.getRandomConnection();

      expect(getRandomConnectionResponse).to.be.null;
    });

    it('should return null if the node list is empty', async () => {
      deterministicFluxListStub.returns([]);

      const getRandomConnectionResponse = await fluxNetworkHelper.getRandomConnection();

      expect(getRandomConnectionResponse).to.be.null;
    });
  });

  describe('closeConnection tests', () => {
    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.close = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      outgoingConnections.push(ws);
      return ws;
    };
    const addPeerToListOfPeers = (ip) => {
      const peer = {
        ip,
        latency: 50,
      };
      outgoingPeers.push(peer);
      return peer;
    };

    beforeEach(() => {
      outgoingConnections.length = 0;
      outgoingPeers.length = 0;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should close outgoing connection properly if it exists', async () => {
      const ip = '127.9.9.1';
      const successMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: `Outgoing connection to ${ip} closed`,
        },
      };
      const websocket = generateWebsocket(ip, WebSocket.OPEN);
      addPeerToListOfPeers(ip);

      const closeConnectionResult = await fluxNetworkHelper.closeConnection(ip);

      sinon.assert.calledOnceWithExactly(websocket.close, 1000, 'purpusfully closed');
      expect(closeConnectionResult).to.eql(successMessage);
      expect(outgoingConnections).to.have.length(0);
      expect(outgoingPeers).to.have.length(0);
    });

    it('should close outgoing connection properly if it exists and peer is not added to the list', async () => {
      const ip = '127.9.9.1';
      const successMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: `Outgoing connection to ${ip} closed`,
        },
      };
      const websocket = generateWebsocket(ip, WebSocket.OPEN);

      const closeConnectionResult = await fluxNetworkHelper.closeConnection(ip);

      sinon.assert.calledOnceWithExactly(websocket.close, 1000, 'purpusfully closed');
      expect(closeConnectionResult).to.eql(successMessage);
      expect(outgoingConnections).to.have.length(0);
      expect(outgoingPeers).to.have.length(0);
    });

    it('should return warning message if the websocket does not exist', async () => {
      const ip = '127.9.9.1';
      const ip2 = '127.5.5.2';
      const errorMessage = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: `Connection to ${ip} does not exists.`,
        },
      };
      const websocket = generateWebsocket(ip2, WebSocket.OPEN);
      addPeerToListOfPeers(ip2);

      const closeConnectionResult = await fluxNetworkHelper.closeConnection(ip);

      sinon.assert.notCalled(websocket.close);
      expect(closeConnectionResult).to.eql(errorMessage);
      expect(outgoingConnections).to.have.length(1);
      expect(outgoingPeers).to.have.length(1);
    });

    it('should return warning message if ip is not provided', async () => {
      const ip2 = '127.5.5.2';
      const errorMessage = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'To close a connection please provide a proper IP number.',
        },
      };
      const websocket = generateWebsocket(ip2, WebSocket.OPEN);
      addPeerToListOfPeers(ip2);

      const closeConnectionResult = await fluxNetworkHelper.closeConnection();

      sinon.assert.notCalled(websocket.close);
      expect(closeConnectionResult).to.eql(errorMessage);
      expect(outgoingConnections).to.have.length(1);
      expect(outgoingPeers).to.have.length(1);
    });
  });

  describe('closeIncomingConnection tests', () => {
    const generateWebsocket = (ip, readyState) => {
      const ws = {};
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.close = sinon.stub().returns('okay');
      ws._socket = {
        remoteAddress: ip,
      };
      incomingConnections.push(ws);
      return ws;
    };
    const addPeerToListOfPeers = (ip) => {
      const peer = {
        ip,
        latency: 50,
      };
      incomingPeers.push(peer);
      return peer;
    };

    beforeEach(() => {
      incomingConnections.length = 0;
      incomingPeers.length = 0;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should close outgoing connection properly given expressWsList', async () => {
      const ip = '127.9.9.1';
      const successMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: `Incoming connection to ${ip} closed`,
        },
      };
      const websocket = generateWebsocket(ip, WebSocket.OPEN);
      addPeerToListOfPeers(ip);
      const expressWsList = { clients: [websocket] };

      const closeConnectionResult = await fluxNetworkHelper.closeIncomingConnection(ip, expressWsList);

      sinon.assert.calledOnceWithExactly(websocket.close, 1000, 'purpusfully closed');
      expect(closeConnectionResult).to.eql(successMessage);
      expect(incomingConnections).to.have.length(0);
      expect(incomingPeers).to.have.length(0);
    });

    it('should close outgoing connection properly given client to close', async () => {
      const ip = '127.9.9.1';
      const successMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: `Incoming connection to ${ip} closed`,
        },
      };
      const websocket = generateWebsocket(ip, WebSocket.OPEN);
      addPeerToListOfPeers(ip);

      const closeConnectionResult = await fluxNetworkHelper.closeIncomingConnection(ip, [], websocket);

      sinon.assert.calledOnceWithExactly(websocket.close, 1000, 'purpusfully closed');
      expect(closeConnectionResult).to.eql(successMessage);
      expect(incomingConnections).to.have.length(0);
      expect(incomingPeers).to.have.length(0);
    });

    it('should close outgoing connection properly if it exists and peer is not added to the list', async () => {
      const ip = '127.9.9.1';
      const successMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: `Incoming connection to ${ip} closed`,
        },
      };
      const websocket = generateWebsocket(ip, WebSocket.OPEN);
      const expressWsList = { clients: [websocket] };

      const closeConnectionResult = await fluxNetworkHelper.closeIncomingConnection(ip, expressWsList);

      sinon.assert.calledOnceWithExactly(websocket.close, 1000, 'purpusfully closed');
      expect(closeConnectionResult).to.eql(successMessage);
      expect(incomingConnections).to.have.length(0);
      expect(incomingPeers).to.have.length(0);
    });

    it('should return warning message if the websocket does not exist', async () => {
      const ip = '127.9.9.1';
      const ip2 = '127.5.5.2';
      const errorMessage = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: `Connection from ${ip} does not exists.`,
        },
      };
      const websocket = generateWebsocket(ip2, WebSocket.OPEN);
      const expressWsList = { clients: [websocket] };
      addPeerToListOfPeers(ip2);

      const closeConnectionResult = await fluxNetworkHelper.closeIncomingConnection(ip, expressWsList);

      sinon.assert.notCalled(websocket.close);
      expect(closeConnectionResult).to.eql(errorMessage);
      expect(incomingConnections).to.have.length(1);
      expect(incomingPeers).to.have.length(1);
    });

    it('should return warning message if the websocket does not exist', async () => {
      const ip2 = '127.5.5.2';
      const errorMessage = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'To close a connection please provide a proper IP number.',
        },
      };
      const websocket = generateWebsocket(ip2, WebSocket.OPEN);
      addPeerToListOfPeers(ip2);

      const closeConnectionResult = await fluxNetworkHelper.closeIncomingConnection();

      sinon.assert.notCalled(websocket.close);
      expect(closeConnectionResult).to.eql(errorMessage);
      expect(incomingConnections).to.have.length(1);
      expect(incomingPeers).to.have.length(1);
    });
  });

  describe('checkRateLimit tests', () => {
    it('should return true if rate limit is not exceeded', async () => {
      const checkRateLimitRes = fluxNetworkHelper.checkRateLimit('129.0.0.9');

      expect(checkRateLimitRes).to.equal(true);
    });

    it('should return false if rate limit is exceeded', async () => {
      const ip = '129.0.0.10';
      for (let i = 0; i < 16; i += 1) {
        fluxNetworkHelper.checkRateLimit(ip);
      }

      const checkRateLimitRes = fluxNetworkHelper.checkRateLimit(ip);

      expect(checkRateLimitRes).to.equal(false);
    });

    it('should return false if a custom rate limit is exceeded', async () => {
      const ip = '129.0.0.11';
      for (let i = 0; i < 5; i += 1) {
        fluxNetworkHelper.checkRateLimit(ip, 10, 5);
      }

      const checkRateLimitRes = fluxNetworkHelper.checkRateLimit(ip, 10, 5);

      expect(checkRateLimitRes).to.equal(false);
    });

    it('should return false if a custom replenish rate is not enough', async () => {
      const ip = '129.0.0.13';

      for (let i = 0; i < 5; i += 1) {
        fluxNetworkHelper.checkRateLimit(ip, 5, 5);
      }
      await serviceHelper.delay(1000);
      for (let i = 0; i < 5; i += 1) {
        fluxNetworkHelper.checkRateLimit(ip, 5, 5);
      }

      const checkRateLimitRes = fluxNetworkHelper.checkRateLimit(ip, 5, 5);

      expect(checkRateLimitRes).to.equal(false);
    });

    it('should return true when the rate limit bucket has been replenished', async () => {
      const ip = '129.0.0.14';
      for (let i = 0; i < 16; i += 1) {
        fluxNetworkHelper.checkRateLimit(ip);
      }

      await serviceHelper.delay(1000);
      const checkRateLimitRes = fluxNetworkHelper.checkRateLimit(ip);

      expect(checkRateLimitRes).to.equal(true);
    });
  });

  describe('getIncomingConnections tests', () => {
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };
    const generateWebsocket = (ip) => {
      const ws = {};
      ws._socket = {
        remoteAddress: ip,
      };
      return ws;
    };

    afterEach(() => {
      sinon.restore();
    });

    it('should return success message with incoming connections\' ips', async () => {
      const ips = ['127.0.0.1', '127.0.0.2'];
      const websocket1 = generateWebsocket(ips[0]);
      const websocket2 = generateWebsocket(ips[1]);
      const expressWsList = { clients: [websocket1, websocket2] };
      const res = generateResponse();
      const expectedCallArgumeent = { status: 'success', data: ['127.0.0.1', '127.0.0.2'] };

      fluxNetworkHelper.getIncomingConnections(undefined, res, expressWsList);

      sinon.assert.calledOnceWithExactly(res.json, expectedCallArgumeent);
    });

    it('should return success message with empty array if there are no incoming connections', async () => {
      const expressWsList = { clients: [] };
      const res = generateResponse();
      const expectedCallArgumeent = { status: 'success', data: [] };

      fluxNetworkHelper.getIncomingConnections(undefined, res, expressWsList);

      sinon.assert.calledOnceWithExactly(res.json, expectedCallArgumeent);
    });
  });

  describe('getIncomingConnectionsInfo tests', () => {
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };
    const addPeerToListOfPeers = (ip) => {
      const peer = {
        ip,
        latency: 50,
      };
      incomingPeers.push(peer);
      return peer;
    };

    beforeEach(() => {
      incomingPeers.length = 0;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return success message with incoming connections\' info', async () => {
      const ips = ['127.0.0.1', '127.0.0.2'];
      addPeerToListOfPeers(ips[0]);
      addPeerToListOfPeers(ips[1]);
      const res = generateResponse();
      const expectedCallArgumeent = {
        status: 'success',
        data: [
          { ip: '127.0.0.1', latency: 50 },
          { ip: '127.0.0.2', latency: 50 },
        ],
      };

      fluxNetworkHelper.getIncomingConnectionsInfo(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedCallArgumeent);
    });

    it('should return success message with empty array if there are no incoming connections', async () => {
      const res = generateResponse();
      const expeectedCallArgumeent = { status: 'success', data: [] };

      fluxNetworkHelper.getIncomingConnectionsInfo(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expeectedCallArgumeent);
    });
  });

  describe('checkFluxbenchVersionAllowed tests', () => {
    // minimumFluxBenchAllowedVersion = '3.8.0';
    let benchmarkInfoResponseStub;

    beforeEach(() => {
      benchmarkInfoResponseStub = sinon.stub(benchmarkService, 'getInfo');
      fluxNetworkHelper.setStoredFluxBenchAllowed(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if bench version is higher than minimal and stored in cache', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('4.0.0');

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
    });

    it('should return true if bench version is equal to minimal and stored in cache', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('3.8.0');

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
    });

    it('should return false if bench version is lower than minimal and is stored in cache', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('3.0.0');

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(false);
    });

    it('should return true if the version is higher than minimal and is not set in cache', async () => {
      const benchmarkInfoResponse = {
        status: 'success',
        data: {
          version: '5.41.3',
        },
      };
      benchmarkInfoResponseStub.returns(benchmarkInfoResponse);

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
      expect(fluxNetworkHelper.getStoredFluxBenchAllowed()).to.equal('5.41.3');
    });

    it('should return true if the version is equal to minimal and is not set in cache', async () => {
      const benchmarkInfoResponse = {
        status: 'success',
        data: {
          version: '3.8.0',
        },
      };
      benchmarkInfoResponseStub.returns(benchmarkInfoResponse);

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
      expect(fluxNetworkHelper.getStoredFluxBenchAllowed()).to.equal('3.8.0');
    });

    it('should return false if the version is lower than minimal and is not set in cache', async () => {
      const benchmarkInfoResponse = {
        status: 'success',
        data: {
          version: '2.0.0',
        },
      };
      benchmarkInfoResponseStub.returns(benchmarkInfoResponse);

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(false);
      expect(fluxNetworkHelper.getStoredFluxBenchAllowed()).to.equal('2.0.0');
    });

    it('should return false if the version is unattainable from benchmarkInfo', async () => {
      const benchmarkInfoResponse = {
        status: 'error',
        data: {
          test: 'test',
        },
      };
      benchmarkInfoResponseStub.returns(benchmarkInfoResponse);

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(false);
      expect(fluxNetworkHelper.getStoredFluxBenchAllowed()).to.equal(null);
    });

    it('should return false if benchmarkInfo throws error', async () => {
      benchmarkInfoResponseStub.throws();

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(false);
      expect(fluxNetworkHelper.getStoredFluxBenchAllowed()).to.equal(null);
    });
  });

  describe('checkMyFluxAvailability tests', () => {
    beforeEach(() => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('4.0.0');
      fluxNetworkHelper.setMyFluxIp('129.3.3.3');
      const deterministicZelnodeListResponse = [
        {
          collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: '129.1.1.1',
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
      ];
      sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').returns(deterministicZelnodeListResponse);
      sinon.stub(daemonServiceWalletRpcs, 'createConfirmationTransaction').returns(true);
      sinon.stub(serviceHelper, 'delay').returns(true);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false if the flux bench version is lower than allowed', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('2.0.0');

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });

    it('should return false if get random connection returns user\'s own ip', async () => {
      fluxNetworkHelper.setMyFluxIp('129.1.1.1');

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });

    it('should return false if fluxIp is null', async () => {
      fluxNetworkHelper.setMyFluxIp(null);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });

    it('should return false if axsiosGet throws error', async () => {
      sinon.stub(serviceHelper, 'axiosGet').rejects();

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });

    it('should return false if axsiosGet resolves null', async () => {
      sinon.stub(serviceHelper, 'axiosGet').resolves(null);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });

    it('should return true if axios status response is success', async () => {
      const axiosGetResponse = {
        data: {
          status: 'success',
          data: {
            message: 'all is good!',
          },
        },
      };
      sinon.stub(serviceHelper, 'axiosGet').resolves(axiosGetResponse);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.true;
    });

    it('should return true if axios status response is success', async () => {
      const axiosGetResponse = {
        data: {
          status: 'success',
          data: {
            message: 'all is good!',
          },
        },
      };
      sinon.stub(serviceHelper, 'axiosGet').resolves(axiosGetResponse);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.true;
    });

    it('should return false if getPublicIp status is not a success', async () => {
      const getPublicIptResponse = {
        status: 'error',
      };
      sinon.stub(benchmarkService, 'getPublicIp').returns(getPublicIptResponse);
      const axiosGetResponse = {
        data: {
          status: 'success',
          data: {
            message: 'all is good!',
          },
        },
      };
      sinon.stub(serviceHelper, 'axiosGet').resolves(axiosGetResponse);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.true;
    });

    it('should return false if getPublicIp status is not a success', async () => {
      const getPublicIptResponse = {
        status: 'error',
      };
      sinon.stub(benchmarkService, 'getPublicIp').returns(getPublicIptResponse);
      const axiosGetResponse = {
        data: {
          status: 'success',
          data: {
            message: 'all is good!',
          },
        },
      };
      sinon.stub(serviceHelper, 'axiosGet').resolves(axiosGetResponse);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.true;
    });

    it('should return true if getPublicIp status is a success and has a proper ip', async () => {
      const getPublicIptResponse = {
        status: 'success',
        data: '129.0.0.1',
      };
      sinon.stub(benchmarkService, 'getPublicIp').returns(getPublicIptResponse);
      const axiosGetResponse = {
        data: {
          status: 'error',
          data: {
            message: 'all is good!',
          },
        },
      };
      sinon.stub(serviceHelper, 'axiosGet').resolves(axiosGetResponse);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.true;
    });

    it('should return true if getPublicIp status is a success and does not have a proper ip', async () => {
      const getPublicIptResponse = {
        status: 'success',
        data: '120',
      };
      sinon.stub(benchmarkService, 'getPublicIp').returns(getPublicIptResponse);
      const axiosGetResponse = {
        data: {
          status: 'error',
          data: {
            message: 'all is good!',
          },
        },
      };
      sinon.stub(serviceHelper, 'axiosGet').resolves(axiosGetResponse);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });
  });

  describe('adjustExternalIP tests', () => {
    let writeFileStub;

    beforeEach(() => {
      writeFileStub = sinon.stub(fs, 'writeFile').returns({});
    });
    afterEach(() => {
      sinon.restore();
    });

    it('should properly write a new ip to the config', () => {
      const newIp = '127.0.0.66';
      const callPath = path.join(__dirname, '../../config/userconfig.js');

      fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/module.exports = {/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/initial: {/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/ipaddress: '127.0.0.66',/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/kadena: '123456789',/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/testnet: true,/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/development: false,/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/apiport: 16127,/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/pgpPrivateKey: '',/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/pgpPublicKey: '',/gm));
    });

    it('should not write to file if the config already has same exact ip', () => {
      const newIp = userconfig.initial.ipaddress;

      fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.notCalled(writeFileStub);
    });

    it('should not write to file if ip does not have a proper format', () => {
      const newIp = '127111111';

      fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.notCalled(writeFileStub);
    });

    it('should not write to file if ip is not a string', () => {
      const newIp = 121;

      fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.notCalled(writeFileStub);
    });

    it('should not write to file if ip is empty', () => {
      const newIp = '';

      fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.notCalled(writeFileStub);
    });
  });

  describe('checkDeterministicNodesCollisions tests', () => {
    let getBenchmarksStub;
    let isDaemonSyncedStub;
    let deterministicFluxListStub;
    let getZelNodeStatusStub;
    let deterministicZelnodeListResponse;

    beforeEach(() => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('4.0.0');
      fluxNetworkHelper.setMyFluxIp('129.3.3.3');
      sinon.stub(daemonServiceWalletRpcs, 'createConfirmationTransaction').returns(true);
      sinon.stub(serviceHelper, 'delay').returns(true);
      deterministicZelnodeListResponse = [
        {
          collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: '127.0.0.1:5050',
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
        }];
      getBenchmarksStub = sinon.stub(daemonServiceBenchmarkRpcs, 'getBenchmarks');
      isDaemonSyncedStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
      deterministicFluxListStub = sinon.stub(fluxCommunicationUtils, 'deterministicFluxList');
      getZelNodeStatusStub = sinon.stub(daemonServiceZelnodeRpcs, 'getZelNodeStatus');
      fluxNetworkHelper.setDosMessage(null);
      fluxNetworkHelper.setDosStateValue(0);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should not change dosMessage ', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(deterministicZelnodeListResponse);
      getZelNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          },
        },
      );

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      expect(fluxNetworkHelper.getDosMessage()).to.be.null;
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(0);
    });

    it('should find the same node instances and warn about earlier collision detection', async () => {
      const multipleNodesList = [
        deterministicZelnodeListResponse[0],
        {
          collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: '127.0.0.1:5050',
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
      ];
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(multipleNodesList);
      getZelNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          },
        },
      );

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      expect(fluxNetworkHelper.getDosMessage()).to.equal('Flux earlier collision detection on ip:127.0.0.1:5050');
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(100);
    });

    it('should trigger collision detection if the collateral is not matching', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(deterministicZelnodeListResponse);
      getZelNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e123556, 0)',
          },
        },
      );

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      expect(fluxNetworkHelper.getDosMessage()).to.equal('Flux collision detection');
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(100);
    });
  });

  describe('getDOSState tests', () => {
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(() => {
      fluxNetworkHelper.setDosMessage(null);
      fluxNetworkHelper.setDosStateValue(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return nulls by default', async () => {
      const expectedResult = {
        status: 'success',
        data: {
          dosState: null,
          dosMessage: null,
        },
      };

      const result = await fluxNetworkHelper.getDOSState();

      expect(result).to.eql(expectedResult);
    });

    it('should return nulls by default to the passed response', async () => {
      const res = generateResponse();
      const expectedResult = {
        status: 'success',
        data: {
          dosState: null,
          dosMessage: null,
        },
      };

      const result = await fluxNetworkHelper.getDOSState(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      expect(result).to.eql(expectedResult);
    });

    it('should return a proper message if no response was passed', async () => {
      const newDosState = 150;
      const newDosMessage = 'Hi! this is the new massage';
      fluxNetworkHelper.setDosMessage(newDosMessage);
      fluxNetworkHelper.setDosStateValue(newDosState);
      const expectedResult = {
        status: 'success',
        data: {
          dosState: newDosState,
          dosMessage: newDosMessage,
        },
      };

      const result = await fluxNetworkHelper.getDOSState();

      expect(result).to.eql(expectedResult);
    });

    it('should pass a proper message to the response', async () => {
      const res = generateResponse();
      const newDosState = 150;
      const newDosMessage = 'Hi! this is the new massage';
      fluxNetworkHelper.setDosMessage(newDosMessage);
      fluxNetworkHelper.setDosStateValue(newDosState);
      const expectedResult = {
        status: 'success',
        data: {
          dosState: newDosState,
          dosMessage: newDosMessage,
        },
      };

      const result = await fluxNetworkHelper.getDOSState(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedResult);
      expect(result).to.eql(expectedResult);
    });
  });

  describe('allowPort tests', () => {
    const port = '12345';
    afterEach(() => {
      sinon.restore();
    });

    it('should properly enable a new port in string format', async () => {
      await fluxNetworkHelper.denyPort(port);

      const result = await fluxNetworkHelper.allowPort(port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n');
    }).timeout(5000);

    it('should properly enable a new port in number format', async () => {
      await fluxNetworkHelper.denyPort(port);

      const result = await fluxNetworkHelper.allowPort(+port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n');
    }).timeout(5000);

    it('should skip updating if policy already exists', async () => {
      await fluxNetworkHelper.allowPort(port);

      const result = await fluxNetworkHelper.allowPort(port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('Skipping adding existing rule\nSkipping adding existing rule (v6)\nSkipping adding existing rule\nSkipping adding existing rule (v6)\n');
    }).timeout(5000);

    it('should throw error if the parameter is not a proper number', async () => {
      await expect(fluxNetworkHelper.allowPort('test')).to.eventually.be.rejectedWith('ERROR: Could not find a profile matching \'test\'');
    });

    it('should return status: false if the command response does not include words "udpdated", "existing" or "added"', async () => {
      sinon.stub(util, 'promisify').returns(() => 'testing');

      const result = await fluxNetworkHelper.allowPort(12345);

      expect(result.status).to.eql(false);
    }).timeout(5000);
  });

  describe('denyPort tests', () => {
    const port = '32111';

    beforeEach(async () => {
      await fluxNetworkHelper.allowPort(port);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should deny port given in a string format', async () => {
      const result = await fluxNetworkHelper.denyPort(port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n');
    }).timeout(5000);

    it('should deny port given in a number format', async () => {
      const result = await fluxNetworkHelper.denyPort(+port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n');
    }).timeout(5000);

    it('should skip updating if policy already exists', async () => {
      await fluxNetworkHelper.denyPort(port);

      const result = await fluxNetworkHelper.denyPort(port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('Skipping adding existing rule\nSkipping adding existing rule (v6)\nSkipping adding existing rule\nSkipping adding existing rule (v6)\n');
    }).timeout(5000);

    it('should throw error if the parameter is not a proper number', async () => {
      await expect(fluxNetworkHelper.denyPort('test')).to.eventually.be.rejectedWith('ERROR: Could not find a profile matching \'test\'');
    });

    it('should return status: false if the command response does not include words "udpdated", "existing" or "added"', async () => {
      sinon.stub(util, 'promisify').returns(() => 'testing');

      const result = await fluxNetworkHelper.denyPort(12345);

      expect(result.status).to.eql(false);
    }).timeout(5000);
  });

  describe('allowPortApi tests', () => {
    let verifyPrivilegeStub;
    const port = '5555';
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    beforeEach(async () => {
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
      await fluxNetworkHelper.denyPort(port);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return a success message if the port number is properly passed in the params', async () => {
      verifyPrivilegeStub.returns(true);
      const res = generateResponse();
      const req = {
        params: {
          port,
        },
      };
      const expectedResult = {
        status: 'success',
        data: {
          code: '5555',
          name: '5555',
          message: 'Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n',
        },
      };

      const result = await fluxNetworkHelper.allowPortApi(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verifyPrivilegeStub, 'adminandfluxteam', req);
    });

    it('should return a success message if the port number is properly passed in query', async () => {
      verifyPrivilegeStub.returns(true);
      const res = generateResponse();
      const req = {
        params: {
          testing: 'testing',
        },
        query: {
          port,
        },
      };
      const expectedResult = {
        status: 'success',
        data: {
          code: '5555',
          name: '5555',
          message: 'Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n',
        },
      };

      const result = await fluxNetworkHelper.allowPortApi(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verifyPrivilegeStub, 'adminandfluxteam', req);
    });

    it('should return an unauthorized message if privilege is not right', async () => {
      verifyPrivilegeStub.returns(false);
      const res = generateResponse();
      const req = {
        params: {
          port,
        },
      };
      const expectedResult = {
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      };

      const result = await fluxNetworkHelper.allowPortApi(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verifyPrivilegeStub, 'adminandfluxteam', req);
    });

    it('should return an error message if allowPort status is false', async () => {
      const errorMessage = 'This is error message';
      sinon.stub(util, 'promisify').returns(() => errorMessage);
      verifyPrivilegeStub.returns(true);
      const res = generateResponse();
      const req = {
        params: {
          port,
        },
      };
      const expectedResult = {
        status: 'error',
        data: {
          code: '5555',
          name: '5555',
          message: errorMessage,
        },
      };

      const result = await fluxNetworkHelper.allowPortApi(req, res);

      expect(result).to.eql(expectedResult);
      sinon.assert.calledOnceWithExactly(verifyPrivilegeStub, 'adminandfluxteam', req);
    });
  });

  describe('isFirewallActive tests', () => {
    let utilStub;
    let funcStub;
    beforeEach(() => {
      utilStub = sinon.stub(util, 'promisify');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if firewall is active', async () => {
      funcStub = sinon.fake(() => 'Status: active');
      utilStub.returns(funcStub);

      const isFirewallActive = await fluxNetworkHelper.isFirewallActive();

      expect(isFirewallActive).to.be.true;
      sinon.assert.calledOnceWithExactly(funcStub, 'sudo ufw status | grep Status');
    });

    it('should return false if firewall is not active', async () => {
      funcStub = sinon.fake(() => 'Status: not active');
      utilStub.returns(funcStub);

      const isFirewallActive = await fluxNetworkHelper.isFirewallActive();

      expect(isFirewallActive).to.be.false;
      sinon.assert.calledOnceWithExactly(funcStub, 'sudo ufw status | grep Status');
    });

    it('should return false command execution throws error', async () => {
      funcStub = sinon.fake.throws();
      utilStub.returns(funcStub);

      const isFirewallActive = await fluxNetworkHelper.isFirewallActive();

      expect(isFirewallActive).to.be.false;
      sinon.assert.calledOnceWithExactly(funcStub, 'sudo ufw status | grep Status');
    });
  });

  describe('adjustFirewall tests', () => {
    let utilStub;
    let funcStub;
    let logSpy;
    const ports = [16127, 16126, 16129, 80, 443, 16125, 11, 13];
    beforeEach(() => {
      utilStub = sinon.stub(util, 'promisify');
      logSpy = sinon.spy(log, 'info');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should adjust firewall ports for the whole list of ports - all are active', async () => {
      funcStub = sinon.fake(async (command) => (command.includes('grep Status') ? 'Status: active' : 'updated'));
      utilStub.returns(funcStub);

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledWith(funcStub, 'sudo ufw status | grep Status');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.calledWith(funcStub, `sudo ufw allow ${port}`);
        sinon.assert.calledWith(logSpy, `Firewall adjusted for port ${port}`);
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.calledWith(funcStub, `sudo ufw allow out ${port}`);
        sinon.assert.calledWith(logSpy, `Firewall adjusted for port ${port}`);
      }
    });

    it('should log info if ports were not able to be adjusted', async () => {
      funcStub = sinon.fake(async (command) => (command.includes('grep Status') ? 'Status: active' : 'failure'));
      utilStub.returns(funcStub);

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledWith(funcStub, 'sudo ufw status | grep Status');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.calledWith(funcStub, `sudo ufw allow ${port}`);
        sinon.assert.calledWith(logSpy, `Failed to adjust Firewall for port ${port}`);
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.calledWith(funcStub, `sudo ufw allow out ${port}`);
        sinon.assert.calledWith(logSpy, `Failed to adjust Firewall for port ${port}`);
      }
    });

    it('should log info if ports were not able to be adjusted', async () => {
      funcStub = sinon.fake(async (command) => (command.includes('grep Status') ? 'Status: not active' : 'failure'));
      utilStub.returns(funcStub);

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledWith(funcStub, 'sudo ufw status | grep Status');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.neverCalledWith(funcStub, `sudo ufw allow ${port}`);
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.neverCalledWith(funcStub, `sudo ufw allow out ${port}`);
      }
      sinon.assert.calledWith(logSpy, 'Firewall is not active. Adjusting not applied');
    });
  });

  describe('isCommunicationEstablished tests', () => {
    const minNumberOfIncoming = 4;
    const minNumberOfOutgoing = 8;
    const dummyPeer = {
      ip: '192.168.0.0',
      lastPingTime: new Date().getTime(),
      latency: 50,
    };
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };
    const populatePeers = (numberOfincomingPeers, numberOfOutgoingPeers) => {
      outgoingPeers.length = 0;
      incomingPeers.length = 0;
      for (let i = 0; i < numberOfincomingPeers; i += 1) {
        incomingPeers.push(dummyPeer);
      }
      for (let i = 0; i < numberOfOutgoingPeers; i += 1) {
        outgoingPeers.push(dummyPeer);
      }
    };
    const expectedSuccesssResponse = {
      status: 'success',
      data: {
        code: undefined,
        name: undefined,
        message: 'Communication to Flux network is properly established',
      },
    };
    const expectedErrorResponseOutgoing = {
      status: 'error',
      data: {
        code: undefined,
        name: undefined,
        message: 'Not enough outgoing connections established to Flux network',
      },
    };
    const expectedErrorResponseIncoming = {
      status: 'error',
      data: {
        code: undefined,
        name: undefined,
        message: 'Not enough incoming connections from Flux network',
      },
    };

    afterEach(() => {
      outgoingPeers.length = 0;
      incomingPeers.length = 0;
      sinon.restore();
    });

    it('should return a positive respone if communication is established properly', () => {
      const res = generateResponse();
      populatePeers(minNumberOfIncoming, minNumberOfOutgoing);

      fluxNetworkHelper.isCommunicationEstablished(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedSuccesssResponse);
    });

    it('should return a negative respone if there are not enough incoming peers', () => {
      const res = generateResponse();
      populatePeers(minNumberOfIncoming - 1, minNumberOfOutgoing);

      fluxNetworkHelper.isCommunicationEstablished(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorResponseIncoming);
    });

    it('should return a negative respone if there are not enough outgoing peers', () => {
      const res = generateResponse();
      populatePeers(minNumberOfIncoming, minNumberOfOutgoing - 1);

      fluxNetworkHelper.isCommunicationEstablished(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorResponseOutgoing);
    });

    it('should return a negative respone if there are not enough incoming or outgoing peers', () => {
      const res = generateResponse();
      populatePeers(minNumberOfIncoming - 1, minNumberOfOutgoing - 1);

      fluxNetworkHelper.isCommunicationEstablished(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedErrorResponseOutgoing);
    });
  });

  describe('fluxUptime tests', () => {
    const ut = process.uptime();

    it('should return a positive a bigger uptime than expected', () => {
      const fluxUptime = fluxNetworkHelper.fluxUptime();

      expect(fluxUptime.status).to.equal('success');
      expect(fluxUptime.data).to.be.gte(ut);
      const utb = process.uptime();
      expect(fluxUptime.data).to.be.lte(utb);
    });
  });
});
