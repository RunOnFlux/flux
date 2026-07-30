// IP address arithmetic for placement fault domains.
//
// All values are carried as BigInt (IPv4 fits, IPv6 needs it) so ranges and
// prefixes compare uniformly across both versions. Inputs are bare IP strings -
// callers holding an ip:port socket address must extractIp() first; a string
// containing a port does not parse here.

const net = require('node:net');

const IPV4_BITS = 32;
const IPV6_BITS = 128;
// ::ffff:0:0/96 - IPv4 addresses embedded in IPv6 notation
const V4_MAPPED_PREFIX = 0xffffn << 32n;
const V4_MAPPED_MASK = ~0xffffffffn;

/**
 * Parse a bare IPv4 or IPv6 address into integer form.
 * IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) normalize to version 4.
 * @param {string} ip Bare IP address, no port
 * @returns {{version: 4|6, value: BigInt} | null} null when not a valid bare IP
 */
function parseIp(ip) {
  if (typeof ip !== 'string') return null;
  if (net.isIPv4(ip)) {
    const [a, b, c, d] = ip.split('.').map(Number);
    return { version: 4, value: BigInt((((a * 256 + b) * 256 + c) * 256) + d) };
  }
  if (net.isIPv6(ip)) {
    let groupsPart = ip;
    let value = 0n;
    let tailBits = 0;
    const v4TailMatch = ip.match(/:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4TailMatch) {
      const tail = parseIp(v4TailMatch[1]);
      if (!tail) return null;
      ({ value } = tail);
      tailBits = 32;
      groupsPart = ip.slice(0, -v4TailMatch[1].length);
    }
    const halves = groupsPart.split('::');
    const headGroups = halves[0] ? halves[0].split(':').filter(Boolean) : [];
    const tailGroups = halves.length > 1 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
    const presentGroups = headGroups.length + tailGroups.length + tailBits / 16;
    const missing = halves.length > 1 ? 8 - presentGroups : 0;
    const allGroups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
    let acc = 0n;
    allGroups.forEach((group) => { acc = (acc << 16n) + BigInt(parseInt(group, 16)); });
    value += acc << BigInt(tailBits);
    if ((value & V4_MAPPED_MASK) === V4_MAPPED_PREFIX) {
      return { version: 4, value: value & 0xffffffffn };
    }
    return { version: 6, value };
  }
  return null;
}

/**
 * Render an integer-form address back to its canonical string.
 * @param {BigInt} value Integer form
 * @param {4|6} version IP version
 * @returns {string}
 */
function formatIp(value, version) {
  if (version === 4) {
    const v = Number(value);
    // eslint-disable-next-line no-bitwise
    return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
  }
  const groups = [];
  for (let i = 7; i >= 0; i -= 1) {
    groups.push(Number((value >> BigInt(i * 16)) & 0xffffn).toString(16));
  }
  // RFC 5952: compress the longest run of zero groups (leftmost on ties)
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] !== '0') continue;
    let len = 0;
    while (i + len < groups.length && groups[i + len] === '0') len += 1;
    if (len > bestLen) { bestStart = i; bestLen = len; }
  }
  if (bestLen < 2) return groups.join(':');
  const head = groups.slice(0, bestStart).join(':');
  const tail = groups.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

/**
 * Canonical network prefix for an address, e.g. ("80.95.213.209", 16) -> "80.95.0.0/16".
 * @param {string} ip Bare IP address
 * @param {number} bits Prefix length, 0..32 for IPv4 and 0..128 for IPv6
 * @returns {string | null} null when the address or prefix length is invalid
 */
function prefixKey(ip, bits) {
  const parsed = parseIp(ip);
  if (!parsed) return null;
  const width = parsed.version === 4 ? IPV4_BITS : IPV6_BITS;
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const shift = BigInt(width - bits);
  // eslint-disable-next-line no-bitwise
  const base = (parsed.value >> shift) << shift;
  return `${formatIp(base, parsed.version)}/${bits}`;
}

/**
 * Whether two addresses fall inside the same prefix. Addresses of different
 * IP versions never share a prefix.
 * @param {string} ipA Bare IP address
 * @param {string} ipB Bare IP address
 * @param {number} bits Prefix length
 * @returns {boolean}
 */
function sameSubnet(ipA, ipB, bits) {
  const keyA = prefixKey(ipA, bits);
  const keyB = prefixKey(ipB, bits);
  return keyA !== null && keyA === keyB;
}

module.exports = {
  parseIp,
  formatIp,
  prefixKey,
  sameSubnet,
};
