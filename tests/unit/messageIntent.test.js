const { expect } = require('chai');

const {
  INTENT, CLAIMABLE, newCorrelationId,
} = require('../../ZelBack/src/services/utils/messageIntent');

describe('messageIntent tests', () => {
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
