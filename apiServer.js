/* global userconfig */
global.userconfig = require('./config/userconfig');
global.userconfig.computed = {};

process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux configuration
const config = require('config');
const fs = require('fs');
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
const { startGossipServer, getApiPort } = require('./ZelBack/src/services/fluxportControllerService')

const cmdAsync = util.promisify(nodecmd.get);

const autoUpnp = userconfig.initial.upnp || false;

let initialHash = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));

async function runPortAndUpnpSetup() {
  apiPort = await waitForApiPort();

  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }

  userconfig.computed.homePort = apiPort - 1;
  userconfig.computed.apiPort = apiPort;
  userconfig.computed.apiPortSsl = apiPort + 1;
  userconfig.computed.syncthingPort = apiPort + 2;

  await loadUpnpIfRequired();
}

async function waitForApiPort() {
  if (!autoUpnp) {
    // if initial is undefined or empty string, user server.apiport
    return +userconfig.initial.apiport || +config.server.apiport;
  }

  if (await startGossipServer()) {
    return await getApiPort();
  } else {
    log.error("Error starting GossipServer for autoUPnP. Shutting down");
    process.exit();
  }
}

async function loadUpnpIfRequired() {
  let verifyUpnp = false;
  let setupUpnp = false;
  if (autoUpnp || userconfig.initial.apiport) {
    verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
    if (verifyUpnp) {
      setupUpnp = await upnpService.setupUPNP(apiPort);
    }
  }
  if (autoUpnp || userconfig.initial.routerIP || (userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport)) {
    if (verifyUpnp !== true) {
      log.error(`Flux port ${apiPort} specified but UPnP failed to verify support. Shutting down.`);
      process.exit();
    }
    if (setupUpnp !== true) {
      log.error(`Flux port ${apiPort} specified but UPnP failed to map to api or home port. Shutting down.`);
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
        await runPortAndUpnpSetup();
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
  await runPortAndUpnpSetup();

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
    const apiPortSsl = userconfig.computed.apiPortSsl
    httpsServer.listen(apiPortSsl, () => {
      log.info(`Flux https listening on port ${apiPortSsl}!`);
    });
  } catch (error) {
    log.error(error);
  }
  return apiPort;
}

module.exports = {
  initiate,
};
