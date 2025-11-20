process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux Home configuration
const config = require('config');
const compression = require('compression');
const path = require('path');
const express = require('express');
const log = require('./ZelBack/src/lib/log');
const upnpService = require('./ZelBack/src/services/upnpService');

const userconfig = require('./config/userconfig');

const homeApp = express();
homeApp.use(compression());

const apiPort = userconfig.initial.apiport || config.server.apiport;
const homePort = apiPort - 1;

// Health check endpoint - no redirect
homeApp.get('/health', (req, res) => {
  res.type('text/plain');
  res.send('OK');
});

// Robots.txt endpoint - no redirect
homeApp.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});

// Redirect all other requests to cloud.runonflux.com
homeApp.get('*', (req, res) => {
  try {
    // Get the host from the request (could be IP or domain)
    const host = req.hostname || req.headers.host?.split(':')[0] || req.ip;

    // Determine protocol - use https if the request was https, otherwise http
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';

    // Build the backend URL (protocol://host:apiPort)
    const backendUrl = `${protocol}://${host}:${apiPort}`;

    // Redirect to cloud.runonflux.com with backend parameter
    const redirectUrl = `https://cloud.runonflux.com/?backend=${encodeURIComponent(backendUrl)}`;

    log.info(`Redirecting to cloud.runonflux.com with backend: ${backendUrl}`);
    res.redirect(302, redirectUrl);
  } catch (error) {
    log.error(`Error during redirect: ${error.message}`);
    res.redirect(302, 'https://cloud.runonflux.com/');
  }
});

async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }
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
  homeApp.listen(homePort, () => {
    log.info(`Flux Home running on port ${homePort}! Redirecting to cloud.runonflux.com`);
  });
}

initiate();
