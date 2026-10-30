'use strict';

const net = require('net');
const messageHelper = require('../messageHelper');
const policyStore = require('../policyStore');
const { resolveClientIp } = require('../utils/ingressCapture');

// The addresses whose app messages no node takes: the `client` entries of the
// network blocklist. A caller in one of their ranges is refused at every route
// that takes or prepares an app message, before the node does any work for it.
//
// An entry is in force through the UTC day its `expires` names. The ranges are
// held as one BlockList per family, rebuilt from the adopted bundle when its
// sequence or the UTC day changes; nothing is fetched to do it.

const CLIENT_RANGE = /^([^/]+)\/(\d{1,3})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FAMILY_BITS = { 4: 32, 6: 128 };

let held = { key: null, lists: null };

/**
 * One BlockList per family. A BlockList also checks an IPv4 address against its
 * IPv6 rules in the IPv4-mapped form, so the families are never mixed.
 * @param {object[]} entries The blocklist document
 * @param {string} today YYYY-MM-DD, UTC
 * @returns {{4: net.BlockList, 6: net.BlockList}}
 */
function listsOf(entries, today) {
  const lists = { 4: new net.BlockList(), 6: new net.BlockList() };
  entries.forEach((entry) => {
    if (entry?.kind !== 'client' || typeof entry.value !== 'string') return;
    if (typeof entry.expires !== 'string' || !ISO_DATE.test(entry.expires) || entry.expires < today) return;
    const match = CLIENT_RANGE.exec(entry.value);
    const family = match ? net.isIP(match[1]) : 0;
    if (!family) return;
    const prefix = Number(match[2]);
    if (prefix > FAMILY_BITS[family]) return;
    lists[family].addSubnet(match[1], prefix, family === 4 ? 'ipv4' : 'ipv6');
  });
  return lists;
}

/**
 * The ranges in force now, or null when this node holds no blocklist.
 * @returns {{4: net.BlockList, 6: net.BlockList}|null}
 */
function rangesInForce() {
  const entries = policyStore.getDocument('blocklist');
  if (!Array.isArray(entries)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const key = `${policyStore.getSeq()}:${today}`;
  if (held.key !== key) held = { key, lists: listsOf(entries, today) };
  return held.lists;
}

/**
 * Whether the caller of a request is in a banned range. Behind a balancer in
 * `fdmAddresses` the caller is the address it forwarded.
 * @param {{remoteAddress?: string, headers?: object}} client The request's socket peer and headers
 * @returns {boolean}
 */
function isBannedCaller({ remoteAddress, headers }) {
  const lists = rangesInForce();
  if (!lists) return false;
  const { ip } = resolveClientIp(remoteAddress, headers);
  const family = ip ? net.isIP(ip) : 0;
  if (!family) return false;
  return lists[family].check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Route guard for the routes that take or prepare an app message. A node that
 * holds no blocklist yet cannot know a ban, and lets the request through.
 * @param {object} req
 * @param {object} res
 * @param {function} next
 * @returns {*}
 */
function refuseBannedCaller(req, res, next) {
  if (!isBannedCaller({ remoteAddress: req.socket?.remoteAddress, headers: req.headers })) return next();
  return res.status(403).json(messageHelper.createErrorMessage('App messages from this address are not accepted', 'Forbidden', 403));
}

module.exports = {
  isBannedCaller,
  refuseBannedCaller,
};
