const { expect } = require('chai');
const specDiff = require('../../ZelBack/src/services/appLifecycle/specDiff');

describe('specDiff tests', () => {
  describe('mustRecreateNetwork', () => {
    it('returns true for a legacy gateway-IP app (network must be recreated to migrate)', () => {
      // these names are in appsThatMightBeUsingOldGatewayIpAssignment
      expect(specDiff.mustRecreateNetwork({ name: 'fdm' })).to.equal(true);
      expect(specDiff.mustRecreateNetwork({ name: 'HNSDoH' })).to.equal(true);
    });

    it('returns false for a normal app (network is kept across a redeploy)', () => {
      expect(specDiff.mustRecreateNetwork({ name: 'someNormalApp' })).to.equal(false);
    });

    it('returns false for a missing/blank spec name (never forces a recreate on bad input)', () => {
      expect(specDiff.mustRecreateNetwork({})).to.equal(false);
      expect(specDiff.mustRecreateNetwork({ name: '' })).to.equal(false);
      expect(specDiff.mustRecreateNetwork(null)).to.equal(false);
      expect(specDiff.mustRecreateNetwork(undefined)).to.equal(false);
    });
  });
});
