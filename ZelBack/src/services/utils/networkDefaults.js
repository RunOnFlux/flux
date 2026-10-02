/**
 * Process-wide outbound connection defaults, applied once per isolate.
 *
 * WHY. Node's Happy Eyeballs (`autoSelectFamily`, on by default since Node 20) gives each
 * resolved address `autoSelectFamilyAttemptTimeout` ms to connect, then ABORTS that attempt
 * and moves to the next address; attempts are not raced. The default is 250 ms (newer Node
 * lines raise it to 500 ms). From Australia, a TCP connect to Docker Hub's US East registry
 * takes 270-310 ms, so on a node without an IPv6 route every IPv4 attempt is aborted, every
 * IPv6 attempt fails with ENETUNREACH, and the request ends in ETIMEDOUT with no response.
 * Such a node could never verify a Docker Hub image, so it never spawned a Docker Hub app,
 * while it looked free to the rest of the network.
 *
 * 2 s covers a far registry with room for one SYN retransmission (initial RTO is 1 s). It
 * only changes anything when an address does not answer within the old limit: a fast first
 * address connects exactly as before. Connections to IP literals do no lookup and are not
 * affected at all. The cacheable-lookup resolver installed in apiServer returns IPv4 entries
 * before IPv6, so a node with a configured but broken IPv6 still tries IPv4 first.
 *
 * WORKERS. Each worker thread has its own copy of `node:net`, so the default set in the main
 * isolate does not reach it. Every worker that makes outbound requests (the cloud registry
 * auth workers) calls this at the top. It deliberately requires nothing but `node:net`, so
 * it is cheap to load there.
 */

const net = require('node:net');

const CONNECT_ATTEMPT_TIMEOUT_MS = 2_000;

/**
 * Sets the per-address connect attempt timeout for this isolate.
 * @returns {boolean} true if it was set, false on a Node without the API
 */
function setConnectAttemptTimeout() {
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout !== 'function') return false;
  net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
  return true;
}

module.exports = {
  CONNECT_ATTEMPT_TIMEOUT_MS,
  setConnectAttemptTimeout,
};
