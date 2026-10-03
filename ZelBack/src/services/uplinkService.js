/**
 * Whether this node reaches the internet through a tunnel to a remote box.
 *
 * Decided by the node itself:
 *
 * - Distance. A node at its public address reaches that address through its
 *   own router, well under a millisecond away. A node tunnelled through a
 *   remote box reaches it across the tunnel. Tunnel settings cannot shorten it.
 * - The node itself: a tunnel interface, or the public address bound on an
 *   interface the node's traffic does not leave by.
 *
 * Packet size is recorded and decides nothing. Under 1500 proves a layer of
 * encapsulation somewhere on the path, which a PPPoE line or a cloud network
 * adds as surely as a tunnel does; on a node already found tunnelled, the size
 * and how it was learned say what kind of tunnel it is. Read two ways: a ping
 * sweep with Don't Fragment set, and the TCP segment size peers negotiate,
 * which a router clamping for a tunnel lowers.
 *
 * Measured for each address the node learns, and again every few hours for the
 * path and peers that change without one. Readers get the last record and a
 * request does no work.
 */

const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const serviceHelper = require('./serviceHelper');
const verificationHelper = require('./verificationHelper');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const { bareIp, extractIp, extractPort } = require('./utils/socketAddressUtils');
const { Privilege, authOf } = require('./utils/privileges');

const Tunnel = Object.freeze({
  LIKELY: 'likely',
  NONE: 'none',
  UNKNOWN: 'unknown',
});

const Reason = Object.freeze({
  INTERFACE: 'interface',
  LOCAL_PUBLIC_IP: 'localPublicIp',
  DISTANCE: 'distance',
});

const ProbeMethod = Object.freeze({
  // A full-size packet came back.
  FULL: 'full',
  // A router on the path named the size it accepts.
  FRAG_NEEDED: 'fragNeeded',
  // Nothing named a size; it is the largest that got a reply.
  NO_REPLY: 'noReply',
});

const FULL_MTU = 1500;
// The search floor. A path that cannot carry this is not a tunnel to measure.
const MIN_MTU = 1280;
// IPv4 header + ICMP header: what ping adds to its payload size.
const ICMP_OVERHEAD = 28;
// IPv4 header + TCP header + timestamps option: what separates the segment
// size `ss` reports from the packet size.
const TCP_OVERHEAD = 52;
// Unrelated anycast networks: a limit near this node caps all of them, one at a
// target's end caps only that target, so the largest result is this node's.
const PROBE_TARGETS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
const HOP_WALK_TARGET = '1.1.1.1';
const MAX_HOPS = 10;
// Fewer distinct peers than this and one peer's own small link could set the
// highest segment size seen.
const MIN_TCP_PEERS = 3;
// Further from its own public address than this, a node is not at it.
const DISTANCE_CUTOFF_MS = 5;
const TCP_CONNECT_TIMEOUT_MS = 3_000;
const COMMAND_TIMEOUT_MS = 30_000;
const REMEASURE_INTERVAL_MS = 3 * 60 * 60 * 1000;

// Kernel link types (ARPHRD_*) that are tunnels.
const TUNNEL_LINK_TYPES = new Map([
  [768, 'ipip'],
  [769, 'ip6tnl'],
  [776, 'sit'],
  [778, 'gre'],
  [823, 'ip6gre'],
]);
// ARPHRD_NONE: a layer-3 tun device, or WireGuard.
const LINK_TYPE_NONE = 65534;

/**
 * @returns {object} A record with nothing measured.
 */
function emptyRecord() {
  return {
    tunnel: Tunnel.UNKNOWN,
    reason: null,
    measuredAt: null,
    mtu: {
      value: null,
      probe: null,
      probeMethod: null,
      tcpMss: null,
    },
    distance: {
      rttMs: null,
      method: null,
      firstPublicHopRttMs: null,
    },
    publicIpLocal: null,
    tunnelInterfaces: null,
  };
}

let record = emptyRecord();
// The address the next measurement is for (ip:port).
let address = null;
let running = null;
let addressChangedDuringRun = false;
let timerHandle = null;

/**
 * Runs a network tool with its output in the C locale, so the text parsed is
 * the same on every node.
 * @param {string} cmd
 * @param {Array<string|number>} params
 * @returns {Promise<string>} stdout and stderr together; a non-zero exit is an
 *   answer here (no reply, unreachable), not an error.
 */
async function runTool(cmd, params) {
  const { stdout, stderr } = await serviceHelper.runCommand(cmd, {
    params,
    timeout: COMMAND_TIMEOUT_MS,
    logError: false,
    env: { ...process.env, LC_ALL: 'C' },
  });
  return `${stdout ?? ''}\n${stderr ?? ''}`;
}

/**
 * @param {string} text Output of ping.
 * @returns {{replied: boolean, mtu: number|null}} Whether an echo came back,
 *   and the size a router (or the kernel, from a router's earlier answer) said
 *   the path accepts.
 */
function parsePing(text) {
  const replied = /bytes from /.test(text);
  const named = /Frag needed and DF set \(mtu = (\d+)\)/.exec(text)
    ?? /message too long, mtu=(\d+)/.exec(text);
  return { replied, mtu: named ? Number(named[1]) : null };
}

/**
 * @param {string} text Output of ping.
 * @returns {number|null} The minimum round trip in ms.
 */
function parsePingRtt(text) {
  const summary = /min\/avg\/max\/(?:mdev|stddev) = ([\d.]+)\//.exec(text);
  return summary ? Number(summary[1]) : null;
}

/**
 * @param {string} target
 * @param {number} mtu Packet size to send, Don't Fragment set.
 * @returns {Promise<{replied: boolean, mtu: number|null}>}
 */
async function pingAtSize(target, mtu) {
  const text = await runTool('ping', ['-n', '-M', 'do', '-c', 2, '-i', '0.2', '-W', 2, '-s', mtu - ICMP_OVERHEAD, target]);
  return parsePing(text);
}

/**
 * The largest packet that reaches one target.
 * @param {string} target
 * @returns {Promise<{value: number, method: string}|null>} Null when the target
 *   answers no size at all.
 */
async function probeTarget(target) {
  const full = await pingAtSize(target, FULL_MTU);
  if (full.replied) return { value: FULL_MTU, method: ProbeMethod.FULL };
  if (full.mtu) return { value: full.mtu, method: ProbeMethod.FRAG_NEEDED };

  const floor = await pingAtSize(target, MIN_MTU);
  if (floor.mtu) return { value: floor.mtu, method: ProbeMethod.FRAG_NEEDED };
  if (!floor.replied) return null;

  let best = MIN_MTU;
  let low = MIN_MTU + 1;
  let high = FULL_MTU - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    // eslint-disable-next-line no-await-in-loop
    const result = await pingAtSize(target, mid);
    if (result.mtu) return { value: result.mtu, method: ProbeMethod.FRAG_NEEDED };
    if (result.replied) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return { value: best, method: ProbeMethod.NO_REPLY };
}

/**
 * @returns {Promise<{value: number, method: string}|null>} The largest result
 *   across the probe targets, or null when none answered.
 */
async function probePathMtu() {
  let best = null;
  for (const target of PROBE_TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    const result = await probeTarget(target);
    if (result && (!best || result.value > best.value)) best = result;
  }
  return best;
}

/**
 * @param {string} address A peer column from `ss`: `ip:port` or `[ip]:port`.
 * @returns {string|null} The IPv4 address, unwrapping an IPv4-mapped form.
 */
function peerIpv4(address) {
  const portAt = address.lastIndexOf(':');
  if (portAt < 1) return null;
  const host = bareIp(address.slice(0, portAt).replace(/^\[|\]$/g, ''));
  return serviceHelper.validIpv4Address(host) ? host : null;
}

/**
 * @param {string} text Output of `ss -tinH state established`: a line per
 *   socket ending in its peer address, then an indented line of its TCP state.
 * @returns {Map<string, number>} Routable peer IPv4 address -> the highest
 *   segment size on a connection to it.
 */
function parsePeerMss(text) {
  const byPeer = new Map();
  let peer = null;
  for (const line of text.split('\n')) {
    if (/^\s/.test(line)) {
      const mss = /\bmss:(\d+)/.exec(line);
      if (peer && mss) byPeer.set(peer, Math.max(byPeer.get(peer) ?? 0, Number(mss[1])));
      peer = null;
    } else {
      const columns = line.trim().split(/\s+/);
      const ip = columns.length >= 4 ? peerIpv4(columns[columns.length - 1]) : null;
      peer = ip && !serviceHelper.isNonRoutableAddress(ip) ? ip : null;
    }
  }
  return byPeer;
}

/**
 * @returns {Promise<number|null>} The highest TCP segment size across this
 *   node's connections to routable peers, or null with too few peers.
 */
async function peerTcpMss() {
  const byPeer = parsePeerMss(await runTool('ss', ['-tinH', 'state', 'established']));
  if (byPeer.size < MIN_TCP_PEERS) return null;
  return Math.max(...byPeer.values());
}

/**
 * @param {string} ip
 * @param {number} port
 * @returns {Promise<number|null>} Time to complete a TCP handshake in ms, or
 *   null when it did not.
 */
function connectTime(ip, port) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const socket = net.connect({ host: ip, port });
    socket.setTimeout(TCP_CONNECT_TIMEOUT_MS);
    function finish(ms) {
      socket.destroy();
      resolve(ms);
    }
    socket.once('connect', () => finish(Number(process.hrtime.bigint() - started) / 1e6));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

/**
 * Round trip from this node to its own public address: a ping, or when that
 * goes unanswered, a TCP handshake with its own API port, which must be
 * reachable for the node to be a node.
 * @param {string} publicIp
 * @param {number} apiPort
 * @returns {Promise<{rttMs: number|null, method: string|null}>}
 */
async function measureDistance(publicIp, apiPort) {
  const icmp = parsePingRtt(await runTool('ping', ['-n', '-c', 5, '-i', '0.2', '-W', 2, publicIp]));
  if (icmp !== null) return { rttMs: icmp, method: 'icmp' };

  let best = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ms = await connectTime(publicIp, apiPort);
    if (ms !== null && (best === null || ms < best)) best = ms;
  }
  if (best !== null) return { rttMs: Math.round(best * 1000) / 1000, method: 'tcp' };
  return { rttMs: null, method: null };
}

/**
 * Walks the path one hop at a time to the first routable address and times a
 * round trip to it.
 * @returns {Promise<number|null>} Null when no routable hop answers.
 */
async function firstPublicHopRtt() {
  for (let ttl = 1; ttl <= MAX_HOPS; ttl += 1) {
    // eslint-disable-next-line no-await-in-loop
    const text = await runTool('ping', ['-n', '-c', 1, '-W', 2, '-t', ttl, HOP_WALK_TARGET]);
    const reached = /bytes from (\d+\.\d+\.\d+\.\d+)/.exec(text);
    const hop = /^From (\d+\.\d+\.\d+\.\d+)/m.exec(text)?.[1] ?? reached?.[1] ?? null;
    if (hop && !serviceHelper.isNonRoutableAddress(hop)) {
      // eslint-disable-next-line no-await-in-loop
      return parsePingRtt(await runTool('ping', ['-n', '-c', 3, '-i', '0.2', '-W', 2, hop]));
    }
    if (reached) return null;
  }
  return null;
}

/**
 * @returns {Promise<Array<{name: string, kind: string, mtu: number}>|null>}
 *   This node's tunnel interfaces, or null when the interfaces cannot be read.
 */
async function findTunnelInterfaces() {
  let names;
  try {
    names = await fs.readdir('/sys/class/net');
  } catch (error) {
    log.error(`uplinkService - cannot list interfaces: ${error.message}`);
    return null;
  }

  const found = [];
  for (const name of names) {
    const dir = `/sys/class/net/${name}`;
    // eslint-disable-next-line no-await-in-loop
    const [type, uevent, mtu, tunFlags] = await Promise.all([
      fs.readFile(`${dir}/type`, 'utf8').catch(() => null),
      fs.readFile(`${dir}/uevent`, 'utf8').catch(() => ''),
      fs.readFile(`${dir}/mtu`, 'utf8').catch(() => null),
      fs.readFile(`${dir}/tun_flags`, 'utf8').catch(() => null),
    ]);
    const linkType = Number(type);
    let kind = null;
    if (/^DEVTYPE=wireguard$/m.test(uevent)) kind = 'wireguard';
    else if (TUNNEL_LINK_TYPES.has(linkType)) kind = TUNNEL_LINK_TYPES.get(linkType);
    else if (tunFlags !== null) kind = linkType === LINK_TYPE_NONE ? 'tun' : 'tap';
    if (kind) found.push({ name, kind, mtu: mtu === null ? null : Number(mtu) });
  }
  return found;
}

/**
 * @param {string} publicIp
 * @returns {Promise<{bound: boolean, elsewhere: boolean}>} Whether the public
 *   address is bound on this node, and whether on a device other than the one
 *   its traffic leaves by.
 */
async function publicIpBinding(publicIp) {
  const name = Object.entries(os.networkInterfaces())
    .find(([, addresses]) => addresses.some((a) => a.family === 'IPv4' && a.address === publicIp))?.[0] ?? null;
  if (!name) return { bound: false, elsewhere: false };
  const routes = await fluxNetworkHelper.getDefaultRoutes().catch(() => null);
  const leavesBy = routes?.[0]?.iface ?? null;
  return { bound: true, elsewhere: leavesBy !== null && fluxNetworkHelper.interfaceDevice(name) !== leavesBy };
}

/**
 * @param {{rttMs: number|null, firstPublicHopRttMs: number|null,
 *   tunnelInterfaces: Array|null, publicIpElsewhere: boolean}} evidence
 * @returns {{tunnel: string, reason: string|null}}
 */
function decide(evidence) {
  if (evidence.tunnelInterfaces?.length) return { tunnel: Tunnel.LIKELY, reason: Reason.INTERFACE };
  if (evidence.publicIpElsewhere) return { tunnel: Tunnel.LIKELY, reason: Reason.LOCAL_PUBLIC_IP };
  const distance = evidence.rttMs ?? evidence.firstPublicHopRttMs;
  if (distance === null) return { tunnel: Tunnel.UNKNOWN, reason: null };
  if (distance > DISTANCE_CUTOFF_MS) return { tunnel: Tunnel.LIKELY, reason: Reason.DISTANCE };
  return { tunnel: Tunnel.NONE, reason: null };
}

/**
 * @param {{value: number}|null} probe
 * @param {number|null} tcpMss
 * @returns {number|null} The lower of the two packet sizes measured.
 */
function combinedMtu(probe, tcpMss) {
  const sizes = [];
  if (probe) sizes.push(probe.value);
  if (tcpMss !== null) sizes.push(Math.min(FULL_MTU, tcpMss + TCP_OVERHEAD));
  return sizes.length ? Math.min(...sizes) : null;
}

/**
 * Takes every measurement and decides.
 * @param {string} socketAddress This node's address (ip:port).
 * @returns {Promise<object>} A full record.
 */
async function measure(socketAddress) {
  const publicIp = extractIp(socketAddress);

  const probe = await probePathMtu();
  const tcpMss = await peerTcpMss();
  const mtu = combinedMtu(probe, tcpMss);
  const distance = await measureDistance(publicIp, extractPort(socketAddress));
  const firstPublicHopRttMs = await firstPublicHopRtt();
  const binding = await publicIpBinding(publicIp);
  const tunnelInterfaces = await findTunnelInterfaces();

  const { tunnel, reason } = decide({
    rttMs: distance.rttMs,
    firstPublicHopRttMs,
    tunnelInterfaces,
    publicIpElsewhere: binding.elsewhere,
  });

  return {
    tunnel,
    reason,
    measuredAt: new Date().toISOString(),
    mtu: {
      value: mtu,
      probe: probe?.value ?? null,
      probeMethod: probe?.method ?? null,
      tcpMss,
    },
    distance: {
      rttMs: distance.rttMs,
      method: distance.method,
      firstPublicHopRttMs,
    },
    publicIpLocal: binding.bound,
    tunnelInterfaces,
  };
}

/**
 * Measures until the record is for the current address: an address that
 * changes during a run is measured again as soon as that run ends. Clears
 * `running` in the same step as its last check, so an address that arrives
 * after that check starts a run of its own.
 * @returns {Promise<void>}
 */
async function runUntilCurrent() {
  do {
    addressChangedDuringRun = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      record = await measure(address);
      log.info(`uplinkService - tunnel ${record.tunnel}${record.reason ? ` (${record.reason})` : ''}, mtu ${record.mtu.value}, rtt ${record.distance.rttMs} ms`);
    } catch (error) {
      log.error(`uplinkService - measurement failed: ${error.message}`);
    }
  } while (addressChangedDuringRun);
  running = null;
}

/**
 * Replaces the record with a measurement for the current address. Nothing is
 * measured before the node knows its address.
 * @returns {Promise<void>} Settles when the record is for the current address.
 */
function measureOnce() {
  if (!address) return Promise.resolve();
  if (!running) running = runUntilCurrent();
  return running;
}

/**
 * The node learned a new address: measure for it.
 * @param {string} socketAddress ip:port
 * @returns {Promise<void>} Settles when the record is for this address.
 */
function noteAddress(socketAddress) {
  address = socketAddress;
  if (running) addressChangedDuringRun = true;
  return measureOnce();
}

/**
 * @returns {object} The last full record.
 */
function getUplink() {
  return structuredClone(record);
}

/**
 * @returns {{tunnel: string, mtu: number|null, rttMs: number|null}} What
 *   /flux/info carries.
 */
function getUplinkSummary() {
  return { tunnel: record.tunnel, mtu: record.mtu.value, rttMs: record.distance.rttMs };
}

/**
 * GET /flux/uplink - the full record, for the node operator and the Flux team.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<object>}
 */
async function uplinkAPI(req, res) {
  const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));
  if (authorized !== true) return res.json(messageHelper.errUnauthorizedMessage());
  return res.json(messageHelper.createDataMessage(getUplink()));
}

/**
 * Measures now when the node already knows its address, and otherwise when it
 * learns one.
 * @returns {void}
 */
function start() {
  if (timerHandle) return;
  fluxNetworkHelper.onLocalSocketAddressChange(noteAddress);
  timerHandle = setInterval(measureOnce, REMEASURE_INTERVAL_MS);
  const known = fluxNetworkHelper.getKnownLocalSocketAddress();
  if (known) noteAddress(known);
}

/**
 * @returns {void}
 */
function stop() {
  fluxNetworkHelper.offLocalSocketAddressChange(noteAddress);
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

/**
 * Test-only: forgets the record, the address and any schedule.
 * @returns {void}
 */
function reset() {
  stop();
  record = emptyRecord();
  address = null;
  running = null;
  addressChangedDuringRun = false;
}

module.exports = {
  Tunnel,
  Reason,
  ProbeMethod,
  decide,
  combinedMtu,
  parsePing,
  parsePingRtt,
  parsePeerMss,
  probeTarget,
  probePathMtu,
  peerTcpMss,
  measureDistance,
  firstPublicHopRtt,
  findTunnelInterfaces,
  publicIpBinding,
  measure,
  measureOnce,
  noteAddress,
  getUplink,
  getUplinkSummary,
  uplinkAPI,
  start,
  stop,
  reset,
};
