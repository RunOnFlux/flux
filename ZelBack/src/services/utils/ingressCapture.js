'use strict';

const net = require('net');
const config = require('config');

// What a node can honestly say about where a request came from.
//
// The socket peer is what this node saw with its own connection; a forwarding
// header is what the client said about itself. Only one of them is evidence,
// and which one applies is decided by the peer that wrote it.

/**
 * IPv4-mapped IPv6 (::ffff:1.2.3.4) → 1.2.3.4; a genuine IPv6 address is left
 * intact.
 *
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function normalizeIp(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  return raw.replace(/^::ffff:/i, '');
}

/**
 * Who called, as opposed to who connected.
 *
 * A node behind a balancer sees the balancer as its socket peer, so the caller's
 * address exists only in a header — and a header is only worth reading when the
 * peer that wrote it is one we recognise. Every node is also reachable directly
 * on its public port, so a forwarding header from an unknown peer was chosen by
 * the caller and means nothing.
 *
 * Reads the LAST entry. The balancer appends its own view of the connection
 * after whatever the caller sent, and a caller cannot write past that, so the
 * final entry is the only one written by something we trust. Anything to its
 * left came from the caller: a request arriving as
 * `X-Forwarded-For: 203.0.113.99, 198.51.100.25` is one where 203.0.113.99 is
 * the caller's invention and 198.51.100.25 is what the balancer saw.
 *
 * Node joins repeated headers with ", ", so one split covers both a single
 * header and the several a chain of proxies produces.
 *
 * @param {string|null|undefined} connectingIp the raw socket peer
 * @param {object|undefined} headers the request headers
 * @returns {{ip: string|null, source: 'socket'|'forwarded'}}
 */
function resolveClientIp(connectingIp, headers) {
  const peer = normalizeIp(connectingIp);
  const socketAnswer = { ip: peer, source: 'socket' };

  if (!peer) return socketAnswer;

  // `has` first: config.get raises by name on a key a deployment does not ship,
  // and this sits on a request path. No list is the same as an empty one - trust
  // nothing, and answer with what the socket saw.
  const trusted = (config.has('fdmAddresses') && config.get('fdmAddresses')) || [];
  if (!trusted.includes(peer)) return socketAnswer;

  const raw = headers && headers['x-forwarded-for'];
  const joined = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof joined !== 'string' || !joined) return socketAnswer;

  const entries = joined.split(',');
  const candidate = normalizeIp(entries[entries.length - 1].trim());

  // A malformed final entry means the chain cannot be read, which is not a
  // licence to read a different part of it — fall back to what we saw ourselves.
  if (!candidate || net.isIP(candidate) === 0) return socketAnswer;

  return { ip: candidate, source: 'forwarded' };
}

module.exports = {
  normalizeIp,
  resolveClientIp,
};
