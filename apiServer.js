// Flux configuration
process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
const config = require('config');
// const fs = require('fs');
// const https = require('https');
// const path = require('path');
const app = require('./ZelBack/src/lib/server');
const log = require('./ZelBack/src/lib/log');
const serviceManager = require('./ZelBack/src/services/serviceManager');
const upnpService = require('./ZelBack/src/services/upnpService');
const userconfig = require('./config/userconfig');

const apiPort = userconfig.initial.apiport || config.server.apiport;

// const key = fs.readFileSync(path.join(__dirname, '../certs/selfsigned.key'), 'utf8');
// const cert = fs.readFileSync(path.join(__dirname, '../certs/selfsigned.crt'), 'utf8');
// const credentials = { key, cert };
// const httpsServer = https.createServer(credentials, app);

// const apiporthttps = apiPort + 1;
// httpsServer.listen(config.server.apiporthttps, () => {
//   log.info(`Flux https listening on port ${config.server.apiporthttps}!`);
// });

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
}

initiate();
