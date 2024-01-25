global.userconfig = require('../../config/userconfig');
const chai = require('chai');
const sinon = require('sinon');
const log = require('../../ZelBack/src/lib/log');
const generalService = require('../../ZelBack/src/services/generalService');
const upnpService = require("../../ZelBack/src/services/upnpService");
const fluxportControllerService = require('../../ZelBack/src/services/fluxportControllerService');
const fpc = require('@megachips/fluxport-controller');
const fs = require('node:fs/promises');
const benchService = require('../../ZelBack/src/services/benchmarkService');

const { expect } = chai;

describe('fluxportControllerService tests', () => {
  describe('startGossipServer tests', () => {
    let errorSpy;

    beforeEach(() => {
      errorSpy = sinon.spy(log, 'error');

      global.userconfig = {
        computed: {
          benchmarkConfigFilePath: "benchpath",
          appRootPath: "/zelflux",
          homePort: 16136,
          apiPort: 16137,
          apiPortSsl: 16138,
          syncthingPort: 16139
        }
      }
    });

    afterEach(() => {
      sinon.stub(fpc.FluxGossipServer.prototype, 'stop');
      fluxportControllerService.stopGossipServer();
      sinon.restore();
    });

    it('should start GossipServer and not raise errors', async () => {
      sinon.stub(generalService, 'obtainNodeCollateralInformation').returns(Promise.resolve({ txhash: "testtx", txindex: 0 }));
      sinon.stub(upnpService, 'ufwAllowSsdpforInit').returns(Promise.resolve(true));
      const gossipStart = sinon.stub(fpc.FluxGossipServer.prototype, 'start');

      const pre = fluxportControllerService.getGossipServer();
      const gossip = await fluxportControllerService.startGossipServer();

      expect(pre).to.equal(null);
      expect(gossip).to.be.ok;
      expect(gossip.startedAt).to.equal(0);
      sinon.assert.notCalled(errorSpy);
      sinon.assert.calledOnce(generalService.obtainNodeCollateralInformation);
      sinon.assert.calledOnce(gossipStart);
    });
    it('should only start once', async () => {
      const infoStub = sinon.stub(log, "info");

      sinon.stub(generalService, 'obtainNodeCollateralInformation').returns(Promise.resolve({ txhash: "testtx", txindex: 0 }));
      sinon.stub(upnpService, 'ufwAllowSsdpforInit').returns(Promise.resolve(true));
      sinon.stub(fpc.FluxGossipServer.prototype, 'start');

      await fluxportControllerService.startGossipServer();
      const first = fluxportControllerService.getGossipServer();
      await fluxportControllerService.startGossipServer();
      const second = fluxportControllerService.getGossipServer();
      const startLogs = infoStub.getCalls().filter(
        (call) => call.calledWithExactly('Starting GossipServer')
      );

      expect(first).to.equal(second);
      expect(startLogs.length).to.equal(1);
      sinon.assert.notCalled(errorSpy);
    });
    it('should attach routerIp and apiPort listeners', async () => {
      sinon.stub(generalService, 'obtainNodeCollateralInformation').returns(Promise.resolve({ txhash: "testtx", txindex: 0 }));
      sinon.stub(upnpService, 'ufwAllowSsdpforInit').returns(Promise.resolve(true));
      sinon.stub(fpc.FluxGossipServer.prototype, 'start');

      const gossip = await fluxportControllerService.startGossipServer();

      const routerListeners = gossip.listenerCount("routerIpConfirmed");
      const ipListeners = gossip.listenerCount("portConfirmed");

      expect(routerListeners).to.equal(1);
      expect(ipListeners).to.equal(1);
      sinon.assert.notCalled(errorSpy);
    });
    it('should handle a routerIpConfirmed event', async () => {
      const infoStub = sinon.stub(log, "info");

      sinon.stub(generalService, 'obtainNodeCollateralInformation').returns(Promise.resolve({ txhash: "testtx", txindex: 0 }));
      sinon.stub(upnpService, 'ufwAllowSsdpforInit').returns(Promise.resolve(true));

      const remove = sinon.stub(upnpService, 'ufwRemoveAllowSsdpforInit');
      remove.returns(Promise.resolve());

      const clean = sinon.stub(upnpService, 'cleanOldMappings');
      clean.returns(Promise.resolve());

      sinon.stub(fpc.FluxGossipServer.prototype, 'start');

      const gossip = await fluxportControllerService.startGossipServer();

      gossip.emit("routerIpConfirmed", "10.10.123.123");

      gossip.on('flush', async () => {
        const ipLogs = infoStub.getCalls().filter(
          (call) => call.calledWithExactly('Gossip server got new routerIp: 10.10.123.123, updating')
        );

        expect(ipLogs.length).to.equal(1);
        sinon.assert.calledOnce(remove);
        sinon.assert.calledOnceWithExactly(clean, "10.10.123.123");
        sinon.assert.notCalled(errorSpy);
        expect(await fluxportControllerService.getRouterIp()).to.equal("10.10.123.123");
      });
    });
    it('should handle a portConfirmed event', async () => {
      const infoStub = sinon.stub(log, "info");

      sinon.stub(generalService, 'obtainNodeCollateralInformation').returns(Promise.resolve({ txhash: "testtx", txindex: 0 }));
      sinon.stub(upnpService, 'ufwAllowSsdpforInit').returns(Promise.resolve(true));

      const readFile = sinon.stub(fs, 'readFile');
      readFile.returns(Promise.resolve("fluxport=16137"));
      const writeFile = sinon.stub(fs, 'writeFile')
      writeFile.resolves(null);
      const executeBench = sinon.stub(benchService, 'executeCall');
      executeBench.resolves(null);

      sinon.stub(fpc.FluxGossipServer.prototype, 'start');

      const gossip = await fluxportControllerService.startGossipServer();

      gossip.emit("portConfirmed", "1234");

      gossip.on('flush', async () => {
        const ipLogs = infoStub.getCalls().filter(
          (call) => call.calledWithExactly('Gossip server got new apiPort: 1234, updating')
        );

        expect(ipLogs.length).to.equal(1);
        sinon.assert.calledOnce(readFile);
        sinon.assert.calledOnceWithExactly(writeFile, "fluxport=1234");
        sinon.assert.calledOnceWithExactly(executeBench, "restartnodebenchmarks");
        sinon.assert.notCalled(errorSpy);
        expect(await fluxportControllerService.getApiPort()).to.equal("1234");
      });
    });
  });
});
