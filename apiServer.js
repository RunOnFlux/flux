/* global userconfig */
global.userconfig = require('./config/userconfig');

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
const serviceManager = require('./ZelBack/src/services/serviceManager');
const upnpService = require('./ZelBack/src/services/upnpService');
const hash = require('object-hash');
const { watch } = require('fs/promises');

const cmdAsync = util.promisify(nodecmd.get);
const apiPort = userconfig.initial.apiport || config.server.apiport;
const apiPortHttps = apiPort + 1;
let hashPrevious = null;
let initialHash = null;

async function configReload() {
  try {
    const watcher = watch(path.join(__dirname, '/config'));
    // eslint-disable-next-line
    for await (const event of watcher) {
      if (event.eventType === 'change' && event.filename === 'userconfig.js') {
        const hashCurrent = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));
        if (hashCurrent === hashPrevious) {
          return;
        }
        hashPrevious = hashCurrent;
        if (initialHash === null) {
          initialHash = hashCurrent;
        }
        if (initialHash !== hashCurrent) {
          initialHash = null;
          log.info(`Config file changed, reloading ${event.filename}...`);
        }
        delete require.cache[require.resolve('./config/userconfig')];
        // eslint-disable-next-line
        userconfig = require('./config/userconfig');
      }
    }
  } catch (error) {
    log.error(`Error watching files: ${error}`);
  }
}

setInterval(async () => {
  configReload();
}, 2 * 1000);

async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }
  if (userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) {
    const verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
    if (verifyUpnp !== true) {
      log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to verify support. Shutting down.`);
      process.exit();
    }
    const setupUpnp = await upnpService.setupUPNP(apiPort);
    if (setupUpnp !== true) {
      log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to map to api or home port. Shutting down.`);
      process.exit();
    }
  }

  app.listen(apiPort, () => {
    log.info(`Flux listening on port ${apiPort}!`);
    serviceManager.startFluxFunctions();
  });

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
    httpsServer.listen(apiPortHttps, () => {
      log.info(`Flux https listening on port ${apiPortHttps}!`);
    });
  } catch (error) {
    log.error(error);
  }
}

initiate();
