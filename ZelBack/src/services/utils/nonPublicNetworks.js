/**
 * Address ranges that are not the public internet: private networks, carrier-grade
 * NAT, loopback, link-local (a cloud host's metadata service), and the ranges IANA
 * reserves for documentation, benchmarking, multicast and future use.
 *
 * Public IPv6 unicast is allocated from 2000::/3 alone (RFC 4291, IANA's IPv6
 * address space), so every IPv6 address outside it is non-public, and inside it
 * the blocks IANA's special-purpose registry marks not globally reachable are.
 * An IPv6 address that carries an IPv4 address is judged by that IPv4 address:
 * IPv4-mapped (::ffff:0:0/96), the NAT64 well-known prefix (64:ff9b::/96, RFC
 * 6052) and 6to4 (2002::/16, RFC 3056).
 *
 * One list for everything that keeps traffic off them: FluxOS's own outbound
 * requests (urlSecurity) and app containers (the DOCKER-USER chain).
 */

const net = require('net');

const NON_PUBLIC_IPV4 = Object.freeze([
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, a cloud host's metadata service
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // documentation (TEST-NET-1)
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // documentation (TEST-NET-2)
  '203.0.113.0/24', // documentation (TEST-NET-3)
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, and the limited broadcast address
]);

const NON_PUBLIC_IPV6 = Object.freeze([
  // Outside 2000::/3: unspecified, loopback, the local-use NAT64 prefix, discard,
  // SRv6, unique local, link-local and multicast among them.
  '::/3',
  '4000::/2',
  '8000::/1',
  // IETF protocol assignments: Teredo, benchmarking, ORCHID, and the anycast and
  // service blocks inside it, none of which serve HTTP.
  '2001::/23',
  '2001:db8::/32', // documentation
  '3fff::/20', // documentation
]);

// IPv6 prefixes whose addresses carry an IPv4 address, and the 16-bit groups it
// occupies.
const IPV4_CARRIERS = Object.freeze([
  { cidr: '::ffff:0:0/96', groups: [6, 7] }, // IPv4-mapped
  { cidr: '64:ff9b::/96', groups: [6, 7] }, // NAT64 well-known prefix
  { cidr: '2002::/16', groups: [1, 2] }, // 6to4
]);

// One BlockList per family: a BlockList also checks an IPv4 address against its
// IPv6 rules, in the address's IPv4-mapped form.
function blockListOf(cidrs, family) {
  const list = new net.BlockList();
  cidrs.forEach((cidr) => {
    const [address, prefix] = cidr.split('/');
    list.addSubnet(address, Number(prefix), family);
  });
  return list;
}

const ipv4BlockList = blockListOf(NON_PUBLIC_IPV4, 'ipv4');
const ipv6BlockList = blockListOf(NON_PUBLIC_IPV6, 'ipv6');
const carriers = IPV4_CARRIERS.map(({ cidr, groups }) => ({ carrier: blockListOf([cidr], 'ipv6'), groups }));

/**
 * The eight 16-bit groups of an IPv6 address.
 * @param {string} address A valid IPv6 address, without brackets or a zone.
 * @returns {number[]}
 */
function ipv6Groups(address) {
  let text = address.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const parse = (part) => (part ? part.split(':').map((group) => parseInt(group, 16)) : []);
  if (tail === undefined) return parse(head);
  const headGroups = parse(head);
  const tailGroups = parse(tail);
  return [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill(0), ...tailGroups];
}

/**
 * The IPv4 address an IPv6 address carries, when it lies in one of IPV4_CARRIERS.
 * @param {string} address A valid IPv6 address, without brackets or a zone.
 * @returns {?string}
 */
function carriedIpv4(address) {
  const match = carriers.find(({ carrier }) => carrier.check(address, 'ipv6'));
  if (!match) return null;
  const groups = ipv6Groups(address);
  const [high, low] = match.groups.map((index) => groups[index]);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/**
 * Whether an address lies in a non-public range. An IPv6 address that carries an
 * IPv4 address (::ffff:10.0.0.1, 64:ff9b::a00:1, 2002:a00:1::1) is judged by
 * that IPv4 address.
 * @param {string} address An IP address, without brackets or a zone.
 * @returns {boolean} False for anything that is not an IP address.
 */
function isNonPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return false;
  if (family === 4) return ipv4BlockList.check(address, 'ipv4');
  const ipv4 = carriedIpv4(address);
  if (ipv4) return ipv4BlockList.check(ipv4, 'ipv4');
  return ipv6BlockList.check(address, 'ipv6');
}

module.exports = {
  NON_PUBLIC_IPV4,
  NON_PUBLIC_IPV6,
  isNonPublicAddress,
};
