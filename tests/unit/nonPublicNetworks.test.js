const { expect } = require('chai');

const { NON_PUBLIC_IPV4, NON_PUBLIC_IPV6, isNonPublicAddress } = require('../../ZelBack/src/services/utils/nonPublicNetworks');

describe('nonPublicNetworks tests', () => {
  it('holds every range as a CIDR', () => {
    [...NON_PUBLIC_IPV4, ...NON_PUBLIC_IPV6].forEach((cidr) => {
      expect(cidr, cidr).to.match(/^[0-9a-f:.]+\/\d{1,3}$/);
    });
  });

  it('covers each range to its first and last address, and nothing either side', () => {
    const edges = [
      ['0.0.0.0', '0.255.255.255', null, '1.0.0.0'],
      ['10.0.0.0', '10.255.255.255', '9.255.255.255', '11.0.0.0'],
      ['100.64.0.0', '100.127.255.255', '100.63.255.255', '100.128.0.0'],
      ['127.0.0.0', '127.255.255.255', '126.255.255.255', '128.0.0.0'],
      ['169.254.0.0', '169.254.255.255', '169.253.255.255', '169.255.0.0'],
      ['172.16.0.0', '172.31.255.255', '172.15.255.255', '172.32.0.0'],
      ['192.168.0.0', '192.168.255.255', '192.167.255.255', '192.169.0.0'],
      ['198.18.0.0', '198.19.255.255', '198.17.255.255', '198.20.0.0'],
      ['224.0.0.0', '239.255.255.255', '223.255.255.255', null],
      ['240.0.0.0', '255.255.255.255', null, null],
    ];
    edges.forEach(([first, last, below, above]) => {
      expect(isNonPublicAddress(first), first).to.equal(true);
      expect(isNonPublicAddress(last), last).to.equal(true);
      if (below) expect(isNonPublicAddress(below), below).to.equal(false);
      if (above) expect(isNonPublicAddress(above), above).to.equal(false);
    });
  });

  it('covers the documentation and protocol-assignment ranges', () => {
    ['192.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(true);
    });
  });

  it('passes public addresses, the harness fleet\'s among them', () => {
    ['8.8.8.8', '1.1.1.1', '31.200.0.10', '31.200.15.250', '2001:4860:4860::8888'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(false);
    });
  });

  it('covers each IPv6 range', () => {
    ['::', '::1', 'fc00::1', 'fdff:ffff::1', 'fe80::1', 'febf::1', 'ff02::1'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(true);
    });
    ['fec0::1', 'fbff::1'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(false);
    });
  });

  it('judges an IPv4-mapped IPv6 address by the IPv4 address it carries', () => {
    ['::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:198.18.0.1', '::ffff:7f00:1'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(true);
    });
    ['::ffff:8.8.8.8', '::ffff:808:808'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(false);
    });
  });

  it('answers false for anything that is not an IP address', () => {
    ['10.example.com', 'localhost', '', 'not an address', '10.0.0'].forEach((input) => {
      expect(isNonPublicAddress(input), input).to.equal(false);
    });
  });
});
