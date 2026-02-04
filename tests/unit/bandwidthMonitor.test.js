const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('bandwidthMonitor tests', () => {
  let bandwidthMonitor;
  let logStub;
  let serviceHelperStub;
  let dockerServiceStub;
  let benchmarkServiceStub;
  let generalServiceStub;
  let cmdAsyncStub;
  let decryptEnterpriseAppsStub;
  let configStub;
  let registryManagerStub;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub(),
    };

    serviceHelperStub = {
      runCommand: sinon.stub().resolves({ error: null, stdout: '', stderr: '' }),
    };

    dockerServiceStub = {
      dockerContainerInspect: sinon.stub(),
    };

    benchmarkServiceStub = {
      getBenchmarkFromDb: sinon.stub(),
    };

    generalServiceStub = {
      getNewNodeTier: sinon.stub().resolves('cumulus'),
    };

    decryptEnterpriseAppsStub = sinon.stub().returnsArg(0);

    cmdAsyncStub = sinon.stub().resolves('');

    configStub = {
      enterpriseAppOwners: ['enterpriseOwner123'],
    };

    registryManagerStub = {
      getApplicationOwner: sinon.stub().resolves(null),
    };

    bandwidthMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/bandwidthMonitor', {
      '../../lib/log': logStub,
      '../serviceHelper': serviceHelperStub,
      '../dockerService': dockerServiceStub,
      '../benchmarkService': benchmarkServiceStub,
      '../generalService': generalServiceStub,
      '../appQuery/appQueryService': {
        decryptEnterpriseApps: decryptEnterpriseAppsStub,
      },
      '../appDatabase/registryManager': registryManagerStub,
      config: configStub,
      'node-cmd': {
        run: (cmd, callback) => {
          cmdAsyncStub(cmd).then((result) => callback(null, result, '')).catch((err) => callback(err));
        },
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getNodeBandwidth', () => {
    it('should return bandwidth from benchmark data when available', async () => {
      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: {
          download_speed: '100.5',
          upload_speed: '50.25',
        },
      });

      const result = await bandwidthMonitor.getNodeBandwidth();

      expect(result.download).to.equal(100.5);
      expect(result.upload).to.equal(50.25);
    });

    it('should fallback to tier minimums when benchmark data is unavailable', async () => {
      benchmarkServiceStub.getBenchmarkFromDb.resolves({ benchmark: null });
      generalServiceStub.getNewNodeTier.resolves('nimbus');

      const result = await bandwidthMonitor.getNodeBandwidth();

      expect(result.download).to.equal(50); // Nimbus minimum
      expect(result.upload).to.equal(50);
    });

    it('should fallback to cumulus minimum on error', async () => {
      benchmarkServiceStub.getBenchmarkFromDb.rejects(new Error('DB error'));

      const result = await bandwidthMonitor.getNodeBandwidth();

      expect(result.download).to.equal(25); // Cumulus minimum
      expect(result.upload).to.equal(25);
    });

    it('should use stratus minimum for stratus tier', async () => {
      benchmarkServiceStub.getBenchmarkFromDb.resolves({ benchmark: null });
      generalServiceStub.getNewNodeTier.resolves('stratus');

      const result = await bandwidthMonitor.getNodeBandwidth();

      expect(result.download).to.equal(100);
      expect(result.upload).to.equal(100);
    });
  });

  describe('getFairShareBandwidth', () => {
    it('should calculate fair share correctly', async () => {
      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: {
          download_speed: '100',
          upload_speed: '100',
        },
      });

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [
          { name: 'App1', version: 3 },
          { name: 'App2', version: 3 },
          { name: 'App3', version: 3 },
          { name: 'App4', version: 3 },
        ],
      });

      const result = await bandwidthMonitor.getFairShareBandwidth(mockInstalledApps);

      // Total: 100 Mbps, 20% reserve = 80 Mbps available, 4 apps = 20 Mbps each
      expect(result.total).to.equal(100);
      expect(result.available).to.equal(80);
      expect(result.download).to.equal(20); // fairShare is returned as download/upload
      expect(result.runningApps).to.equal(4);
    });

    it('should count compose app components separately', async () => {
      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: {
          download_speed: '100',
          upload_speed: '100',
        },
      });

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [
          { name: 'App1', version: 3 }, // 1 container
          {
            name: 'App2',
            version: 4,
            compose: [
              { name: 'frontend' },
              { name: 'backend' },
              { name: 'database' },
            ],
          }, // 3 containers
        ],
      });

      const result = await bandwidthMonitor.getFairShareBandwidth(mockInstalledApps);

      // 1 + 3 = 4 containers
      expect(result.runningApps).to.equal(4);
      expect(result.download).to.equal(20); // 80 / 4
    });

    it('should use minimum of download/upload as total', async () => {
      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: {
          download_speed: '100',
          upload_speed: '50', // Lower upload
        },
      });

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: 'App1', version: 3 }],
      });

      const result = await bandwidthMonitor.getFairShareBandwidth(mockInstalledApps);

      expect(result.total).to.equal(50); // Uses lower value
    });

    it('should default to 1 app when no apps running', async () => {
      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: {
          download_speed: '100',
          upload_speed: '100',
        },
      });

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [],
      });

      const result = await bandwidthMonitor.getFairShareBandwidth(mockInstalledApps);

      expect(result.runningApps).to.equal(1); // Avoid division by zero
      expect(result.download).to.equal(80); // All available bandwidth
    });
  });

  describe('calculateBandwidthFromStats', () => {
    it('should calculate bandwidth correctly from stats samples', () => {
      const statsArray = [
        {
          timestamp: 1000,
          data: {
            networks: {
              eth0: { rx_bytes: 0, tx_bytes: 0 },
            },
          },
        },
        {
          timestamp: 61000, // 60 seconds later
          data: {
            networks: {
              eth0: { rx_bytes: 7500000, tx_bytes: 2500000 }, // 7.5MB rx, 2.5MB tx
            },
          },
        },
      ];

      const result = bandwidthMonitor.calculateBandwidthFromStats(statsArray);

      expect(result).to.have.length(1);
      // 7.5MB / 60s = 125000 bytes/sec = 1 Mbps
      expect(result[0].downloadMbps).to.equal(1);
      // 2.5MB / 60s = ~41666 bytes/sec = ~0.333 Mbps
      expect(result[0].uploadMbps).to.be.closeTo(0.333, 0.01);
    });

    it('should handle multiple network interfaces', () => {
      const statsArray = [
        {
          timestamp: 1000,
          data: {
            networks: {
              eth0: { rx_bytes: 0, tx_bytes: 0 },
              eth1: { rx_bytes: 0, tx_bytes: 0 },
            },
          },
        },
        {
          timestamp: 61000,
          data: {
            networks: {
              eth0: { rx_bytes: 3750000, tx_bytes: 1250000 },
              eth1: { rx_bytes: 3750000, tx_bytes: 1250000 },
            },
          },
        },
      ];

      const result = bandwidthMonitor.calculateBandwidthFromStats(statsArray);

      // Combined: 7.5MB rx, 2.5MB tx
      expect(result[0].downloadMbps).to.equal(1);
      expect(result[0].uploadMbps).to.be.closeTo(0.333, 0.01);
    });

    it('should return empty array for insufficient samples', () => {
      expect(bandwidthMonitor.calculateBandwidthFromStats(null)).to.deep.equal([]);
      expect(bandwidthMonitor.calculateBandwidthFromStats([])).to.deep.equal([]);
      expect(bandwidthMonitor.calculateBandwidthFromStats([{ timestamp: 1000 }])).to.deep.equal([]);
    });

    it('should skip samples with negative byte delta (counter reset)', () => {
      const statsArray = [
        {
          timestamp: 1000,
          data: {
            networks: {
              eth0: { rx_bytes: 1000000, tx_bytes: 500000 },
            },
          },
        },
        {
          timestamp: 61000,
          data: {
            networks: {
              eth0: { rx_bytes: 100, tx_bytes: 50 }, // Counter reset
            },
          },
        },
      ];

      const result = bandwidthMonitor.calculateBandwidthFromStats(statsArray);

      expect(result).to.have.length(0); // Skipped due to negative delta
    });

    it('should handle missing networks object gracefully', () => {
      const statsArray = [
        {
          timestamp: 1000,
          data: {},
        },
        {
          timestamp: 61000,
          data: {},
        },
      ];

      const result = bandwidthMonitor.calculateBandwidthFromStats(statsArray);

      expect(result[0].downloadMbps).to.equal(0);
      expect(result[0].uploadMbps).to.equal(0);
    });
  });

  describe('getAppBandwidthStats', () => {
    it('should return bandwidth statistics when data is available', () => {
      const appsMonitored = {
        testApp: {
          lastHourstatsStore: [
            {
              timestamp: 1000,
              data: { networks: { eth0: { rx_bytes: 0, tx_bytes: 0 } } },
            },
            {
              timestamp: 61000,
              data: { networks: { eth0: { rx_bytes: 7500000, tx_bytes: 2500000 } } },
            },
            {
              timestamp: 121000,
              data: { networks: { eth0: { rx_bytes: 15000000, tx_bytes: 5000000 } } },
            },
          ],
        },
      };

      const result = bandwidthMonitor.getAppBandwidthStats('testApp', appsMonitored);

      expect(result.available).to.be.true;
      expect(result.current).to.have.property('download');
      expect(result.current).to.have.property('upload');
      expect(result.average).to.have.property('download');
      expect(result.max).to.have.property('download');
      expect(result.sampleCount).to.equal(2);
    });

    it('should return unavailable when no stats exist', () => {
      const appsMonitored = {};

      const result = bandwidthMonitor.getAppBandwidthStats('testApp', appsMonitored);

      expect(result.available).to.be.false;
      expect(result.message).to.equal('Not enough data');
    });

    it('should return unavailable when insufficient samples', () => {
      const appsMonitored = {
        testApp: {
          lastHourstatsStore: [
            {
              timestamp: 1000,
              data: { networks: { eth0: { rx_bytes: 0, tx_bytes: 0 } } },
            },
          ],
        },
      };

      const result = bandwidthMonitor.getAppBandwidthStats('testApp', appsMonitored);

      expect(result.available).to.be.false;
    });

    it('should include throttle info when app is throttled', () => {
      const appsMonitored = {
        testApp: {
          lastHourstatsStore: [
            {
              timestamp: 1000,
              data: { networks: { eth0: { rx_bytes: 0, tx_bytes: 0 } } },
            },
            {
              timestamp: 61000,
              data: { networks: { eth0: { rx_bytes: 7500000, tx_bytes: 2500000 } } },
            },
          ],
        },
      };

      const result = bandwidthMonitor.getAppBandwidthStats('testApp', appsMonitored);

      expect(result).to.have.property('throttled');
      expect(result).to.have.property('throttleLimit');
      expect(result).to.have.property('violationCount');
    });
  });

  describe('getBandwidthThrottleStatus', () => {
    it('should return current throttle status', () => {
      const result = bandwidthMonitor.getBandwidthThrottleStatus();

      expect(result).to.have.property('throttledApps');
      expect(result).to.have.property('violations');
    });
  });

  describe('getContainerVethInterface', () => {
    it('should return null when container inspect fails', async () => {
      dockerServiceStub.dockerContainerInspect.resolves(null);

      const result = await bandwidthMonitor.getContainerVethInterface('testContainer');

      expect(result).to.be.null;
    });

    it('should return null when container PID is 0 (not running)', async () => {
      dockerServiceStub.dockerContainerInspect.resolves({
        State: { Pid: 0 },
      });

      const result = await bandwidthMonitor.getContainerVethInterface('testContainer');

      expect(result).to.be.null;
      expect(logStub.warn.calledWith(sinon.match(/not running/))).to.be.true;
    });

    it('should extract veth interface from nsenter command', async () => {
      dockerServiceStub.dockerContainerInspect.resolves({
        State: { Pid: 12345 },
      });

      cmdAsyncStub.onFirstCall().resolves('5'); // Interface index
      cmdAsyncStub.onSecondCall().resolves('veth1234abc'); // Host veth name

      const result = await bandwidthMonitor.getContainerVethInterface('testContainer');

      expect(result).to.equal('veth1234abc');
    });

    it('should return null when interface index not found', async () => {
      dockerServiceStub.dockerContainerInspect.resolves({
        State: { Pid: 12345 },
      });

      cmdAsyncStub.resolves(''); // Empty result

      const result = await bandwidthMonitor.getContainerVethInterface('testContainer');

      expect(result).to.be.null;
    });
  });

  describe('applyBandwidthThrottle', () => {
    it('should return false when veth interface not found', async () => {
      dockerServiceStub.dockerContainerInspect.resolves(null);

      const result = await bandwidthMonitor.applyBandwidthThrottle('testContainer', 20);

      expect(result).to.be.false;
      expect(logStub.error.called).to.be.true;
    });

    it('should apply tc rules when veth interface is found', async () => {
      dockerServiceStub.dockerContainerInspect.resolves({
        State: { Pid: 12345 },
      });
      cmdAsyncStub.onFirstCall().resolves('5');
      cmdAsyncStub.onSecondCall().resolves('veth1234');
      serviceHelperStub.runCommand.resolves({ error: null });

      const result = await bandwidthMonitor.applyBandwidthThrottle('testContainer', 20);

      expect(result).to.be.true;
      expect(serviceHelperStub.runCommand.calledWith('tc', sinon.match({
        runAsRoot: true,
        params: sinon.match.array.contains(['qdisc', 'add', 'dev', 'veth1234']),
      }))).to.be.true;
      expect(logStub.info.calledWith(sinon.match(/Applied bandwidth throttle/))).to.be.true;
    });

    it('should return false when tc command fails', async () => {
      dockerServiceStub.dockerContainerInspect.resolves({
        State: { Pid: 12345 },
      });
      cmdAsyncStub.onFirstCall().resolves('5');
      cmdAsyncStub.onSecondCall().resolves('veth1234');
      serviceHelperStub.runCommand.resolves({ error: new Error('tc failed') });

      const result = await bandwidthMonitor.applyBandwidthThrottle('testContainer', 20);

      expect(result).to.be.false;
      expect(logStub.error.calledWith(sinon.match(/Failed to apply egress throttle/))).to.be.true;
    });
  });

  describe('removeBandwidthThrottle', () => {
    it('should return true when container is not throttled', async () => {
      const result = await bandwidthMonitor.removeBandwidthThrottle('nonThrottledContainer');

      expect(result).to.be.true;
    });
  });

  describe('checkApplicationsBandwidthUsage', () => {
    it('should skip containers with insufficient stats', async () => {
      const appsMonitored = {
        testApp: {
          lastHourstatsStore: [
            { timestamp: 1000, data: { networks: {} } },
          ],
        },
      };

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: 'testApp', version: 3 }],
      });

      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: { download_speed: '100', upload_speed: '100' },
      });

      await bandwidthMonitor.checkApplicationsBandwidthUsage(appsMonitored, mockInstalledApps);

      // Should not throw, just skip due to insufficient samples
      expect(logStub.info.calledWith(sinon.match(/Bandwidth check - Total/))).to.be.true;
    });

    it('should handle failed installed apps call', async () => {
      const appsMonitored = {};

      const mockInstalledApps = sinon.stub().resolves({
        status: 'error',
        data: { message: 'Failed' },
      });

      await bandwidthMonitor.checkApplicationsBandwidthUsage(appsMonitored, mockInstalledApps);

      expect(logStub.error.calledWith(sinon.match(/checkApplicationsBandwidthUsage error/))).to.be.true;
    });

    it('should process v3 apps correctly', async () => {
      const appsMonitored = {
        testApp: {
          lastHourstatsStore: generateStatsWithHighBandwidth(10),
        },
      };

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: 'testApp', version: 3 }],
      });

      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: { download_speed: '100', upload_speed: '100' },
      });

      await bandwidthMonitor.checkApplicationsBandwidthUsage(appsMonitored, mockInstalledApps);

      expect(logStub.info.calledWith(sinon.match(/Bandwidth check testApp/))).to.be.true;
    });

    it('should process compose apps (v4+) correctly', async () => {
      const appsMonitored = {
        frontend_testApp: {
          lastHourstatsStore: generateStatsWithHighBandwidth(10),
        },
        backend_testApp: {
          lastHourstatsStore: generateStatsWithHighBandwidth(10),
        },
      };

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [{
          name: 'testApp',
          version: 4,
          compose: [
            { name: 'frontend' },
            { name: 'backend' },
          ],
        }],
      });

      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: { download_speed: '100', upload_speed: '100' },
      });

      await bandwidthMonitor.checkApplicationsBandwidthUsage(appsMonitored, mockInstalledApps);

      expect(logStub.info.calledWith(sinon.match(/Bandwidth check frontend_testApp/))).to.be.true;
      expect(logStub.info.calledWith(sinon.match(/Bandwidth check backend_testApp/))).to.be.true;
    });

    it('should skip enterprise apps from bandwidth throttling', async () => {
      const appsMonitored = {
        enterpriseApp: {
          lastHourstatsStore: [
            { timestamp: 1000, data: { networks: { eth0: { rx_bytes: 1000000, tx_bytes: 1000000 } } } },
            { timestamp: 61000, data: { networks: { eth0: { rx_bytes: 2000000, tx_bytes: 2000000 } } } },
            { timestamp: 121000, data: { networks: { eth0: { rx_bytes: 3000000, tx_bytes: 3000000 } } } },
            { timestamp: 181000, data: { networks: { eth0: { rx_bytes: 4000000, tx_bytes: 4000000 } } } },
            { timestamp: 241000, data: { networks: { eth0: { rx_bytes: 5000000, tx_bytes: 5000000 } } } },
          ],
        },
      };

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: 'enterpriseApp', version: 3 }],
      });

      // Set up enterprise app owner
      registryManagerStub.getApplicationOwner.withArgs('enterpriseApp').resolves('enterpriseOwner123');

      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: { download_speed: '100', upload_speed: '100' },
      });

      await bandwidthMonitor.checkApplicationsBandwidthUsage(appsMonitored, mockInstalledApps);

      // Should log that enterprise app is skipped
      expect(logStub.debug.calledWith(sinon.match(/Skipping bandwidth throttle check for enterprise app: enterpriseApp/))).to.be.true;
      // Should NOT check bandwidth for the enterprise app
      expect(logStub.info.calledWith(sinon.match(/Bandwidth check enterpriseApp/))).to.be.false;
    });

    it('should process non-enterprise apps normally', async () => {
      const appsMonitored = {
        regularApp: {
          lastHourstatsStore: [
            { timestamp: 1000, data: { networks: { eth0: { rx_bytes: 1000000, tx_bytes: 1000000 } } } },
            { timestamp: 61000, data: { networks: { eth0: { rx_bytes: 2000000, tx_bytes: 2000000 } } } },
            { timestamp: 121000, data: { networks: { eth0: { rx_bytes: 3000000, tx_bytes: 3000000 } } } },
            { timestamp: 181000, data: { networks: { eth0: { rx_bytes: 4000000, tx_bytes: 4000000 } } } },
            { timestamp: 241000, data: { networks: { eth0: { rx_bytes: 5000000, tx_bytes: 5000000 } } } },
          ],
        },
      };

      const mockInstalledApps = sinon.stub().resolves({
        status: 'success',
        data: [{ name: 'regularApp', version: 3 }],
      });

      // Non-enterprise owner
      registryManagerStub.getApplicationOwner.withArgs('regularApp').resolves('regularOwner456');

      benchmarkServiceStub.getBenchmarkFromDb.resolves({
        benchmark: { download_speed: '100', upload_speed: '100' },
      });

      await bandwidthMonitor.checkApplicationsBandwidthUsage(appsMonitored, mockInstalledApps);

      // Should NOT skip this app
      expect(logStub.debug.calledWith(sinon.match(/Skipping bandwidth throttle check for enterprise app/))).to.be.false;
      // Should check bandwidth for the regular app
      expect(logStub.info.calledWith(sinon.match(/Bandwidth check regularApp/))).to.be.true;
    });
  });

  describe('cleanupContainerBandwidth', () => {
    it('should not throw when container is not tracked', async () => {
      await bandwidthMonitor.cleanupContainerBandwidth('unknownContainer');

      // Should complete without error
    });
  });

  describe('exported constants', () => {
    it('should export TIER_MINIMUM_BANDWIDTH', () => {
      expect(bandwidthMonitor.TIER_MINIMUM_BANDWIDTH).to.deep.equal({
        cumulus: 25,
        nimbus: 50,
        stratus: 100,
      });
    });

    it('should export THROTTLE_LEVELS', () => {
      expect(bandwidthMonitor.THROTTLE_LEVELS).to.deep.equal([1.0, 0.95, 0.90, 0.85, 0.80]);
    });
  });
});

// Helper function to generate stats with high bandwidth usage
function generateStatsWithHighBandwidth(count) {
  const stats = [];
  let rxBytes = 0;
  let txBytes = 0;

  for (let i = 0; i < count; i += 1) {
    // Add 50MB per minute (very high usage - ~6.67 Mbps)
    rxBytes += 50000000;
    txBytes += 25000000;

    stats.push({
      timestamp: 1000 + (i * 60000), // 1 minute intervals
      data: {
        networks: {
          eth0: { rx_bytes: rxBytes, tx_bytes: txBytes },
        },
      },
    });
  }

  return stats;
}
