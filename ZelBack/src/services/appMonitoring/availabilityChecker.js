// Availability Checker - Checks apps availability by testing ports from external nodes
const axios = require('axios');
const config = require('config');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const verificationHelper = require('../verificationHelper');
const daemonServiceMiscRpcs = require('../daemonService/daemonServiceMiscRpcs');
const upnpService = require('../upnpService');
const networkStateService = require('../networkStateService');
const fluxHttpTestServer = require('../utils/fluxHttpTestServer');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');

// Helper function to sign check app data
async function signCheckAppData(message) {
  const privKey = await fluxNetworkHelper.getFluxNodePrivateKey();
  const signature = await verificationHelper.signMessage(message, privKey);
  return signature;
}

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
      .deleteAllowPortRule(testingPort)
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
  const timeouts = {
    default: 3_600_000,
    error: 60_000,
    failure: 15_000,
    dos: 300_000,
    appError: 240_000,
  };

  const thresholds = {
    dos: 100,
    portsHighEdge: 100,
    portsLowEdge: 80,
  };

  if (dosState.dosMountMessage || dosState.dosDuplicateAppMessage) {
    dosState.dosMessage = dosState.dosMountMessage || dosState.dosDuplicateAppMessage;
    dosState.dosStateValue = thresholds.dos;

    await serviceHelper.delay(timeouts.appError);
    setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
    return;
  }

  const isUpnp = upnpService.isUPNP();
  const testHttpServer = new fluxHttpTestServer.FluxHttpTestServer();

  const setNextPort = () => {
    if (dosState.originalPortFailed && dosState.testingPort > dosState.originalPortFailed) {
      dosState.nextTestingPort = dosState.originalPortFailed - 1;
    } else {
      dosState.nextTestingPort = null;
      dosState.originalPortFailed = null;
    }
  };

  const setRandomPort = () => {
    const ports = Array.from(portsNotWorking);
    const randomIndex = Math.floor(Math.random() * ports.length);
    dosState.nextTestingPort = ports[randomIndex];
    return ports;
  };

  try {
    const syncStatus = daemonServiceMiscRpcs.isDaemonSynced();
    if (!syncStatus.data.synced) {
      log.info('Flux Node daemon not synced. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);

    if (!isNodeConfirmed) {
      log.info('Flux Node not Confirmed. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const localSocketAddress = await fluxNetworkHelper.getMyFluxIPandPort();
    if (!localSocketAddress) {
      log.info('No Public IP found. Application checks are disabled');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const installedAppsRes = await installedAppsFn();
    if (installedAppsRes.status !== 'success') {
      log.error('Failed to get installed Apps');
      await serviceHelper.delay(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    // Decrypt enterprise apps (version 8 with encrypted content)
    installedAppsRes.data = await decryptEnterpriseApps(installedAppsRes.data);

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
      dosState.testingPort = dosState.nextTestingPort;
    } else {
      const { fluxapps: { portMin, portMax } } = config;
      dosState.testingPort = Math.floor(Math.random() * (portMax - portMin) + portMin);
    }

    log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort}`);

    const isPortBanned = fluxNetworkHelper.isPortBanned(dosState.testingPort);
    if (isPortBanned) {
      log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort} is banned`);
      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    if (isUpnp) {
      const isPortUpnpBanned = fluxNetworkHelper.isPortUPNPBanned(dosState.testingPort);
      if (isPortUpnpBanned) {
        log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort} is UPNP banned`);
        setNextPort();
        await serviceHelper.delay(timeouts.failure);
        setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
        return;
      }
    }

    const isPortUserBlocked = fluxNetworkHelper.isPortUserBlocked(dosState.testingPort);
    if (isPortUserBlocked) {
      log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort} is user blocked`);
      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    if (appPorts.includes(dosState.testingPort)) {
      log.info(`checkMyAppsAvailability - Skipped checking ${dosState.testingPort} - in use`);
      setNextPort();
      await serviceHelper.delay(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const remoteSocketAddress = await networkStateService.getRandomSocketAddress(localSocketAddress);
    if (!remoteSocketAddress) {
      await serviceHelper.delay(timeouts.appError);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    if (failedNodesTestPortsCache.has(remoteSocketAddress)) {
      await serviceHelper.delay(timeouts.failure);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const firewallActive = isArcane ? true : await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      await fluxNetworkHelper.allowPort(dosState.testingPort);
    }

    if (isUpnp) {
      const upnpMapResult = await upnpService.mapUpnpPort(dosState.testingPort, 'Flux_Test_App');
      if (!upnpMapResult) {
        if (dosState.lastUPNPMapFailed) {
          dosState.dosStateValue += 4;
          if (dosState.dosStateValue >= thresholds.dos) {
            dosState.dosMessage = 'Not possible to run applications on the node, router returning exceptions when creating UPNP ports mappings';
          }
        }
        dosState.lastUPNPMapFailed = true;
        log.info(`checkMyAppsAvailability - Testing port ${dosState.testingPort} failed to create UPnP mapping`);
        setNextPort();
        await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, {
          skipFirewall: !firewallActive,
          skipUpnp: true,
          skipHttpServer: true,
        });
        const upnpDelay = dosState.dosMessage ? timeouts.dos : timeouts.error;
        await serviceHelper.delay(upnpDelay);
        setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
        return;
      }
      dosState.lastUPNPMapFailed = false;
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
      await serviceHelper.delay(timeouts.error);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const timeout = 10_000;
    const axiosConfig = {
      timeout,
      headers: { 'content-type': '' },
    };

    const pubKey = await fluxNetworkHelper.getFluxNodePublicKey();
    const [localIp, localPort = '16127'] = localSocketAddress.split(':');
    const [remoteIp, remotePort = '16127'] = remoteSocketAddress.split(':');

    const data = {
      ip: localIp,
      port: localPort,
      appname: 'appPortsTest',
      ports: [dosState.testingPort],
      pubKey,
    };

    const signature = await signCheckAppData(JSON.stringify(data));
    data.signature = signature;

    const resMyAppAvailability = await axios
      .post(`http://${remoteIp}:${remotePort}/flux/checkappavailability`, JSON.stringify(data), axiosConfig)
      .catch(() => {
        log.error(`checkMyAppsAvailability - ${remoteSocketAddress} for app availability is not reachable`);
        dosState.nextTestingPort = dosState.testingPort;
        failedNodesTestPortsCache.set(remoteSocketAddress, '');
        return null;
      });

    await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, {
      skipFirewall: !firewallActive,
      skipUpnp: !isUpnp,
    });

    if (!resMyAppAvailability) {
      await serviceHelper.delay(timeouts.failure);
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
      await serviceHelper.delay(timeouts.error);
      setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
      return;
    }

    const portTestFailed = responseStatus === 'error';
    let waitMs = 0;

    if (portTestFailed && portsNotWorking.size < thresholds.portsHighEdge) {
      portsNotWorking.add(dosState.testingPort);
      if (!dosState.originalPortFailed) {
        dosState.originalPortFailed = dosState.testingPort;
        dosState.nextTestingPort = dosState.testingPort < 65535 ? dosState.testingPort + 1 : dosState.testingPort - 1;
      } else if (dosState.testingPort >= dosState.originalPortFailed && dosState.testingPort + 1 <= 65535) {
        dosState.nextTestingPort = dosState.testingPort + 1;
      } else if (dosState.testingPort - 1 > 0) {
        dosState.nextTestingPort = dosState.testingPort - 1;
      } else {
        dosState.nextTestingPort = null;
        dosState.originalPortFailed = null;
      }
      waitMs = timeouts.failure;
    } else if (portTestFailed && dosState.dosStateValue < thresholds.dos) {
      dosState.dosStateValue += 4;
      setRandomPort();
      waitMs = timeouts.failure;
    } else if (portTestFailed && dosState.dosStateValue >= thresholds.dos) {
      const failedPorts = setRandomPort();
      dosState.dosMessage = `Ports tested not reachable from outside, DMZ or UPNP required! All ports that have failed: ${JSON.stringify(failedPorts)}`;
      waitMs = timeouts.dos;
    } else if (!portTestFailed && portsNotWorking.size > thresholds.portsLowEdge) {
      portsNotWorking.delete(dosState.testingPort);
      setRandomPort();
      waitMs = timeouts.failure;
    } else {
      portsNotWorking.clear();
      dosState.nextTestingPort = null;
      dosState.originalPortFailed = null;
      dosState.dosMessage = dosState.dosMountMessage || dosState.dosDuplicateAppMessage || null;
      dosState.dosStateValue = dosState.dosMessage ? thresholds.dos : 0;
      waitMs = timeouts.default;
    }

    if (portTestFailed) {
      log.error(`checkMyAppsAvailability - Port ${dosState.testingPort} unreachable. Detected from ${remoteIp}:${remotePort}. DosState: ${dosState.dosStateValue}`);
    } else {
      log.info(`${responseMessage} Detected from ${remoteIp}:${remotePort} on port ${dosState.testingPort}. DosState: ${dosState.dosStateValue}`);
    }

    if (portsNotWorking.size) {
      log.error(`checkMyAppsAvailability - Count: ${portsNotWorking.size}. portsNotWorking: ${JSON.stringify(Array.from(portsNotWorking))}`);
    }

    await serviceHelper.delay(waitMs);
    setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
  } catch (error) {
    if (!dosState.dosMessage && (dosState.dosMountMessage || dosState.dosDuplicateAppMessage)) {
      dosState.dosMessage = dosState.dosMountMessage || dosState.dosDuplicateAppMessage;
    }
    await handleTestShutdown(dosState.testingPort, testHttpServer, isArcane, { skipUpnp: !isUpnp });
    log.error(`checkMyAppsAvailability - Error: ${error}`);
    await serviceHelper.delay(timeouts.appError);
    setImmediate(() => checkMyAppsAvailability(installedAppsFn, dosState, portsNotWorking, failedNodesTestPortsCache, isArcane));
  }
}

module.exports = {
  checkMyAppsAvailability,
};
