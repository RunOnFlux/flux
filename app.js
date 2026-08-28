process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// The directory is pinned above so config loads from the one fluxbench
// hashes. NODE_CONFIG is the same door: the config package merges whatever
// JSON it holds over every file, after the directory is settled, so leaving
// it open redirects any endpoint without touching a hashed file - the one
// redirect tamper detection cannot see. Deleted rather than emptied, because
// an empty value is parsed and fails rather than being ignored.
delete process.env.NODE_CONFIG;

// The same door, one variable over. Express hands a caller the exception stack
// instead of the status text unless this says production, and apicache stamps its
// version onto every cached response. Assigned rather than defaulted: the
// environment is not hashed, so a value read from it is a change to how the node
// answers that tamper detection cannot see. Set before the first require - express
// and apicache each read it as they load.
process.env.NODE_ENV = 'production';

// node-config names its deployment from the environment too, preferring this
// variable to NODE_ENV. Pinned to the deployment it already resolves to, so the
// line above governs express and apicache alone: the config directory holds one
// file, default.js, and node-config warns on every start for a deployment name it
// cannot find a file for.
process.env.NODE_CONFIG_ENV = 'development';

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
