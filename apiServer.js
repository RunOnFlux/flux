process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

global.userconfig = require('./config/userconfig');
global.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const config = require('config');
const fs = require('fs');
const https = require('https');
const path = require('path');
const util = require('util');
const nodecmd = require('node-cmd');
const hash = require('object-hash');
const { watch } = require('fs/promises');
const eWS = require('express-ws');

// Flux requires
let app;
let log;
let socket;
let serviceManager;
let fluxService;
let upnpService;

loadFluxModules();

const cmdAsync = util.promisify(nodecmd.get);
const apiPort = userconfig.initial.apiport || config.server.apiport;
const apiPortHttps = +apiPort + 1;
const development = userconfig.initial.development || false;
let initialHash = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));

function requireUncached(module) {
  delete require.cache[require.resolve(module)];
  return require(module);
}

function loadFluxModules(options = {}) {
  loader = options.invalidateCache ? requireUncached : require

  app = loader('./ZelBack/src/lib/server');
  log = loader('./ZelBack/src/lib/log');
  socket = loader('./ZelBack/src/lib/socket');
  serviceManager = loader('./ZelBack/src/services/serviceManager');
  fluxService = loader('./ZelBack/src/services/fluxService');
  upnpService = loader('./ZelBack/src/services/upnpService');
}

async function loadBranch(branch) {
  const res = await fluxService.getCurrentBranch();
  if (res.status === 'success' && res.data.message !== branch) {
    log.info(`Branch: ${branch} differs from current branch: ${res.data.message}, switching`)
    const success = await fluxService.checkoutBranch(branch, { pull: true });
    if (success) loadFluxModules({ invalidateCache: true });
  }
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
        if (userconfig.initial?.apiport) {
          await loadUpnpIfRequired();
        }
        const branch = development ? userconfig.initial.branch || "development" : "master";
        await loadBranch(branch);
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

  const branch = development ? userconfig.initial.branch || "development" : "master";
  await loadBranch(branch);

  await loadUpnpIfRequired();

  // store timer
  setInterval(configReload, 2 * 1000);

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
  initiate,
};
