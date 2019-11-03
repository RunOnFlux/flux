// ZelBack configuration
const config = require('config');
const path = require('path');
const express = require('express');
const app = require('./ZelBack/src/lib/server.js');
const log = require('./ZelBack/src/lib/log');
const communication = require('./ZelBack/src/services/zelfluxCommunication');

app.listen(config.server.apiport, () => {
  log.info(`ZelBack running on port ${config.server.apiport}!`);
  communication.fluxDisovery();
  log.info('Flux Discovery started');
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
