const { expect } = require('chai');

// The g: placement rules are pure, so the orders three harness suites depend on
// can be proven here rather than only on a fleet - which matters because getting
// one wrong does not fail loudly. It produces a fleet in a shape the suite was
// not written for, and the suite then times out waiting for something that was
// never going to happen.
describe('g: app placement orders', () => {
  let placement;

  before(async () => {
    // Real ESM specifier resolved at runtime; the harness is ESM, this file is CJS.
    // eslint-disable-next-line import/extensions
    placement = await import('../../test-infra/runner/framework/g-app-placement.js');
  });

  // The harness lays nodes out one per address, ascending with the index.
  const ipOf = (index) => `198.18.0.${index + 10}`;

  describe('which holder seeds the folder', () => {
    it('is the lowest address, not the first one the caller listed', () => {
      // The distinction the rule turns on. Taking holders[0] passes on every
      // fixture that happens to list its holders in order, and silently picks
      // the wrong node for the first one that does not.
      expect(placement.syncthingSeedIndex([2, 0, 1], ipOf)).to.equal(0);
      expect(placement.syncthingSeedIndex([4, 3], ipOf)).to.equal(3);
    });

    it('orders addresses numerically, not as text', () => {
      // '.10' sorts before '.9' as text. Every harness fleet today lands in
      // .10-.25 where the two agree, so a lexical compare would be wrong only
      // for the first fixture that ever spans the boundary.
      const spanning = (index) => `198.18.0.${index}`;

      expect(placement.syncthingSeedIndex([10, 9], spanning)).to.equal(9);
    });

    it('refuses an empty holder set rather than answering undefined', () => {
      expect(() => placement.syncthingSeedIndex([], ipOf)).to.throw(/non-empty/);
    });
  });

  describe('placing the seed at a chosen position', () => {
    it('reproduces the order suite 70 arranges by hand', () => {
      // Two holders, seed second, so it carries the later runningSince and
      // lands at election index 1.
      expect(placement.placementOrderWithSeedAt([0, 1], 1, ipOf)).to.eql([1, 0]);
    });

    it('reproduces the order suite 69 arranges by hand', () => {
      // Three holders, seed in the middle: a peer above it and a peer below.
      expect(placement.placementOrderWithSeedAt([0, 1, 2], 1, ipOf)).to.eql([1, 0, 2]);
    });

    it('reproduces the order suite 96 arranges by hand', () => {
      // Seed last, so the writer is also the newest copy - the one the surplus
      // rule picks. That collision is the whole subject of that suite.
      expect(placement.placementOrderWithSeedAt([0, 1, 2], 2, ipOf)).to.eql([1, 2, 0]);
    });

    it('puts the seed at the senior end when asked for position 0', () => {
      expect(placement.placementOrderWithSeedAt([0, 1, 2], 0, ipOf)).to.eql([0, 1, 2]);
    });

    it('keeps every holder exactly once, wherever the seed goes', () => {
      const holders = [0, 1, 2, 3];
      for (let position = 0; position < holders.length; position += 1) {
        const order = placement.placementOrderWithSeedAt(holders, position, ipOf);
        expect(order.slice().sort(), `position ${position} lost or duplicated a holder`)
          .to.eql(holders.slice().sort());
        expect(order[position], `the seed is not at position ${position}`).to.equal(0);
      }
    });

    it('refuses a position off the end rather than clamping to it', () => {
      // Clamping would hand back a plausible order for a fleet the caller does
      // not have, and the suite would then wait on a shape that cannot occur.
      expect(() => placement.placementOrderWithSeedAt([0, 1], 2, ipOf)).to.throw(/outside 0\.\.1/);
      expect(() => placement.placementOrderWithSeedAt([0, 1], -1, ipOf)).to.throw(/outside 0\.\.1/);
    });
  });
});
