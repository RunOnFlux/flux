const { expect } = require('chai');
const sinon = require('sinon');
const testHelpers = require('../../ZelBack/src/services/appTesting/testHelpers');
const log = require('../../ZelBack/src/lib/log');

describe('testHelpers tests', () => {
  let originalFluxOSPath;

  beforeEach(() => {
    originalFluxOSPath = process.env.FLUXOS_PATH;
  });

  afterEach(() => {
    sinon.restore();
    if (originalFluxOSPath !== undefined) {
      process.env.FLUXOS_PATH = originalFluxOSPath;
    } else {
      delete process.env.FLUXOS_PATH;
    }
  });

  describe('handleTestShutdown tests', () => {
    it('should shutdown test resources with firewall and upnp', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should skip firewall removal when skipFirewall is true', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = { skipFirewall: true };

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.notCalled(deleteAllowPortRule);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should skip upnp removal when skipUpnp is true', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = { skipUpnp: true };

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.notCalled(removeMapUpnpPort);
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should skip http server shutdown when skipHttpServer is true', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = { skipHttpServer: true };

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.notCalled(testHttpServer.close);
    });

    it('should skip all cleanup when all skip options are true', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {
        skipFirewall: true,
        skipUpnp: true,
        skipHttpServer: true,
      };

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.notCalled(deleteAllowPortRule);
      sinon.assert.notCalled(removeMapUpnpPort);
      sinon.assert.notCalled(testHttpServer.close);
    });

    it('should handle firewall deletion errors gracefully', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().rejects(new Error('Firewall deletion failed'));
      const removeMapUpnpPort = sinon.stub().resolves();
      const logStub = sinon.stub(log, 'error');

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledOnce(logStub);
      expect(logStub.firstCall.args[0].message).to.include('Firewall deletion failed');
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should handle upnp removal errors gracefully', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().rejects(new Error('UPnP removal failed'));
      const logStub = sinon.stub(log, 'error');

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.calledOnce(logStub);
      expect(logStub.firstCall.args[0].message).to.include('UPnP removal failed');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should handle http server close errors', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(new Error('Server close failed')),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();
      const logStub = sinon.stub(log, 'error');

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
      sinon.assert.calledOnce(logStub);
      expect(logStub.firstCall.args[0]).to.include('testHttpServer shutdown failed');
    });

    it('should update firewall on Arcane OS even if firewall is inactive', async () => {
      process.env.FLUXOS_PATH = '/path/to/arcane';

      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(false);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should not update firewall when not Arcane OS and firewall inactive', async () => {
      delete process.env.FLUXOS_PATH;

      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(false);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.notCalled(deleteAllowPortRule);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should handle isFirewallActive errors and assume firewall is active', async () => {
      delete process.env.FLUXOS_PATH;

      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().rejects(new Error('Cannot check firewall'));
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      // Should update firewall since error defaults to true
      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should work with null options', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = null;

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should work with undefined options', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        undefined,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, testingPort);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should handle different port numbers', async () => {
      const testingPort = 9999;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(deleteAllowPortRule, 9999);
      sinon.assert.calledWith(removeMapUpnpPort, 9999, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should use correct app name for upnp', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
    });

    it('should handle multiple errors simultaneously', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(new Error('Server error')),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().rejects(new Error('Firewall error'));
      const removeMapUpnpPort = sinon.stub().rejects(new Error('UPnP error'));
      const logStub = sinon.stub(log, 'error');

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      // All three operations should attempt and log errors
      sinon.assert.calledThrice(logStub);
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should handle empty FLUXOS_PATH as non-Arcane', async () => {
      process.env.FLUXOS_PATH = '';

      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(false);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      // Empty FLUXOS_PATH should be treated as non-Arcane
      sinon.assert.notCalled(deleteAllowPortRule);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
    });

    it('should handle partial options object', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = { skipFirewall: true };

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      sinon.assert.notCalled(deleteAllowPortRule);
      sinon.assert.calledWith(removeMapUpnpPort, testingPort, 'Flux_Test_App');
      sinon.assert.calledOnce(testHttpServer.close);
    });
  });

  describe('integration scenarios', () => {
    it('should cleanup all resources in correct order', async () => {
      const testingPort = 8080;
      const callOrder = [];
      const testHttpServer = {
        close: sinon.stub().callsFake((cb) => {
          callOrder.push('httpServer');
          cb(null);
        }),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().callsFake(async () => {
        callOrder.push('firewall');
      });
      const removeMapUpnpPort = sinon.stub().callsFake(async () => {
        callOrder.push('upnp');
      });

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      // Verify operations happened in expected sequence
      expect(callOrder).to.include('firewall');
      expect(callOrder).to.include('upnp');
      expect(callOrder).to.include('httpServer');
    });

    it('should handle Arcane OS environment correctly', async () => {
      process.env.FLUXOS_PATH = '/opt/arcane';

      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(false);
      const deleteAllowPortRule = sinon.stub().resolves();
      const removeMapUpnpPort = sinon.stub().resolves();

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      // Arcane OS should always update firewall
      sinon.assert.calledOnce(deleteAllowPortRule);
      sinon.assert.calledOnce(removeMapUpnpPort);
      sinon.assert.calledOnce(testHttpServer.close);
    });

    it('should continue cleanup even when one operation fails', async () => {
      const testingPort = 8080;
      const testHttpServer = {
        close: sinon.stub().yields(null),
      };
      const options = {};

      const isFirewallActive = sinon.stub().resolves(true);
      const deleteAllowPortRule = sinon.stub().rejects(new Error('Failed'));
      const removeMapUpnpPort = sinon.stub().resolves();
      sinon.stub(log, 'error');

      await testHelpers.handleTestShutdown(
        testingPort,
        testHttpServer,
        options,
        isFirewallActive,
        deleteAllowPortRule,
        removeMapUpnpPort,
      );

      // All operations should be attempted despite firewall failure
      sinon.assert.calledOnce(deleteAllowPortRule);
      sinon.assert.calledOnce(removeMapUpnpPort);
      sinon.assert.calledOnce(testHttpServer.close);
    });
  });
});
