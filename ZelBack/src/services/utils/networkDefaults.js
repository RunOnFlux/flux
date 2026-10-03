/**
 * How every thread in the process opens outbound connections.
 *
 * CONNECT ATTEMPT TIMEOUT. A hostname that resolves to several addresses is dialled by Node's
 * `autoSelectFamily` (on by default): it starts a TCP handshake to one address, and if the
 * handshake has not completed within `autoSelectFamilyAttemptTimeout` it ABANDONS that attempt
 * and starts the next address. Attempts are not raced, and only the last address runs to
 * completion. Node's default of 250 ms is therefore a hard ceiling on the handshake time to every
 * address but the last: a registry whose handshake takes longer is unreachable even though DNS,
 * routing and the registry all work. A node far from a registry and without a working IPv6 route
 * hits exactly this: every IPv4 handshake is abandoned just before it completes, the IPv6
 * addresses fail, and the request ends in ETIMEDOUT with no response.
 *
 * 2 s covers a far handshake with room for one SYN retransmission (the initial retransmission
 * timeout is 1 s). 500 ms does not: a handshake that takes longer than 0.5 s is still abandoned
 * at that value. The value only matters for an address that does not complete its handshake
 * within it; an address that answers faster connects exactly as it would at any other value.
 * Connections to an IP literal do no lookup and are not affected.
 *
 * Turning `autoSelectFamily` off is not the alternative: Node then dials only the first address
 * the lookup returns, and on a node whose IPv6 is configured but drops packets that address is
 * IPv6, so the connection hangs until the caller's own timeout.
 *
 * IPV4 FIRST. The timeout is paid once for every address that does not answer before the one
 * that does. On a node whose IPv6 is configured but drops packets, a lookup in the system order
 * puts IPv6 first, so every connection would wait the full timeout on a dead address before it
 * reached IPv4. Lookups therefore return IPv4 addresses first: every node has working public
 * IPv4, so the first address dialled is one that can answer. The DNS cache apiServer installs on
 * the main thread's global agents already orders IPv4 first; this applies the same order to every
 * other lookup, including the cloud SDKs' own agents and every worker thread.
 *
 * PER THREAD. Each worker thread has its own `node:net` and `node:dns`, so a default set in one
 * thread does not reach another. apiServer calls `applyNetworkDefaults()` at the top of the module,
 * before anything connects, and app.js loads apiServer before it starts anything. Every worker is created with `createWorker()`, which starts
 * `workerBootstrap.js`: it applies the same defaults in the new thread, then loads the worker
 * script, so no worker script runs before they are in effect.
 *
 * NODE FLOOR. Node 20.13 and later accept `--network-family-autoselection-attempt-timeout` in a
 * worker's `execArgv`, which would set the defaults before the thread runs any code and make the
 * bootstrap unnecessary. Earlier Node rejects the unknown flag with ERR_WORKER_INVALID_EXEC_ARGV,
 * so every worker would fail to start, and the fleet runs Node 20.8. Once the oldest Node in the
 * fleet is 20.13 or later, `createWorker()` can pass both defaults as `execArgv` flags
 * (`--network-family-autoselection-attempt-timeout`, `--dns-result-order`) after
 * `process.execArgv`, and `workerBootstrap.js` can go.
 */

const net = require('node:net');
const dns = require('node:dns');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const CONNECT_ATTEMPT_TIMEOUT_MS = 2_000;
const DNS_RESULT_ORDER = 'ipv4first';

const WORKER_BOOTSTRAP = path.join(__dirname, 'workerBootstrap.js');

/**
 * Applies the outbound connection defaults to the calling thread.
 */
function applyNetworkDefaults() {
  net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
  dns.setDefaultResultOrder(DNS_RESULT_ORDER);
}

/**
 * Starts a worker thread running `script` with the outbound connection defaults in effect.
 * @param {string} script Absolute path of the worker script.
 * @returns {Worker}
 */
function createWorker(script) {
  return new Worker(WORKER_BOOTSTRAP, { workerData: { script } });
}

module.exports = {
  CONNECT_ATTEMPT_TIMEOUT_MS,
  DNS_RESULT_ORDER,
  applyNetworkDefaults,
  createWorker,
};
