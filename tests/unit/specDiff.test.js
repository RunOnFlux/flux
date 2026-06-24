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

  describe('portDelta', () => {
    it('opens only added ports and closes only removed ones (simple app)', () => {
      const oldSpec = { name: 'a', ports: [30000, 30001] };
      const newSpec = { name: 'a', ports: [30001, 30002] };
      const { toOpen, toClose } = specDiff.portDelta(oldSpec, newSpec);
      expect(toOpen).to.have.members([30002]);
      expect(toClose).to.have.members([30000]);
    });

    it('returns empty deltas when the port set is unchanged (no flap)', () => {
      const { toOpen, toClose } = specDiff.portDelta({ ports: [8080, 8443] }, { ports: [8443, 8080] });
      expect(toOpen).to.deep.equal([]);
      expect(toClose).to.deep.equal([]);
    });

    it('uses the union across components for a composed app', () => {
      const oldSpec = { compose: [{ ports: [30000] }, { ports: [30001] }] };
      const newSpec = { compose: [{ ports: [30000] }, { ports: [30002] }] };
      const { toOpen, toClose } = specDiff.portDelta(oldSpec, newSpec);
      expect(toOpen).to.have.members([30002]);
      expect(toClose).to.have.members([30001]);
    });

    it('opens all new ports when there was no old spec (fresh-ish)', () => {
      const { toOpen, toClose } = specDiff.portDelta(null, { ports: [30000, 30001] });
      expect(toOpen).to.have.members([30000, 30001]);
      expect(toClose).to.deep.equal([]);
    });

    it('ignores non-numeric ports', () => {
      const { toOpen } = specDiff.portDelta({ ports: [] }, { ports: ['30000', 'bad', 30001] });
      expect(toOpen).to.have.members([30000, 30001]);
    });

    it('reads a v1 app singular `port`', () => {
      expect([...specDiff.appPortSet({ port: 30000 })]).to.deep.equal([30000]);
      const { toClose } = specDiff.portDelta({ port: 30000 }, { ports: [30001] });
      expect(toClose).to.have.members([30000]);
    });
  });
});
