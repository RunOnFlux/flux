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
    [
      '8.8.8.8', '1.1.1.1', '31.200.0.10', '31.200.15.250',
      '2001:4860:4860::8888', '2606:4700:4700::1111', '2a00:1450:4001::200e', '2a01:4f8::1',
    ].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(false);
    });
  });

  it('covers every IPv6 address outside 2000::/3, to the edges of 2000::/3', () => {
    [
      '::', '::2', '::7f00:1', '1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '4000::', 'fbff::1', 'fec0::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    ].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(true);
    });
    ['2000::', '3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(false);
    });
  });

  it('covers every block IANA\'s IPv6 special-purpose registry marks not globally reachable', () => {
    [
      '::1', // loopback
      '::', // unspecified
      '64:ff9b:1::808:808', // local-use IPv4/IPv6 translation, whatever IPv4 address it carries
      '100::1', // discard-only
      '100:0:0:1::1', // dummy prefix
      '2001::1', // IETF protocol assignments, Teredo
      '2001:2::1', // benchmarking
      '2001:10::1', // deprecated ORCHID
      '2001:db8::1', // documentation
      '3fff::1', // documentation
      '5f00::1', // SRv6 SIDs
      'fc00::1', 'fdff:ffff::1', // unique local
      'fe80::1', 'febf::1', // link-local
      'ff02::1', // multicast
    ].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(true);
    });
  });

  it('covers 2001::/23, 2001:db8::/32 and 3fff::/20 to their edges, and nothing either side', () => {
    const edges = [
      ['2001::', '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff', '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2001:200::'],
      ['2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db9::'],
      ['3fff::', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff', '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '3fff:1000::'],
    ];
    edges.forEach(([first, last, below, above]) => {
      expect(isNonPublicAddress(first), first).to.equal(true);
      expect(isNonPublicAddress(last), last).to.equal(true);
      expect(isNonPublicAddress(below), below).to.equal(false);
      expect(isNonPublicAddress(above), above).to.equal(false);
    });
  });

  // Each carrier with a non-public IPv4 address in every form an address can be written in,
  // and with a public one, which passes although the carrier prefix lies outside 2000::/3.
  [
    {
      name: 'IPv4-mapped',
      nonPublic: ['::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:198.18.0.1', '::ffff:7f00:1', '::FFFF:7F00:1', '0:0:0:0:0:ffff:7f00:1'],
      public: ['::ffff:8.8.8.8', '::ffff:808:808'],
    },
    {
      name: 'NAT64 well-known prefix',
      nonPublic: [
        '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::a00:1', '64:ff9b::c0a8:101', '64:ff9b::a9fe:a9fe',
        '64:ff9b::6440:1', '0064:FF9B:0000:0000:0000:0000:7F00:0001', '64:ff9b:0:0:0:0:10.1.2.3',
      ],
      public: ['64:ff9b::808:808', '64:ff9b::8.8.8.8', '64:ff9b::1f2c:a0a'],
    },
    {
      name: '6to4',
      nonPublic: ['2002:7f00:1::1', '2002:a00:1::', '2002:c0a8:101::1', '2002:a9fe:a9fe:1:2:3:4:5', '2002::1'],
      public: ['2002:808:808::1', '2002:101:101:ffff::'],
    },
  ].forEach(({ name, nonPublic, public: publicAddresses }) => {
    it(`judges a ${name} address by the IPv4 address it carries`, () => {
      nonPublic.forEach((address) => {
        expect(isNonPublicAddress(address), address).to.equal(true);
      });
      publicAddresses.forEach((address) => {
        expect(isNonPublicAddress(address), address).to.equal(false);
      });
    });
  });

  it('judges an address next to a carrier prefix by its own range, not by the IPv4 address its last groups spell', () => {
    // Outside 64:ff9b::/96 and ::ffff:0:0/96, so outside 2000::/3: non-public, public IPv4 groups or not.
    ['64:ff9b:0:0:0:1:808:808', '64:ff9a:ffff:ffff:ffff:ffff:808:808', '::fffe:808:808', '0:0:0:0:1:ffff:808:808'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(true);
    });
    // Next to 2002::/16, inside 2000::/3: public, whatever its second and third groups spell.
    ['2003:7f00:1::1', '2400:7f00:1::1'].forEach((address) => {
      expect(isNonPublicAddress(address), address).to.equal(false);
    });
  });

  it('answers false for anything that is not an IP address', () => {
    ['10.example.com', 'localhost', '', 'not an address', '10.0.0'].forEach((input) => {
      expect(isNonPublicAddress(input), input).to.equal(false);
    });
  });
});
