// The endpoints that drop a store every app read is answered from.
//
// Each one leaves this node serving the registry or the locations from an
// empty or partial store until a refill over the chain, or the network, has
// finished. That is a Flux team operation, never a node operator's.

const { expect } = require('chai');
const sinon = require('sinon');

const explorerService = require('../../ZelBack/src/services/explorerService');
const registryManager = require('../../ZelBack/src/services/appDatabase/registryManager');
const verificationHelper = require('../../ZelBack/src/services/verificationHelper');
const { Privilege } = require('../../ZelBack/src/services/utils/privileges');

describe('endpoints that drop an app store', () => {
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
