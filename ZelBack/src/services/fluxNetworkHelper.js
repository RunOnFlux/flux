/* eslint-disable no-underscore-dangle */
const config = require('config');
const { WIFToPrivKey, privKeyToPubKey } = require('./utils/fluxCryptoUtils');
const nodecmd = require('node-cmd');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const net = require('net');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const daemonServiceUtils = require('./daemonService/daemonServiceUtils');
const daemonServiceFluxnodeRpcs = require('./daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceWalletRpcs = require('./daemonService/daemonServiceWalletRpcs');
const benchmarkService = require('./benchmarkService');
const verificationHelper = require('./verificationHelper');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const { peerManager } = require('./utils/peerState');
const { CLOSE_CODES, DIRECTION } = require('./utils/FluxPeerSocket');
const cacheManager = require('./utils/cacheManager').default;
const networkStateService = require('./networkStateService');
const fluxEventBus = require('./utils/fluxEventBus');
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

let dosState = 0; // we can start at bigger number later
let dosMessage = null;

// Sticky DOS state. Owned exclusively by whoever set it (e.g. the tampering
// blocklist enforcer). Not affected by setDosMessage(null) / setDosStateValue
// calls from other checks. When set, it takes precedence in getDosMessage()
// and getDOSState() over the regular dosMessage/dosState.
let stickyDosState = 0;
let stickyDosMessage = null;

// Who may hold this node back from placement. An owner is an IDENTITY, not a
// message: the reason is what an operator reads, and the owner is what a release
// is checked against. Adding a feature that holds placement means adding a value
// here, which is the point - an unknown owner is refused rather than accepted as
// a new one.
const PlacementHoldOwner = Object.freeze({
  RESIDENTIAL_DOS: 'residentialDos',
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
let ipChangeData = null;
let dosTooManyIpChanges = false;
let maxNumberOfIpChanges = 0;

const myCache = cacheManager.ipCache;
const { lruRateLimit } = require('./utils/rateLimit');
const { Privilege, authOf } = require('./utils/privileges');

// This node's socket address (ip:port) from benchmark
let localSocketAddress = null;

/**
 * Converts a hexadecimal IP address (as found in /proc/net/route) to dotted decimal format.
 * The hex format is little-endian, so bytes are reversed.
 * @param {string} hex - Hexadecimal IP address (8 characters)
 * @returns {string} Dotted decimal IP address
 */
function hexToIp(hex) {
  const bytes = [];
  for (let i = 0; i < 8; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  // Reverse because the hex is little-endian
  return bytes.reverse().join('.');
}

/**
 * Checks if a network interface is operationally up by reading its sysfs operstate.
 * @param {string} interfaceName - The name of the network interface
 * @returns {Promise<boolean>} True if the interface is up
 */
async function isInterfaceUp(interfaceName) {
  try {
    const operstatePath = `/sys/class/net/${interfaceName}/operstate`;
    const state = await fs.readFile(operstatePath, 'utf8');
    return state.trim() === 'up';
  } catch {
    return false;
  }
}

/**
 * Gets the first routable IPv4 address assigned to a network interface. An
 * interface can carry a private primary and a public secondary; stopping at
 * the first non-internal address would answer for whichever the kernel lists
 * first rather than for the interface.
 * @param {string} interfaceName - The name of the network interface
 * @returns {string|null} The routable IPv4 address or null if none is bound
 */
function getInterfaceIp(interfaceName) {
  const interfaces = os.networkInterfaces();
  const iface = interfaces[interfaceName];
  if (!iface) return null;

  for (const addr of iface) {
    if (addr.family === 'IPv4' && !addr.internal && !serviceHelper.isNonRoutableAddress(addr.address)) {
      return addr.address;
    }
  }
  return null;
}

/**
 * Checks if the node has a public IP directly configured on the default route interface.
 * This is a strong indicator of a static IP (data center/VPS/dedicated server).
 * Uses the Linux routing table to find the default route interface, then checks
 * if that interface has a public IP assigned.
 * @returns {Promise<boolean|null>} True if a public IP is configured on the
 *   default route interface, false if none is, null if the routing table could
 *   not be read - which is not the same answer as "there is none".
 */
async function hasPublicIpOnInterface() {
  try {
    // Read the routing table from /proc/net/route
    const routeData = await fs.readFile('/proc/net/route', 'utf8');
    const lines = routeData.trim().split('\n');

    // Skip header line
    if (lines.length < 2) {
      return false;
    }

    // Find default routes (destination 0.0.0.0)
    const defaultRoutes = [];
    for (let i = 1; i < lines.length; i += 1) {
      const fields = lines[i].split('\t');
      if (fields.length < 11) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const [iface, destination, gateway, flags, , , metric] = fields;

      // Check if this is a default route (destination is 0.0.0.0)
      if (destination === '00000000') {
        // Check if the route is up (flag 0x1) and has a gateway (flag 0x2)
        // eslint-disable-next-line no-bitwise
        const flagsNum = parseInt(flags, 16);
        // eslint-disable-next-line no-bitwise
        if ((flagsNum & 0x1) && (flagsNum & 0x2)) {
          defaultRoutes.push({
            iface,
            gateway: hexToIp(gateway),
            metric: parseInt(metric, 10),
          });
        }
      }
    }

    if (defaultRoutes.length === 0) {
      return false;
    }

    // Sort by metric (lowest first) and pick the best default route
    defaultRoutes.sort((a, b) => a.metric - b.metric);

    // Find the first interface that is operationally up
    for (const route of defaultRoutes) {
      // eslint-disable-next-line no-await-in-loop
      const isUp = await isInterfaceUp(route.iface);
      if (isUp) {
        const ip = getInterfaceIp(route.iface);
        if (ip) {
          log.info(`Public IP ${ip} found on default route interface ${route.iface}`);
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    // Null, not false. "There is no public address on any interface" is a fact
    // about the node; "I could not read the routing table" is a fact about this
    // process, and answering the second with the first asserts NAT on a node
    // that may well hold a public address. The one caller that decides anything
    // on this treats null as unknown.
    log.error(`Failed to check network interfaces via routing table: ${error.message}`);
    return null;
  }
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
 * To get if port belongs to user blocked range
 * @returns {boolean} Returns true if port is user blocked
 */
function isPortUserBlocked(port) {
  try {
    let blockedPorts = userconfig.initial.blockedPorts || [];
    blockedPorts = serviceHelper.ensureObject(blockedPorts);
    let portBanned = false;
    blockedPorts.forEach((portOrInterval) => {
      if (portOrInterval === +port) {
        portBanned = true;
      }
    });
    return portBanned;
  } catch (error) {
    log.error(error);
    return false;
  }
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
 * To perform a basic check of current FluxOS version.
 * @param {string} ip IP address.
 * @param {string} port Port. Defaults to config.server.apiport.
 * @returns {Promise<boolean>} False unless FluxOS version meets or exceeds the minimum allowed version.
 */
async function isFluxAvailable(ip, port = config.server.apiport) {
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
      return false;
    }
    const fluxResponse = await serviceHelper.axiosGet(`http://${ip}:${port}/flux/version`, axiosConfig);
    if (fluxResponse.data.status !== 'success') return false;

    const fluxVersion = fluxResponse.data.data;
    const versionMinOK = serviceHelper.minVersionSatisfy(fluxVersion, config.minimumFluxOSAllowedVersion);
    if (!versionMinOK) return false;

    const homePort = +port - 1;
    // There is a new /health endpoint on the frontend express server. Since we have a catch-all route,
    // nodes on older versions will just return the index.html, so no change. Once all nodes on >= 6.6.1,
    // remove the title check (and this comment)
    const fluxResponseUi = await serviceHelper.axiosGet(`http://${ip}:${homePort}/health`, axiosConfig);
    const { data: UiPayload = '' } = fluxResponseUi;
    const uiAvailable = UiPayload === 'OK' || UiPayload.includes('<title>');
    if (!uiAvailable) return false;

    const syncthingPort = +port + 2;
    const portOpen = await isPortOpen(ip, syncthingPort);
    return portOpen;
  } catch (e) {
    log.error(e);
    return false;
  }
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

  const available = await isFluxAvailable(ip, port);

  let message;

  if (available === true) {
    message = messageHelper.createSuccessMessage('Asking Flux is available');
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
      const answered = {};

      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        const iBP = isPortBanned(+port);
        const portNum = +port;
        const withinRange = portNum >= minPort && portNum <= maxPort;

        if (withinRange && !iBP) {
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
        } else {
          log.error(`Flux App port ${port} is outside allowed range. minPort: ${minPort}, maxPort: ${maxPort}, isBanned: ${iBP}`);
        }
      }
      const successResponse = messageHelper.createSuccessMessage(`Flux Applications on ${ip}:${ipPort} are available.`);
      // `answered` present at all is how the requester knows this peer READ the
      // ports rather than merely reaching them. Absent means no proof is
      // available from this peer, which is not the same as the ports being bad.
      // Added as a field rather than through createSuccessMessage, whose second
      // and third parameters are name and code.
      if (echo) successResponse.data.answered = answered;
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
  localSocketAddress = value ? normalizeSocketAddress(value) : null;
  // Told here because this is the one place the node learns what it is. The
  // peer manager needs it to keep this node out of its own peer draws - a node
  // that syncs from itself learns nothing, and it spends one of very few
  // attempts doing so. Optional because the unit suite stubs peerState.
  peerManager.setOwnSocketAddress?.(localSocketAddress);
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
  return stickyDosMessage || dosMessage;
}

/**
 * Setter for the sticky DOS message. The sticky slot is not cleared by
 * setDosMessage(null); only the owner that set it should clear it via
 * clearStickyDosMessage().
 * @param {string} message
 */
function setStickyDosMessage(message) {
  stickyDosMessage = message;
  publishEffectiveDosState();
}

/**
 * Getter for the sticky DOS message (ignores regular dosMessage).
 * @returns {string|null}
 */
function getStickyDosMessage() {
  return stickyDosMessage;
}

/**
 * Clears the sticky DOS message and sticky state value.
 */
function clearStickyDosMessage() {
  stickyDosMessage = null;
  stickyDosState = 0;
  publishEffectiveDosState();
}

/**
 * Publish the DOS state a reader would actually see.
 *
 * isNodeDos() answers on `stickyDosMessage ? stickyDosState : dosState`, so the
 * effective value moves when EITHER half of the sticky pair moves, and neither
 * setter emitted anything. A consumer therefore had to poll /flux/info, and a
 * poll cannot order a DOS against anything else: the installed-apps record
 * outlives the removal it follows by ~20s, so two polls of two sources disagree
 * about what happened first. On one event stream the ids settle it.
 *
 * Inert in production - fluxEventBus.publish returns immediately unless
 * config.testEventStream is set, which it is only under the harness. This is
 * not the 21-site refactor noted below getDosStateValue; that one is about the
 * product's own scattered dosState mutations.
 */
function publishEffectiveDosState() {
  const effectiveDosState = stickyDosMessage ? stickyDosState : dosState;
  fluxEventBus.publish('dos:changed', {
    dosState: effectiveDosState,
    dosMessage: stickyDosMessage || dosMessage,
  });
}

/**
 * Setter for the sticky DOS state value.
 * @param {number} value
 */
function setStickyDosStateValue(value) {
  stickyDosState = value;
  publishEffectiveDosState();
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
  const effectiveState = stickyDosMessage ? stickyDosState : dosState;
  return effectiveState >= 100;
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
async function getLocalSocketAddress() {
  const benchmarkResponse = await benchmarkService.getBenchmarks();
  const { status, data: { ipaddress = null } = {} } = benchmarkResponse;
  // The benchmark IP can be a bare IP or ip:port depending on the node's API port,
  // and while fluxbench is still resolving it the value can be empty or a host-less
  // ":<port>" - the latter is truthy but useless. parseSocketAddress accepts a real
  // bare-IP or ip:port and rejects those unresolved forms, so callers (e.g. the
  // masterSlave election) never act on a bogus own-IP.
  if (status !== 'success' || !parseSocketAddress(ipaddress)) {
    setLocalSocketAddress(null);
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
  const privKey = privatekey || daemonServiceUtils.getConfigValue('zelnodeprivkey');
  return privKey;
}

/**
 * To get FluxNode public key.
 * @param {string} privatekey Private key.
 * @returns {string} Public key.
 */
async function getFluxNodePublicKey(privatekey) {
  try {
    const pkWIF = await getFluxNodePrivateKey(privatekey);
    const isCompressed = !pkWIF.startsWith('5');
    const privateKey = WIFToPrivKey(pkWIF);
    const pubKey = privKeyToPubKey(privateKey, isCompressed);
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
 * To check if Flux benchmark version is allowed.
 * @returns {boolean} True if version is verified as allowed. Otherwise false.
 */
async function checkFluxbenchVersionAllowed() {
  if (storedFluxBenchAllowed) {
    const versionOK = serviceHelper.minVersionSatisfy(storedFluxBenchAllowed, config.minimumFluxBenchAllowedVersion);
    return versionOK;
  }
  try {
    const benchmarkInfoResponse = await benchmarkService.getInfo();
    if (benchmarkInfoResponse.status === 'success') {
      log.info(benchmarkInfoResponse);
      const benchmarkVersion = benchmarkInfoResponse.data.version;
      setStoredFluxBenchAllowed(benchmarkVersion);
      const versionOK = serviceHelper.minVersionSatisfy(benchmarkVersion, config.minimumFluxBenchAllowedVersion);
      if (versionOK) {
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

/**
 * To check ip changes limit. If over limit all apps are uninstalled from the node and it get dos state
 * @returns {boolean} True if a ip as changes more than one time in the last 20h
 */
async function ipChangesOverLimit() {
  const currentTime = Date.now();
  if (ipChangeData) {
    const oldTime = ipChangeData.time;
    const timeDifference = currentTime - oldTime;
    if (timeDifference <= 20 * 60 * 60 * 1000) {
      ipChangeData.count += 1;
      if (ipChangeData.count > maxNumberOfIpChanges) {
        maxNumberOfIpChanges = ipChangeData.count;
      }
      if (ipChangeData.count >= 2) {
        // eslint-disable-next-line global-require
        const appQueryService = require('./appQuery/appQueryService');
        // eslint-disable-next-line global-require
        const appUninstaller = require('./appLifecycle/appUninstaller');
        let apps = await appQueryService.installedApps();
        if (apps.status === 'success' && apps.data.length > 0) {
          apps = apps.data;
          // eslint-disable-next-line no-restricted-syntax
          for (const app of apps) {
            log.warn(`REMOVAL REASON: Too many IP changes - ${app.name} being removed due to ${ipChangeData.count} IP changes in ${timeDifference}ms (DoS protection)`);
            // eslint-disable-next-line no-await-in-loop
            await appUninstaller.removeAppLocally(app.name, null, true, null, false).catch((error) => log.error(error)); // we will not send appremove messages because they will not be accepted by the other nodes
            // eslint-disable-next-line no-await-in-loop
            await serviceHelper.delay(500);
          }
        }
        dosTooManyIpChanges = true;
        return true;
      }
    } else {
      ipChangeData.time = currentTime;
      ipChangeData.count = 1;
      maxNumberOfIpChanges = 1;
    }
    return false;
  }
  ipChangeData = {
    time: currentTime,
    count: 1,
  };
  return false;
}

function getMaxNumberOfIpChanges() {
  return maxNumberOfIpChanges;
}

/**
 * To adjust an external IP.
 * @param {string} ip IP address.
 * @returns {Promise<void>} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function adjustExternalIP(ip) {
  try {
    const fluxDirPath = path.join(__dirname, '../../../config/userconfig.js');
    // https://github.com/sindresorhus/ip-regex/blob/master/index.js#L8
    const v4 = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}';
    const v4exact = new RegExp(`^${v4}$`);
    if (!v4exact.test(ip)) {
      log.warn(`Gathered IP ${ip} is not a valid format`);
      return;
    }
    if (ip === userconfig.initial.ipaddress) {
      return;
    }
    // Everything below needs to know which node this is: whose registration among
    // the ones found at the new address is our own, which apps are ours to hand
    // over, and what address the fluxipchanged broadcast is moving FROM.
    // localSocketAddress is cleared whenever benchmark hiccups, and a comparison
    // against nothing matches nothing - so acting here would read our own rows as
    // strangers' and uninstall the apps they belong to.
    //
    // Return BEFORE the userconfig write, which is what makes this a deferral
    // rather than a silent drop: the write is what marks the change handled, so
    // leaving it unwritten leaves the change pending. checkMyFluxAvailability
    // already refuses to run while the address is unknown, so nothing reaches here
    // again until benchmark answers - and then this runs with the node knowing
    // itself, exactly once, as designed.
    if (!localSocketAddress) {
      log.warn(`adjustExternalIP - own address unknown, deferring the change to ${ip} until benchmark answers`);
      return;
    }
    const oldUserConfigIp = userconfig.initial.ipaddress;
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
    blockedPorts: [${userconfig.initial.blockedPorts || ''}],
    blockedRepositories: ${JSON.stringify(userconfig.initial.blockedRepositories || []).replace(/"/g, "'")},
  }
}`;

    await fs.writeFile(fluxDirPath, dataToWrite);

    if (oldUserConfigIp && v4exact.test(oldUserConfigIp) && !myCache.has(ip)) {
      myCache.set(ip, '');
      const newIP = normalizeSocketAddress(`${ip}:${userconfig.initial.apiport}`);
      const oldIP = normalizeSocketAddress(`${oldUserConfigIp}:${userconfig.initial.apiport}`);
      log.info(`New public Ip detected: ${newIP}, old Ip: ${oldIP} , updating the FluxNode info on the network`);
      const measuredUptime = fluxUptime();
      if (await ipChangesOverLimit() && measuredUptime.status === 'success' && measuredUptime.data > config.fluxapps.minUpTime) {
        log.info('IP changes over the limit allowed, one in 20 hours');
        dosState += 11;
        setDosMessage('IP changes over the limit allowed, one in 20 hours');
        log.error(dosMessage);
      }
      // eslint-disable-next-line global-require
      const appQueryService = require('./appQuery/appQueryService');
      // eslint-disable-next-line global-require
      const registryManager = require('./appDatabase/registryManager');
      // eslint-disable-next-line global-require
      const appUninstaller = require('./appLifecycle/appUninstaller');
      // eslint-disable-next-line global-require
      const enterpriseHelper = require('./utils/enterpriseHelper');
      let apps = await appQueryService.installedApps();
      if (apps.status === 'success' && apps.data.length > 0) {
        apps = apps.data;
        let appsRemoved = 0;
        // The apps still installed once the loop has removed the ones that cannot
        // stay. Handed to whoever registered for an address change; nothing here
        // knows what bringing them back involves.
        const staying = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const app of apps) {
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
                // eslint-disable-next-line no-continue
                continue;
              }
            }
            if (appSpecs.staticip === true) {
              log.info(`Application ${app.name} requires static IP but node IP has changed, uninstalling app`);
              log.warn(`REMOVAL REASON: Static IP required - ${app.name} requires static IP but node IP changed from ${oldIP} to ${newIP}`);
              // eslint-disable-next-line no-await-in-loop
              await appUninstaller.removeAppLocally(app.name, null, true, null, true).catch((error) => log.error(error));
              appsRemoved += 1;
              // eslint-disable-next-line no-continue
              continue;
            }
          }

          // eslint-disable-next-line no-await-in-loop
          const runningAppList = await registryManager.appLocation(app.name);
          // An instance at this address means the ports are taken and this node
          // cannot run the app: one instance per IP is enforced by the host port
          // mapping, so a UPnP sibling on another port holds them just as surely
          // as a node that owns the address alone. That is why the address is
          // compared at IP granularity.
          //
          // The node's OWN registration is not that. It stores its own running-app
          // row locally, at the address benchmark reports, so the row sitting at
          // this address is most often itself - and removing on that is a node
          // deleting an app that is exactly where it belongs, then telling the
          // network it is gone. Own-ness is the full socket address, which is what
          // separates it from the sibling that shares only the IP.
          const duplicateInstance = runningAppList.find(
            (instance) => ipsMatch(instance.ip, ip) && !socketAddressesMatch(instance.ip, localSocketAddress),
          );
          if (duplicateInstance) {
            log.info(`Aplication: ${app.name}, was found on the network already running under the same ip, uninstalling app`);
            log.warn(`REMOVAL REASON: Duplicate IP detected - ${app.name} already running on network with IP ${ip} (after IP change)`);
            // eslint-disable-next-line no-await-in-loop
            await appUninstaller.removeAppLocally(app.name, null, true, null, true).catch((error) => log.error(error));
            appsRemoved += 1;
          } else {
            staying.push(app);
          }
        }
        // One handover for the whole set, not a call per app: what an app is made
        // of - a composed one's containers are `<component>_<app>`, and an
        // enterprise one's names are inside a blob this layer cannot read - is
        // knowledge the reconciler already holds. Failures stay inside it too, so
        // one app that cannot be asked costs the others nothing and leaves the
        // broadcast, the confirmation transaction and the geolocation update below
        // reachable.
        if (staying.length && onAddressChanged) {
          await onAddressChanged(staying, `node ip changed to ${ip}`)
            .catch((error) => log.error(`adjustExternalIP - restart request failed: ${error.message}`));
        }
        if (apps.length > appsRemoved) {
          const broadcastedAt = Date.now();
          const newIpChangedMessage = {
            type: 'fluxipchanged',
            version: 1,
            oldIP,
            newIP,
            broadcastedAt,
          };
          // broadcast messages about ip changed to all peers
          // eslint-disable-next-line global-require
          const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
          await fluxCommunicationMessagesSender.broadcastMessageToAll(newIpChangedMessage);
        }
      }
      const result = await daemonServiceWalletRpcs.createConfirmationTransaction();
      log.info(`createConfirmationTransaction: ${JSON.stringify(result)}`);
      // Update geolocation service to track IP change and update static IP status
      // eslint-disable-next-line global-require
      const geolocationService = require('./geolocationService');
      geolocationService.setNodeGeolocation();
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To check user's FluxNode availability.
 * @param {number} retryNumber Number of retries.
 * @returns {Promise<boolean>} Return value is only for testing
 */
async function checkMyFluxAvailability(retryNumber = 0) {
  if (dosTooManyIpChanges) {
    dosState += 11;
    setDosMessage('IP changes over the limit allowed, one in 20 hours');
    return false;
  }

  if (localSocketAddress === null) return false;

  let userBlockedPorts = userconfig.initial.blockedPorts || [];
  userBlockedPorts = serviceHelper.ensureObject(userBlockedPorts);
  if (Array.isArray(userBlockedPorts)) {
    if (userBlockedPorts.length > 100) {
      dosState += 11;
      setDosMessage('User blocked ports above 100 limit');
      return false;
    }
  }
  let userBlockedRepositories = userconfig.initial.blockedRepositories || [];
  userBlockedRepositories = serviceHelper.ensureObject(userBlockedRepositories);
  if (Array.isArray(userBlockedRepositories)) {
    if (userBlockedRepositories.length > 10) {
      dosState += 11;
      setDosMessage('User blocked repositories above 10 limit');
      return false;
    }
  }
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

  if (!resMyAvailability) {
    dosState += 2;
    if (dosState > 10) {
      setDosMessage(dosMessage || 'Flux communication is limited, other nodes on the network cannot reach yours through API calls');
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
    if (retryNumber === 4 || dosState > 10) {
      log.info('Getting publicIp from FluxBench');
      const benchIpResponse = await benchmarkService.getPublicIp();
      if (benchIpResponse.status === 'success') {
        log.info(`FluxBench reported public IP: ${benchIpResponse.data}`);
        const benchMyIP = benchIpResponse.data.length > 5 ? benchIpResponse.data : null;
        if (benchMyIP && extractIp(benchMyIP) !== localIp) {
          daemonServiceUtils.setStandardCache('getbenchmarks[]', null);
          log.info('New IP found... updating network');
          dosState = 0;
          setDosMessage(null);
          await adjustExternalIP(extractIp(benchMyIP));
          return true;
        } if (benchMyIP && extractIp(benchMyIP) === localIp) {
          log.info('FluxBench reported the same Ip that was already in use');
        } else {
          log.info('FluxBench reported a invalid IP');
          setDosMessage('Error getting publicIp from FluxBench');
          dosState += 15;
          log.error('FluxBench wasnt able to detect flux node public ip');
        }
      } else {
        log.info('FluxBench reported returned error on getpublicipcall');
        setDosMessage('Error getting publicIp from FluxBench');
        dosState += 15;
        log.error(dosMessage);
        return false;
      }
    }
    dosState += 2;
    if (dosState > 10) {
      setDosMessage(dosMessage || 'Flux is not available for outside communication');
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
        dosState += 0.13; // slow increment, DOS after ~75 minutes. 0.13 per minute. This check depends on other nodes being able to connect to my node
        if (dosState > 10) {
          setDosMessage(connectionInfo.data.message || 'Flux does not have sufficient peers');
          log.error(dosMessage);
          return false;
        }
        await adjustExternalIP(localIp);
        return true; // availability ok
      }
    }
  } else if (measuredUptime.status === 'error') {
    log.error('Flux uptime is not available'); // introduce dos increment
  }
  dosState = 0;
  setDosMessage(null);
  await adjustExternalIP(localIp);
  return true;
}

/**
 * To check deterministic node collisions (i.e. if multiple FluxNode instances detected).
 * @returns {void} Return statement is only used here to interrupt the function and nothing is returned.
 */
async function checkDeterministicNodesCollisions() {
  const axiosConfig = {
    timeout: 5000,
  };

  try {
    // get my external ip address
    // get node list with filter on this ip address
    // if it returns more than 1 object, shut down.
    // another precatuion might be comparing node list on multiple nodes. evaulate in the future
    const localSocketAddr = await getLocalSocketAddress();
    if (localSocketAddr) {
      const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
      if (!syncStatus.data.synced) {
        setTimeout(() => {
          checkDeterministicNodesCollisions();
        }, 120 * 1000);
        return;
      }
      // Same shape as the daemon check above, for the same reason. The list
      // accessors wait for the list to arrive, and this loop only re-arms once
      // it has finished - so awaiting in here would retire it for the life of
      // the process rather than delay it, and this is the only thing that ever
      // clears this node's DOS state. Reading an unknown list instead is no
      // better: it makes every branch below conclude this node is not in the
      // confirmed list, log that as the reason, and skip the availability check
      // that would have cleared the DOS.
      if (!networkStateService.isReady()) {
        setTimeout(() => {
          checkDeterministicNodesCollisions();
        }, 120 * 1000);
        return;
      }
      const nodeList = await fluxCommunicationUtils.deterministicFluxList();
      const result = nodeList.filter((node) => socketAddressesMatch(node.ip, localSocketAddr));
      const nodeStatus = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
      if (nodeStatus.status === 'success') { // different scenario is caught elsewhere
        const myCollateral = nodeStatus.data.collateral;
        const myNode = result.find((node) => node.collateral === myCollateral);
        const nodeCollateralDifferentIp = nodeList.find((node) => node.collateral === myCollateral && !socketAddressesMatch(node.ip, localSocketAddr));
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
              setTimeout(() => {
                checkDeterministicNodesCollisions();
              }, 60 * 1000);
              return;
            }
          }
          // prevent new activation
        } else if (result.length === 1) {
          if (!myNode) {
            log.error('Flux collision detection. Another ip:port is confirmed on flux network with the same collateral transaction information.');
            dosState = 100;
            setDosMessage('Flux collision detection. Another ip:port is confirmed on flux network with the same collateral transaction information.');
            setTimeout(() => {
              checkDeterministicNodesCollisions();
            }, 60 * 1000);
            return;
          }
        }
        if (nodeStatus.data.status === 'CONFIRMED' && nodeCollateralDifferentIp) {
          let errorCall = false;
          const askingIP = extractIp(nodeCollateralDifferentIp.ip);
          const askingIpPort = extractPort(nodeCollateralDifferentIp.ip);
          log.info(`Detected same collateral on different IP: ${askingIP}:${askingIpPort}. Checking if other node is reachable...`);

          // First reachability check
          await serviceHelper.axiosGet(`http://${askingIP}:${askingIpPort}/flux/version`, axiosConfig).catch(() => { errorCall = true; });
          if (!errorCall) {
            // Other node is reachable and confirmed - this is a collision
            log.error(`Flux collision detection. Node at ${askingIP}:${askingIpPort} is confirmed and reachable on flux network with the same collateral transaction information.`);
            dosState = 100;
            setDosMessage(`Flux collision detection. Node at ${askingIP}:${askingIpPort} is confirmed and reachable on flux network with the same collateral transaction information.`);
            setTimeout(() => {
              checkDeterministicNodesCollisions();
            }, 60 * 1000);
            return;
          }

          // First check failed - wait 60 seconds before confirming the other node is truly offline
          // This grace period prevents false positives from temporary network issues or node restarts
          log.info(`Other node at ${askingIP}:${askingIpPort} appears unreachable. Waiting 60 seconds to verify before taking over...`);
          errorCall = false;
          await serviceHelper.delay(60 * 1000);

          // Second reachability check after grace period
          await serviceHelper.axiosGet(`http://${askingIP}:${askingIpPort}/flux/version`, axiosConfig).catch(() => { errorCall = true; });
          if (errorCall) {
            // Other node is confirmed offline after grace period - take over the collateral
            log.info(`Other node at ${askingIP}:${askingIpPort} confirmed offline. Creating confirmation transaction to take over collateral...`);
            const daemonResult = await daemonServiceWalletRpcs.createConfirmationTransaction();
            log.info(`node was confirmed on a different machine ip - createConfirmationTransaction: ${JSON.stringify(daemonResult)}`);
            // Clear any previous DOS state related to this collision
            if (getDosMessage() && getDosMessage().includes('is confirmed and reachable on flux network')) {
              log.info('Clearing previous collision DOS state - this node has successfully taken over the collateral');
              dosState = 0;
              setDosMessage(null);
            }
          } else {
            // Other node came back online during grace period
            log.warn(`Node at ${askingIP}:${askingIpPort} came back online during grace period. Collision still exists.`);
          }
        }
      }
      // If this node is not CONFIRMED, or our current IP isn't in the confirmed
      // list (e.g. IP recently changed), remote nodes will reject the availability
      // check via the confirmed-list gate in isFluxAvailable. Skip to avoid
      // spamming the network with requests that will always fail.
      const isConfirmed = nodeStatus.data?.status === 'CONFIRMED';
      const inConfirmedList = await fluxCommunicationUtils.socketAddressInFluxList(localSocketAddr);
      if (!isConfirmed || !inConfirmedList) {
        const reason = !isConfirmed
          ? `Node status is ${nodeStatus.data?.status}`
          : `Our IP ${localSocketAddr} is not in the confirmed flux list`;
        log.warn(`${reason}. Skipping remote availability check.`);
        setTimeout(() => {
          checkDeterministicNodesCollisions();
        }, 60 * 1000);
        return;
      }
      // early stages of the network or testnet
      if (nodeList.length > config.fluxapps.minIncoming + config.fluxapps.minOutgoing) {
        await checkMyFluxAvailability();
      } else { // sufficient amount of nodes has to appear on the network within 6 hours
        const measuredUptime = fluxUptime();
        if (measuredUptime.status === 'success' && measuredUptime.data > (config.fluxapps.minUpTime * 12)) {
          await checkMyFluxAvailability();
        } else if (measuredUptime.status === 'error') {
          log.error('Flux uptime unavailable');
          await checkMyFluxAvailability();
        }
      }
    } else {
      dosState += 1;
      if (dosState > 10) {
        setDosMessage(dosMessage || 'Flux IP detection failed');
        log.error(dosMessage);
      } else {
        const measuredUptime = fluxUptime();
        if (measuredUptime.status === 'success' && measuredUptime.data > (config.fluxapps.minUpTime)) {
          const benchIpResponse = await benchmarkService.getPublicIp();
          if (benchIpResponse.status === 'success') {
            log.info(`FluxBench was previoulsy without ip and now reported public IP: ${benchIpResponse.data}`);
            const benchMyIP = benchIpResponse.data.length > 5 ? benchIpResponse.data : null;
            if (benchMyIP) {
              daemonServiceUtils.setStandardCache('getbenchmarks[]', null);
            }
          }
        }
      }
    }
    setTimeout(() => {
      checkDeterministicNodesCollisions();
    }, 60 * 1000);
  } catch (error) {
    log.error(error);
    setTimeout(() => {
      checkDeterministicNodesCollisions();
    }, 120 * 1000);
  }
}

/**
 * To get DOS state.
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
function getDOSState(req, res) {
  const data = {
    dosState: stickyDosMessage ? stickyDosState : dosState,
    dosMessage: stickyDosMessage || dosMessage,
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
  const cmdAsync = util.promisify(nodecmd.run);
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const exec = `LANG="en_US.UTF-8" && sudo ufw allow ${port} && sudo ufw allow out ${port}`;
  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else if (serviceHelper.ensureString(cmdres).includes('existing')) {
    cmdStat.status = true;
    cmdStat.message = 'existing';
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To allow out a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function allowOutPort(port) {
  const cmdAsync = util.promisify(nodecmd.run);
  const cmdStat = {
    status: false,
    message: null,
  };
  if (Number.isNaN(+port)) {
    cmdStat.message = 'Port needs to be a number';
    return cmdStat;
  }
  const exec = `LANG="en_US.UTF-8" && sudo ufw allow out ${port}`;
  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else if (serviceHelper.ensureString(cmdres).includes('existing')) {
    cmdStat.status = true;
    cmdStat.message = 'existing';
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
}

/**
 * To deny a port.
 * @param {string} port Port.
 * @returns {object} Command status.
 */
async function denyPort(port) {
  const cmdAsync = util.promisify(nodecmd.run);
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
  const exec = `LANG="en_US.UTF-8" && sudo ufw deny ${port} && sudo ufw deny out ${port}`;
  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('updated') || serviceHelper.ensureString(cmdres).includes('added')) {
    cmdStat.status = true;
  } else if (serviceHelper.ensureString(cmdres).includes('existing')) {
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
  const cmdAsync = util.promisify(nodecmd.run);
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
  const exec = `LANG="en_US.UTF-8" && sudo ufw delete allow ${port} && sudo ufw delete allow out ${port}`;
  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
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
  const cmdAsync = util.promisify(nodecmd.run);
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
  const exec = `LANG="en_US.UTF-8" && sudo ufw delete deny ${port} && sudo ufw delete deny out ${port}`;
  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
    cmdStat.status = true;
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
async function deleteAllowOutPortRule(port) {
  const cmdAsync = util.promisify(nodecmd.run);
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
  const exec = `LANG="en_US.UTF-8" && sudo ufw delete allow out ${port}`;
  const cmdres = await cmdAsync(exec);
  cmdStat.message = cmdres;
  if (serviceHelper.ensureString(cmdres).includes('delete')) { // Rule deleted or Could not delete non-existent rule both ok
    cmdStat.status = true;
  } else {
    cmdStat.status = false;
  }
  return cmdStat;
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

/**
 * To check if a firewall is active.
 * @returns {Promise<boolean>} True if a firewall is active. Otherwise false.
 */
async function isFirewallActive() {
  try {
    const cmdAsync = util.promisify(nodecmd.run);
    const execA = 'LANG="en_US.UTF-8" && sudo ufw status | grep Status';
    const cmdresA = await cmdAsync(execA);
    if (serviceHelper.ensureString(cmdresA).includes('Status: active')) {
      return true;
    }
    return false;
  } catch (error) {
    // command ufw not found is the most likely reason
    log.error(error);
    return false;
  }
}

/**
 * To adjust a firewall to allow ports for Flux.
 */
async function adjustFirewall() {
  try {
    const cmdAsync = util.promisify(nodecmd.run);
    const apiPort = userconfig.initial.apiport || config.server.apiport;
    const homePort = +apiPort - 1;
    const apiSSLPort = +apiPort + 1;
    const syncthingPort = +apiPort + 2;
    let ports = [apiPort, homePort, apiSSLPort, syncthingPort, 80, 443, 16125];
    const fluxCommunicationPorts = config.server.allowedPorts;
    ports = ports.concat(fluxCommunicationPorts);
    const firewallActive = await isFirewallActive();
    if (firewallActive) {
      // set default allow outgoing
      const execAllowA = 'LANG="en_US.UTF-8" && sudo ufw default allow outgoing';
      await cmdAsync(execAllowA);
      // allow speedtests
      const execAllowB = 'LANG="en_US.UTF-8" && sudo ufw insert 1 allow out 5060';
      const execAllowC = 'LANG="en_US.UTF-8" && sudo ufw insert 1 allow out 8080';
      await cmdAsync(execAllowB);
      await cmdAsync(execAllowC);
      // remove inbound DNS traffic
      const removeInboundDns = 'LANG="en_US.UTF-8" && sudo ufw delete allow in proto udp to any port 53 > /dev/null 2>&1';
      await cmdAsync(removeInboundDns);
      // allow outgoing DNS traffic
      const execAllowE = 'LANG="en_US.UTF-8" && sudo ufw insert 1 allow out proto udp to any port 53';
      const execAllowF = 'LANG="en_US.UTF-8" && sudo ufw insert 1 allow out proto tcp to any port 53';
      await cmdAsync(execAllowE);
      await cmdAsync(execAllowF);
      log.info('Firewall adjusted for DNS traffic');

      // fix up for ssh being misteriously removed (needs tracing)
      if (isArcane) {
        // this should also be limit, but existing nodes use allow (needs to be updated)
        const execAllowFluxadmSsh = 'LANG="en_US.UTF-8" && sudo ufw insert 1 allow to any app FluxadmSSH > /dev/null 2>&1';
        await cmdAsync(execAllowFluxadmSsh);
      }

      const execAllowOpenSsh = 'LANG="en_US.UTF-8" && sudo ufw insert 1 limit to any app OpenSSH > /dev/null 2>&1';
      await cmdAsync(execAllowOpenSsh);

      const commandGetRouterIP = 'ip rout | head -n1 | awk \'{print $3}\'';
      let routerIP = await cmdAsync(commandGetRouterIP);
      routerIP = routerIP.replace(/(\r\n|\n|\r)/gm, '');
      log.info(`Router IP: ${routerIP}`);
      if (serviceHelper.validIpv4Address(routerIP)
        && (routerIP.startsWith('192.168.') || routerIP.startsWith('10.') || routerIP.startsWith('172.16.')
          || routerIP.startsWith('100.64.') || routerIP.startsWith('198.18.') || routerIP.startsWith('169.254.'))) {
        const execRouterAllowA = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow out from any to ${routerIP} proto tcp > /dev/null 2>&1`;
        const execRouterAllowB = `LANG="en_US.UTF-8" && sudo ufw insert 1 allow from ${routerIP} to any proto udp > /dev/null 2>&1`;
        await cmdAsync(execRouterAllowA);
        await cmdAsync(execRouterAllowB);
        log.info(`Firewall adjusted for comms with router on local ip ${routerIP}`);
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        const execB = `LANG="en_US.UTF-8" && sudo ufw allow ${port}`;
        const execC = `LANG="en_US.UTF-8" && sudo ufw allow out ${port}`;

        // eslint-disable-next-line no-await-in-loop
        const cmdresB = await cmdAsync(execB);
        if (serviceHelper.ensureString(cmdresB).includes('updated') || serviceHelper.ensureString(cmdresB).includes('existing') || serviceHelper.ensureString(cmdresB).includes('added')) {
          log.info(`Firewall adjusted for port ${port}`);
        } else {
          log.info(`Failed to adjust Firewall for port ${port}`);
        }

        // eslint-disable-next-line no-await-in-loop
        const cmdresC = await cmdAsync(execC);
        if (serviceHelper.ensureString(cmdresC).includes('updated') || serviceHelper.ensureString(cmdresC).includes('existing') || serviceHelper.ensureString(cmdresC).includes('added')) {
          log.info(`Firewall out adjusted for port ${port}`);
        } else {
          log.info(`Failed to adjust Firewall out for port ${port}`);
        }
      }
    } else {
      log.info('Firewall is not active. Adjusting not applied');
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * To clean a firewall deny policies, and delete them from it.
 */
async function purgeUFW() {
  try {
    const cmdAsync = util.promisify(nodecmd.run);
    const firewallActive = await isFirewallActive();
    if (firewallActive) {
      const execB = 'LANG="en_US.UTF-8" && sudo ufw status | grep \'DENY\'';
      const cmdresB = await cmdAsync(execB).catch(() => { }) || ''; // fail silently,
      if (serviceHelper.ensureString(cmdresB).includes('DENY')) {
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
      const execDelDenyA = 'LANG="en_US.UTF-8" && sudo ufw delete deny out from any to 10.0.0.0/8';
      const execDelDenyB = 'LANG="en_US.UTF-8" && sudo ufw delete deny out from any to 172.16.0.0/12';
      const execDelDenyC = 'LANG="en_US.UTF-8" && sudo ufw delete deny out from any to 192.168.0.0/16';
      const execDelDenyD = 'LANG="en_US.UTF-8" && sudo ufw delete deny out from any to 100.64.0.0/10';
      const execDelDenyE = 'LANG="en_US.UTF-8" && sudo ufw delete deny out from any to 198.18.0.0/15';
      const execDelDenyF = 'LANG="en_US.UTF-8" && sudo ufw delete deny out from any to 169.254.0.0/16';
      await cmdAsync(execDelDenyA);
      await cmdAsync(execDelDenyB);
      await cmdAsync(execDelDenyC);
      await cmdAsync(execDelDenyD);
      await cmdAsync(execDelDenyE);
      await cmdAsync(execDelDenyF);
      log.info('UFW app deny netscans rules purged');
    } else {
      log.info('Firewall is not active. Purging UFW not necessary');
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * This fix a docker security issue where docker containers can access private node operator networks, for example to create port forwarding on hosts.
 *
 * Docker should create a DOCKER-USER chain. If this doesn't exist - we create it, then jump to this chain immediately from the FORWARD CHAIN.
 * This allows rules to be added via -I (insert) and -A (append) to the DOCKER-USER chain individually, so we can ALWAYS append the
 * drop traffic rule, and insert the ACCEPT rules. If no matches are found in the DOCKER-USER chain, rule evaluation continues
 * from the next rule in the FORWARD chain.
 *
 * If needed in the future, we can actually create a JUMP from the DOCKER-USER chain to a custom chain. The reason why we MUST use the DOCKER-USER
 * chain is that whenever docker creates a new network, it re-jumps the DOCKER-USER chain at the head of the FORWARD chain.
 *
 * As can be seen in this example:
 *
 * Originally, was using the FLUX chain, but you can see docker inserted the br-72d1725e481c network ahead, as well as the JUMP to DOCKER-USER,
 * which invalidates any rules in the FLUX chain, as there is basically an accept any:
 *
 * FORWARD -i br-72d1725e481c ! -o br-72d1725e481c -j ACCEPT
 *
 * ```bash
 * -A INPUT -j ufw-track-input
 * -A FORWARD -j DOCKER-USER
 * -A FORWARD -j DOCKER-ISOLATION-STAGE-1
 * -A FORWARD -o br-72d1725e481c -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
 * -A FORWARD -o br-72d1725e481c -j DOCKER
 * -A FORWARD -i br-72d1725e481c ! -o br-72d1725e481c -j ACCEPT
 * -A FORWARD -i br-72d1725e481c -o br-72d1725e481c -j ACCEPT
 * -A FORWARD -j FLUX
 * -A FORWARD -o br-048fde111132 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
 * -A FORWARD -o br-048fde111132 -j DOCKER
 * -A FORWARD -i br-048fde111132 ! -o br-048fde111132 -j ACCEPT
 * -A FORWARD -i br-048fde111132 -o br-048fde111132 -j ACCEPT
 *```
 * This means if a user or someone was to delete a single rule, we are able to recover correctly from it.
 *
 * The other option - is just to Flush all rules on every run, and reset them all. This is what we are doing now.
 *
 * @param {string[]} fluxNetworkInterfaces The network interfaces, br-<12 character string>
 * @returns  {Promise<Boolean>}
 */
async function removeDockerContainerAccessToNonRoutable(fluxNetworkInterfaces) {
  const cmdAsync = util.promisify(nodecmd.run);

  const checkIptables = 'sudo iptables --version';
  const iptablesInstalled = await cmdAsync(checkIptables).catch(() => {
    log.error('Unable to find iptables binary');
    return false;
  });

  if (!iptablesInstalled) return false;

  // check if rules have been created, as iptables is NOT idempotent.
  const checkDockerUserChain = 'sudo iptables -L DOCKER-USER';
  // iptables 1.8.4 doesn't return anything - so have updated command a little
  const checkJumpChain = 'sudo iptables -C FORWARD -j DOCKER-USER && echo true';

  const dockerUserChainExists = await cmdAsync(checkDockerUserChain).catch(async () => {
    try {
      await cmdAsync('sudo iptables -N DOCKER-USER');
      log.info('IPTABLES: DOCKER-USER chain created');
    } catch (err) {
      log.error('IPTABLES: Error adding DOCKER-USER chain');
      // if we can't add chain, we can't proceed
      return new Error();
    }
    return null;
  });

  if (dockerUserChainExists instanceof Error) return false;
  if (dockerUserChainExists) log.info('IPTABLES: DOCKER-USER chain already created');

  const checkJumpToDockerChain = await cmdAsync(checkJumpChain).catch(async () => {
    // Ubuntu 20.04 @ iptables 1.8.4 Error: "iptables: No chain/target/match by that name."
    // Ubuntu 22.04 @ iptables 1.8.7 Error: "iptables: Bad rule (does a matching rule exist in that chain?)."
    const jumpToFluxChain = 'sudo iptables -I FORWARD -j DOCKER-USER';
    try {
      await cmdAsync(jumpToFluxChain);
      log.info('IPTABLES: New rule in FORWARD inserted to jump to DOCKER-USER chain');
    } catch (err) {
      log.error('IPTABLES: Error inserting FORWARD jump to DOCKER-USER chain');
      // if we can't jump, we need to bail out
      return new Error();
    }

    return null;
  });

  if (checkJumpToDockerChain instanceof Error) return false;
  if (checkJumpToDockerChain) log.info('IPTABLES: Jump to DOCKER-USER chain already enabled');

  const rfc1918Networks = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
  const fluxSrc = '172.23.0.0/16';

  const baseDropCmd = `sudo iptables -A DOCKER-USER -s ${fluxSrc} -d #DST -j DROP`;
  const baseAllowToFluxNetworksCmd = 'sudo iptables -I DOCKER-USER -i #INT -o #INT -j ACCEPT';
  const baseAllowEstablishedCmd = `sudo iptables -I DOCKER-USER -s ${fluxSrc} -d #DST -m state --state RELATED,ESTABLISHED -j ACCEPT`;
  const baseAllowDnsCmd = `sudo iptables -I DOCKER-USER -s ${fluxSrc} -d #DST -p udp --dport 53 -j ACCEPT`;

  const addReturnCmd = 'sudo iptables -A DOCKER-USER -j RETURN';
  const flushDockerUserCmd = 'sudo iptables -F DOCKER-USER';

  try {
    await cmdAsync(flushDockerUserCmd);
    log.info('IPTABLES: DOCKER-USER table flushed');
  } catch (err) {
    log.error(`IPTABLES: Error flushing DOCKER-USER table. ${err}`);
    return false;
  }

  // add for legacy apps
  fluxNetworkInterfaces.push('docker0');

  // eslint-disable-next-line no-restricted-syntax
  for (const int of fluxNetworkInterfaces) {
    // if this errors, we need to bail, as if the deny succeedes, we may cut off access
    const giveFluxNetworkAccess = baseAllowToFluxNetworksCmd.replace(/#INT/g, int);
    try {
      // eslint-disable-next-line no-await-in-loop
      await cmdAsync(giveFluxNetworkAccess);
      log.info(`IPTABLES: Traffic on Flux interface ${int} accepted`);
    } catch (err) {
      log.error(`IPTABLES: Error allowing traffic on Flux interface ${int}. ${err}`);
      return false;
    }
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const network of rfc1918Networks) {
    // if any of these error, we need to bail, as if the deny succeedes, we may cut off access

    const giveHostAccessToDockerNetwork = baseAllowEstablishedCmd.replace('#DST', network);
    try {
      // eslint-disable-next-line no-await-in-loop
      await cmdAsync(giveHostAccessToDockerNetwork);
      log.info(`IPTABLES: Access to Flux containers from ${network} accepted`);
    } catch (err) {
      log.error(`IPTABLES: Error allowing access to Flux containers from ${network}. ${err}`);
      return false;
    }

    const giveContainerAccessToDNS = baseAllowDnsCmd.replace('#DST', network);
    try {
      // eslint-disable-next-line no-await-in-loop
      await cmdAsync(giveContainerAccessToDNS);
      log.info(`IPTABLES: DNS access to ${network} from Flux containers accepted`);
    } catch (err) {
      log.error(`IPTABLES: Error allowing DNS access to ${network} from Flux containers. ${err}`);
      return false;
    }

    // This always gets appended, so the drop is at the end
    const dropAccessToHostNetwork = baseDropCmd.replace('#DST', network);
    try {
      // eslint-disable-next-line no-await-in-loop
      await cmdAsync(dropAccessToHostNetwork);
      log.info(`IPTABLES: Access to ${network} from Flux containers removed`);
    } catch (err) {
      log.error(`IPTABLES: Error denying access to ${network} from Flux containers. ${err}`);
      return false;
    }
  }

  try {
    await cmdAsync(addReturnCmd);
    log.info('IPTABLES: DOCKER-USER explicit return to FORWARD chain added');
  } catch (err) {
    log.error(`IPTABLES: Error adding explicit return to Forward chain. ${err}`);
    return false;
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
 * docker network including mask to allow to verification. For example: 172.23.123.0/24
 * @returns {Promise<void>}
 */
async function allowOnlyDockerNetworksToFluxNodeService() {
  const firewallActive = await isFirewallActive();

  if (!firewallActive) return;

  const fluxAppDockerNetworks = '172.23.0.0/16';
  const { fluxNodeServiceAddress } = config.server;
  const allowDockerNetworks = `LANG="en_US.UTF-8" && sudo ufw allow from ${fluxAppDockerNetworks} proto tcp to ${fluxNodeServiceAddress}/32 port 16101`;
  // have to use iptables here as ufw won't filter loopback
  const denyRule = `INPUT -i lo ! -s ${fluxAppDockerNetworks} -d ${fluxNodeServiceAddress}/32 -j DROP`;
  const checkDenyRule = `LANG="en_US.UTF-8" && sudo iptables -C ${denyRule}`;
  const denyAllElse = `LANG="en_US.UTF-8" && sudo iptables -I ${denyRule}`;

  const cmdAsync = util.promisify(nodecmd.run);

  try {
    const cmd = await cmdAsync(allowDockerNetworks);
    if (serviceHelper.ensureString(cmd).includes('updated') || serviceHelper.ensureString(cmd).includes('existing') || serviceHelper.ensureString(cmd).includes('added')) {
      log.info(`Firewall adjusted for network: ${fluxAppDockerNetworks} to address: ${fluxNodeServiceAddress}/32`);
    } else {
      log.warn(`Failed to adjust Firewall for network: ${fluxAppDockerNetworks} to address: ${fluxNodeServiceAddress}/32`);
    }
  } catch (err) {
    log.error(err);
  }

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
  checkFluxAvailability,
  getLocalSocketAddress,
  getFluxNodePrivateKey,
  getFluxNodePublicKey,
  MAX_KEEPALIVE_PORTS,
  checkDeterministicNodesCollisions,
  getIncomingConnections,
  getIncomingConnectionsInfo,
  getDOSState,
  setDOSStateApi,
  getNumberOfPeers,
  hasPublicIpOnInterface,
  denyPort,
  deleteAllowPortRule,
  deleteAllowOutPortRule,
  allowPortApi,
  adjustFirewall,
  purgeUFW,
  closeConnection,
  closeIncomingConnection,
  checkFluxbenchVersionAllowed,
  checkMyFluxAvailability,
  adjustExternalIP,
  setOnAddressChanged,
  allowPort,
  allowOutPort,
  isFirewallActive,
  // Exports for testing purposes
  resetNtpSource,
  parseChronyOffset,
  parseTimesyncOffset,
  setStoredFluxBenchAllowed,
  getStoredFluxBenchAllowed,
  setLocalSocketAddress,
  getDosMessage,
  setDosMessage,
  setDosStateValue,
  getDosStateValue,
  isNodeDos,
  PlacementHoldOwner,
  setPlacementHold,
  clearPlacementHold,
  getPlacementHold,
  isPlacementHeld,
  setStickyDosMessage,
  getStickyDosMessage,
  clearStickyDosMessage,
  setStickyDosStateValue,
  fluxUptime,
  fluxSystemUptime,
  isCommunicationEstablished,
  lruRateLimit,
  isPortOpen,
  portAnswered,
  MAX_ECHO_BYTES,
  checkAppAvailability,
  verifySignedFluxnodeMessage,
  isPortEnterprise,
  isPortBanned,
  isPortUPNPBanned,
  isPortUserBlocked,
  allowNodeToBindPrivilegedPorts,
  removeDockerContainerAccessToNonRoutable,
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
