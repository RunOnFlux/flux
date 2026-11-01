'use strict';

const net = require('net');
const config = require('config');
const log = require('../../lib/log');
const policyStore = require('../policyStore');
const { isTrustedBalancer, resolveClientIp } = require('./ingressCapture');
const { policyRange } = require('./policyRanges');

// How many unpaid app messages a node takes from one client and from one
// admitting operator, read from the `unpaidallowances` document of the signed
// policy bundle:
//
//   { clientTagCap, originKeyCap, submitters: [{ value, cap, reason, added, expires }] }
//
// A submitter is a range whose callers submit for many clients from one
// address. The node that admits a message from one writes the range's cap into
// the message, under that node's signature; every node takes a written cap up to
// the largest any range has. A node that lies about a cap gains nothing it could
// not already have by tagging each message as a fresh client: both are held to
// its operator's allowance.
//
// A node holding no readable document uses fluxapps.clientTagCap and
// fluxapps.originKeyCap, and grants no submitter a cap of its own. A submitter
// entry is in force through the UTC day its `expires` names, and only for a range
// within the policy floors (utils/policyRanges).

const DOCUMENT = 'unpaidallowances';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let held = { key: null, allowances: null };

const isCap = (value) => Number.isInteger(value) && value > 0;

/**
 * The allowances a document states, or null when it is not the shape this code
 * reads.
 * @param {*} document
 * @returns {{clientTagCap: number, originKeyCap: number, submitters: object[]}|null}
 */
function readDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const { clientTagCap, originKeyCap, submitters } = document;
  if (!isCap(clientTagCap) || !isCap(originKeyCap) || clientTagCap > originKeyCap) return null;
  if (!Array.isArray(submitters)) return null;
  const valid = submitters.every((entry) => entry && typeof entry.value === 'string'
    && isCap(entry.cap) && entry.cap >= clientTagCap && entry.cap <= originKeyCap
    && typeof entry.expires === 'string' && ISO_DATE.test(entry.expires));
  return valid ? { clientTagCap, originKeyCap, submitters } : null;
}

/**
 * One list of ranges per family and cap, for the entries in force today.
 * @param {object[]} submitters
 * @param {string} today YYYY-MM-DD, UTC
 * @returns {{cap: number, lists: {4: net.BlockList, 6: net.BlockList}}[]} Highest cap first.
 */
function rangesOf(submitters, today) {
  const byCap = new Map();
  submitters.forEach((entry) => {
    if (entry.expires < today) return;
    const range = policyRange(entry.value);
    if (!range) {
      log.error(`unpaidAllowances - submitter ${entry.value} is not a range within the policy floors; granted nothing`);
      return;
    }
    if (!byCap.has(entry.cap)) byCap.set(entry.cap, { 4: new net.BlockList(), 6: new net.BlockList() });
    byCap.get(entry.cap)[range.family].addSubnet(range.address, range.prefix, range.type);
  });
  return [...byCap].sort(([a], [b]) => b - a).map(([cap, lists]) => ({ cap, lists }));
}

/**
 * The allowances in force now.
 * @returns {{clientTagCap: number, originKeyCap: number, largestClientCap: number,
 *   ranges: {cap: number, lists: object}[]}}
 */
function allowances() {
  const document = policyStore.getDocument(DOCUMENT);
  const today = new Date().toISOString().slice(0, 10);
  const key = `${policyStore.getSeq()}:${today}`;
  if (held.key === key) return held.allowances;

  const read = document === null ? null : readDocument(document);
  if (document !== null && read === null) log.error(`unpaidAllowances - ${DOCUMENT} in the signed bundle is not the shape this node reads; using the release defaults`);
  const { clientTagCap, originKeyCap } = read ?? config.fluxapps;
  const ranges = read ? rangesOf(read.submitters, today) : [];
  held = {
    key,
    allowances: {
      clientTagCap,
      originKeyCap,
      largestClientCap: ranges.length ? ranges[0].cap : clientTagCap,
      ranges,
    },
  };
  return held.allowances;
}

/**
 * The cap a submitter range grants the caller of a request, or null when no
 * range in force holds it. Behind a balancer in `fdmAddresses` the caller is the
 * address it forwarded; a balancer that forwarded none is never a submitter.
 * @param {{remoteAddress?: string, headers?: object}} client
 * @returns {number|null}
 */
function submitterCap({ remoteAddress, headers }) {
  const { ranges } = allowances();
  if (ranges.length === 0) return null;
  const { ip, source } = resolveClientIp(remoteAddress, headers);
  if (source === 'socket' && isTrustedBalancer(ip)) return null;
  const family = ip ? net.isIP(ip) : 0;
  if (!family) return null;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  const range = ranges.find(({ lists }) => lists[family].check(ip, type));
  return range ? range.cap : null;
}

module.exports = {
  allowances,
  submitterCap,
};
