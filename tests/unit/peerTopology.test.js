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
  });

  it('counts the peers a node carries once its ring has closed', () => {
    expect(topology.carriedPeers(1)).to.equal(0);
    expect(topology.carriedPeers(2)).to.equal(1);
    expect(topology.carriedPeers(3)).to.equal(2);
    expect(topology.carriedPeers(5)).to.equal(4);
    expect(topology.carriedPeers(9)).to.equal(8);
    // a stub dials nothing, so it narrows the arc the dialers form
    expect(topology.carriedPeers(5, 2)).to.equal(2);
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
