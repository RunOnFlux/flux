const { expect } = require('chai');
const sinon = require('sinon');
const proxyRequire = require('proxyquire').noPreserveCache();;

const config = {
  initial: {
    apiport: "16137",
    routerIP: "1.2.3.4"
  },
  computed: {
    appRootPath: "testpath", // for fluxbench file
  }
};

let apiServer = proxyRequire('../../apiServer', { './config/userconfig': structuredClone(config) });

// require these after apiServer as daemonService needs config
const fluxportControllerService = require('../../ZelBack/src/services/fluxportControllerService');
const upnpService = require('../../ZelBack/src/services/upnpService');




// computed: {
//   benchmarkConfigFilePath: 'benchpath',
//   appRootPath: '/zelflux',
//   homePort: 16136,
//   apiPort: 16137,
//   apiPortSsl: 16138,
//   syncthingPort: 16139,
// },

const log = require('../../ZelBack/src/lib/log');
// const generalService = require('../../ZelBack/src/services/generalService');
// const upnpService = require('../../ZelBack/src/services/upnpService');
// const fluxportControllerService = require('../../ZelBack/src/services/fluxportControllerService');
// const fpc = require('@megachips/fluxport-controller');
// const fs = require('node:fs/promises');
// const benchService = require('../../ZelBack/src/services/benchmarkService');

describe('apiServer tests', () => {
  beforeEach(() => {
    errorSpy = sinon.spy(log, 'error');
    apiServer = proxyRequire('../../apiServer', { './config/userconfig': structuredClone(config) });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Valid tags / ip addresses tests', () => {

    it('should validate IP addresses correctly', async () => {
      const addrs = ["1.2.3.4", "111.222.222.111", 1234, "1.2d.3.4", "122.223.231.288"]
      const results = addrs.map((addr) => apiServer.validIpv4Address(addr));
      expect(results).to.deep.equal([true, true, false, false, false]);
    });

    it('should validate tags correctly', async () => {
      const valid = {
        ValidTag1: "testnode",
        ValidTag2: 123445,
        ValidTag3: true,
      };
      const invalid = {
        InvalidTag1: [],
        InvalidTag2: {},
      };

      userconfig.initial.tags = { ...valid, ...invalid };

      const tags = apiServer.validateTags();
      expect(tags).to.be.deep.equal(valid);
      sinon.assert.callCount(errorSpy, 2);
      sinon.assert.calledWithExactly(errorSpy, 'Tag must be a string and value must be a boolean, string or number, Skipping.')
    });

    it('should log error and return empty tags object for incorrect type', async () => {
      const invalidArgs = [[], "Name=Value", 12345, new Set(), new Map()];

      invalidArgs.forEach((invalidArg) => {
        userconfig.initial.tags = invalidArg;
        const tags = apiServer.validateTags();
        expect(tags).to.deep.equal({});
      });

      sinon.assert.callCount(errorSpy, 5);
      sinon.assert.calledWithExactly(errorSpy, 'Error tags must be a mapping with string keys and values as string, number or boolean.');
    });
  });

  describe("wait for apiport / routerip tests", () => {
    it("Should return port / ip with correct type from userconfig if autoUpnp not set", async () => {
      const result = await apiServer.waitForApiPortAndRouterIp(false);
      expect(result).to.deep.equal([16137, "1.2.3.4"]);
    });

    it("Should log error and exit if invalid ip address used in config", async () => {
      const exit = sinon.stub(process, 'exit');

      userconfig.initial.routerIP = "444.444.444.444";
      const result = await apiServer.waitForApiPortAndRouterIp(false);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Router IP: 444.444.444.444 must be a valid ipv4 address.')
      sinon.assert.calledOnce(exit);
    });

    it("Should start gossip server and return it's ip / port instead of userconfig if upnp set in config", async () => {
      const startServer = sinon.stub(fluxportControllerService, 'startGossipServer');
      const getPort = sinon.stub(fluxportControllerService, "getApiPort");
      const getIp = sinon.stub(fluxportControllerService, 'getRouterIp')

      startServer.resolves(true);
      getPort.returns(16157);
      getIp.returns("3.3.3.3");

      const result = await apiServer.waitForApiPortAndRouterIp(true);
      expect(result).to.deep.equal([16157, "3.3.3.3"]);
      sinon.assert.calledOnce(startServer);
      sinon.assert.calledOnce(getPort);
      sinon.assert.calledOnce(getIp);
      sinon.assert.notCalled(errorSpy);
    });

    it("Should log error and exit if gossipServer doesn't start", async () => {
      const exit = sinon.stub(process, 'exit');
      const startServer = sinon.stub(fluxportControllerService, 'startGossipServer');
      startServer.resolves(false);

      await apiServer.waitForApiPortAndRouterIp(true);
      sinon.assert.calledOnce(exit);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Error starting GossipServer for autoUPnP. Unable to get collateral '
        + 'information, or unable to adjust firewall. Shutting down')
    });
  });
  describe("LoadUpnpIfSupported tests", () => {
    it("Should verify and setup upnp port if routerIP set in userconfig", async () => {
      const verify = sinon.stub(upnpService, 'verifyUPNPsupport');
      const setup = sinon.stub(upnpService, 'setupUPNP');

      verify.resolves(true);
      setup.resolves(true);

      await apiServer.loadUpnpIfSupported(false);
      sinon.assert.calledOnce(verify);
      sinon.assert.calledOnce(setup);
      sinon.assert.notCalled(errorSpy);
    })
    it("Should verify and setup upnp port if only upnp is set in userconfig", async () => {
      const verify = sinon.stub(upnpService, 'verifyUPNPsupport');
      const setup = sinon.stub(upnpService, 'setupUPNP');

      verify.resolves(true);
      setup.resolves(true);

      delete userconfig.initial.routerIP;
      delete userconfig.initial.apiport;
      userconfig.initial.upnp = true;

      await apiServer.loadUpnpIfSupported(true);
      sinon.assert.calledOnce(verify);
      sinon.assert.calledOnce(setup);
      sinon.assert.notCalled(errorSpy);
    })
    it("Should verify and return silently if apiport set to 16127 and upnp not supported", async () => {
      const verify = sinon.stub(upnpService, 'verifyUPNPsupport');
      const setup = sinon.stub(upnpService, 'setupUPNP');

      verify.resolves(false);

      delete userconfig.initial.routerIP;
      userconfig.initial.apiport = 16127;

      await apiServer.loadUpnpIfSupported(false);
      sinon.assert.calledOnce(verify);
      sinon.assert.notCalled(setup);
      sinon.assert.notCalled(errorSpy);
    });
    it("Should log error and exit if upnp requested and not supported", async () => {
      const exit = sinon.stub(process, 'exit');
      const verify = sinon.stub(upnpService, 'verifyUPNPsupport');

      verify.resolves(false);

      userconfig.initial.routerIP = undefined;
      userconfig.computed.apiPort = 16137;

      await apiServer.loadUpnpIfSupported(false);
      sinon.assert.calledOnce(verify);
      sinon.assert.calledOnce(exit);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Flux port 16137 specified but UPnP failed to verify support. Shutting down.');
    })
    it("Should log error and exit if upnp requested and failed setup", async () => {
      const exit = sinon.stub(process, 'exit');
      const verify = sinon.stub(upnpService, 'verifyUPNPsupport');
      const setup = sinon.stub(upnpService, 'setupUPNP');

      verify.resolves(true);
      setup.resolves(false);

      userconfig.initial.routerIP = undefined;
      userconfig.computed.apiPort = 16137;

      await apiServer.loadUpnpIfSupported(false);
      sinon.assert.calledOnce(verify);
      sinon.assert.calledOnce(setup);
      sinon.assert.calledOnce(exit);
      sinon.assert.calledOnceWithExactly(errorSpy, 'Flux port 16137 specified but UPnP failed to map to api or home port. Shutting down.');
    })
  });
});
