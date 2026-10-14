// Holding a node's packets, to put events in an order the network would only
// produce by chance.
//
// A hold DROPS matching packets inside one node's own netfilter until it is
// released. Nothing is refused: TCP retransmits across a DROP, so a connection
// whose opening or reply was held carries on by itself once the hold lifts.
// That is what makes a hold an ordering tool rather than a failure - a suite
// holds one dial, lets another complete, then releases the first, and the two
// arrive in the order it chose, every run.
//
// The runner reaches every node over the gateway address, so a hold naming
// fleet addresses never cuts the runner's own requests or event stream.
//
// Rules live in two dedicated chains, one hooked into INPUT for packets arriving
// and one into OUTPUT for packets leaving, so releasing everything is one flush
// each and never disturbs docker's rules or any other harness chain.
//
// Keep a hold short: a held connection still counts against the node's
// liveness and handshake timeouts (peers.wsPingIntervalMs x
// peers.wsMaxMissedPongs, fluxapps.wsHandshakeTimeoutMs), and a hold that
// outlives them turns the ordering it was meant to set into a dead connection.

import { execInContainer } from './container.js';

const CHAINS = { in: 'FLUXTEST_HOLD_IN', out: 'FLUXTEST_HOLD_OUT' };
const HOOKS = { in: 'INPUT', out: 'OUTPUT' };

/**
 * The iptables match for a hold spec.
 *
 * @param {object} spec
 * @param {'in'|'out'} [spec.direction] Packets arriving at (default) or leaving the node.
 * @param {string} [spec.from] Source address.
 * @param {string} [spec.to] Destination address.
 * @param {number} [spec.sport] Source port (TCP).
 * @param {number} [spec.dport] Destination port (TCP).
 * @param {boolean} [spec.syn] true: only the handshake's SYN and SYN-ACK. false:
 *   everything after the handshake. Matched on the SYN flag itself, not on
 *   `--syn`, which is a bare SYN only and would count a SYN-ACK as data.
 * @returns {string}
 */
function matchOf(spec) {
  const parts = [];
  if (spec.from) parts.push(`-s ${spec.from}`);
  if (spec.to) parts.push(`-d ${spec.to}`);
  if (spec.sport || spec.dport || spec.syn !== undefined) parts.push('-p tcp');
  if (spec.sport) parts.push(`--sport ${spec.sport}`);
  if (spec.dport) parts.push(`--dport ${spec.dport}`);
  if (spec.syn === true) parts.push('--tcp-flags SYN SYN');
  if (spec.syn === false) parts.push('--tcp-flags SYN NONE');
  if (!parts.length) throw new Error('packet-hold: a hold must match something');
  return parts.join(' ');
}

const hookOf = (chain, builtin) => `iptables -N ${chain} 2>/dev/null; `
  + `iptables -C ${builtin} -j ${chain} 2>/dev/null || iptables -I ${builtin} -j ${chain}`;

/**
 * Hold packets on one node until released.
 *
 * @param {object} client The node's client (its container carries the rule).
 * @param {object} spec What to hold - see matchOf.
 * @returns {Promise<{client: object, chain: string, rule: string}>} The handle release() takes.
 */
export async function hold(client, spec) {
  const direction = spec.direction === 'out' ? 'out' : 'in';
  const chain = CHAINS[direction];
  const rule = `${matchOf(spec)} -j DROP`;
  const res = await execInContainer(client.container, `${hookOf(chain, HOOKS[direction])}; iptables -A ${chain} ${rule}`);
  if (res.exitCode !== 0) {
    throw new Error(`packet-hold: could not hold ${rule}: ${res.output}`);
  }
  return { client, chain, rule };
}

/**
 * Release one hold. A rule already gone is not an error, so a teardown after a
 * failed test cannot fail in its own right.
 *
 * @param {{client: object, chain: string, rule: string}} handle
 */
export async function release(handle) {
  await execInContainer(handle.client.container, `iptables -D ${handle.chain} ${handle.rule} 2>/dev/null || true`);
}

/**
 * Release every hold on a node.
 *
 * @param {object} client
 */
export async function releaseAll(client) {
  await execInContainer(client.container, Object.values(CHAINS)
    .map((chain) => `iptables -F ${chain} 2>/dev/null`).join('; ') + '; true');
}
