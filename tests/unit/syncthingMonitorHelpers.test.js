// Set NODE_CONFIG_DIR before any requires
process.env.NODE_CONFIG_DIR = `${process.cwd()}/tests/unit/globalconfig`;

const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const helpers = require('../../ZelBack/src/services/appMonitoring/syncthingMonitorHelpers');

describe('syncthingMonitorHelpers tests', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('sortAndFilterLocations', () => {
    it('should sort locations by IP address', () => {
      const locations = [
        { ip: '10.0.0.3:16127' },
        { ip: '10.0.0.1:16127' },
        { ip: '10.0.0.2:16127' },
      ];
      const myIP = '10.0.0.4:16127';

      const result = helpers.sortAndFilterLocations(locations, myIP);

      expect(result).to.have.lengthOf(3);
      expect(result[0].ip).to.equal('10.0.0.1:16127');
      expect(result[1].ip).to.equal('10.0.0.2:16127');
      expect(result[2].ip).to.equal('10.0.0.3:16127');
    });

    it('should filter out current node IP', () => {
      const locations = [
        { ip: '10.0.0.1:16127' },
        { ip: '10.0.0.2:16127' },
        { ip: '10.0.0.3:16127' },
      ];
      const myIP = '10.0.0.2:16127';

      const result = helpers.sortAndFilterLocations(locations, myIP);

      expect(result).to.have.lengthOf(2);
      expect(result.find((loc) => loc.ip === myIP)).to.be.undefined;
    });

    it('should handle empty locations', () => {
      const result = helpers.sortAndFilterLocations([], '10.0.0.1:16127');
      expect(result).to.be.an('array').that.is.empty;
    });
  });

  describe('getContainerDataFlags', () => {
    it('should extract flags from container string with flags', () => {
      const container = 'sr:/data';
      const result = helpers.getContainerDataFlags(container);
      expect(result).to.equal('sr');
    });

    it('should return empty string for container without flags', () => {
      const container = '/data';
      const result = helpers.getContainerDataFlags(container);
      expect(result).to.equal('');
    });

    it('should handle container with only path', () => {
      const container = 'nocolon';
      const result = helpers.getContainerDataFlags(container);
      expect(result).to.equal('');
    });
  });

  describe('requiresSyncing', () => {
    it('should return true for s flag', () => {
      expect(helpers.requiresSyncing('s')).to.be.true;
    });

    it('should return true for r flag', () => {
      expect(helpers.requiresSyncing('r')).to.be.true;
    });

    it('should return true for g flag', () => {
      expect(helpers.requiresSyncing('g')).to.be.true;
    });

    it('should return true for combined flags', () => {
      expect(helpers.requiresSyncing('srg')).to.be.true;
      expect(helpers.requiresSyncing('sr')).to.be.true;
    });

    it('should return false for no sync flags', () => {
      expect(helpers.requiresSyncing('w')).to.be.false;
      expect(helpers.requiresSyncing('')).to.be.false;
      expect(helpers.requiresSyncing('xyz')).to.be.false;
    });
  });

  describe('getContainerFolderPath', () => {
    it('should return empty string for first container', () => {
      const containersData = ['/data', 'r:/config'];
      const result = helpers.getContainerFolderPath(containersData, 0);
      expect(result).to.equal('');
    });

    it('should return correct path for subsequent containers', () => {
      const containersData = ['/data', 'r:/data/config'];
      const result = helpers.getContainerFolderPath(containersData, 1);
      expect(result).to.equal('/appdata/config');
    });

    it('should handle multiple nested paths', () => {
      const containersData = ['/app', 'r:/app/data/sub'];
      const result = helpers.getContainerFolderPath(containersData, 1);
      expect(result).to.equal('/appdata/data/sub');
    });
  });

  describe('createSyncthingFolderConfig', () => {
    it('should create folder config with correct defaults', () => {
      const devices = [{ deviceID: 'ABC123' }];
      const result = helpers.createSyncthingFolderConfig(
        'test-id',
        'test-label',
        '/path/to/folder',
        devices,
      );

      expect(result).to.deep.include({
        id: 'test-id',
        label: 'test-label',
        path: '/path/to/folder',
        paused: false,
        type: 'sendreceive',
        rescanIntervalS: 900,
        maxConflicts: 0,
      });
      expect(result.devices).to.deep.equal(devices);
    });

    it('should allow custom type', () => {
      const devices = [{ deviceID: 'ABC123' }];
      const result = helpers.createSyncthingFolderConfig(
        'test-id',
        'test-label',
        '/path/to/folder',
        devices,
        'receiveonly',
      );

      expect(result.type).to.equal('receiveonly');
    });
  });

  describe('folderNeedsUpdate', () => {
    it('should return true if folder does not exist', () => {
      const newFolder = { type: 'sendreceive' };
      const result = helpers.folderNeedsUpdate(null, newFolder);
      expect(result).to.be.true;
    });

    it('should return true if maxConflicts differs', () => {
      const existing = {
        maxConflicts: 5, paused: false, type: 'sendreceive', devices: [],
      };
      const newFolder = {
        maxConflicts: 0, paused: false, type: 'sendreceive', devices: [],
      };
      const result = helpers.folderNeedsUpdate(existing, newFolder);
      expect(result).to.be.true;
    });

    it('should return true if paused status differs', () => {
      const existing = {
        maxConflicts: 0, paused: true, type: 'sendreceive', devices: [],
      };
      const newFolder = {
        maxConflicts: 0, paused: false, type: 'sendreceive', devices: [],
      };
      const result = helpers.folderNeedsUpdate(existing, newFolder);
      expect(result).to.be.true;
    });

    it('should return true if type differs', () => {
      const existing = {
        maxConflicts: 0, paused: false, type: 'receiveonly', devices: [],
      };
      const newFolder = {
        maxConflicts: 0, paused: false, type: 'sendreceive', devices: [],
      };
      const result = helpers.folderNeedsUpdate(existing, newFolder);
      expect(result).to.be.true;
    });

    it('should return true if devices differ', () => {
      const existing = {
        maxConflicts: 0,
        paused: false,
        type: 'sendreceive',
        devices: [{ deviceID: 'ABC' }],
      };
      const newFolder = {
        maxConflicts: 0,
        paused: false,
        type: 'sendreceive',
        devices: [{ deviceID: 'XYZ' }],
      };
      const result = helpers.folderNeedsUpdate(existing, newFolder);
      expect(result).to.be.true;
    });

    it('should return false if everything matches', () => {
      const devices = [{ deviceID: 'ABC' }];
      const existing = {
        maxConflicts: 0,
        paused: false,
        type: 'sendreceive',
        devices,
      };
      const newFolder = {
        maxConflicts: 0,
        paused: false,
        type: 'sendreceive',
        devices,
      };
      const result = helpers.folderNeedsUpdate(existing, newFolder);
      expect(result).to.be.false;
    });
  });

  describe('sortRunningAppList', () => {
    it('should sort by runningSince first', () => {
      const appList = [
        { ip: '10.0.0.1', runningSince: 2000, broadcastedAt: 1000 },
        { ip: '10.0.0.2', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.3', runningSince: 1000, broadcastedAt: 1000 },
      ];

      const result = helpers.sortRunningAppList(appList);

      // Null runningSince should come first, then sorted by runningSince
      expect(result[0].ip).to.equal('10.0.0.2');
      expect(result[1].ip).to.equal('10.0.0.3');
      expect(result[2].ip).to.equal('10.0.0.1');
    });

    it('should use broadcastedAt as tiebreaker', () => {
      const appList = [
        { ip: '10.0.0.1', runningSince: null, broadcastedAt: 2000 },
        { ip: '10.0.0.2', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.3', runningSince: null, broadcastedAt: 3000 },
      ];

      const result = helpers.sortRunningAppList(appList);

      expect(result[0].broadcastedAt).to.equal(1000);
      expect(result[1].broadcastedAt).to.equal(2000);
      expect(result[2].broadcastedAt).to.equal(3000);
    });

    it('should use IP as final tiebreaker', () => {
      const appList = [
        { ip: '10.0.0.3', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.1', runningSince: null, broadcastedAt: 1000 },
        { ip: '10.0.0.2', runningSince: null, broadcastedAt: 1000 },
      ];

      const result = helpers.sortRunningAppList(appList);

      expect(result[0].ip).to.equal('10.0.0.1');
      expect(result[1].ip).to.equal('10.0.0.2');
      expect(result[2].ip).to.equal('10.0.0.3');
    });
  });

  describe('getDeviceID', () => {
    it('should return device ID on successful response', async () => {
      const axiosStub = sandbox.stub(axios, 'get').resolves({
        data: { status: 'success', data: 'DEVICE-ID-123' },
      });

      const result = await helpers.getDeviceID('10.0.0.1:16127');

      expect(result).to.equal('DEVICE-ID-123');
      expect(axiosStub.calledOnce).to.be.true;
    });

    it('should return null on error', async () => {
      sandbox.stub(axios, 'get').rejects(new Error('Network error'));

      const result = await helpers.getDeviceID('10.0.0.1:16127');

      expect(result).to.be.null;
    });

    it('should return null on non-success status', async () => {
      sandbox.stub(axios, 'get').resolves({
        data: { status: 'error', data: null },
      });

      const result = await helpers.getDeviceID('10.0.0.1:16127');

      expect(result).to.be.null;
    });

    it('should retry on failure when retries specified', async () => {
      const axiosStub = sandbox.stub(axios, 'get');
      axiosStub.onFirstCall().rejects(new Error('Network error'));
      axiosStub.onSecondCall().resolves({
        data: { status: 'success', data: 'DEVICE-ID-123' },
      });

      const result = await helpers.getDeviceID('10.0.0.1:16127', 1);

      expect(result).to.equal('DEVICE-ID-123');
      expect(axiosStub.callCount).to.equal(2);
    });
  });

  describe('getDeviceIDCached', () => {
    it('should return cached value if available', async () => {
      const cache = new Map();
      cache.set('10.0.0.1:16127', 'CACHED-DEVICE-ID');

      const result = await helpers.getDeviceIDCached('10.0.0.1:16127', cache);

      expect(result).to.equal('CACHED-DEVICE-ID');
    });

    it('should fetch and cache if not available', async () => {
      const cache = new Map();
      sandbox.stub(axios, 'get').resolves({
        data: { status: 'success', data: 'NEW-DEVICE-ID' },
      });

      const result = await helpers.getDeviceIDCached('10.0.0.1:16127', cache);

      expect(result).to.equal('NEW-DEVICE-ID');
      expect(cache.get('10.0.0.1:16127')).to.equal('NEW-DEVICE-ID');
    });

    it('should not cache on failure', async () => {
      const cache = new Map();
      sandbox.stub(axios, 'get').rejects(new Error('Network error'));

      const result = await helpers.getDeviceIDCached('10.0.0.1:16127', cache);

      expect(result).to.be.null;
      expect(cache.has('10.0.0.1:16127')).to.be.false;
    });
  });
});
