global.userconfig = require('./config/userconfig');

if (typeof AbortController === 'undefined') {
  // polyfill for nodeJS 14.18.1 - without having to use experimental features
  // eslint-disable-next-line global-require
  const abortControler = require('node-abort-controller');
  globalThis.AbortController = abortControler.AbortController;
}

process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { watch } = require('node:fs/promises');

const axios = require('axios').default;
const config = require('config');
const hash = require('object-hash');

const serviceManager = require('./ZelBack/src/services/serviceManager');
const fluxServer = require('./ZelBack/src/lib/fluxServer');
const log = require('./ZelBack/src/lib/log');

const serviceHelper = require('./ZelBack/src/services/serviceHelper');
const upnpService = require('./ZelBack/src/services/upnpService');
const requestHistoryStore = require('./ZelBack/src/services/utils/requestHistory');
const globalState = require('./ZelBack/src/services/utils/globalState');
const fluxNetworkHelper = require('./ZelBack/src/services/fluxNetworkHelper');
const fluxCommunicationMessagesSender = require('./ZelBack/src/services/fluxCommunicationMessagesSender');

const apiPort = userconfig.initial.apiport || config.server.apiport;
const apiPortHttps = +apiPort + 1;
let initialHash = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));

let requestHistory = null;
let axiosDefaultsSet = false;

/**
 * The Cacheable. So we only instantiate it once (and for testing)
 */
let cacheable = null;

function getrequestHistory() {
  return requestHistory;
}

/**
 * Gets the cacheable CacheableLookup() for testing
 */
function getCacheable() {
  return cacheable;
}

/**
 * Gets the cacheable CacheableLookup() for testing
 */
function resetCacheable() {
  cacheable = null;
}

/**
 * Adds extra servers to DNS, if they are not being used already. This is just
 * within the NodeJS process, not systemwide.
 *
 * Sets these globally for both http and https (axios) It will use the OS servers
 * by default, and if they fail, move on to our added servers, if a server fails, requests
 * go to an active server immediately, for a period.
 * @param {Map?} userCache An optional cache, we use this as a reference for testing
 * @returns {Promise<void>}
 */
async function createDnsCache(userCache) {
  try {
    if (cacheable) return;

    const cache = userCache || new Map();

    // we have to dynamic import here as cacheable-lookup only supports ESM.
    const { default: CacheableLookup } = await import('cacheable-lookup');
    cacheable = new CacheableLookup({ maxTtl: 360, cache });

    cacheable.install(http.globalAgent);
    cacheable.install(https.globalAgent);

    const cloudflareDns = '1.1.1.1';
    const googleDns = '8.8.8.8';
    const quad9Dns = '9.9.9.9';

    const backupServers = [cloudflareDns, googleDns, quad9Dns];

    const existingServers = cacheable.servers;

    // it dedupes any servers
    cacheable.servers = [...existingServers, ...backupServers];
  } catch (error) {
    log.error(error);
  }
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
  const delay = options.delay || 1_000;
  const exitCode = options.exitCode || 0;

  if (msg) log.error(msg);

  const delayS = Math.round((delay / 1000) * 100) / 100;

  log.info(`Waiting: ${delayS}s, before exiting with code: ${exitCode}`);

  await new Promise((r) => { setTimeout(r, delay); });
  process.exit(exitCode);
}

async function loadUpnpIfRequired() {
  try {
    let verifyUpnp = false;
    let setupUpnp = false;
    if (userconfig.initial.apiport) {
      verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
      if (verifyUpnp) {
        setupUpnp = await upnpService.setupUPNP(apiPort);
      }
    }
    if ((userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) || userconfig.initial.routerIP) {
      if (verifyUpnp !== true) {
        await logErrorAndExit(
          `Flux port ${userconfig.initial.apiport} specified but UPnP failed to verify support. Shutting down.`,
          { exitCode: 1, delay: 120_000 },
        );
      }
      if (setupUpnp !== true) {
        await logErrorAndExit(
          `Flux port ${userconfig.initial.apiport} specified but UPnP failed to map to api or home port. Shutting down.`,
          { exitCode: 1, delay: 120_000 },
        );
      }
    }
  } catch (error) {
    log.error(error);
  }
}

async function configReload() {
  try {
    const watcher = watch(path.join(__dirname, '/config'));
    // eslint-disable-next-line
    for await (const event of watcher) {
      if (event.eventType === 'change' && event.filename === 'userconfig.js') {
        const hashCurrent = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));
        if (hashCurrent === initialHash) {
          return;
        }
        initialHash = hashCurrent;
        log.info(`Config file changed, reloading ${event.filename}...`);
        delete require.cache[require.resolve('./config/userconfig')];
        // eslint-disable-next-line
        userconfig = require('./config/userconfig');
        if (userconfig?.initial?.apiport) {
          await loadUpnpIfRequired();
        }
      }
    }
  } catch (error) {
    log.error(`Error watching files: ${error}`);
  }
}

/**
 * Main entrypoint
 *
 * @returns {Promise<String>}
 */
async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    await logErrorAndExit(`Flux port ${apiPort} is not supported. Shutting down.`);
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

  await createDnsCache();

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
    // if shutting down clean, nodemon won't restart
    logErrorAndExit(`Flux api server unable to start. ${httpError}`);
    return '';
  }

  const httpsError = await httpsServer.listen(apiPortHttps).catch((err) => err);

  if (httpsError) {
    // if shutting down clean, nodemon won't restart
    logErrorAndExit(`Flux api server unable to start. ${httpsError}`);
    return '';
  }

  log.info(`Flux listening on port ${apiPort}!`);
  log.info(`Flux https listening on port ${apiPortHttps}!`);

  setAxiosDefaults([httpServer.socketIo, httpsServer.socketIo]);

  serviceManager.startFluxFunctions();

  return apiPort;
}

/**
 * Handle SIGTERM signal for graceful shutdown.
 * If the node was running apps, broadcast a fluxnodesigterm message to peers.
 */
async function handleSigterm() {
  log.info('SIGTERM received, initiating graceful shutdown...');

  try {
    const { runningAppsCache } = globalState;

    if (runningAppsCache.size > 0) {
      log.info(`Node was running ${runningAppsCache.size} apps, broadcasting shutdown notification to peers...`);

      const ip = await fluxNetworkHelper.getMyFluxIPandPort();
      if (ip) {
        const sigtermMessage = {
          type: 'fluxnodesigterm',
          version: 1,
          ip,
          broadcastedAt: Date.now(),
        };

        log.info(`Broadcasting fluxnodesigterm message: ${JSON.stringify(sigtermMessage)}`);

        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(sigtermMessage);
        await serviceHelper.delay(500);
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(sigtermMessage);

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

  // Give some time for the broadcast to complete
  await new Promise((resolve) => { setTimeout(resolve, 1000); });

  log.info('Graceful shutdown complete, exiting...');
  process.exit(0);
}

// Register SIGTERM handler for graceful shutdown on system reboot/shutdown
process.on('SIGTERM', handleSigterm);

if (require.main === module) {
  initiate();
}

module.exports = {
  createDnsCache,
  getCacheable,
  getrequestHistory,
  initiate,
  resetCacheable,
};
