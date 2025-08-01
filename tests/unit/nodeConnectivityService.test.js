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
const net = require('net');
const nodeConnectivityService = require('../../ZelBack/src/services/nodeConnectivityService');
const dbHelper = require('../../ZelBack/src/services/dbHelper');
const fluxCommunicationMessagesSender = require('../../ZelBack/src/services/fluxCommunicationMessagesSender');
const serviceHelper = require('../../ZelBack/src/services/serviceHelper');
const log = require('../../ZelBack/src/lib/log');

describe('nodeConnectivityService tests', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    // Ensure service is stopped after each test
    nodeConnectivityService.stopConnectivityMonitoring();
  });

  describe('checkNodeConnectivity', () => {
    it('should return true when node is reachable', async () => {
      const mockSocket = {
        setTimeout: sinon.stub(),
        on: sinon.stub(),
        connect: sinon.stub(),
        end: sinon.stub(),
        destroy: sinon.stub(),
      };

      // Simulate successful connection
      mockSocket.on.withArgs('connect').callsFake((event, callback) => {
        if (event === 'connect') {
          callback();
        }
      });

      sandbox.stub(net, 'Socket').returns(mockSocket);

      const result = await nodeConnectivityService.checkNodeConnectivity('192.168.1.1', 16127, 5000);

      expect(result).to.be.true;
      expect(mockSocket.setTimeout).to.have.been.calledWith(5000);
      expect(mockSocket.connect).to.have.been.calledWith(16127, '192.168.1.1');
      expect(mockSocket.end).to.have.been.called;
    });

    it('should return false when node is unreachable (error)', async () => {
      const mockSocket = {
        setTimeout: sinon.stub(),
        on: sinon.stub(),
        connect: sinon.stub(),
        destroy: sinon.stub(),
      };

      // Simulate connection error
      mockSocket.on.withArgs('error').callsFake((event, callback) => {
        if (event === 'error') {
          callback(new Error('Connection refused'));
        }
      });

      sandbox.stub(net, 'Socket').returns(mockSocket);

      const result = await nodeConnectivityService.checkNodeConnectivity('192.168.1.1', 16127, 5000);

      expect(result).to.be.false;
      expect(mockSocket.destroy).to.have.been.called;
    });

    it('should return false when connection times out', async () => {
      const mockSocket = {
        setTimeout: sinon.stub(),
        on: sinon.stub(),
        connect: sinon.stub(),
        destroy: sinon.stub(),
      };

      // Simulate timeout
      mockSocket.on.withArgs('timeout').callsFake((event, callback) => {
        if (event === 'timeout') {
          callback();
        }
      });

      sandbox.stub(net, 'Socket').returns(mockSocket);

      const result = await nodeConnectivityService.checkNodeConnectivity('192.168.1.1', 16127, 5000);

      expect(result).to.be.false;
      expect(mockSocket.destroy).to.have.been.called;
    });

    it('should handle connection exceptions', async () => {
      const mockSocket = {
        setTimeout: sinon.stub(),
        on: sinon.stub(),
        connect: sinon.stub().throws(new Error('Invalid IP')),
        destroy: sinon.stub(),
      };

      sandbox.stub(net, 'Socket').returns(mockSocket);

      const result = await nodeConnectivityService.checkNodeConnectivity('invalid-ip', 16127, 5000);

      expect(result).to.be.false;
      expect(mockSocket.destroy).to.have.been.called;
    });
  });

  describe('getRandomAppLocation', () => {
    it('should return a random app location when available', async () => {
      const mockLocation = { ip: '192.168.1.1', name: 'testapp', hash: 'testhash' };
      const mockDatabase = {};

      sandbox.stub(dbHelper, 'databaseConnection').returns(mockDatabase);
      sandbox.stub(dbHelper, 'aggregateInDatabase').resolves([mockLocation]);

      const result = await nodeConnectivityService.getRandomAppLocation();

      expect(result).to.deep.equal(mockLocation);
      expect(dbHelper.aggregateInDatabase).to.have.been.calledWith(
        mockDatabase,
        'zelappslocation',
        [
          { $sample: { size: 1 } },
          { $project: { ip: 1, name: 1, hash: 1 } },
        ],
      );
    });

    it('should return null when no locations found', async () => {
      const mockDatabase = {};

      sandbox.stub(dbHelper, 'databaseConnection').returns(mockDatabase);
      sandbox.stub(dbHelper, 'aggregateInDatabase').resolves([]);

      const result = await nodeConnectivityService.getRandomAppLocation();

      expect(result).to.be.null;
    });

    it('should handle database errors gracefully', async () => {
      sandbox.stub(dbHelper, 'databaseConnection').throws(new Error('DB connection failed'));
      sandbox.stub(log, 'error');

      const result = await nodeConnectivityService.getRandomAppLocation();

      expect(result).to.be.null;
      expect(log.error).to.have.been.calledWith('nodeConnectivityService: Error getting random app location: DB connection failed');
    });
  });

  describe('removeAppLocationsByIp', () => {
    it('should remove app locations for given IP', async () => {
      const mockDatabase = {};
      const mockResult = { deletedCount: 5 };

      sandbox.stub(dbHelper, 'databaseConnection').returns(mockDatabase);
      sandbox.stub(dbHelper, 'removeDocumentsFromCollection').resolves(mockResult);
      sandbox.stub(log, 'info');

      const result = await nodeConnectivityService.removeAppLocationsByIp('192.168.1.1');

      expect(result).to.equal(5);
      expect(dbHelper.removeDocumentsFromCollection).to.have.been.calledWith(
        mockDatabase,
        'zelappslocation',
        { ip: '192.168.1.1' },
      );
      expect(log.info).to.have.been.calledWith('nodeConnectivityService: Removed 5 app locations for IP 192.168.1.1');
    });

    it('should handle database errors and return 0', async () => {
      sandbox.stub(dbHelper, 'databaseConnection').throws(new Error('DB error'));
      sandbox.stub(log, 'error');

      const result = await nodeConnectivityService.removeAppLocationsByIp('192.168.1.1');

      expect(result).to.equal(0);
      expect(log.error).to.have.been.calledWith('nodeConnectivityService: Error removing app locations for IP 192.168.1.1: DB error');
    });
  });

  describe('broadcastNodeDownMessage', () => {
    it('should broadcast nodedown message to all peers', async () => {
      const broadcastOutgoingStub = sandbox.stub(fluxCommunicationMessagesSender, 'broadcastMessageToOutgoing').resolves();
      const broadcastIncomingStub = sandbox.stub(fluxCommunicationMessagesSender, 'broadcastMessageToIncoming').resolves();
      sandbox.stub(log, 'info');

      await nodeConnectivityService.broadcastNodeDownMessage('192.168.1.1');

      expect(broadcastOutgoingStub).to.have.been.calledOnce;
      expect(broadcastIncomingStub).to.have.been.calledOnce;

      const expectedMessage = broadcastOutgoingStub.firstCall.args[0];
      expect(expectedMessage).to.have.property('type', 'nodedown');
      expect(expectedMessage).to.have.property('ip', '192.168.1.1');
      expect(expectedMessage).to.have.property('broadcastAt');
      expect(expectedMessage).to.not.have.property('removedCount');
      expect(log.info).to.have.been.calledWith('nodeConnectivityService: Broadcasting nodedown message for IP 192.168.1.1');
    });

    it('should handle broadcast errors gracefully', async () => {
      sandbox.stub(fluxCommunicationMessagesSender, 'broadcastMessageToOutgoing').rejects(new Error('Broadcast failed'));
      sandbox.stub(log, 'error');

      await nodeConnectivityService.broadcastNodeDownMessage('192.168.1.1');

      expect(log.error).to.have.been.calledWith('nodeConnectivityService: Error broadcasting nodedown message for IP 192.168.1.1: Broadcast failed');
    });
  });

  describe('checkNodeWithRetry', () => {
    it('should return true if first check succeeds', async () => {
      sandbox.stub(nodeConnectivityService, 'checkNodeConnectivity').resolves(true);
      sandbox.stub(serviceHelper, 'delay').resolves();
      sandbox.stub(log, 'info');

      const location = { ip: '192.168.1.1' };
      const result = await nodeConnectivityService.checkNodeWithRetry(location);

      expect(result).to.be.true;
      expect(nodeConnectivityService.checkNodeConnectivity).to.have.been.calledOnce;
      expect(nodeConnectivityService.checkNodeConnectivity).to.have.been.calledWith('192.168.1.1', 16127);
      expect(serviceHelper.delay).to.not.have.been.called;
    });

    it('should retry after 5 minutes if first check fails', async () => {
      const checkStub = sandbox.stub(nodeConnectivityService, 'checkNodeConnectivity');
      checkStub.onFirstCall().resolves(false);
      checkStub.onSecondCall().resolves(true);
      sandbox.stub(serviceHelper, 'delay').resolves();
      sandbox.stub(log, 'info');
      sandbox.stub(log, 'warn');

      const location = { ip: '192.168.1.1' };
      const result = await nodeConnectivityService.checkNodeWithRetry(location);

      expect(result).to.be.true;
      expect(nodeConnectivityService.checkNodeConnectivity).to.have.been.calledTwice;
      expect(serviceHelper.delay).to.have.been.calledWith(5 * 60 * 1000);
      expect(log.warn).to.have.been.calledWith('nodeConnectivityService: Node 192.168.1.1 not reachable, waiting 5 minutes for retry');
    });

    it('should return false if both checks fail', async () => {
      sandbox.stub(nodeConnectivityService, 'checkNodeConnectivity').resolves(false);
      sandbox.stub(serviceHelper, 'delay').resolves();
      sandbox.stub(log, 'error');

      const location = { ip: '192.168.1.1' };
      const result = await nodeConnectivityService.checkNodeWithRetry(location);

      expect(result).to.be.false;
      expect(nodeConnectivityService.checkNodeConnectivity).to.have.been.calledTwice;
      expect(log.error).to.have.been.calledWith('nodeConnectivityService: Node 192.168.1.1 confirmed as unreachable after retry');
    });
  });

  describe('performConnectivityCheck', () => {
    it('should skip if already running', async () => {
      // Manually set isServiceRunning to true
      sandbox.stub(log, 'info');

      // Start first check
      const firstPromise = nodeConnectivityService.performConnectivityCheck();

      // Try to start second check immediately
      await nodeConnectivityService.performConnectivityCheck();

      expect(log.info).to.have.been.calledWith('nodeConnectivityService: Connectivity check already running, skipping');

      // Wait for first check to complete
      await firstPromise;
    });

    it('should handle no app locations gracefully', async () => {
      sandbox.stub(nodeConnectivityService, 'getRandomAppLocation').resolves(null);
      sandbox.stub(log, 'info');

      await nodeConnectivityService.performConnectivityCheck();

      expect(log.info).to.have.been.calledWith('nodeConnectivityService: No app locations found in database');
    });

    it('should remove and broadcast when node is unreachable', async () => {
      const mockLocation = { ip: '192.168.1.1' };
      sandbox.stub(nodeConnectivityService, 'getRandomAppLocation').resolves(mockLocation);
      sandbox.stub(nodeConnectivityService, 'checkNodeWithRetry').resolves(false);
      sandbox.stub(nodeConnectivityService, 'removeAppLocationsByIp').resolves(3);
      sandbox.stub(nodeConnectivityService, 'broadcastNodeDownMessage').resolves();

      await nodeConnectivityService.performConnectivityCheck();

      expect(nodeConnectivityService.removeAppLocationsByIp).to.have.been.calledWith('192.168.1.1');
      expect(nodeConnectivityService.broadcastNodeDownMessage).to.have.been.calledWith('192.168.1.1');
    });

    it('should not broadcast if no apps were removed', async () => {
      const mockLocation = { ip: '192.168.1.1' };
      sandbox.stub(nodeConnectivityService, 'getRandomAppLocation').resolves(mockLocation);
      sandbox.stub(nodeConnectivityService, 'checkNodeWithRetry').resolves(false);
      sandbox.stub(nodeConnectivityService, 'removeAppLocationsByIp').resolves(0);
      sandbox.stub(nodeConnectivityService, 'broadcastNodeDownMessage').resolves();

      await nodeConnectivityService.performConnectivityCheck();

      expect(nodeConnectivityService.broadcastNodeDownMessage).to.not.have.been.called;
    });

    it('should handle errors gracefully', async () => {
      sandbox.stub(nodeConnectivityService, 'getRandomAppLocation').rejects(new Error('DB error'));
      sandbox.stub(log, 'error');

      await nodeConnectivityService.performConnectivityCheck();

      expect(log.error).to.have.been.calledWith('nodeConnectivityService: Error during connectivity check: DB error');
    });
  });

  describe('service lifecycle', () => {
    it('should start monitoring service', (done) => {
      sandbox.stub(nodeConnectivityService, 'performConnectivityCheck').resolves();
      sandbox.stub(log, 'info');

      nodeConnectivityService.startConnectivityMonitoring();

      // Give time for setImmediate to execute
      setTimeout(() => {
        const status = nodeConnectivityService.getServiceStatus();
        expect(status.isRunning).to.be.true;
        expect(nodeConnectivityService.performConnectivityCheck).to.have.been.called;
        expect(log.info).to.have.been.calledWith('nodeConnectivityService: Starting connectivity monitoring service (10-minute intervals)');
        done();
      }, 10);
    });

    it('should not start if already running', () => {
      sandbox.stub(log, 'warn');

      nodeConnectivityService.startConnectivityMonitoring();
      nodeConnectivityService.startConnectivityMonitoring(); // Try to start again

      expect(log.warn).to.have.been.calledWith('nodeConnectivityService: Service already running');
    });

    it('should stop monitoring service', () => {
      sandbox.stub(log, 'info');

      nodeConnectivityService.startConnectivityMonitoring();
      nodeConnectivityService.stopConnectivityMonitoring();

      const status = nodeConnectivityService.getServiceStatus();
      expect(status.isRunning).to.be.false;
      expect(log.info).to.have.been.calledWith('nodeConnectivityService: Connectivity monitoring service stopped');
    });

    it('should handle stop when not running', () => {
      nodeConnectivityService.stopConnectivityMonitoring();
      // Should not throw error
      expect(nodeConnectivityService.getServiceStatus().isRunning).to.be.false;
    });
  });

  describe('getServiceStatus', () => {
    it('should return correct status', () => {
      const status1 = nodeConnectivityService.getServiceStatus();
      expect(status1).to.deep.equal({
        isRunning: false,
        isPerformingCheck: false,
      });

      nodeConnectivityService.startConnectivityMonitoring();
      const status2 = nodeConnectivityService.getServiceStatus();
      expect(status2.isRunning).to.be.true;
    });
  });
});
