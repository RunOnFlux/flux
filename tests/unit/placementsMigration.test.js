const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('placements migration', () => {
  let migration;
  let learnAddress;
  let findInDatabaseStub;
  let backfillPlacementsStub;

  beforeEach(() => {
    findInDatabaseStub = sinon.stub().resolves([{ name: 'web' }, { name: 'db' }]);
    backfillPlacementsStub = sinon.stub().resolves({ created: 2, fromLocationRows: 2 });
    migration = proxyquire('../../ZelBack/src/services/migrations/placements', {
      config: { database: { appslocal: { database: 'localzelapps' } } },
      '../dbHelper': {
        databaseConnection: () => ({ db: () => ({}) }),
        findInDatabase: findInDatabaseStub,
      },
      '../fluxNetworkHelper': {
        waitForLocalSocketAddress: () => new Promise((resolve) => { learnAddress = resolve; }),
      },
      '../appManagement/appPlacements': { backfillPlacements: backfillPlacementsStub },
      '../utils/appConstants': { localAppsInformation: 'zelappsinformation' },
    });
  });

  // The rows a record is dated from are filed under this node's address, so no
  // record is written before the node knows it.
  it('writes nothing until this node knows its address, then backfills the installed apps from it', async () => {
    const running = migration.backfillPlacements();
    await new Promise((resolve) => { setImmediate(resolve); });
    sinon.assert.notCalled(backfillPlacementsStub);

    learnAddress('203.0.113.40:16127');
    await running;

    sinon.assert.calledOnceWithExactly(backfillPlacementsStub, ['web', 'db'], '203.0.113.40:16127');
    expect(findInDatabaseStub.firstCall.args[1]).to.equal('zelappsinformation');
  });
});
