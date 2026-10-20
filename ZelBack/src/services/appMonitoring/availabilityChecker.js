// Availability Checker - Checks apps availability by testing ports from external nodes
const axios = require('axios');
const config = require('config');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const upnpService = require('../upnpService');
const networkStateService = require('../networkStateService');
const fluxHttpTestServer = require('../utils/fluxHttpTestServer');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
const { extractIp, extractPort } = require('../utils/socketAddressUtils');
const { nodeSigner } = require('../utils/nodeSigner');

// Helper function to handle test shutdown
async function handleTestShutdown(testingPort, testHttpServer, isArcane, options = {}) {
  const skipFirewall = options.skipFirewall || false;
  const skipUpnp = options.skipUpnp || false;
  const skipHttpServer = options.skipHttpServer || false;

  const updateFirewall = skipFirewall
    ? false
    : isArcane
    || await fluxNetworkHelper.isFirewallActive().catch(() => true);

  if (updateFirewall) {
    await fluxNetworkHelper
      .deleteTestPortRule(testingPort)
      .catch((e) => log.error(e));
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
  const testHttpServer = new fluxHttpTestServer.FluxHttpTestServer();

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

    // An external observer: this asks a peer whether it can reach US, and a Flux
    // node sharing our public address cannot answer that. Null when there is no
    // such node, which the retry below already handles.
    const remoteSocketAddress = await networkStateService.getRandomExternalObserver(localSocketAddress);
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
      await fluxNetworkHelper.allowTestPort(dosState.testingPort);
    }

    if (isUpnp) {
      // the test server is HTTP: TCP is all it needs
      const upnpMapResult = await upnpService.mapUpnpPort(dosState.testingPort, 'Flux_Test_App', { protocols: ['TCP'] });
      routerRefused = routerRefusedSinceLastPass(dosState);
      if (routerRefused) countPortFailure(dosState, thresholds.dos, UPNP_DOS_MESSAGE);
      if (!upnpMapResult.mapped) {
        log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort} failed to create UPnP mapping: ${upnpMapResult.reason}`);
        setNextPort();
        await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, {
          skipFirewall: !firewallActive,
          skipHttpServer: true,
        });
        const upnpDelay = dosState.portFailureScore >= thresholds.dos ? timeouts.dos : timeouts.error;
        await waitForNextPass(upnpDelay);
        setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
        return;
      }
    }

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

    const error = await listening.catch((err) => err);
    if (error) {
      log.warn(`Unable to listen on port: ${dosState.testingPort}. Error: ${error}`);
      setNextPort();
      await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, {
        skipFirewall: !firewallActive,
        skipUpnp: !isUpnp,
        skipHttpServer: true,
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
    };

    const signature = signer.sign(JSON.stringify(data));
    if (!signature) throw new Error('checkMyAppsAvailability - the port test could not be signed');
    data.signature = signature;

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

    const portTestFailed = responseStatus === 'error';
    let waitMs = 0;

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

    // A router that refused this node a mapping or has yet to remove one is
    // looked at again soon, so the pass that finds it working again comes
    // soon; a refusal during this pass gave no wake, the check not waiting.
    const routerFaulting = routerRefused
      || upnpService.routerRefusals() > dosState.routerRefusalsSeen
      || upnpService.removalPending();
    if (isUpnp && routerFaulting) {
      waitMs = Math.min(waitMs, dosState.portFailureScore >= thresholds.dos ? timeouts.dos : timeouts.error);
    }
    await waitForNextPass(waitMs);
    setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
  } catch (error) {
    await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, { skipUpnp: !isUpnp });
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
