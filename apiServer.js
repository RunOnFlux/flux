// Flux configuration
process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
import { config } from '../../config/default.js';
// import fs from 'fs';
// const https = require('https');
// import path from 'path';
import app from './ZelBack/src/lib/server.js';
import log from './ZelBack/src/lib/log.js';
import serviceManager from './ZelBack/src/services/serviceManager.js';
import upnpService from './ZelBack/src/services/upnpService,js';

import userconfig from './config/userconfig.js';

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
