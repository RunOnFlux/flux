// The endpoints that reset a store: the explorer's chain data, which every app
// payment is read from, and the location store, which every location read is
// answered from. Resetting either is a Flux team operation, never a node
// operator's.
//
// The explorer reset covers chain data only. Its apps flag would drop the app
// messages, which come from the network rather than the chain, and the
// registry, which has its own rebuild; it is refused.

const { expect } = require('chai');
const sinon = require('sinon');

const dbHelper = require('../../ZelBack/src/services/dbHelper');

const explorerService = require('../../ZelBack/src/services/explorerService');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const { Privilege } = require('../../ZelBack/src/services/utils/privileges');

describe('endpoints that reset a store', () => {
  let asked;

  beforeEach(() => {
    asked = [];
    sinon.stub(verificationHelper, 'verifyPrivilege').callsFake(async (privilege) => {
      asked.push(privilege);
      return false;
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  [
    { name: 'explorer reindex', handler: () => explorerService.reindexExplorer },
    { name: 'explorer rescan', handler: () => explorerService.rescanExplorer },
    { name: 'global apps location reindex', handler: () => registryManager.reindexGlobalAppsLocationAPI },
  ].forEach(({ name, handler }) => {
    it(`${name} asks for the Flux team and nothing wider, and refuses anyone else`, async () => {
      const res = { json: sinon.stub() };
      await handler()({ params: {}, headers: { zelidauth: 'operator' } }, res);

      expect(asked).to.deep.equal([Privilege.FLUX_TEAM]);
      expect(res.json.calledOnce).to.equal(true);
      expect(res.json.firstCall.args[0].status).to.equal('error');
    });
  });
});

describe('the explorer reset\'s apps flag', () => {
  let writes;

  beforeEach(() => {
    sinon.stub(verificationHelper, 'verifyPrivilege').resolves(true);
    writes = [
      sinon.stub(dbHelper, 'dropCollection').resolves(true),
      sinon.stub(dbHelper, 'updateOneInDatabase').resolves(true),
      sinon.stub(dbHelper, 'findOneInDatabase').resolves({ generalScannedHeight: 1000 }),
    ];
  });

  afterEach(() => {
    sinon.restore();
  });

  const response = () => {
    const res = { json: sinon.stub() };
    res.status = sinon.stub().returns(res);
    return res;
  };

  [
    { name: 'explorer reindex', handler: () => explorerService.reindexExplorer, params: { reindexapps: 'true' } },
    { name: 'explorer rescan', handler: () => explorerService.rescanExplorer, params: { blockheight: '100', rescanapps: 'true' } },
  ].forEach(({ name, handler, params }) => {
    it(`${name} refuses the apps flag with a 400 naming the registry rebuild, and touches nothing`, async () => {
      const res = response();
      await handler()({ params, headers: { zelidauth: 'team' } }, res);

      expect(res.status.calledOnceWithExactly(400)).to.equal(true);
      expect(res.json.firstCall.args[0].data.message).to.include('/apps/reindexglobalappsinformation');
      writes.forEach((write) => sinon.assert.notCalled(write));
    });
  });
});
