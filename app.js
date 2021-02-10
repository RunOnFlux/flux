process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux configuration
const config = require('config');
const compression = require('compression');
// const fs = require('fs');
// const https = require('https');
const path = require('path');
const express = require('express');
const app = require('./ZelBack/src/lib/server.js');
const log = require('./ZelBack/src/lib/log');
const serviceManager = require('./ZelBack/src/services/serviceManager');

// const key = fs.readFileSync(path.join(__dirname, './certs/selfsigned.key'), 'utf8');
// const cert = fs.readFileSync(path.join(__dirname, './certs/selfsigned.crt'), 'utf8');
// const credentials = { key, cert };
// const httpsServer = https.createServer(credentials, app);

// httpsServer.listen(config.server.apiporthttps, () => {
//   log.info(`Flux  https listening on port ${config.server.apiporthttps}!`);
// });

app.listen(config.server.apiport, () => {
  log.info(`Flux running on port ${config.server.apiport}!`);
  serviceManager.startFluxFunctions();
});

// Flux Home configuration
const home = path.join(__dirname, './ZelFront/dist');

const homeApp = express();
homeApp.use(compression());
homeApp.use(express.static(home));

homeApp.get('*', (req, res) => {
  res.sendFile(path.join(home, 'index.html'));
});

homeApp.listen(config.server.homeport, () => {
  log.info(`Flux Home running on port ${config.server.homeport}!`);
});
