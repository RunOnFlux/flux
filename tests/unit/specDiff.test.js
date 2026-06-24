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

  describe('specsDiffer', () => {
    it('is false when only the non-runtime fields differ (re-registration with no real change)', () => {
      const a = { name: 'x', repotag: 'r', ports: [1], description: 'old', expire: 8000, hash: 'h1', height: 1, instances: 3, owner: 'o' };
      const b = { name: 'x', repotag: 'r', ports: [1], description: 'new', expire: 4, hash: 'h2', height: 2, instances: 5, owner: 'o' };
      expect(specDiff.specsDiffer(a, b)).to.equal(false);
    });

    it('is true when a runtime field changes (repotag/ports/cpu/...)', () => {
      const base = { name: 'x', repotag: 'r', ports: [1] };
      expect(specDiff.specsDiffer(base, { ...base, repotag: 'r2' })).to.equal(true);
      expect(specDiff.specsDiffer(base, { ...base, ports: [2] })).to.equal(true);
      expect(specDiff.specsDiffer(base, { ...base, cpu: 2 })).to.equal(true);
    });

    it('does not mutate its inputs', () => {
      const a = { name: 'x', owner: 'o', repotag: 'r' };
      const b = { name: 'x', owner: 'p', repotag: 'r' };
      specDiff.specsDiffer(a, b);
      expect(a.owner).to.equal('o');
      expect(b.owner).to.equal('p');
    });
  });

  describe('volumeSpecChanged', () => {
    it('is true iff hdd differs', () => {
      expect(specDiff.volumeSpecChanged({ hdd: 5 }, { hdd: 5 })).to.equal(false);
      expect(specDiff.volumeSpecChanged({ hdd: 5 }, { hdd: 10 })).to.equal(true);
    });
  });
});
