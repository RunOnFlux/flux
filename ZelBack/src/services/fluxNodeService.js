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
const dockerService = require('./dockerService');

const express = require('express');

let server = null;

async function getHostInfo(req, res) {
  try {
    const app = await dockerService.getAppNameByContainerIp(req.socket.remoteAddress);
    if (!app) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      res.json(errMessage);
    } else {
      const hostInfo = {};
      hostInfo.appName = app;
      const nodeCollateralInfo = await generalService.obtainNodeCollateralInformation().catch(() => {
        throw new Error('Host Identifier information not available at the moment');
      });
      hostInfo.id = nodeCollateralInfo.txhash + nodeCollateralInfo.txindex;
      const myIP = await fluxNetworkHelper.getMyFluxIPandPort();
      if (myIP) {
        hostInfo.ip = myIP.split(':')[0];
        const myGeo = await geolocationService.getNodeGeolocation();
        if (myGeo) {
          delete myGeo.ip;
          delete myGeo.org;
          hostInfo.geo = myGeo;
        } else {
          throw new Error('Geolocation information not available at the moment');
        }
      } else {
        throw new Error('Host IP information not available at the moment');
      }

      const message = messageHelper.createDataMessage(hostInfo);
      res.json(message);
    }
  } catch (error) {
    log.error(`getHostInfo: ${error}`);
    const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
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
  app.get('/hostinfo', getHostInfo);
  app.all('*', (_, res) => res.status(404).end());

  const bindAddress = config.server.fluxNodeServiceAddress;
  server = app.listen(16101, bindAddress, () => {
    log.info(`Server listening on port: 16101 address: ${bindAddress}`);
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
