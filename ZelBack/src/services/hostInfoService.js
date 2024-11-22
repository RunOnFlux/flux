/**
 * Service that will be available to all docker apps on the network to get Host information
 * Host Public IP
 * Host Unique Identifier
 * Host Geolocation
 */

const config = require('config');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const geolocationService = require('./geolocationService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const generalService = require('./generalService');

const express = require('express');

let server = null;

async function getHostInfo(req, res) {
  try {
    const hostInfo = {};
    hostInfo.id = await generalService.nodeCollateral();
    const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
    hostInfo.ip = myIP.split(':')[0];
    const myGeo = await geolocationService.getNodeGeolocation();
    if (myGeo) {
      delete myGeo.ip;
      delete myGeo.org;
      hostInfo.geo = JSON.stringify(myGeo);
    } else {
      throw new Error('Geolocation information not available at the moment');
    }
    const message = messageHelper.createSuccessMessage(hostInfo);
    res.json(message);
  } catch (error) {
    log.error(`getHostInfo: ${error}`);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}

function handleError(middleware, req, res, next) {
  // eslint-disable-next-line consistent-return
  middleware(req, res, (err) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      res.statusMessage = err.message;
      return res.sendStatus(400);
    }
    if (err) {
      log.error(err);
      return res.sendStatus(400);
    }

    next();
  });
}

function start() {
  if (server) return;

  const app = express();
  app.use((req, res, next) => {
    handleError(express.json(), req, res, next);
  });
  app.post('/hostinfo', getHostInfo);
  app.all('*', (_, res) => res.status(404).end());

  const bindAddress = config.server.hostInfoServiceAddress;
  server = app.listen(80, bindAddress, () => {
    log.info(`Server listening on port: 80 address: ${bindAddress}`);
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = {
  start,
  stop,
};
