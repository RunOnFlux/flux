process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

const log = require('./ZelBack/src/lib/log');
const path = require('path');
const compression = require('compression');
const express = require('express');
const apiServer = require('./apiServer');

// A rejected promise nobody is listening to ends the PROCESS, and FluxOS has
// plenty of work running outside a request - reconcilers, sweeps, monitors,
// peer sockets. Without this, one missed `.catch()` anywhere takes the node
// down and leaves a log that says nothing about which one.
//
// Deliberately NOT a substitute for handling errors where they happen: this
// logs loudly precisely so the gap gets found and fixed. Staying up is the
// point - every app on the node is disrupted by a restart, and an unhandled
// rejection is rarely a reason to believe the process is unsafe to continue.
process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
  log.error(`Unhandled promise rejection - this is a missing catch somewhere, not a healthy state: ${detail}`);
});

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

  // Serve static files from CloudUI (includes robots.txt and sitemap.xml)
  homeApp.use(express.static(cloudUI));

  // SPA fallback - serve index.html for unmatched routes.
  // File-like URLs (with an extension) return 404 so missing static assets such as
  // /llms.txt or /ads.txt don't produce a "false 200" with the SPA shell.
  homeApp.get('*', (req, res) => {
    if (path.extname(req.path)) {
      res.status(404).type('text/plain').send('Not Found');

      return;
    }
    res.sendFile(path.join(cloudUI, 'index.html'));
  });

  homeApp.listen(homePort, () => {
    log.info(`Flux Home running on port ${homePort}!`);
  });
}

initiate();
