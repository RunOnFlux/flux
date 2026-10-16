const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('chainUtilities tests', () => {
  describe('getChainParamsPriceUpdates', () => {
    const configStub = {
      database: { chainparams: { database: 'chainparams', collections: { chainMessages: 'chainmessages' } } },
      fluxapps: { price: [{ height: 0, minPrice: 1 }, { height: 1000, minPrice: 2 }] },
    };

    function load(findInDatabase) {
      return proxyquire('../../ZelBack/src/services/utils/chainUtilities', {
        config: configStub,
        '../dbHelper': { databaseConnection: () => ({ db: () => ({}) }), findInDatabase },
        '../../lib/log': { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
      });
    }

    it('answers the configured forks and the chain\'s, oldest first', async () => {
      const chainUtilities = load(sinon.stub().resolves([{ height: 500, message: 'p_1_2_3_4' }]));

      const forks = await chainUtilities.getChainParamsPriceUpdates();

      expect(forks.map((fork) => fork.height)).to.deep.equal([0, 500, 1000]);
    });

    // A list without the chain's forks prices every app against stale prices,
    // and one without the configured forks too prices nothing.
    it('rejects when the chain\'s forks cannot be read', async () => {
      const chainUtilities = load(sinon.stub().rejects(new Error('connection timed out')));

      const outcome = await chainUtilities.getChainParamsPriceUpdates().catch((err) => err);

      expect(outcome, 'a price list was answered without the chain\'s forks').to.be.an('error');
    });
  });
});
