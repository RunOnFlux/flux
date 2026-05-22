// Socket address utility functions for consistent ip:port handling.
//
// TODO: Once all nodes run fluxbench with always-attached port,
// normalizeSocketAddress becomes a no-op and socketAddressesMatch
// becomes ===. At that point simplify or remove this module.

const DEFAULT_API_PORT = 16127;

function normalizeSocketAddress(address) {
  if (!address) return null;
  if (address.includes(':')) return address;
  return `${address}:${DEFAULT_API_PORT}`;
}

function extractIp(address) {
  if (!address) return null;
  return address.split(':')[0];
}

function extractPort(address) {
  if (!address) return DEFAULT_API_PORT;
  const parts = address.split(':');
  return parts.length > 1 ? +parts[1] : DEFAULT_API_PORT;
}

function socketAddressesMatch(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const normalA = normalizeSocketAddress(a);
  const normalB = normalizeSocketAddress(b);
  return normalA === normalB;
}

module.exports = {
  DEFAULT_API_PORT,
  normalizeSocketAddress,
  extractIp,
  extractPort,
  socketAddressesMatch,
};
