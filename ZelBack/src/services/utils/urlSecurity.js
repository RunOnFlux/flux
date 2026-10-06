/**
 * URL Security Module
 *
 * Provides URL validation functions to prevent Server-Side Request Forgery (SSRF)
 * attacks (CWE-918).
 *
 * Blocks requests to:
 * - Private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
 * - Loopback addresses (127.x.x.x, ::1, localhost)
 * - Link-local addresses (169.254.x.x, fe80::)
 * - Cloud metadata endpoints (169.254.169.254, metadata.google.internal)
 * - Non-HTTP(S) protocols
 */

const { URL } = require('url');
const net = require('net');
const http = require('http');
const https = require('https');
const dnsLookup = require('./dnsLookup');

/**
 * Normalize an IP string by removing brackets and zone identifiers.
 * @param {string} ip - IP address to normalize
 * @returns {string} Normalized IP address
 */
function normalizeIpString(ip) {
  if (!ip || typeof ip !== 'string') {
    return ip;
  }
  let normalized = ip;
  // Strip brackets from IPv6 (URL format is [::1])
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  // Remove zone identifier (e.g., fe80::1%eth0 -> fe80::1)
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) {
    normalized = normalized.slice(0, zoneIndex);
  }
  return normalized;
}

/**
 * Convert IPv6-mapped IPv4 address to IPv4.
 * Handles both dotted-decimal (::ffff:127.0.0.1) and hex (::ffff:7f00:1) forms.
 * @param {string} ip - IPv6 address to check
 * @returns {string|null} IPv4 address if mapped, null otherwise
 */
function ipv6MappedToIpv4(ip) {
  if (!ip || typeof ip !== 'string') {
    return null;
  }
  const normalized = ip.toLowerCase();

  // Check for ::ffff: prefix (IPv6-mapped IPv4)
  if (!normalized.startsWith('::ffff:')) {
    return null;
  }

  const suffix = normalized.slice(7); // Remove '::ffff:'

  // Dotted-decimal form: ::ffff:127.0.0.1
  if (suffix.includes('.')) {
    // Validate it looks like an IPv4
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(suffix)) {
      return suffix;
    }
    return null;
  }

  // Hex form: ::ffff:7f00:1 -> 127.0.0.1
  // The last 32 bits are in the format XXXX:XXXX where each X is a hex digit
  const hexMatch = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }

  return null;
}

/**
 * IPv4 private/reserved ranges that should be blocked
 */
const BLOCKED_IPV4_PATTERNS = [
  /^127\./, // Loopback (127.0.0.0/8)
  /^10\./, // Private Class A (10.0.0.0/8)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B (172.16.0.0/12)
  /^192\.168\./, // Private Class C (192.168.0.0/16)
  /^169\.254\./, // Link-local (169.254.0.0/16) - includes cloud metadata
  /^0\./, // Current network (0.0.0.0/8)
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // Carrier-grade NAT (100.64.0.0/10)
  /^192\.0\.0\./, // IETF Protocol Assignments (192.0.0.0/24)
  /^192\.0\.2\./, // Documentation (TEST-NET-1)
  /^198\.51\.100\./, // Documentation (TEST-NET-2)
  /^203\.0\.113\./, // Documentation (TEST-NET-3)
  /^224\./, // Multicast (224.0.0.0/4)
  /^240\./, // Reserved (240.0.0.0/4)
  /^255\.255\.255\.255$/, // Broadcast
];

/**
 * IPv6 private/reserved patterns that should be blocked
 */
const BLOCKED_IPV6_PATTERNS = [
  /^::1$/, // Loopback
  /^fe80:/i, // Link-local
  /^fc00:/i, // Unique local (fc00::/7)
  /^fd[0-9a-f]{2}:/i, // Unique local
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|169\.254\.)/i, // IPv4-mapped
  /^ff[0-9a-f]{2}:/i, // Multicast
  /^::$/i, // Unspecified address
];

/**
 * Hostnames that should always be blocked
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
];

/**
 * Allowed protocols for remote URLs
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Check if an IP address is in a blocked range.
 * Handles IPv6-mapped IPv4 addresses by extracting and checking the IPv4 portion.
 *
 * @param {string} ip - IP address to check
 * @returns {boolean} True if IP is blocked
 */
function isBlockedIP(ip) {
  if (!ip || typeof ip !== 'string') {
    return true; // Block if no IP provided
  }

  // Normalize the IP (strip brackets, zone identifiers)
  const normalizedIp = normalizeIpString(ip);

  // Check for IPv6-mapped IPv4 addresses (e.g., ::ffff:127.0.0.1)
  // These need to be checked against IPv4 patterns
  const mappedIpv4 = ipv6MappedToIpv4(normalizedIp);
  if (mappedIpv4) {
    // Check the extracted IPv4 against IPv4 patterns
    for (const pattern of BLOCKED_IPV4_PATTERNS) {
      if (pattern.test(mappedIpv4)) {
        return true;
      }
    }
    // If mapped IPv4 is not blocked, it's safe
    return false;
  }

  // Check IPv4 patterns
  for (const pattern of BLOCKED_IPV4_PATTERNS) {
    if (pattern.test(normalizedIp)) {
      return true;
    }
  }

  // Check IPv6 patterns
  for (const pattern of BLOCKED_IPV6_PATTERNS) {
    if (pattern.test(normalizedIp)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a hostname is in the blocklist.
 *
 * @param {string} hostname - Hostname to check
 * @returns {boolean} True if hostname is blocked
 */
function isBlockedHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return true;
  }

  const normalizedHostname = hostname.toLowerCase().trim();

  // Check exact matches
  if (BLOCKED_HOSTNAMES.includes(normalizedHostname)) {
    return true;
  }

  // Check if hostname ends with a blocked suffix (e.g., .localhost)
  for (const blocked of BLOCKED_HOSTNAMES) {
    if (normalizedHostname.endsWith(`.${blocked}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a URL to prevent SSRF attacks.
 * This performs synchronous validation without DNS resolution.
 *
 * @param {string} inputUrl - URL to validate
 * @param {object} options - Validation options
 * @param {boolean} options.allowPrivate - Allow private IP ranges (default: false)
 * @param {string[]} options.allowedProtocols - Allowed protocols (default: ['http:', 'https:'])
 * @param {string[]} options.allowedHosts - If provided, only these hosts are allowed
 * @returns {string} The validated URL
 * @throws {Error} If URL is invalid or blocked
 *
 * @example
 * validateUrl('https://example.com/file.tar.gz')  // Returns URL
 * validateUrl('http://127.0.0.1/admin')  // Throws: blocked IP
 * validateUrl('http://localhost/admin')  // Throws: blocked hostname
 * validateUrl('file:///etc/passwd')  // Throws: protocol not allowed
 */
function validateUrl(inputUrl, options = {}) {
  const {
    allowPrivate = false,
    allowedProtocols = ALLOWED_PROTOCOLS,
    allowedHosts = null,
  } = options;

  if (!inputUrl || typeof inputUrl !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  // Parse the URL
  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch (error) {
    throw new Error('Invalid URL format');
  }

  // Check protocol
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`Protocol '${parsed.protocol}' is not allowed. Allowed: ${allowedProtocols.join(', ')}`);
  }

  // Get hostname
  const { hostname } = parsed;

  // Check if hostname is blocked
  if (isBlockedHostname(hostname)) {
    throw new Error('Access to this hostname is not allowed');
  }

  // Check if hostname is an IP address and if it's blocked
  if (!allowPrivate && isBlockedIP(hostname)) {
    throw new Error('Access to private/internal IP addresses is not allowed');
  }

  // If allowedHosts is specified, check against allowlist
  if (allowedHosts && Array.isArray(allowedHosts)) {
    const normalizedHostname = hostname.toLowerCase();
    const isAllowed = allowedHosts.some((allowed) => {
      const normalizedAllowed = allowed.toLowerCase();
      return normalizedHostname === normalizedAllowed
        || normalizedHostname.endsWith(`.${normalizedAllowed}`);
    });

    if (!isAllowed) {
      throw new Error('Host is not in the allowed list');
    }
  }

  return parsed.href;
}

/**
 * Check if a URL is safe without throwing an error.
 *
 * @param {string} inputUrl - URL to check
 * @param {object} options - Validation options
 * @returns {boolean} True if URL is safe, false otherwise
 */
function isUrlSafe(inputUrl, options = {}) {
  try {
    validateUrl(inputUrl, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * The error a blocked address raises. Coded so a consumer can tell it apart from
 * a genuine connectivity failure: the host resolved fine, we refused to talk to
 * it, and retrying will never change that.
 */
const BLOCKED_ADDRESS_CODE = 'EBLOCKEDADDRESS';

function blockedAddressError(hostname, address) {
  const error = new Error(`Refusing to connect to ${hostname}: ${address} is a private or reserved address`);
  error.code = BLOCKED_ADDRESS_CODE;
  return error;
}

/**
 * Whether a host is a literal IP address that must not be dialled.
 *
 * @param {string} host hostname or address, without a port or brackets
 * @returns {boolean}
 */
function isBlockedAddressLiteral(host) {
  return Boolean(host) && net.isIP(host) !== 0 && isBlockedIP(host);
}

/**
 * A `lookup` for an http/https Agent that refuses private and reserved
 * addresses at CONNECT time.
 *
 * Checking a URL before the request is not enough on its own: between the check
 * and the connection the name can resolve to something else (DNS rebinding), and
 * the connection is what actually matters. Node calls this immediately before
 * connecting and uses the address it returns, so what is checked is what is
 * dialled.
 *
 * The name is resolved by dnsLookup, as every other request FluxOS makes is.
 *
 * @param {string} hostname
 * @param {object|Function} options dns.lookup options, or the callback
 * @param {Function} [callback]
 */
function guardedLookup(hostname, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : (options || {});

  dnsLookup.lookup(hostname, opts, (error, address, family) => {
    if (error) {
      done(error);
      return;
    }

    // With `all`, Node asks for every address and picks among them - so drop the
    // blocked ones and fail only if nothing safe is left. Otherwise a host with
    // one public and one loopback record would be a coin toss.
    if (opts.all) {
      const permitted = address.filter((entry) => !isBlockedIP(entry.address));
      if (!permitted.length) {
        done(blockedAddressError(hostname, address.map((entry) => entry.address).join(', ')));
        return;
      }
      done(null, permitted);
      return;
    }

    if (isBlockedIP(address)) {
      done(blockedAddressError(hostname, address));
      return;
    }

    done(null, address, family);
  });
}

/**
 * The refusal for a connection about to be made to `options.host`, or null if it may proceed.
 * Node hands an Agent's createConnection the host the socket is about to dial, after URL parsing
 * has normalised it (`2130706433`, `127.1` and `0x7f.0.0.1` all arrive as `127.0.0.1`), so the
 * address checked is the address dialled. Node resolves nothing for an address, so guardedLookup
 * never sees one; a hostname passes here and is resolved through guardedLookup.
 *
 * @param {{host?: string}} options the options createConnection was called with
 * @returns {Error|null}
 */
function connectionRefusal(options) {
  return isBlockedAddressLiteral(options.host) ? blockedAddressError(options.host, options.host) : null;
}

/**
 * An http.Agent that refuses private and reserved addresses on every connection, before any
 * packet is sent. Its options are the global agent's, so a guarded request is pooled and kept
 * alive as any other request is; only the address check differs.
 */
class GuardedHttpAgent extends http.Agent {
  constructor() {
    super({ ...http.globalAgent.options, lookup: guardedLookup });
  }

  createConnection(options, callback) {
    const refusal = connectionRefusal(options);
    if (refusal) {
      callback(refusal);
      return undefined;
    }
    return super.createConnection(options, callback);
  }
}

/**
 * An https.Agent that refuses private and reserved addresses on every connection, before any
 * packet is sent. Its options are the global agent's, so a guarded request is pooled and kept
 * alive as any other request is; only the address check differs.
 */
class GuardedHttpsAgent extends https.Agent {
  constructor() {
    super({ ...https.globalAgent.options, lookup: guardedLookup });
  }

  createConnection(options, callback) {
    const refusal = connectionRefusal(options);
    if (refusal) {
      callback(refusal);
      return undefined;
    }
    return super.createConnection(options, callback);
  }
}

/**
 * The process's guarded agents. Node's global agents carry every request whose destination
 * FluxOS chose, including its own services on loopback and peers on private networks; these
 * carry every request whose destination someone else chose.
 */
const guardedAgents = {
  httpAgent: new GuardedHttpAgent(),
  httpsAgent: new GuardedHttpsAgent(),
};

/**
 * axios options that keep a request off private and reserved addresses on every hop. The agents
 * check each connection as it is made, so the first request, every redirect it follows, and a
 * redirect from one scheme to the other are all guarded by the same check.
 *
 * Every request whose destination someone else chooses - a registry named in an app spec, a URL
 * such a registry hands back, a URL a user asks the node to download - is made with these.
 *
 * @returns {{httpAgent: GuardedHttpAgent, httpsAgent: GuardedHttpsAgent}}
 */
function guardedRequestOptions() {
  return { ...guardedAgents };
}

module.exports = {
  validateUrl,
  isUrlSafe,
  isBlockedIP,
  isBlockedHostname,
  guardedLookup,
  guardedRequestOptions,
  GuardedHttpAgent,
  GuardedHttpsAgent,
  isBlockedAddressLiteral,
  blockedAddressError,
  BLOCKED_ADDRESS_CODE,
  // Helper functions for testing
  normalizeIpString,
  ipv6MappedToIpv4,
  // Export constants for testing
  BLOCKED_IPV4_PATTERNS,
  BLOCKED_IPV6_PATTERNS,
  BLOCKED_HOSTNAMES,
  ALLOWED_PROTOCOLS,
};
