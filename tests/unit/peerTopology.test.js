const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();

// peer-topology.js derives a harness fleet's readiness thresholds from production's
// share of the peers a node carries. The thresholds it compresses are copied from
// ZelBack/config/default.js, which the harness cannot load; this is what makes them
// drifting apart fail rather than quietly move every small fleet's margin.
describe('harness peer topology', () => {
  let topology;

  before(async () => {
    // Real ESM specifier resolved at runtime; the harness is ESM, this file is CJS.
    // eslint-disable-next-line import/extensions
    topology = await import('../../test-infra/runner/framework/peer-topology.js');
  });

  const shared = { appSyncPeerThreshold: 2, appSyncDegradedThreshold: 1 };

  it('holds the readiness thresholds the fleet reads', () => {
    const { fluxapps } = proxyquire('../../ZelBack/config/default', {
      '../../config/userconfig': { initial: { development: false } },
    });

    expect(topology.PRODUCTION_READINESS.peerThreshold).to.equal(fluxapps.appSyncPeerThreshold);
    expect(topology.PRODUCTION_READINESS.degradedThreshold).to.equal(fluxapps.appSyncDegradedThreshold);
    expect(topology.PRODUCTION_ADMISSION_QUORUM).to.equal(fluxapps.admissionQuorum);
    expect(topology.PRODUCTION_ADMISSION_LINK_TARGET).to.equal(fluxapps.admissionLinkTarget);
  });

  describe('ringPeerFloors', () => {
    const ring = Array.from({ length: 14 }, (_unused, i) => i);
    const floors = { minOutgoing: 4, minIncoming: 2 };

    it('counts a stub ahead of a node, which takes its dial', () => {
      expect(topology.ringPeerFloors(9, ring, { ...floors, stubs: [12, 13] })).to.deep.equal({ outbound: 4, inbound: 2 });
    });

    it('counts no stub behind a node, which never dials it', () => {
      expect(topology.ringPeerFloors(1, ring, { ...floors, minIncoming: 4, stubs: [12, 13] })).to.deep.equal({ outbound: 4, inbound: 3 });
    });

    it('counts no slot nothing answers on, in either direction', () => {
      expect(topology.ringPeerFloors(9, ring, { ...floors, minIncoming: 4, absent: [11, 7] })).to.deep.equal({ outbound: 3, inbound: 3 });
    });

    it('never asks for more than the floor', () => {
      expect(topology.ringPeerFloors(5, ring, { minOutgoing: 2, minIncoming: 1 })).to.deep.equal({ outbound: 2, inbound: 1 });
    });

    it('counts a peer in both arcs in neither direction', () => {
      expect(topology.ringPeerFloors(0, [0, 1, 2], { minOutgoing: 2, minIncoming: 2 })).to.deep.equal({ outbound: 0, inbound: 0 });
    });

    it('wraps around the end of the ring', () => {
      expect(topology.ringPeerFloors(13, ring, { ...floors, minIncoming: 4, absent: [0] })).to.deep.equal({ outbound: 3, inbound: 4 });
    });

    it('takes the ring it is given when an index is not on the list', () => {
      expect(topology.ringPeerFloors(4, [0, 1, 2, 4, 6, 7, 8], { minOutgoing: 2, minIncoming: 2 })).to.deep.equal({ outbound: 2, inbound: 2 });
    });
  });

  it('counts the peers the worst-placed node of a ring can hold', () => {
    expect(topology.reachablePeers(1)).to.equal(0);
    expect(topology.reachablePeers(3)).to.equal(2);
    expect(topology.reachablePeers(9)).to.equal(8);
    // a stub or a deferred node is a slot in an arc that nothing answers on
    expect(topology.reachablePeers(3, 1)).to.equal(1);
    expect(topology.reachablePeers(9, 2)).to.equal(6);
    expect(topology.reachablePeers(3, 3)).to.equal(0);
  });

  it('waits on the same count the admission quorum is drawn from', () => {
    // 4 nodes, 1 deferred: 3 dialers, the worst-placed node holds 1
    expect(topology.expectedPeerTotal(4, 2, 3, 1)).to.equal(topology.reachablePeers(3, 1));
    expect(topology.deriveAdmissionQuorum(9, 0, 0)).to.equal(Math.min(3, topology.reachablePeers(9) - 2));
  });

  it('asks a fleet for the admission quorum its Arcane peers meet with production\'s margin to spare', () => {
    // reachable peers, less legacy nodes, less the margin of 2, capped at 3
    expect(topology.deriveAdmissionQuorum(1, 0, 0)).to.equal(0);
    expect(topology.deriveAdmissionQuorum(3, 0, 0)).to.equal(0);
    expect(topology.deriveAdmissionQuorum(4, 0, 0)).to.equal(0);
    expect(topology.deriveAdmissionQuorum(5, 0, 0)).to.equal(2);
    expect(topology.deriveAdmissionQuorum(9, 0, 0)).to.equal(3);
    expect(topology.deriveAdmissionQuorum(9, 0, 4)).to.equal(2);
    // a deferred node or a stub holds a ring slot nothing answers on
    expect(topology.deriveAdmissionQuorum(10, 1, 0)).to.equal(3);
    expect(topology.deriveAdmissionQuorum(11, 2, 0)).to.equal(3);
    expect(topology.deriveAdmissionQuorum(6, 1, 0)).to.equal(1);
  });

  describe('readiness thresholds', () => {
    [
      // nodes, carried, ready threshold
      [3, 2, 1],
      [5, 4, 1],
      [7, 6, 2],
      [9, 8, 2],
    ].forEach(([nodes, carried, ready]) => {
      it(`asks a ${nodes}-node fleet, carrying ${carried} peers a node, for ${ready} to be ready`, () => {
        expect(topology.carriedPeers(nodes)).to.equal(carried);
        expect(topology.deriveReadinessThresholds(nodes, 0, shared).appSyncPeerThreshold).to.equal(ready);
      });
    });

    it('leaves a node that has lost a connection ready on a fleet that carries two peers a node', () => {
      const { appSyncPeerThreshold } = topology.deriveReadinessThresholds(3, 0, shared);

      expect(appSyncPeerThreshold).to.be.at.most(topology.carriedPeers(3) - 1);
    });

    it('asks production\'s share of what a node carries, below the shared value', () => {
      const generous = { appSyncPeerThreshold: 20, appSyncDegradedThreshold: 20 };

      // 8 carried: 8 * 12 / 26 and 8 * 4 / 26, rounded down
      expect(topology.deriveReadinessThresholds(9, 0, generous)).to.deep.equal({
        appSyncPeerThreshold: 3, appSyncDegradedThreshold: 1,
      });
    });

    it('never asks more than the shared value it compresses', () => {
      expect(topology.deriveReadinessThresholds(30, 0, shared)).to.deep.equal(shared);
    });

    it('asks at least one peer, of a fleet with none to offer too', () => {
      expect(topology.deriveReadinessThresholds(1, 0, shared)).to.deep.equal({
        appSyncPeerThreshold: 1, appSyncDegradedThreshold: 1,
      });
    });

    it('never puts the degraded threshold above the ready one', () => {
      const degradedFirst = { appSyncPeerThreshold: 2, appSyncDegradedThreshold: 5 };

      [2, 3, 5, 9, 30].forEach((nodes) => {
        const { appSyncPeerThreshold, appSyncDegradedThreshold } = topology.deriveReadinessThresholds(nodes, 0, degradedFirst);
        expect(appSyncDegradedThreshold, `${nodes} nodes`).to.be.at.most(appSyncPeerThreshold);
      });
    });
  });
});
