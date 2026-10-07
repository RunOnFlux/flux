/**
 * Address ranges that are not the public internet: private networks, carrier-grade
 * NAT, loopback, link-local (a cloud host's metadata service), and the ranges IANA
 * reserves for documentation, benchmarking, multicast and future use.
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
  '::/128', // unspecified
  '::1/128', // loopback
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'ff00::/8', // multicast
]);

const blockList = new net.BlockList();
NON_PUBLIC_IPV4.forEach((cidr) => {
  const [address, prefix] = cidr.split('/');
  blockList.addSubnet(address, Number(prefix), 'ipv4');
});
NON_PUBLIC_IPV6.forEach((cidr) => {
  const [address, prefix] = cidr.split('/');
  blockList.addSubnet(address, Number(prefix), 'ipv6');
});

/**
 * Whether an address lies in a non-public range. An IPv4-mapped IPv6 address
 * (::ffff:10.0.0.1, ::ffff:a00:1) is judged by the IPv4 address it carries.
 * @param {string} address An IP address, without brackets or a zone.
 * @returns {boolean} False for anything that is not an IP address.
 */
function isNonPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return false;
  return blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

module.exports = {
  NON_PUBLIC_IPV4,
  NON_PUBLIC_IPV6,
  isNonPublicAddress,
};
