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

  // Cloud UI static files directory
  const cloudUI = path.join(__dirname, './CloudUI');

  const homeApp = express();
  homeApp.use(compression());

  // Health check endpoint
  homeApp.get('/health', (req, res) => {
    res.type('text/plain');
    res.send('OK');
  });

  // Robots.txt endpoint
  homeApp.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /');
  });

  // Serve static files from CloudUI
  homeApp.use(express.static(cloudUI));

  // SPA fallback - serve index.html for all unmatched routes
  homeApp.get('*', (req, res) => {
    res.sendFile(path.join(cloudUI, 'index.html'));
  });

  homeApp.listen(homePort, () => {
    log.info(`Flux Home running on port ${homePort}!`);
  });
}

initiate();
