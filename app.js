process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

const log = require('./ZelBack/src/lib/log');
const path = require('path');
const compression = require('compression');
const express = require('express');
const apiServer = require('./apiServer');

async function initiate() {
  const apiPort = await apiServer.initiate();
  if (process.argv[2] === '--dev') {
    log.info('Running FluxOS development server.');
    return;
  }
  const homePort = +apiPort - 1;

  const homeApp = express();
  homeApp.use(compression());

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

  homeApp.listen(homePort, () => {
    log.info(`Flux Home running on port ${homePort}! Redirecting to cloud.runonflux.com`);
  });
}

initiate();
