const { expect } = require('chai');

const {
  INTENT, intentOf, newCorrelationId, UNMARKED_INTENTS,
} = require('../../ZelBack/src/services/utils/messageIntent');

describe('messageIntent tests', () => {
  describe('what the marker says, when a peer sends one', () => {
    it('reads the intent off the message rather than off its type', () => {
      // The whole point: one type can be two intents, so the message has to say.
      expect(intentOf({ data: { type: 'fluxpolicyseq', seq: 5, intent: INTENT.ANSWER } }))
        .to.equal(INTENT.ANSWER);
      expect(intentOf({ data: { type: 'fluxpolicyseq', seq: 5, intent: INTENT.ANNOUNCE } }))
        .to.equal(INTENT.ANNOUNCE);
    });

    it('ignores an intent it does not recognise and falls back to the type', () => {
      expect(intentOf({ data: { type: 'fluxapprequest', intent: 'whatever' } }))
        .to.equal(INTENT.ASK);
      expect(intentOf({ data: { type: 'fluxapprunning', intent: 'whatever' } }))
        .to.equal(INTENT.ANNOUNCE);
    });
  });

  describe('what an unmarked message means, for peers that do not send one', () => {
    it('reads the two request types as asks', () => {
      expect(intentOf({ data: { type: 'fluxapprequest', hash: 'abc' } })).to.equal(INTENT.ASK);
      expect(intentOf({ data: { type: 'fluxpolicyrequest', seq: 1 } })).to.equal(INTENT.ASK);
    });

    it('reads a policy bundle as an answer, so two peers serving it do not collapse', () => {
      // It is only ever sent point to point, in reply to a fluxpolicyrequest. Deduplicating
      // it drops every copy after the first, and the asks those copies would have settled
      // then wait out their window instead.
      expect(intentOf({ data: { type: 'fluxpolicy', bundle: 'x' } })).to.equal(INTENT.ANSWER);
    });

    it('reads an unmarked sequence as an announcement, which is what an older node does', () => {
      // Unmarked there is no way to tell an adoption announcement from an answer, and a
      // node without this classifier treats it as news. Matching that is the compatible
      // choice: 26 peers announcing one sequence stay one dispatch.
      expect(intentOf({ data: { type: 'fluxpolicyseq', seq: 2 } })).to.equal(INTENT.ANNOUNCE);
    });

    it('reads every other type as an announcement', () => {
      ['fluxapprunning', 'fluxappregister', 'fluxappupdate', 'fluxipchanged',
        'fluxappremoved', 'fluxappinstalling', 'fluxnodesigterm'].forEach((type) => {
        expect(intentOf({ data: { type } }), type).to.equal(INTENT.ANNOUNCE);
      });
    });
  });

  describe('the fallback map carries only what it has to', () => {
    it('maps nothing to announce, because announce is the default', () => {
      // An entry mapping to announce would be inert - the fallback already returns it.
      // One that appeared would mean somebody read the map as the list of all types.
      [...UNMARKED_INTENTS.values()].forEach((intent) => {
        expect(intent).to.be.oneOf([INTENT.ASK, INTENT.ANSWER]);
      });
    });

    it('holds only types with a single role, since an ambiguous one cannot be guessed', () => {
      // fluxpolicyseq is sent both ways and so must never appear here.
      expect(UNMARKED_INTENTS.has('fluxpolicyseq')).to.equal(false);
    });
  });

  describe('garbage from a peer, since this runs before verification', () => {
    it('answers announce rather than throwing', () => {
      [undefined, null, {}, { data: null }, { data: 'string' }, { data: {} },
        { data: { type: null } }].forEach((msg) => {
        expect(intentOf(msg)).to.equal(INTENT.ANNOUNCE);
      });
    });
  });

  describe('correlation ids', () => {
    it('does not repeat, so two asks are never one', () => {
      const ids = new Set();
      for (let i = 0; i < 1000; i += 1) ids.add(newCorrelationId());
      expect(ids.size).to.equal(1000);
    });
  });
});
