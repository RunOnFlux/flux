const { expect } = require('chai');

const { collateralOutpoint, nodesNameThisNode } = require('../../ZelBack/src/services/utils/nodePinning');

const ADDR = '203.0.113.7:16127';
const TXHASH = 'a'.repeat(64);
const OUTPOINT = `${TXHASH}:0`;

describe('nodePinning', () => {
  describe('collateralOutpoint', () => {
    it('formats a collateral as a nodes[] entry', () => {
      expect(collateralOutpoint({ txhash: TXHASH, txindex: 0 })).to.equal(OUTPOINT);
    });

    it('answers null rather than a malformed entry', () => {
      // `undefined:undefined` would be a string, and a string is matchable — a spec
      // carrying that literal would pin to every node that failed to resolve.
      expect(collateralOutpoint(null)).to.equal(null);
      expect(collateralOutpoint({})).to.equal(null);
      expect(collateralOutpoint({ txhash: TXHASH })).to.equal(null);
      expect(collateralOutpoint({ txindex: 0 })).to.equal(null);
    });

    it('keeps a non-zero index', () => {
      expect(collateralOutpoint({ txhash: TXHASH, txindex: 3 })).to.equal(`${TXHASH}:3`);
    });
  });

  describe('nodesNameThisNode', () => {
    it('matches an address entry', () => {
      expect(nodesNameThisNode([ADDR], ADDR, OUTPOINT)).to.equal(true);
    });

    it('matches a collateral outpoint entry', () => {
      // The case appSpawner got wrong: an outpoint compared as a socket address
      // matches nothing, and a filtered-out candidate reports no error.
      expect(nodesNameThisNode([OUTPOINT], ADDR, OUTPOINT)).to.equal(true);
    });

    it('matches either identifier in a mixed list', () => {
      expect(nodesNameThisNode(['198.51.100.9:16127', OUTPOINT], ADDR, OUTPOINT)).to.equal(true);
      expect(nodesNameThisNode([ADDR, 'b'.repeat(64) + ':0'], ADDR, OUTPOINT)).to.equal(true);
    });

    it('does not match a spec naming other nodes', () => {
      expect(nodesNameThisNode(['198.51.100.9:16127', `${'b'.repeat(64)}:0`], ADDR, OUTPOINT)).to.equal(false);
    });

    it('is false for an unpinned spec', () => {
      expect(nodesNameThisNode([], ADDR, OUTPOINT)).to.equal(false);
      expect(nodesNameThisNode(undefined, ADDR, OUTPOINT)).to.equal(false);
      expect(nodesNameThisNode(null, ADDR, OUTPOINT)).to.equal(false);
    });

    it('still honours an address pin when the collateral could not be resolved', () => {
      // A daemon this node cannot reach narrows what it can match, and must not
      // widen it or drop the half it can still answer.
      expect(nodesNameThisNode([ADDR], ADDR, null)).to.equal(true);
      expect(nodesNameThisNode([OUTPOINT], ADDR, null)).to.equal(false);
    });

    it('matches an address pin written without a port', () => {
      expect(nodesNameThisNode(['203.0.113.7'], ADDR, null)).to.equal(true);
    });
  });
});
