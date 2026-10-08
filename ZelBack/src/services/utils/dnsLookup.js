/**
 * How the main thread's global http and https agents resolve a hostname.
 *
 * Resolution goes through three sources, and the first that yields an address answers:
 *
 * 1. The system's DNS servers - the ones Node reads from /etc/resolv.conf at start, which on a
 *    host running systemd-resolved is its local stub - each asked on its own, in order.
 * 2. Public DNS servers, asked only when no system server gave an address and none answered that
 *    the name does not exist or has no records. They are a source of their own rather than
 *    further entries in a system resolver's server list: a DNS client moves to its next server
 *    only when one does not answer at all, so a server that answers with a failure (SERVFAIL,
 *    REFUSED) would otherwise end the lookup with the next servers never asked.
 * 3. The operating system's resolver (`dns.lookup`), which also reads /etc/hosts and
 *    nsswitch. Its error is the lookup's error when nothing answers.
 *
 * Within a source, IPv4 and IPv6 are queried separately, and a source that returns addresses
 * for either family answers with them. A router that answers AAAA queries with SERVFAIL
 * therefore leaves a hostname with its IPv4 addresses instead of without any. Once one family
 * has answered with addresses, the other is waited for only RESOLUTION_DELAY_MS, so a router
 * that never answers AAAA queries costs a lookup that delay, not the query timeout.
 *
 * The first two sources are queried directly and never read /etc/hosts. Each query is one try
 * of QUERY_TIMEOUT_MS.
 *
 * A system server that does not answer a lookup at all is either down or unable to resolve that
 * one name: a resolver whose upstream cannot reach a name's authoritative servers does not
 * answer for that name, and does not answer for any name once its own upstream is gone. Which
 * of the two is told by a probe for a random name under .com, sent to that server at once: no
 * cache holds an answer for a name never asked, and .com's NSEC3 opt-out denial cannot be
 * synthesised from cached records (RFC 8198), so only a server that can reach the internet's
 * DNS resolves it. The probe passes when the server resolves the name - it answers that the
 * name does not exist, or with an address - and fails otherwise, a SERVFAIL included: a
 * resolver whose upstream is gone answers some names with SERVFAIL and leaves others
 * unanswered.
 *
 * - The probe passes: the server works and the name was the failure. This lookup moves on to
 *   the next source; nothing is remembered.
 * - The probe fails: the server is remembered as silent. Later lookups skip it, so a server that
 *   is down costs one lookup. While it is silent it is probed again, with a fresh random name,
 *   once every REPROBE_MS that a lookup comes to it; no lookup waits on that probe, and the first
 *   that passes brings the server back.
 *
 * A name chosen by a caller cannot make a server silent: only the probe can, and its name is
 * random. One probe per server is in flight at a time; lookups that meet the server meanwhile
 * share its result.
 *
 * Addresses are ordered by networkDefaults' DNS_RESULT_ORDER, the order every other lookup in
 * the process uses.
 *
 * No answer is cached in the process. Every lookup asks the system's servers first unless they
 * are remembered as silent, and a local resolver caches.
 */

const crypto = require('node:crypto');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');

const { DNS_RESULT_ORDER } = require('./networkDefaults');

const PUBLIC_DNS_SERVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];

// A query's wait, in one try. c-ares's own default retries a server that does not answer for
// about 75 s (5 s, doubling, 4 tries), beyond every request timeout FluxOS sets.
const QUERY_TIMEOUT_MS = 2000;
const resolverOptions = { timeout: QUERY_TIMEOUT_MS, tries: 1 };

// How often a silent system server is probed again, while lookups come to it.
const REPROBE_MS = 30 * 1000;

const FAMILIES_IN_ORDER = DNS_RESULT_ORDER === 'ipv6first' ? [6, 4] : [4, 6];

// The codes a DNS server's answer carries when a name has no addresses of a family: an answer,
// unlike every other error, which says the query itself failed.
const NO_ADDRESS_CODES = new Set([dns.NODATA, dns.NOTFOUND]);

// The codes for a query no server answered: it timed out, or the server's host refused the
// datagram because nothing listens there.
const NO_REPLY_CODES = new Set([dns.TIMEOUT, dns.CONNREFUSED]);

// How long a resolver waits for the other family once one family has answered with addresses:
// the Resolution Delay of Happy Eyeballs v2 (RFC 8305 section 3). A server that never answers
// one family's query then costs a lookup this long, not the resolver's query timeout.
const RESOLUTION_DELAY_MS = 50;

const publicResolver = new dns.promises.Resolver(resolverOptions);
publicResolver.setServers(PUBLIC_DNS_SERVERS);

/**
 * A system server, with its own resolver and what this process knows of it.
 * @param {string} address As dns.getServers lists it.
 * @returns {{address: string, resolver: dns.promises.Resolver, silent: boolean, probedAt: number, probing: ?Promise<boolean>}}
 */
function systemServer(address) {
  const resolver = new dns.promises.Resolver(resolverOptions);
  resolver.setServers([address]);
  return {
    address, resolver, silent: false, probedAt: 0, probing: null,
  };
}

let systemServers = new dns.promises.Resolver().getServers().map(systemServer);

/**
 * @param {dns.promises.Resolver} resolver
 * @param {string} hostname
 * @param {4|6} family
 * @returns {Promise<{addresses: Array<{address: string, family: number}>, failed: boolean, noReply: boolean}>}
 *   failed: the query errored rather than being answered. noReply: the server did not answer.
 */
async function queryFamily(resolver, hostname, family) {
  try {
    const addresses = family === 4
      ? await resolver.resolve4(hostname)
      : await resolver.resolve6(hostname);
    return { addresses: addresses.map((address) => ({ address, family })), failed: false, noReply: false };
  } catch (error) {
    return { addresses: [], failed: !NO_ADDRESS_CODES.has(error.code), noReply: NO_REPLY_CODES.has(error.code) };
  }
}

/**
 * The families' results once every query has settled, or once RESOLUTION_DELAY_MS has passed
 * since the first query that answered with addresses, whichever is sooner.
 * @param {Array<Promise<{addresses: Array<{address: string, family: number}>, failed: boolean}>>} queries
 * @returns {Promise<Array<{addresses: Array<{address: string, family: number}>, failed: boolean}|null>>}
 *   Index-aligned with queries; null for a query still unsettled when the delay ran out.
 */
function settleWithResolutionDelay(queries) {
  return new Promise((resolve) => {
    const results = queries.map(() => null);
    let unsettled = queries.length;
    let delay = null;
    const finish = () => {
      clearTimeout(delay);
      resolve([...results]);
    };
    queries.forEach((query, index) => query.then((result) => {
      results[index] = result;
      unsettled -= 1;
      if (!unsettled) finish();
      else if (result.addresses.length && !delay) delay = setTimeout(finish, RESOLUTION_DELAY_MS);
    }));
  });
}

/**
 * @param {dns.promises.Resolver} resolver
 * @param {string} hostname
 * @param {Array<4|6>} families In the order the addresses are returned.
 * @returns {Promise<{addresses: Array<{address: string, family: number}>, failed: boolean, noReply: boolean}>}
 *   failed: no address, and at least one family's query errored. noReply: no address, and no
 *   family's query was answered.
 */
async function queryResolver(resolver, hostname, families) {
  const results = (await settleWithResolutionDelay(
    families.map((family) => queryFamily(resolver, hostname, family)),
  )).filter(Boolean);
  const addresses = results.flatMap((result) => result.addresses);
  return {
    addresses,
    failed: !addresses.length && results.some((result) => result.failed),
    noReply: !addresses.length && results.length > 0 && results.every((result) => result.noReply),
  };
}

/**
 * Asks a system server for a random name under .com, and remembers whether it can resolve:
 * a pass brings it back from silent, a failure makes it silent.
 * @param {{resolver: dns.promises.Resolver, silent: boolean, probedAt: number, probing: ?Promise<boolean>}} server
 * @returns {Promise<boolean>} Whether the server resolved the name.
 */
function probe(server) {
  if (server.probing) return server.probing;
  /* eslint-disable no-param-reassign */
  server.probedAt = performance.now();
  const name = `${crypto.randomBytes(6).toString('hex')}.com`;
  server.probing = server.resolver.resolve4(name).then(
    () => true,
    (error) => NO_ADDRESS_CODES.has(error.code),
  ).then((resolves) => {
    server.probing = null;
    server.silent = !resolves;
    return resolves;
  });
  /* eslint-enable no-param-reassign */
  return server.probing;
}

/**
 * Probes a silent server again in the background, at most once every REPROBE_MS.
 * @param {{probedAt: number, probing: ?Promise<boolean>}} server
 */
function reprobeIfDue(server) {
  if (!server.probing && performance.now() - server.probedAt >= REPROBE_MS) probe(server);
}

/**
 * @param {string} hostname
 * @param {number} [family] 4 or 6 for that family only; anything else for both.
 * @returns {Promise<Array<{address: string, family: number}>>} Never empty.
 * @throws The operating system resolver's error when no source has an address.
 */
async function resolveHostname(hostname, family) {
  const families = family === 4 || family === 6 ? [family] : FAMILIES_IN_ORDER;

  // The public servers are asked unless a system server answered that the name has no address.
  let askPublic = true;
  // eslint-disable-next-line no-restricted-syntax
  for (const server of systemServers) {
    if (server.silent) {
      reprobeIfDue(server);
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const fromServer = await queryResolver(server.resolver, hostname, families);
    if (fromServer.addresses.length) return fromServer.addresses;
    if (!fromServer.failed) {
      askPublic = false;
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    if (fromServer.noReply) await probe(server);
  }

  if (askPublic) {
    const fromPublic = await queryResolver(publicResolver, hostname, families);
    if (fromPublic.addresses.length) return fromPublic.addresses;
  }

  const fromOs = await dns.promises.lookup(hostname, { all: true, family: families.length === 1 ? families[0] : 0 });
  return families.flatMap((wanted) => fromOs.filter((entry) => entry.family === wanted));
}

/**
 * Answers a `lookup` call once the hostname is resolved.
 * @param {string} hostname
 * @param {{family?: number, all?: boolean}} options
 * @param {Function} callback
 */
async function answerLookup(hostname, options, callback) {
  let addresses;
  try {
    addresses = await resolveHostname(hostname, options.family);
  } catch (error) {
    callback(error);
    return;
  }

  if (options.all) {
    callback(null, addresses);
    return;
  }

  callback(null, addresses[0].address, addresses[0].family);
}

/**
 * A `lookup` for net.connect and http.Agent: (hostname, options, callback), where options
 * carries `family` and `all` as dns.lookup reads them.
 * @param {string} hostname
 * @param {{family?: number, all?: boolean}} options
 * @param {Function} callback
 */
function lookup(hostname, options, callback) {
  answerLookup(hostname, options, callback);
}

/**
 * Makes the main thread's global http and https agents resolve through `lookup`. An agent's
 * own options take precedence over a request's, so every request on these agents uses it.
 */
function install() {
  http.globalAgent.options.lookup = lookup;
  https.globalAgent.options.lookup = lookup;
}

/**
 * Replaces the system servers, each starting as not silent, for the tests.
 * @param {string[]} addresses
 */
function useSystemServers(addresses) {
  systemServers = addresses.map(systemServer);
}

/**
 * Each system server and whether it is remembered as silent, for the tests.
 * @returns {Array<{address: string, silent: boolean}>}
 */
function systemServerStates() {
  return systemServers.map(({ address, silent }) => ({ address, silent }));
}

module.exports = {
  PUBLIC_DNS_SERVERS,
  QUERY_TIMEOUT_MS,
  REPROBE_MS,
  RESOLUTION_DELAY_MS,
  install,
  lookup,
  // testing exports
  systemServerStates,
  useSystemServers,
};
