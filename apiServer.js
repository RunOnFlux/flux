global.userconfig = require('./config/userconfig');

process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux configuration
const config = require('config');
const fs = require('fs');
const http = require('node:http');
const https = require('https');
const path = require('path');
const util = require('util');
const nodecmd = require('node-cmd');
const app = require('./ZelBack/src/lib/server');
const log = require('./ZelBack/src/lib/log');
const socket = require('./ZelBack/src/lib/socket');
const serviceManager = require('./ZelBack/src/services/serviceManager');
const upnpService = require('./ZelBack/src/services/upnpService');
const hash = require('object-hash');
const { watch } = require('fs/promises');
const eWS = require('express-ws');

const cmdAsync = util.promisify(nodecmd.get);
const apiPort = userconfig.initial.apiport || config.server.apiport;
const apiPortHttps = +apiPort + 1;
let initialHash = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));

/**
 * The Cacheable. So we only instantiate it once (and for testing)
 */
let cacheable = null;

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
}

async function loadUpnpIfRequired() {
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
 *
 * @returns {Promise<String>}
 */
async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }

  if (typeof AbortController === 'undefined') {
    // polyfill for nodeJS 14.18.1 - without having to use experimental features
    // eslint-disable-next-line global-require
    const abortControler = require('node-abort-controller');
    globalThis.AbortController = abortControler.AbortController;
  }

  await createDnsCache();

  await loadUpnpIfRequired();

  setInterval(async () => {
    configReload();
  }, 2 * 1000);

  const server = app.listen(apiPort, () => {
    log.info(`Flux listening on port ${apiPort}!`);
    serviceManager.startFluxFunctions();
  });

  socket.initIO(server);

  try {
    const certExists = fs.existsSync(path.join(__dirname, './certs/v1.key'));
    if (!certExists) {
      const nodedpath = path.join(__dirname, './helpers');
      const exec = `cd ${nodedpath} && bash createSSLcert.sh`;
      await cmdAsync(exec);
    }
    const key = fs.readFileSync(path.join(__dirname, './certs/v1.key'), 'utf8');
    const cert = fs.readFileSync(path.join(__dirname, './certs/v1.crt'), 'utf8');
    const credentials = { key, cert };
    const httpsServer = https.createServer(credentials, app);
    eWS(app, httpsServer);
    const serverHttps = httpsServer.listen(apiPortHttps, () => {
      log.info(`Flux https listening on port ${apiPortHttps}!`);
    });
    socket.initIO(serverHttps);
  } catch (error) {
    log.error(error);
  }
  return apiPort;
}

module.exports = {
  createDnsCache,
  getCacheable,
  resetCacheable,
  initiate,
};
