const { expect } = require('chai');
const cidrUtils = require('../../ZelBack/src/services/utils/cidrUtils');

describe('cidrUtils tests', () => {
  describe('parseIp', () => {
    it('parses IPv4 to integer form', () => {
      expect(cidrUtils.parseIp('80.95.213.209')).to.eql({ version: 4, value: BigInt(0x505FD5D1) });
      expect(cidrUtils.parseIp('0.0.0.0')).to.eql({ version: 4, value: 0n });
      expect(cidrUtils.parseIp('255.255.255.255')).to.eql({ version: 4, value: 0xFFFFFFFFn });
    });

    it('parses IPv6 including compressed and embedded-IPv4 forms', () => {
      expect(cidrUtils.parseIp('2a01:4f9::1')).to.eql({ version: 6, value: (0x2a01n << 112n) + (0x4f9n << 96n) + 1n });
      expect(cidrUtils.parseIp('::')).to.eql({ version: 6, value: 0n });
      expect(cidrUtils.parseIp('64:ff9b::1.2.3.4').version).to.equal(6);
    });

    it('normalizes IPv4-mapped IPv6 to version 4', () => {
      expect(cidrUtils.parseIp('::ffff:80.95.213.209')).to.eql({ version: 4, value: BigInt(0x505FD5D1) });
    });

    it('rejects invalid input', () => {
      expect(cidrUtils.parseIp('80.95.213.209:16127')).to.equal(null);
      expect(cidrUtils.parseIp('80.95.213')).to.equal(null);
      expect(cidrUtils.parseIp('80.95.213.256')).to.equal(null);
      expect(cidrUtils.parseIp('')).to.equal(null);
      expect(cidrUtils.parseIp(null)).to.equal(null);
      expect(cidrUtils.parseIp(undefined)).to.equal(null);
      expect(cidrUtils.parseIp('not-an-ip')).to.equal(null);
    });
  });

  describe('formatIp', () => {
    it('round-trips IPv4', () => {
      const { value, version } = cidrUtils.parseIp('149.154.176.10');
      expect(cidrUtils.formatIp(value, version)).to.equal('149.154.176.10');
    });

    it('round-trips IPv6 with RFC 5952 zero compression', () => {
      const { value, version } = cidrUtils.parseIp('2a01:4f9:0:0:0:0:0:1');
      expect(cidrUtils.formatIp(value, version)).to.equal('2a01:4f9::1');
      expect(cidrUtils.formatIp(0n, 6)).to.equal('::');
    });
  });

  describe('prefixKey', () => {
    it('produces the canonical /16 network', () => {
      expect(cidrUtils.prefixKey('80.95.213.209', 16)).to.equal('80.95.0.0/16');
      expect(cidrUtils.prefixKey('80.95.215.211', 16)).to.equal('80.95.0.0/16');
    });

    it('does not confuse string-prefix lookalikes the old startsWith code merged', () => {
      // '149.154.176.10'.startsWith('149.15.') is true; the /16s differ
      expect(cidrUtils.prefixKey('149.15.1.1', 16)).to.equal('149.15.0.0/16');
      expect(cidrUtils.prefixKey('149.154.176.10', 16)).to.equal('149.154.0.0/16');
      expect(cidrUtils.prefixKey('80.9.1.1', 16)).to.not.equal(cidrUtils.prefixKey('80.95.1.1', 16));
    });

    it('supports /24 and /32 granularity', () => {
      expect(cidrUtils.prefixKey('80.95.213.209', 24)).to.equal('80.95.213.0/24');
      expect(cidrUtils.prefixKey('80.95.213.209', 32)).to.equal('80.95.213.209/32');
      expect(cidrUtils.prefixKey('80.95.213.209', 0)).to.equal('0.0.0.0/0');
    });

    it('groups IPv6 at /32 without throwing', () => {
      expect(cidrUtils.prefixKey('2a01:4f9:c010:1234::1', 32)).to.equal('2a01:4f9::/32');
      expect(cidrUtils.prefixKey('2a01:4f9:dead:beef::2', 32)).to.equal('2a01:4f9::/32');
    });

    it('rejects invalid addresses and prefix lengths', () => {
      expect(cidrUtils.prefixKey('80.95.213.209:16127', 16)).to.equal(null);
      expect(cidrUtils.prefixKey('80.95.213.209', 33)).to.equal(null);
      expect(cidrUtils.prefixKey('80.95.213.209', -1)).to.equal(null);
      expect(cidrUtils.prefixKey('80.95.213.209', 1.5)).to.equal(null);
      expect(cidrUtils.prefixKey('2a01:4f9::1', 129)).to.equal(null);
      expect(cidrUtils.prefixKey('garbage', 16)).to.equal(null);
    });
  });

  describe('sameSubnet', () => {
    it('matches inside a /16 and rejects across', () => {
      expect(cidrUtils.sameSubnet('80.95.213.209', '80.95.215.211', 16)).to.equal(true);
      expect(cidrUtils.sameSubnet('80.95.213.209', '80.9.1.1', 16)).to.equal(false);
    });

    it('never matches across IP versions or invalid input', () => {
      expect(cidrUtils.sameSubnet('80.95.213.209', '2a01:4f9::1', 16)).to.equal(false);
      expect(cidrUtils.sameSubnet('garbage', '80.95.213.209', 16)).to.equal(false);
    });
  });
});
