/**
 * How the main thread's global http and https agents resolve a hostname.
 *
 * Resolution goes through three sources, and the first that yields an address answers:
 *
 * 1. The system's DNS servers, from /etc/resolv.conf.
 * 2. Public DNS servers, asked only when the system's servers gave no address and at least
 *    one family's query FAILED: it errored (SERVFAIL, REFUSED, a timeout). When every family's
 *    query is answered that the name does not exist or has no records, the system's servers
 *    have answered, so the public servers are not asked and cannot override the operator's own
 *    DNS. They are a source of their own rather than further entries in the system resolver's
 *    server list: a DNS client moves to its next server only when one does not answer at all,
 *    so a server that answers with a failure would otherwise end the lookup with the next
 *    servers never asked.
 * 3. The operating system's resolver (`dns.lookup`), which also reads /etc/hosts and
 *    nsswitch. Its error is the lookup's error when nothing answers.
 *
 * Within a source, IPv4 and IPv6 are queried separately, and a source that returns addresses
 * for either family answers with them. A router that answers AAAA queries with SERVFAIL
 * therefore leaves a hostname with its IPv4 addresses instead of without any. Once one family
 * has answered with addresses, the other is waited for only RESOLUTION_DELAY_MS, so a router
 * that never answers AAAA queries costs a lookup that delay, not the query timeout.
 *
 * The first two sources are queried directly and never read /etc/hosts.
 *
 * Each of their queries is bounded at QUERY_TIMEOUT_MS over QUERY_TRIES tries. When every
 * query to the system's servers times out - they did not answer at all, which a failure such as
 * SERVFAIL is not - they are remembered as silent: later lookups go straight to the public
 * servers instead of waiting out the timeout again, so a node whose own DNS server is down pays
 * it on one lookup. While they are silent, a background query asks them again every
 * SILENT_RECHECK_MS, and any answer, including that a name has no address, brings them back.
 * No lookup waits on that query.
 *
 * Addresses are ordered by networkDefaults' DNS_RESULT_ORDER, the order every other lookup in
 * the process uses.
 *
 * No answer is cached in the process. Every lookup asks the system's servers first unless they
 * are remembered as silent, and the local resolver caches.
 */

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');

const { DNS_RESULT_ORDER } = require('./networkDefaults');

const PUBLIC_DNS_SERVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];

// A query's wait per try, and its tries. c-ares's own default retries a server that does not
// answer for about 75 s (5 s, doubling, 4 tries), beyond every request timeout FluxOS sets.
const QUERY_TIMEOUT_MS = 2000;
const QUERY_TRIES = 2;
const resolverOptions = { timeout: QUERY_TIMEOUT_MS, tries: QUERY_TRIES };

const systemResolver = new dns.promises.Resolver(resolverOptions);
const publicResolver = new dns.promises.Resolver(resolverOptions);
publicResolver.setServers(PUBLIC_DNS_SERVERS);

const FAMILIES_IN_ORDER = DNS_RESULT_ORDER === 'ipv6first' ? [6, 4] : [4, 6];

// The codes a DNS server's answer carries when a name has no addresses of a family: an answer,
// unlike every other error, which says the query itself failed.
const NO_ADDRESS_CODES = new Set([dns.NODATA, dns.NOTFOUND]);

// How long a resolver waits for the other family once one family has answered with addresses:
// the Resolution Delay of Happy Eyeballs v2 (RFC 8305 section 3). A server that never answers
// one family's query then costs a lookup this long, not the resolver's query timeout.
const RESOLUTION_DELAY_MS = 50;

// How often the system's servers are asked again while they are remembered as silent.
const SILENT_RECHECK_MS = 5 * 60 * 1000;

let systemSilent = false;
let recheckTimer = null;
// The hostname the background query asks for: the last one a lookup could not get from them.
let recheckHostname = null;

/**
 * @param {dns.promises.Resolver} resolver
 * @param {string} hostname
 * @param {4|6} family
 * @returns {Promise<{addresses: Array<{address: string, family: number}>, failed: boolean, timedOut: boolean}>}
 *   failed: the query errored rather than being answered. timedOut: the server did not answer.
 */
async function queryFamily(resolver, hostname, family) {
  try {
    const addresses = family === 4
      ? await resolver.resolve4(hostname)
      : await resolver.resolve6(hostname);
    return { addresses: addresses.map((address) => ({ address, family })), failed: false, timedOut: false };
  } catch (error) {
    return { addresses: [], failed: !NO_ADDRESS_CODES.has(error.code), timedOut: error.code === dns.TIMEOUT };
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
 * @returns {Promise<{addresses: Array<{address: string, family: number}>, failed: boolean, timedOut: boolean}>}
 *   failed: no address, and at least one family's query errored. timedOut: no address, and
 *   every family's query went unanswered.
 */
async function queryResolver(resolver, hostname, families) {
  const results = (await settleWithResolutionDelay(
    families.map((family) => queryFamily(resolver, hostname, family)),
  )).filter(Boolean);
  const addresses = results.flatMap((result) => result.addresses);
  return {
    addresses,
    failed: !addresses.length && results.some((result) => result.failed),
    timedOut: !addresses.length && results.length > 0 && results.every((result) => result.timedOut),
  };
}

function scheduleSystemRecheck() {
  recheckTimer = setTimeout(recheckSystem, SILENT_RECHECK_MS);
  recheckTimer.unref();
}

/**
 * The background query to the system's servers while they are remembered as silent: any
 * answer brings them back, and another timeout keeps them silent until the next one.
 * @returns {Promise<void>}
 */
async function recheckSystem() {
  recheckTimer = null;
  const result = await queryResolver(systemResolver, recheckHostname, FAMILIES_IN_ORDER);
  if (result.timedOut) scheduleSystemRecheck();
  else systemSilent = false;
}

/**
 * Remembers the system's servers as silent, from a lookup whose queries to them all timed out.
 * @param {string} hostname The name that lookup asked for.
 */
function rememberSystemSilent(hostname) {
  recheckHostname = hostname;
  if (systemSilent) return;
  systemSilent = true;
  scheduleSystemRecheck();
}

/**
 * Forgets that the system's servers were silent, for the tests.
 */
function forgetSystemSilent() {
  if (recheckTimer) clearTimeout(recheckTimer);
  recheckTimer = null;
  recheckHostname = null;
  systemSilent = false;
}

/**
 * @param {string} hostname
 * @param {number} [family] 4 or 6 for that family only; anything else for both.
 * @returns {Promise<Array<{address: string, family: number}>>} Never empty.
 * @throws The operating system resolver's error when no source has an address.
 */
async function resolveHostname(hostname, family) {
  const families = family === 4 || family === 6 ? [family] : FAMILIES_IN_ORDER;

  // Silent servers give no address and count as a failed query, so the public servers answer.
  let fromSystem = { addresses: [], failed: true, timedOut: true };
  if (!systemSilent) {
    fromSystem = await queryResolver(systemResolver, hostname, families);
    if (fromSystem.timedOut) rememberSystemSilent(hostname);
  }
  if (fromSystem.addresses.length) return fromSystem.addresses;

  if (fromSystem.failed) {
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

module.exports = {
  PUBLIC_DNS_SERVERS,
  QUERY_TIMEOUT_MS,
  QUERY_TRIES,
  RESOLUTION_DELAY_MS,
  SILENT_RECHECK_MS,
  install,
  lookup,
  // testing exports
  forgetSystemSilent,
};
