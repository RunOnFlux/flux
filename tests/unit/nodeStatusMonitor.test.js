const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('nodeStatusMonitor tests', () => {
  let nodeStatusMonitor;
  let logStub;

  beforeEach(() => {
    logStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    };

    nodeStatusMonitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
      axios: {
        get: sinon.stub().resolves({ data: { status: 'success' } }),
        CancelToken: {
          source: sinon.stub().returns({
            token: 'token',
            cancel: sinon.stub(),
          }),
        },
      },
      config: {
        database: {
          appsglobal: {
            database: 'globalapps',
            collections: {
              appsLocations: 'appsLocations',
            },
          },
        },
      },
      '../dbHelper': {
        databaseConnection: sinon.stub(),
        distinctDatabase: sinon.stub(),
        removeDocumentsFromCollection: sinon.stub(),
      },
      '../serviceHelper': {
        delay: sinon.stub().resolves(),
      },
      '../generalService': {
        isNodeStatusConfirmed: sinon.stub().resolves(true),
      },
      '../fluxNetworkHelper': {
        getDosStateValue: sinon.stub().returns(0),
      },
      '../fluxCommunicationUtils': {
        socketAddressInFluxList: sinon.stub().resolves(true),
      },
      '../../lib/log': logStub,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('monitorNodeStatus', () => {
    it('should be exported as a function', () => {
      expect(nodeStatusMonitor.monitorNodeStatus).to.be.a('function');
    });

    // Note: This is a recursive monitoring function with complex business logic
    // Full testing would require integration tests or extensive mocking
  });

  describe('initialize', () => {
    let listeners;
    let monitor;

    beforeEach(() => {
      listeners = {};
      monitor = proxyquire('../../ZelBack/src/services/appMonitoring/nodeStatusMonitor', {
        '../dbHelper': {},
        '../serviceHelper': { delay: sinon.stub().resolves() },
        '../fluxNetworkHelper': {},
        '../fluxCommunicationUtils': {},
        '../appMessaging/messageStore': {},
        '../networkStateService': {},
        '../nodeConfirmationService': {
          onConfirmationChange: (cb) => { listeners.confirmation = cb; },
          onDaemonStale: (cb) => { listeners.daemonStale = cb; },
          canSendMessages: () => true,
        },
        '../../lib/log': logStub,
      });
    });

    // Nothing awaits a listener's removal: a read that fails there is logged,
    // never left to escape as an unhandled rejection that exits FluxOS.
    it('logs a removal whose installed-apps read fails when confirmation is lost', async () => {
      const installedAppsFn = sinon.stub().rejects(new Error('connection timed out'));
      const removeAppLocallyFn = sinon.stub();
      monitor.initialize(installedAppsFn, removeAppLocallyFn);

      listeners.confirmation(false);
      await new Promise((resolve) => { setImmediate(resolve); });

      sinon.assert.calledOnce(installedAppsFn);
      sinon.assert.notCalled(removeAppLocallyFn);
      sinon.assert.calledWithMatch(logStub.error, /node lost confirmation\) failed: connection timed out/);
    });

    it('logs a removal whose installed-apps read fails when the daemon goes stale', async () => {
      const installedAppsFn = sinon.stub().resolves({ status: 'error' });
      monitor.initialize(installedAppsFn, sinon.stub());

      listeners.daemonStale();
      await new Promise((resolve) => { setImmediate(resolve); });

      sinon.assert.calledWithMatch(logStub.error, /daemon unreachable\) failed/);
    });
  });
});
