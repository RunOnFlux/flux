process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux Home configuration
const config = require('config');
const compression = require('compression');
const path = require('path');
const express = require('express');
const log = require('./ZelBack/src/lib/log');
const upnpService = require('./ZelBack/src/services/upnpService');

const userconfig = require('./config/userconfig');

// Cloud UI static files directory
const cloudUI = path.join(__dirname, './CloudUI');

const homeApp = express();
homeApp.use(compression());

const apiPort = userconfig.initial.apiport || config.server.apiport;
const homePort = apiPort - 1;

// Health check endpoint
homeApp.get('/health', (req, res) => {
  res.type('text/plain');
  res.send('OK');
});

// Serve static files from CloudUI
homeApp.use(express.static(cloudUI));

// SPA fallback - serve index.html for all unmatched routes
homeApp.get('*', (req, res) => {
  res.sendFile(path.join(cloudUI, 'index.html'));
});

async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }
  let verifyUpnp = false;
  if (userconfig.initial.apiport) {
    // verifyUPNPsupport probes capabilities and maps all FluxOS ports
    verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
  }
  if ((userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) || userconfig.initial.routerIP) {
    if (verifyUpnp !== true) {
      log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to verify or map ports. Shutting down.`);
      process.exit();
    }
  }
  homeApp.listen(homePort, () => {
    log.info(`Flux Home running on port ${homePort}!`);
  });
}

initiate();
