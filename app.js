process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

const log = require('./ZelBack/src/lib/log');
const path = require('path');
const compression = require('compression');
const express = require('express');
// const apiServer = require('./apiServer');

async function initiate() {
  // const apiPort = await apiServer.initiate();
  // if (process.argv[2] === '--dev') {
  //   log.info('Running FluxOS development server.');
  //   return;
  // }

  const apiPort = 16187;
  const homePort = +apiPort - 1;
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
