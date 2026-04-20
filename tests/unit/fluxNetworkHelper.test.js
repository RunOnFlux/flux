/* eslint-disable no-underscore-dangle */
globalThis.userconfig = {
  initial: {
    ipaddress: '127.0.0.1',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    kadena: 'kadena:3a2e6166907d0c2fb28a16cd6966a705de129e8358b9872d9cefe694e910d5b2?chainid=0',
    testnet: false,
    development: false,
    apiport: 16127,
    routerIP: '',
    pgpPrivateKey: '',
    pgpPublicKey: '',
    blockedPorts: [],
    blockedRepositories: [],
  },
};

const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const WebSocket = require('ws');
const path = require('path');
const chaiAsPromised = require('chai-as-promised');
const fs = require('fs').promises;
const util = require('util');
const log = require('../../ZelBack/src/lib/log');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const daemonServiceWalletRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceWalletRpcs');
const daemonServiceFluxnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceFluxnodeRpcs');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const { requireMongo } = require('./dbTestHelper');
const upnpService = require('../../ZelBack/src/services/upnpService');

const net = require('node:net');

const { peerManager } = require('../../ZelBack/src/services/utils/peerState');
const { PEER_SOURCE } = require('../../ZelBack/src/services/utils/FluxPeerSocket');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('fluxNetworkHelper tests', () => {
  // Global beforeEach to mock UPnP service for all tests
  beforeEach(() => {
    sinon.stub(upnpService, 'isUPNP').returns(false);
    sinon.stub(upnpService, 'removeMapUpnpPort').resolves(true);
    sinon.stub(upnpService, 'mapUpnpPort').resolves(true);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('checkFluxAvailability tests', () => {
    let stub;
    const axiosConfig = {
      timeout: 5000,
    };
    const fluxAvailabilitySuccessResponse = {
      data: {
        status: 'success',
        data: '8.2.0',
      },
    };
    Object.setPrototypeOf(fluxAvailabilitySuccessResponse.data, { // axios on home expects string
      includes() {
        return true;
      },
    });
    const fluxAvailabilityErrorResponse = {
      data: {
        status: 'error',
        data: '8.2.0',
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
          port: '16127',
        },
        query: {
          test2: 'test2',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilitySuccessResponse);
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      sinon.stub(net.Socket.prototype, 'connect').callsFake((_port, _ip, callback) => {
        callback();
      });
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';
      const expectedAddressHome = 'http://127.0.0.1:16126/health';
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

    it('Should return success message if proper parameters are passed in query', async () => {
      const mockResponse = generateResponse();
      const req = {
        params: {
          test1: 'test1',
        },
        query: {
          test2: 'test2',
          ip: '127.0.0.1',
          port: '16127',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilitySuccessResponse);
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      sinon.stub(net.Socket.prototype, 'connect').callsFake((port, ip, callback) => {
        callback();
      });
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';
      const expectedAddressHome = 'http://127.0.0.1:16126/health';
      const expectedMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is available',
        },
      };
      sinon.stub(fluxNetworkHelper, 'isPortOpen').resolves(true);

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
          port: '16127',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(fluxAvailabilityErrorResponse);
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';
      const expectedMessage = {
        status: 'error',
        data: {
          code: undefined,
          name: undefined,
          message: 'Asking Flux is not available',
        },
      };

      const checkFluxAvailabilityResult = await fluxNetworkHelper.checkFluxAvailability(req, mockResponse);

      sinon.assert.calledWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledWithExactly(mockResponse.json, expectedMessage);
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
    let benchStub;

    beforeEach(() => {
      benchStub = sinon.stub(benchmarkService, 'getBenchmarks');
    });

    afterEach(() => {
      benchStub.restore();
    });

    it('should return IP and Port if benchmark response is correct', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: ip },
      };
      benchStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxNetworkHelper.getMyFluxIPandPort();

      expect(getIpResult).to.equal(ip);
      sinon.assert.calledOnce(benchStub);
    });

    it('should return null if daemon\'s response is invalid', async () => {
      const getBenchmarkResponseData = {
        status: 'error',
      };
      benchStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxNetworkHelper.getMyFluxIPandPort();

      expect(getIpResult).to.be.null;
      sinon.assert.calledOnce(benchStub);
    });

    it('should return null if daemon\'s response IP is too short', async () => {
      const ip = '12734';
      const getBenchmarkResponseData = {
        status: 'success',
        data: JSON.stringify({ ipaddress: ip }),
      };
      benchStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxNetworkHelper.getMyFluxIPandPort();

      expect(getIpResult).to.be.null;
      sinon.assert.calledOnce(benchStub);
    });
  });

  describe('isFluxAvailable tests', () => {
    let stub;
    const ip = '127.0.0.1';
    const port = '16127';
    const axiosConfig = {
      timeout: 5000,
    };

    afterEach(() => {
      sinon.restore();
    });

    it('Should return true if node is running flux, port taken from config', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '8.2.0',
        },
      };
      Object.setPrototypeOf(mockResponse.data, { // axios on home expects string
        includes() {
          return true;
        },
      });
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      sinon.stub(net.Socket.prototype, 'connect').callsFake((_port, _ip, callback) => {
        callback();
      });
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';
      const expectedAddressHome = 'http://127.0.0.1:16126/health';

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip);

      sinon.assert.calledWithExactly(stub, expectedAddress, axiosConfig);
      sinon.assert.calledWithExactly(stub, expectedAddressHome, axiosConfig);
      expect(isFluxAvailableResult).to.equal(true);
    });

    it('Should return true if node is running flux, port provided explicitly', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: '8.2.0',
        },
      };
      Object.setPrototypeOf(mockResponse.data, { // axios on home expects string
        includes() {
          return true;
        },
      });
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      sinon.stub(net.Socket.prototype, 'connect').callsFake((_port, _ip, callback) => {
        callback();
      });
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';
      const expectedAddressHome = 'http://127.0.0.1:16126/health';

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
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip, port);

      sinon.assert.calledWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });

    it('Should return false if response status is not success', async () => {
      const mockResponse = {
        data: {
          status: 'error',
        },
      };
      stub = sinon.stub(serviceHelper, 'axiosGet').resolves(mockResponse);
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip, port);

      sinon.assert.calledWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });

    it('Should return false if axios request throws error', async () => {
      stub = sinon.stub(serviceHelper, 'axiosGet').throws();
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      const expectedAddress = 'http://127.0.0.1:16127/flux/version';

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip, port);

      sinon.assert.calledWithExactly(stub, expectedAddress, axiosConfig);
      expect(isFluxAvailableResult).to.equal(false);
    });

    it('Should return false if node is not a confirmed flux node', async () => {
      stub = sinon.stub(serviceHelper, 'axiosGet');
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(false);

      const isFluxAvailableResult = await fluxNetworkHelper.isFluxAvailable(ip, port);

      sinon.assert.notCalled(stub);
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

  describe('closeConnection tests', () => {
    before(() => {
      peerManager.reset();
    });

    const generateWebsocket = (ip, port, readyState) => {
      const ws = {};
      ws.port = String(port);
      ws.ip = ip;
      ws.readyState = readyState;
      ws.ping = sinon.stub().returns('pong');
      ws.close = sinon.stub().returns('okay');
      ws.on = sinon.stub();
      ws._socket = {
        remoteAddress: ip,
      };
      peerManager.add(ws, ip, String(port), { source: PEER_SOURCE.RANDOM });
      return ws;
    };

    afterEach(() => {
      peerManager.reset();
      sinon.restore();
    });

    it('should close outgoing connection properly if it exists', async () => {
      const ip = '127.9.9.1';
      const port = '16127';
      const successMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: `Outgoing connection to ${ip}:${port} closed`,
        },
      };
      const websocket = generateWebsocket(ip, port, WebSocket.OPEN);

      const closeConnectionResult = await fluxNetworkHelper.closeConnection(ip, port);

      sinon.assert.calledOnceWithExactly(websocket.close, 4009, 'purposefully closed');
      expect(closeConnectionResult).to.eql(successMessage);
    });

    it('should close outgoing connection properly if it exists and peer is not added to the list', async () => {
      const ip = '127.9.9.1';
      const port = '16127';
      const successMessage = {
        status: 'success',
        data: {
          code: undefined,
          name: undefined,
          message: `Outgoing connection to ${ip}:${port} closed`,
        },
      };
      const websocket = generateWebsocket(ip, port, WebSocket.OPEN);

      const closeConnectionResult = await fluxNetworkHelper.closeConnection(ip, port);

      sinon.assert.calledOnceWithExactly(websocket.close, 4009, 'purposefully closed');
      expect(closeConnectionResult).to.eql(successMessage);
    });

    it('should return warning message if the websocket does not exist', async () => {
      const ip = '127.9.9.1';
      const ip2 = '127.5.5.2';
      const port = '16127';
      const errorMessage = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: `Connection to ${ip}:${port} does not exists.`,
        },
      };
      // Add a different peer so the target one is not found
      const ws2 = {
        ip: ip2, port, readyState: WebSocket.OPEN, close: sinon.stub(), ping: sinon.stub(), on: sinon.stub(),
      };
      peerManager.add(ws2, ip2, port, { source: PEER_SOURCE.RANDOM });

      const closeConnectionResult = await fluxNetworkHelper.closeConnection(ip, port);

      expect(closeConnectionResult).to.eql(errorMessage);
      expect(peerManager.outboundCount).to.equal(1);
    });

    it('should return warning message if ip is not provided', async () => {
      const ip2 = '127.5.5.2';
      const port = '16127';
      const errorMessage = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'To close a connection please provide a proper IP number.',
        },
      };
      const ws = {
        ip: ip2, port, readyState: WebSocket.OPEN, close: sinon.stub(), ping: sinon.stub(), on: sinon.stub(),
      };
      peerManager.add(ws, ip2, port, { source: PEER_SOURCE.RANDOM });

      const closeConnectionResult = await fluxNetworkHelper.closeConnection();

      sinon.assert.notCalled(ws.close);
      expect(closeConnectionResult).to.eql(errorMessage);
      expect(peerManager.outboundCount).to.equal(1);
    });
  });

  describe('closeIncomingConnection tests', () => {
    before(() => {
      peerManager.reset();
    });

    afterEach(() => {
      peerManager.reset();
      sinon.restore();
    });

    it('should return warning message if the websocket does not exist', async () => {
      const ip2 = '127.5.5.2';
      const port = '16127';
      const errorMessage = {
        status: 'warning',
        data: {
          code: undefined,
          name: undefined,
          message: 'To close a connection please provide a proper IP number.',
        },
      };
      const ws = {
        ip: ip2, port, readyState: WebSocket.OPEN, close: sinon.stub(), ping: sinon.stub(), on: sinon.stub(),
      };
      peerManager.add(ws, ip2, port, { source: PEER_SOURCE.INBOUND });

      const closeConnectionResult = await fluxNetworkHelper.closeIncomingConnection();

      expect(closeConnectionResult).to.eql(errorMessage);
      expect(peerManager.inboundCount).to.equal(1);
    });
  });

  describe('getIncomingConnections tests', () => {
    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };

    afterEach(() => {
      peerManager.reset();
      sinon.restore();
    });

    it('should return success message with incoming connections\' ips', async () => {
      const ips = ['127.0.0.1', '127.0.0.2'];
      const port = '16127';
      ips.forEach((ip) => {
        const ws = {
          ip, port, readyState: WebSocket.OPEN, close: sinon.stub(), ping: sinon.stub(), on: sinon.stub(),
        };
        peerManager.add(ws, ip, port, { source: PEER_SOURCE.INBOUND });
      });

      const res = generateResponse();
      const expectedCallArgumeent = { status: 'success', data: ['127.0.0.1', '127.0.0.2'] };

      fluxNetworkHelper.getIncomingConnections(undefined, res);

      sinon.assert.calledOnceWithExactly(res.json, expectedCallArgumeent);
    });

    it('should return success message with empty array if there are no incoming connections', async () => {
      const res = generateResponse();
      const expectedCallArgumeent = { status: 'success', data: [] };

      fluxNetworkHelper.getIncomingConnections(undefined, res);

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

    beforeEach(() => {
      peerManager.reset();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return success message with incoming connections\' info', async () => {
      const ips = ['127.0.0.1', '127.0.0.2'];
      const port = '16127';
      ips.forEach((ip) => {
        const ws = {
          ip, port, readyState: WebSocket.OPEN, close: sinon.stub(), ping: sinon.stub(), on: sinon.stub(),
        };
        peerManager.add(ws, ip, port, { source: PEER_SOURCE.INBOUND });
      });
      const res = generateResponse();
      const expectedCallArgumeent = {
        status: 'success',
        data: [
          { ip: '127.0.0.1', port: '16127' },
          { ip: '127.0.0.2', port: '16127' },
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
    // minimumFluxBenchAllowedVersion = '5.0.0';
    let benchmarkInfoResponseStub;

    beforeEach(() => {
      benchmarkInfoResponseStub = sinon.stub(benchmarkService, 'getInfo');
      fluxNetworkHelper.setStoredFluxBenchAllowed(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if bench version is higher than minimal and stored in cache', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('5.0.0');

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
    });

    it('should return true if bench version is equal to minimal and stored in cache', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('5.0.0');

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
    });

    it('should return false if bench version is lower than minimal and is stored in cache', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('4.0.0');

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
          version: '5.0.0',
        },
      };
      benchmarkInfoResponseStub.returns(benchmarkInfoResponse);

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
      expect(fluxNetworkHelper.getStoredFluxBenchAllowed()).to.equal('5.0.0');
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
    let getRandomSocketAddress;

    before(requireMongo);

    beforeEach(() => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('5.0.0');
      fluxNetworkHelper.setMyFluxIp('129.3.3.3');
      const deterministicFluxnodeListResponse = [
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
      sinon.stub(fluxCommunicationUtils, 'deterministicFluxList').returns(deterministicFluxnodeListResponse);
      sinon.stub(daemonServiceWalletRpcs, 'createConfirmationTransaction').returns(true);
      sinon.stub(serviceHelper, 'delay').returns(true);
      getRandomSocketAddress = sinon.stub(networkStateService, 'getRandomSocketAddress');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false if the flux bench version is lower than allowed', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('2.0.0');

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

      getRandomSocketAddress.resolves('1.2.3.4:16127');

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });

    it('should return false if axsiosGet resolves null', async () => {
      sinon.stub(serviceHelper, 'axiosGet').resolves(null);

      getRandomSocketAddress.resolves('1.2.3.4:16127');

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

      getRandomSocketAddress.resolves('1.2.3.4:16127');
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

      getRandomSocketAddress.resolves('1.2.3.4:16127');
      sinon.stub(serviceHelper, 'axiosGet').resolves(axiosGetResponse);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.true;
    });

    it('should return false if getPublicIp status is a success but does not have a proper ip', async () => {
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
    let originalUserConfig;

    beforeEach(() => {
      writeFileStub = sinon.stub(fs, 'writeFile').resolves();
      // Backup original userconfig
      originalUserConfig = globalThis.userconfig;
      // Mock userconfig with expected test values
      globalThis.userconfig = {
        initial: {
          ipaddress: '127.0.0.1',
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          kadena: 'kadena:3a2e6166907d0c2fb28a16cd6966a705de129e8358b9872d9cefe694e910d5b2?chainid=0',
          testnet: false,
          development: false,
          apiport: 16127,
          routerIP: '',
          pgpPrivateKey: '',
          pgpPublicKey: '',
          blockedPorts: [],
          blockedRepositories: [],
        },
      };
    });
    afterEach(() => {
      sinon.restore();
      // Restore original userconfig
      globalThis.userconfig = originalUserConfig;
    });

    it('should properly write a new ip to the config', async () => {
      const newIp = '127.0.0.66';
      const callPath = path.join(__dirname, '../../config/userconfig.js');

      await fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/module.exports = {/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/initial: {/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/ipaddress: '127.0.0.66',/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/kadena: 'kadena:3a2e6166907d0c2fb28a16cd6966a705de129e8358b9872d9cefe694e910d5b2\?chainid=0',/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/testnet: false,/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/development: false,/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/apiport: 16127,/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/routerIP: '',/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/pgpPrivateKey: ``,/gm));
      sinon.assert.calledOnceWithMatch(writeFileStub, callPath, sinon.match(/pgpPublicKey: ``,/gm));
    });

    it('should not write to file if the config already has same exact ip', async () => {
      const newIp = userconfig.initial.ipaddress;

      await fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.notCalled(writeFileStub);
    });

    it('should not write to file if ip does not have a proper format', async () => {
      const newIp = '127111111';

      await fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.notCalled(writeFileStub);
    });

    it('should not write to file if ip is not a string', async () => {
      const newIp = 121;

      await fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.notCalled(writeFileStub);
    });

    it('should not write to file if ip is empty', async () => {
      const newIp = '';

      await fluxNetworkHelper.adjustExternalIP(newIp);

      sinon.assert.notCalled(writeFileStub);
    });
  });

  describe('adjustExternalIP static IP app handling tests', () => {
    let writeFileStub;
    let originalUserConfig;
    let appQueryServiceStub;
    let registryManagerStub;
    let appUninstallerStub;
    let appControllerStub;
    let enterpriseHelperStub;
    let geolocationServiceStub;
    let fluxCommunicationMessagesSenderStub;

    beforeEach(() => {
      writeFileStub = sinon.stub(fs, 'writeFile').resolves();

      // Backup original userconfig
      originalUserConfig = globalThis.userconfig;

      // Mock userconfig with expected test values
      globalThis.userconfig = {
        initial: {
          ipaddress: '127.0.0.1',
          zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
          kadena: '',
          testnet: false,
          development: false,
          apiport: 16127,
          routerIP: '',
          pgpPrivateKey: '',
          pgpPublicKey: '',
          blockedPorts: [],
          blockedRepositories: [],
        },
      };

      // Stub daemonServiceWalletRpcs
      sinon.stub(daemonServiceWalletRpcs, 'createConfirmationTransaction').resolves({ status: 'success' });

      // Stub serviceHelper.delay
      sinon.stub(serviceHelper, 'delay').resolves();

      // Stub fluxNetworkHelper internal functions
      fluxNetworkHelper.setStoredFluxBenchAllowed('5.0.0');
      fluxNetworkHelper.setMyFluxIp('127.0.0.1');
    });

    afterEach(() => {
      sinon.restore();
      globalThis.userconfig = originalUserConfig;
    });

    it('should uninstall apps requiring static IP when IP changes', async () => {
      const newIp = '192.168.1.100';

      // Mock installed apps with staticip requirement
      const mockApps = {
        status: 'success',
        data: [
          { name: 'staticApp', version: 7, staticip: true },
          { name: 'normalApp', version: 7, staticip: false },
        ],
      };

      // Stub appQueryService
      appQueryServiceStub = {
        installedApps: sinon.stub().resolves(mockApps),
      };

      // Stub registryManager
      registryManagerStub = {
        appLocation: sinon.stub().resolves([]),
      };

      // Stub appUninstaller
      appUninstallerStub = {
        removeAppLocally: sinon.stub().resolves(),
      };

      // Stub appController
      appControllerStub = {
        appDockerRestart: sinon.stub().resolves(),
      };

      // Stub enterpriseHelper
      enterpriseHelperStub = {
        checkAndDecryptAppSpecs: sinon.stub().callsFake((app) => Promise.resolve(app)),
      };

      // Stub geolocationService
      geolocationServiceStub = {
        setNodeGeolocation: sinon.stub(),
      };

      // Stub fluxCommunicationMessagesSender
      fluxCommunicationMessagesSenderStub = {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      };

      // Use proxyquire to inject stubs
      const fluxNetworkHelperWithStubs = proxyquire('../../ZelBack/src/services/fluxNetworkHelper', {
        './appQuery/appQueryService': appQueryServiceStub,
        './appDatabase/registryManager': registryManagerStub,
        './appLifecycle/appUninstaller': appUninstallerStub,
        './appManagement/appController': appControllerStub,
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './daemonService/daemonServiceWalletRpcs': daemonServiceWalletRpcs,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });

      await fluxNetworkHelperWithStubs.adjustExternalIP(newIp);

      // Verify static IP app was uninstalled
      sinon.assert.calledOnce(appUninstallerStub.removeAppLocally);
      sinon.assert.calledWith(appUninstallerStub.removeAppLocally, 'staticApp');

      // Verify normal app was restarted (not uninstalled)
      sinon.assert.calledOnce(appControllerStub.appDockerRestart);
      sinon.assert.calledWith(appControllerStub.appDockerRestart, 'normalApp');

      // Verify geolocation service was called
      sinon.assert.calledOnce(geolocationServiceStub.setNodeGeolocation);
    });

    it('should decrypt enterprise app specs before checking staticip requirement', async () => {
      const newIp = '192.168.1.101';

      // Mock installed enterprise app with encrypted specs
      const mockApps = {
        status: 'success',
        data: [
          { name: 'enterpriseApp', version: 8, enterprise: 'encrypted_data' },
        ],
      };

      appQueryServiceStub = {
        installedApps: sinon.stub().resolves(mockApps),
      };

      registryManagerStub = {
        appLocation: sinon.stub().resolves([]),
      };

      appUninstallerStub = {
        removeAppLocally: sinon.stub().resolves(),
      };

      appControllerStub = {
        appDockerRestart: sinon.stub().resolves(),
      };

      // Stub enterpriseHelper to return decrypted specs with staticip: true
      enterpriseHelperStub = {
        checkAndDecryptAppSpecs: sinon.stub().resolves({
          name: 'enterpriseApp',
          version: 8,
          enterprise: 'encrypted_data',
          staticip: true,
        }),
      };

      geolocationServiceStub = {
        setNodeGeolocation: sinon.stub(),
      };

      fluxCommunicationMessagesSenderStub = {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      };

      const fluxNetworkHelperWithStubs = proxyquire('../../ZelBack/src/services/fluxNetworkHelper', {
        './appQuery/appQueryService': appQueryServiceStub,
        './appDatabase/registryManager': registryManagerStub,
        './appLifecycle/appUninstaller': appUninstallerStub,
        './appManagement/appController': appControllerStub,
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './daemonService/daemonServiceWalletRpcs': daemonServiceWalletRpcs,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });

      await fluxNetworkHelperWithStubs.adjustExternalIP(newIp);

      // Verify enterprise helper was called to decrypt specs
      sinon.assert.calledOnce(enterpriseHelperStub.checkAndDecryptAppSpecs);

      // Verify app was uninstalled due to staticip requirement
      sinon.assert.calledOnce(appUninstallerStub.removeAppLocally);
      sinon.assert.calledWith(appUninstallerStub.removeAppLocally, 'enterpriseApp');
    });

    it('should handle enterprise decryption failure gracefully', async () => {
      const newIp = '192.168.1.102';

      const mockApps = {
        status: 'success',
        data: [
          { name: 'enterpriseApp', version: 8, enterprise: 'encrypted_data', staticip: false },
        ],
      };

      appQueryServiceStub = {
        installedApps: sinon.stub().resolves(mockApps),
      };

      registryManagerStub = {
        appLocation: sinon.stub().resolves([]),
      };

      appUninstallerStub = {
        removeAppLocally: sinon.stub().resolves(),
      };

      appControllerStub = {
        appDockerRestart: sinon.stub().resolves(),
      };

      // Stub enterpriseHelper to throw error
      enterpriseHelperStub = {
        checkAndDecryptAppSpecs: sinon.stub().rejects(new Error('Decryption failed')),
      };

      geolocationServiceStub = {
        setNodeGeolocation: sinon.stub(),
      };

      fluxCommunicationMessagesSenderStub = {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      };

      const fluxNetworkHelperWithStubs = proxyquire('../../ZelBack/src/services/fluxNetworkHelper', {
        './appQuery/appQueryService': appQueryServiceStub,
        './appDatabase/registryManager': registryManagerStub,
        './appLifecycle/appUninstaller': appUninstallerStub,
        './appManagement/appController': appControllerStub,
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './daemonService/daemonServiceWalletRpcs': daemonServiceWalletRpcs,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });

      await fluxNetworkHelperWithStubs.adjustExternalIP(newIp);

      // Should skip the app entirely when decryption fails - neither uninstall nor restart
      sinon.assert.notCalled(appUninstallerStub.removeAppLocally);
      sinon.assert.notCalled(appControllerStub.appDockerRestart);
    });

    it('should not uninstall v6 apps even with staticip field', async () => {
      const newIp = '192.168.1.103';

      const mockApps = {
        status: 'success',
        data: [
          { name: 'oldApp', version: 6, staticip: true },
        ],
      };

      appQueryServiceStub = {
        installedApps: sinon.stub().resolves(mockApps),
      };

      registryManagerStub = {
        appLocation: sinon.stub().resolves([]),
      };

      appUninstallerStub = {
        removeAppLocally: sinon.stub().resolves(),
      };

      appControllerStub = {
        appDockerRestart: sinon.stub().resolves(),
      };

      enterpriseHelperStub = {
        checkAndDecryptAppSpecs: sinon.stub().callsFake((app) => Promise.resolve(app)),
      };

      geolocationServiceStub = {
        setNodeGeolocation: sinon.stub(),
      };

      fluxCommunicationMessagesSenderStub = {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      };

      const fluxNetworkHelperWithStubs = proxyquire('../../ZelBack/src/services/fluxNetworkHelper', {
        './appQuery/appQueryService': appQueryServiceStub,
        './appDatabase/registryManager': registryManagerStub,
        './appLifecycle/appUninstaller': appUninstallerStub,
        './appManagement/appController': appControllerStub,
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './daemonService/daemonServiceWalletRpcs': daemonServiceWalletRpcs,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });

      await fluxNetworkHelperWithStubs.adjustExternalIP(newIp);

      // v6 apps should not be checked for staticip (only v7+)
      sinon.assert.notCalled(appUninstallerStub.removeAppLocally);
      sinon.assert.calledOnce(appControllerStub.appDockerRestart);
    });
  });

  describe('checkDeterministicNodesCollisions tests', () => {
    let getBenchmarksStub;
    let isDaemonSyncedStub;
    let deterministicFluxListStub;
    let getFluxNodeStatusStub;
    let deterministicFluxnodeListResponse;

    beforeEach(() => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('5.0.0');
      fluxNetworkHelper.setMyFluxIp('129.3.3.3');
      sinon.stub(daemonServiceWalletRpcs, 'createConfirmationTransaction').returns(true);
      sinon.stub(serviceHelper, 'delay').returns(true);
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      deterministicFluxnodeListResponse = [
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
      getBenchmarksStub = sinon.stub(benchmarkService, 'getBenchmarks');
      isDaemonSyncedStub = sinon.stub(daemonServiceMiscRpcs, 'isDaemonSynced');
      deterministicFluxListStub = sinon.stub(fluxCommunicationUtils, 'deterministicFluxList');
      getFluxNodeStatusStub = sinon.stub(daemonServiceFluxnodeRpcs, 'getFluxNodeStatus');
      fluxNetworkHelper.setDosMessage(null);
      fluxNetworkHelper.setDosStateValue(0);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should not change dosMessage', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: ip },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(deterministicFluxnodeListResponse);
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            status: 'CONFIRMED',
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          },
        },
      );

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      expect(fluxNetworkHelper.getDosMessage()).to.be.null;
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(0);
    });

    it('should skip availability check when node status is not CONFIRMED', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: ip },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      // Node is not in the deterministic list (expired)
      deterministicFluxListStub.returns([]);
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            status: 'expired',
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          },
        },
      );

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      // Node is expired and not in list — availability check is skipped, no DOS penalty
      expect(fluxNetworkHelper.getDosMessage()).to.be.null;
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(0);
    });

    it('should skip availability check when IP is not in confirmed flux list', async () => {
      const ip = '127.0.0.1:5050';
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: ip },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(deterministicFluxnodeListResponse);
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            status: 'CONFIRMED',
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)',
          },
        },
      );
      // Our IP changed and is not in the confirmed list
      fluxCommunicationUtils.socketAddressInFluxList.resolves(false);

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      // CONFIRMED but IP not in list — availability check is skipped, no DOS penalty
      expect(fluxNetworkHelper.getDosMessage()).to.be.null;
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(0);
    });

    it('should find the same node instances and warn about earlier collision detection', async () => {
      const multipleNodesList = [
        deterministicFluxnodeListResponse[0],
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
        data: { ipaddress: ip },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(multipleNodesList);
      getFluxNodeStatusStub.returns(
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
        data: { ipaddress: ip },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(deterministicFluxnodeListResponse);
      getFluxNodeStatusStub.returns(
        {
          status: 'success',
          data: {
            collateral: 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e123556, 0)',
          },
        },
      );

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      expect(fluxNetworkHelper.getDosMessage()).to.equal('Flux collision detection. Another ip:port is confirmed on flux network with the same collateral transaction information.');
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(100);
    });

    it('should trigger collision detection when same collateral exists on different IP and other node is reachable', async () => {
      const myIp = '192.168.1.100:16127';
      const otherIp = '192.168.1.200:16127';
      const sharedCollateral = 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)';
      const nodeListWithDifferentIp = [
        {
          collateral: sharedCollateral,
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: myIp,
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
          collateral: sharedCollateral,
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: otherIp,
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
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: myIp },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(nodeListWithDifferentIp);
      getFluxNodeStatusStub.returns({
        status: 'success',
        data: {
          status: 'CONFIRMED',
          collateral: sharedCollateral,
        },
      });

      // Mock successful axios call - other node is reachable
      const axiosGetStub = sinon.stub(serviceHelper, 'axiosGet').resolves({ data: { version: '6.0.0' } });

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      expect(axiosGetStub.calledOnce).to.be.true;
      expect(axiosGetStub.firstCall.args[0]).to.include('192.168.1.200:16127');
      expect(fluxNetworkHelper.getDosMessage()).to.include('Node at 192.168.1.200:16127 is confirmed and reachable');
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(100);
    });

    it('should take over collateral when same collateral exists on different IP and other node is unreachable after grace period', async () => {
      const myIp = '192.168.1.100:16127';
      const otherIp = '192.168.1.200:16127';
      const sharedCollateral = 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)';
      const nodeListWithDifferentIp = [
        {
          collateral: sharedCollateral,
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: myIp,
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
          collateral: sharedCollateral,
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: otherIp,
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
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: myIp },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(nodeListWithDifferentIp);
      getFluxNodeStatusStub.returns({
        status: 'success',
        data: {
          status: 'CONFIRMED',
          collateral: sharedCollateral,
        },
      });

      // Mock axios to fail (other node unreachable) on both calls
      const axiosGetStub = sinon.stub(serviceHelper, 'axiosGet').rejects(new Error('Connection refused'));

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      expect(axiosGetStub.calledTwice).to.be.true;
      // DOS state should remain clear since we successfully took over
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(0);
    });

    it('should handle case when other node comes back online during grace period', async () => {
      const myIp = '192.168.1.100:16127';
      const otherIp = '192.168.1.200:16127';
      const sharedCollateral = 'COutPoint(38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174, 0)';
      const nodeListWithDifferentIp = [
        {
          collateral: sharedCollateral,
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: myIp,
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
          collateral: sharedCollateral,
          txhash: '38c04da72786b08adb309259cdd6d2128ea9059d0334afca127a5dc4e75bf174',
          outidx: '0',
          ip: otherIp,
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
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: myIp },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(nodeListWithDifferentIp);
      getFluxNodeStatusStub.returns({
        status: 'success',
        data: {
          status: 'CONFIRMED',
          collateral: sharedCollateral,
        },
      });

      // Mock axios to fail first call but succeed on second (node comes back online)
      const axiosGetStub = sinon.stub(serviceHelper, 'axiosGet');
      axiosGetStub.onFirstCall().rejects(new Error('Connection refused'));
      axiosGetStub.onSecondCall().resolves({ data: { version: '6.0.0' } });

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      expect(axiosGetStub.calledTwice).to.be.true;
      // DOS state should remain at 0 since this is not an error condition
      expect(fluxNetworkHelper.getDosStateValue()).to.equal(0);
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

  describe('sticky DOS tests', () => {
    beforeEach(() => {
      fluxNetworkHelper.setDosMessage(null);
      fluxNetworkHelper.setDosStateValue(0);
      fluxNetworkHelper.clearStickyDosMessage();
    });

    afterEach(() => {
      fluxNetworkHelper.clearStickyDosMessage();
      fluxNetworkHelper.setDosMessage(null);
      fluxNetworkHelper.setDosStateValue(0);
    });

    it('getStickyDosMessage returns null when nothing set', () => {
      expect(fluxNetworkHelper.getStickyDosMessage()).to.be.null;
    });

    it('setStickyDosMessage / getStickyDosMessage roundtrips', () => {
      fluxNetworkHelper.setStickyDosMessage('tampering flag');

      expect(fluxNetworkHelper.getStickyDosMessage()).to.equal('tampering flag');
    });

    it('clearStickyDosMessage resets sticky state', () => {
      fluxNetworkHelper.setStickyDosMessage('tampering flag');
      fluxNetworkHelper.setStickyDosStateValue(100);

      fluxNetworkHelper.clearStickyDosMessage();

      expect(fluxNetworkHelper.getStickyDosMessage()).to.be.null;
    });

    it('getDosMessage returns regular when sticky is null', () => {
      fluxNetworkHelper.setDosMessage('regular reason');

      expect(fluxNetworkHelper.getDosMessage()).to.equal('regular reason');
    });

    it('getDosMessage prefers sticky over regular', () => {
      fluxNetworkHelper.setDosMessage('regular reason');
      fluxNetworkHelper.setStickyDosMessage('sticky reason');

      expect(fluxNetworkHelper.getDosMessage()).to.equal('sticky reason');
    });

    it('setDosMessage(null) does NOT clear sticky message', () => {
      fluxNetworkHelper.setStickyDosMessage('sticky reason');
      fluxNetworkHelper.setDosMessage('regular reason');

      fluxNetworkHelper.setDosMessage(null);

      expect(fluxNetworkHelper.getStickyDosMessage()).to.equal('sticky reason');
      expect(fluxNetworkHelper.getDosMessage()).to.equal('sticky reason');
    });

    it('getDOSState returns sticky pair when sticky is set', () => {
      fluxNetworkHelper.setDosMessage('regular reason');
      fluxNetworkHelper.setDosStateValue(50);
      fluxNetworkHelper.setStickyDosMessage('sticky reason');
      fluxNetworkHelper.setStickyDosStateValue(100);

      const result = fluxNetworkHelper.getDOSState();

      expect(result).to.eql({
        status: 'success',
        data: { dosState: 100, dosMessage: 'sticky reason' },
      });
    });

    it('getDOSState returns regular pair when sticky is null', () => {
      fluxNetworkHelper.setDosMessage('regular reason');
      fluxNetworkHelper.setDosStateValue(50);

      const result = fluxNetworkHelper.getDOSState();

      expect(result).to.eql({
        status: 'success',
        data: { dosState: 50, dosMessage: 'regular reason' },
      });
    });
  });

  describe('allowPort tests', () => {
    const port = '12345';
    afterEach(() => {
      sinon.restore();
    });

    it('should properly enable a new port in string format', async () => {
      // Mock util.promisify to return a function that simulates UFW command success
      sinon.stub(util, 'promisify').returns(() => Promise.resolve('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n'));

      const result = await fluxNetworkHelper.allowPort(port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n');
    }).timeout(5000);

    it('should properly enable a new port in number format', async () => {
      // Mock util.promisify to return a function that simulates UFW command success
      sinon.stub(util, 'promisify').returns(() => Promise.resolve('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n'));

      const result = await fluxNetworkHelper.allowPort(+port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n');
    }).timeout(5000);

    it('should skip updating if policy already exists', async () => {
      // Mock util.promisify to return a function that simulates UFW command "existing"
      sinon.stub(util, 'promisify').returns(() => Promise.resolve('existing'));

      const result = await fluxNetworkHelper.allowPort(port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('existing');
    }).timeout(5000);

    it('should return false with specific message error if the parameter is not a proper number', async () => {
      const result = await fluxNetworkHelper.allowPort('test');
      expect(result.status).to.eql(false);
      expect(result.message).to.eql('Port needs to be a number');
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
      // Mock util.promisify for beforeEach setup
      sinon.stub(util, 'promisify').returns(() => Promise.resolve('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n'));
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
      // Restore and re-stub to return "existing" for this test
      sinon.restore();
      sinon.stub(util, 'promisify').returns(() => Promise.resolve('existing'));

      const result = await fluxNetworkHelper.denyPort(port);

      expect(result.status).to.eql(true);
      expect(result.message).to.eql('existing');
    }).timeout(5000);

    it('should return false with specific message error if the parameter is not a proper number', async () => {
      const result = await fluxNetworkHelper.denyPort('test');
      expect(result.status).to.eql(false);
      expect(result.message).to.eql('Port needs to be a number');
    });

    it('should return status: false if the command response does not include words "udpdated", "existing" or "added"', async () => {
      // Restore and re-stub to return a different value for this test
      sinon.restore();
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
      // Mock util.promisify for beforeEach setup
      sinon.stub(util, 'promisify').returns(() => Promise.resolve('Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n'));
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
      // Restore and re-stub to return error message for this test
      sinon.restore();
      sinon.stub(util, 'promisify').returns(() => errorMessage);
      verifyPrivilegeStub = sinon.stub(verificationHelper, 'verifyPrivilege');
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
      sinon.assert.calledOnceWithExactly(funcStub, 'LANG="en_US.UTF-8" && sudo ufw status | grep Status');
    });

    it('should return false if firewall is not active', async () => {
      funcStub = sinon.fake(() => 'Status: not active');
      utilStub.returns(funcStub);

      const isFirewallActive = await fluxNetworkHelper.isFirewallActive();

      expect(isFirewallActive).to.be.false;
      sinon.assert.calledOnceWithExactly(funcStub, 'LANG="en_US.UTF-8" && sudo ufw status | grep Status');
    });

    it('should return false command execution throws error', async () => {
      funcStub = sinon.fake.throws();
      utilStub.returns(funcStub);

      const isFirewallActive = await fluxNetworkHelper.isFirewallActive();

      expect(isFirewallActive).to.be.false;
      sinon.assert.calledOnceWithExactly(funcStub, 'LANG="en_US.UTF-8" && sudo ufw status | grep Status');
    });
  });

  describe('adjustFirewall tests', () => {
    before(function () { if (process.platform !== 'linux') this.skip(); });

    let utilStub;
    let funcStub;
    let logSpy;
    const ports = [16127, 16126, 16128, 16129, 80, 443, 16125, 11, 13];
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

      sinon.assert.calledWith(funcStub, 'LANG="en_US.UTF-8" && sudo ufw status | grep Status');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.calledWith(funcStub, `LANG="en_US.UTF-8" && sudo ufw allow ${port}`);
        sinon.assert.calledWith(logSpy, `Firewall adjusted for port ${port}`);
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.calledWith(funcStub, `LANG="en_US.UTF-8" && sudo ufw allow out ${port}`);
        sinon.assert.calledWith(logSpy, `Firewall adjusted for port ${port}`);
      }
    });

    it('should log info if ports were not able to be adjusted', async () => {
      funcStub = sinon.fake(async (command) => (command.includes('grep Status') ? 'Status: active' : 'failure'));
      utilStub.returns(funcStub);

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledWith(funcStub, 'LANG="en_US.UTF-8" && sudo ufw status | grep Status');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.calledWith(funcStub, `LANG="en_US.UTF-8" && sudo ufw allow ${port}`);
        sinon.assert.calledWith(logSpy, `Failed to adjust Firewall for port ${port}`);
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.calledWith(funcStub, `LANG="en_US.UTF-8" && sudo ufw allow out ${port}`);
        sinon.assert.calledWith(logSpy, `Failed to adjust Firewall for port ${port}`);
      }
    });

    it('should log info if ports were not able to be adjusted', async () => {
      funcStub = sinon.fake(async (command) => (command.includes('grep Status') ? 'Status: not active' : 'failure'));
      utilStub.returns(funcStub);

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledWith(funcStub, 'LANG="en_US.UTF-8" && sudo ufw status | grep Status');
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.neverCalledWith(funcStub, `LANG="en_US.UTF-8" && sudo ufw allow ${port}`);
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        sinon.assert.neverCalledWith(funcStub, `LANG="en_US.UTF-8" && sudo ufw allow out ${port}`);
      }
      sinon.assert.calledWith(logSpy, 'Firewall is not active. Adjusting not applied');
    });
  });

  describe('isCommunicationEstablished tests', () => {
    const minNumberOfIncoming = 4;
    const minNumberOfOutgoing = 8;

    const generateResponse = () => {
      const res = { test: 'testing' };
      res.status = sinon.stub().returns(res);
      res.json = sinon.fake((param) => param);
      return res;
    };
    const populatePeers = (numberOfincomingPeers, numberOfOutgoingPeers) => {
      peerManager.reset();
      const baseIp = '192.168.0.';
      for (let i = 1; i <= numberOfincomingPeers; i += 1) {
        const ws = {
          ip: `${baseIp}${i}`,
          port: '16127',
          readyState: WebSocket.OPEN,
          close: sinon.stub(),
          ping: sinon.stub(),
          on: sinon.stub(),
        };
        peerManager.add(ws, `${baseIp}${i}`, '16127', { source: PEER_SOURCE.INBOUND });
      }

      for (let i = 1; i <= numberOfOutgoingPeers; i += 1) {
        const ws = {
          ip: `${baseIp}${100 + i}`,
          port: '16127',
          readyState: WebSocket.OPEN,
          close: sinon.stub(),
          ping: sinon.stub(),
          on: sinon.stub(),
        };
        peerManager.add(ws, `${baseIp}${100 + i}`, '16127', { source: PEER_SOURCE.RANDOM });
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
        message: 'Not enough outgoing connections established to Flux network. Minimum required 8 found 7',
      },
    };
    const expectedErrorResponseIncoming = {
      status: 'error',
      data: {
        code: undefined,
        name: undefined,
        message: 'Not enough incoming connections from Flux network. Minimum required 4 found 3',
      },
    };

    afterEach(() => {
      peerManager.reset();
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

  describe('parseChronyOffset tests', () => {
    it('should parse slow offset', () => {
      const output = 'System time     : 0.000012345 seconds slow of NTP time';
      expect(fluxNetworkHelper.parseChronyOffset(output)).to.equal(-0.000012345);
    });

    it('should parse fast offset', () => {
      const output = 'System time     : 0.000054321 seconds fast of NTP time';
      expect(fluxNetworkHelper.parseChronyOffset(output)).to.equal(0.000054321);
    });

    it('should return null for unparseable output', () => {
      expect(fluxNetworkHelper.parseChronyOffset('garbage')).to.equal(null);
    });
  });

  describe('parseTimesyncOffset tests', () => {
    it('should parse millisecond offset', () => {
      const output = 'Offset: +1.234ms';
      expect(fluxNetworkHelper.parseTimesyncOffset(output)).to.be.closeTo(0.001234, 1e-9);
    });

    it('should parse microsecond offset', () => {
      const output = 'Offset: -567us';
      expect(fluxNetworkHelper.parseTimesyncOffset(output)).to.be.closeTo(-0.000567, 1e-9);
    });

    it('should parse second offset', () => {
      const output = 'Offset: +2.5s';
      expect(fluxNetworkHelper.parseTimesyncOffset(output)).to.equal(2.5);
    });

    it('should return null for unparseable output', () => {
      expect(fluxNetworkHelper.parseTimesyncOffset('garbage')).to.equal(null);
    });
  });

  describe('getClockDrift tests', () => {
    let runCommandStub;

    beforeEach(() => {
      fluxNetworkHelper.resetNtpSource();
      sinon.stub(log, 'info');
      runCommandStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return chrony offset when chrony is available', async () => {
      runCommandStub.resolves({
        error: null,
        stdout: 'System time     : 0.000003456 seconds fast of NTP time',
      });

      const result = await fluxNetworkHelper.getClockDrift();

      expect(result.source).to.equal('chrony');
      expect(result.offset).to.equal(0.000003456);
      expect(result.time).to.be.a('number');
      // detection call + drift call
      sinon.assert.calledTwice(runCommandStub);
      sinon.assert.alwaysCalledWith(runCommandStub, 'chronyc', sinon.match.object);
    });

    it('should fall back to timesyncd when chrony is not available', async () => {
      runCommandStub.withArgs('chronyc', sinon.match.any).resolves({
        error: new Error('command not found'),
        stdout: '',
      });
      runCommandStub.withArgs('timedatectl', sinon.match.any).resolves({
        error: null,
        stdout: 'Offset: +1.234ms',
      });

      const result = await fluxNetworkHelper.getClockDrift();

      expect(result.source).to.equal('timesyncd');
      expect(result.offset).to.be.closeTo(0.001234, 1e-9);
    });

    it('should return source none when neither is available', async () => {
      runCommandStub.resolves({
        error: new Error('command not found'),
        stdout: '',
      });

      const result = await fluxNetworkHelper.getClockDrift();

      expect(result.source).to.equal('none');
      expect(result.offset).to.equal(null);
    });

    it('should cache the NTP source and only detect once', async () => {
      runCommandStub.resolves({
        error: null,
        stdout: 'System time     : 0.000001000 seconds slow of NTP time',
      });

      await fluxNetworkHelper.getClockDrift();
      await fluxNetworkHelper.getClockDrift();

      // detection (1 call) + 2 drift queries = 3 calls, all to chronyc
      sinon.assert.calledThrice(runCommandStub);
      sinon.assert.alwaysCalledWith(runCommandStub, 'chronyc', sinon.match.object);
    });

    it('should return null offset if chrony output is unparseable', async () => {
      runCommandStub.resolves({
        error: null,
        stdout: 'Reference ID    : some garbage',
      });

      const result = await fluxNetworkHelper.getClockDrift();

      // detection succeeds (no error) so source is chrony, but offset parse fails
      expect(result.source).to.equal('chrony');
      expect(result.offset).to.equal(null);
    });
  });

  describe('clockDrift API handler tests', () => {
    let runCommandStub;
    let res;

    beforeEach(() => {
      fluxNetworkHelper.resetNtpSource();
      sinon.stub(log, 'info');
      runCommandStub = sinon.stub(serviceHelper, 'runCommand');
      res = { json: sinon.stub() };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return success response with drift data', async () => {
      runCommandStub.resolves({
        error: null,
        stdout: 'System time     : 0.000005000 seconds fast of NTP time',
      });

      await fluxNetworkHelper.clockDrift(null, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('success');
      expect(response.data.source).to.equal('chrony');
      expect(response.data.offset).to.equal(0.000005);
      expect(response.data.time).to.be.a('number');
    });

    it('should return none when both sources fail', async () => {
      runCommandStub.resolves({
        error: new Error('command not found'),
        stdout: '',
      });

      await fluxNetworkHelper.clockDrift(null, res);

      sinon.assert.calledOnce(res.json);
      const response = res.json.firstCall.args[0];
      expect(response.status).to.equal('success');
      expect(response.data.source).to.equal('none');
      expect(response.data.offset).to.equal(null);
    });
  });

  describe('remove flux container access to private address space tests', () => {
    let utilStub;
    let funcStub;
    let infoLogSpy;
    let errorLogSpy;
    beforeEach(() => {
      // hide console output from logs, but still get logging spy
      sinon.stub(console, 'log');
      utilStub = sinon.stub(util, 'promisify');
      infoLogSpy = sinon.spy(log, 'info');
      errorLogSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return false if the iptables binary does not exist', async () => {
      funcStub = sinon.fake(async (cmd) => {
        // chain doesn't exists
        if (cmd.includes('sudo iptables --version')) {
          throw new Error();
        }
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);
      expect(result).to.eql(false);
      sinon.assert.calledOnceWithExactly(funcStub, 'sudo iptables --version');
      sinon.assert.calledWith(errorLogSpy, 'Unable to find iptables binary');
    });

    it('should add the DOCKER-USER chain to iptables if it is missing', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        }
        if (cmd.includes('-L')) {
          // chain doesn't exists
          throw new Error();
        }
        return null;
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);
      expect(result).to.eql(true);

      sinon.assert.calledWith(funcStub, 'sudo iptables -L DOCKER-USER');
      sinon.assert.calledWith(funcStub, 'sudo iptables -N DOCKER-USER');
      sinon.assert.calledWith(infoLogSpy, 'IPTABLES: DOCKER-USER chain created');
      sinon.assert.notCalled(errorLogSpy);
    });

    it('should skip addding the DOCKER-USER chain to iptables if it already exists', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        }
        if (cmd.includes('-L')) {
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        }
        return undefined;
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(true);
      sinon.assert.calledWith(funcStub, 'sudo iptables -L DOCKER-USER');
      sinon.assert.neverCalledWith(funcStub, 'sudo iptables -N DOCKER-USER');
      sinon.assert.calledWith(infoLogSpy, 'IPTABLES: DOCKER-USER chain already created');
      sinon.assert.notCalled(errorLogSpy);
    });

    it('should bail out if there is an error addding the DOCKER-USER chain to iptables', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        }
        // throw for both -L and -N (throwing on -L is normal)
        throw new Error();
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(false);
      sinon.assert.calledWith(funcStub, 'sudo iptables -L DOCKER-USER');
      sinon.assert.calledWith(funcStub, 'sudo iptables -N DOCKER-USER');
      sinon.assert.notCalled(infoLogSpy);
      sinon.assert.calledOnceWithExactly(errorLogSpy, 'IPTABLES: Error adding DOCKER-USER chain');
    });

    it('should add the jump to DOCKER-USER chain from FORWARD chain to iptables if it is missing', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        } if (cmd.includes('sudo iptables -L DOCKER-USER')) {
          // chain doesn't exists
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        } if (cmd.includes('sudo iptables -C FORWARD -j DOCKER-USER && echo true')) {
          throw new Error('iptables: Bad rule (does a matching rule exist in that chain?).');
        } else {
          return 'DOCKER-USER  all opt -- in * out *  0.0.0.0/0  -> 0.0.0.0/0';
        }
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(true);
      sinon.assert.calledWith(funcStub, 'sudo iptables -C FORWARD -j DOCKER-USER && echo true');
      sinon.assert.calledWith(funcStub, 'sudo iptables -I FORWARD -j DOCKER-USER');

      sinon.assert.calledWith(infoLogSpy, 'IPTABLES: New rule in FORWARD inserted to jump to DOCKER-USER chain');
      sinon.assert.notCalled(errorLogSpy);
    });

    it('should skip adding the jump to DOCKER-USER chain from FORWARD chain to iptables if it already exists', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        } if (cmd.includes('sudo iptables -L DOCKER-USER')) {
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        }
        return 'DOCKER-USER  all opt -- in * out *  0.0.0.0/0  -> 0.0.0.0/0';
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(true);
      sinon.assert.neverCalledWith(funcStub, 'sudo iptables -I FORWARD -j DOCKER-USER');

      sinon.assert.calledWith(infoLogSpy, 'IPTABLES: Jump to DOCKER-USER chain already enabled');
      sinon.assert.notCalled(errorLogSpy);
    });

    it('should bail out if there is an error addding the DOCKER-USER chain to iptables', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        } if (cmd.includes('sudo iptables -L DOCKER-USER')) {
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        } if (cmd.includes('sudo iptables -C FORWARD -j DOCKER-USER')) {
          throw new Error('iptables: Bad rule (does a matching rule exist in that chain?).');
        } else {
          throw new Error();
        }
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(false);
      sinon.assert.calledWith(funcStub, 'sudo iptables -C FORWARD -j DOCKER-USER && echo true');
      sinon.assert.calledWith(funcStub, 'sudo iptables -I FORWARD -j DOCKER-USER');

      sinon.assert.neverCalledWith(infoLogSpy, 'IPTABLES: New rule in FORWARD inserted to jump to DOCKER-USER chain');
      expect(infoLogSpy.callCount).to.eql(1);
      sinon.assert.calledOnceWithExactly(errorLogSpy, 'IPTABLES: Error inserting FORWARD jump to DOCKER-USER chain');
    });

    it('should flush the DOCKER-USER chain', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        } if (cmd.includes('sudo iptables -L DOCKER-USER')) {
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        }
        return undefined;
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(true);
      sinon.assert.calledWith(funcStub, 'sudo iptables -F DOCKER-USER');
      sinon.assert.neverCalledWith(errorLogSpy);
    });

    it('should bail out if there is an error flushing the DOCKER-USER chain', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        } if (cmd.includes('sudo iptables -L DOCKER-USER')) {
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        } if (cmd.includes('sudo iptables -C FORWARD -j DOCKER-USER && echo true')) {
          return 'DOCKER-USER  all opt -- in * out *  0.0.0.0/0  -> 0.0.0.0/0';
        }
        throw new Error();
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(false);
      sinon.assert.calledWith(funcStub, 'sudo iptables -F DOCKER-USER');
      sinon.assert.calledOnceWithExactly(errorLogSpy, 'IPTABLES: Error flushing DOCKER-USER table. Error');
      expect(funcStub.callCount).to.eql(4);
    });

    it('should add two allow and one drop rule for each private network', async () => {
      const networks = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        } if (cmd.includes('sudo iptables -L DOCKER-USER')) {
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        }
        return null;
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(true);

      // eslint-disable-next-line no-restricted-syntax
      for (const network of networks) {
        sinon.assert.calledWith(funcStub, `sudo iptables -I DOCKER-USER -s 172.23.0.0/16 -d ${network} -p udp --dport 53 -j ACCEPT`);
        sinon.assert.calledWith(funcStub, `sudo iptables -I DOCKER-USER -s 172.23.0.0/16 -d ${network} -m state --state RELATED,ESTABLISHED -j ACCEPT`);
        sinon.assert.calledWith(funcStub, `sudo iptables -A DOCKER-USER -s 172.23.0.0/16 -d ${network} -j DROP`);
      }

      // 1 for the CHAIN rules, 1 FLUSH, 1 docker0 allow, 9 for the adds and 1 for the RETURN
      expect(infoLogSpy.callCount).to.eql(13);
      sinon.assert.notCalled(errorLogSpy);
    });

    it('should add an allow for intra-network traffic per docker network', async () => {
      const interfaces = ['br-aaf87aa57b20', 'br-098bac43a7f1'];

      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        } if (cmd.includes('sudo iptables -L DOCKER-USER')) {
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        }
        return null;
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable(interfaces);

      expect(result).to.eql(true);

      // eslint-disable-next-line no-restricted-syntax
      for (const int of interfaces) {
        sinon.assert.calledWith(funcStub, `sudo iptables -I DOCKER-USER -i ${int} -o ${int} -j ACCEPT`);
      }
      sinon.assert.calledWith(funcStub, 'sudo iptables -I DOCKER-USER -i docker0 -o docker0 -j ACCEPT');

      // 1 for the CHAIN rules, 1 FLUSH, 1 docker0 allow 2 interface allows, 9 for the adds and 1 for the RETURN
      expect(infoLogSpy.callCount).to.eql(15);
      sinon.assert.notCalled(errorLogSpy);
    });

    it('should bail out as soon as a rule errors out', async () => {
      funcStub = sinon.fake(async (cmd) => {
        if (cmd.includes('sudo iptables --version')) {
          return 'iptables v1.8.7 (nf_tables)';
        } if (cmd.includes('sudo iptables -L DOCKER-USER')) {
          return `Chain DOCKER-USER (0 references)
          target     prot opt source               destination`;
        } if (cmd.includes('sudo iptables -C FORWARD -j DOCKER-USER')) {
          return 'DOCKER-USER  all opt -- in * out *  0.0.0.0/0  -> 0.0.0.0/0';
        } if (cmd.includes('sudo iptables -F DOCKER-USER')) {
          // this is the rule under test
          return undefined;
        } if (cmd.includes('sudo iptables -I DOCKER-USER -i docker0 -o docker0 -j ACCEPT')) {
          throw new Error();
        }
        return undefined;
      });
      utilStub.returns(funcStub);

      const result = await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable([]);

      expect(result).to.eql(false);
      expect(funcStub.callCount).to.eql(5);

      sinon.assert.calledOnceWithExactly(errorLogSpy, 'IPTABLES: Error allowing traffic on Flux interface docker0. Error');
    });
  });
});
