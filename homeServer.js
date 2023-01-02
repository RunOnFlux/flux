process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux Home configuration
import { config } from '../../config/default.js';
import compression from 'compression';
import path from 'path';
import express from 'express';
import log from './ZelBack/src/lib/log.js';
import upnpService from './ZelBack/src/services/upnpService,js';

const home = path.join(__dirname, './HomeUI/dist');

import userconfig from './config/userconfig.js';

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

const apiPort = userconfig.initial.apiport || config.server.apiport;
const homePort = apiPort - 1;

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
  homeApp.listen(homePort, () => {
    console.log(`Flux Home running on port ${homePort}!`);
  });
}

initiate();
