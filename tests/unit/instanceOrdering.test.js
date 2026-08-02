const { expect } = require('chai');

const instanceOrdering = require('../../ZelBack/src/services/utils/instanceOrdering');

const { compareInstallingClaims, compareInstanceSeniority, describeRanking } = instanceOrdering;

const ips = (list) => list.map((entry) => entry.ip);

describe('instanceOrdering tests', () => {
  describe('compareInstallingClaims', () => {
    it('ranks the earliest broadcastedAt first regardless of address order', () => {
      const claims = [
        { ip: '10.0.0.1:16127', broadcastedAt: 3000 },
        { ip: '10.0.0.9:16127', broadcastedAt: 1000 },
        { ip: '10.0.0.5:16127', broadcastedAt: 2000 },
      ];

      expect(ips(claims.sort(compareInstallingClaims))).to.eql(['10.0.0.9:16127', '10.0.0.5:16127', '10.0.0.1:16127']);
    });

    it('breaks same-millisecond ties by address ascending, whatever the input order', () => {
      const build = () => [
        { ip: '10.0.0.7:16127', broadcastedAt: 1000 },
        { ip: '10.0.0.2:16127', broadcastedAt: 1000 },
        { ip: '10.0.0.4:16127', broadcastedAt: 1000 },
      ];
      const expected = ['10.0.0.2:16127', '10.0.0.4:16127', '10.0.0.7:16127'];

      // Two nodes observe the same claims in different arrival orders and must
      // still compute the same winner.
      expect(ips(build().sort(compareInstallingClaims))).to.eql(expected);
      expect(ips(build().reverse().sort(compareInstallingClaims))).to.eql(expected);
    });

    it('ranks a claim without a timestamp last', () => {
      const claims = [
        { ip: '10.0.0.1:16127' },
        { ip: '10.0.0.2:16127', broadcastedAt: null },
        { ip: '10.0.0.9:16127', broadcastedAt: 5000 },
      ];

      expect(ips(claims.sort(compareInstallingClaims))).to.eql(['10.0.0.9:16127', '10.0.0.1:16127', '10.0.0.2:16127']);
    });

    it('treats broadcastedAt of 0 as a real timestamp, not a missing one', () => {
      const claims = [
        { ip: '10.0.0.5:16127', broadcastedAt: 1000 },
        { ip: '10.0.0.9:16127', broadcastedAt: 0 },
        { ip: '10.0.0.1:16127' },
      ];

      expect(ips(claims.sort(compareInstallingClaims))).to.eql(['10.0.0.9:16127', '10.0.0.5:16127', '10.0.0.1:16127']);
    });

    it('never reports two distinct addresses as equal', () => {
      const a = { ip: '10.0.0.1:16127', broadcastedAt: 1000 };
      const b = { ip: '10.0.0.2:16127', broadcastedAt: 1000 };

      expect(compareInstallingClaims(a, b)).to.be.below(0);
      expect(compareInstallingClaims(b, a)).to.be.above(0);
      expect(compareInstallingClaims(a, { ...a })).to.equal(0);
    });
  });

  describe('compareInstanceSeniority', () => {
    it('ranks the longest-running first regardless of address order', () => {
      const instances = [
        { ip: '10.0.0.1:16127', runningSince: '2026-08-02T12:00:00.000Z' },
        { ip: '10.0.0.9:16127', runningSince: '2026-08-01T00:00:00.000Z' },
        { ip: '10.0.0.5:16127', runningSince: '2026-08-02T06:00:00.000Z' },
      ];

      expect(ips(instances.sort(compareInstanceSeniority))).to.eql(['10.0.0.9:16127', '10.0.0.5:16127', '10.0.0.1:16127']);
    });

    it('orders numeric runningSince values the same way as ISO strings', () => {
      const instances = [
        { ip: '10.0.0.1:16127', runningSince: 3000 },
        { ip: '10.0.0.9:16127', runningSince: 1000 },
        { ip: '10.0.0.5:16127', runningSince: 2000 },
      ];

      expect(ips(instances.sort(compareInstanceSeniority))).to.eql(['10.0.0.9:16127', '10.0.0.5:16127', '10.0.0.1:16127']);
    });

    it('ranks an instance that has not reported runningSince first', () => {
      const instances = [
        { ip: '10.0.0.5:16127', runningSince: '2026-08-01T00:00:00.000Z' },
        { ip: '10.0.0.9:16127' },
        { ip: '10.0.0.1:16127', runningSince: '2026-08-02T00:00:00.000Z' },
      ];

      expect(ips(instances.sort(compareInstanceSeniority))).to.eql(['10.0.0.9:16127', '10.0.0.5:16127', '10.0.0.1:16127']);
    });

    it('breaks equal runningSince by address ascending, whatever the input order', () => {
      const build = () => [
        { ip: '10.0.0.7:16127', runningSince: '2026-08-01T00:00:00.000Z' },
        { ip: '10.0.0.2:16127', runningSince: '2026-08-01T00:00:00.000Z' },
        { ip: '10.0.0.4:16127', runningSince: '2026-08-01T00:00:00.000Z' },
      ];
      const expected = ['10.0.0.2:16127', '10.0.0.4:16127', '10.0.0.7:16127'];

      expect(ips(build().sort(compareInstanceSeniority))).to.eql(expected);
      expect(ips(build().reverse().sort(compareInstanceSeniority))).to.eql(expected);
    });

    it('never reports two distinct addresses as equal', () => {
      const a = { ip: '10.0.0.1:16127', runningSince: 1000 };
      const b = { ip: '10.0.0.2:16127', runningSince: 1000 };

      expect(compareInstanceSeniority(a, b)).to.be.below(0);
      expect(compareInstanceSeniority(b, a)).to.be.above(0);
      expect(compareInstanceSeniority(a, { ...a })).to.equal(0);
    });
  });

  describe('reversed seniority ranking', () => {
    // The surplus-instance trim sorts with the arguments swapped to find the
    // most junior instance; that order must mirror the forward one exactly.
    const reversed = (a, b) => compareInstanceSeniority(b, a);

    it('orders newest first, unreported last, and ties by address descending', () => {
      const instances = [
        { ip: '10.0.0.2:16127', runningSince: '2026-08-01T00:00:00.000Z' },
        { ip: '10.0.0.8:16127' },
        { ip: '10.0.0.7:16127', runningSince: '2026-08-01T00:00:00.000Z' },
        { ip: '10.0.0.1:16127', runningSince: '2026-08-02T00:00:00.000Z' },
      ];

      expect(ips([...instances].sort(reversed))).to.eql([
        '10.0.0.1:16127',
        '10.0.0.7:16127',
        '10.0.0.2:16127',
        '10.0.0.8:16127',
      ]);
    });

    it('yields the exact reverse of the forward sort when entries tie', () => {
      const instances = [
        { ip: '10.0.0.4:16127', runningSince: 2000 },
        { ip: '10.0.0.1:16127', runningSince: 1000 },
        { ip: '10.0.0.9:16127' },
        { ip: '10.0.0.3:16127', runningSince: 1000 },
        { ip: '10.0.0.6:16127', runningSince: 2000 },
      ];

      const forward = ips([...instances].sort(compareInstanceSeniority));
      const backward = ips([...instances].sort(reversed));

      expect(backward).to.eql([...forward].reverse());
    });
  });

  describe('describeRanking', () => {
    it('renders each entry as address@timestamp of the ranked field', () => {
      const list = [
        { ip: '10.0.0.9:16127', broadcastedAt: 1000 },
        { ip: '10.0.0.5:16127', broadcastedAt: 2000 },
      ];

      expect(describeRanking(list, 'broadcastedAt')).to.equal('10.0.0.9:16127@1000, 10.0.0.5:16127@2000');
    });

    it('renders a missing timestamp as unreported', () => {
      const list = [
        { ip: '10.0.0.9:16127' },
        { ip: '10.0.0.5:16127', runningSince: '2026-08-01T00:00:00.000Z' },
      ];

      expect(describeRanking(list, 'runningSince')).to.equal('10.0.0.9:16127@unreported, 10.0.0.5:16127@2026-08-01T00:00:00.000Z');
    });

    it('renders an empty list as an empty string', () => {
      expect(describeRanking([], 'broadcastedAt')).to.equal('');
    });
  });
});
