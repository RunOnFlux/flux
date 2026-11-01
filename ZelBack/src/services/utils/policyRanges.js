'use strict';

const net = require('net');

// An address range a network policy entry names: a client ban, or a submitter
// range granted its own allowance. A node takes a range only within the floors
// the policy repository's validator holds every entry to (scripts/blocklist.js
// in fluxos-network-policy), so an entry that reached the bundle outside them
// can neither ban nor grant a block of the internet: IPv4 from /24 (one small
// hosting range) to /32, IPv6 from /48 (one site) to /64, the smallest block one
// customer is given.

const RANGE = /^([^/]+)\/(\d{1,3})$/;
const PREFIX_BOUNDS = { 4: { min: 24, max: 32 }, 6: { min: 48, max: 64 } };

/**
 * The range a policy entry's value names, or null when it is not a CIDR within
 * the floors.
 * @param {*} value
 * @returns {{address: string, prefix: number, family: 4|6, type: 'ipv4'|'ipv6'}|null}
 */
function policyRange(value) {
  if (typeof value !== 'string') return null;
  const match = RANGE.exec(value);
  const family = match ? net.isIP(match[1]) : 0;
  if (!family) return null;
  const prefix = Number(match[2]);
  const { min, max } = PREFIX_BOUNDS[family];
  if (prefix < min || prefix > max) return null;
  return {
    address: match[1], prefix, family, type: family === 4 ? 'ipv4' : 'ipv6',
  };
}

module.exports = {
  PREFIX_BOUNDS,
  policyRange,
};
