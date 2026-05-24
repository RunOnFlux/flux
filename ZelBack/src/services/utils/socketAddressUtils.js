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

const ipPattern = /^(?!0)(?!.*\.$)(?:(?:1?\d?\d|25[0-5]|2[0-4]\d)(?:\.|$)){4}$/;

function parseSocketAddress(raw) {
  if (typeof raw !== 'string') return null;
  const ip = extractIp(raw);
  const port = extractPort(raw);
  if (!ipPattern.test(ip) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { ip, port };
}

function socketAddressesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const normalA = normalizeSocketAddress(a);
  const normalB = normalizeSocketAddress(b);
  return normalA === normalB;
}

module.exports = {
  DEFAULT_API_PORT,
  normalizeSocketAddress,
  extractIp,
  extractPort,
  parseSocketAddress,
  socketAddressesMatch,
};
