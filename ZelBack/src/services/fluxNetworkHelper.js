/* eslint-disable no-underscore-dangle */
const config = require('config');
const { decodeWIF, privKeyToPubKey } = require('./utils/fluxCryptoUtils');
const nodecmd = require('node-cmd');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { EventEmitter, once } = require('events');
const net = require('net');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const dbHelper = require('./dbHelper');
const messageHelper = require('./messageHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const benchmarkService = require('./benchmarkService');
const verificationHelper = require('./verificationHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const { peerManager } = require('./utils/peerState');
const { RemovalOutcome } = require('./utils/removalOutcome');
const { CLOSE_CODES, DIRECTION } = require('./utils/FluxPeerSocket');
const networkStateService = require('./networkStateService');
const fluxEventBus = require('./utils/fluxEventBus');
const { NON_PUBLIC_IPV4 } = require('./utils/nonPublicNetworks');
const ufw = require('./utils/ufw');
const ufwHelper = require('./utils/ufwHelper');
const { UDP_PROBE_MAGIC, UDP_PROBE_BYTES } = require('./utils/fluxUdpTestServer');
const {
  normalizeSocketAddress, extractIp, extractPort, socketAddressesMatch, parseSocketAddress, ipsMatch,
} = require('./utils/socketAddressUtils');

const isArcane = Boolean(process.env.FLUXOS_PATH);

// Fired once, with the apps that survived an address change, after the node's
// public IP has moved. serviceManager wires it to appReconciler.requestRestartOf
// (mirrors appUninstaller.setOnComponentRemoved).
//
// A seam rather than a require, and not for tidiness: appUninstaller requires
// THIS module and appReconciler requires appUninstaller, so reaching upward from
// here for either closes a cycle. Twenty-odd app-layer modules import this one -
// it sits underneath them and stays there. What it knows is that the address
// moved and which apps it kept; what restarting one involves is not its business.
let onAddressChanged = null;
function setOnAddressChanged(callback) {
  onAddressChanged = callback;
}

// Fired once with this node's old and new socket address when its public IP has
// moved, before anything else reacts to the move. serviceManager wires it to
// fluxCommunication, which owns telling the network; a seam for the same reason
// as onAddressChanged.
let onOwnAddressMoved = null;
function setOnOwnAddressMoved(callback) {
  onOwnAddressMoved = callback;
}

// The names of the apps installed on this node that the network lists at a
// socket address. serviceManager wires it to appQueryService.installedAppsListedAt;
// a seam for the same reason as onAddressChanged.
let installedAppsListedAt = null;
function setInstalledAppsListedAt(callback) {
  installedAppsListedAt = callback;
}

/**
 * Whether this node ran apps at `socketAddress`: an app installed here is one
 * the network lists there. A configuration names an address, and a machine
 * started on a copy of another's names that machine's; only apps left there
 * show this node held it. `null` when that cannot be read.
 * @param {string} socketAddress
 * @returns {Promise<boolean|null>}
 */
async function ranAppsAt(socketAddress) {
  if (!installedAppsListedAt) return false;
  try {
    return (await installedAppsListedAt(socketAddress)).length > 0;
  } catch (error) {
    log.warn(`own address - whether this node ran apps at ${socketAddress} cannot be read: ${error.message}`);
    return null;
  }
}

let dosState = 0; // we can start at bigger number later
let dosMessage = null;

// Who may take this node out of service permanently. An owner is an IDENTITY,
// not a message: the reason is what an operator reads, and the owner is what a
// release is checked against. Adding a feature that DOSes the node means adding
// a value here, which is the point - an unknown owner is refused rather than
// accepted as a new one.
const StickyDosOwner = Object.freeze({
  RESIDENTIAL_DOS: 'residentialDos',
  APP_TAMPERING: 'appTampering',
  PEER_SET_STABILITY: 'peerSetStability',
  NODEJS_FLOOR: 'nodejsFloor',
  DOCKER_FLOOR: 'dockerFloor',
  MONGODB_FLOOR: 'mongodbFloor',
  CGROUP_FLOOR: 'cgroupFloor',
  HOST_STALL: 'hostStall',
  IP_CHANGES: 'ipChanges',
});

// Declares the node unfit for the apps it already runs, and is not moved by the
// setDosMessage(null) an availability pass ends in: the conditions held here
// outlive a good pass, so a check that reaches one states it once and it stands.
//
// owner -> reason, rather than one slot. A single slot cannot express two
// owners: a second verdict either overwrites the first, stranding an owner that
// can no longer recognise - and so never release - its own DOS, or is dropped,
// and the node returns to service on the first owner's release for a condition
// that never lifted. The node is out of service while any owner holds it.
const stickyDosHolds = new Map();

// A hold is a verdict rather than a score: an owner holds the node out of
// service or it does not, and this is the value the enforcing readers test.
const STICKY_DOS_STATE = 100;

// Who may hold this node back from placement. An owner is an IDENTITY, not a
// message: the reason is what an operator reads, and the owner is what a release
// is checked against. Adding a feature that holds placement means adding a value
// here, which is the point - an unknown owner is refused rather than accepted as
// a new one.
const PlacementHoldOwner = Object.freeze({
  RESIDENTIAL_DOS: 'residentialDos',
  DATABASE_SUSPECT: 'databaseSuspect',
  HOST_STALL: 'hostStall',
});

// Stops the node taking on NEW apps without declaring it unfit for the ones it
// already runs. DOS conflates those: isNodeDos() makes appSpawner refuse
// installs AND makes nodeStatusMonitor and appStartupManager delete every app on
// the box. A node that must stop growing but keep its customer volumes needs
// only the first, so this is a separate flag whose only consumer is the spawner.
//
// owner -> reason, rather than one slot. A single slot cannot express two
// owners: a second hold OVERWROTE the first, and whoever cleared next released
// both - so the node resumed taking apps for a condition that had not lifted.
// Checking ownership on a single slot only moves the failure, because the
// overwritten owner can then never clear and the node stays held forever. The
// node is held while any owner holds it.
const placementHolds = new Map();

let storedFluxBenchAllowed = null;
let maxNumberOfIpChanges = 0;
const { lruRateLimit } = require('./utils/rateLimit');
const { AsyncGate } = require('./utils/asyncGate');
const { Privilege, authOf } = require('./utils/privileges');

// This node's socket address (ip:port) from benchmark
let localSocketAddress = null;
// Freshness deadline (monotonic ns, process.hrtime.bigint) for the cached
// localSocketAddress: getLocalSocketAddress returns the cached value without a fresh
// benchmark RPC until this passes. The own IP is invariant except on a (rare, rate-limited
// ~1/20h) IP reassignment, so a short window collapses a batch of calls (e.g. an N-app
// cancel's per-app broadcasts) to one RPC. Monotonic, not wall-clock, so an NTP/manual
// clock step never serves the cache stale or expires it early.
let localSocketAddressFreshUntil = 0n;
const LOCAL_SOCKET_ADDRESS_TTL_NS = 60n * 1_000_000_000n;
// An address reserved for documentation (TEST-NET-3, RFC 5737). No network
// routes it on its own, so the route to it is the route this node's internet
// traffic takes. A well-known address can have a route of its own: a VPN
// client's DNS leak protection sends just its DNS resolver through the tunnel.
const EGRESS_TARGET = '203.0.113.1';
// The last address this node learned. A benchmark that does not answer clears
// localSocketAddress but gives the node no new address, so this keeps it.
let lastKnownSocketAddress = null;
// Emits 'change' with the new address when the node learns one that differs
// from lastKnownSocketAddress, and 'known' with it when the node has an address
// after having none.
const localSocketAddressEvents = new EventEmitter();
// Emits 'held', with the IP changes the window holds, when this process finds
// the node held by the IP change hold: the pass that starts it, or the first
// after a restart that finds it standing.
const ipChangeHoldEvents = new EventEmitter();
// Open while localSocketAddress holds an address.
const localSocketAddressGate = new AsyncGate();

/**
 * The device an os.networkInterfaces() entry is bound on. A labelled address
 * is listed under its label (`eth0:1`), and a label always begins with its
 * device's name followed by a colon.
 * @param {string} name - An os.networkInterfaces() key
 * @returns {string} The device name
 */
function interfaceDevice(name) {
  return name.split(':')[0];
}

/**
 * The device this node's traffic to an address leaves by, as the kernel routes
 * it, every policy rule and routing table included. A UDP connect resolves the
 * route and fixes the source address without sending a packet; the source
 * address names the device. That is the device holding the source address: a
 * route that takes its source from an address on a dummy device or lo names
 * that device, not the one the packets leave through.
 * @param {string} [target] - An IPv4 address; by default one no network routes
 *   on its own, so the answer is the device internet traffic leaves by
 * @returns {Promise<string|null>} The device, or null when the route cannot be
 *   resolved or its source address is on no running interface.
 */
async function egressDevice(target = EGRESS_TARGET) {
  const socket = dgram.createSocket('udp4');
  try {
    // Any port: nothing is sent.
    socket.connect(53, target);
    await once(socket, 'connect');
    const source = socket.address().address;
    const name = Object.entries(os.networkInterfaces())
      .find(([, addresses]) => addresses.some((a) => a.family === 'IPv4' && a.address === source))?.[0];
    return name ? interfaceDevice(name) : null;
  } catch {
    return null;
  } finally {
    socket.close();
  }
}

/**
 * Gets the first routable IPv4 address assigned to a network interface,
 * including addresses bound under a label on it. An interface can carry a
 * private primary and a public secondary; stopping at the first non-internal
 * address would answer for whichever the kernel lists first rather than for
 * the interface.
 * @param {string} interfaceName - The name of the network interface
 * @returns {string|null} The routable IPv4 address or null if none is bound
 */
function getInterfaceIp(interfaceName) {
  const addresses = Object.entries(os.networkInterfaces())
    .filter(([name]) => interfaceDevice(name) === interfaceName)
    .flatMap(([, entries]) => entries);

  for (const addr of addresses) {
    if (addr.family === 'IPv4' && !addr.internal && !serviceHelper.isNonRoutableAddress(addr.address)) {
      return addr.address;
    }
  }
  return null;
}

/**
 * Whether this node holds a public address on the device its traffic leaves by:
 * directly connected, with no NAT between it and the internet.
 * @returns {Promise<boolean|null>} Null when the device cannot be named - no
 *   route out, or its source address on no running interface - which is not
 *   the same answer as "there is none".
 */
async function hasPublicIpOnInterface() {
  const device = await egressDevice();
  if (device === null) {
    log.error('hasPublicIpOnInterface - cannot name the device this node\'s traffic leaves by');
    return null;
  }
  const ip = getInterfaceIp(device);
  if (ip) log.info(`Public IP ${ip} found on ${device}, the device this node's traffic leaves by`);
  return ip !== null;
}

/**
 * To get if port belongs to enterprise range
 * @returns {boolean} Returns true if enterprise
 */
function isPortEnterprise(port) {
  const { enterprisePorts } = config.fluxapps;
  let portEnterprise = false;
  enterprisePorts.forEach((portOrInterval) => {
    if (typeof portOrInterval === 'string') { // '0-10'
      const minPort = Number(portOrInterval.split('-')[0]);
      const maxPort = Number(portOrInterval.split('-')[1]);
      if (+port >= minPort && +port <= maxPort) {
        portEnterprise = true;
      }
    } else if (portOrInterval === +port) {
      portEnterprise = true;
    }
  });
  return portEnterprise;
}

/**
 * To get if port belongs to banned range
 * @returns {boolean} Returns true if port is banned
 */
function isPortBanned(port) {
  const { bannedPorts } = config.fluxapps;
  let portBanned = false;

  bannedPorts.forEach((portOrInterval) => {
    if (typeof portOrInterval === 'string') { // '0-10'
      const minPort = Number(portOrInterval.split('-')[0]);
      const maxPort = Number(portOrInterval.split('-')[1]);
      if (+port >= minPort && +port <= maxPort) {
        portBanned = true;
      }
    } else if (portOrInterval === +port) {
      portBanned = true;
    }
  });

  return portBanned;
}

/**
 * To get if port belongs to banned upnp range
 * @returns {boolean} Returns true if port is banned
 */
function isPortUPNPBanned(port) {
  let portBanned = false;
  const { upnpBannedPorts } = config.fluxapps;
  upnpBannedPorts.forEach((portOrInterval) => {
    if (typeof portOrInterval === 'string') { // '0-10'
      const minPort = Number(portOrInterval.split('-')[0]);
      const maxPort = Number(portOrInterval.split('-')[1]);
      if (+port >= minPort && +port <= maxPort) {
        portBanned = true;
      }
    } else if (portOrInterval === +port) {
      portBanned = true;
    }
  });
  return portBanned;
}

/**
 * The most a peer will hand back from a port it was asked to read.
 *
 * A DISCLOSURE bound, and only that. The port may be forwarded to a neighbour at
 * the same public address, so what comes back can be a stranger's response, and
 * nobody should be askable to shuttle a payload. Choose it on that question
 * alone.
 *
 * It is NOT what makes the proof survive. The test server writes its secret into
 * the first response header, so the thing the requester has to find sits at byte
 * 67 of an answer that server authors in full - inside this prefix however large
 * the rest of what a port says turns out to be. The two were entangled once: the
 * token was last in the body, and any 48 bytes appearing before it silently
 * turned every install on the network into "a neighbour holds this port".
 */
const MAX_ECHO_BYTES = 256;

/**
 * What a port answered, capped, for the requester to judge.
 *
 * The requester published a secret on its own test server and did NOT tell us
 * what it is: we fetch whatever is on that port and hand it back verbatim, and
 * the requester decides. That direction is the point. This check exists because
 * a peer cannot tell the requester's application from a neighbour's at the same
 * address - so a peer is not in a position to judge, and one that is old,
 * broken or lying cannot manufacture a secret it was never given.
 *
 * Bounded by MAX_ECHO_BYTES, because this relays bytes read from a stranger's
 * port and nobody can be asked to shuttle a payload. That bound cannot cost the
 * requester its answer: the secret is in the first header of a reply the test
 * server writes in full, so it is inside any prefix this returns.
 *
 * @param {string} ip - the requester's address
 * @param {number} port - the port to read
 * @param {object} options - { timeout }
 * @returns {Promise<string|null>} what it answered, or null if nothing did
 */
async function portAnswered(ip, port, options = {}) {
  const timeout = options.timeout || 5_000;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let received = '';
    let settled = false;

    const done = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(answer);
    };

    const timer = setTimeout(() => done(received || null), timeout);

    socket.connect(port, ip, () => {
      socket.write(`GET / HTTP/1.1\r\nHost: ${ip}:${port}\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      if (received.length >= MAX_ECHO_BYTES) done(received.slice(0, MAX_ECHO_BYTES));
    });
    socket.on('end', () => done(received || null));
    socket.on('error', () => done(null));
  });
}

/**
 * To perform a basic check if TCP port on an ip is open. I.e. that we receive a
 * SYN-ACK in response to a SYN. If connected, we send an RST and close the port.
 * @param {string} ip IP address
 * @param {number} port Port
 * @param {{timeout?:Number}} options
 * @returns {Promise<boolean>} Returns true if opened, otherwise false
 */
async function isPortOpen(ip, port, options = {}) {
  const timeout = options.timeout || 5_000;

  const call = new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = (success) => {
      if (settled) return;

      settled = true;

      clearTimeout(timer);

      if (success) {
        socket.resetAndDestroy();
        resolve(true);
      } else {
        socket.destroy();
        reject();
      }
    };

    const timer = setTimeout(() => {
      cleanup(false);
    }, timeout);

    socket.connect(port, ip, () => {
      cleanup(true);
    });

    socket.on('error', () => {
      cleanup(false);
    });
  });

  const connected = await call.catch(() => false);

  return connected;
}

/**
 * When each datagram of a UDP probe is sent, in ms from the first. UDP drops
 * packets and loss comes in bursts, so the sends are spread rather than sent
 * together.
 */
const UDP_PROBE_SCHEDULE_MS = [0, 250, 750, 1750];

/** How long a UDP probe waits for a reply after its first datagram. */
const UDP_PROBE_DEADLINE_MS = 3_000;

/**
 * What a UDP port answered, capped, for the requester to judge - the UDP twin
 * of portAnswered.
 *
 * UDP has no handshake, so silence is all a closed port and a lost datagram
 * ever say. The requester's test server answers a probe with its secret, and
 * only that tells the requester the port is reachable; this hands back what
 * came, and the requester compares.
 *
 * The reply is taken from whatever source port it arrives from: a NAT in front
 * of the requester may rewrite it.
 *
 * @param {string} ip - the requester's address
 * @param {number} port - the port to probe
 * @param {{schedule?: number[], deadline?: number}} [options]
 * @returns {Promise<string|null|undefined>} what it answered; null when probes
 *   went out and nothing came back; undefined when no probe could be sent, which
 *   says nothing about the port
 */
async function portAnsweredUdp(ip, port, options = {}) {
  const schedule = options.schedule ?? UDP_PROBE_SCHEDULE_MS;
  const deadline = options.deadline ?? UDP_PROBE_DEADLINE_MS;

  const probe = Buffer.alloc(UDP_PROBE_BYTES);
  probe.write(UDP_PROBE_MAGIC, 'latin1');

  const socket = dgram.createSocket('udp4');

  return new Promise((resolve) => {
    const timers = [];
    let settled = false;
    let sent = 0;
    let failed = 0;

    const done = (answer) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      socket.close();
      resolve(answer);
    };

    const afterSend = (error) => {
      if (!error) {
        sent += 1;
        return;
      }
      failed += 1;
      if (failed === schedule.length) done(undefined);
    };

    socket.on('message', (message, rinfo) => {
      if (rinfo.address.replace(/^::ffff:/i, '') !== ip) return;
      done(message.subarray(0, MAX_ECHO_BYTES).toString('utf8'));
    });
    socket.on('error', () => done(undefined));

    schedule.forEach((at) => {
      timers.push(setTimeout(() => socket.send(probe, port, ip, afterSend), at));
    });
    timers.push(setTimeout(() => done(sent ? null : undefined), deadline));
  });
}

/**
 * Runs `task` once per item, at most `limit` at a time.
 * @param {Array} items
 * @param {number} limit
 * @param {function(*): Promise<void>} task
 * @returns {Promise<void>}
 */
async function forEachLimited(items, limit, task) {
  const queue = [...items];
  async function worker() {
    while (queue.length) {
      // eslint-disable-next-line no-await-in-loop
      await task(queue.shift());
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

/**
 * What a node finds at an address it is asked about. NOT_LISTED is no finding at
 * all: the address is not on this node's deterministic list, so it was never
 * probed - an address change this node has not yet seen confirmed reads so.
 */
const FluxAvailability = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  NOT_LISTED: 'notListed',
});

/** `/flux/checkfluxavailability`'s answer for an address the asked node does not list. */
const NOT_LISTED_MESSAGE = 'Asking Flux is not listed';

/**
 * Whether the answer to `/flux/checkfluxavailability` says the asked node does not
 * list the address, rather than that it found nothing there.
 * @param {object} answer The response body.
 * @returns {boolean}
 */
function isNotListedAnswer(answer) {
  return answer?.status === 'error' && answer?.data?.message === NOT_LISTED_MESSAGE;
}

/**
 * Whether a Flux node answers at `ip:port`: listed on the deterministic list, its
 * API on the minimum FluxOS version, its UI and its syncthing port up.
 * @param {string} ip IP address.
 * @param {string} port Port. Defaults to config.server.apiport.
 * @returns {Promise<string>} One of FluxAvailability.
 */
async function fluxAvailability(ip, port = config.server.apiport) {
  const axiosConfig = {
    timeout: 5000,
  };

  try {
    const ipchars = /^[0-9.]+$/;
    if (!ipchars.test(ip)) {
      throw new Error('Invalid IP');
    }
    if (!config.server.allowedPorts.includes(+port)) {
      throw new Error('Invalid Port');
    }
    const socketAddress = normalizeSocketAddress(`${ip}:${port}`);
    const isConfirmedNode = await fluxCommunicationUtils.socketAddressInFluxList(socketAddress);
    if (!isConfirmedNode) {
      return FluxAvailability.NOT_LISTED;
    }
    const fluxResponse = await serviceHelper.axiosGet(`http://${ip}:${port}/flux/version`, axiosConfig);
    if (fluxResponse.data.status !== 'success') return FluxAvailability.UNAVAILABLE;

    const fluxVersion = fluxResponse.data.data;
    const versionMinOK = serviceHelper.semverAtLeast(fluxVersion, config.minimumFluxOSAllowedVersion);
    if (!versionMinOK) return FluxAvailability.UNAVAILABLE;

    const homePort = +port - 1;
    // There is a new /health endpoint on the frontend express server. Since we have a catch-all route,
    // nodes on older versions will just return the index.html, so no change. Once all nodes on >= 6.6.1,
    // remove the title check (and this comment)
    const fluxResponseUi = await serviceHelper.axiosGet(`http://${ip}:${homePort}/health`, axiosConfig);
    const { data: UiPayload = '' } = fluxResponseUi;
    const uiAvailable = UiPayload === 'OK' || UiPayload.includes('<title>');
    if (!uiAvailable) return FluxAvailability.UNAVAILABLE;

    const syncthingPort = +port + 2;
    const portOpen = await isPortOpen(ip, syncthingPort);
    return portOpen ? FluxAvailability.AVAILABLE : FluxAvailability.UNAVAILABLE;
  } catch (e) {
    log.error(e);
    return FluxAvailability.UNAVAILABLE;
  }
}

/**
 * To perform a basic check of current FluxOS version.
 * @param {string} ip IP address.
 * @param {string} port Port. Defaults to config.server.apiport.
 * @returns {Promise<boolean>} True when a Flux node answers there (fluxAvailability).
 */
async function isFluxAvailable(ip, port = config.server.apiport) {
  return (await fluxAvailability(ip, port)) === FluxAvailability.AVAILABLE;
}

/**
 * To check Flux availability for specific IP address/port.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function checkFluxAvailability(req, res) {
  let { ip } = req.params;
  ip = ip || req.query.ip;
  let { port } = req.params;
  port = port || req.query.port;
  if (ip === undefined || ip === null) {
    const errMessage = messageHelper.createErrorMessage('No ip specified.');
    return res.json(errMessage);
  }

  const availability = await fluxAvailability(ip, port);

  let message;

  if (availability === FluxAvailability.AVAILABLE) {
    message = messageHelper.createSuccessMessage('Asking Flux is available');
  } else if (availability === FluxAvailability.NOT_LISTED) {
    message = messageHelper.createErrorMessage(NOT_LISTED_MESSAGE);
  } else {
    message = messageHelper.createErrorMessage('Asking Flux is not available');
  }
  return res.json(message);
}

/**
 * To check if application is available
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
/**
 * Whether a signed body - asked or answered - carries a signature from a
 * Fluxnode on the deterministic list, over its own contents.
 *
 * Extracted rather than written twice. Two copies of a signature check is the
 * one duplication that must not drift - whichever copy is corrected, the other
 * keeps accepting what it always did, and nothing points at it.
 *
 * The body is verified as it arrived minus the signature itself, which is how
 * the sender built the message it signed.
 *
 * `socketAddress` binds the signer to a place, and the two directions need
 * different answers. For a request, "some listed Fluxnode signed this" is the
 * whole question - any node on the list may ask. For an ANSWER it is not enough:
 * we dialled one address, and what comes back has to be from the node that lives
 * there rather than a signature made by, or relayed from, somewhere else.
 *
 * @param {object} processedBody The parsed body, carrying pubKey and signature
 * @param {{socketAddress?: string}} [options] The address the signer must hold
 * @returns {Promise<boolean>} True when a listed Fluxnode signed this body
 */
async function verifySignedFluxnodeMessage(processedBody, options = {}) {
  if (!processedBody || !processedBody.pubKey || !processedBody.signature) return false;

  const { pubKey, signature } = processedBody;

  const nodes = await fluxCommunicationUtils.deterministicFluxList({ filter: pubKey });
  if (!nodes.length) return false;

  const { socketAddress = null } = options;
  if (socketAddress && !nodes.some((node) => socketAddressesMatch(node.ip, socketAddress))) return false;

  const dataToVerify = { ...processedBody };
  delete dataToVerify.signature;

  return verificationHelper.verifyMessage(JSON.stringify(dataToVerify), pubKey, signature) === true;
}

/**
 * The most ports one request may ask this node to test.
 *
 * An application is capped at maxComponents (10) components of ports (5) each in
 * appValidator, so 50 is the largest honest ask. The bound exists because the
 * ports are tested one after another, each for up to a full connect timeout.
 */
const MAX_TESTABLE_PORTS = 50;

// Every installed application's ports plus the four node service ports the
// keep-alive caller adds - maxAppsPerNode x MAX_TESTABLE_PORTS + 4. A bound on
// how long one request can keep this node poking, and nothing tighter: the
// honest list really can be that long.
const NODE_SERVICE_PORTS_KEPT_ALIVE = 4;

/**
 * How many of one request's ports a peer probes at once, where it probes them
 * in parallel: UDP always, TCP when asked for every port's answer. A port that
 * never answers costs a full probe timeout, and 50 of them one after another
 * would outlast the requester's wait.
 */
const PORT_PROBE_CONCURRENCY = 16;
const MAX_KEEPALIVE_PORTS = config.fluxapps.maxAppsPerNode * MAX_TESTABLE_PORTS + NODE_SERVICE_PORTS_KEPT_ALIVE;

/**
 * The address a peer endpoint acts on: the one the caller connected from, or the
 * one it named when it holds the privilege to name one.
 *
 * Never an input otherwise. A caller that names the address chooses where this
 * node connects, which makes the endpoint a probe aimed at anything the caller
 * likes - the loopback and the RFC1918 side of its own router included. The
 * honest caller never needed it: it is asking about ITS OWN ports, so the
 * address it means is the one it is connecting from. That is the rule
 * /flux/addpeer already applies, and every inbound peer is already identified by
 * its socket address - a Fluxnode whose egress differed from its declared
 * address could not hold a peer slot anywhere on the network, so nothing
 * legitimate is lost by insisting on it.
 *
 * An IPv4 connection to a dual-stack listener arrives as ::ffff:a.b.c.d, and an
 * address that does not match itself would refuse every honest caller.
 *
 * @param {object} req
 * @param {string|undefined} namedAddress - what the body says, if anything
 * @param {boolean} mayName - whether this caller may choose the address
 * @returns {string} the address, or '' when there is none to act on
 */
function addressToProbe(req, namedAddress, mayName) {
  const remoteIp = (req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
  return mayName === true ? (namedAddress || remoteIp) : remoteIp;
}

async function checkAppAvailability(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      // The other way in. This endpoint's caller is a Fluxnode proving itself by
      // signature; this is for a PERSON driving it by hand instead, and the only
      // thing a person gets out of it is naming the address to probe below -
      // asking whether the ports are open on the machine they happen to be
      // sitting at answers nothing anyone wants. Skipping the signature and
      // choosing the address are therefore one question, and it is asked once.
      //
      // Not the node operator. NODE_OPERATOR_OR_FLUX_TEAM reads node-local and is
      // not: it is thousands of separate credentials, one per node, holding what
      // is a Flux team diagnostic. An operator wanting to dial out of their own
      // box has a shell on it, and their node still reaches this endpoint the way
      // every node does - by signing.
      const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));

      const processedBody = serviceHelper.ensureObject(body);

      const { ports } = processedBody;

      const ipPort = processedBody.port;

      // pubkey of the message has to be on the list
      const verified = await verifySignedFluxnodeMessage(processedBody);
      if (!verified && authorized !== true) {
        throw new Error('Unable to verify request authenticity');
      }

      // The address to probe is NOT an input - see addressToProbe. Here the
      // stakes are highest: the echo below hands back the first bytes of what
      // answered, so a body-supplied address turns every Flux node into a fetch
      // primitive aimed at anything a signed peer likes. The range guard does
      // not help: portMin is 1 and portMax is 65535, and bannedPorts names this
      // node's own services rather than a database's.
      //
      // Flux team may still name one, which is the whole of what the privilege
      // above is for: see it.
      const ip = addressToProbe(req, processedBody.ip, authorized);

      if (!ip) {
        throw new Error('Unable to determine which address to test');
      }

      if (!Array.isArray(ports)) {
        throw new Error('No ports to test');
      }

      // A valid application cannot hold more ports than the specification allows
      // it: maxComponents (10) x ports per component (5) = 50, both in
      // appValidator. Bounded at all because each port below costs up to a full
      // connect timeout and they are tested in sequence.
      if (ports.length > MAX_TESTABLE_PORTS) {
        throw new Error(`Too many ports to test. Maximum of ${MAX_TESTABLE_PORTS} allowed.`);
      }

      const { fluxapps: { portMin: minPort, portMax: maxPort } } = config;

      // A requester that wants proof asks for it. One that does not - an older
      // node - gets exactly the check it always got.
      const echo = processedBody.echo === true;
      // Every port read and answered for, a port that did not answer reading
      // null, rather than the test ending at the first port that failed. Only
      // with echo: the answers are what it returns.
      const everyPort = echo && processedBody.everyPort === true;
      // The protocols to test each port over. TCP alone when the caller names
      // none; with both, UDP is probed once TCP has passed.
      const protocols = processedBody.protocols ?? ['tcp'];
      if (!Array.isArray(protocols) || !protocols.length || !protocols.every((protocol) => protocol === 'tcp' || protocol === 'udp')) {
        throw new Error('Protocols to test must be tcp, udp or both');
      }
      const tcp = protocols.includes('tcp');
      const udp = protocols.includes('udp');
      const answered = {};

      const testable = ports.filter((port) => {
        const iBP = isPortBanned(+port);
        const portNum = +port;
        const withinRange = portNum >= minPort && portNum <= maxPort;
        if (!withinRange || iBP) {
          log.error(`Flux App port ${port} is outside allowed range. minPort: ${minPort}, maxPort: ${maxPort}, isBanned: ${iBP}`);
        }
        return withinRange && !iBP;
      });

      if (tcp && everyPort) {
        await forEachLimited(testable, PORT_PROBE_CONCURRENCY, async (port) => {
          answered[port] = await portAnswered(ip, port);
        });
      } else if (tcp) {
        // eslint-disable-next-line no-restricted-syntax
        for (const port of testable) {
          if (echo) {
            // Read rather than merely reached. The requester compares.
            // eslint-disable-next-line no-await-in-loop
            const answer = await portAnswered(ip, port);
            if (answer === null) {
              throw new Error(`Flux Applications on ${ip}:${ipPort} are not available. Failed port: ${port}`);
            }
            answered[port] = answer;
          } else {
            // eslint-disable-next-line no-await-in-loop
            const isOpen = await isPortOpen(ip, port);
            if (!isOpen) {
              throw new Error(`Flux Applications on ${ip}:${ipPort} are not available. Failed port: ${port}`);
            }
          }
        }
      }

      // A port this node could not send to is left out: that says nothing about
      // the port, and the requester reads an absent port as no proof.
      const udpAnswered = {};
      if (udp) {
        await forEachLimited(testable, PORT_PROBE_CONCURRENCY, async (port) => {
          const reply = await portAnsweredUdp(ip, +port);
          if (reply !== undefined) udpAnswered[port] = reply;
        });
      }
      const successResponse = messageHelper.createSuccessMessage(`Flux Applications on ${ip}:${ipPort} are available.`);
      // `answered` present at all is how the requester knows this peer READ the
      // ports rather than merely reaching them. Absent means no proof is
      // available from this peer, which is not the same as the ports being bad.
      // Added as a field rather than through createSuccessMessage, whose second
      // and third parameters are name and code.
      if (echo && tcp) successResponse.data.answered = answered;
      // Present at all says this peer probed UDP, as `answered` does for TCP.
      if (udp) successResponse.data.udpAnswered = udpAnswered;
      res.json(successResponse);
    } catch (error) {
      const errorResponse = messageHelper.createErrorMessage(
        error.message || error,
        error.name,
        error.code,
      );
      res.json(errorResponse);
    }
  });
}

/**
 * Connects to a TCP socket with timeout. Immediately sends RST and ends the connection
 * Solely used to keep a UPnP mapping open
 * @param {string} host The ip we are connecting to
 * @param {string} port The port we are connecting to
 * @param {number} timeout The connect timeout in ms
 * @returns {void}
 */
function tcpConnectAndDestroy(host, port, timeout) {
  const socket = new net.Socket();

  const timer = setTimeout(() => {
    socket.destroy();
  }, timeout);

  socket.connect(port, host, () => {
    clearTimeout(timer);
    socket.resetAndDestroy();
  });

  socket.on('error', () => {
    clearTimeout(timer);
  });
}

/**
 * Used to keep UPNP ports open because with miniupnpd after 10m on a port
 * without traffic it can be automatically closed. (Depending on if miniupnpd has
 * set for clean_ruleset_interval)
 *
 * This function *should* only take a max of ~5 seconds to run. That would be for a
 * node that has 20 ports open. (The ports can take a max of 3 seconds to test, but that
 * is asynchronous)
 *
 * The way we are doing this is quite inefficient, app specs don't make a differentiation
 * between TCP/UDP (they should). So we have to test both protocols.
 * We should just check the mappings themselves - and refresh whatever is open.
 *
 * @param {object} req Request
 * @param {object} res Response
 * @returns {Promise<void>}
 */
/**
 * POST /flux/keepupnpportsopen - poke the caller's ports so its router keeps the
 * UPnP mappings for them alive.
 *
 * The address poked is the one the caller connected from, never one it names -
 * the rule /flux/checkappavailability applies, for the reason on addressToProbe.
 * Naming one by hand is the same single privilege as skipping the signature:
 * Flux team, not one every node operator holds. The API port stays the caller's
 * to name, being a port on the address just bound.
 *
 * NO range or banned-port filter on the ports, deliberately, and unlike the
 * availability endpoint beside this one. The caller sends its own service ports
 * alongside its application ports - the API port minus one, minus five, plus one
 * and plus two - and every one of those sits inside the banned 16100-16299
 * block. The filter that is right there would silently end the keep-alive here.
 *
 * @param {object} req
 * @param {object} res
 */
async function keepUPNPPortsOpen(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));

    const { body } = req;
    const processedBody = serviceHelper.ensureObject(body);

    const { apiPort, ports, timestamp } = processedBody;

    const now = Math.floor(Date.now() / 1000);

    // allow 10 minutes for clock drift. Prevent packet from being replayed.
    if (!Number.isInteger(timestamp) || timestamp + 600 < now) {
      res.status(422).end();
      return;
    }

    if (!apiPort) {
      res.status(422).end();
      return;
    }

    if (!Array.isArray(ports) || ports.length > MAX_KEEPALIVE_PORTS) {
      res.status(422).end();
      return;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const port of ports) {
      if (!Number.isInteger(port)) {
        res.status(422).end();
        return;
      }
    }

    // pubkey of the message has to be on the list
    const verified = await verifySignedFluxnodeMessage(processedBody);
    if (!verified && authorized !== true) {
      res.status(401).end();
      throw new Error('Unable to verify request authenticity');
    }

    const ip = addressToProbe(req, processedBody.ip, authorized);
    if (!ip) {
      res.status(422).end();
      return;
    }

    // make sure that we can reach the api port first. This is in case of nodes that
    // are able to receive communcation from another node, but because of routing issues,
    // can connect back the other way. This has a timeout of 3 seconds, whereas the other end
    // has a 5 second timeout.
    await serviceHelper.axiosGet(`http://${ip}:${apiPort}/flux/uptime`, { timeout: 3_000 }).catch(() => {
      res.status(503).end();
      throw new Error('Unable to connect back to api port');
    });

    res.status(202).end();

    log.info(`keepUPNPPortsOpen - called from  ${ip} to test ports: ${ports}`);

    // eslint-disable-next-line no-restricted-syntax
    for (const port of ports) {
      tcpConnectAndDestroy(ip, port, 3_000);
      const udpSocket = dgram.createSocket('udp4');
      udpSocket.send('D', 0, 1, port, ip, () => {
        udpSocket.close();
      });
      // just add a small delay between requests here. As we can have quite a few
      // ports to open
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(250);
    }
  } catch (error) {
    log.error(`keepUPNPPortsOpen error - ${error}`);
  }
}

/**
 * Setter for localSocketAddress.
 * Main goal for this is testing availability.
 *
 * @param {string} value ip or ip:port to be set (normalized to ip:port)
 */
function setLocalSocketAddress(value) {
  const wasKnown = localSocketAddressGate.ready;
  localSocketAddress = value ? normalizeSocketAddress(value) : null;
  // (Re)set the freshness deadline whenever the value changes, so getLocalSocketAddress
  // serves it without a benchmark RPC until it goes stale (cleared when set to null).
  localSocketAddressFreshUntil = localSocketAddress ? process.hrtime.bigint() + LOCAL_SOCKET_ADDRESS_TTL_NS : 0n;
  if (localSocketAddress) localSocketAddressGate.open();
  else localSocketAddressGate.close();
  // Told here because this is the one place the node learns what it is. The
  // peer manager needs it to keep this node out of its own peer draws - a node
  // that syncs from itself learns nothing, and it spends one of very few
  // attempts doing so. Optional because the unit suite stubs peerState.
  peerManager.setOwnSocketAddress?.(localSocketAddress);
  if (localSocketAddress && localSocketAddress !== lastKnownSocketAddress) {
    lastKnownSocketAddress = localSocketAddress;
    localSocketAddressEvents.emit('change', localSocketAddress);
  }
  if (localSocketAddress && !wasKnown) localSocketAddressEvents.emit('known', localSocketAddress);
}

/**
 * @returns {string|null} The last address this node learned (ip:port), without
 *   asking the benchmark; null before the first.
 */
function getKnownLocalSocketAddress() {
  return lastKnownSocketAddress;
}

/**
 * This node's socket address, once it has one. Resolves as soon as benchmark
 * reports an address to any caller of getLocalSocketAddress; while none is known
 * the own-standing watch keeps asking for one.
 * @returns {Promise<string>} ip:port
 */
async function waitForLocalSocketAddress() {
  let address = await getLocalSocketAddress();
  while (!address) {
    // eslint-disable-next-line no-await-in-loop
    await localSocketAddressGate.wait();
    address = localSocketAddress;
  }
  return address;
}

/**
 * @param {function(string): void} listener Called with the new address (ip:port)
 *   each time the node learns an address that differs from the last one.
 * @returns {void}
 */
function onLocalSocketAddressChange(listener) {
  localSocketAddressEvents.on('change', listener);
}

/**
 * @param {function(string): void} listener
 * @returns {void}
 */
function offLocalSocketAddressChange(listener) {
  localSocketAddressEvents.off('change', listener);
}

/**
 * @param {function(number): void} listener Called, with the IP changes the
 *   window holds, each time this process finds the node held by the IP change
 *   hold. Removing the apps of a held node is the listener's.
 * @returns {void}
 */
function onIpChangeHold(listener) {
  ipChangeHoldEvents.on('held', listener);
}

/**
 * @param {function(number): void} listener
 * @returns {void}
 */
function offIpChangeHold(listener) {
  ipChangeHoldEvents.off('held', listener);
}

/**
 * @param {function(string): void} listener Called with the address each time the
 *   node has one after having none.
 * @returns {void}
 */
function onLocalSocketAddressKnown(listener) {
  localSocketAddressEvents.on('known', listener);
}

/**
 * Setter for dosMessage.
 * Main goal for this is testing availability.
 *
 * @param {string} message New message
 */
function setDosMessage(message) {
  dosMessage = message;
}

/**
 * Getter for dosMessage.
 * Returns the sticky DOS message if one is set, otherwise the regular one.
 * Main goal for this is testing availability.
 *
 * @returns {string} dosMessage
 */
function getDosMessage() {
  return getStickyDosMessage() || dosMessage;
}

// Whether this node's ports answer over UDP, as the availability check last
// established it with a peer's proof or two peers' silence; null until it has.
let udpReachability = null;

/**
 * @param {{reachable: boolean, port?: number, peers?: string[]}|null} value
 */
function setUdpReachability(value) {
  udpReachability = value;
}

/**
 * @returns {{reachable: boolean, port?: number, peers?: string[]}|null}
 */
function getUdpReachability() {
  return udpReachability;
}

/**
 * Take this node out of service for as long as one owner says so. Idempotent
 * per owner.
 * @param {string} owner A StickyDosOwner value. An unknown one throws: it is a
 * caller that was never given an identity, and accepting it would create a DOS
 * nothing can ever release.
 * @param {string} reason What an operator reads, and what is reported.
 */
function setStickyDos(owner, reason) {
  if (!Object.values(StickyDosOwner).includes(owner)) {
    throw new Error(`setStickyDos: unknown owner ${owner}`);
  }
  if (stickyDosHolds.get(owner) === reason) return;
  stickyDosHolds.set(owner, reason);
  log.error(`Sticky DOS set by ${owner}: ${reason}`);
  publishEffectiveDosState();
}

/**
 * Release one owner's verdict. Every other owner's stands, and the node stays
 * out of service until all of them have released - so a feature clearing its
 * own condition can never speak for one it knows nothing about.
 * @param {string} owner A StickyDosOwner value.
 */
function clearStickyDos(owner) {
  const reason = stickyDosHolds.get(owner);
  if (reason === undefined) return;
  stickyDosHolds.delete(owner);
  log.info(`Sticky DOS cleared by ${owner} (was: ${reason})`);
  publishEffectiveDosState();
}

/**
 * @param {string} owner A StickyDosOwner value.
 * @returns {boolean} True while that owner holds this node out of service.
 */
function isStickyDosHeldBy(owner) {
  return stickyDosHolds.has(owner);
}

/**
 * @returns {string|null} Why the node is out of service, or null when no owner
 * holds it. Every reason, not an arbitrary one: naming one of two would send an
 * operator to lift a condition that would not return the node to service.
 */
function getStickyDosMessage() {
  if (!stickyDosHolds.size) return null;
  return [...stickyDosHolds.values()].join('; ');
}

/**
 * The DOS state a reader sees. A held node reports the sticky verdict; an
 * unheld one reports what the availability checks have counted.
 * @returns {number}
 */
function effectiveDosState() {
  if (stickyDosHolds.size) return STICKY_DOS_STATE;
  const availabilityPoints = unreachablePoints + shortfallPoints;
  return availabilityPoints ? dosState + availabilityPoints : dosState;
}

/**
 * Publish the DOS state a reader would actually see.
 *
 * A consumer polling /flux/info cannot order a DOS against anything else: the
 * installed-apps record outlives the removal it follows by ~20s, so two polls
 * of two sources disagree about what happened first. On one event stream the
 * ids settle it.
 *
 * Inert in production - fluxEventBus.publish returns immediately unless
 * config.testEventStream is set, which it is only under the harness. This is
 * not the 21-site refactor noted below getDosStateValue; that one is about the
 * product's own scattered dosState mutations.
 */
function publishEffectiveDosState() {
  fluxEventBus.publish('dos:changed', {
    dosState: effectiveDosState(),
    dosMessage: getDosMessage(),
  });
}

/**
 * Setter for dosState.
 * Main goal for this is testing availability.
 *
 * @param {number} sets dosState
 */
function setDosStateValue(value) {
  dosState = value;
  fluxEventBus.publish('dos:changed', { dosState, dosMessage });
}

/**
 * Getter for dosState.
 * Main goal for this is testing availability.
 *
 * @returns {number} dosState
 */
function getDosStateValue() {
  return dosState;
}

// Future: refactor all 21 direct `dosState += N` / `dosState = N` mutations
// to go through addDosState()/setDosStateValue() with event emission on
// threshold crossing. This would eliminate polling and give immediate
// response to DOS state changes.
function isNodeDos() {
  return effectiveDosState() >= 100;
}

/**
 * Hold this node back from new placements. Idempotent per owner.
 * @param {string} owner A PlacementHoldOwner value. An unknown one throws: it is
 * a caller that was never given an identity, and accepting it would create an
 * owner nothing can ever release.
 * @param {string} reason Logged and reported.
 */
function setPlacementHold(owner, reason) {
  if (!Object.values(PlacementHoldOwner).includes(owner)) {
    throw new Error(`setPlacementHold: unknown owner ${owner}`);
  }
  if (placementHolds.get(owner) === reason) return;
  placementHolds.set(owner, reason);
  log.info(`Placement hold set by ${owner}: ${reason}`);
  fluxEventBus.publish('placementHold:set', { owner, reason });
}

/**
 * Release one owner's hold. Any other owner's hold stands, and the node stays
 * held until every one of them has released - so a feature clearing its own
 * condition can never speak for a condition it knows nothing about.
 * @param {string} owner A PlacementHoldOwner value.
 */
function clearPlacementHold(owner) {
  const reason = placementHolds.get(owner);
  if (reason === undefined) return;
  placementHolds.delete(owner);
  log.info(`Placement hold cleared by ${owner} (was: ${reason})`);
  fluxEventBus.publish('placementHold:cleared', { owner, reason });
}

/**
 * @returns {string|null} Why the node is held, or null when it is not.
 */
function getPlacementHold() {
  if (!placementHolds.size) return null;
  // Every reason, not an arbitrary one: the spawner logs this to say why the
  // node is not installing, and naming one of two holds would send an operator
  // to lift a condition that would not release the node.
  return [...placementHolds.values()].join('; ');
}

/**
 * @returns {boolean} True when this node must not take on new apps.
 */
function isPlacementHeld() {
  return placementHolds.size > 0;
}

/**
 * Get this node's socket address (ip:port).
 * @returns {Promise<string|null>} Normalized socket address (always ip:port) or null.
 */
async function getLocalSocketAddress(options = {}) {
  // A CALLER THAT IS PROBING, NOT IDENTIFYING, ASKS FOR `fresh`. The cache answers
  // "what is this node's address", and for the callers below that is all the
  // question is. It is not all of it for a caller reading the ANSWER'S ABSENCE as a
  // fact about the benchmark daemon: served from memory, a null that meant "the
  // daemon did not answer" becomes the last address it ever gave, and the caller
  // reads a dead daemon as a live one for as long as the window lasts.
  const { fresh = false } = options;

  // Serve the cached own-IP without a benchmark RPC while it is still fresh. A batch
  // cancel/install issues this call once per app on a hot serialized path (the explorer
  // block loop) and the value is invariant across the batch, so this collapses N RPCs to
  // one. A null (unresolved) value is never cached. The IP-change detector
  // (checkMyFluxAvailability) reads the module-scoped localSocketAddress + getPublicIp()
  // DIRECTLY, not through this function, so a <=TTL reflect-lag here after a (rate-limited)
  // IP change is harmless — the next benchmark resolve updates the value and the deadline.
  if (!fresh && localSocketAddress && process.hrtime.bigint() < localSocketAddressFreshUntil) {
    return localSocketAddress;
  }
  const benchmarkResponse = await benchmarkService.getBenchmarks();
  const { status, data: { ipaddress = null } = {} } = benchmarkResponse;
  // The benchmark IP can be a bare IP or ip:port depending on the node's API port,
  // and while fluxbench is still resolving it the value can be empty or a host-less
  // ":<port>" - the latter is truthy but useless. parseSocketAddress accepts a real
  // bare-IP or ip:port and rejects those unresolved forms, so callers (e.g. the
  // masterSlave election) never act on a bogus own-IP.
  if (status !== 'success' || !parseSocketAddress(ipaddress)) {
    setLocalSocketAddress(null);
    localSocketAddressEvents.emit('unresolved');
    return null;
  }
  setLocalSocketAddress(ipaddress);
  return localSocketAddress;
}

/**
 * To get FluxNode private key.
 * @param {string} privatekey Private Key.
 * @returns {string} Private key, if already input as parameter or otherwise from the daemon config.
 */
async function getFluxNodePrivateKey(privatekey) {
  if (privatekey) return privatekey;
  // flux.conf is a local file, and deriving this node's key from it needs no daemon. Asked
  // for here rather than assumed: nothing parses it at boot, so before this the value was
  // available only once some other code had made an RPC and loaded the config on the way
  // past - which made a key that was always on disk look like a daemon that was not up.
  await daemonServiceUtils.ensureConfigLoaded();
  return daemonServiceUtils.getConfigValue('zelnodeprivkey');
}

/**
 * To get FluxNode public key.
 * @param {string} privatekey Private key.
 * @returns {string} Public key.
 */
async function getFluxNodePublicKey(privatekey) {
  try {
    const pkWIF = await getFluxNodePrivateKey(privatekey);
    const { privateKey, compressed } = decodeWIF(pkWIF);
    const pubKey = privKeyToPubKey(privateKey, compressed);
    return pubKey;
  } catch (error) {
    // Null, not the Error. An Error here is the worst of both: truthy, so a
    // guard on the value passes; not a string, so nothing type-based notices;
    // and `{}` once JSON.stringify reaches it - which is how a node with a
    // briefly unavailable key went on broadcasting messages that every peer
    // silently refused. Said out loud too, because it was silent at the point
    // it happened and loud only at the far end.
    log.error(`getFluxNodePublicKey - unable to derive this node's public key: ${error.message || error}`);
    return null;
  }
}

/**
 * To close an outgoing connection.
 * @param {string} ip IP address.
 * @param {string} port node API port.
 * @returns {object} Message.
 */
async function closeConnection(ip, port) {
  if (!ip) return messageHelper.createWarningMessage('To close a connection please provide a proper IP number.');
  const key = `${ip}:${port}`;
  const peer = peerManager.get(key);
  if (!peer || peer.direction !== DIRECTION.OUTBOUND) {
    return messageHelper.createWarningMessage(`Connection to ${ip}:${port} does not exists.`);
  }
  // Evicted rather than closed: the caller asked for this peer to be gone, and
  // until it leaves the map it still fills a slot no reconnect is dialled for
  // and is still offered as a sync source.
  peerManager.evict(key, CLOSE_CODES.CLOSED_OUTBOUND, 'purposefully closed');
  log.info(`Connection to ${ip}:${port} closed with code ${CLOSE_CODES.CLOSED_OUTBOUND}`);
  return messageHelper.createSuccessMessage(`Outgoing connection to ${ip}:${port} closed`);
}

/**
 * To close an incoming connection.
 * @param {string} ip IP address.
 * @param {string} port node API port.
 * @param {object} expressWS Express web socket.
 * @param {object} clientToClose Web socket for client to close.
 * @returns {object} Message.
 */
async function closeIncomingConnection(ip, port) {
  if (!ip) return messageHelper.createWarningMessage('To close a connection please provide a proper IP number.');
  const key = `${ip}:${port}`;
  const peer = peerManager.get(key);
  if (!peer || peer.direction !== DIRECTION.INBOUND) {
    return messageHelper.createWarningMessage(`Connection from ${ip}:${port} does not exists.`);
  }
  peerManager.evict(key, CLOSE_CODES.CLOSED_INBOUND, 'purposefully closed');
  log.info(`Connection from ${ip}:${port} closed with code ${CLOSE_CODES.CLOSED_INBOUND}`);
  return messageHelper.createSuccessMessage(`Incoming connection to ${ip}:${port} closed`);
}

/**
 * To get IP addresses for incoming connections.
 * @param {object} req Request.
 * @param {object} res Response.
 */
/**
 * @deprecated Use getPeers with direction=inbound instead.
 */
function getIncomingConnections(req, res) {
  const connections = [];
  for (const peer of peerManager.inboundValues()) connections.push(peer.ip);
  const message = messageHelper.createDataMessage(connections);
  res.json(message);
}

/**
 * @deprecated Use getPeers with direction=inbound instead.
 */
function getIncomingConnectionsInfo(req, res) {
  const connections = [...peerManager.inboundValues()].map((p) => p.toPeerInfo());
  const message = messageHelper.createDataMessage(connections);
  return res ? res.json(message) : message;
}

/**
 * Setter for storedFluxBenchAllowed.
 * Main goal for this is testing availability.
 *
 * @param {number} value
 */
function setStoredFluxBenchAllowed(value) {
  storedFluxBenchAllowed = value;
}

/**
 * Getter for storedFluxBenchAllowed.
 * Main goal for this is testing availability.
 *
 * @returns {number} storedFluxBenchAllowed
 */
function getStoredFluxBenchAllowed() {
  return storedFluxBenchAllowed;
}

/**
 * Whether the NodeJS this process runs on meets the network minimum. FluxOS
 * calls runtime APIs that do not exist below it, so such a node cannot serve
 * correctly however healthy the rest of it looks.
 *
 * Asked once, at startup: the version is a property of the running process and
 * cannot change under it, so re-asking costs work to learn what is already
 * known. The verdict is a STICKY hold for the same reason - a good availability
 * pass ends in setDosMessage(null), which would clear an ordinary message and
 * let the node walk back into service on a runtime that cannot run the code.
 * A hold survives that, and is held by this check alone, so the answer is
 * stated once and stands until the node boots on a runtime that satisfies it.
 * @returns {boolean} True if the runtime is allowed. Otherwise false.
 */
function checkNodeJsVersionAllowed() {
  const minimumVersion = config.minimumNodeJsAllowedVersion;
  // No floor configured is not a failing node. This runs bare in
  // startFluxFunctions, whose catch re-enters it after 15s, so a throw here is
  // a boot loop rather than an error - and the safe direction for a missing
  // floor is to allow, never to take the fleet out of service.
  if (!minimumVersion) {
    log.error('checkNodeJsVersionAllowed - no minimum NodeJS version configured, skipping the check');
    return true;
  }
  const nodeJsVersion = process.versions.node;
  if (serviceHelper.semverAtLeast(nodeJsVersion, minimumVersion)) {
    return true;
  }
  setStickyDos(
    StickyDosOwner.NODEJS_FLOOR,
    `NodeJS Version Error. Current lower version allowed is v${minimumVersion} found v${nodeJsVersion}`,
  );
  return false;
}

/**
 * Whether the Docker this node runs meets the network minimum: the oldest
 * release FluxOS supports, whose networking rules the container firewall and
 * the app port rules are tested against.
 *
 * Asked once, when Docker first answers at startup. Upgrading Docker restarts
 * Docker, not FluxOS, so the verdict stands until FluxOS next starts, and the
 * message says so. A version that could not be read, or is not a SemVer
 * version, gives no verdict: a Docker API failing for a moment, or a build
 * naming itself oddly, is not a node below the floor. A pre-release is below
 * its release (28.1.1-rc.1 < 28.1.1).
 * @param {?string} dockerVersion The version Docker reports, or null when it
 *   could not be read.
 * @returns {boolean} True unless the version is known and below the floor.
 */
function checkDockerVersionAllowed(dockerVersion) {
  const minimumVersion = config.minimumDockerAllowedVersion;
  // As with the NodeJS floor: no floor configured allows, never refuses.
  if (!minimumVersion) {
    log.error('checkDockerVersionAllowed - no minimum Docker version configured, skipping the check');
    return true;
  }
  if (!dockerVersion) {
    log.error('checkDockerVersionAllowed - Docker did not report its version, no verdict');
    return true;
  }
  if (!serviceHelper.parseSemver(dockerVersion)) {
    log.error(`checkDockerVersionAllowed - Docker reported ${dockerVersion}, which is not a SemVer version, no verdict`);
    return true;
  }
  if (serviceHelper.semverAtLeast(dockerVersion, minimumVersion)) {
    return true;
  }
  setStickyDos(
    StickyDosOwner.DOCKER_FLOOR,
    `Docker Version Error. Current lower version allowed is v${minimumVersion} found v${dockerVersion}. Upgrade Docker and restart FluxOS`,
  );
  return false;
}

/**
 * Whether this node's cgroups are the ones FluxOS runs apps in: cgroup v2,
 * a kernel that can kill a whole cgroup (cgroup.kill, Linux 5.14), and Docker
 * placing containers through systemd. App slices, CPU burst and the kill a
 * host stall makes all rely on the three.
 *
 * Asked once, when Docker first answers at startup. The kernel's answers are
 * read from the cgroup filesystem: cgroup.kill is asked of FluxOS's own cgroup,
 * which /proc/self/cgroup names and which is never the root, the one cgroup
 * without the file. A driver that could not be read gives no verdict on the
 * driver.
 * @param {?string} cgroupDriver The cgroup driver Docker reports, or null when
 *   it could not be read.
 * @param {{cgroupRoot?: string, selfCgroupFile?: string}} [paths] Where the
 *   cgroup filesystem is mounted, and the file naming this process's cgroup.
 * @returns {Promise<boolean>} True unless a requirement is known to be unmet.
 */
async function checkCgroupsAllowed(cgroupDriver, { cgroupRoot = '/sys/fs/cgroup', selfCgroupFile = '/proc/self/cgroup' } = {}) {
  const exists = (file) => fs.access(path.join(cgroupRoot, file)).then(() => true, () => false);
  // cgroup v2 lists one line, 0::<path>
  const ownCgroup = (await fs.readFile(selfCgroupFile, 'utf8').catch(() => '')).match(/^0::(\/.*)$/m)?.[1];
  const unmet = [];
  if (!await exists('cgroup.controllers')) unmet.push('cgroup v2');
  else if (!ownCgroup || !await exists(path.join(ownCgroup, 'cgroup.kill'))) unmet.push('cgroup.kill (Linux 5.14 or later)');
  if (cgroupDriver === null) {
    log.error('checkCgroupsAllowed - Docker did not report its cgroup driver, no verdict on it');
  } else if (cgroupDriver !== 'systemd') {
    unmet.push(`Docker's systemd cgroup driver (found ${cgroupDriver})`);
  }
  if (!unmet.length) return true;
  setStickyDos(
    StickyDosOwner.CGROUP_FLOOR,
    `Cgroup Error. FluxOS requires cgroup v2, cgroup.kill and Docker's systemd cgroup driver; missing: ${unmet.join(', ')}. Fix the host and restart FluxOS`,
  );
  return false;
}

/**
 * Whether the MongoDB this node runs meets the network minimum: the oldest
 * release FluxOS supports.
 *
 * Asked once, when MongoDB first answers at startup. Upgrading MongoDB
 * restarts mongod, not FluxOS, so the verdict stands until FluxOS next starts,
 * and the message says so. A version that could not be read, or is not a
 * SemVer version, gives no verdict. A pre-release is below its release.
 * @param {?string} mongoDbVersion The version MongoDB reports, or null when it
 *   could not be read.
 * @returns {boolean} True unless the version is known and below the floor.
 */
function checkMongoDbVersionAllowed(mongoDbVersion) {
  const minimumVersion = config.minimumMongoDbAllowedVersion;
  if (!minimumVersion) {
    log.error('checkMongoDbVersionAllowed - no minimum MongoDB version configured, skipping the check');
    return true;
  }
  if (!mongoDbVersion) {
    log.error('checkMongoDbVersionAllowed - MongoDB did not report its version, no verdict');
    return true;
  }
  if (!serviceHelper.parseSemver(mongoDbVersion)) {
    log.error(`checkMongoDbVersionAllowed - MongoDB reported ${mongoDbVersion}, which is not a SemVer version, no verdict`);
    return true;
  }
  if (serviceHelper.semverAtLeast(mongoDbVersion, minimumVersion)) {
    return true;
  }
  setStickyDos(
    StickyDosOwner.MONGODB_FLOOR,
    `MongoDB Version Error. Current lower version allowed is v${minimumVersion} found v${mongoDbVersion}. Upgrade MongoDB and restart FluxOS`,
  );
  return false;
}

/**
 * To check if Flux benchmark version is allowed.
 * @returns {boolean} True if version is verified as allowed. Otherwise false.
 */
async function checkFluxbenchVersionAllowed() {
  if (storedFluxBenchAllowed) {
    const versionOK = serviceHelper.semverAtLeast(storedFluxBenchAllowed, config.minimumFluxBenchAllowedVersion);
    if (versionOK) releaseDosOwnedBy((message) => message.startsWith(FLUXBENCH_VERSION_MESSAGE_PREFIX));
    return versionOK;
  }
  try {
    const benchmarkInfoResponse = await benchmarkService.getInfo();
    if (benchmarkInfoResponse.status === 'success') {
      log.info(benchmarkInfoResponse);
      const benchmarkVersion = benchmarkInfoResponse.data.version;
      setStoredFluxBenchAllowed(benchmarkVersion);
      const versionOK = serviceHelper.semverAtLeast(benchmarkVersion, config.minimumFluxBenchAllowedVersion);
      if (versionOK) {
        releaseDosOwnedBy((message) => message.startsWith(FLUXBENCH_VERSION_MESSAGE_PREFIX));
        return true;
      }
      dosState += 11;
      setDosMessage(`Fluxbench Version Error. Current lower version allowed is v${config.minimumFluxBenchAllowedVersion} found v${benchmarkVersion}`);
      log.error(dosMessage);
      return false;
    }
    dosState += 2;
    setDosMessage('Fluxbench Version Error. Error obtaining FluxBench Version.');
    log.error(dosMessage);
    return false;
  } catch (err) {
    log.error(err);
    log.error(`Error on checkFluxBenchVersion: ${err.message}`);
    dosState += 2;
    setDosMessage('Fluxbench Version Error. Error obtaining Flux Version.');
    return false;
  }
}

/**
 * To get node uptime in seconds
 * @param {object} req Request.
 * @param {object} res Response.
 */
function fluxUptime(req, res) {
  let message;
  try {
    const ut = process.uptime();
    const measureUptime = Math.floor(ut);
    message = messageHelper.createDataMessage(measureUptime);
    return res ? res.json(message) : message;
  } catch (error) {
    log.error(error);
    message = messageHelper.createErrorMessage('Error obtaining uptime');
    return res ? res.json(message) : message;
  }
}

/**
 * To get system uptime in seconds
 * @param {object} req Request.
 * @param {object} res Response.
 */
function fluxSystemUptime(req, res) {
  let message;
  try {
    const uptime = os.uptime();
    const measureUptime = Math.floor(uptime);
    message = messageHelper.createDataMessage(measureUptime);
    return res ? res.json(message) : message;
  } catch (error) {
    log.error(error);
    message = messageHelper.createErrorMessage('Error obtaining uptime');
    return res ? res.json(message) : message;
  }
}

// NTP source detected once at first call, then reused
let ntpSource = null; // 'chrony' | 'timesyncd' | 'none'

function resetNtpSource() { ntpSource = null; }

/**
 * Detects which NTP source is available on this node.
 * @returns {Promise<string>} 'chrony', 'timesyncd', or 'none'
 */
async function detectNtpSource() {
  if (ntpSource !== null) return ntpSource;

  const { error: chronyError } = await serviceHelper.runCommand('chronyc', {
    params: ['tracking'],
    timeout: 5000,
    logError: false,
  });
  if (!chronyError) {
    ntpSource = 'chrony';
    log.info('NTP source detected: chrony');
    return ntpSource;
  }

  const { error: timedError } = await serviceHelper.runCommand('timedatectl', {
    params: ['timesync-status'],
    timeout: 5000,
    logError: false,
  });
  if (!timedError) {
    ntpSource = 'timesyncd';
    log.info('NTP source detected: timesyncd');
    return ntpSource;
  }

  ntpSource = 'none';
  log.info('NTP source detected: none');
  return ntpSource;
}

/**
 * Parses chrony offset from `chronyc tracking` output.
 * @param {string} stdout
 * @returns {number|null} offset in seconds
 */
function parseChronyOffset(stdout) {
  // "System time : 0.000001234 seconds slow of NTP time"
  const match = stdout.match(/System time\s*:\s*([\d.]+)\s+seconds\s+(slow|fast)/);
  if (!match) return null;
  return parseFloat(match[1]) * (match[2] === 'slow' ? -1 : 1);
}

/**
 * Parses timesyncd offset from `timedatectl timesync-status` output.
 * @param {string} stdout
 * @returns {number|null} offset in seconds
 */
function parseTimesyncOffset(stdout) {
  // "Offset: +1.234ms" or "Offset: -567us"
  const match = stdout.match(/Offset\s*:\s*([+-]?[\d.]+)(us|ms|s)/);
  if (!match) return null;
  let offset = parseFloat(match[1]);
  if (match[2] === 'us') offset /= 1e6;
  else if (match[2] === 'ms') offset /= 1e3;
  return offset;
}

/**
 * Gets NTP clock drift from the detected source.
 * @returns {Promise<{source: string, offset: number|null, time: number}>}
 */
async function getClockDrift() {
  const source = await detectNtpSource();
  const time = Math.floor(Date.now() / 1000);

  if (source === 'chrony') {
    const { error, stdout } = await serviceHelper.runCommand('chronyc', {
      params: ['tracking'],
      timeout: 5000,
      logError: false,
    });
    if (!error && stdout) {
      const offset = parseChronyOffset(stdout);
      if (offset !== null) return { source, offset, time };
    }
  } else if (source === 'timesyncd') {
    const { error, stdout } = await serviceHelper.runCommand('timedatectl', {
      params: ['timesync-status'],
      timeout: 5000,
      logError: false,
    });
    if (!error && stdout) {
      const offset = parseTimesyncOffset(stdout);
      if (offset !== null) return { source, offset, time };
    }
  }

  return { source, offset: null, time };
}

// Cached NTP clock offset in milliseconds. Refreshed every 5 minutes.
let localClockOffsetMs = null;
let clockOffsetInterval = null;

/**
 * Refresh the cached NTP clock offset from the system NTP source.
 */
async function refreshClockOffset() {
  try {
    const { offset } = await getClockDrift();
    localClockOffsetMs = offset !== null ? Math.round(offset * 1000) : null;
  } catch (e) {
    log.error(`Failed to refresh clock offset: ${e.message}`);
  }
}

/**
 * Start the clock offset cache. Call once during node startup.
 */
async function initClockOffsetCache() {
  await refreshClockOffset();
  if (!clockOffsetInterval) {
    clockOffsetInterval = setInterval(refreshClockOffset, 5 * 60 * 1000);
  }
}

/**
 * Returns the cached local NTP clock offset in milliseconds, or null if unavailable.
 * @returns {number|null}
 */
function getLocalClockOffsetMs() {
  return localClockOffsetMs;
}

/**
 * API handler for clock drift endpoint.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function clockDrift(req, res) {
  try {
    const data = await getClockDrift();
    const message = messageHelper.createDataMessage(data);
    return res ? res.json(message) : message;
  } catch (error) {
    log.error(error);
    const message = messageHelper.createErrorMessage('Error obtaining clock drift');
    return res ? res.json(message) : message;
  }
}

/**
 * To check if sufficient communication is established. Minimum number of outgoing and incoming peers must be met.
 * @param {object} req Request.
 * @param {object} res Response.
 */
function isCommunicationEstablished(req, res) {
  const { outboundCount, inboundCount } = peerManager;
  let message;
  if (outboundCount < config.fluxapps.minOutgoing) { // easier to establish
    message = messageHelper.createErrorMessage(`Not enough outgoing connections established to Flux network. Minimum required ${config.fluxapps.minOutgoing} found ${outboundCount}`);
  } else if (inboundCount < config.fluxapps.minIncoming) { // depends on other nodes successfully connecting to my node, todo enforcement
    message = messageHelper.createErrorMessage(`Not enough incoming connections from Flux network. Minimum required ${config.fluxapps.minIncoming} found ${inboundCount}`);
  } else {
    const uniqueOutboundIps = new Set();
    for (const peer of peerManager.outboundValues()) uniqueOutboundIps.add(peer.ip);
    if (uniqueOutboundIps.size < config.fluxapps.minUniqueIpsOutgoing) {
      message = messageHelper.createErrorMessage(`Not enough outgoing unique ip's connections established to Flux network. Minimum required ${config.fluxapps.minUniqueIpsOutgoing} found ${uniqueOutboundIps.size}`);
    } else {
      const uniqueInboundIps = new Set();
      for (const peer of peerManager.inboundValues()) uniqueInboundIps.add(peer.ip);
      if (uniqueInboundIps.size < config.fluxapps.minUniqueIpsIncoming) {
        message = messageHelper.createErrorMessage(`Not enough incoming unique ip's connections from Flux network. Minimum required ${config.fluxapps.minUniqueIpsIncoming} found ${uniqueInboundIps.size}`);
      } else {
        message = messageHelper.createSuccessMessage('Communication to Flux network is properly established');
      }
    }
  }
  return res ? res.json(message) : message;
}

// How far back the limit on IP changes counts, in blocks, and how many changes
// it allows in that time. Counted in blocks, the window is the chain's: neither
// a restart nor the node's clock moves it. 2400 blocks is 20 hours of 30 s
// blocks.
const IP_CHANGE_WINDOW_BLOCKS = 2400;
const IP_CHANGES_ALLOWED = 1;

// A chain fact since the PON fork.
const BLOCK_MS = 30 * 1000;

/**
 * The chain's height now, from this node's daemon: while the daemon is synced to
 * the chain's tip, the height it last reported and a block for every BLOCK_MS
 * since it reported it; 0 - unknown - otherwise. The daemon is still taken as
 * synced for a while after its last answer, and the chain moves on meanwhile. A
 * daemon behind the tip, catching up or re-syncing, reports a height below the
 * heights this node's IP changes were recorded at, and would read every one of
 * them as recent.
 * @returns {number}
 */
function chainHeight() {
  const { synced, height } = daemonServiceMiscRpcs.isDaemonSynced().data;
  if (!synced || !(height > 0)) return 0;
  const reportedAt = daemonServiceMiscRpcs.getLastSuccessfulRpcCall();
  if (!reportedAt) return height;
  return height + Math.max(0, Math.floor((Date.now() - reportedAt) / BLOCK_MS));
}

/**
 * The IP changes of `ipChangeHeights` inside the window at `height`, each the
 * height it was made at. A change recorded as null was made while this node
 * knew no chain height and is taken as made at `height`.
 * @param {Array<number|null>} ipChangeHeights
 * @param {number} height The chain's height.
 * @returns {number[]}
 */
function ipChangesInWindow(ipChangeHeights, height) {
  return ipChangeHeights.map((at) => at ?? height).filter((at) => height - at < IP_CHANGE_WINDOW_BLOCKS);
}

function getMaxNumberOfIpChanges() {
  return maxNumberOfIpChanges;
}

/**
 * Adopts the address this node holds now in place of the one it held: the move
 * is recorded as this node's own address record, and the node brought to it by
 * reconcileOwnMove. With `announceMove` the move is also told to the network,
 * which carries the node's rows at the old address to the new one.
 * @param {string} previous The socket address the node held.
 * @param {string} current The socket address it holds now.
 * @param {object} [options]
 * @param {boolean} [options.announceMove] Whether the change is told as a move.
 * @returns {Promise<void>}
 */
async function adjustExternalIp(previous, current, { announceMove = true } = {}) {
  if (typeof previous !== 'string' || typeof current !== 'string') {
    log.warn(`Gathered address ${current} is not a valid format`);
    return;
  }
  const previousSocket = normalizeSocketAddress(previous);
  const currentSocket = normalizeSocketAddress(current);
  const ip = extractIp(currentSocket);
  // https://github.com/sindresorhus/ip-regex/blob/master/index.js#L8
  const v4 = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}';
  const v4exact = new RegExp(`^${v4}$`);
  if (!v4exact.test(ip)) {
    log.warn(`Gathered IP ${ip} is not a valid format`);
    return;
  }
  if (socketAddressesMatch(previousSocket, currentSocket)) return;
  log.info(`New public Ip detected: ${currentSocket}, old Ip: ${previousSocket} , updating the FluxNode info on the network`);
  await recordOwnMove(previousSocket, currentSocket, announceMove);
  await reconcileOwnMove();
}

/**
 * Writes `ip` as this node's configured IP, keeping every other setting.
 * @param {string} ip
 * @returns {Promise<void>}
 */
async function writeConfiguredIp(ip) {
  const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
  log.info(`Adjusting External IP from ${userconfig.initial.ipaddress} to ${ip}`);
  const dataToWrite = `module.exports = {
  initial: {
    ipaddress: '${ip}',
    zelid: '${userconfig.initial.zelid || config.fluxTeamFluxID}',
    kadena: '${userconfig.initial.kadena || ''}',
    testnet: ${userconfig.initial.testnet || false},
    development: ${userconfig.initial.development || false},
    apiport: ${Number(userconfig.initial.apiport || config.server.apiport)},
    routerIP: '${userconfig.initial.routerIP || ''}',
    pgpPrivateKey: \`${userconfig.initial.pgpPrivateKey || ''}\`,
    pgpPublicKey: \`${userconfig.initial.pgpPublicKey || ''}\`,
  }
}`;
  await fs.writeFile(fluxDirPath, dataToWrite);
}

/**
 * Removes the installed apps that cannot follow this node to a new IP and
 * returns the rest: a static-IP app, and one that another instance already
 * holds at the new IP. `complete` is false when an app could not be judged or
 * removed - the installed apps could not be read, an enterprise spec could not
 * be decrypted, or a removal did not happen - so the next pass judges again.
 * An app already removed is no longer installed, so a pass repeated removes
 * nothing twice.
 * @param {string} previousSocket This node's former socket address.
 * @param {string} currentSocket Its new socket address.
 * @returns {Promise<{staying: object[], complete: boolean}>}
 */
async function appsStayingThroughIpMove(previousSocket, currentSocket) {
  // eslint-disable-next-line global-require
  const appQueryService = require('./appQuery/appQueryService');
  // eslint-disable-next-line global-require
  const registryManager = require('./appDatabase/registryManager');
  // eslint-disable-next-line global-require
  const appUninstaller = require('./appLifecycle/appUninstaller');
  // eslint-disable-next-line global-require
  const enterpriseHelper = require('./utils/enterpriseHelper');
  const staying = [];
  let complete = true;
  // Gone, or never there: either way not installed here now.
  const removed = async (appName) => {
    const outcome = await appUninstaller.removeAppLocally(appName, null, true, null, true)
      .catch((error) => { log.error(error); return RemovalOutcome.FAILED; });
    return outcome === RemovalOutcome.REMOVED || outcome === RemovalOutcome.NOT_INSTALLED;
  };
  const apps = await appQueryService.installedApps();
  if (apps.status !== 'success') return { staying, complete: false };
  // eslint-disable-next-line no-restricted-syntax
  for (const app of apps.data) {
    // Check if app requires static IP - if so, uninstall it since IP changed
    // Only decrypt enterprise app specs if the app has enterprise field (v8+)
    if (app.version >= 7 && (app.staticip === true || app.enterprise)) {
      let appSpecs = app;
      // Decrypt enterprise app specs if needed (v8+ with enterprise field)
      if (app.enterprise) {
        try {
          // eslint-disable-next-line no-await-in-loop
          appSpecs = await enterpriseHelper.checkAndDecryptAppSpecs(app);
        } catch (decryptError) {
          log.error(`Failed to decrypt enterprise specs for ${app.name}: ${decryptError.message}`);
          complete = false;
          // eslint-disable-next-line no-continue
          continue;
        }
      }
      if (appSpecs.staticip === true) {
        log.info(`Application ${app.name} requires static IP but node IP has changed, uninstalling app`);
        log.warn(`REMOVAL REASON: Static IP required - ${app.name} requires static IP but node IP changed from ${previousSocket} to ${currentSocket}`);
        // eslint-disable-next-line no-await-in-loop
        if (!await removed(app.name)) complete = false;
        // eslint-disable-next-line no-continue
        continue;
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const runningAppList = await registryManager.appLocation(app.name);
    // An instance at this IP means the ports are taken and this node cannot run
    // the app: one instance per IP is enforced by the host port mapping, so a
    // UPnP sibling on another port holds them just as surely as a node that owns
    // the address alone. That is why the address is compared at IP granularity.
    //
    // This node's OWN row is not that: it stores its own running-app row at the
    // address benchmark reports. Own-ness is the full socket address, which is
    // what separates it from the sibling that shares only the IP.
    const duplicateInstance = runningAppList.find((instance) => ipsMatch(instance.ip, currentSocket)
      && !socketAddressesMatch(instance.ip, currentSocket));
    if (duplicateInstance) {
      log.info(`Aplication: ${app.name}, was found on the network already running under the same ip, uninstalling app`);
      log.warn(`REMOVAL REASON: Duplicate IP detected - ${app.name} already running on network with IP ${extractIp(currentSocket)} (after IP change)`);
      // eslint-disable-next-line no-await-in-loop
      if (!await removed(app.name)) complete = false;
    } else {
      staying.push(app);
    }
  }
  return { staying, complete };
}

const OWN_ADDRESS_RECORD_ID = 'own';

function ownAddressCollection() {
  const db = dbHelper.databaseConnection();
  return db ? db.db(config.database.local.database).collection(config.database.local.collections.ownAddress) : null;
}

/**
 * This node's own address record, from its local database: null before it has
 * adopted an address.
 *
 * `socketAddress` is the address it adopted. When a move took it there,
 * `movedFrom` is where it moved from and `movedAt` when (ms), `ipChanged`
 * whether the IP changed or only the port, and `announce` whether the move is
 * told to the network. `ipChangeHeights` holds the block height of each IP
 * change inside IP_CHANGE_WINDOW_BLOCKS, null for one made before this node knew
 * a height, and `ipChangeHold` the hold a change over the limit started:
 * `{ fromHeight }`, null when none stands. The rest records which of the move's steps that
 * cannot be read back from the node itself are done, each by the `movedAt` of
 * the move it was done for: `appsHandledAt`, `announcedAt`, `geolocatedAt`,
 * `confirmationAcceptedAt`, and `settledAt` once the move is wholly in place.
 * @returns {Promise<object|null>}
 */
async function ownAddressRecord() {
  const records = ownAddressCollection();
  if (!records) return null;
  const record = await records.findOne({ _id: OWN_ADDRESS_RECORD_ID }, { projection: { _id: 0 } });
  return record ?? null;
}

async function updateOwnAddressRecord(fields) {
  await ownAddressCollection().updateOne({ _id: OWN_ADDRESS_RECORD_ID }, { $set: fields });
}

// The address this node last adopted as its own, and the addresses it has moved
// away from, held as each is recorded so reading them costs nothing.
let adoptedOwnAddress = null;
const ownAddressesLeft = new Set();

function noteOwnAddress(current, previous) {
  const to = normalizeSocketAddress(current);
  if (!to) return;
  const from = normalizeSocketAddress(previous);
  if (from && from !== to) ownAddressesLeft.add(from);
  ownAddressesLeft.delete(to);
  adoptedOwnAddress = to;
}

/**
 * Where this node is, for an address benchmark reports as its own: the address
 * it adopted when the reported one is an address it has moved away from - a move
 * is recorded, and its rows carried, before benchmark reports the new address -
 * and the reported one otherwise.
 * @param {string} reported
 * @returns {string|null}
 */
function ownAddressFor(reported) {
  const address = normalizeSocketAddress(reported);
  return address && adoptedOwnAddress && ownAddressesLeft.has(address) ? adoptedOwnAddress : address;
}

/**
 * Adopts `socketAddress` as this node's own without a move.
 * @param {string} socketAddress
 * @returns {Promise<void>}
 */
async function writeOwnAddressRecord(socketAddress) {
  noteOwnAddress(socketAddress, null);
  await ownAddressCollection().updateOne(
    { _id: OWN_ADDRESS_RECORD_ID },
    { $set: { socketAddress, movedFrom: null, movedAt: null, recordedAt: new Date() }, $unset: { recentIpChanges: '' } },
    { upsert: true },
  );
}

/**
 * Records this node's move from `previousSocket` to `currentSocket` as its own
 * address record, before anything acts on it: the one decision a move makes.
 * A move to an address the record already holds as a move is decided already,
 * so a second caller decides nothing; an address the record holds without a
 * move takes the move. The IP change is counted here, from the record, so it
 * is counted once however often the move is acted on.
 * @param {string} previousSocket
 * @param {string} currentSocket
 * @param {boolean} announce Whether the move is told to the network.
 * @returns {Promise<void>}
 */
async function recordOwnMove(previousSocket, currentSocket, announce) {
  const record = await ownAddressRecord();
  if (record?.movedFrom && socketAddressesMatch(record.socketAddress, currentSocket)) return;
  const movedAt = Date.now();
  const ipChanged = !ipsMatch(previousSocket, currentSocket);
  // A change made while no chain height is known is recorded without one, and
  // nothing is pruned: the window is judged once the height is known.
  const height = chainHeight();
  const recorded = record?.ipChangeHeights ?? [];
  const ipChangeHeights = height ? ipChangesInWindow(recorded, height) : [...recorded];
  if (ipChanged) ipChangeHeights.push(height || null);
  noteOwnAddress(currentSocket, previousSocket);
  await ownAddressCollection().updateOne(
    { _id: OWN_ADDRESS_RECORD_ID },
    {
      $set: {
        socketAddress: currentSocket,
        movedFrom: previousSocket,
        movedAt,
        ipChanged,
        announce,
        ipChangeHeights,
        appsHandledAt: null,
        announcedAt: null,
        geolocatedAt: null,
        confirmationAcceptedAt: null,
        settledAt: null,
        recordedAt: new Date(),
      },
      // what the record held of IP changes before they were counted in blocks
      $unset: { recentIpChanges: '' },
    },
    { upsert: true },
  );
  if (ipChanged) await enforceIpChangeHold();
}

/**
 * Whether the chain lists this node at `socketAddress`, and if not, asks for a
 * confirmation that lists it there, once per move: a refused one is asked for
 * again on the next pass.
 * @param {object} record This node's own address record.
 * @returns {Promise<boolean>} Whether the chain lists it there.
 */
async function confirmOwnAddress(record) {
  const status = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
  const listed = status?.status === 'success' ? status.data?.ip : null;
  if (listed && socketAddressesMatch(listed, record.socketAddress)) return true;
  if (record.confirmationAcceptedAt === record.movedAt) return false;
  const result = await daemonServiceFluxnodeRpcs.createConfirmationTransaction();
  if (result?.status === 'success' && result.data?.status !== 'Fail to send') {
    log.info(`createConfirmationTransaction: ${JSON.stringify(result)}`);
    await updateOwnAddressRecord({ confirmationAcceptedAt: record.movedAt });
  } else {
    log.warn(`own address - the confirmation of ${record.socketAddress} was refused, asked again on the next pass: ${JSON.stringify(result)}`);
  }
  return false;
}

/**
 * Brings this node to the move its own address record holds, doing only what
 * is not yet so: its configured IP rewritten, the apps the move cannot keep
 * removed and the rest restarted, the move recorded and told to the network,
 * its address confirmed on chain, its geolocation refreshed. Each step either
 * reads what is so before acting or is keyed to the move, so a pass repeated -
 * on each change of this node's address, each node list refresh, and boot -
 * finishes a move a failure or a restart left part done and does nothing twice.
 * The move is settled once the chain lists the new address and every app has
 * been handled. Runs only on the own-address queue.
 * @returns {Promise<void>}
 */
async function reconcileOwnMove() {
  const record = await ownAddressRecord();
  if (!record?.movedFrom || !record.movedAt || record.settledAt === record.movedAt) return;
  const {
    socketAddress: to, movedFrom: from, movedAt, ipChanged, announce,
  } = record;
  await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.OWN_ADDRESS_BEFORE_RECONCILE, to);
  const ip = extractIp(to);
  if (ipChanged && ip !== userconfig.initial.ipaddress) await writeConfiguredIp(ip);
  const appsDue = ipChanged && record.appsHandledAt !== movedAt;
  // Before the move is recorded: until then this node's own rows are at the old
  // address, which is what keeps them from reading as another instance at the
  // new one.
  const apps = appsDue ? await appsStayingThroughIpMove(from, to) : null;
  // The seam records and tells a move once whatever this node's record says,
  // so a pass that told it and stopped before writing announcedAt repeats
  // nothing.
  if (announce && onOwnAddressMoved && record.announcedAt !== movedAt) {
    await onOwnAddressMoved(from, to, movedAt);
    await updateOwnAddressRecord({ announcedAt: movedAt });
  }
  let appsHandled = !ipChanged || !appsDue;
  if (appsDue) {
    let restarted = true;
    if (apps.staying.length && onAddressChanged) {
      const asked = await onAddressChanged(apps.staying, `node ip changed to ${ip}`, `ownMove:${movedAt}`);
      restarted = Boolean(asked) && asked.asked === asked.components;
    }
    appsHandled = apps.complete && restarted;
    if (appsHandled) await updateOwnAddressRecord({ appsHandledAt: movedAt });
    else log.warn(`own address - not every app was handled for the move to ${to}; the next pass handles the rest`);
  }
  if (ipChanged && record.geolocatedAt !== movedAt) {
    // Update geolocation service to track IP change and update static IP status
    // eslint-disable-next-line global-require
    const geolocationService = require('./geolocationService');
    geolocationService.setNodeGeolocation();
    await updateOwnAddressRecord({ geolocatedAt: movedAt });
  }
  // Settled only once its apps are handled too: a settled move is not
  // reconciled again.
  if (await confirmOwnAddress(record) && appsHandled) await updateOwnAddressRecord({ settledAt: movedAt });
}

// Work on this node's own address, one piece at a time in the order it came.
let ownAddressWork = Promise.resolve();
function serialiseOwnAddressWork(work) {
  const run = ownAddressWork.then(work).catch((error) => log.error(`own address - ${error.message}`));
  ownAddressWork = run;
  return run;
}

/**
 * The address this node held before `reported`, for a node that has adopted no
 * address yet: the configured IP when `reported` is on another IP, at the port
 * the network lists this node's collateral at on that IP or else the reported
 * port; `reported` itself otherwise.
 * @param {string} reported
 * @returns {Promise<string>}
 */
async function configuredFormerAddress(reported) {
  const configuredIp = userconfig.initial.ipaddress;
  if (!configuredIp || ipsMatch(configuredIp, reported)) return reported;
  const status = await daemonServiceFluxnodeRpcs.getFluxNodeStatus().catch(() => null);
  const listed = status?.status === 'success' ? status.data?.ip : null;
  if (listed && ipsMatch(listed, configuredIp)) return normalizeSocketAddress(listed);
  return normalizeSocketAddress(`${configuredIp}:${extractPort(reported)}`);
}

/**
 * Whether a Flux node answers at `socketAddress`.
 * @param {string} socketAddress
 * @returns {Promise<boolean>}
 */
async function fluxAnswersAt(socketAddress) {
  let answered = true;
  await serviceHelper.axiosGet(`http://${extractIp(socketAddress)}:${extractPort(socketAddress)}/flux/version`, { timeout: 5000 })
    .catch(() => { answered = false; });
  return answered;
}

// How long a node that does not answer is given to come back before it is
// judged gone: a restart.
const ANSWER_GRACE_MS = 60 * 1000;

/**
 * Whether a Flux node answers at `socketAddress`, now or once the grace a
 * restarting node is given has passed.
 * @param {string} socketAddress
 * @returns {Promise<boolean>}
 */
async function fluxStillAnswersAt(socketAddress) {
  if (await fluxAnswersAt(socketAddress)) return true;
  await serviceHelper.delay(ANSWER_GRACE_MS);
  return fluxAnswersAt(socketAddress);
}

// How many peers must find nothing at an address before this node judges the
// node there gone, and how many it draws to find them.
const PEERS_FINDING_NOTHING = 2;
const PEER_DRAWS = 5;

// What peers find at an address.
const PeerFinding = Object.freeze({
  NOTHING: 'nothing',
  REACHED: 'reached',
  UNKNOWN: 'unknown',
});

/**
 * What peers find at `socketAddress`: this node's own view of one address can
 * fail where the network's does not. Asks distinct random peers, as the
 * availability check does. REACHED as soon as one reaches a Flux node there;
 * NOTHING once PEERS_FINDING_NOTHING have answered that nothing is available
 * there; UNKNOWN when too few answer to say.
 * @param {string} socketAddress
 * @returns {Promise<string>} One of PeerFinding.
 */
async function peersFindAt(socketAddress) {
  const asked = [socketAddress];
  let foundNothing = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (let draw = 0; draw < PEER_DRAWS && foundNothing < PEERS_FINDING_NOTHING; draw += 1) {
    // eslint-disable-next-line no-await-in-loop
    const peer = await networkStateService.getRandomExternalObserver(localSocketAddress, { exclude: asked });
    if (!peer) break;
    asked.push(peer);
    const url = `http://${extractIp(peer)}:${extractPort(peer)}/flux/checkfluxavailability?ip=${extractIp(socketAddress)}&port=${extractPort(socketAddress)}`;
    // eslint-disable-next-line no-await-in-loop
    const answer = await serviceHelper.axiosGet(url, { timeout: 15000 }).catch(() => null);
    const status = answer?.data?.status;
    if (status === 'success') {
      log.info(`${peer} reaches a Flux node at ${socketAddress}`);
      return PeerFinding.REACHED;
    }
    // A peer that does not list the address has not looked there.
    if (status === 'error' && !isNotListedAnswer(answer.data)) foundNothing += 1;
  }
  if (foundNothing >= PEERS_FINDING_NOTHING) return PeerFinding.NOTHING;
  log.info(`too few peers answered whether a Flux node is at ${socketAddress} to say`);
  return PeerFinding.UNKNOWN;
}

/**
 * Whether the Flux node at `socketAddress` is gone: nothing answers this node
 * there, now or once a restart's grace has passed, and peers find nothing
 * there either.
 * @param {string} socketAddress
 * @returns {Promise<boolean>}
 */
async function fluxGoneFrom(socketAddress) {
  if (await fluxStillAnswersAt(socketAddress)) return false;
  return await peersFindAt(socketAddress) === PeerFinding.NOTHING;
}

/**
 * Adopts `current` in place of `previous`, the configured address, which this
 * node has no record of leaving. Told to the network as a move only when this
 * node ran apps there. While that cannot be read nothing is adopted: the
 * collision check that calls this finds the same listing on its next pass and
 * asks again.
 * @param {string} previous
 * @param {string} current
 * @returns {Promise<void>}
 */
function leaveConfiguredAddress(previous, current) {
  return serialiseOwnAddressWork(async () => {
    const from = normalizeSocketAddress(previous);
    const ran = await ranAppsAt(from);
    if (ran === null) return;
    await adjustExternalIp(from, current, { announceMove: ran });
  });
}

// How long an adoption deferred on an unreadable database waits before this
// node's address is acted on again; the retry pending, while one is.
const OWN_ADDRESS_RETRY_MS = 60 * 1000;
let ownAddressRetry = null;

/**
 * Acts on the address benchmark reports as this node's own. One that differs
 * from the address the node last adopted is a move, whichever way it came and
 * whether or not the chain has already listed the node there. A node that has
 * adopted none compares it with its configured address, which a machine
 * started on a copy of another's configuration shares with that machine: until
 * the Flux node there is gone (fluxGoneFrom) it adopts the reported address and
 * the collision check judges it; once it is, it adopts the reported address in
 * place of the configured one, told as a move only when it ran apps there.
 * While whether it ran apps there cannot be read it adopts nothing, and acts on
 * the address it knows again after OWN_ADDRESS_RETRY_MS.
 * @param {string} current The reported socket address.
 * @returns {Promise<void>}
 */
function handleOwnAddress(current) {
  return serialiseOwnAddressWork(async () => {
    const reported = normalizeSocketAddress(current);
    if (!reported) return;
    const record = await ownAddressRecord();
    if (record) noteOwnAddress(record.socketAddress, record.movedFrom);
    const previous = record ? record.socketAddress : await configuredFormerAddress(reported);
    if (!socketAddressesMatch(previous, reported)) {
      if (!record && !await fluxGoneFrom(previous)) {
        log.warn(`own address - a Flux node is at ${previous}, the configured address, so ${reported} is not a move from it`);
        await writeOwnAddressRecord(reported);
        return;
      }
      const announceMove = record ? true : await ranAppsAt(previous);
      if (announceMove === null) {
        ownAddressRetry ??= setTimeout(() => {
          ownAddressRetry = null;
          handleOwnAddress(getKnownLocalSocketAddress() || reported);
        }, OWN_ADDRESS_RETRY_MS);
        return;
      }
      await adjustExternalIp(previous, reported, { announceMove });
    } else if (!record) {
      await writeOwnAddressRecord(reported);
    } else {
      await reconcileOwnMove();
    }
  });
}

// The listener watching this node's own address, while one is.
let ownAddressListener = null;

/**
 * Acts on every change of this node's own address from here on, and on the one
 * it already knows. Watches once however often it is called: a boot that is run
 * again does not add a second watcher.
 * @returns {function(): void} Stops the watch.
 */
function startOwnAddressWatch() {
  if (!ownAddressListener) {
    ownAddressListener = (address) => { handleOwnAddress(address); };
    onLocalSocketAddressChange(ownAddressListener);
    const known = getKnownLocalSocketAddress();
    if (known) handleOwnAddress(known);
  }
  return () => {
    if (ownAddressListener) offLocalSocketAddressChange(ownAddressListener);
    ownAddressListener = null;
    clearTimeout(ownAddressRetry);
    ownAddressRetry = null;
  };
}

// The DOS messages this node's own checks set. There is one message for every
// reason a node can be out of service, so each check clears only one it set
// itself, matched against these.
const UNREACHABLE_MESSAGE = 'Flux communication is limited, other nodes on the network cannot reach yours through API calls';
const UNAVAILABLE_MESSAGE = 'Flux is not available for outside communication';
const BENCH_PUBLIC_IP_MESSAGE = 'Error getting publicIp from FluxBench';
const REACHABILITY_MESSAGES = [UNREACHABLE_MESSAGE, UNAVAILABLE_MESSAGE, BENCH_PUBLIC_IP_MESSAGE];
const IP_DETECTION_FAILED_MESSAGE = 'Flux IP detection failed';
const IP_CHANGES_MESSAGE = 'IP changes over the limit allowed, one in 20 hours';
const FLUXBENCH_VERSION_MESSAGE_PREFIX = 'Fluxbench Version Error.';
const COLLISION_MESSAGE_PREFIXES = ['Flux collision detection.', 'Flux earlier collision detection'];
function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * Ends the node's DOS when the message standing is one `owns` recognises.
 * @param {function(string): boolean} owns
 * @returns {void}
 */
function releaseDosOwnedBy(owns) {
  if (!dosMessage || !owns(dosMessage)) return;
  dosState = 0;
  setDosMessage(null);
}

const isCollisionMessage = (message) => COLLISION_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix));

// What the availability check has counted against this node, apart from the
// score the other checks share: the asks no peer answered as reachable, and
// the time it has been reachable with too few peer connections. The node's
// DOS state is the two added to the shared score (effectiveDosState), so a
// check that resets the shared score leaves these standing, and the
// availability check takes off only its own. The message it set is kept to
// end only that one.
let unreachablePoints = 0;
let shortfallPoints = 0;
let availabilityMessage = null;

// When this node last found itself reachable with too few peer connections, while
// it keeps doing so: null otherwise.
let peerShortfallSeenAt = null;

/**
 * Sets `message` as the availability check's, when no message stands or
 * `replace` says this one outranks the one standing.
 * @param {string} message
 * @param {object} [options]
 * @param {boolean} [options.replace]
 * @returns {void}
 */
function holdAvailabilityDos(message, { replace = false } = {}) {
  if (dosMessage && !replace) return;
  availabilityMessage = message;
  setDosMessage(message);
}

/**
 * Ends what the availability check counted against reaching this node, and the
 * message it sets for that if it is the one standing: the node was reached.
 * @returns {void}
 */
function releaseUnreachable() {
  unreachablePoints = 0;
  if (REACHABILITY_MESSAGES.includes(dosMessage)) {
    availabilityMessage = null;
    setDosMessage(null);
  }
  publishEffectiveDosState();
}

/**
 * Ends what the availability check counted for too few peer connections, and
 * its message if that is the one standing: the node has enough.
 * @returns {void}
 */
function releaseShortfall() {
  shortfallPoints = 0;
  peerShortfallSeenAt = null;
  if (dosMessage && dosMessage === availabilityMessage && !REACHABILITY_MESSAGES.includes(dosMessage)) {
    availabilityMessage = null;
    setDosMessage(null);
  }
  publishEffectiveDosState();
}

/**
 * Forgets what the availability check counted and the message it set, as a
 * DOS state set from outside does.
 * @returns {void}
 */
function resetAvailabilityDos() {
  unreachablePoints = 0;
  shortfallPoints = 0;
  peerShortfallSeenAt = null;
  availabilityMessage = null;
}

/**
 * A peer connected: once this node has the connections it needs, what the
 * availability check counted for too few of them ends now rather than at its
 * next pass.
 * @returns {void}
 */
function onPeerConnected() {
  if (peerShortfallSeenAt === null && shortfallPoints === 0) return;
  if (isCommunicationEstablished().status === 'error') return;
  releaseShortfall();
}

// The IP change hold this node's own address record holds, `{ fromHeight }`,
// as last read or written: null when none stands.
let ipChangeHold = null;

/**
 * Holds this node out of service, a sticky DOS of its own owner, while its IP
 * change hold stands: until the chain is IP_CHANGE_WINDOW_BLOCKS past the height
 * it started at, and while no height is known, or none was when it started.
 * Releases that owner's DOS otherwise.
 * @returns {boolean} Whether the node is held.
 */
function applyIpChangeHold() {
  const height = chainHeight();
  const fromHeight = ipChangeHold?.fromHeight ?? null;
  if (ipChangeHold && (!height || fromHeight === null || height - fromHeight < IP_CHANGE_WINDOW_BLOCKS)) {
    setStickyDos(StickyDosOwner.IP_CHANGES, IP_CHANGES_MESSAGE);
    return true;
  }
  clearStickyDos(StickyDosOwner.IP_CHANGES);
  return false;
}

/**
 * One pass of enforceIpChangeHold. At a chain height, it judges the IP changes
 * the record holds inside the window: over the limit with no hold standing, it
 * starts one at the height of the newest change; over the limit with one
 * standing, a change after the hold's start moves the start to it, so a node
 * that keeps changing stays held. A node this process finds newly held is told
 * to the onIpChangeHold listeners. Passes run one at a time and a started hold
 * is in the record before the next pass reads it, so it is told once.
 * @returns {Promise<boolean>} Whether the node is held.
 */
async function enforceIpChangeHoldOnce() {
  const record = await ownAddressRecord();
  const height = chainHeight();
  let hold = record?.ipChangeHold ?? null;
  if (record && height) {
    const records = ownAddressCollection();
    const recorded = record.ipChangeHeights ?? [];
    const inWindow = ipChangesInWindow(recorded, height);
    if (recorded.includes(null)) {
      await records.updateOne(
        { _id: OWN_ADDRESS_RECORD_ID, ipChangeHeights: recorded },
        { $set: { ipChangeHeights: inWindow } },
      );
    }
    maxNumberOfIpChanges = inWindow.length;
    if (!hold && inWindow.length > IP_CHANGES_ALLOWED) {
      hold = { fromHeight: Math.max(...inWindow) };
      await records.updateOne({ _id: OWN_ADDRESS_RECORD_ID }, { $set: { ipChangeHold: hold } });
      log.error(IP_CHANGES_MESSAGE);
    } else if (hold && hold.fromHeight === null) {
      await records.updateOne(
        { _id: OWN_ADDRESS_RECORD_ID, ipChangeHold: { fromHeight: null } },
        { $set: { ipChangeHold: { fromHeight: height } } },
      );
      hold = { fromHeight: height };
    } else if (hold && inWindow.length > IP_CHANGES_ALLOWED && Math.max(...inWindow) > hold.fromHeight) {
      const extended = { fromHeight: Math.max(...inWindow) };
      await records.updateOne(
        { _id: OWN_ADDRESS_RECORD_ID, ipChangeHold: { fromHeight: hold.fromHeight } },
        { $set: { ipChangeHold: extended } },
      );
      hold = extended;
    } else if (hold && height - hold.fromHeight >= IP_CHANGE_WINDOW_BLOCKS) {
      await records.updateOne(
        { _id: OWN_ADDRESS_RECORD_ID, ipChangeHold: { fromHeight: hold.fromHeight } },
        { $set: { ipChangeHold: null } },
      );
      hold = null;
    }
  }
  const wasHeld = isStickyDosHeldBy(StickyDosOwner.IP_CHANGES);
  ipChangeHold = hold;
  const held = applyIpChangeHold();
  if (held && !wasHeld) ipChangeHoldEvents.emit('held', maxNumberOfIpChanges);
  return held;
}

// The pass of enforceIpChangeHold running, and the one asked for while it runs.
let ipChangeHoldEnforcing = null;
let ipChangeHoldEnforceNext = null;

/**
 * Brings the IP change hold to what this node's own address record holds at
 * the daemon's height, and holds the node by it: the one place the hold this
 * node acts on is set or ended. The record is kept to that height: a hold, or a
 * change, recorded before this node knew a height is given the first height it
 * knows, and a hold the chain has passed is ended.
 *
 * One pass runs at a time. A call while one runs is answered by a pass that
 * starts after it ends, so the record a writer has just written is read by a
 * pass that began after the write.
 * @returns {Promise<boolean>} Whether the node is held.
 */
function enforceIpChangeHold() {
  if (!ipChangeHoldEnforcing) {
    ipChangeHoldEnforcing = enforceIpChangeHoldOnce().finally(() => { ipChangeHoldEnforcing = null; });
    return ipChangeHoldEnforcing;
  }
  if (!ipChangeHoldEnforceNext) {
    ipChangeHoldEnforceNext = ipChangeHoldEnforcing.catch(() => {}).then(() => {
      ipChangeHoldEnforceNext = null;
      return enforceIpChangeHold();
    });
  }
  return ipChangeHoldEnforceNext;
}

// Stops the IP change hold's watch of the daemon's height, while it watches.
let stopIpChangeHoldWatch = null;

/**
 * Enforces the IP change hold this node's own address record holds, now and at
 * each height the daemon reports from here on. Watches once however often it
 * is called.
 * @returns {function(): void} Stops the watch.
 */
function startIpChangeHoldWatch() {
  if (!stopIpChangeHoldWatch) {
    const enforce = () => enforceIpChangeHold().catch((error) => log.error(`IP change hold - ${error.message}`));
    stopIpChangeHoldWatch = daemonServiceMiscRpcs.onDaemonHeight(enforce);
    enforce();
  }
  return () => {
    if (stopIpChangeHoldWatch) stopIpChangeHoldWatch();
    stopIpChangeHoldWatch = null;
  };
}

/**
 * To check user's FluxNode availability.
 * @param {number} retryNumber Number of retries.
 * @returns {Promise<boolean>} Return value is only for testing
 */
async function checkMyFluxAvailability(retryNumber = 0) {
  if (isStickyDosHeldBy(StickyDosOwner.IP_CHANGES)) return false;

  if (localSocketAddress === null) return false;

  const fluxBenchVersionAllowed = await checkFluxbenchVersionAllowed();
  if (!fluxBenchVersionAllowed) {
    return false;
  }

  // An external observer. This asks a peer whether it can reach US, and a Flux
  // node sharing our public address cannot answer: reaching us means leaving the
  // router and being sent straight back in, which most consumer routers do not
  // do. Asking one produced a false "unreachable" and two points of dosState,
  // on exactly the shared-address topology this release is about.
  const randomSocketAddress = await networkStateService.getRandomExternalObserver(
    localSocketAddress,
  );

  // Nobody outside this address to ask, so nothing is learned and nothing is
  // concluded - dosState is deliberately untouched here, unlike every failure
  // path below it. The next cycle asks again.
  if (!randomSocketAddress) {
    log.warn('checkMyFluxAvailability - no Flux node outside this address could be asked; skipping this pass');
    return false;
  }

  const remoteIp = extractIp(randomSocketAddress);
  const remotePort = extractPort(randomSocketAddress);

  const axiosConfig = {
    timeout: 7000,
  };

  const localIp = extractIp(localSocketAddress);
  const localApiPort = extractPort(localSocketAddress);

  const url = `http://${remoteIp}:${remotePort}/flux/`
    + `checkfluxavailability?ip=${localIp}&port=${localApiPort}`;

  const resMyAvailability = await serviceHelper.axiosGet(url, axiosConfig).catch(
    (error) => {
      log.error(`checkMyFluxAvailability - ${remoteIp}:${remotePort}`
        + ` is not reachable. ${error.message}`);

      return null;
    },
  );

  // The observer does not list this address yet - typically a move it has not seen
  // confirmed - so it has not looked: nothing is concluded from it, dosState is
  // untouched, and the next observer is asked.
  if (resMyAvailability && isNotListedAnswer(resMyAvailability.data)) {
    log.info(`checkMyFluxAvailability - ${remoteIp}:${remotePort} does not list ${localSocketAddress} yet; asking another`);
    if (retryNumber <= 6) return checkMyFluxAvailability(retryNumber + 1);
    return false;
  }

  // Known limitation, replaced in v9: a failed check retries at once against another
  // random node, up to seven times, and each failure adds 2 to dosState, so one bad
  // moment on the network can put the node in DOS within seconds. The re-check a
  // failure schedules clears it.
  if (!resMyAvailability) {
    unreachablePoints += 2;
    if (effectiveDosState() > 10) {
      holdAvailabilityDos(UNREACHABLE_MESSAGE);
      log.error(dosMessage);
      return false;
    }
    if (retryNumber <= 6) {
      const newRetryIndex = retryNumber + 1;
      return checkMyFluxAvailability(newRetryIndex);
    }
    return false;
  }
  if (resMyAvailability.data.status === 'error' || resMyAvailability.data.data.message.includes('not')) {
    log.error(`My Flux unavailability detected from: ${remoteIp}:${remotePort}`);
    // Asked Flux cannot reach me lets check if ip changed
    if (retryNumber === 4 || effectiveDosState() > 10) {
      log.info('Getting publicIp from FluxBench');
      const benchIpResponse = await benchmarkService.getPublicIp();
      if (benchIpResponse.status === 'success') {
        log.info(`FluxBench reported public IP: ${benchIpResponse.data}`);
        const benchMyIp = benchIpResponse.data.length > 5 ? benchIpResponse.data : null;
        if (benchMyIp && extractIp(benchMyIp) !== localIp) {
          daemonServiceUtils.setStandardCache('getbenchmarks[]', null);
          log.info('New IP found... updating network');
          releaseUnreachable();
          // Read afresh: a new address is a change of this node's own address,
          // which its one handler acts on.
          await getLocalSocketAddress({ fresh: true });
          return true;
        } if (benchMyIp && extractIp(benchMyIp) === localIp) {
          log.info('FluxBench reported the same Ip that was already in use');
        } else {
          log.info('FluxBench reported a invalid IP');
          holdAvailabilityDos(BENCH_PUBLIC_IP_MESSAGE, { replace: true });
          unreachablePoints += 15;
          log.error('FluxBench wasnt able to detect flux node public ip');
        }
      } else {
        log.info('FluxBench reported returned error on getpublicipcall');
        holdAvailabilityDos(BENCH_PUBLIC_IP_MESSAGE, { replace: true });
        unreachablePoints += 15;
        log.error(dosMessage);
        return false;
      }
    }
    unreachablePoints += 2;
    if (effectiveDosState() > 10) {
      holdAvailabilityDos(UNAVAILABLE_MESSAGE);
      log.error(dosMessage);
      return false;
    }
    if (retryNumber <= 6) {
      const newRetryIndex = retryNumber + 1;
      return checkMyFluxAvailability(newRetryIndex);
    }
    return false;
  }
  const measuredUptime = fluxUptime();
  if (measuredUptime.status === 'success' && measuredUptime.data > config.fluxapps.minUpTime) { // node has been running for 30 minutes. Upon starting a node, there can be dos that needs resetting
    const found = await fluxCommunicationUtils.getFluxnodeFromFluxList(localSocketAddress);
    const nodeCount = await fluxCommunicationUtils.getNodeCount();

    if (nodeCount > config.fluxapps.minIncoming + config.fluxapps.minOutgoing && found) { // our node MUST be in confirmed list in order to have some peers
      // check sufficient connections
      const connectionInfo = isCommunicationEstablished();
      if (connectionInfo.status === 'error') {
        // Reachable: what this check counted against reaching it no longer
        // holds. The count for too few peers goes on.
        releaseUnreachable();
        // peerShortfallDosPerMinute for each minute it lasts. This depends on
        // other nodes being able to connect to my node.
        const now = monotonicMs();
        const minutes = peerShortfallSeenAt === null ? 1 : (now - peerShortfallSeenAt) / 60000;
        peerShortfallSeenAt = now;
        shortfallPoints += config.fluxapps.peerShortfallDosPerMinute * minutes;
        if (effectiveDosState() > 10) {
          holdAvailabilityDos(connectionInfo.data.message || 'Flux does not have sufficient peers');
          log.error(dosMessage);
          return false;
        }
        return true; // availability ok
      }
    }
  } else if (measuredUptime.status === 'error') {
    log.error('Flux uptime is not available'); // introduce dos increment
  }
  releaseUnreachable();
  releaseShortfall();
  return true;
}

/**
 * Checks once whether this node's collateral is listed anywhere it should not be:
 * twice at its own address, or at another address. Runs on each node list
 * refresh and each change of this node's own address; one that cannot decide
 * yet - no address, an unsynced daemon, no list - decides nothing and the next
 * refresh asks again.
 * @returns {Promise<void>}
 */
async function checkDeterministicNodesCollisions() {
  try {
    // get my external ip address
    // get node list with filter on this ip address
    // if it returns more than 1 object, shut down.
    // another precatuion might be comparing node list on multiple nodes. evaulate in the future
    const localSocketAddr = await getLocalSocketAddress();
    if (localSocketAddr) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) return;
      // An unknown list reads as an empty one to every accessor below, which
      // would find no collision anywhere.
      if (!networkStateService.isReady()) return;
      const nodeList = await fluxCommunicationUtils.deterministicFluxList();
      const result = nodeList.filter((node) => socketAddressesMatch(node.ip, localSocketAddr));
      const nodeStatus = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
      if (nodeStatus.status === 'success') { // different scenario is caught elsewhere
        const myCollateral = nodeStatus.data.collateral;
        const myNode = result.find((node) => node.collateral === myCollateral);
        const nodeCollateralDifferentIp = nodeList.find((node) => node.collateral === myCollateral && !socketAddressesMatch(node.ip, localSocketAddr));
        // A listing elsewhere is judged against this node's address as benchmark
        // reports it now, not as cached: the list can name a new address of this
        // node before the cache does. One that has moved on judges nothing here -
        // the change runs this check again, and the move, from the new address.
        if (nodeCollateralDifferentIp) {
          const current = await getLocalSocketAddress({ fresh: true });
          if (!current || !socketAddressesMatch(current, localSocketAddr)) return;
        }
        if (result.length > 1) {
          log.warn('Multiple Flux Node instances detected');
          if (myNode) {
            const myBlockHeight = myNode.readded_confirmed_height || myNode.confirmed_height; // todo we may want to introduce new readded heights and readded confirmations
            const filterEarlierSame = result.filter((node) => (node.readded_confirmed_height || node.confirmed_height) <= myBlockHeight);
            // keep running only older collaterals
            if (filterEarlierSame.length >= 1) {
              log.error(`Flux earlier collision detection on ip:${localSocketAddr}`);
              dosState = 100;
              setDosMessage(`Flux earlier collision detection on ip:${localSocketAddr}`);
              return;
            }
          }
          // prevent new activation
        } else if (result.length === 1) {
          if (!myNode) {
            log.error('Flux collision detection. Another ip:port is confirmed on flux network with the same collateral transaction information.');
            dosState = 100;
            setDosMessage('Flux collision detection. Another ip:port is confirmed on flux network with the same collateral transaction information.');
            return;
          }
        }
        // A listing at the address this node recorded moving from is its own move,
        // waiting for its confirmation: nothing to judge.
        const ownRecord = nodeCollateralDifferentIp ? await ownAddressRecord() : null;
        const movedFromHere = Boolean(ownRecord?.movedFrom) && socketAddressesMatch(ownRecord.movedFrom, nodeCollateralDifferentIp.ip);
        // Listed nowhere it should not be: whatever this check said no longer holds.
        if (!nodeCollateralDifferentIp || movedFromHere) releaseDosOwnedBy(isCollisionMessage);
        if (nodeStatus.data.status === 'CONFIRMED' && nodeCollateralDifferentIp && !movedFromHere) {
          const askingIP = extractIp(nodeCollateralDifferentIp.ip);
          const askingIpPort = extractPort(nodeCollateralDifferentIp.ip);
          log.info(`Detected same collateral on different IP: ${askingIP}:${askingIpPort}. Checking if other node is reachable...`);

          if (await fluxAnswersAt(nodeCollateralDifferentIp.ip)) {
            // Other node is reachable and confirmed - this is a collision
            log.error(`Flux collision detection. Node at ${askingIP}:${askingIpPort} is confirmed and reachable on flux network with the same collateral transaction information.`);
            dosState = 100;
            setDosMessage(`Flux collision detection. Node at ${askingIP}:${askingIpPort} is confirmed and reachable on flux network with the same collateral transaction information.`);
            return;
          }

          // First check failed - wait 60 seconds before confirming the other node is truly offline
          // This grace period prevents false positives from temporary network issues or node restarts
          log.info(`Other node at ${askingIP}:${askingIpPort} appears unreachable. Waiting 60 seconds to verify before taking over...`);
          await serviceHelper.delay(ANSWER_GRACE_MS);
          const answersHere = await fluxAnswersAt(nodeCollateralDifferentIp.ip);
          const peersFind = answersHere ? null : await peersFindAt(nodeCollateralDifferentIp.ip);
          const errorCall = peersFind === PeerFinding.NOTHING;
          fluxEventBus.publish('collision:judged', {
            address: normalizeSocketAddress(nodeCollateralDifferentIp.ip), answersHere, peersFind, gone: errorCall,
          });
          // The collateral listed at the IP this node was configured with, and
          // nothing answering there: not another machine, but this node, which has
          // moved - its IP, or its api port on the same IP - and has no record of
          // where it was. Handled as the move it is, recorded and told to the
          // network before the new address is confirmed: a bare takeover would put
          // it on chain first.
          const ownFormerAddress = askingIP === userconfig.initial.ipaddress;
          if (errorCall && ownFormerAddress) {
            const formerSocket = normalizeSocketAddress(`${askingIP}:${askingIpPort}`);
            log.info(`Our collateral is listed at ${formerSocket}, this node's own former address - handling the move to ${localSocketAddr}`);
            await leaveConfiguredAddress(formerSocket, localSocketAddr);
          } else if (errorCall) {
            // Other node is confirmed offline after grace period - take over the collateral
            log.info(`Other node at ${askingIP}:${askingIpPort} confirmed offline. Creating confirmation transaction to take over collateral...`);
            const daemonResult = await daemonServiceFluxnodeRpcs.createConfirmationTransaction();
            log.info(`node was confirmed on a different machine ip - createConfirmationTransaction: ${JSON.stringify(daemonResult)}`);
            releaseDosOwnedBy(isCollisionMessage);
          } else if (peersFind === PeerFinding.UNKNOWN) {
            log.info(`Whether the node at ${askingIP}:${askingIpPort} is gone cannot be said yet; the next pass asks again`);
          } else {
            // Answering again after the grace, or reached by peers: the other
            // node is there, so this is a collision.
            log.error(`Flux collision detection. Node at ${askingIP}:${askingIpPort} is confirmed and reachable on flux network with the same collateral transaction information.`);
            dosState = 100;
            setDosMessage(`Flux collision detection. Node at ${askingIP}:${askingIpPort} is confirmed and reachable on flux network with the same collateral transaction information.`);
          }
        }
      }
    }
  } catch (error) {
    log.error(error);
  }
}

// The collision check runs one pass at a time; a trigger arriving during a pass
// asks for one more pass after it.
let collisionCheckRunning = null;
let collisionCheckAgain = false;

/**
 * Runs the collision check now, or once more after the pass already running.
 * @returns {Promise<void>}
 */
async function requestCollisionCheck() {
  if (collisionCheckRunning) {
    collisionCheckAgain = true;
    return collisionCheckRunning;
  }
  collisionCheckRunning = runCollisionChecks();
  try {
    await collisionCheckRunning;
  } finally {
    collisionCheckRunning = null;
  }
  return undefined;
}

async function runCollisionChecks() {
  do {
    collisionCheckAgain = false;
    // After the work on this node's own address already asked for: a move it is
    // recording is its own, not a collision.
    // eslint-disable-next-line no-await-in-loop
    await ownAddressWork;
    // eslint-disable-next-line no-await-in-loop
    await checkDeterministicNodesCollisions();
  } while (collisionCheckAgain);
}

// Whether what syncthing's listener for its peers is has been known: a peer asked
// whether it can reach this node tests that port along with its api and home ports.
let syncthingListenerKnown = false;
// Whether the availability check's next ask is scheduled at the address this
// node holds now. While it is not, every change that can make the question
// answerable asks it.
let availabilityScheduled = false;
let availabilityTimer = null;
let availabilityRunning = null;

/**
 * Whether asking a peer if it can reach this node can be answered yet: the node
 * is confirmed and listed at its current address - a peer refuses any other -
 * and what the peer tests on it is known. On a network of few nodes the question
 * waits for six hours of uptime.
 * @returns {Promise<boolean>}
 */
async function availabilityCanBeAnswered() {
  if (!syncthingListenerKnown || !networkStateService.isReady()) return false;
  const localSocketAddr = await getLocalSocketAddress();
  if (!localSocketAddr) return false;
  const nodeStatus = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
  if (nodeStatus.data?.status !== 'CONFIRMED') return false;
  if (!await fluxCommunicationUtils.socketAddressInFluxList(localSocketAddr)) return false;
  const nodeCount = await fluxCommunicationUtils.getNodeCount();
  if (nodeCount > config.fluxapps.minIncoming + config.fluxapps.minOutgoing) return true;
  const measuredUptime = fluxUptime();
  return measuredUptime.status !== 'success' || measuredUptime.data > config.fluxapps.minUpTime * 12;
}

function scheduleAvailabilityCheck(delayMs) {
  clearTimeout(availabilityTimer);
  availabilityTimer = setTimeout(requestAvailabilityCheck, delayMs);
}

/**
 * Asks whether this node can be reached, when that can be answered, and
 * schedules the next ask: sooner after a failure, so a false verdict clears.
 * One that cannot be answered schedules nothing, and the next node list
 * refresh, change of address or known syncthing listener asks again.
 * @returns {Promise<void>}
 */
async function runAvailabilityCheck() {
  try {
    if (!await availabilityCanBeAnswered()) {
      availabilityScheduled = false;
      return;
    }
    availabilityScheduled = true;
    const available = await checkMyFluxAvailability();
    fluxEventBus.publish('availability:checked', { available, dosState: effectiveDosState(), dosMessage: getDosMessage() });
    scheduleAvailabilityCheck(available
      ? config.fluxapps.availabilityCheckIntervalMs
      : config.fluxapps.availabilityRecheckMs);
  } catch (error) {
    log.error(`availability check - ${error.message}`);
    scheduleAvailabilityCheck(config.fluxapps.availabilityRecheckMs);
  }
}

/**
 * Runs the availability check now, unless a run is already under way.
 * @returns {Promise<void>}
 */
async function requestAvailabilityCheck() {
  if (!availabilityRunning) {
    availabilityRunning = runAvailabilityCheck();
    try {
      await availabilityRunning;
    } finally {
      availabilityRunning = null;
    }
  }
}

/**
 * The availability check, when none is scheduled. Once one is, the check runs
 * on its own schedule.
 * @returns {Promise<void>}
 */
async function requestUnscheduledAvailabilityCheck() {
  if (!availabilityScheduled) await requestAvailabilityCheck();
}

/**
 * Notes that what syncthing's listener for its peers is has been known.
 * @returns {void}
 */
function noteSyncthingListenerKnown() {
  syncthingListenerKnown = true;
  requestUnscheduledAvailabilityCheck();
}

let publicIpAskTimer = null;
let emptyPublicIpAsks = 0;

/**
 * While this node knows no address of its own, asks benchmark to detect its
 * public IP every publicIpAskIntervalMs. After publicIpAsksBeforeDos asks in a
 * row find none, the node is out of service until one arrives.
 * @returns {void}
 */
function askForPublicIpWhileUnknown() {
  if (!publicIpAskTimer) publicIpAskTimer = setTimeout(askForPublicIp, config.fluxapps.publicIpAskIntervalMs);
}

async function askForPublicIp() {
  publicIpAskTimer = null;
  try {
    await askOnceForPublicIp();
  } catch (error) {
    log.error(`public ip - ${error.message}`);
    askForPublicIpWhileUnknown();
  }
}

async function askOnceForPublicIp() {
  const benchIpResponse = await benchmarkService.getPublicIp();
  if (benchIpResponse?.status === 'success') {
    log.info(`FluxBench was previously without ip and now reported public IP: ${benchIpResponse.data}`);
    if (benchIpResponse.data.length > 5) daemonServiceUtils.setStandardCache('getbenchmarks[]', null);
  }
  const address = await getLocalSocketAddress({ fresh: true });
  if (address) {
    ownAddressKnown();
    return;
  }
  emptyPublicIpAsks += 1;
  if (emptyPublicIpAsks >= config.fluxapps.publicIpAsksBeforeDos && effectiveDosState() <= 10) {
    dosState = 11;
    setDosMessage(dosMessage || IP_DETECTION_FAILED_MESSAGE);
    log.error(dosMessage);
  }
  askForPublicIpWhileUnknown();
}

/**
 * This node knows its address: stops asking for it, and ends the DOS that
 * asking in vain set.
 * @returns {void}
 */
function ownAddressKnown() {
  clearTimeout(publicIpAskTimer);
  publicIpAskTimer = null;
  emptyPublicIpAsks = 0;
  if (dosMessage === IP_DETECTION_FAILED_MESSAGE) {
    dosState = 0;
    setDosMessage(null);
  }
}

/**
 * A new address of this node's own: what was checked at the old one no longer
 * holds.
 * @returns {void}
 */
function onOwnAddressChanged() {
  ownAddressKnown();
  availabilityScheduled = false;
  clearTimeout(availabilityTimer);
  requestCollisionCheck();
  requestUnscheduledAvailabilityCheck();
}

/**
 * Brings this node to the move its own address record holds, on the
 * own-address queue.
 * @returns {Promise<void>}
 */
function requestOwnMoveReconcile() {
  return serialiseOwnAddressWork(reconcileOwnMove);
}

/**
 * What a node list refresh runs.
 * @returns {Promise<Array>} Settles once each has.
 */
function onNetworkListUpdated() {
  return Promise.all([requestOwnMoveReconcile(), requestCollisionCheck(), requestUnscheduledAvailabilityCheck()]);
}

// Stops the node list listener of the own-standing watch, while it runs.
let stopListUpdates = null;

/**
 * Reads this node's address afresh, which tells the watch what it is.
 * @returns {Promise<void>}
 */
async function readOwnAddress() {
  try {
    await getLocalSocketAddress({ fresh: true });
  } catch (error) {
    log.error(`own standing - ${error.message}`);
  }
}

/**
 * Stops the own-standing watch.
 * @returns {void}
 */
function stopOwnStandingWatch() {
  if (stopListUpdates) stopListUpdates();
  stopListUpdates = null;
  offLocalSocketAddressChange(onOwnAddressChanged);
  localSocketAddressEvents.off('unresolved', askForPublicIpWhileUnknown);
  peerManager.off('peerConnected', onPeerConnected);
  clearTimeout(availabilityTimer);
  clearTimeout(publicIpAskTimer);
  publicIpAskTimer = null;
  emptyPublicIpAsks = 0;
  availabilityScheduled = false;
  peerShortfallSeenAt = null;
}

function setIpChangeHold(value) {
  ipChangeHold = value;
}

function setSyncthingListenerKnown(value) {
  syncthingListenerKnown = value;
}

/**
 * Watches what decides whether this node stands on the network as itself: its
 * own address, the node list, and whether it can be reached. Starts once however
 * often it is called.
 * @returns {function(): void} Stops the watch.
 */
function startOwnStandingWatch() {
  if (!stopListUpdates) {
    stopListUpdates = networkStateService.onUpdated(onNetworkListUpdated);
    onLocalSocketAddressChange(onOwnAddressChanged);
    localSocketAddressEvents.on('unresolved', askForPublicIpWhileUnknown);
    peerManager.on('peerConnected', onPeerConnected);
    readOwnAddress();
  }
  return stopOwnStandingWatch;
}

/**
 * To get DOS state.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getDOSState(req, res) {
  const data = {
    dosState: effectiveDosState(),
    dosMessage: getDosMessage(),
  };
  const message = messageHelper.createDataMessage(data);
  return res ? res.json(message) : message;
}

async function setDOSStateApi(req, res) {
  if (!config.has('testEventStream') || config.get('testEventStream') !== true) {
    return res.status(404).json({ status: 'error', data: { message: 'Not available' } });
  }
  const authorized = await verificationHelper.verifyPrivilege(Privilege.FLUX_TEAM, authOf(req));
  if (authorized !== true) {
    const errMessage = messageHelper.errUnauthorizedMessage();
    return res.json(errMessage);
  }
  let { body } = req;
  if (typeof body !== 'object') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const newDosState = Number(body.dosState);
  if (Number.isNaN(newDosState)) {
    return res.json(messageHelper.createErrorMessage('dosState must be a number'));
  }
  resetAvailabilityDos();
  setDosMessage(body.dosMessage ?? null);
  setDosStateValue(newDosState);
  return res.json(messageHelper.createSuccessMessage({ dosState, dosMessage }));
}


/**
 * To allow a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function allowPort(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const ran = await ufw.runUfw(['allow', String(port)]);
  if (ran.locked) {
    cmdStat.message = 'ufw is locked by another ufw command';
    return cmdStat;
  }
  const cmdres = ran.stdout + ran.stderr;
  cmdStat.message = cmdres;
  if (cmdres.includes('updated') || cmdres.includes('added')) {
    cmdStat.status = true;
  } else if (cmdres.includes('existing')) {
    cmdStat.status = true;
    cmdStat.message = 'existing';
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

// The ufw rule that admits IPv4 clients of one protocol to a port FluxOS opens
// for a moment, to test it from outside, and nothing else. ufw counts a rule that
// names no protocol as the same rule as the matching half of an app port's
// `allow <port>`, so a test that opened and deleted one would delete that half;
// a rule naming its protocol is a rule of its own.
const testPortRule = (port, protocol) => ['proto', protocol, 'from', '0.0.0.0/0', 'to', 'any', 'port', String(port)];

const TEST_PORT_PROTOCOLS = ['tcp', 'udp'];

/**
 * Opens a port to IPv4 clients of one protocol while FluxOS tests it from
 * outside: the only rule for the port that deleteTestPortRule deletes.
 * @param {number|string} port Port.
 * @param {string} [protocol] 'tcp' or 'udp'.
 * @returns {Promise<{status: boolean, message: (string|null)}>}
 */
async function allowTestPort(port, protocol = 'tcp') {
  if (Number.isNaN(+port)) return { status: false, message: 'Port needs to be a number' };
  if (!TEST_PORT_PROTOCOLS.includes(protocol)) return { status: false, message: 'Protocol needs to be tcp or udp' };
  const ran = await ufw.runUfw(['allow', ...testPortRule(port, protocol)]);
  if (ran.locked) return { status: false, message: 'ufw is locked by another ufw command' };
  const cmdres = ran.stdout + ran.stderr;
  return { status: /added|updated|existing/.test(cmdres), message: cmdres };
}

/**
 * Deletes the rule allowTestPort writes for a protocol, and no other rule for
 * the port. A rule already gone counts as deleted.
 * @param {number|string} port Port.
 * @param {string} [protocol] 'tcp' or 'udp'.
 * @returns {Promise<{status: boolean, message: (string|null)}>}
 */
async function deleteTestPortRule(port, protocol = 'tcp') {
  if (Number.isNaN(+port)) return { status: false, message: 'Port needs to be a number' };
  if (!TEST_PORT_PROTOCOLS.includes(protocol)) return { status: false, message: 'Protocol needs to be tcp or udp' };
  const ran = await ufw.runUfw(['delete', 'allow', ...testPortRule(port, protocol)]);
  if (ran.locked) return { status: false, message: 'ufw is locked by another ufw command' };
  const cmdres = ran.stdout + ran.stderr;
  return { status: cmdres.includes('delete'), message: cmdres };
}

/**
 * To deny a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function denyPort(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const portBanned = isPortBanned(+port);
  if (portBanned || +port < config.fluxapps.portMin || +port > config.fluxapps.portMax) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }
  const ran = await ufw.runUfw(['deny', String(port)]);
  if (ran.locked) {
    cmdStat.message = 'ufw is locked by another ufw command';
    return cmdStat;
  }
  const cmdres = ran.stdout + ran.stderr;
  cmdStat.message = cmdres;
  if (cmdres.includes('updated') || cmdres.includes('added')) {
    cmdStat.status = true;
  } else if (cmdres.includes('existing')) {
    cmdStat.status = true;
    cmdStat.message = 'existing';
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To delete a ufw allow rule on port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function deleteAllowPortRule(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const portBanned = isPortBanned(+port);
  if (portBanned || +port < config.fluxapps.portMin || +port > config.fluxapps.portMax) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }
  const ran = await ufw.runUfw(['delete', 'allow', String(port)]);
  if (ran.locked) {
    cmdStat.message = 'ufw is locked by another ufw command';
    return cmdStat;
  }
  const cmdres = ran.stdout + ran.stderr;
  cmdStat.message = cmdres;
  if (cmdres.includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To delete a ufw deny rule on port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function deleteDenyPortRule(port) {
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const portBanned = isPortBanned(+port);
  if (portBanned || +port < config.fluxapps.portMin || +port > config.fluxapps.portMax) {
    cmdStat.message = 'Port out of deletable app ports range';
    return cmdStat;
  }
  const ran = await ufw.runUfw(['delete', 'deny', String(port)]);
  if (ran.locked) {
    cmdStat.message = 'ufw is locked by another ufw command';
    return cmdStat;
  }
  const cmdres = ran.stdout + ran.stderr;
  cmdStat.message = cmdres;
  if (cmdres.includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * Whether a port is in the range FluxOS gives apps, and so one FluxOS may open
 * and delete a rule for.
 * @param {number|string} port Port.
 * @returns {boolean}
 */
function isAppPort(port) {
  return !Number.isNaN(+port) && !isPortBanned(+port) && +port >= config.fluxapps.portMin && +port <= config.fluxapps.portMax;
}

/**
 * Opens an app's published ports to every client, IPv4 and IPv6, in one ufw
 * batch: `allow <port>`. Docker forwards a connection from outside the node to
 * a published port ahead of ufw's inbound rules, but an IPv6 one, and on some
 * Docker releases a container's connection to a published port at the node's
 * own address, it answers through docker-proxy on the host, behind them. ufw
 * keeps the rules across restarts, so they are written when the app is
 * installed and deleted when it is removed. Nothing is written while ufw is
 * disabled.
 * @param {Array<number|string>} ports Ports.
 * @returns {Promise<{failed: Array<{rule: string, error: string}>, locked: boolean}>}
 */
async function allowAppPorts(ports) {
  if (!await ufw.ufwEnabled()) return { failed: [], locked: false };
  return ufw.runUfwCommands(ports.filter(isAppPort).map((port) => ['allow', String(port)]));
}

/**
 * Deletes the rules allowAppPorts writes for an app's ports, in one ufw batch.
 * A rule already gone counts as deleted.
 * @param {Array<number|string>} ports Ports.
 * @returns {Promise<{failed: Array<{rule: string, error: string}>, locked: boolean}>}
 */
async function deleteAppPortRules(ports) {
  return ufw.runUfwCommands(ports.filter(isAppPort).map((port) => ['delete', 'allow', String(port)]));
}

/**
 * To allow a port via API. Only accessible by admins and Flux team members.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function allowPortApi(req, res) {
  let { port } = req.params;
  port = port || req.query.port;
  if (port === undefined || port === null) {
    const errMessage = messageHelper.createErrorMessage('No Port address specified.');
    return res.json(errMessage);
  }
  const authorized = await verificationHelper.verifyPrivilege(Privilege.NODE_OPERATOR_OR_FLUX_TEAM, authOf(req));

  let message;

  if (authorized === true) {
    const portResponseOK = await allowPort(port);
    if (portResponseOK.status === true) {
      message = messageHelper.createSuccessMessage(portResponseOK.message, port, port);
    } else if (portResponseOK.status === false) {
      message = messageHelper.createErrorMessage(portResponseOK.message, port, port);
    } else {
      message = messageHelper.createErrorMessage(`Unknown error while opening port ${port}`);
    }
  } else {
    message = messageHelper.errUnauthorizedMessage();
  }
  return res.json(message);
}

const ufwDefaultsPath = '/etc/default/ufw';
// /etc/default/ufw exactly as the ufw package ships it on Ubuntu 20.04 to 26.04.
const ufwDefaultsSource = path.join(__dirname, '../../../helpers/ufw/default');
// ufw refuses to run, and ufw-init refuses to start the firewall at boot, when
// any of these is missing.
const ufwPolicies = ['INPUT', 'OUTPUT', 'FORWARD', 'APPLICATION'];

/**
 * Keeps /etc/default/ufw whole and its outbound policy ACCEPT. A file missing
 * any policy is replaced by ufw's own defaults; one that denies outbound has
 * that line set to ACCEPT. The new file is renamed over the old, so it is never
 * seen part-written, and an enabled firewall is reloaded to take it up - which
 * also starts one that could not start at boot. ufw's own `default` command
 * rewrites the file in place and is never used.
 * @returns {Promise<void>}
 */
async function ensureUfwDefaults() {
  const ufwConf = await fs.readFile('/etc/ufw/ufw.conf', 'utf8').catch(() => null);
  if (ufwConf === null) return;
  const current = await fs.readFile(ufwDefaultsPath, 'utf8').catch(() => '');

  const whole = ufwPolicies.every((policy) => new RegExp(`^DEFAULT_${policy}_POLICY=`, 'm').test(current));
  let desired;
  if (!whole) {
    desired = await fs.readFile(ufwDefaultsSource, 'utf8');
  } else if (!/^DEFAULT_OUTPUT_POLICY="ACCEPT"$/m.test(current)) {
    desired = current.replace(/^DEFAULT_OUTPUT_POLICY=.*$/m, 'DEFAULT_OUTPUT_POLICY="ACCEPT"');
  } else {
    return;
  }

  const staged = `${ufwDefaultsPath}.flux-new`;
  let tempDir = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-ufw-'));
    const source = path.join(tempDir, 'ufw');
    await fs.writeFile(source, desired, { mode: 0o644 });
    const { error: stageError } = await serviceHelper.runCommand('install', {
      runAsRoot: true, logError: false, params: ['-m', '0644', '-o', 'root', '-g', 'root', source, staged],
    });
    const { error: renameError } = stageError ? { error: stageError } : await serviceHelper.runCommand('mv', {
      runAsRoot: true, logError: false, params: ['-f', staged, ufwDefaultsPath],
    });
    if (renameError) {
      log.error(`Firewall defaults not written: ${renameError.message}`);
      return;
    }
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
  log.info(whole ? 'Firewall outbound policy set to ACCEPT' : 'Firewall defaults restored');

  if (/^ENABLED=yes$/m.test(ufwConf)) {
    const { error, locked } = await ufw.runUfw(['reload']);
    if (locked) log.error('Firewall not reloaded: ufw is locked by another ufw command');
    else if (error) log.error(`Firewall not reloaded: ${error.message}`);
  }
  fluxEventBus.publish('firewall:defaultsWritten', { restored: !whole });
}

// The docker networks app containers are on.
const fluxAppDockerNetworks = '172.23.0.0/16';
/**
 * Reports a firewall step that stopped because another ufw command held ufw's lock.
 */
function reportUfwLocked() {
  log.error('Firewall not adjusted: ufw is locked by another ufw command');
  fluxEventBus.publish('firewall:locked', {});
}

/**
 * The node's own firewall rules, each the arguments of one ufw command, in the
 * order they are applied.
 * @returns {Promise<string[][]>}
 */
async function nodeFirewallRules() {
  const apiPort = userconfig.initial.apiport || config.server.apiport;
  const ports = [apiPort, +apiPort - 1, +apiPort + 1, +apiPort + 2, 80, 443, 16125, ...config.server.allowedPorts];
  const rules = [['delete', 'allow', 'in', 'proto', 'udp', 'to', 'any', 'port', '53']];
  // this should also be limit, but existing nodes use allow (needs to be updated)
  if (isArcane) rules.push(['prepend', 'allow', 'to', 'any', 'app', 'FluxadmSSH']);
  // the OpenSSH profile exists only where openssh-server is installed
  rules.push(['prepend', 'limit', 'to', 'any', 'app', 'OpenSSH']);

  const { stdout: routes } = await serviceHelper.runCommand('ip', { logError: false, params: ['route'] });
  const routerIP = serviceHelper.ensureString(routes).split('\n')[0].trim().split(/\s+/)[2] || '';
  if (serviceHelper.validIpv4Address(routerIP)
    && (routerIP.startsWith('192.168.') || routerIP.startsWith('10.') || routerIP.startsWith('172.16.')
      || routerIP.startsWith('100.64.') || routerIP.startsWith('198.18.') || routerIP.startsWith('169.254.'))) {
    rules.push(['prepend', 'allow', 'from', routerIP, 'to', 'any', 'proto', 'udp']);
  }
  ports.forEach((port) => rules.push(['allow', String(port)]));
  // app containers reach the fluxnode service; the rest of loopback is refused
  // by allowOnlyDockerNetworksToFluxNodeService, as ufw does not filter loopback
  rules.push(['allow', 'from', fluxAppDockerNetworks, 'proto', 'tcp', 'to', `${config.server.fluxNodeServiceAddress}/32`, 'port', '16101']);
  return rules;
}

/**
 * Applies the node's own firewall rules. Outbound traffic is governed by the
 * default policy alone, so every outbound rule is removed, whoever added it;
 * then the node's own inbound rules are applied. Both happen in one pass under
 * ufw's lock (helpers/ufw/apply-node-firewall.py), and ufw is reloaded only
 * when outbound rules were removed. Where ufw's library cannot be used, the
 * rules are applied one ufw command each.
 *
 * Every ufw command waits on ufw's lock for as long as another holds it, so a
 * lock held past ufw.UFW_LOCK_WAIT_MS stops the step: no ufw command is run, the
 * firewall is left as it is, and the next start applies it.
 */
async function adjustFirewall() {
  try {
    if (!await ufw.ufwEnabled()) {
      log.info('Firewall is not active. Adjusting not applied');
      return;
    }
    const rules = await nodeFirewallRules();

    const { stdout, stderr, error } = await ufw.oneAtATime(async () => serviceHelper.runCommand('python3', {
      runAsRoot: true,
      logError: false,
      params: [await ufwHelper.path(), '--wait', String(ufw.UFW_LOCK_WAIT_MS / 1000), '--rules', JSON.stringify(rules)],
      timeout: 2 * ufw.UFW_LOCK_WAIT_MS,
    }));
    if (error?.code === ufw.UFW_LOCK_UNAVAILABLE) {
      reportUfwLocked();
      return;
    }
    let result = null;
    if (!error) {
      try {
        result = JSON.parse(serviceHelper.ensureString(stdout));
      } catch {
        log.warn(`Firewall applier answered unreadably: ${serviceHelper.ensureString(stdout).trim()}`);
      }
    } else {
      log.warn(`Firewall applier failed: ${serviceHelper.ensureString(stderr).trim() || error.message}`);
    }

    const outboundRemoved = result?.removed ?? 0;
    let failed = result?.failed ?? [];
    if (!result?.applied) {
      if (result?.reason) log.warn(`Firewall rules applied one ufw command each: ${result.reason}`);
      failed = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const rule of rules) {
        // eslint-disable-next-line no-await-in-loop
        const ran = await ufw.runUfw(rule);
        if (ran.locked) {
          reportUfwLocked();
          return;
        }
        if (ran.error) failed.push({ rule: rule.join(' '), error: ran.stderr.trim() || ran.error.message });
      }
    }
    // a delete finds nothing to delete once the rule is gone
    failed = failed.filter(({ rule, error: why }) => !(rule.startsWith('delete ') && /non-existent rule/.test(why)));
    failed.forEach(({ rule, error: why }) => log.warn(`Firewall rule not applied: ufw ${rule}: ${why}`));

    if (outboundRemoved) {
      const reload = await ufw.runUfw(['reload']);
      if (reload.locked) {
        reportUfwLocked();
        return;
      }
      if (reload.error) log.error(`Firewall not reloaded after removing outbound rules: ${reload.error.message}`);
      log.info(`Firewall outbound rules removed: ${outboundRemoved}`);
    }
    fluxEventBus.publish('firewall:adjusted', {
      outboundRemoved, rulesFailed: failed.map(({ rule }) => rule), appliedBy: result?.applied ? 'library' : 'commands',
    });
  } catch (error) {
    log.error(error);
  }
}

/**
 * To clean a firewall deny policies, and delete them from it.
 */
async function purgeUFW() {
  try {
    const firewallActive = await ufw.isFirewallActive();
    if (firewallActive) {
      const status = await ufw.runUfw(['status']);
      const cmdresB = status.stdout.split('\n').filter((line) => line.includes('DENY')).join('\n');
      if (cmdresB.includes('DENY')) {
        const deniedPorts = cmdresB.split('\n'); // split by new line
        const portsToDelete = [];
        deniedPorts.forEach((port) => {
          const adjPort = port.substring(0, port.indexOf(' '));
          if (adjPort) { // last line is empty
            if (!portsToDelete.includes(adjPort)) {
              portsToDelete.push(adjPort);
            }
          }
        });
        // eslint-disable-next-line no-restricted-syntax
        for (const port of portsToDelete) {
          // eslint-disable-next-line no-await-in-loop
          await deleteDenyPortRule(port);
        }
        log.info('UFW app deny rules on ports purged');
      } else {
        log.info('No UFW deny on ports rules found');
      }
    } else {
      log.info('Firewall is not active. Purging UFW not necessary');
    }
  } catch (error) {
    log.error(error);
  }
}

// The bridges a container's traffic can come from: the default one and every
// user-defined docker network.
const containerBridges = ['docker0', 'br-+'];
// Addresses an app container may not reach beyond its own node: every
// non-public IPv4 range, the node owner's private networks and a cloud host's
// metadata service among them. fluxnode.service lives on this node's loopback,
// so a container reaches it through INPUT and these FORWARD rules never see it.
const containerBlockedNetworks = NON_PUBLIC_IPV4;

/**
 * The DOCKER-USER chain, as `iptables -S DOCKER-USER` prints it.
 *
 * Traffic into a container is let through only on FluxOS's own networks (the
 * default bridge docker0 and each network FluxOS creates): traffic that stays
 * on the network it came from, and connections to a published port, whose
 * destination Docker has rewritten to the container's (conntrack state DNAT).
 * Everything else headed into any docker network is dropped: one app network
 * reaches another only through a published port at the node's address, and a
 * network FluxOS did not create receives nothing it did not ask for. These
 * rules name each bridge, so a host interface named like a docker bridge gets
 * no exception, and they hold whether or not Docker's own isolation rules are
 * present and whether or not the br_netfilter kernel module sends bridged
 * traffic through iptables.
 *
 * Traffic from a container to anywhere else is matched by the bridge it comes
 * from, never by its source address, so a container cannot leave the drops by
 * forging its source; every non-public range is dropped. DNS stays open to
 * every private address, for a node owner who runs their own resolver.
 *
 * No rule uses the physdev match: the kernel loads br_netfilter the first time
 * a physdev rule is added, which sends bridged traffic on every bridge on the
 * host - an operator's VMs included - through iptables.
 * @param {{fluxBridges: string[], dockerBridges: string[]}} bridges fluxBridges:
 *   the bridge of each network FluxOS creates, docker0 aside. dockerBridges: the
 *   bridge of every docker bridge network, docker0 included.
 * @returns {string[]}
 */
function containerEgressRules({ fluxBridges, dockerBridges }) {
  const rules = ['-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN'];
  ['docker0', ...fluxBridges].forEach((bridge) => {
    rules.push(`-A DOCKER-USER -i ${bridge} -o ${bridge} -j RETURN`);
    rules.push(`-A DOCKER-USER -o ${bridge} -m conntrack --ctstate DNAT -j RETURN`);
  });
  dockerBridges.forEach((bridge) => rules.push(`-A DOCKER-USER -o ${bridge} -j DROP`));
  containerBridges.forEach((bridge) => {
    ['udp', 'tcp'].forEach((proto) => rules.push(`-A DOCKER-USER -i ${bridge} -p ${proto} -m ${proto} --dport 53 -j RETURN`));
  });
  containerBridges.forEach((bridge) => {
    containerBlockedNetworks.forEach((network) => rules.push(`-A DOCKER-USER -d ${network} -i ${bridge} -j DROP`));
  });
  rules.push('-A DOCKER-USER -j RETURN');
  return rules;
}

/**
 * Keeps app containers off private and link-local networks and off each
 * other's networks. The DOCKER-USER chain is replaced in one iptables-restore
 * transaction, so no moment passes without its rules, and is left untouched
 * when it already matches. Docker never writes DOCKER-USER, and its FORWARD
 * jump is put back if missing.
 * @param {{fluxBridges: string[], dockerBridges: string[]}} bridges As
 *   containerEgressRules takes them.
 * @returns {Promise<boolean>} True when the chain is in place. Never rejects.
 */
async function applyContainerEgressRules(bridges) {
  const desired = containerEgressRules(bridges);
  const { stdout: current, error: readError } = await serviceHelper.runCommand('iptables', {
    runAsRoot: true, logError: false, params: ['-S', 'DOCKER-USER'],
  });
  const currentRules = serviceHelper.ensureString(current).split('\n').map((line) => line.trim()).filter((line) => line.startsWith('-A '));
  const inPlace = !readError && currentRules.length === desired.length && currentRules.every((rule, i) => rule === desired[i]);

  if (!inPlace) {
    let tempDir = null;
    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-docker-user-'));
      const rulesFile = path.join(tempDir, 'rules');
      await fs.writeFile(rulesFile, ['*filter', ':DOCKER-USER - [0:0]', ...desired, 'COMMIT', ''].join('\n'), { mode: 0o644 });
      const { error } = await serviceHelper.runCommand('iptables-restore', {
        runAsRoot: true, logError: false, params: ['--noflush', rulesFile],
      });
      if (error) {
        log.error(`IPTABLES: DOCKER-USER rules not applied: ${error.message}`);
        return false;
      }
      log.info('IPTABLES: DOCKER-USER rules applied');
      fluxEventBus.publish('firewall:containerEgressApplied', {});
    } catch (error) {
      log.error(`IPTABLES: DOCKER-USER rules not applied: ${error.message}`);
      return false;
    } finally {
      if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const { error: jumpMissing } = await serviceHelper.runCommand('iptables', {
    runAsRoot: true, logError: false, params: ['-C', 'FORWARD', '-j', 'DOCKER-USER'],
  });
  if (jumpMissing) {
    const { error } = await serviceHelper.runCommand('iptables', {
      runAsRoot: true, logError: false, params: ['-I', 'FORWARD', '-j', 'DOCKER-USER'],
    });
    if (error) {
      log.error(`IPTABLES: FORWARD jump to DOCKER-USER not restored: ${error.message}`);
      return false;
    }
    log.info('IPTABLES: FORWARD jump to DOCKER-USER restored');
  }
  return true;
}

// lruRateLimit has been extracted to ./utils/rateLimit.js
// Re-exported here for backward compatibility.

/**
 * Allow Node to bind to privileged without sudo
 */
async function allowNodeToBindPrivilegedPorts() {
  try {
    const cmdAsync = util.promisify(nodecmd.run);
    const exec = "sudo setcap 'cap_net_bind_service=+ep' `which node`";
    await cmdAsync(exec);
  } catch (error) {
    log.error(error);
  }
}

/**
 * Refuses the fluxnode service's address on loopback to everything but the app
 * containers' networks. ufw does not filter loopback, so this is an iptables
 * rule; the containers' own allow is one of the node's firewall rules.
 * @returns {Promise<void>}
 */
async function allowOnlyDockerNetworksToFluxNodeService() {
  if (!await ufw.ufwEnabled()) return;

  const { fluxNodeServiceAddress } = config.server;
  const denyRule = `INPUT -i lo ! -s ${fluxAppDockerNetworks} -d ${fluxNodeServiceAddress}/32 -j DROP`;
  const checkDenyRule = `LANG="en_US.UTF-8" && sudo iptables -C ${denyRule}`;
  const denyAllElse = `LANG="en_US.UTF-8" && sudo iptables -I ${denyRule}`;

  const cmdAsync = util.promisify(nodecmd.run);

  const denied = await cmdAsync(checkDenyRule).catch(async (err) => {
    if (err.message.includes('Bad rule')) {
      try {
        await cmdAsync(denyAllElse);
        log.info(`Firewall adjusted to deny access to: ${fluxNodeServiceAddress}/32`);
      } catch (error) {
        log.error(error);
      }
    }
  });

  if (denied) log.info(`Fireall already denying access to ${fluxNodeServiceAddress}/32`);
}

/**
 * Adds the 169.254 adddress to the loopback interface for use with the flux node service.
 */
async function addFluxNodeServiceIpToLoopback() {
  const cmdAsync = util.promisify(nodecmd.run);

  // could also check exists first with:
  //   ip -f inet addr show lo | grep 169.254.43.43/32
  const ip = config.server.fluxNodeServiceAddress;
  const addIp = `sudo ip addr add ${ip}/32 dev lo`;

  let ok = false;
  try {
    await cmdAsync(addIp);
    ok = true;
  } catch (err) {
    if (err.message.includes('File exists') || err.message.includes('Address already assigned')) {
      ok = true;
    } else {
      log.error(err);
    }
  }

  if (ok) {
    log.info(`fluxNodeService IP: ${ip} added to loopback interface`);
  } else {
    log.warn(`Failed to add fluxNodeService IP ${ip} to loopback interface`);
  }
}

/**
 * Return the number of peers this node is connected to
 */
function getNumberOfPeers() {
  return peerManager.getNumberOfPeers();
}

module.exports = {
  isFluxAvailable,
  fluxAvailability,
  FluxAvailability,
  NOT_LISTED_MESSAGE,
  checkFluxAvailability,
  getLocalSocketAddress,
  getKnownLocalSocketAddress,
  waitForLocalSocketAddress,
  onLocalSocketAddressChange,
  offLocalSocketAddressChange,
  onIpChangeHold,
  offIpChangeHold,
  onLocalSocketAddressKnown,
  getFluxNodePrivateKey,
  getFluxNodePublicKey,
  MAX_KEEPALIVE_PORTS,
  checkDeterministicNodesCollisions,
  requestCollisionCheck,
  resetAvailabilityDos,
  requestAvailabilityCheck,
  noteSyncthingListenerKnown,
  startOwnStandingWatch,
  stopOwnStandingWatch,
  getIncomingConnections,
  getIncomingConnectionsInfo,
  getDOSState,
  setDOSStateApi,
  getNumberOfPeers,
  egressDevice,
  interfaceDevice,
  hasPublicIpOnInterface,
  denyPort,
  deleteAllowPortRule,
  allowAppPorts,
  allowTestPort,
  deleteAppPortRules,
  deleteTestPortRule,
  allowPortApi,
  adjustFirewall,
  ensureUfwDefaults,
  purgeUFW,
  closeConnection,
  closeIncomingConnection,
  checkFluxbenchVersionAllowed,
  checkNodeJsVersionAllowed,
  checkDockerVersionAllowed,
  checkCgroupsAllowed,
  checkMongoDbVersionAllowed,
  checkMyFluxAvailability,
  adjustExternalIp,
  handleOwnAddress,
  leaveConfiguredAddress,
  ownAddressRecord,
  startOwnAddressWatch,
  startIpChangeHoldWatch,
  setSyncthingListenerKnown,
  enforceIpChangeHold,
  setIpChangeHold,
  setOnAddressChanged,
  setOnOwnAddressMoved,
  setInstalledAppsListedAt,
  ownAddressFor,
  allowPort,
  isFirewallActive: ufw.isFirewallActive,
  // Exports for testing purposes
  resetNtpSource,
  parseChronyOffset,
  parseTimesyncOffset,
  setStoredFluxBenchAllowed,
  getStoredFluxBenchAllowed,
  setLocalSocketAddress,
  getDosMessage,
  setDosMessage,
  getUdpReachability,
  setUdpReachability,
  setDosStateValue,
  getDosStateValue,
  isNodeDos,
  PlacementHoldOwner,
  setPlacementHold,
  clearPlacementHold,
  getPlacementHold,
  isPlacementHeld,
  StickyDosOwner,
  setStickyDos,
  clearStickyDos,
  isStickyDosHeldBy,
  getStickyDosMessage,
  fluxUptime,
  fluxSystemUptime,
  isCommunicationEstablished,
  lruRateLimit,
  isPortOpen,
  portAnswered,
  MAX_ECHO_BYTES,
  portAnsweredUdp,
  checkAppAvailability,
  verifySignedFluxnodeMessage,
  isPortEnterprise,
  isPortBanned,
  isPortUPNPBanned,
  allowNodeToBindPrivilegedPorts,
  applyContainerEgressRules,
  containerEgressRules,
  getMaxNumberOfIpChanges,
  allowOnlyDockerNetworksToFluxNodeService,
  addFluxNodeServiceIpToLoopback,
  keepUPNPPortsOpen,
  isArcane,
  clockDrift,
  getClockDrift,
  initClockOffsetCache,
  getLocalClockOffsetMs,
};
