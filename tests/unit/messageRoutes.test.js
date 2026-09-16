const { expect } = require('chai');

const ROUTES_PATH = '../../ZelBack/src/services/utils/messageRoutes';

// Loaded for its side effect: the transport declares its types as it loads.
require('../../ZelBack/src/services/fluxCommunication');
const { registeredTypes, isOrdered, handlerFor } = require(ROUTES_PATH);

const freshTable = () => {
  delete require.cache[require.resolve(ROUTES_PATH)];
  // eslint-disable-next-line global-require
  const table = require(ROUTES_PATH);
  delete require.cache[require.resolve(ROUTES_PATH)];
  return table;
};

const GOSSIP_TYPES = [
  'zelappregister', 'zelappupdate', 'fluxappregister', 'fluxappupdate',
  'fluxapprunning', 'fluxipchanged', 'fluxappremoved', 'fluxappinstalling',
  'fluxappinstallingerror', 'fluxnodesigterm', 'fluxapprequest',
  'fluxpolicyrequest', 'fluxpolicyseq', 'fluxpolicy',
];

const ORDERED_TYPES = [
  'fluxapptempsync', 'fluxapprunningsync', 'fluxappinstallingsync',
  'fluxappinstallingerrorssync',
];

describe('messageRoutes tests', () => {
  describe('the table the transport actually loads', () => {
    it('declares every type this node answers', () => {
      // An empty table reads as "unrecognised message type" for everything, which is a
      // silent network outage. This is the guard that a registration cannot go missing.
      expect(registeredTypes()).to.include.members([...GOSSIP_TYPES, ...ORDERED_TYPES]);
    });

    it('gives each of them something to run', () => {
      [...GOSSIP_TYPES, ...ORDERED_TYPES].forEach((type) => {
        expect(handlerFor(type), type).to.be.a('function');
      });
    });

    it('orders the sync responses and nothing else', () => {
      // Ordered types go around the gossip pipeline, so one wrongly marked loses its
      // deduplication and one wrongly unmarked loses the order its chunks carry.
      expect(registeredTypes().filter(isOrdered).sort()).to.deep.equal([...ORDERED_TYPES].sort());
    });

    it('claims nothing it was not given', () => {
      expect(handlerFor('fluxnotathing')).to.equal(null);
      expect(isOrdered('fluxnotathing')).to.equal(false);
    });
  });

  describe('the table itself', () => {
    it('takes several types onto one handler', () => {
      const table = freshTable();
      const handler = () => 'handled';
      table.register(['one', 'two'], handler);
      expect(table.handlerFor('one')).to.equal(handler);
      expect(table.handlerFor('two')).to.equal(handler);
    });

    it('defaults to the gossip pipeline', () => {
      const table = freshTable();
      table.register('quiet', () => {});
      expect(table.isOrdered('quiet')).to.equal(false);
    });

    it('takes the last declaration for a type', () => {
      const table = freshTable();
      const second = () => 'second';
      table.register('twice', () => 'first');
      table.register('twice', second, table.ROUTE.ORDERED);
      expect(table.handlerFor('twice')).to.equal(second);
      expect(table.isOrdered('twice')).to.equal(true);
    });
  });
});
