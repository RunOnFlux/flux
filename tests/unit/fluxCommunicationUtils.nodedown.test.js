// Set up global userconfig before loading any modules that depend on it
global.userconfig = {
  initial: {
    apiport: 16127,
    routerIP: false,
    pgpPrivateKey: '',
    blockedPorts: [],
    allowedPorts: [],
  },
};

const sinon = require('sinon');
const { expect } = require('chai');
const fluxCommunicationUtils = require('../../ZelBack/src/services/fluxCommunicationUtils');
const networkStateService = require('../../ZelBack/src/services/networkStateService');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const log = require('../../ZelBack/src/lib/log');

describe('fluxCommunicationUtils - nodedown message validation', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(networkStateService, 'waitStarted').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('verifyFluxBroadcast for nodedown messages', () => {
    it('should validate nodedown message from valid flux node', async () => {
      const nodeDownMessage = {
        version: 1,
        timestamp: Date.now(),
        pubKey: 'testpubkey123',
        signature: 'testsignature',
        data: {
          type: 'nodedown',
          ip: '192.168.1.100',
          broadcastAt: Date.now(),
        },
      };

      // Mock that the IP exists in the network state
      sandbox.stub(networkStateService, 'getFluxnodeBySocketAddress').resolves(true);
      sandbox.stub(verificationHelper, 'verifyMessage').returns(true);

      const result = await fluxCommunicationUtils.verifyFluxBroadcast(nodeDownMessage);

      expect(result).to.be.true;
      expect(networkStateService.getFluxnodeBySocketAddress).to.have.been.calledWith('192.168.1.100');
    });

    it('should reject nodedown message from unknown IP', async () => {
      const nodeDownMessage = {
        version: 1,
        timestamp: Date.now(),
        pubKey: 'testpubkey123',
        signature: 'testsignature',
        data: {
          type: 'nodedown',
          ip: '192.168.1.999', // Unknown IP
          broadcastAt: Date.now(),
        },
      };

      // Mock that the IP does not exist in the network state
      sandbox.stub(networkStateService, 'getFluxnodeBySocketAddress').resolves(false);
      sandbox.stub(log, 'warn');

      const result = await fluxCommunicationUtils.verifyFluxBroadcast(nodeDownMessage);

      expect(result).to.be.false;
      expect(networkStateService.getFluxnodeBySocketAddress).to.have.been.calledWith('192.168.1.999');
      expect(log.warn).to.have.been.calledWith('Invalid nodedown message, ip: 192.168.1.999 pubkey: testpubkey123');
    });

    it('should reject nodedown message with invalid signature', async () => {
      const nodeDownMessage = {
        version: 1,
        timestamp: Date.now(),
        pubKey: 'testpubkey123',
        signature: 'invalidsignature',
        data: {
          type: 'nodedown',
          ip: '192.168.1.100',
          broadcastAt: Date.now(),
        },
      };

      // Mock that the IP exists but signature is invalid
      sandbox.stub(networkStateService, 'getFluxnodeBySocketAddress').resolves(true);
      sandbox.stub(verificationHelper, 'verifyMessage').returns(false);

      const result = await fluxCommunicationUtils.verifyFluxBroadcast(nodeDownMessage);

      expect(result).to.be.false;
      expect(verificationHelper.verifyMessage).to.have.been.called;
    });

    it('should reject nodedown message without IP field', async () => {
      const nodeDownMessage = {
        version: 1,
        timestamp: Date.now(),
        pubKey: 'testpubkey123',
        signature: 'testsignature',
        data: {
          type: 'nodedown',
          // missing ip field
          broadcastAt: Date.now(),
        },
      };

      sandbox.stub(log, 'warn');

      const result = await fluxCommunicationUtils.verifyFluxBroadcast(nodeDownMessage);

      expect(result).to.be.false;
      expect(log.warn).to.have.been.calledWith('Invalid nodedown message, ip: undefined pubkey: testpubkey123');
    });

    it('should reject nodedown message from future', async () => {
      const futureTimestamp = Date.now() + (10 * 60 * 1000); // 10 minutes in future
      const nodeDownMessage = {
        version: 1,
        timestamp: futureTimestamp,
        pubKey: 'testpubkey123',
        signature: 'testsignature',
        data: {
          type: 'nodedown',
          ip: '192.168.1.100',
          broadcastAt: futureTimestamp,
        },
      };

      sandbox.stub(log, 'error');

      const result = await fluxCommunicationUtils.verifyFluxBroadcast(nodeDownMessage);

      expect(result).to.be.false;
      expect(log.error).to.have.been.calledWith('VerifyBroadcast: Message from future, rejecting');
    });
  });
});
