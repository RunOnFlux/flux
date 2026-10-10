// First, and above every other require: the environment this process answers from. This
// file runs as an entry point of its own under `require.main === module`, so it settles
// the environment rather than relying on whoever required it having done so.
require('./ZelBack/pinEnvironment');
// Before anything connects: how this thread opens outbound connections.
require('./ZelBack/src/services/utils/networkDefaults').applyNetworkDefaults();

const configManager = require('./ZelBack/src/services/utils/configManager');

if (typeof AbortController === 'undefined') {
  // polyfill for nodeJS 14.18.1 - without having to use experimental features
  // eslint-disable-next-line global-require
  const abortControler = require('node-abort-controller');
  globalThis.AbortController = abortControler.AbortController;
}

const fs = require('node:fs');
const path = require('node:path');

const axios = require('axios').default;
const config = require('config');

const serviceManager = require('./ZelBack/src/services/serviceManager');
const systemdNotify = require('./ZelBack/src/services/utils/systemdNotify');
const fluxServer = require('./ZelBack/src/lib/fluxServer');
const log = require('./ZelBack/src/lib/log');

const serviceHelper = require('./ZelBack/src/services/serviceHelper');
const upnpService = require('./ZelBack/src/services/upnpService');
const dnsLookup = require('./ZelBack/src/services/utils/dnsLookup');
const requestHistoryStore = require('./ZelBack/src/services/utils/requestHistory');
const globalState = require('./ZelBack/src/services/utils/globalState');
const fluxEventBus = require('./ZelBack/src/services/utils/fluxEventBus');
const fluxNetworkHelper = require('./ZelBack/src/services/fluxNetworkHelper');
const fluxCommunicationMessagesSender = require('./ZelBack/src/services/fluxCommunicationMessagesSender');
const dockerService = require('./ZelBack/src/services/dockerService');
const syncthingService = require('./ZelBack/src/services/syncthingService');
const syncthingFolderWrites = require('./ZelBack/src/services/appMonitoring/syncthingFolderWrites');
const messageStore = require('./ZelBack/src/services/appMessaging/messageStore');
const { AppSyncOrchestrator } = require('./ZelBack/src/services/appMessaging/appSyncOrchestrator');
const { PM2_KILL_TIMEOUT_MS } = require('./ZelBack/src/services/fluxService');

// How long a stop may take, from the signal to the exit. pm2 kills FluxOS
// PM2_KILL_TIMEOUT_MS after it signals, and Arcane's systemd 90 s after;
// SHUTDOWN_EXIT_MS of pm2's timeout is left for what follows the drain.
const SHUTDOWN_EXIT_MS = 5000;
const SHUTDOWN_BUDGET_MS = PM2_KILL_TIMEOUT_MS - SHUTDOWN_EXIT_MS;
// How much of SHUTDOWN_EXIT_MS pausing the folders may take.
const SHUTDOWN_PAUSE_MS = 3000;
// How long releasing the router's UPnP mappings may take, beside the drain.
const SHUTDOWN_UPNP_RELEASE_MS = 15000;
// How much of SHUTDOWN_EXIT_MS releasing syncthing's mapping may take, once the
// folders are paused; it runs beside the wait for the broadcast.
const SHUTDOWN_UPNP_SYNCTHING_MS = 1000;
const verifyPool = require('./ZelBack/src/services/utils/verifyPool');

const apiPort = globalThis.userconfig.initial.apiport || config.server.apiport;
const apiPortHttps = +apiPort + 1;

let requestHistory = null;
let axiosDefaultsSet = false;

function getrequestHistory() {
  return requestHistory;
}

function setAxiosDefaults(socketIoServers) {
  if (axiosDefaultsSet) return;

  axiosDefaultsSet = true;

  log.info('setting axios defaults');
  axios.defaults.timeout = 20_000;

  if (!globalThis.userconfig.initial.debug) return;

  log.info('User defined debug set, setting up socket.io for debug.');
  requestHistory = new requestHistoryStore.RequestHistory({ maxAge: 60_000 * 60 });

  const rooms = [];
  const requestRoom = 'outboundHttp';

  socketIoServers.forEach((server) => {
    const debugRoom = server.getRoom(requestRoom, { namespace: 'debug' });
    rooms.push(debugRoom);

    const debugAdapter = server.getAdapter('debug');
    debugAdapter.on('join-room', (room, id) => {
      if (room !== requestRoom) return;

      const socket = server.getSocketById('debug', id);
      socket.emit('addHistory', requestHistory.allHistory);
    });
  });

  requestHistory.on('requestAdded', (request) => {
    rooms.forEach((room) => room.emit('addRequest', request));
  });

  requestHistory.on('requestRemoved', (request) => {
    rooms.forEach((room) => room.emit('removeRequest', request));
  });

  axios.interceptors.request.use(
    (conf) => {
      const {
        baseURL, url, method, timeout,
      } = conf;

      const fullUrl = baseURL ? `${baseURL}${url}` : url;

      const requestData = {
        url: fullUrl, verb: method.toUpperCase(), timeout, timestamp: Date.now(),
      };
      requestHistory.storeRequest(requestData);

      return conf;
    },
    (error) => Promise.reject(error),
  );
}

/**
 * Utility function to log error before exiting. As the logging is async, if
 * we don't wait a while, the process exits bofore the logging takes place
 *
 * @param {string} msg
 * @param {{delay?: number, exitCode?: number}} options
 */
async function logErrorAndExit(msg, options = {}) {
  const delayMs = options.delay || 1_000;
  const exitCode = options.exitCode || 0;

  if (msg) log.error(msg);

  const delayS = Math.round((delayMs / 1000) * 100) / 100;

  log.info(`Waiting: ${delayS}s, before exiting with code: ${exitCode}`);

  await serviceHelper.delay(delayMs);
  process.exit(exitCode);
}

async function loadUpnpIfRequired() {
  try {
    let verifyUpnp = false;
    let setupUpnp = false;
    if (globalThis.userconfig.initial.apiport) {
      verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
      if (verifyUpnp) {
        setupUpnp = await upnpService.setupUPNP(apiPort);
      }
    }
    if ((globalThis.userconfig.initial.apiport && globalThis.userconfig.initial.apiport !== config.server.apiport) || globalThis.userconfig.initial.routerIP) {
      if (verifyUpnp !== true) {
        await logErrorAndExit(
          `Flux port ${globalThis.userconfig.initial.apiport} specified but UPnP failed to verify support. Shutting down.`,
          { exitCode: 1, delay: 120_000 },
        );
      }
      if (setupUpnp !== true) {
        await logErrorAndExit(
          `Flux port ${globalThis.userconfig.initial.apiport} specified but UPnP failed to map to api or home port. Shutting down.`,
          { exitCode: 1, delay: 120_000 },
        );
      }
    }
  } catch (error) {
    log.error(error);
  }
}

async function configReload() {
  // Config watching is now handled by configManager
  await configManager.startWatching(log, async (newConfig) => {
    if (newConfig?.initial?.apiport) {
      await loadUpnpIfRequired();
    }
  });
}

/**
 * Main entrypoint
 *
 * @returns {Promise<String>}
 */
async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    await logErrorAndExit(`Flux port ${apiPort} is not supported. Shutting down.`, { exitCode: systemdNotify.EXIT_CONFIG });
  }

  process.on('uncaughtException', (err) => {
    const dnsErrors = ['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL'];
    if (dnsErrors.includes(err.code) && err.hostname) {
      log.error('Uncaught DNS Lookup Error!!, swallowing.');
      log.error(err);
      return;
    }

    logErrorAndExit(err, { exitCode: 1 });
  });

  dnsLookup.install();

  await loadUpnpIfRequired();

  setImmediate(configReload);

  const appRoot = process.cwd();
  // ToDo: move this to async
  const certExists = fs.existsSync(path.join(appRoot, 'certs/v1.key'));

  if (!certExists) {
    const cwd = path.join(appRoot, 'helpers');
    const scriptPath = path.join(cwd, 'createSSLcert.sh');
    await serviceHelper.runCommand(scriptPath, { cwd });
  }

  // ToDo: move these to async
  const key = fs.readFileSync(path.join(appRoot, 'certs/v1.key'), 'utf8');
  const cert = fs.readFileSync(path.join(appRoot, 'certs/v1.crt'), 'utf8');

  const httpServer = new fluxServer.FluxServer();
  const httpsServer = new fluxServer.FluxServer({
    mode: 'https', key, cert, expressApp: httpServer.app,
  });

  const httpError = await httpServer.listen(apiPort).catch((err) => err);

  if (httpError) {
    logErrorAndExit(`Flux api server unable to start. ${httpError}`, { exitCode: systemdNotify.EXIT_CONFIG });
    return '';
  }

  const httpsError = await httpsServer.listen(apiPortHttps).catch((err) => err);

  if (httpsError) {
    logErrorAndExit(`Flux api server unable to start. ${httpsError}`, { exitCode: systemdNotify.EXIT_CONFIG });
    return '';
  }

  log.info(`Flux listening on port ${apiPort}!`);
  log.info(`Flux https listening on port ${apiPortHttps}!`);
  // Ready means the API answers. Mongo, Docker and fluxd come up behind this,
  // each with its own unit. Not awaited: nothing below depends on it.
  systemdNotify.notifyReady();

  setAxiosDefaults([httpServer.socketIo, httpsServer.socketIo]);

  serviceManager.startFluxFunctions();

  return apiPort;
}

/**
 * Check if the system is shutting down or rebooting.
 * Uses multiple detection methods for reliability.
 * @returns {Promise<boolean>} True if system appears to be shutting down/rebooting
 */
async function isSystemShuttingDown() {
  // Method 1: Check for systemd scheduled shutdown file (most reliable for scheduled shutdowns)
  try {
    if (fs.existsSync('/run/systemd/shutdown/scheduled')) {
      log.info('System shutdown detected via /run/systemd/shutdown/scheduled');
      return true;
    }
  } catch (e) {
    // Ignore errors
  }

  // Method 2: Check systemd's current state
  const { stdout: systemState } = await serviceHelper.runCommand('systemctl', {
    params: ['is-system-running'],
    timeout: 5000,
    logError: false,
  });
  if (systemState && systemState.trim() === 'stopping') {
    log.info('System shutdown detected via systemctl is-system-running (stopping)');
    return true;
  }

  // Method 3: Check for active shutdown/reboot jobs in systemd
  const { stdout: jobs } = await serviceHelper.runCommand('systemctl', {
    params: ['list-jobs', '--no-pager'],
    timeout: 5000,
    logError: false,
  });
  if (jobs && (jobs.includes('shutdown.target') || jobs.includes('reboot.target') || jobs.includes('poweroff.target') || jobs.includes('halt.target'))) {
    log.info('System shutdown detected via systemctl list-jobs');
    return true;
  }

  // Method 4: Check for running shutdown/reboot processes
  const { stdout: shutdownPid } = await serviceHelper.runCommand('pgrep', {
    params: ['-x', 'shutdown'],
    timeout: 5000,
    logError: false,
  });
  if (shutdownPid && shutdownPid.trim()) {
    log.info('System shutdown detected via running shutdown process');
    return true;
  }

  // Method 5: Check runlevel (0 = halt, 6 = reboot)
  const { stdout: runlevel } = await serviceHelper.runCommand('runlevel', {
    timeout: 5000,
    logError: false,
  });
  if (runlevel) {
    const trimmedRunlevel = runlevel.trim();
    if (trimmedRunlevel.endsWith(' 0') || trimmedRunlevel.endsWith(' 6')) {
      log.info(`System shutdown detected via runlevel: ${trimmedRunlevel}`);
      return true;
    }
  }

  // Method 6: Check for /run/nologin (created during shutdown, but NOT /etc/nologin which can be manual)
  try {
    if (fs.existsSync('/run/nologin')) {
      log.info('System shutdown detected via /run/nologin file');
      return true;
    }
  } catch (e) {
    // Ignore errors
  }

  return false;
}

/**
 * Stops every running Flux app container, each with a 9 s grace before a kill.
 */
async function stopFluxAppContainers() {
  try {
    let containers = await dockerService.dockerListContainers(false);
    containers = containers || [];
    containers = containers.filter((c) => c.Names[0].slice(1, 4) === 'zel' || c.Names[0].slice(1, 5) === 'flux');

    if (containers.length > 0) {
      log.info(`Gracefully stopping ${containers.length} Flux app containers...`);
      // Fire all stop requests in parallel. Each sends SIGTERM and falls back
      // to force-kill after 9 seconds. Promise.allSettled waits for every
      // container to finish, so total shutdown time is ~9s (not N * 9s).
      const stopPromises = containers.map((container) => {
        const containerName = container.Names[0].slice(1);
        return dockerService.appDockerStop(containerName, 9)
          .then(() => {
            log.info(`Container ${containerName} stopped`);
          })
          .catch(async (stopErr) => {
            log.warn(`Graceful stop failed for ${containerName}: ${stopErr.message}, force killing...`);
            try {
              await dockerService.appDockerKill(containerName);
              log.info(`Container ${containerName} force killed`);
            } catch (killErr) {
              log.warn(`Failed to kill container ${containerName}: ${killErr.message}`);
            }
          });
      });
      await Promise.allSettled(stopPromises);
      log.info(`Shutdown stop completed for ${containers.length} Flux app containers`);
    } else {
      log.info('No running Flux app containers to stop');
    }
  } catch (error) {
    log.error(`Error stopping containers during shutdown: ${error.message}`);
  }
}

/**
 * Pauses every syncthing folder, within SHUTDOWN_PAUSE_MS. Publishes
 * shutdown:paused with the folders paused, those that failed, and whether the
 * time ran out first.
 * @returns {Promise<void>}
 */
async function pauseFoldersForShutdown() {
  let timer;
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SHUTDOWN_PAUSE_MS); });
  try {
    const result = await Promise.race([syncthingFolderWrites.pauseAllFolders(), timedOut]);
    if (!result) {
      log.warn(`Shutdown: pausing the syncthing folders did not finish within ${SHUTDOWN_PAUSE_MS}ms`);
      fluxEventBus.publish('shutdown:paused', { paused: [], failed: [], timedOut: true });
      return;
    }
    if (result.failed.length) log.warn(`Shutdown: ${result.failed.length} syncthing folder(s) could not be paused: ${result.failed.join(', ')}`);
    log.info(`Shutdown: paused ${result.paused.length} syncthing folder(s)`);
    fluxEventBus.publish('shutdown:paused', { ...result, timedOut: false });
  } catch (error) {
    log.warn(`Shutdown: the syncthing folders could not be paused: ${error.message}`);
    fluxEventBus.publish('shutdown:paused', { paused: [], failed: [], timedOut: false });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stops FluxOS. On a system shutdown or reboot it announces the shutdown to its
 * peers, stops the app containers, releases the router's UPnP mappings to this
 * node, drains every sendreceive folder to the connected peers and pauses every
 * folder before exiting; on a restart of the service alone it exits at once.
 */
async function shutDown() {
  const deadline = performance.now() + SHUTDOWN_BUDGET_MS;
  log.info('SIGTERM received, checking if system is shutting down...');

  // Small delay to allow systemd to update its state before we check
  await serviceHelper.delay(100);

  const systemShuttingDown = await isSystemShuttingDown();

  if (!systemShuttingDown) {
    log.info('System is not shutting down (service restart detected), skipping shutdown broadcast');
    process.exit(0);
  }

  log.info('System shutdown/reboot detected, initiating graceful shutdown with peer notification...');
  fluxEventBus.publish('shutdown:started', {});
  globalState.setShutdownInProgressTrue();

  try {
    const { runningAppsCache } = globalState;

    if (runningAppsCache.size > 0) {
      log.info(`Node was running ${runningAppsCache.size} apps, broadcasting shutdown notification to peers...`);

      const ip = await fluxNetworkHelper.getLocalSocketAddress();
      if (ip) {
        const sigtermMessage = {
          type: 'fluxnodesigterm',
          version: 1,
          ip,
          broadcastedAt: Date.now(),
        };

        log.info(`Broadcasting fluxnodesigterm message: ${JSON.stringify(sigtermMessage)}`);

        const signedMessage = await fluxCommunicationMessagesSender.broadcastMessageToAll(sigtermMessage);

        // Store sigterm event in event log and shorten location TTL to ~7 minutes.
        // Peers apply the same when receiving the sigterm via gossip.
        try {
          const envelope = { version: signedMessage.version, timestamp: signedMessage.timestamp, pubKey: signedMessage.pubKey, signature: signedMessage.signature };
          await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.SIGTERM, { message: sigtermMessage, envelope });
          await messageStore.expireLocationsForSigterm(ip, sigtermMessage.broadcastedAt);
          log.info('Local sigterm event stored and location records updated to expire in ~7 minutes');
        } catch (dbError) {
          log.warn(`Failed to update local app expiration: ${dbError.message}`);
        }

        log.info('Shutdown notification broadcasted successfully');
      } else {
        log.warn('Could not get IP address, skipping shutdown broadcast');
      }
    } else {
      log.info('No running apps cached, skipping shutdown broadcast');
    }
  } catch (error) {
    log.error(`Error during SIGTERM handling: ${error.message}`);
  }

  await AppSyncOrchestrator.writeShutdownReason('sigterm');

  // A start already under way when the flag was set can land after the first
  // list is taken; the second pass stops it.
  await stopFluxAppContainers();
  await stopFluxAppContainers();

  // With the containers stopped the router's mappings to this node serve
  // nothing, and a node that never comes back - or comes back on another
  // address - would leave them behind for good. Released beside the drain;
  // syncthing's is held until the drain and the pause are over.
  const syncthingPorts = [+apiPort + 2, +(globalThis.userconfig.initial.apiport || config.server.apiport) + 2];
  const upnpReleased = upnpService.isUPNP()
    ? upnpService.releaseOwnMappings(syncthingPorts, Math.max(0, Math.min(SHUTDOWN_UPNP_RELEASE_MS, deadline - performance.now())))
    : Promise.resolve({ removed: 0, held: [] });

  // The peers can only take over from what they hold, and syncthing is stopped
  // right after this process exits. The drain has what is left of the budget
  // once the containers are stopped.
  try {
    const incomplete = await syncthingService.drainFoldersToPeers(Math.max(0, deadline - performance.now()));
    fluxEventBus.publish('shutdown:drained', { complete: incomplete.length === 0, incomplete });
    if (incomplete.length) {
      log.warn(`Shutdown drain reached its deadline with ${incomplete.length} folder(s) not yet complete on a peer: ${incomplete.join(', ')}`);
    } else {
      log.info('Shutdown drain complete: every sendreceive folder is complete on its connected peers');
    }
  } catch (error) {
    log.warn(`Shutdown drain failed: ${error.message}`);
  }

  // syncthing keeps a folder's pause across its own restart, so the next start
  // sends nothing until the election has decided who holds each folder.
  await pauseFoldersForShutdown();

  const { held } = await upnpReleased;
  // Give some time for the broadcast to complete
  await Promise.all([
    serviceHelper.delay(1000),
    upnpService.removeMappingsWithin(held, SHUTDOWN_UPNP_SYNCTHING_MS),
  ]);

  verifyPool.stop();
  log.info('Graceful shutdown complete, exiting...');
  process.exit(0);
}

let shutdownInFlight = null;

/**
 * The SIGTERM and SIGINT handler. One stop can arrive several times: pm2
 * signals every process in its tree at once, and the processes between pm2 and
 * this one pass the signal on again. A signal that arrives while a shutdown is
 * under way joins it.
 *
 * @returns {Promise<void>}
 */
function handleSigterm() {
  if (!shutdownInFlight) {
    shutdownInFlight = shutDown().finally(() => { shutdownInFlight = null; });
  }
  return shutdownInFlight;
}

// Register SIGTERM handler for graceful shutdown on system reboot/shutdown
process.on('SIGTERM', handleSigterm);
// pm2 stops its processes with SIGINT, systemd with SIGTERM.
process.on('SIGINT', handleSigterm);

if (require.main === module) {
  initiate();
}

module.exports = {
  getrequestHistory,
  handleSigterm,
  initiate,
  isSystemShuttingDown,
};
