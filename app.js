/* eslint-disable global-require */
process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
const fs = require('fs');
const path = require('path');
// const key = fs.readFileSync(path.join(__dirname, './certs/selfsigned.key'), 'utf8');
// const cert = fs.readFileSync(path.join(__dirname, './certs/selfsigned.crt'), 'utf8');
// const credentials = { key, cert };
// const httpsServer = https.createServer(credentials, app);

// const apiporthttps = +apiPort + 1;
// httpsServer.listen(config.server.apiporthttps, () => {
//   log.info(`Flux  https listening on port ${config.server.apiporthttps}!`);
// });

async function initiate() {
  // TEMPORARY FIX
  const conFilePath = path.resolve(__dirname, './ZelBack/config/userconfig');

  const confFile = fs.readFileSync(conFilePath, 'utf-8');
  const confFilePatch = confFile.replace("'", '`');
  fs.writeFileSync(conFilePath, confFilePatch, 'utf-8');

  // eslint-disable-next-line global-require
  const userconfig = require('./config/userconfig');
  // Flux configuration
  const config = require('config');
  const compression = require('compression');

  // const https = require('https');
  const express = require('express');
  const app = require('./ZelBack/src/lib/server');
  const log = require('./ZelBack/src/lib/log');
  const serviceManager = require('./ZelBack/src/services/serviceManager');
  const upnpService = require('./ZelBack/src/services/upnpService');
  const apiPort = userconfig.initial.apiport || config.server.apiport;
  const homePort = +apiPort - 1;
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
    log.info(`Flux running on port ${apiPort}!`);
    serviceManager.startFluxFunctions();
  });

  // Flux Home configuration
  const home = path.join(__dirname, './HomeUI/dist');

  const homeApp = express();
  homeApp.use(compression());
  homeApp.use(express.static(home));

  homeApp.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /');
  });

  homeApp.get('*', (req, res) => {
    res.sendFile(path.join(home, 'index.html'));
  });

  homeApp.listen(homePort, () => {
    log.info(`Flux Home running on port ${homePort}!`);
  });
}

initiate();
