// ZelBack configuration
const config = require('config');
const fs = require('fs');
const https = require('https');
const path = require('path');
const express = require('express');
const app = require('./ZelBack/src/lib/server.js');
const log = require('./ZelBack/src/lib/log');
const communication = require('./ZelBack/src/services/zelfluxCommunication');

const key = fs.readFileSync(path.join(__dirname, './certs/selfsigned.key'), 'utf8');
const cert = fs.readFileSync(path.join(__dirname, './certs/selfsigned.crt'), 'utf8');
const credentials = { key, cert };
const httpsServer = https.createServer(credentials, app);

httpsServer.listen(config.server.apiporthttps, () => {
  log.info(`ZelBack https listening on port ${config.server.apiporthttps}!`);
});

app.listen(config.server.apiport, () => {
  log.info(`ZelBack running on port ${config.server.apiport}!`);
  communication.startFluxFunctions();
});

// ZelFront configuration
const zelfront = path.join(__dirname, './ZelFront/dist');

const ZelFrontApp = express();
ZelFrontApp.use(express.static(zelfront));

ZelFrontApp.get('*', (req, res) => {
  res.sendFile(path.join(zelfront, 'index.html'));
});

ZelFrontApp.listen(config.server.zelfrontport, () => {
  log.info(`ZelFront running on port ${config.server.zelfrontport}!`);
});
