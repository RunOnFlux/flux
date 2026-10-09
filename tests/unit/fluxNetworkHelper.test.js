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
  },
};

const dgram = require('dgram');
const { EventEmitter } = require('events');
const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const WebSocket = require('ws');
const path = require('path');
const chaiAsPromised = require('chai-as-promised');
const fs = require('fs').promises;
const os = require('os');
const crypto = require('crypto');
const config = require('config');
const log = require('../../ZelBack/src/lib/log');
const { Privilege, authOf } = require('../../ZelBack/src/services/utils/privileges');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const daemonServiceMiscRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('../../ZelBack/src/services/daemonService/daemonServiceUtils');
const daemonServiceFluxnodeRpcs = require('../../ZelBack/src/services/daemonService/daemonServiceFluxnodeRpcs');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const fluxNetworkHelper = require('../../ZelBack/src/services/fluxNetworkHelper');
const benchmarkService = require('../../ZelBack/src/services/benchmarkService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const fluxEventBus = require('../../ZelBack/src/services/utils/fluxEventBus');
const { requireMongo } = require('./dbTestHelper');
const upnpService = require('../../ZelBack/src/services/upnpService');
const geolocationService = require('../../ZelBack/src/services/geolocationService');
const ufw = require('../../ZelBack/src/services/utils/ufw');
const ufwHelper = require('../../ZelBack/src/services/utils/ufwHelper');

/**
 * A UDP socket whose connect resolves to a source address, or fails.
 */
function fakeUdpSocket({ source = null, error = null }) {
  const fake = new EventEmitter();
  fake.connect = sinon.spy(function connect() {
    setImmediate(function settle() {
      if (error) fake.emit('error', error);
      else fake.emit('connect');
    });
  });
  fake.address = function address() { return { address: source, family: 'IPv4', port: 40000 }; };
  fake.close = sinon.spy();
  return fake;
}

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
    // The installed copy of the ufw helper is the one to run (utils/ufwHelper has its own tests).
    sinon.stub(ufwHelper, 'path').resolves(ufwHelper.UFW_HELPER);
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

  describe('getLocalSocketAddress tests', () => {
    let benchStub;

    beforeEach(() => {
      benchStub = sinon.stub(benchmarkService, 'getBenchmarks');
      // Reset the own-IP freshness cache so it never leaks across tests — a warm cache
      // would make getLocalSocketAddress skip the benchmark stub a test set up. Setting
      // null clears both the value and the freshness deadline.
      fluxNetworkHelper.setLocalSocketAddress(null);
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

      const getIpResult = await fluxNetworkHelper.getLocalSocketAddress();

      expect(getIpResult).to.equal(ip);
      sinon.assert.calledOnce(benchStub);
    });

    it('should return null if daemon\'s response is invalid', async () => {
      const getBenchmarkResponseData = {
        status: 'error',
      };
      benchStub.resolves(getBenchmarkResponseData);

      const getIpResult = await fluxNetworkHelper.getLocalSocketAddress();

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

      const getIpResult = await fluxNetworkHelper.getLocalSocketAddress();

      expect(getIpResult).to.be.null;
      sinon.assert.calledOnce(benchStub);
    });

    it('should normalize bare IP from old fluxbench to ip:port', async () => {
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: '85.159.213.248' },
      };
      benchStub.resolves(getBenchmarkResponseData);

      const result = await fluxNetworkHelper.getLocalSocketAddress();

      expect(result).to.equal('85.159.213.248:16127');
    });

    it('should return ip:port as-is from new fluxbench', async () => {
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: '85.159.213.248:16127' },
      };
      benchStub.resolves(getBenchmarkResponseData);

      const result = await fluxNetworkHelper.getLocalSocketAddress();

      expect(result).to.equal('85.159.213.248:16127');
    });

    it('should preserve non-default port from fluxbench', async () => {
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: '85.159.213.248:16147' },
      };
      benchStub.resolves(getBenchmarkResponseData);

      const result = await fluxNetworkHelper.getLocalSocketAddress();

      expect(result).to.equal('85.159.213.248:16147');
    });

    it('serves the cached own-IP without a second benchmark RPC while fresh', async () => {
      benchStub.resolves({ status: 'success', data: { ipaddress: '85.159.213.248:16127' } });

      const first = await fluxNetworkHelper.getLocalSocketAddress();
      const second = await fluxNetworkHelper.getLocalSocketAddress();

      expect(first).to.equal('85.159.213.248:16127');
      expect(second).to.equal('85.159.213.248:16127');
      // the freshness cache short-circuits the second call — a batch pays ONE RPC, not N
      sinon.assert.calledOnce(benchStub);
    });

    // A CALLER READING THE ABSENCE OF AN ANSWER IS PROBING THE DAEMON, not asking
    // this node's address, and the cache answers the second question only. Served
    // from memory, a daemon that has died inside the window still produces the last
    // address it ever gave, and the caller reads a dead daemon as a live one.
    it('asks the daemon when the caller wants it fresh, cache or no cache', async () => {
      benchStub.resolves({ status: 'success', data: { ipaddress: '85.159.213.248:16127' } });
      await fluxNetworkHelper.getLocalSocketAddress();

      await fluxNetworkHelper.getLocalSocketAddress({ fresh: true });

      sinon.assert.calledTwice(benchStub);
    });

    it('reports a daemon that stops answering, even inside the freshness window', async () => {
      benchStub.resolves({ status: 'success', data: { ipaddress: '85.159.213.248:16127' } });
      expect(await fluxNetworkHelper.getLocalSocketAddress()).to.equal('85.159.213.248:16127');

      benchStub.resolves({ status: 'error' });

      expect(await fluxNetworkHelper.getLocalSocketAddress({ fresh: true })).to.equal(null);
    });

    it('re-benchmarks after the cache is invalidated (setLocalSocketAddress null)', async () => {
      benchStub.resolves({ status: 'success', data: { ipaddress: '85.159.213.248:16127' } });

      await fluxNetworkHelper.getLocalSocketAddress();
      fluxNetworkHelper.setLocalSocketAddress(null); // clears the value + the freshness deadline
      await fluxNetworkHelper.getLocalSocketAddress();

      sinon.assert.calledTwice(benchStub);
    });

    it('does not cache a null (unresolved) own-IP — keeps probing', async () => {
      benchStub.resolves({ status: 'error' });

      const first = await fluxNetworkHelper.getLocalSocketAddress();
      const second = await fluxNetworkHelper.getLocalSocketAddress();

      expect(first).to.be.null;
      expect(second).to.be.null;
      // a null result is never cached, so every call re-probes until fluxbench resolves
      sinon.assert.calledTwice(benchStub);
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
    let ensureStub;

    beforeEach(() => {
      daemonStub = sinon.stub(daemonServiceUtils, 'getConfigValue');
      ensureStub = sinon.stub(daemonServiceUtils, 'ensureConfigLoaded').resolves();
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

    it('reads flux.conf itself rather than waiting for something else to', async () => {
      // The key is on disk and needs no daemon. Before this it was available only once some
      // other code had made an RPC and parsed the config on the way past, so a node that had
      // its key all along looked like a node whose daemon was down.
      daemonStub.returns('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');

      await fluxNetworkHelper.getFluxNodePrivateKey();

      sinon.assert.calledOnce(ensureStub);
      expect(ensureStub.calledBefore(daemonStub), 'asked for the config before reading it')
        .to.equal(true);
    });

    it('does not read the config when it was handed a key', async () => {
      await fluxNetworkHelper.getFluxNodePrivateKey('5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh');

      sinon.assert.notCalled(ensureStub);
      sinon.assert.notCalled(daemonStub);
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

    // Null rather than the Error itself. It never threw despite the name this
    // test used to carry, and an Error returned as if it were a key is truthy,
    // is not a string, and stringifies to {} - so it travelled as a pubKey
    // field and was refused at the far end instead of here.
    it('Should answer nothing if private key is invalid', async () => {
      const privateKey = 'asdf';

      const result = await fluxNetworkHelper.getFluxNodePublicKey(privateKey);

      expect(result).to.equal(null);
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

    // The caller asked for this peer to be gone. Until it leaves the map it
    // still fills a slot no reconnect is dialled for and is still offered as a
    // sync source - and the socket cannot be relied on to report the close,
    // because a peer is most often removed exactly when it has stopped
    // answering.
    it('removes the peer, rather than waiting for its socket to report the close', async () => {
      const ip = '127.9.9.7';
      const port = '16127';
      generateWebsocket(ip, port, WebSocket.OPEN);
      expect(peerManager.has(`${ip}:${port}`)).to.equal(true);

      await fluxNetworkHelper.closeConnection(ip, port);

      expect(peerManager.has(`${ip}:${port}`), 'peer survived its own removal').to.equal(false);
      expect(peerManager.outboundCount).to.equal(0);
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

    it('removes the peer, rather than waiting for its socket to report the close', async () => {
      const ip = '127.5.5.9';
      const port = '16127';
      const ws = {
        ip, port, readyState: WebSocket.OPEN, close: sinon.stub(), ping: sinon.stub(), on: sinon.stub(),
      };
      peerManager.add(ws, ip, port, { source: PEER_SOURCE.INBOUND });
      expect(peerManager.has(`${ip}:${port}`)).to.equal(true);

      await fluxNetworkHelper.closeIncomingConnection(ip, port);

      expect(peerManager.has(`${ip}:${port}`), 'peer survived its own removal').to.equal(false);
      expect(peerManager.inboundCount).to.equal(0);
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

  describe('checkNodeJsVersionAllowed tests', () => {
    // minimumNodeJsAllowedVersion = '20.8.0'
    const realNodeJsVersion = process.versions.node;
    const { NODEJS_FLOOR, RESIDENTIAL_DOS } = fluxNetworkHelper.StickyDosOwner;

    function runningOn(version) {
      Object.defineProperty(process.versions, 'node', { value: version, configurable: true });
    }

    // node-config seals its values once the module graph has loaded, so the
    // floor is varied by loading the helper over a config that carries a
    // different one. The instance is its own, which is also what keeps its DOS
    // state out of the tests either side.
    function helperWithFloor(floor) {
      return proxyquire('../../ZelBack/src/services/fluxNetworkHelper', {
        config: { ...config, minimumNodeJsAllowedVersion: floor },
      });
    }

    afterEach(() => {
      runningOn(realNodeJsVersion);
      fluxNetworkHelper.clearStickyDos(NODEJS_FLOOR);
      fluxNetworkHelper.clearStickyDos(RESIDENTIAL_DOS);
      fluxNetworkHelper.setDosStateValue(0);
      fluxNetworkHelper.setDosMessage(null);
    });

    it('allows the runtime the fleet already runs', () => {
      runningOn('24.14.1');

      expect(fluxNetworkHelper.checkNodeJsVersionAllowed()).to.equal(true);
      expect(fluxNetworkHelper.getStickyDosMessage()).to.equal(null);
    });

    it('allows the floor itself', () => {
      runningOn('20.8.0');

      expect(fluxNetworkHelper.checkNodeJsVersionAllowed()).to.equal(true);
      expect(fluxNetworkHelper.getStickyDosMessage()).to.equal(null);
    });

    it('takes a node below the floor out of service, and says which version it found', () => {
      // the last 16.x release, which left support in September 2023
      runningOn('16.20.2');

      expect(fluxNetworkHelper.checkNodeJsVersionAllowed()).to.equal(false);
      const reported = fluxNetworkHelper.getDOSState().data;
      expect(reported.dosMessage).to.include('20.8.0');
      expect(reported.dosMessage).to.include('16.20.2');
      expect(reported.dosState).to.equal(100);
    });

    it('refuses a version below the floor within the same major', () => {
      runningOn('20.7.0');

      expect(fluxNetworkHelper.checkNodeJsVersionAllowed()).to.equal(false);
      expect(fluxNetworkHelper.getDOSState().data.dosState).to.equal(100);
    });

    it('survives the clear a successful availability pass performs', () => {
      // checkMyFluxAvailability ends a good pass with dosState = 0 and
      // setDosMessage(null). The runtime verdict is asked once at startup, so if
      // that clear reached it the node would return to service on a NodeJS that
      // cannot run the code and nothing would ask again.
      runningOn('16.20.2');
      fluxNetworkHelper.checkNodeJsVersionAllowed();

      fluxNetworkHelper.setDosStateValue(0);
      fluxNetworkHelper.setDosMessage(null);

      const reported = fluxNetworkHelper.getDOSState().data;
      expect(reported.dosMessage).to.include('16.20.2');
      expect(reported.dosState).to.equal(100);
    });

    it('allows when no floor is configured, on a runtime a floor would refuse', () => {
      // Unsetting the key is how the floor comes off a live fleet. The check runs
      // bare in startFluxFunctions, whose catch re-enters it after 15s, so a
      // throw here is a boot loop - and a node held out of service by a missing
      // floor has nothing left to tell it when to come back.
      const helper = helperWithFloor(undefined);
      runningOn('16.20.2');

      expect(helper.checkNodeJsVersionAllowed()).to.equal(true);
      expect(helper.getStickyDosMessage()).to.equal(null);
      expect(helper.getDOSState().data.dosState).to.equal(0);
    });

    it('allows when the configured floor is empty', () => {
      const helper = helperWithFloor('');
      runningOn('16.20.2');

      expect(helper.checkNodeJsVersionAllowed()).to.equal(true);
      expect(helper.getStickyDosMessage()).to.equal(null);
    });

    it('refuses on the loaded floor, so the instance is reading the one it was given', () => {
      // The canary for the two above: a helper loaded the same way, with a floor
      // present, must still take the node out of service. Without it, a config
      // stub that silently failed to reach the module would pass both.
      const helper = helperWithFloor('20.8.0');
      runningOn('16.20.2');

      expect(helper.checkNodeJsVersionAllowed()).to.equal(false);
      expect(helper.getDOSState().data.dosState).to.equal(100);
      helper.clearStickyDos(NODEJS_FLOOR);
    });

    it("records its verdict beside another owner's, and outlives that owner's release", () => {
      // The verdict is asked once at startup. Recorded under another owner's
      // identity - or not recorded at all - it leaves with that owner's release,
      // and the node returns to service on a runtime that cannot run the code.
      const theirs = 'Residential node not running ArcaneOS. Migrate this node to ArcaneOS or move it to a data center connection.';
      fluxNetworkHelper.setStickyDos(RESIDENTIAL_DOS, theirs);
      runningOn('16.20.2');

      expect(fluxNetworkHelper.checkNodeJsVersionAllowed()).to.equal(false);
      expect(fluxNetworkHelper.getStickyDosMessage(), 'overwrote a verdict it does not own').to.include(theirs);

      fluxNetworkHelper.clearStickyDos(RESIDENTIAL_DOS);

      const reported = fluxNetworkHelper.getDOSState().data;
      expect(reported.dosState, 'returned to service on the other owner\'s release').to.equal(100);
      expect(reported.dosMessage).to.include('16.20.2');
    });

    it('states its verdict once, however often startup re-enters the check', () => {
      // startFluxFunctions catches any throw and re-enters itself after 15s, so
      // this is asked again on every retry - and by then the other writers of
      // the slot have started.
      //
      // Asserted on the LOG rather than on the message, because re-setting the
      // slot to the same string leaves it equal to itself: the message alone
      // cannot tell a second write from no second write.
      const errorLog = sinon.spy(log, 'error');
      try {
        runningOn('16.20.2');
        expect(fluxNetworkHelper.checkNodeJsVersionAllowed()).to.equal(false);
        expect(fluxNetworkHelper.checkNodeJsVersionAllowed()).to.equal(false);

        const stated = errorLog.getCalls().filter((call) => String(call.args[0]).includes('NodeJS Version Error'));
        expect(stated).to.have.lengthOf(1);
        expect(fluxNetworkHelper.getDOSState().data.dosState).to.equal(100);
      } finally {
        errorLog.restore();
      }
    });
  });

  describe('checkFluxbenchVersionAllowed tests', () => {
    // minimumFluxBenchAllowedVersion = '6.2.0';
    let benchmarkInfoResponseStub;

    beforeEach(() => {
      benchmarkInfoResponseStub = sinon.stub(benchmarkService, 'getInfo');
      fluxNetworkHelper.setStoredFluxBenchAllowed(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if bench version is higher than minimal and stored in cache', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('6.3.0');

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
    });

    it('should return true if bench version is equal to minimal and stored in cache', async () => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('6.2.0');

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
          version: '6.3.0',
        },
      };
      benchmarkInfoResponseStub.returns(benchmarkInfoResponse);

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
      expect(fluxNetworkHelper.getStoredFluxBenchAllowed()).to.equal('6.3.0');
    });

    it('should return true if the version is equal to minimal and is not set in cache', async () => {
      const benchmarkInfoResponse = {
        status: 'success',
        data: {
          version: '6.2.0',
        },
      };
      benchmarkInfoResponseStub.returns(benchmarkInfoResponse);

      const isFluxbenchVersionAllowed = await fluxNetworkHelper.checkFluxbenchVersionAllowed();

      expect(isFluxbenchVersionAllowed).to.equal(true);
      expect(fluxNetworkHelper.getStoredFluxBenchAllowed()).to.equal('6.2.0');
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
    let getRandomExternalObserver;

    before(requireMongo);

    beforeEach(() => {
      fluxNetworkHelper.setStoredFluxBenchAllowed('6.2.0');
      fluxNetworkHelper.setLocalSocketAddress('129.3.3.3');
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
      sinon.stub(daemonServiceFluxnodeRpcs, 'createConfirmationTransaction').returns(true);
      sinon.stub(serviceHelper, 'delay').returns(true);
      getRandomExternalObserver = sinon.stub(networkStateService, 'getRandomExternalObserver');
      // An IP change hands off to the geolocation service, which reschedules
      // itself every ten seconds for as long as no IP is detected - and logs an
      // error on each pass. Left real, the first of these tests starts a loop
      // that outlives the whole suite, writing into every later test file that
      // counts what was logged. That it is called at all is asserted where it
      // belongs, in the static IP app handling tests below.
      sinon.stub(geolocationService, 'setNodeGeolocation');
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
      fluxNetworkHelper.setLocalSocketAddress(null);

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });

    it('should return false if axsiosGet throws error', async () => {
      sinon.stub(serviceHelper, 'axiosGet').rejects();

      getRandomExternalObserver.resolves('1.2.3.4:16127');

      const result = await fluxNetworkHelper.checkMyFluxAvailability();

      expect(result).to.be.false;
    });

    it('should return false if axsiosGet resolves null', async () => {
      sinon.stub(serviceHelper, 'axiosGet').resolves(null);

      getRandomExternalObserver.resolves('1.2.3.4:16127');

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

      getRandomExternalObserver.resolves('1.2.3.4:16127');
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

      getRandomExternalObserver.resolves('1.2.3.4:16127');
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
      sinon.stub(geolocationService, 'setNodeGeolocation');
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
        },
      };
      // adjustExternalIP defers a change until the node knows its own address.
      fluxNetworkHelper.setLocalSocketAddress('127.0.0.1');
    });
    afterEach(() => {
      sinon.restore();
      fluxNetworkHelper.setLocalSocketAddress(null);
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
    let onAddressChangedSpy;
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
        },
      };

      // Stub the fluxnode confirmation transaction
      sinon.stub(daemonServiceFluxnodeRpcs, 'createConfirmationTransaction').resolves({ status: 'success' });

      // Stub serviceHelper.delay
      sinon.stub(serviceHelper, 'delay').resolves();

      // Stub fluxNetworkHelper internal functions
      fluxNetworkHelper.setStoredFluxBenchAllowed('6.2.0');
      fluxNetworkHelper.setLocalSocketAddress('127.0.0.1');
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

      // The apps that survive an address change are handed to whatever registered
      // for one - serviceManager wires that to appReconciler.requestRestartOf.
      // Nothing in this module knows what restarting an app involves, so the seam
      // is what these tests assert on.
      onAddressChangedSpy = sinon.stub().resolves();

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
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });

      // Each test proxyquires its OWN module instance, so the address has to be set
      // on THAT one - the beforeEach sets it on the outer module, which this code
      // never reads. A node reaches adjustExternalIP only once it knows itself.
      fluxNetworkHelperWithStubs.setLocalSocketAddress('127.0.0.1:16127');
      fluxNetworkHelperWithStubs.setOnAddressChanged(onAddressChangedSpy);
      await fluxNetworkHelperWithStubs.adjustExternalIP(newIp);

      // Verify static IP app was uninstalled
      sinon.assert.calledOnce(appUninstallerStub.removeAppLocally);
      sinon.assert.calledWith(appUninstallerStub.removeAppLocally, 'staticApp');

      // Verify the normal app was handed over to be restarted, not uninstalled -
      // as the whole surviving set, in one call
      sinon.assert.calledOnce(onAddressChangedSpy);
      const [staying] = onAddressChangedSpy.firstCall.args;
      expect(staying.map((a) => a.name)).to.deep.equal(['normalApp']);

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

      onAddressChangedSpy = sinon.stub().resolves();

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
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });

      // Each test proxyquires its OWN module instance, so the address has to be set
      // on THAT one - the beforeEach sets it on the outer module, which this code
      // never reads. A node reaches adjustExternalIP only once it knows itself.
      fluxNetworkHelperWithStubs.setLocalSocketAddress('127.0.0.1:16127');
      fluxNetworkHelperWithStubs.setOnAddressChanged(onAddressChangedSpy);
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

      onAddressChangedSpy = sinon.stub().resolves();

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
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });

      // Each test proxyquires its OWN module instance, so the address has to be set
      // on THAT one - the beforeEach sets it on the outer module, which this code
      // never reads. A node reaches adjustExternalIP only once it knows itself.
      fluxNetworkHelperWithStubs.setLocalSocketAddress('127.0.0.1:16127');
      fluxNetworkHelperWithStubs.setOnAddressChanged(onAddressChangedSpy);
      await fluxNetworkHelperWithStubs.adjustExternalIP(newIp);

      // Should skip the app entirely when decryption fails - neither uninstall nor restart
      sinon.assert.notCalled(appUninstallerStub.removeAppLocally);
      sinon.assert.notCalled(onAddressChangedSpy);
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

      onAddressChangedSpy = sinon.stub().resolves();

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
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });

      // Each test proxyquires its OWN module instance, so the address has to be set
      // on THAT one - the beforeEach sets it on the outer module, which this code
      // never reads. A node reaches adjustExternalIP only once it knows itself.
      fluxNetworkHelperWithStubs.setLocalSocketAddress('127.0.0.1:16127');
      fluxNetworkHelperWithStubs.setOnAddressChanged(onAddressChangedSpy);
      await fluxNetworkHelperWithStubs.adjustExternalIP(newIp);

      // v6 apps should not be checked for staticip (only v7+)
      sinon.assert.notCalled(appUninstallerStub.removeAppLocally);
      sinon.assert.calledOnce(onAddressChangedSpy);
    });

    // An instance already at this address means the ports are taken, because one
    // instance per IP is what the host port mapping allows. The node's own
    // registration is not another instance - it stores its own running-app row
    // locally, at the address benchmark reports - so what separates "the ports are
    // gone" from "that row is me" is the port, and only the port.
    // Each call needs an address no earlier test has used: adjustExternalIP keeps a
    // cache of addresses it has already handled and returns before the app loop for
    // a repeat, which leaves the assertions below passing for the wrong reason.
    async function runWithLocations(locations, ownSocketAddress, newIp) {
      appQueryServiceStub = {
        installedApps: sinon.stub().resolves({
          status: 'success',
          data: [{ name: 'normalApp', version: 7, staticip: false }],
        }),
      };
      registryManagerStub = { appLocation: sinon.stub().resolves(locations) };
      appUninstallerStub = { removeAppLocally: sinon.stub().resolves() };
      onAddressChangedSpy = sinon.stub().resolves();
      enterpriseHelperStub = { checkAndDecryptAppSpecs: sinon.stub().callsFake((app) => Promise.resolve(app)) };
      geolocationServiceStub = { setNodeGeolocation: sinon.stub() };
      fluxCommunicationMessagesSenderStub = {
        broadcastMessageToOutgoing: sinon.stub().resolves(),
        broadcastMessageToIncoming: sinon.stub().resolves(),
      };

      const helper = proxyquire('../../ZelBack/src/services/fluxNetworkHelper', {
        './appQuery/appQueryService': appQueryServiceStub,
        './appDatabase/registryManager': registryManagerStub,
        './appLifecycle/appUninstaller': appUninstallerStub,
        './utils/enterpriseHelper': enterpriseHelperStub,
        './geolocationService': geolocationServiceStub,
        './fluxCommunicationMessagesSender': fluxCommunicationMessagesSenderStub,
        './serviceHelper': serviceHelper,
        'fs/promises': { writeFile: writeFileStub },
      });
      helper.setStoredFluxBenchAllowed('6.2.0');
      helper.setLocalSocketAddress(ownSocketAddress);
      helper.setOnAddressChanged(onAddressChangedSpy);
      await helper.adjustExternalIP(newIp);
    }

    it('keeps an app whose only instance at the new address is this node itself', async () => {
      await runWithLocations(
        [{ name: 'normalApp', ip: '192.168.1.110:16127' }],
        '192.168.1.110:16127',
        '192.168.1.110',
      );

      sinon.assert.notCalled(appUninstallerStub.removeAppLocally);
      sinon.assert.calledOnce(onAddressChangedSpy);
      const [staying] = onAddressChangedSpy.firstCall.args;
      expect(staying.map((a) => a.name)).to.deep.equal(['normalApp']);
    });

    // localSocketAddress is cleared whenever benchmark hiccups, and the change must
    // survive that rather than be decided on it or dropped. Asserting the userconfig
    // write did NOT happen is the point: that write is what marks the change handled,
    // so an unwritten config is a change still pending for the next cycle.
    it('defers the whole change, unwritten, when it does not know its own address', async () => {
      await runWithLocations(
        [{ name: 'normalApp', ip: '192.168.1.112:16157' }],
        null,
        '192.168.1.112',
      );

      sinon.assert.notCalled(appUninstallerStub.removeAppLocally);
      sinon.assert.notCalled(onAddressChangedSpy);
      sinon.assert.notCalled(writeFileStub);
      sinon.assert.notCalled(geolocationServiceStub.setNodeGeolocation);
    });

    it('uninstalls an app another node already holds the ports for on this address', async () => {
      // Same IP, different port: a UPnP sibling behind the shared address. The
      // ports are genuinely gone, so this node cannot run it.
      await runWithLocations(
        [{ name: 'normalApp', ip: '192.168.1.111:16157' }],
        '192.168.1.111:16127',
        '192.168.1.111',
      );

      sinon.assert.calledOnce(appUninstallerStub.removeAppLocally);
      sinon.assert.calledWith(appUninstallerStub.removeAppLocally, 'normalApp');
      sinon.assert.notCalled(onAddressChangedSpy);
    });
  });

  describe('checkDeterministicNodesCollisions tests', () => {
    let getBenchmarksStub;
    let isDaemonSyncedStub;
    let deterministicFluxListStub;
    let getFluxNodeStatusStub;
    let deterministicFluxnodeListResponse;

    beforeEach(() => {
      // Every path through the check reschedules itself, by design - it is a
      // poller. Left real, those timers outlive this file and keep re-entering
      // the check against restored stubs for the rest of the run.
      sinon.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
      fluxNetworkHelper.setStoredFluxBenchAllowed('6.2.0');
      fluxNetworkHelper.setLocalSocketAddress('129.3.3.3');
      // Each case here declares the node's own address through the benchmark stub, and
      // the check reads it with getLocalSocketAddress - which serves the cached value
      // while it is fresh. Cleared last, so the resolve happens against the answer the
      // case set up rather than against the seed above it.
      fluxNetworkHelper.setLocalSocketAddress(null);
      sinon.stub(daemonServiceFluxnodeRpcs, 'createConfirmationTransaction').returns(true);
      sinon.stub(serviceHelper, 'delay').returns(true);
      sinon.stub(fluxCommunicationUtils, 'socketAddressInFluxList').resolves(true);
      // The check defers and re-arms while the node list is unknown, the same
      // way it does for an unsynced daemon - these cases are all about what it
      // decides once it HAS the list.
      sinon.stub(networkStateService, 'isReady').returns(true);
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

    it('does not read the node list while the list is unknown - it defers and re-arms', async () => {
      // An unknown list is an empty list to every accessor here, and this check
      // reads that as: no collision anywhere, this node absent from the
      // confirmed list, that absence logged as the reason, and the availability
      // check that clears DOS skipped. It waits for the list instead, the same
      // way it already waits for an unsynced daemon two lines above.
      const getBenchmarkResponseData = {
        status: 'success',
        data: { ipaddress: '127.0.0.1:5050' },
      };
      getBenchmarksStub.resolves(getBenchmarkResponseData);
      isDaemonSyncedStub.returns({ data: { synced: true } });
      deterministicFluxListStub.returns(deterministicFluxnodeListResponse);
      networkStateService.isReady.returns(false);

      await fluxNetworkHelper.checkDeterministicNodesCollisions();

      sinon.assert.notCalled(deterministicFluxListStub);
      expect(fluxNetworkHelper.getDosMessage()).to.be.null;
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
    const { RESIDENTIAL_DOS, APP_TAMPERING } = fluxNetworkHelper.StickyDosOwner;

    beforeEach(() => {
      fluxNetworkHelper.setDosMessage(null);
      fluxNetworkHelper.setDosStateValue(0);
    });

    afterEach(() => {
      Object.values(fluxNetworkHelper.StickyDosOwner).forEach(fluxNetworkHelper.clearStickyDos);
      fluxNetworkHelper.setDosMessage(null);
      fluxNetworkHelper.setDosStateValue(0);
    });

    it('reports no reason while no owner holds the node', () => {
      expect(fluxNetworkHelper.getStickyDosMessage()).to.be.null;
      expect(fluxNetworkHelper.isNodeDos()).to.equal(false);
    });

    it('reports the reason the owner gave', () => {
      fluxNetworkHelper.setStickyDos(APP_TAMPERING, 'tampering flag');

      expect(fluxNetworkHelper.getStickyDosMessage()).to.equal('tampering flag');
    });

    it('takes the node out of service on a hold alone, whatever the counted state is', () => {
      // DOS >= 100 is what makes nodeStatusMonitor and appStartupManager remove
      // every app on the box, so a hold that did not reach it would be a note.
      fluxNetworkHelper.setDosStateValue(0);

      fluxNetworkHelper.setStickyDos(APP_TAMPERING, 'tampering flag');

      expect(fluxNetworkHelper.isNodeDos()).to.equal(true);
      expect(fluxNetworkHelper.getDOSState().data.dosState).to.equal(100);
    });

    it('releases the owner that let go', () => {
      fluxNetworkHelper.setStickyDos(APP_TAMPERING, 'tampering flag');

      fluxNetworkHelper.clearStickyDos(APP_TAMPERING);

      expect(fluxNetworkHelper.getStickyDosMessage()).to.be.null;
      expect(fluxNetworkHelper.isNodeDos()).to.equal(false);
    });

    it('names every reason, because an operator has to lift all of them', () => {
      fluxNetworkHelper.setStickyDos(RESIDENTIAL_DOS, 'residential');
      fluxNetworkHelper.setStickyDos(APP_TAMPERING, 'tampering');

      const message = fluxNetworkHelper.getStickyDosMessage();

      expect(message).to.contain('residential');
      expect(message).to.contain('tampering');
    });

    // The reason this is a map keyed by owner and not a single slot. One slot
    // could hold one of these two reasons: the second either overwrote the
    // first, leaving an owner that can no longer recognise - and so never
    // release - its own verdict, or was dropped, and the node returned to
    // service on the first owner's release for a condition that never lifted.
    it('keeps the node out of service while any other owner still holds it', () => {
      fluxNetworkHelper.setStickyDos(RESIDENTIAL_DOS, 'residential');
      fluxNetworkHelper.setStickyDos(APP_TAMPERING, 'tampering');

      fluxNetworkHelper.clearStickyDos(RESIDENTIAL_DOS);

      expect(fluxNetworkHelper.isNodeDos(), 'one owner released the node for both').to.equal(true);
      expect(fluxNetworkHelper.getStickyDosMessage()).to.equal('tampering');
    });

    it('does not release a verdict it does not own', () => {
      fluxNetworkHelper.setStickyDos(RESIDENTIAL_DOS, 'residential');

      fluxNetworkHelper.clearStickyDos(APP_TAMPERING);

      expect(fluxNetworkHelper.getStickyDosMessage()).to.equal('residential');
    });

    it('refuses an owner it does not know, rather than minting one', () => {
      // An unknown owner is a caller that was never given an identity. Accepted,
      // it would hold the node under a name no release path knows about.
      expect(() => fluxNetworkHelper.setStickyDos('someFeature', 'a reason')).to.throw('unknown owner');
      expect(fluxNetworkHelper.isNodeDos()).to.equal(false);
    });

    it('getDosMessage returns regular when no owner holds the node', () => {
      fluxNetworkHelper.setDosMessage('regular reason');

      expect(fluxNetworkHelper.getDosMessage()).to.equal('regular reason');
    });

    it('getDosMessage prefers a held verdict over the regular one', () => {
      fluxNetworkHelper.setDosMessage('regular reason');
      fluxNetworkHelper.setStickyDos(APP_TAMPERING, 'sticky reason');

      expect(fluxNetworkHelper.getDosMessage()).to.equal('sticky reason');
    });

    it('setDosMessage(null) does NOT release a held verdict', () => {
      // checkMyFluxAvailability ends a good pass this way. A verdict that went
      // with it would let the node walk back into service with its condition
      // still in place.
      fluxNetworkHelper.setStickyDos(APP_TAMPERING, 'sticky reason');
      fluxNetworkHelper.setDosMessage('regular reason');

      fluxNetworkHelper.setDosMessage(null);

      expect(fluxNetworkHelper.getStickyDosMessage()).to.equal('sticky reason');
      expect(fluxNetworkHelper.getDosMessage()).to.equal('sticky reason');
    });

    it('getDOSState reports the held verdict over the counted one', () => {
      fluxNetworkHelper.setDosMessage('regular reason');
      fluxNetworkHelper.setDosStateValue(50);
      fluxNetworkHelper.setStickyDos(APP_TAMPERING, 'sticky reason');

      const result = fluxNetworkHelper.getDOSState();

      expect(result).to.eql({
        status: 'success',
        data: { dosState: 100, dosMessage: 'sticky reason' },
      });
    });

    it('getDOSState reports the counted pair when no owner holds the node', () => {
      fluxNetworkHelper.setDosMessage('regular reason');
      fluxNetworkHelper.setDosStateValue(50);

      const result = fluxNetworkHelper.getDOSState();

      expect(result).to.eql({
        status: 'success',
        data: { dosState: 50, dosMessage: 'regular reason' },
      });
    });
  });

  // Every ufw command runs through the one bounded runner: the lock-first helper
  // as root, the command's arguments as given, and a wait of at most 30 s on
  // ufw's lock.
  const ufwRun = (args) => sinon.match({
    runAsRoot: true, params: [ufw.UFW_HELPER, '--wait', '30', '--command', JSON.stringify(args)], timeout: 60000,
  });
  // The ufw arguments a runCommand call ran through the runner, or null.
  const ufwArgs = (call) => {
    const params = call.args[0] === 'python3' ? call.args[1].params : [];
    const at = params.indexOf('--command');
    return at === -1 ? null : JSON.parse(params[at + 1]);
  };
  const lockTimedOut = () => ({ error: Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }), stdout: '', stderr: '' });

  describe('allowPort tests', () => {
    let runCommandStub;
    const updated = 'Rules updated\nRules updated (v6)\n';
    beforeEach(() => {
      runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: updated, stderr: '' });
    });
    afterEach(() => {
      sinon.restore();
    });

    it('should allow the port inbound, in string or number format', async () => {
      expect(await fluxNetworkHelper.allowPort('12345')).to.eql({ status: true, message: updated });
      expect(await fluxNetworkHelper.allowPort(12345)).to.eql({ status: true, message: updated });
      sinon.assert.alwaysCalledWith(runCommandStub, 'python3', ufwRun(['allow', '12345']));
    });

    it('should skip updating if the rule already exists', async () => {
      runCommandStub.resolves({ error: null, stdout: 'Skipping adding existing rule\n', stderr: '' });

      expect(await fluxNetworkHelper.allowPort(12345)).to.eql({ status: true, message: 'existing' });
    });

    it('should return false with specific message error if the parameter is not a proper number', async () => {
      expect(await fluxNetworkHelper.allowPort('test')).to.eql({ status: false, message: 'Port needs to be a number' });
      sinon.assert.notCalled(runCommandStub);
    });

    it('should return status: false if the command response does not include words "updated", "existing" or "added"', async () => {
      runCommandStub.resolves({ error: null, stdout: 'testing', stderr: '' });

      expect((await fluxNetworkHelper.allowPort(12345)).status).to.eql(false);
    });

    it('should return status: false when ufw is locked by another ufw command', async () => {
      runCommandStub.resolves(lockTimedOut());

      expect(await fluxNetworkHelper.allowPort(12345)).to.eql({ status: false, message: 'ufw is locked by another ufw command' });
    });
  });

  describe('port rule commands', () => {
    let runCommandStub;
    beforeEach(() => {
      runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: 'Rule deleted\n', stderr: '' });
    });
    afterEach(() => {
      sinon.restore();
    });

    it('should deny a port inbound only', async () => {
      await fluxNetworkHelper.denyPort(31000);
      sinon.assert.calledOnceWithExactly(runCommandStub, 'python3', ufwRun(['deny', '31000']));
    });

    it('should delete only the inbound allow rule of a port', async () => {
      expect((await fluxNetworkHelper.deleteAllowPortRule(31000)).status).to.equal(true);
      sinon.assert.calledOnceWithExactly(runCommandStub, 'python3', ufwRun(['delete', 'allow', '31000']));
    });

    it('should count a rule already gone as deleted', async () => {
      runCommandStub.resolves({ error: null, stdout: 'Could not delete non-existent rule\n', stderr: '' });

      expect((await fluxNetworkHelper.deleteAllowPortRule(31000)).status).to.equal(true);
    });

    it('should report a delete that ran out of the lock wait as not done', async () => {
      runCommandStub.resolves(lockTimedOut());

      expect(await fluxNetworkHelper.deleteAllowPortRule(31000)).to.eql({ status: false, message: 'ufw is locked by another ufw command' });
      expect(await fluxNetworkHelper.denyPort(31000)).to.eql({ status: false, message: 'ufw is locked by another ufw command' });
    });
  });

  describe('app port rules', () => {
    const ipv6 = (port) => ['from', '::/0', 'to', 'any', 'port', String(port)];
    let runCommandStub;
    let readFile;
    const ufwFiles = ({ enabled = 'yes', ipv6Filtered = 'yes' } = {}) => {
      readFile.withArgs('/etc/ufw/ufw.conf', 'utf8').resolves(`ENABLED=${enabled}\n`);
      readFile.withArgs('/etc/default/ufw', 'utf8').resolves(`IPV6=${ipv6Filtered}\n`);
    };
    const batched = (result) => ({ error: null, stdout: `${JSON.stringify({ removed: 0, applied: true, failed: [], reason: null, ...result })}\n`, stderr: '' });
    // The ufw commands each batch handed to the helper, in order.
    const batches = () => runCommandStub.getCalls()
      .filter((call) => call.args[0] === 'python3' && call.args[1].params.includes('--keep-outbound'))
      .map((call) => JSON.parse(call.args[1].params[call.args[1].params.indexOf('--rules') + 1]));
    beforeEach(() => {
      runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves(batched());
      readFile = sinon.stub(fs, 'readFile');
    });
    afterEach(() => {
      sinon.restore();
    });

    it('admits IPv6 clients to every port of an app, and no IPv4 client, in one batch', async () => {
      ufwFiles();

      expect(await fluxNetworkHelper.allowAppPortsIpv6([31000, 31001])).to.deep.equal({ failed: [], locked: false });
      expect(batches()).to.deep.equal([[['allow', ...ipv6(31000)], ['allow', ...ipv6(31001)]]]);
      sinon.assert.calledOnce(runCommandStub);
    });

    it('writes nothing while ufw is disabled or leaves IPv6 alone', async () => {
      ufwFiles({ enabled: 'no' });
      await fluxNetworkHelper.allowAppPortsIpv6([31000]);
      ufwFiles({ ipv6Filtered: 'no' });
      await fluxNetworkHelper.allowAppPortsIpv6([31000]);

      sinon.assert.notCalled(runCommandStub);
    });

    it('reports a port ufw refused', async () => {
      ufwFiles();
      const failed = [{ rule: `allow ${ipv6(31000).join(' ')}`, error: 'ERROR: Bad port' }];
      runCommandStub.resolves(batched({ failed }));

      expect(await fluxNetworkHelper.allowAppPortsIpv6([31000])).to.deep.equal({ failed, locked: false });
    });

    it('deletes each port\'s IPv6 rule and an earlier FluxOS\'s allow for it in one batch, while ufw is disabled too', async () => {
      ufwFiles({ enabled: 'no' });

      await fluxNetworkHelper.deleteAppPortRules([31000, 31001]);

      expect(batches()).to.deep.equal([[
        ['delete', 'allow', ...ipv6(31000)], ['delete', 'allow', '31000'],
        ['delete', 'allow', ...ipv6(31001)], ['delete', 'allow', '31001'],
      ]]);
    });

    it('deletes no IPv6 rule while ufw leaves IPv6 alone, and no allow for a port apps are not given', async () => {
      ufwFiles({ ipv6Filtered: 'no' });

      await fluxNetworkHelper.deleteAppPortRules([31000, 16127]);

      expect(batches()).to.deep.equal([[['delete', 'allow', '31000']]]);
    });
  });

  describe('purgeUFW tests', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('should delete only the inbound deny rule of each denied port, and no outbound rule', async () => {
      const runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: 'Rule deleted\n', stderr: '' });
      runCommandStub.withArgs('python3', ufwRun(['status'])).resolves({
        error: null,
        stdout: 'Status: active\n\nTo                         Action      From\n--                         ------      ----\n31000                      DENY        Anywhere\n16127                      ALLOW       Anywhere\n',
        stderr: '',
      });

      await fluxNetworkHelper.purgeUFW();

      sinon.assert.calledWith(runCommandStub, 'python3', ufwRun(['delete', 'deny', '31000']));
      const params = runCommandStub.getCalls().map(ufwArgs).filter(Boolean);
      expect(params.filter((args) => args.includes('out')), 'outbound rules touched').to.deep.equal([]);
      expect(params.filter((args) => args.includes('16127')), 'an allow rule touched').to.deep.equal([]);
    });
  });

  describe('denyPort tests', () => {
    const port = '32111';
    const updated = 'Rules updated\nRules updated (v6)\n';
    let runCommandStub;

    beforeEach(() => {
      runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: updated, stderr: '' });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should deny port given in a string or number format', async () => {
      expect(await fluxNetworkHelper.denyPort(port)).to.eql({ status: true, message: updated });
      expect(await fluxNetworkHelper.denyPort(+port)).to.eql({ status: true, message: updated });
    });

    it('should skip updating if policy already exists', async () => {
      runCommandStub.resolves({ error: null, stdout: 'Skipping adding existing rule\n', stderr: '' });

      expect(await fluxNetworkHelper.denyPort(port)).to.eql({ status: true, message: 'existing' });
    });

    it('should return false with specific message error if the parameter is not a proper number', async () => {
      expect(await fluxNetworkHelper.denyPort('test')).to.eql({ status: false, message: 'Port needs to be a number' });
    });

    it('should return status: false if the command response does not include words "updated", "existing" or "added"', async () => {
      runCommandStub.resolves({ error: null, stdout: 'testing', stderr: '' });

      expect((await fluxNetworkHelper.denyPort(12345)).status).to.eql(false);
    });
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
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: 'Rules updated\nRules updated (v6)\nRules updated\nRules updated (v6)\n', stderr: '' });
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
      sinon.assert.calledOnceWithExactly(verifyPrivilegeStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
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
      sinon.assert.calledOnceWithExactly(verifyPrivilegeStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
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
      sinon.assert.calledOnceWithExactly(verifyPrivilegeStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });

    it('should return an error message if allowPort status is false', async () => {
      const errorMessage = 'This is error message';
      // Restore and re-stub to return error message for this test
      sinon.restore();
      sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: errorMessage, stderr: '' });
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
      sinon.assert.calledOnceWithExactly(verifyPrivilegeStub, Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
    });
  });

  describe('isFirewallActive tests', () => {
    let runCommandStub;
    beforeEach(() => {
      runCommandStub = sinon.stub(serviceHelper, 'runCommand');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return true if firewall is active', async () => {
      runCommandStub.resolves({ error: null, stdout: 'Status: active\n', stderr: '' });

      expect(await fluxNetworkHelper.isFirewallActive()).to.be.true;
      sinon.assert.calledOnceWithExactly(runCommandStub, 'python3', ufwRun(['status']));
    });

    it('should return false if firewall is not active', async () => {
      runCommandStub.resolves({ error: null, stdout: 'Status: inactive\n', stderr: '' });

      expect(await fluxNetworkHelper.isFirewallActive()).to.be.false;
    });

    it('should return false when ufw cannot be run', async () => {
      runCommandStub.resolves({ error: new Error('sudo: ufw: command not found'), stdout: '', stderr: '' });

      expect(await fluxNetworkHelper.isFirewallActive()).to.be.false;
    });

    it('should answer whether ufw is enabled when ufw is locked by another ufw command', async () => {
      runCommandStub.resolves(lockTimedOut());
      const readFile = sinon.stub(fs, 'readFile');
      readFile.withArgs('/etc/ufw/ufw.conf', 'utf8').resolves('ENABLED=yes\n');

      expect(await fluxNetworkHelper.isFirewallActive()).to.be.true;
      readFile.withArgs('/etc/ufw/ufw.conf', 'utf8').resolves('ENABLED=no\n');
      expect(await fluxNetworkHelper.isFirewallActive()).to.be.false;
    });
  });

  describe('adjustFirewall tests', () => {
    // api, home, ssl and syncthing ports, http(s), fluxd, then every flux api port
    const ports = () => ['16127', '16126', '16128', '16129', '80', '443', '16125', ...config.server.allowedPorts.map(String)];
    const applierCall = sinon.match({ runAsRoot: true, params: sinon.match((params) => params[0] === ufwHelper.UFW_HELPER && params.includes('--rules')) });
    let runCommandStub;
    let publishStub;
    let warnSpy;

    const firewallEnabled = (enabled) => {
      const readFile = sinon.stub(fs, 'readFile');
      readFile.callThrough();
      readFile.withArgs('/etc/ufw/ufw.conf', 'utf8').resolves(enabled ? 'ENABLED=yes\nLOGLEVEL=low\n' : 'ENABLED=no\nLOGLEVEL=low\n');
    };
    const applier = (result) => runCommandStub.withArgs('python3', applierCall).resolves(result);
    const answered = (answer) => applier({ error: null, stdout: `${JSON.stringify({ failed: [], reason: null, ...answer })}\n`, stderr: '' });
    const appliedRules = () => JSON.parse(runCommandStub.getCalls().find((call) => call.args[0] === 'python3' && call.args[1].params.includes('--rules')).args[1].params[4]);
    const ufwCalls = () => runCommandStub.getCalls().map(ufwArgs).filter(Boolean).map((args) => args.join(' '));

    beforeEach(() => {
      runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: '', stderr: '' });
      runCommandStub.withArgs('ip').resolves({ error: null, stdout: 'default via 192.168.1.1 dev eth0\n10.0.0.0/8 dev eth1\n', stderr: '' });
      publishStub = sinon.stub(fluxEventBus, 'publish');
      warnSpy = sinon.spy(log, 'warn');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should hand every rule of the node to the applier in one go, as root, waiting at most 30 s on ufw\'s lock', async () => {
      firewallEnabled(true);
      answered({ removed: 0, applied: true });

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledOnce(runCommandStub.withArgs('python3', applierCall));
      const [, options] = runCommandStub.getCalls().find((call) => call.args[0] === 'python3').args;
      expect(options.params.slice(1, 4)).to.deep.equal(['--wait', '30', '--rules']);
      expect(appliedRules()).to.deep.equal([
        ['delete', 'allow', 'in', 'proto', 'udp', 'to', 'any', 'port', '53'],
        ['prepend', 'limit', 'to', 'any', 'app', 'OpenSSH'],
        ['prepend', 'allow', 'from', '192.168.1.1', 'to', 'any', 'proto', 'udp'],
        ...ports().map((port) => ['allow', port]),
        ['allow', 'from', '172.23.0.0/16', 'proto', 'tcp', 'to', '169.254.43.43/32', 'port', '16101'],
      ]);
      expect(ufwCalls(), 'no ufw command of its own').to.deep.equal([]);
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:adjusted', { outboundRemoved: 0, rulesFailed: [], appliedBy: 'library' });
    });

    it('should write no outbound rule and never set a default policy', async () => {
      firewallEnabled(true);
      answered({ removed: 0, applied: true });

      await fluxNetworkHelper.adjustFirewall();

      expect(appliedRules().filter((rule) => rule.includes('out') || rule[0] === 'default')).to.deep.equal([]);
    });

    it('should reload ufw once, through the bounded runner, when outbound rules were removed', async () => {
      firewallEnabled(true);
      answered({ removed: 4, applied: true });

      await fluxNetworkHelper.adjustFirewall();

      expect(ufwCalls()).to.deep.equal(['reload']);
      sinon.assert.calledWith(runCommandStub, 'python3', ufwRun(['reload']));
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:adjusted', { outboundRemoved: 4, rulesFailed: [], appliedBy: 'library' });
    });

    it('should report each rule ufw refused, but not a delete of a rule already gone', async () => {
      firewallEnabled(true);
      answered({
        removed: 0,
        applied: true,
        failed: [
          { rule: 'delete allow in proto udp to any port 53', error: 'Could not delete non-existent rule' },
          { rule: 'prepend limit to any app OpenSSH', error: "ERROR: Could not find a profile matching 'OpenSSH'" },
        ],
      });

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledWith(warnSpy, "Firewall rule not applied: ufw prepend limit to any app OpenSSH: ERROR: Could not find a profile matching 'OpenSSH'");
      sinon.assert.neverCalledWith(warnSpy, sinon.match(/port 53/));
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:adjusted', { outboundRemoved: 0, rulesFailed: ['prepend limit to any app OpenSSH'], appliedBy: 'library' });
    });

    it('should run no ufw command at all when another ufw command holds the lock', async () => {
      // Each would wait on the same lock for as long as it is held.
      firewallEnabled(true);
      applier({ error: Object.assign(new Error('command failed'), { code: 75 }), stdout: '', stderr: 'ufw lock /run/ufw.lock not free within 30s' });
      const errorSpy = sinon.spy(log, 'error');

      await fluxNetworkHelper.adjustFirewall();

      expect(ufwCalls()).to.deep.equal([]);
      sinon.assert.calledWith(errorSpy, 'Firewall not adjusted: ufw is locked by another ufw command');
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:locked', {});
    });

    it('should apply the rules one bounded ufw command each when ufw\'s library cannot be used', async () => {
      firewallEnabled(true);
      answered({ removed: 2, applied: false, reason: 'ufw library not usable: TypeError()' });

      await fluxNetworkHelper.adjustFirewall();

      const rules = appliedRules().map((rule) => rule.join(' '));
      expect(ufwCalls()).to.deep.equal([...rules, 'reload']);
      runCommandStub.getCalls().filter(ufwArgs).forEach((call) => expect(call.args[1].timeout).to.equal(60000));
      sinon.assert.calledWith(warnSpy, 'Firewall rules applied one ufw command each: ufw library not usable: TypeError()');
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:adjusted', { outboundRemoved: 2, rulesFailed: [], appliedBy: 'commands' });
    });

    it('should leave the rules it hands to ufw as they were', async () => {
      // The fallback runs each rule as given, and reports a refused one by it.
      firewallEnabled(true);
      answered({ removed: 0, applied: false, reason: 'ufw library not usable: TypeError()' });
      runCommandStub.withArgs('python3', ufwRun(['prepend', 'limit', 'to', 'any', 'app', 'OpenSSH'])).callsFake(async (cmd, options) => {
        options.params.unshift(cmd);
        return { error: new Error('exit 1'), stdout: '', stderr: "ERROR: Could not find a profile matching 'OpenSSH'" };
      });

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:adjusted', { outboundRemoved: 0, rulesFailed: ['prepend limit to any app OpenSSH'], appliedBy: 'commands' });
    });

    it('should apply the rules one ufw command each when the applier fails', async () => {
      firewallEnabled(true);
      applier({ error: Object.assign(new Error('command failed'), { code: 1 }), stdout: '', stderr: 'Traceback: no such file' });

      await fluxNetworkHelper.adjustFirewall();

      sinon.assert.calledWith(warnSpy, 'Firewall applier failed: Traceback: no such file');
      expect(ufwCalls()).to.include('allow 16127');
      expect(ufwCalls()).to.not.include('reload');
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:adjusted', { outboundRemoved: 0, rulesFailed: [], appliedBy: 'commands' });
    });

    it('should stop at the first ufw command that outruns the lock wait, and report the firewall locked', async () => {
      // A ufw command waits on ufw's lock for as long as it is held: one killed
      // at the wait was waiting on it, and every later one would wait too.
      firewallEnabled(true);
      answered({ removed: 0, applied: false, reason: 'ufw library not usable: TypeError()' });
      runCommandStub.withArgs('python3', ufwRun(['allow', '16127'])).resolves({ error: Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }), stdout: '', stderr: '' });

      await fluxNetworkHelper.adjustFirewall();

      const calls = ufwCalls();
      expect(calls[calls.length - 1]).to.equal('allow 16127');
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:locked', {});
      sinon.assert.neverCalledWith(publishStub, 'firewall:adjusted');
    });

    it('should change nothing, and ask ufw nothing, when the firewall is not enabled', async () => {
      firewallEnabled(false);

      await fluxNetworkHelper.adjustFirewall();

      expect(runCommandStub.getCalls().filter(ufwArgs)).to.deep.equal([]);
      sinon.assert.neverCalledWith(runCommandStub, 'python3');
      sinon.assert.notCalled(publishStub);
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
      // fluxUptime floors process.uptime(); uptime only increases, so the floored value
      // at the call is >= the floor of the uptime captured earlier and <= the raw uptime
      // now. (Comparing to the un-floored earlier value flakes when uptime < 1s: floor->0.)
      expect(fluxUptime.data).to.be.gte(Math.floor(ut));
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

  describe('ensureUfwDefaults tests', () => {
    const wholeFile = (outputPolicy = 'ACCEPT') => [
      'IPV6=yes',
      'DEFAULT_INPUT_POLICY="DROP"',
      `DEFAULT_OUTPUT_POLICY="${outputPolicy}"`,
      'DEFAULT_FORWARD_POLICY="ACCEPT"',
      'DEFAULT_APPLICATION_POLICY="SKIP"',
      '',
    ].join('\n');
    let runCommandStub;
    let readFileStub;
    let publishStub;
    let written;

    const files = ({ conf = 'ENABLED=yes\n', defaults }) => {
      readFileStub.withArgs('/etc/ufw/ufw.conf').callsFake(async () => {
        if (conf === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return conf;
      });
      readFileStub.withArgs('/etc/default/ufw').callsFake(async () => {
        if (defaults === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return defaults;
      });
    };
    const renamed = () => sinon.assert.calledWith(runCommandStub, 'mv', sinon.match({ runAsRoot: true, params: ['-f', '/etc/default/ufw.flux-new', '/etc/default/ufw'] }));
    const reloaded = () => runCommandStub.calledWith('python3', ufwRun(['reload']));

    beforeEach(() => {
      runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: '', stderr: '' });
      readFileStub = sinon.stub(fs, 'readFile').callThrough();
      sinon.stub(fs, 'writeFile').callsFake(async (file, content) => { written = content; });
      publishStub = sinon.stub(fluxEventBus, 'publish');
      written = null;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('does nothing on a node without ufw', async () => {
      files({ conf: null, defaults: null });

      await fluxNetworkHelper.ensureUfwDefaults();

      sinon.assert.notCalled(runCommandStub);
      sinon.assert.notCalled(publishStub);
    });

    it('leaves a whole file that allows outbound alone', async () => {
      files({ defaults: wholeFile() });

      await fluxNetworkHelper.ensureUfwDefaults();

      sinon.assert.notCalled(runCommandStub);
      sinon.assert.notCalled(publishStub);
    });

    it('restores ufw\'s own defaults over an empty file, by rename, and reloads an enabled firewall', async () => {
      files({ defaults: '' });

      await fluxNetworkHelper.ensureUfwDefaults();

      expect(written).to.match(/^DEFAULT_INPUT_POLICY="DROP"$/m);
      expect(written).to.match(/^DEFAULT_OUTPUT_POLICY="ACCEPT"$/m);
      expect(written).to.match(/^DEFAULT_FORWARD_POLICY="DROP"$/m);
      expect(written).to.match(/^DEFAULT_APPLICATION_POLICY="SKIP"$/m);
      // the file the ufw package ships on Ubuntu 20.04 to 26.04, byte for byte
      expect(crypto.createHash('md5').update(written).digest('hex')).to.equal('a921dd9d167380b04de4bc911915ea44');
      sinon.assert.calledWith(runCommandStub, 'install', sinon.match({ runAsRoot: true, params: sinon.match.array.endsWith(['/etc/default/ufw.flux-new']) }));
      renamed();
      expect(reloaded()).to.equal(true);
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:defaultsWritten', { restored: true });
    });

    it('restores a missing file, and reloads nothing when the firewall is not enabled', async () => {
      files({ conf: 'ENABLED=no\n', defaults: null });

      await fluxNetworkHelper.ensureUfwDefaults();

      expect(written).to.match(/^DEFAULT_INPUT_POLICY="DROP"$/m);
      renamed();
      expect(reloaded()).to.equal(false);
    });

    it('restores a file missing any one policy', async () => {
      files({ defaults: wholeFile().replace(/^DEFAULT_APPLICATION_POLICY=.*\n/m, '') });

      await fluxNetworkHelper.ensureUfwDefaults();

      expect(written).to.match(/^DEFAULT_APPLICATION_POLICY="SKIP"$/m);
      expect(written).to.match(/^DEFAULT_FORWARD_POLICY="DROP"$/m);
    });

    it('sets only the outbound policy of a whole file that denies outbound', async () => {
      files({ defaults: wholeFile('DROP') });

      await fluxNetworkHelper.ensureUfwDefaults();

      expect(written).to.equal(wholeFile());
      renamed();
      expect(reloaded()).to.equal(true);
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:defaultsWritten', { restored: false });
    });

    it('never runs ufw default', async () => {
      files({ defaults: wholeFile('DROP') });

      await fluxNetworkHelper.ensureUfwDefaults();

      expect(runCommandStub.getCalls().map(ufwArgs).filter((args) => args?.[0] === 'default')).to.deep.equal([]);
    });

    it('neither renames nor reloads when the staged copy cannot be written', async () => {
      files({ defaults: '' });
      runCommandStub.withArgs('install').resolves({ error: new Error('install failed'), stdout: '', stderr: '' });

      await fluxNetworkHelper.ensureUfwDefaults();

      sinon.assert.neverCalledWith(runCommandStub, 'mv');
      expect(reloaded()).to.equal(false);
      sinon.assert.notCalled(publishStub);
    });

    it('reloads nothing when the rename fails', async () => {
      files({ defaults: '' });
      runCommandStub.withArgs('mv').resolves({ error: new Error('mv failed'), stdout: '', stderr: '' });

      await fluxNetworkHelper.ensureUfwDefaults();

      expect(reloaded()).to.equal(false);
      sinon.assert.notCalled(publishStub);
    });
  });

  describe('container egress rules tests', () => {
    const iptablesCall = (params) => sinon.match({ runAsRoot: true, params });
    let runCommandStub;
    let publishStub;
    let written;

    beforeEach(() => {
      runCommandStub = sinon.stub(serviceHelper, 'runCommand').resolves({ error: null, stdout: '', stderr: '' });
      publishStub = sinon.stub(fluxEventBus, 'publish');
      sinon.stub(fs, 'writeFile').callsFake(async (file, content) => { written = content; });
      written = null;
    });

    afterEach(() => {
      sinon.restore();
    });

    const liveChain = (rules) => runCommandStub.withArgs('iptables', iptablesCall(['-S', 'DOCKER-USER']))
      .resolves({ error: null, stdout: ['-N DOCKER-USER', ...rules, ''].join('\n'), stderr: '' });

    it('matches packets by the docker bridge they come from, never by source address', () => {
      const rules = fluxNetworkHelper.containerEgressRules();

      expect(rules.filter((rule) => / -s /.test(rule))).to.deep.equal([]);
      ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '198.18.0.0/15', '240.0.0.0/4'].forEach((network) => {
        expect(rules).to.include(`-A DOCKER-USER -d ${network} -i docker0 -j DROP`);
        expect(rules).to.include(`-A DOCKER-USER -d ${network} -i br-+ -j DROP`);
      });
    });

    it('returns replies, traffic to a container and DNS before any drop', () => {
      const rules = fluxNetworkHelper.containerEgressRules();
      const firstDrop = rules.findIndex((rule) => rule.endsWith('-j DROP'));
      const before = rules.slice(0, firstDrop);

      expect(rules[0]).to.equal('-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN');
      expect(before).to.include('-A DOCKER-USER -d 172.23.0.0/16 -j RETURN');
      expect(before).to.include('-A DOCKER-USER -o docker0 -j RETURN');
      expect(rules.filter((rule) => /physdev/.test(rule))).to.deep.equal([]);
      // A host interface can carry a name like br-<id>; only docker0 is Docker's alone.
      expect(rules.filter((rule) => / -o /.test(rule)), 'rules matching where a packet goes').to.deep.equal(['-A DOCKER-USER -o docker0 -j RETURN']);
      ['docker0', 'br-+'].forEach((bridge) => ['udp', 'tcp'].forEach((proto) => {
        expect(before).to.include(`-A DOCKER-USER -i ${bridge} -p ${proto} -m ${proto} --dport 53 -j RETURN`);
      }));
      expect(rules[rules.length - 1]).to.equal('-A DOCKER-USER -j RETURN');
    });

    it('replaces the whole chain in one iptables-restore when it differs', async () => {
      liveChain(['-A DOCKER-USER -s 172.23.0.0/16 -d 10.0.0.0/8 -j DROP']);

      const res = await fluxNetworkHelper.applyContainerEgressRules();

      expect(res).to.equal(true);
      sinon.assert.calledWith(runCommandStub, 'iptables-restore', sinon.match({ runAsRoot: true, params: sinon.match.array.startsWith(['--noflush']) }));
      expect(written.split('\n')).to.deep.equal(['*filter', ':DOCKER-USER - [0:0]', ...fluxNetworkHelper.containerEgressRules(), 'COMMIT', '']);
      sinon.assert.calledOnceWithExactly(publishStub, 'firewall:containerEgressApplied', {});
    });

    it('writes nothing when the chain already matches', async () => {
      liveChain(fluxNetworkHelper.containerEgressRules());

      const res = await fluxNetworkHelper.applyContainerEgressRules();

      expect(res).to.equal(true);
      sinon.assert.neverCalledWith(runCommandStub, 'iptables-restore');
      sinon.assert.notCalled(publishStub);
    });

    it('reports failure when the restore fails', async () => {
      runCommandStub.withArgs('iptables-restore').resolves({ error: new Error('restore failed'), stdout: '', stderr: '' });

      const res = await fluxNetworkHelper.applyContainerEgressRules();

      expect(res).to.equal(false);
      sinon.assert.notCalled(publishStub);
    });

    it('reports failure, not a rejection, when the rules file cannot be written', async () => {
      fs.writeFile.rejects(new Error('ENOSPC'));

      const res = await fluxNetworkHelper.applyContainerEgressRules();

      expect(res).to.equal(false);
      sinon.assert.neverCalledWith(runCommandStub, 'iptables-restore');
      sinon.assert.notCalled(publishStub);
    });

    it('puts back a missing FORWARD jump to DOCKER-USER, and only then', async () => {
      liveChain(fluxNetworkHelper.containerEgressRules());
      runCommandStub.withArgs('iptables', iptablesCall(['-C', 'FORWARD', '-j', 'DOCKER-USER'])).resolves({ error: new Error('missing'), stdout: '', stderr: '' });

      await fluxNetworkHelper.applyContainerEgressRules();
      sinon.assert.calledWith(runCommandStub, 'iptables', iptablesCall(['-I', 'FORWARD', '-j', 'DOCKER-USER']));

      runCommandStub.resetHistory();
      runCommandStub.withArgs('iptables', iptablesCall(['-C', 'FORWARD', '-j', 'DOCKER-USER'])).resolves({ error: null, stdout: '', stderr: '' });
      await fluxNetworkHelper.applyContainerEgressRules();
      sinon.assert.neverCalledWith(runCommandStub, 'iptables', iptablesCall(['-I', 'FORWARD', '-j', 'DOCKER-USER']));
    });
  });

  describe('placement hold tests', () => {
    const { RESIDENTIAL_DOS } = fluxNetworkHelper.PlacementHoldOwner;

    afterEach(() => {
      fluxNetworkHelper.clearPlacementHold(RESIDENTIAL_DOS);
      fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.RESIDENTIAL_DOS);
    });

    it('is not held by default', () => {
      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(false);
      expect(fluxNetworkHelper.getPlacementHold()).to.equal(null);
    });

    it('holds with the reason it was given', () => {
      fluxNetworkHelper.setPlacementHold(RESIDENTIAL_DOS, 'residential node not running ArcaneOS');

      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(true);
      expect(fluxNetworkHelper.getPlacementHold()).to.equal('residential node not running ArcaneOS');
    });

    it('releases', () => {
      fluxNetworkHelper.setPlacementHold(RESIDENTIAL_DOS, 'some reason');

      fluxNetworkHelper.clearPlacementHold(RESIDENTIAL_DOS);

      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(false);
    });

    it('refuses an owner it does not know, rather than minting one', () => {
      // An unknown owner is a caller that was never given an identity. Accepted,
      // it would hold the node under a name no release path knows about.
      expect(() => fluxNetworkHelper.setPlacementHold('someFeature', 'a reason')).to.throw('unknown owner');
      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(false);
    });

    it('does not release a hold it does not own', () => {
      // The reason this is a map keyed by owner and not a single slot. With one
      // slot, whoever cleared next released the node outright - including a
      // caller whose own condition had nothing to do with the hold in place - so
      // the node resumed taking apps for a condition that had not lifted.
      fluxNetworkHelper.setPlacementHold(RESIDENTIAL_DOS, 'residential');

      fluxNetworkHelper.clearPlacementHold('someOtherOwner');

      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(true);
      expect(fluxNetworkHelper.getPlacementHold()).to.equal('residential');
    });

    it('does NOT put the node into DOS', () => {
      // The whole point of the hold: DOS >= 100 makes nodeStatusMonitor and
      // appStartupManager rm -rf every app on the box. A node that should stop
      // growing but keep its volumes must not cross that line.
      fluxNetworkHelper.setPlacementHold(RESIDENTIAL_DOS, 'residential node not running ArcaneOS');

      expect(fluxNetworkHelper.isNodeDos()).to.equal(false);
    });

    it('is independent of a sticky DOS in both directions', () => {
      fluxNetworkHelper.setStickyDos(fluxNetworkHelper.StickyDosOwner.RESIDENTIAL_DOS, 'someone else holds this');

      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(false);

      fluxNetworkHelper.clearStickyDos(fluxNetworkHelper.StickyDosOwner.RESIDENTIAL_DOS);
      fluxNetworkHelper.setPlacementHold(RESIDENTIAL_DOS, 'held');

      expect(fluxNetworkHelper.isNodeDos()).to.equal(false);
      expect(fluxNetworkHelper.isPlacementHeld()).to.equal(true);
    });
  });

  describe('local socket address announcements', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('announces an address only when it differs from the last one learned', () => {
      const listener = sinon.spy();
      fluxNetworkHelper.onLocalSocketAddressChange(listener);

      fluxNetworkHelper.setLocalSocketAddress('198.51.100.10');
      fluxNetworkHelper.setLocalSocketAddress('198.51.100.10:16127');
      fluxNetworkHelper.setLocalSocketAddress(null);
      fluxNetworkHelper.setLocalSocketAddress('198.51.100.10');
      fluxNetworkHelper.setLocalSocketAddress('198.51.100.11:16137');
      fluxNetworkHelper.offLocalSocketAddressChange(listener);
      fluxNetworkHelper.setLocalSocketAddress('198.51.100.12');

      expect(listener.args).to.eql([['198.51.100.10:16127'], ['198.51.100.11:16137']]);
      expect(fluxNetworkHelper.getKnownLocalSocketAddress()).to.equal('198.51.100.12:16127');
    });

    it('keeps the last address learned when the benchmark stops answering', () => {
      fluxNetworkHelper.setLocalSocketAddress('198.51.100.20');
      fluxNetworkHelper.setLocalSocketAddress(null);

      expect(fluxNetworkHelper.getKnownLocalSocketAddress()).to.equal('198.51.100.20:16127');
    });
  });

  describe('hasPublicIpOnInterface', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('is true for a public address on the device the traffic leaves by', async () => {
      sinon.stub(dgram, 'createSocket').returns(fakeUdpSocket({ source: '203.0.113.7' }));
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [{ family: 'IPv4', internal: false, address: '203.0.113.7' }],
      });

      expect(await fluxNetworkHelper.hasPublicIpOnInterface()).to.equal(true);
    });

    it('finds a public address that is not the first one on the device', async () => {
      // An interface can carry a private primary and a public secondary - the
      // shape add-on and failover addresses arrive in. The kernel picks the
      // primary as the source; the device still holds the public address.
      sinon.stub(dgram, 'createSocket').returns(fakeUdpSocket({ source: '192.168.1.50' }));
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [
          { family: 'IPv4', internal: false, address: '192.168.1.50' },
          { family: 'IPv4', internal: false, address: '203.0.113.7' },
        ],
      });

      expect(await fluxNetworkHelper.hasPublicIpOnInterface()).to.equal(true);
    });

    it('finds a public address bound under a label on the device', async () => {
      sinon.stub(dgram, 'createSocket').returns(fakeUdpSocket({ source: '192.168.1.50' }));
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.50' }],
        'eth0:1': [{ family: 'IPv4', internal: false, address: '203.0.113.7' }],
      });

      expect(await fluxNetworkHelper.hasPublicIpOnInterface()).to.equal(true);
    });

    it('is false behind NAT', async () => {
      sinon.stub(dgram, 'createSocket').returns(fakeUdpSocket({ source: '192.168.1.50' }));
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.50' }],
      });

      expect(await fluxNetworkHelper.hasPublicIpOnInterface()).to.equal(false);
    });

    it('is false for a public address on a device the traffic does not leave by', async () => {
      // A wg-quick full tunnel: the public address stays on eth0 while every
      // packet leaves by wg0.
      sinon.stub(dgram, 'createSocket').returns(fakeUdpSocket({ source: '10.66.0.2' }));
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [{ family: 'IPv4', internal: false, address: '203.0.113.7' }],
        wg0: [{ family: 'IPv4', internal: false, address: '10.66.0.2' }],
      });

      expect(await fluxNetworkHelper.hasPublicIpOnInterface()).to.equal(false);
    });

    it('is NULL, not false, when the device cannot be named', async () => {
      // "No public address on the device" is a fact about the node and means it
      // is behind NAT; "no route out" is not an answer to that question.
      sinon.stub(dgram, 'createSocket').returns(fakeUdpSocket({ error: Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' }) }));

      expect(await fluxNetworkHelper.hasPublicIpOnInterface()).to.equal(null);
    });
  });

  describe('interfaceDevice', () => {
    it('names the device a labelled address is bound on', () => {
      expect(fluxNetworkHelper.interfaceDevice('eth0:1')).to.equal('eth0');
    });

    it('names an unlabelled interface as itself', () => {
      expect(fluxNetworkHelper.interfaceDevice('enp3s0')).to.equal('enp3s0');
    });
  });

  describe('egressDevice', () => {
    let socket;

    afterEach(() => {
      sinon.restore();
    });

    it('names the device holding the source address the kernel chose', async () => {
      socket = fakeUdpSocket({ source: '10.66.0.2' });
      sinon.stub(dgram, 'createSocket').returns(socket);
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
        wg0: [{ family: 'IPv4', internal: false, address: '10.66.0.2' }],
      });

      expect(await fluxNetworkHelper.egressDevice('1.1.1.1')).to.equal('wg0');
      sinon.assert.calledWith(socket.connect, sinon.match.number, '1.1.1.1');
      sinon.assert.calledOnce(socket.close);
    });

    it('names the device when the source address is bound under a label', async () => {
      socket = fakeUdpSocket({ source: '203.0.113.7' });
      sinon.stub(dgram, 'createSocket').returns(socket);
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
        'eth0:1': [{ family: 'IPv4', internal: false, address: '203.0.113.7' }],
      });

      expect(await fluxNetworkHelper.egressDevice('1.1.1.1')).to.equal('eth0');
    });

    it('is null when the source address is on no listed interface', async () => {
      socket = fakeUdpSocket({ source: '10.8.0.2' });
      sinon.stub(dgram, 'createSocket').returns(socket);
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
      });

      expect(await fluxNetworkHelper.egressDevice('1.1.1.1')).to.equal(null);
    });

    it('asks by default for the route to an address no network routes on its own', async () => {
      socket = fakeUdpSocket({ source: '10.0.0.5' });
      sinon.stub(dgram, 'createSocket').returns(socket);
      sinon.stub(os, 'networkInterfaces').returns({
        eth0: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
      });

      expect(await fluxNetworkHelper.egressDevice()).to.equal('eth0');
      sinon.assert.calledWith(socket.connect, sinon.match.number, '203.0.113.1');
    });

    it('is null, and closes the socket, when there is no route', async () => {
      socket = fakeUdpSocket({ error: Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' }) });
      sinon.stub(dgram, 'createSocket').returns(socket);
      const interfaces = sinon.stub(os, 'networkInterfaces');

      expect(await fluxNetworkHelper.egressDevice('1.1.1.1')).to.equal(null);
      sinon.assert.calledOnce(socket.close);
      sinon.assert.notCalled(interfaces);
    });
  });
});
