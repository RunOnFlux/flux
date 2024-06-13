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
const eWS = require('express-ws');

const app = require('./ZelBack/src/lib/server');
const log = require('./ZelBack/src/lib/log');
const { SocketIoServer } = require('./ZelBack/src/lib/socketIoServer');
const serviceManager = require('./ZelBack/src/services/serviceManager');
const serviceHelper = require('./ZelBack/src/services/serviceHelper');
const upnpService = require('./ZelBack/src/services/upnpService');
const requestHistoryStore = require('./ZelBack/src/services/utils/requestHistory');

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

function setAxiosDefaults(options = {}) {
  if (axiosDefaultsSet) return;

  axiosDefaultsSet = true;

  const rooms = options.rooms || [];

  log.info('setting axios defaults');
  axios.defaults.timeout = 20_000;

  if (!globalThis.userconfig.initial.debug) return;

  requestHistory = new requestHistoryStore.RequestHistory({ maxAge: 30_000 });

  requestHistory.on('requestAdded', (request) => {
    rooms.forEach((room) => room.emit('addRequest', request));
  });

  requestHistory.on('requestRemoved', (request) => {
    rooms.forEach((room) => room.emit('removeRequest', request));
  });

  axios.interceptors.request.use(
    (conf) => {
      const { url, method, timeout } = conf;
      const requestData = {
        url, method, timeout, timestamp: new Date(),
      };
      requestHistory.storeRequest(requestData);

      return conf;
    },
    (error) => Promise.reject(error),
  );
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
        log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to verify support. Shutting down.`);
        process.exit();
      }
      if (setupUpnp !== true) {
        log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to map to api or home port. Shutting down.`);
        process.exit();
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

function startServer(target, port) {
  return new Promise((resolve, reject) => {
    const server = target.listen(port);
    server.once('error', (err) => {
      server.listeners('listening').forEach((l) => server.removeListener('listening', l));
      reject(err);
    }).once('listening', () => {
      server.listeners('error').forEach((l) => server.removeListener('error', l));
      resolve(server);
    });
  });
}

/**
 *
 * @returns {Promise<String>}
 */
async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }

  process.on('uncaughtException', (err) => {
    // the express server port in use is uncatchable for some reason
    // remove this in future
    if (err.code === 'EADDRINUSE') {
      console.log('Flux api server port in use, shutting down.');
    } else {
      console.log(err);
    }
    process.exit();
  });

  await createDnsCache();

  await loadUpnpIfRequired();

  setInterval(async () => {
    configReload();
  }, 2 * 1000);

  const appRoot = process.cwd();
  // ToDo: move this to async
  const certExists = fs.existsSync(path.join(appRoot, 'certs/v1.key'));

  if (!certExists) {
    const cwd = path.join(appRoot, 'helpers');
    await serviceHelper.runCommand('createSSLcert.sh', { cwd });
  }

  // ToDo: move these to async
  const key = fs.readFileSync(path.join(appRoot, 'certs/v1.key'), 'utf8');
  const cert = fs.readFileSync(path.join(appRoot, 'certs/v1.crt'), 'utf8');

  const credentials = { key, cert };

  const appHttps = https.createServer(credentials, app);

  eWS(app, appHttps);

  const serverHttp = await startServer(app, apiPort).catch((err) => {
    log.error(err);
    process.exit();
  });

  log.info(`Flux listening on port ${apiPort}!`);

  const serverHttps = await startServer(appHttps, apiPortHttps).catch((err) => {
    log.error(err);
    process.exit();
  });

  log.info(`Flux https listening on port ${apiPortHttps}!`);

  const socketIoHttp = new SocketIoServer(serverHttp);
  const socketIoHttps = new SocketIoServer(serverHttps);

  socketIoHttp.listen();
  socketIoHttps.listen();

  const debugRoomHttp = socketIoHttp.getRoom('httpOutbound', { namespace: 'debug' });
  const debugRoomHttps = socketIoHttps.getRoom('httpOutbound', { namespace: 'debug' });

  setAxiosDefaults({ rooms: [debugRoomHttp, debugRoomHttps] });

  serviceManager.startFluxFunctions();

  return apiPort;
}

module.exports = {
  createDnsCache,
  getCacheable,
  getrequestHistory,
  initiate,
  resetCacheable,
};
