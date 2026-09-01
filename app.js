// First, and above every other require: the environment this process answers from.
require('./ZelBack/pinEnvironment');

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

// Guarded so the entry point can be loaded without starting a node: the four
// environment lines above decide what this process discloses, and a test can only
// read them off the real file. Both launchers - `node app.js` and `nodemon app.js`
// - enter here as main.
if (require.main === module) initiate();
