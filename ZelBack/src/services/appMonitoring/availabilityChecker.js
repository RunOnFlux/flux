// Availability Checker - Checks apps availability by testing ports from external nodes
const crypto = require('node:crypto');
const axios = require('axios');
const config = require('config');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const upnpService = require('../upnpService');
const networkStateService = require('../networkStateService');
const fluxHttpTestServer = require('../utils/fluxHttpTestServer');
const fluxUdpTestServer = require('../utils/fluxUdpTestServer');
const portManager = require('../appNetwork/portManager');
const registryManager = require('../appDatabase/registryManager');
const policyStore = require('../policyStore');
const fluxEventBus = require('../utils/fluxEventBus');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
const { extractIp, extractPort } = require('../utils/socketAddressUtils');
const { nodeSigner } = require('../utils/nodeSigner');

// Helper function to handle test shutdown
async function handleTestShutdown(testingPort, testHttpServer, isArcane, options = {}) {
  const skipFirewall = options.skipFirewall || false;
  const skipUpnp = options.skipUpnp || false;
  const skipHttpServer = options.skipHttpServer || false;
  const protocols = options.protocols || ['tcp', 'udp'];

  if (options.udpTestServer) options.udpTestServer.close();

  const updateFirewall = skipFirewall
    ? false
    : isArcane
    || await fluxNetworkHelper.isFirewallActive().catch(() => true);

  if (updateFirewall) {
    // eslint-disable-next-line no-restricted-syntax
    for (const protocol of protocols) {
      // eslint-disable-next-line no-await-in-loop
      await fluxNetworkHelper
        .deleteTestPortRule(testingPort, protocol)
        .catch((e) => log.error(e));
    }
  }

  if (!skipUpnp) {
    await upnpService
      .removeMapUpnpPort(testingPort, 'Flux_Test_App')
      .catch((e) => log.error(e));
  }

  if (!skipHttpServer) {
    testHttpServer.close((err) => {
      if (err) {
        log.error(`testHttpServer shutdown failed: ${err.message}`);
      }
    });
  }
}

const UPNP_DOS_MESSAGE = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings';
const PORTS_DOS_MESSAGE_PREFIX = 'Ports tested not reachable from outside';

/**
 * Whether the node's DOS message is this check's. There is one message for every
 * reason a node can be out of service, so this check sets it only when none
 * stands and clears only its own.
 * @param {string|null} message The node's DOS message.
 * @returns {boolean}
 */
function isOwnDosMessage(message) {
  return Boolean(message) && (message === UPNP_DOS_MESSAGE || message.startsWith(PORTS_DOS_MESSAGE_PREFIX));
}

/**
 * Counts one failure of this check toward its own DOS, kept apart from the node's
 * so another check clearing the node's DOS does not reset it. Once the count
 * reaches the DOS threshold the node is out of service with `message`, unless
 * another check's DOS already stands.
 * @param {object} dosState
 * @param {number} threshold
 * @param {string} message
 * @returns {boolean} Whether this check holds the node's DOS now.
 */
function countPortFailure(dosState, threshold, message) {
  // eslint-disable-next-line no-param-reassign
  dosState.portFailureScore = Math.min((dosState.portFailureScore ?? 0) + 4, threshold);
  if (dosState.portFailureScore < threshold) return false;
  if (dosState.dosMessage && !isOwnDosMessage(dosState.dosMessage)) return false;
  // eslint-disable-next-line no-param-reassign
  dosState.dosMessage = message;
  // eslint-disable-next-line no-param-reassign
  dosState.dosStateValue = Math.max(dosState.dosStateValue, threshold);
  return true;
}

/**
 * Ends this check's count, and the node's DOS when it is this check's, now that
 * every port it tests is reachable.
 * @param {object} dosState
 * @returns {void}
 */
function releaseOwnDos(dosState) {
  // eslint-disable-next-line no-param-reassign
  dosState.portFailureScore = 0;
  if (!isOwnDosMessage(dosState.dosMessage)) return;
  // eslint-disable-next-line no-param-reassign
  dosState.dosMessage = null;
  // eslint-disable-next-line no-param-reassign
  dosState.dosStateValue = 0;
}

/**
 * The signed policy document that lets a port found closed over UDP count
 * toward this check's DOS. Absent or anything but `true`, a confirmed UDP
 * failure is reported in the node's health and counts nothing.
 */
const UDP_DOS_DOCUMENT = 'udpportdos';

/**
 * Whether a port found closed over UDP counts toward this check's DOS.
 * @returns {boolean}
 */
function udpDosEnabled() {
  return policyStore.getDocument(UDP_DOS_DOCUMENT) === true;
}

/**
 * How many passes a port is tested again over UDP, looking for a peer that
 * probes UDP - to confirm one peer's silence, or on a UDP pass that learned
 * nothing - before the pass is left unsettled.
 */
const UDP_RETESTS = 3;

/**
 * The protocols a pass tests. A node behind UPnP maps one protocol per pass,
 * TCP and UDP in turn, so a pass costs its router one mapping and one removal;
 * a node with no mapping to make tests both every pass.
 * @param {boolean} isUpnp
 * @param {object} dosState
 * @returns {string[]}
 */
function passProtocols(isUpnp, dosState) {
  return isUpnp ? [dosState.testingProtocol ?? 'tcp'] : ['tcp', 'udp'];
}

/**
 * Whether an application the network lists at this node's public address holds
 * a port. Another node behind the same address serving that port is not a fault
 * of this node's, so the port is not one to test here.
 * @param {number} port
 * @param {string} localSocketAddress
 * @returns {Promise<boolean>}
 */
async function portHeldAtThisAddress(port, localSocketAddress) {
  const appsAtThisAddress = await registryManager.getRunningAppIpList(extractIp(localSocketAddress));
  const held = await portManager.assignedPortsGlobalApps(appsAtThisAddress.map((app) => app.name));
  if (held.some((app) => app.ports.includes(port))) return true;
  return (await portManager.siblingHoldingPort([port], localSocketAddress)) !== null;
}

/**
 * What one peer's UDP answer for the port under test says.
 * @param {object|undefined} udpAnswered - from the peer
 * @param {number} port
 * @param {string} token
 * @returns {'proven'|'silent'|'unknown'} unknown: the peer does not probe UDP,
 *   or could not send to the port
 */
function udpVerdict(udpAnswered, port, token) {
  if (!udpAnswered || typeof udpAnswered !== 'object') return 'unknown';
  const reply = udpAnswered[port] !== undefined ? udpAnswered[port] : udpAnswered[String(port)];
  if (reply === undefined) return 'unknown';
  return typeof reply === 'string' && reply.includes(token) ? 'proven' : 'silent';
}

let wakeNextPass = null;

/**
 * Waits `ms` before the next pass, or less: the router refusing a mapping, a
 * UPnP removal becoming pending, or the last one going, starts the next pass at
 * once. Every wait between passes is this one, and a wake only ends it: there
 * is never more than one pass.
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function waitForNextPass(ms) {
  const woken = new Promise((resolve) => { wakeNextPass = resolve; });
  await Promise.race([serviceHelper.delay(ms), woken]);
  wakeNextPass = null;
}

/**
 * Starts the next pass now, if the check is waiting for it.
 */
function wakeCheck() {
  if (wakeNextPass) wakeNextPass();
}

upnpService.routerEvents.on('mappingRefused', wakeCheck);
upnpService.routerEvents.on('removalPending', wakeCheck);
upnpService.routerEvents.on('removalsClear', wakeCheck);

/**
 * Whether the router has refused a mapping for a reason of its own - a full
 * table, no answer - since this check last asked: any mapping, an install's, a
 * restore's or this check's own. Read once per pass, so a pass counts once
 * however many it refused.
 * @param {object} dosState
 * @returns {boolean}
 */
function routerRefusedSinceLastPass(dosState) {
  const refusals = upnpService.routerRefusals();
  const refused = refusals > dosState.routerRefusalsSeen;
  // eslint-disable-next-line no-param-reassign
  dosState.routerRefusalsSeen = refusals;
  return refused;
}

/**
 * Check my apps availability by testing ports from external nodes
 * @param {Function} installedAppsFn - Function to get installed apps
 * @param {object} dosState - DOS state object with getters and setters
 * @param {object} portsNotWorking - Set of ports not working
 * @param {object} failedNodesTestPortsCache - Cache of failed nodes
 * @param {boolean} isArcane - Whether running on Arcane
 * @returns {Promise<void>}
 */
async function checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane) {
  const { timeoutsMs: timeouts, thresholds } = config.fluxapps.appsPortCheck;

  const isUpnp = upnpService.isUPNP();
  let routerRefused = false;
  // One secret for this pass, published by both test servers and never sent to
  // the peer: only our own test servers can produce it.
  const portTestToken = crypto.randomBytes(16).toString('hex');
  const testHttpServer = new fluxHttpTestServer.FluxHttpTestServer(portTestToken);
  let udpTestServer = null;

  const setNextPort = () => {
    if (dosState.originalPortFailed && dosState.testingPort > dosState.originalPortFailed) {
      // eslint-disable-next-line no-param-reassign
      dosState.nextTestingPort = dosState.originalPortFailed - 1;
    } else {
      // eslint-disable-next-line no-param-reassign
      dosState.nextTestingPort = null;
      // eslint-disable-next-line no-param-reassign
      dosState.originalPortFailed = null;
    }
  };

  const setRandomPort = () => {
    const ports = Array.from(portsNotWorking);
    const randomIndex = Math.floor(Math.random() * ports.length);
    // eslint-disable-next-line no-param-reassign
    dosState.nextTestingPort = ports[randomIndex];
    return ports;
  };

  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      log.info('Flux Node daemon not synced. Application checks are disabled');
      await waitForNextPass(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);

    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Application checks are disabled');
      await waitForNextPass(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const localSocketAddress = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddress) {
      log.info('No Public IP found. Application checks are disabled');
      await waitForNextPass(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const installedAppsRes = await installedAppsFn();
    if (installedAppsRes.status !== 'success') {
      log.error('Failed to get installed Apps');
      await waitForNextPass(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    // Decrypt enterprise apps (version 8 with encrypted content)
    ({ inPlace: installedAppsRes.data } = await decryptEnterpriseApps(installedAppsRes.data));

    const apps = installedAppsRes.data;
    const appPorts = [];

    apps.forEach((app) => {
      if (app.version === 1) {
        appPorts.push(+app.port);
      } else if (app.version <= 3) {
        app.ports.forEach((port) => {
          appPorts.push(+port);
        });
      } else {
        app.compose.forEach((component) => {
          component.ports.forEach((port) => {
            appPorts.push(+port);
          });
        });
      }
    });

    if (dosState.nextTestingPort) {
      // eslint-disable-next-line no-param-reassign
      dosState.testingPort = dosState.nextTestingPort;
    } else {
      const { fluxapps: { portMin, portMax } } = config;
      // eslint-disable-next-line no-param-reassign
      dosState.testingPort = Math.floor(Math.random() * (portMax - portMin) + portMin);
    }

    log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort}`);

    const isPortBanned = fluxNetworkHelper.isPortBanned(dosState.testingPort);
    if (isPortBanned) {
      log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort} is banned`);
      setNextPort();
      await waitForNextPass(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    if (isUpnp) {
      const isPortUpnpBanned = fluxNetworkHelper.isPortUPNPBanned(dosState.testingPort);
      if (isPortUpnpBanned) {
        log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort} is UPNP banned`);
        setNextPort();
        await waitForNextPass(timeouts.failure);
        setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
        return;
      }
    }

    // A router that has yet to remove a mapping of this node fails the check,
    // and is given no test mapping until it has.
    if (isUpnp && upnpService.removalPending()) {
      log.info('checkMyAppsAvailability - the router has yet to remove a mapping of this node; no test mapping until it has');
      countPortFailure(dosState, thresholds.dos, UPNP_DOS_MESSAGE);
      await waitForNextPass(dosState.portFailureScore >= thresholds.dos ? timeouts.dos : timeouts.error);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    if (appPorts.includes(dosState.testingPort)) {
      log.info(`checkMyAppsAvailability - Skipped checking ${dosState.testingPort} - in use`);
      setNextPort();
      await waitForNextPass(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    if (await portHeldAtThisAddress(dosState.testingPort, localSocketAddress)) {
      log.info(`checkMyAppsAvailability - Skipped checking ${dosState.testingPort} - held by an application at this address`);
      setNextPort();
      await waitForNextPass(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const protocols = passProtocols(isUpnp, dosState);
    const tcpTested = protocols.includes('tcp');
    const udpTested = protocols.includes('udp');

    // A port one peer heard nothing on over UDP is tested again by another.
    const udpSuspect = udpTested && dosState.udpSuspect?.port === dosState.testingPort ? dosState.udpSuspect : null;

    // An external observer: this asks a peer whether it can reach US, and a Flux
    // node sharing our public address cannot answer that. Null when there is no
    // such node, which the retry below already handles.
    const remoteSocketAddress = await networkStateService.getRandomExternalObserver(
      localSocketAddress,
      { exclude: udpSuspect ? [udpSuspect.peer] : [] },
    );
    if (!remoteSocketAddress) {
      await waitForNextPass(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    if (failedNodesTestPortsCache.has(remoteSocketAddress)) {
      await waitForNextPass(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const firewallActive = isArcane ? true : await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const protocol of protocols) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.allowTestPort(dosState.testingPort, protocol);
      }
    }

    if (isUpnp) {
      // A router refusing either protocol's mapping for a reason of its own is
      // a router fault, counted as one.
      const upnpMapResult = await upnpService.mapUpnpPort(dosState.testingPort, 'Flux_Test_App', { protocols: protocols.map((protocol) => protocol.toUpperCase()) });
      routerRefused = routerRefusedSinceLastPass(dosState);
      if (routerRefused) countPortFailure(dosState, thresholds.dos, UPNP_DOS_MESSAGE);
      if (!upnpMapResult.mapped) {
        log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort} failed to create UPnP mapping: ${upnpMapResult.reason}`);
        setNextPort();
        await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, {
          skipFirewall: !firewallActive,
          skipHttpServer: true,
          protocols,
        });
        const upnpDelay = dosState.portFailureScore >= thresholds.dos ? timeouts.dos : timeouts.error;
        await waitForNextPass(upnpDelay);
        setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
        return;
      }
    }

    let error = null;
    let httpListening = false;
    if (tcpTested) {
      const listening = new Promise((resolve, reject) => {
        testHttpServer
          .once('error', (err) => {
            testHttpServer.removeAllListeners('listening');
            reject(err.message);
          })
          .once('listening', () => {
            testHttpServer.removeAllListeners('error');
            resolve(null);
          });
        testHttpServer.listen(dosState.testingPort);
      });
      error = await listening.catch((err) => err);
      httpListening = !error;
    }
    if (!error && udpTested) {
      udpTestServer = new fluxUdpTestServer.FluxUdpTestServer(portTestToken);
      error = await udpTestServer.listen(dosState.testingPort).then(() => null, (err) => err.message);
    }
    if (error) {
      log.warn(`Unable to listen on port: ${dosState.testingPort}. Error: ${error}`);
      setNextPort();
      await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, {
        skipFirewall: !firewallActive,
        skipUpnp: !isUpnp,
        skipHttpServer: !httpListening,
        udpTestServer,
        protocols,
      });
      await waitForNextPass(timeouts.error);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const timeout = 10_000;
    const axiosConfig = {
      timeout,
      headers: { 'content-type': '' },
    };

    const signer = await nodeSigner();
    if (!signer) throw new Error('checkMyAppsAvailability - this node cannot sign the port test');

    const localIp = extractIp(localSocketAddress);
    const localPort = extractPort(localSocketAddress);
    const remoteIp = extractIp(remoteSocketAddress);
    const remotePort = extractPort(remoteSocketAddress);

    const data = {
      ip: localIp,
      port: String(localPort),
      appname: 'appPortsTest',
      ports: [dosState.testingPort],
      pubKey: signer.pubKey,
      // Read the port back rather than merely reach it, over this pass's protocols.
      echo: true,
      protocols,
    };

    const signature = signer.sign(JSON.stringify(data));
    if (!signature) throw new Error('checkMyAppsAvailability - the port test could not be signed');
    data.signature = signature;

    if (udpTestServer) udpTestServer.allow(remoteIp);

    const resMyAppAvailability = await axios
      .post(`http://${remoteIp}:${remotePort}/flux/checkappavailability`, JSON.stringify(data), axiosConfig)
      .catch(() => {
        log.error(`checkMyAppsAvailability - ${remoteSocketAddress} for app availability is not reachable`);
        // eslint-disable-next-line no-param-reassign
        dosState.nextTestingPort = dosState.testingPort;
        failedNodesTestPortsCache.set(remoteSocketAddress, '');
        return null;
      });

    await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, {
      skipFirewall: !firewallActive,
      skipUpnp: !isUpnp,
      skipHttpServer: !httpListening,
      udpTestServer,
      protocols,
    });

    if (!resMyAppAvailability) {
      await waitForNextPass(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const {
      data: {
        status: responseStatus = null,
        data: { message: responseMessage = 'No response' } = { message: 'No response' },
      },
    } = resMyAppAvailability;

    if (!['success', 'error'].includes(responseStatus)) {
      log.warn(`checkMyAppsAvailability - Unexpected response status: ${responseStatus}`);
      await waitForNextPass(timeouts.error);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const { answered, udpAnswered } = resMyAppAvailability.data.data || {};
    // A pass that does not test TCP reads nothing from the peer's TCP answer: a
    // peer that does not know `protocols` tests TCP anyway, and finds it unmapped.
    let portTestFailed = tcpTested && responseStatus === 'error';
    let tcpOutcome = 'notTested';
    if (tcpTested) tcpOutcome = portTestFailed ? 'unreachable' : 'passed';

    // A peer that read the port: only our token says this node is what
    // answered. Anything else holding the port leaves it as unusable here as
    // nothing answering. A peer that does not read ports is taken at its word.
    if (tcpTested && !portTestFailed && answered && portManager.portNotOurs([dosState.testingPort], answered, portTestToken) !== null) {
      log.warn(`checkMyAppsAvailability - Port ${dosState.testingPort} answered ${remoteIp}:${remotePort} as something other than this node`);
      portTestFailed = true;
      tcpOutcome = 'notOurs';
    }

    // Over UDP, our token heard by one peer proves the port; silence heard by
    // one peer is tested again by another, and counts once two have heard it.
    let retestUdp = false;
    let firstUdpSilence = false;
    const udp = !udpTested || portTestFailed ? 'unknown' : udpVerdict(udpAnswered, dosState.testingPort, portTestToken);
    if (udp === 'proven') {
      // eslint-disable-next-line no-param-reassign
      dosState.udpSuspect = null;
      fluxNetworkHelper.setUdpReachability({ reachable: true });
    } else if (udp === 'silent' && !udpSuspect) {
      // The pass's TCP result is handled as any other's; only the port and the
      // wait are the retest's.
      log.warn(`checkMyAppsAvailability - ${remoteIp}:${remotePort} heard nothing of this node on port ${dosState.testingPort} over UDP; asking another peer`);
      // eslint-disable-next-line no-param-reassign
      dosState.udpSuspect = { port: dosState.testingPort, peer: remoteSocketAddress, retests: 0 };
      retestUdp = true;
      firstUdpSilence = true;
    } else if (udp === 'silent') {
      const peers = [extractIp(udpSuspect.peer), remoteIp];
      log.error(`checkMyAppsAvailability - Port ${dosState.testingPort} does not answer this node over UDP, as heard by ${peers.join(' and ')}`
        + `${udpDosEnabled() ? '' : '; reported in health, not counted'}`);
      // eslint-disable-next-line no-param-reassign
      dosState.udpSuspect = null;
      fluxNetworkHelper.setUdpReachability({ reachable: false, port: dosState.testingPort, peers });
      if (udpDosEnabled()) portTestFailed = true;
    } else if (udpSuspect && !portTestFailed) {
      udpSuspect.retests += 1;
      retestUdp = udpSuspect.retests < UDP_RETESTS;
      // eslint-disable-next-line no-param-reassign
      if (!retestUdp) dosState.udpSuspect = null;
    } else if (udpTested && !tcpTested) {
      // A UDP pass whose peer does not probe UDP learned nothing.
      // eslint-disable-next-line no-param-reassign
      dosState.udpUnsettled = (dosState.udpUnsettled ?? 0) + 1;
      retestUdp = dosState.udpUnsettled < UDP_RETESTS;
    }
    if (udp !== 'unknown' || !retestUdp) {
      // eslint-disable-next-line no-param-reassign
      dosState.udpUnsettled = 0;
    }

    let waitMs = 0;
    let passed = false;

    if (portTestFailed && portsNotWorking.size < thresholds.portsHighEdge) {
      portsNotWorking.add(dosState.testingPort);
      if (!dosState.originalPortFailed) {
        // eslint-disable-next-line no-param-reassign
        dosState.originalPortFailed = dosState.testingPort;
        // eslint-disable-next-line no-param-reassign
        dosState.nextTestingPort = dosState.testingPort < 65535 ? dosState.testingPort + 1 : dosState.testingPort - 1;
      } else if (dosState.testingPort >= dosState.originalPortFailed && dosState.testingPort + 1 <= 65535) {
        // eslint-disable-next-line no-param-reassign
        dosState.nextTestingPort = dosState.testingPort + 1;
      } else if (dosState.testingPort - 1 > 0) {
        // eslint-disable-next-line no-param-reassign
        dosState.nextTestingPort = dosState.testingPort - 1;
      } else {
        // eslint-disable-next-line no-param-reassign
        dosState.nextTestingPort = null;
        // eslint-disable-next-line no-param-reassign
        dosState.originalPortFailed = null;
      }
      waitMs = timeouts.failure;
    } else if (portTestFailed) {
      const failedPorts = setRandomPort();
      countPortFailure(dosState, thresholds.dos, `${PORTS_DOS_MESSAGE_PREFIX}, DMZ or UPNP required! All ports that have failed: ${JSON.stringify(failedPorts)}`);
      waitMs = dosState.portFailureScore >= thresholds.dos ? timeouts.dos : timeouts.failure;
    } else if (!portTestFailed && portsNotWorking.size > thresholds.portsLowEdge) {
      portsNotWorking.delete(dosState.testingPort);
      setRandomPort();
      waitMs = timeouts.failure;
    } else {
      passed = true;
      portsNotWorking.clear();
      // eslint-disable-next-line no-param-reassign
      dosState.nextTestingPort = null;
      // eslint-disable-next-line no-param-reassign
      dosState.originalPortFailed = null;
      // a router refusing others' mappings is not cleared by one that took this test's
      if (!routerRefused) releaseOwnDos(dosState);
      waitMs = timeouts.default;
    }

    if (portTestFailed) {
      log.error(`checkMyAppsAvailability - Port ${dosState.testingPort} unreachable. Detected from ${remoteIp}:${remotePort}. Port failure score: ${dosState.portFailureScore}`);
    } else {
      log.info(`${responseMessage} Detected from ${remoteIp}:${remotePort} on port ${dosState.testingPort}. Port failure score: ${dosState.portFailureScore}`);
    }

    if (portsNotWorking.size) {
      log.error(`checkMyAppsAvailability - Count: ${portsNotWorking.size}. portsNotWorking: ${JSON.stringify(Array.from(portsNotWorking))}`);
    }

    if (retestUdp) {
      // eslint-disable-next-line no-param-reassign
      dosState.nextTestingPort = dosState.testingPort;
      waitMs = Math.min(waitMs, timeouts.failure);
    } else if (isUpnp && passed) {
      // The other protocol's turn, once this one has passed.
      // eslint-disable-next-line no-param-reassign
      dosState.testingProtocol = tcpTested ? 'udp' : 'tcp';
    }

    // A router that refused this node a mapping or has yet to remove one is
    // looked at again soon, so the pass that finds it working again comes
    // soon; a refusal during this pass gave no wake, the check not waiting.
    const routerFaulting = routerRefused
      || upnpService.routerRefusals() > dosState.routerRefusalsSeen
      || upnpService.removalPending();
    if (isUpnp && routerFaulting) {
      waitMs = Math.min(waitMs, dosState.portFailureScore >= thresholds.dos ? timeouts.dos : timeouts.error);
    }
    // Which branch each pass took, as a tally: the passes run too often to stream.
    fluxEventBus.count('availability:pass', tcpOutcome, udpTested ? udp : 'notTested');
    if (firstUdpSilence) {
      fluxEventBus.count('availability:firstUdpSilence', tcpOutcome, portsNotWorking.size === 0 ? 'cleared' : 'notCleared');
    }
    await waitForNextPass(waitMs);
    setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
  } catch (error) {
    await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, { skipUpnp: !isUpnp, udpTestServer, protocols: passProtocols(isUpnp, dosState) });
    log.error(`checkMyAppsAvailability - Error: ${error}`);
    await waitForNextPass(timeouts.appError);
    setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
  }
}

module.exports = {
  checkMyAppsAvailability,
  releaseOwnDos,
  countPortFailure,
};
