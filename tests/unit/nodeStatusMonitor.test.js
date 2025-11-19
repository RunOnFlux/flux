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
});
