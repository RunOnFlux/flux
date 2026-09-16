const { expect } = require('chai');

const {
  INTENT, CLAIMABLE, intentOf, newCorrelationId,
} = require('../../ZelBack/src/services/utils/messageIntent');

describe('messageIntent tests', () => {
  describe('a type that is only ever one thing', () => {
    it('is what it was declared, whatever the message says', () => {
      // THE DEFECT THIS CLOSES. The marker is inside the signed payload, so it survives
      // every relay. A node operator signing an ordinary gossip message with an ask
      // marker would put an undeduplicated message into the network, and every honest
      // node would announce it again to every peer until its timestamp expired.
      const forged = { data: { type: 'fluxipchanged', oldIP: '1.1.1.1', intent: INTENT.ASK } };
      expect(intentOf(forged, INTENT.ANNOUNCE)).to.equal(INTENT.ANNOUNCE);

      const alsoForged = { data: { type: 'fluxappremoved', appName: 'x', intent: INTENT.ANSWER } };
      expect(intentOf(alsoForged, INTENT.ANNOUNCE)).to.equal(INTENT.ANNOUNCE);
    });

    it('is what it was declared when the message says nothing', () => {
      expect(intentOf({ data: { type: 'fluxapprequest', hash: 'abc' } }, INTENT.ASK))
        .to.equal(INTENT.ASK);
      expect(intentOf({ data: { type: 'fluxpolicy', bundle: 'x' } }, INTENT.ANSWER))
        .to.equal(INTENT.ANSWER);
    });

    it('cannot be talked out of it by an announce marker either', () => {
      // The other direction: claiming announce for an ask would let one peer's identical
      // ask suppress another's.
      const msg = { data: { type: 'fluxapprequest', hash: 'abc', intent: INTENT.ANNOUNCE } };
      expect(intentOf(msg, INTENT.ASK)).to.equal(INTENT.ASK);
    });
  });

  describe('a type sent both ways', () => {
    it('takes the intent from the message, because only the message knows', () => {
      // fluxpolicyseq is news when a node announces what it adopted and an answer when it
      // settles a peer's ask. Nothing relays it, which is what makes the marker safe.
      expect(intentOf({ data: { type: 'fluxpolicyseq', seq: 5, intent: INTENT.ANSWER } }, INTENT.VARIES))
        .to.equal(INTENT.ANSWER);
      expect(intentOf({ data: { type: 'fluxpolicyseq', seq: 5, intent: INTENT.ANNOUNCE } }, INTENT.VARIES))
        .to.equal(INTENT.ANNOUNCE);
    });

    it('reads an unmarked one as an announcement', () => {
      // What a node that predates the marker sends, and what one that predates the
      // classifier does with it. Matching that is the compatible choice: 26 peers
      // announcing one sequence stay one dispatch.
      expect(intentOf({ data: { type: 'fluxpolicyseq', seq: 2 } }, INTENT.VARIES))
        .to.equal(INTENT.ANNOUNCE);
    });

    it('ignores a marker it does not recognise', () => {
      expect(intentOf({ data: { type: 'fluxpolicyseq', seq: 2, intent: 'whatever' } }, INTENT.VARIES))
        .to.equal(INTENT.ANNOUNCE);
      expect(intentOf({ data: { type: 'fluxpolicyseq', seq: 2, intent: INTENT.VARIES } }, INTENT.VARIES))
        .to.equal(INTENT.ANNOUNCE);
    });
  });

  describe('garbage, since this runs before verification', () => {
    it('answers announce rather than throwing', () => {
      [undefined, null, {}, { data: null }, { data: 'string' }, { data: {} },
        { data: { type: null } }].forEach((msg) => {
        expect(intentOf(msg, INTENT.VARIES)).to.equal(INTENT.ANNOUNCE);
      });
    });

    it('answers announce for a declaration it does not recognise', () => {
      // Unreachable through messageRoutes, which refuses to register one - so this is
      // what a caller that bypassed the table would get, and it is the safe row.
      [undefined, null, '', 'sideways'].forEach((declared) => {
        expect(intentOf({ data: { type: 'fluxipchanged' } }, declared)).to.equal(INTENT.ANNOUNCE);
      });
    });
  });

  describe('the vocabulary', () => {
    it('does not let a message claim VARIES', () => {
      // VARIES is a type saying the payload decides. A message claiming it would be
      // asking to decide nothing, so it is not in the set a payload can name.
      expect(CLAIMABLE.has(INTENT.VARIES)).to.equal(false);
      expect([...CLAIMABLE].sort()).to.deep.equal([INTENT.ANNOUNCE, INTENT.ANSWER, INTENT.ASK].sort());
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
