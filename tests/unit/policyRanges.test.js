const { expect } = require('chai');
const { PREFIX_BOUNDS, policyRange } = require('../../ZelBack/src/services/utils/policyRanges');

describe('policyRanges tests', () => {
  it('holds IPv4 from /24 to /32 and IPv6 from /48 to /64', () => {
    expect(PREFIX_BOUNDS).to.deep.equal({ 4: { min: 24, max: 32 }, 6: { min: 48, max: 64 } });
  });

  [
    ['203.0.113.7/32', { address: '203.0.113.7', prefix: 32, family: 4, type: 'ipv4' }],
    ['203.0.113.0/24', { address: '203.0.113.0', prefix: 24, family: 4, type: 'ipv4' }],
    ['2001:db8:71:1::/64', { address: '2001:db8:71:1::', prefix: 64, family: 6, type: 'ipv6' }],
    ['2001:db8:71::/48', { address: '2001:db8:71::', prefix: 48, family: 6, type: 'ipv6' }],
  ].forEach(([value, range]) => {
    it(`takes ${value}`, () => {
      expect(policyRange(value)).to.deep.equal(range);
    });
  });

  [
    ['the whole IPv4 internet', '0.0.0.0/0'],
    ['an IPv4 range one bit wider than the floor', '203.0.112.0/23'],
    ['an IPv4 prefix past the address', '203.0.113.7/33'],
    ['the whole IPv6 internet', '::/0'],
    ['an IPv6 range one bit wider than the floor', '2001:db8:70::/47'],
    ['an IPv6 range finer than one customer', '2001:db8:71:1::1/65'],
    ['an address with no prefix', '203.0.113.7'],
    ['text that is no address', 'not-an-ip/32'],
    ['a value that is not text', 32],
  ].forEach(([label, value]) => {
    it(`refuses ${label}`, () => {
      expect(policyRange(value)).to.equal(null);
    });
  });
});
