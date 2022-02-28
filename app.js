process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux configuration
const config = require('config');
const compression = require('compression');
// const fs = require('fs');
// const https = require('https');
const path = require('path');
const express = require('express');
const app = require('./ZelBack/src/lib/server');
const log = require('./ZelBack/src/lib/log');
const serviceManager = require('./ZelBack/src/services/serviceManager');

const userconfig = require('./config/userconfig');

const apiPort = userconfig.apiport || config.server.apiport;
const homePort = apiPort - 1;

// const key = fs.readFileSync(path.join(__dirname, './certs/selfsigned.key'), 'utf8');
// const cert = fs.readFileSync(path.join(__dirname, './certs/selfsigned.crt'), 'utf8');
// const credentials = { key, cert };
// const httpsServer = https.createServer(credentials, app);

// const apiporthttps = apiPort + 1;
// httpsServer.listen(config.server.apiporthttps, () => {
//   log.info(`Flux  https listening on port ${config.server.apiporthttps}!`);
// });

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
