const { expect } = require('chai');

const ROUTES_PATH = '../../ZelBack/src/services/utils/messageRoutes';

// Loaded for its side effect: the transport declares its types as it loads.
require('../../ZelBack/src/services/fluxCommunication');
const {
  registeredTypes, isOrdered, handlerFor, declaredIntent,
} = require(ROUTES_PATH);
const { INTENT } = require('../../ZelBack/src/services/utils/messageIntent');

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

    it('declares only fluxpolicyseq as sent both ways', () => {
      // VARIES is the type saying it travels in both directions, which makes it point to
      // point and never filtered on content. Anything relayed onward must never be VARIES,
      // or one node's copy of a fact suppresses every other route it arrives by.
      const varying = registeredTypes().filter((type) => declaredIntent(type) === INTENT.VARIES);
      expect(varying).to.deep.equal(['fluxpolicyseq']);
    });

    it('declares every relayed type an announcement', () => {
      // These are the types whose handlers rebroadcast, so deduplication is the only
      // thing that stops one copy becoming one per peer per hop.
      ['zelappregister', 'zelappupdate', 'fluxappregister', 'fluxappupdate',
        'fluxapprunning', 'fluxipchanged', 'fluxappremoved', 'fluxappinstalling',
        'fluxappinstallingerror', 'fluxnodesigterm'].forEach((type) => {
        expect(declaredIntent(type), type).to.equal(INTENT.ANNOUNCE);
      });
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
      table.register(['one', 'two'], handler, table.ROUTE.GOSSIP, INTENT.ANNOUNCE);
      expect(table.handlerFor('one')).to.equal(handler);
      expect(table.handlerFor('two')).to.equal(handler);
    });

    it('takes the last declaration for a type', () => {
      const table = freshTable();
      const second = () => 'second';
      table.register('twice', () => 'first', table.ROUTE.GOSSIP, INTENT.ANNOUNCE);
      table.register('twice', second, table.ROUTE.ORDERED, INTENT.ANSWER);
      expect(table.handlerFor('twice')).to.equal(second);
      expect(table.isOrdered('twice')).to.equal(true);
      expect(table.declaredIntent('twice')).to.equal(INTENT.ANSWER);
    });

    it('refuses a type that does not say how it travels or what it is', () => {
      // The whole point of making both required. A type registered without an intent
      // would inherit whatever the default was, and the default that is wrong for one
      // type is the one that floods the network.
      const table = freshTable();
      expect(() => table.register('nothing', () => {})).to.throw(/declares no route/);
      expect(() => table.register('noroute', () => {}, 'sideways', INTENT.ANNOUNCE)).to.throw(/declares no route/);
      expect(() => table.register('nointent', () => {}, table.ROUTE.GOSSIP)).to.throw(/declares no intent/);
      expect(() => table.register('bogus', () => {}, table.ROUTE.GOSSIP, 'whatever')).to.throw(/declares no intent/);
    });

    it('reads an unregistered type as an announcement', () => {
      // It has no handler, so it is dropped either way - but deduplicating it first
      // means a peer cannot make us do the work twice by sending it twice.
      const table = freshTable();
      expect(table.declaredIntent('fluxnotathing')).to.equal(INTENT.ANNOUNCE);
    });
  });
});
