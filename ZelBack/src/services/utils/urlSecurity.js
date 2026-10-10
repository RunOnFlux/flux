/**
 * URL Security Module
 *
 * Provides URL validation functions to prevent Server-Side Request Forgery (SSRF)
 * attacks (CWE-918).
 *
 * Blocks requests to:
 * - Every non-public address range (nonPublicNetworks): private, loopback,
 *   link-local and cloud metadata, carrier-grade NAT, and IANA's reserved ranges
 * - Local and metadata hostnames (localhost, metadata.google.internal)
 * - Non-HTTP(S) protocols
 */

const { URL } = require('url');
const net = require('net');
const http = require('http');
const https = require('https');
const dnsLookup = require('./dnsLookup');
const { isNonPublicAddress } = require('./nonPublicNetworks');

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
 * Check if an IP address is in a blocked range. An IPv4-mapped IPv6 address is
 * judged by the IPv4 address it carries.
 *
 * @param {string} ip - IP address to check, brackets and zone allowed
 * @returns {boolean} True if IP is blocked; false for anything that is not an IP
 */
function isBlockedIP(ip) {
  if (!ip || typeof ip !== 'string') {
    return true; // Block if no IP provided
  }
  return isNonPublicAddress(normalizeIpString(ip));
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
  BLOCKED_HOSTNAMES,
  ALLOWED_PROTOCOLS,
};
