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
const dns = require('dns');
const { promisify } = require('util');

const dnsLookup = promisify(dns.lookup);

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
 *
 * @param {string} ip - IP address to check
 * @returns {boolean} True if IP is blocked
 */
function isBlockedIP(ip) {
  if (!ip || typeof ip !== 'string') {
    return true; // Block if no IP provided
  }

  // Strip brackets from IPv6 addresses (URL hostname format is [::1])
  let normalizedIp = ip;
  if (ip.startsWith('[') && ip.endsWith(']')) {
    normalizedIp = ip.slice(1, -1);
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
 * Validate a URL with DNS resolution to catch DNS rebinding attacks.
 * This resolves the hostname and verifies the resolved IP is not blocked.
 *
 * @param {string} inputUrl - URL to validate
 * @param {object} options - Validation options (same as validateUrl)
 * @returns {Promise<string>} The validated URL
 * @throws {Error} If URL is invalid, blocked, or resolves to a blocked IP
 *
 * @example
 * await validateUrlWithDns('https://example.com/file.tar.gz')  // Returns URL
 * await validateUrlWithDns('http://evil.com/')  // Throws if evil.com resolves to 127.0.0.1
 */
async function validateUrlWithDns(inputUrl, options = {}) {
  const { allowPrivate = false } = options;

  // First, perform basic validation
  const validatedUrl = validateUrl(inputUrl, options);

  // Parse URL to get hostname
  const parsed = new URL(validatedUrl);
  const { hostname } = parsed;

  // Skip DNS check if hostname is already an IP
  // (already validated by validateUrl)
  if (isBlockedIP(hostname)) {
    // This shouldn't happen as validateUrl already checks, but double-check
    throw new Error('Access to private/internal IP addresses is not allowed');
  }

  // If not an IP address, resolve DNS and check the result
  // Skip if allowPrivate is true
  if (!allowPrivate) {
    // Check if hostname looks like an IP address
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^[0-9a-fA-F:]+$/;

    if (!ipv4Pattern.test(hostname) && !ipv6Pattern.test(hostname)) {
      try {
        const result = await dnsLookup(hostname, { all: true });
        const addresses = Array.isArray(result) ? result : [result];

        for (const addr of addresses) {
          const ip = addr.address || addr;
          if (isBlockedIP(ip)) {
            throw new Error(`Hostname '${hostname}' resolves to blocked IP address`);
          }
        }
      } catch (error) {
        if (error.code === 'ENOTFOUND') {
          throw new Error(`Hostname '${hostname}' could not be resolved`);
        }
        // Re-throw our own errors
        if (error.message.includes('resolves to blocked')) {
          throw error;
        }
        // For other DNS errors, allow the request to proceed
        // (the actual HTTP request will fail if DNS is truly broken)
      }
    }
  }

  return validatedUrl;
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

module.exports = {
  validateUrl,
  validateUrlWithDns,
  isUrlSafe,
  isBlockedIP,
  isBlockedHostname,
  // Export constants for testing
  BLOCKED_IPV4_PATTERNS,
  BLOCKED_IPV6_PATTERNS,
  BLOCKED_HOSTNAMES,
  ALLOWED_PROTOCOLS,
};
