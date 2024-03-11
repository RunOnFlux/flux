const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs/promises');

const app = require('../lib/server');
const log = require('../lib/log');
const socket = require('../lib/socket');
const serviceManager = require('../services/serviceManager');
const upnpService = require('../services/upnpService');

// Api servers
let httpServer;
let tlsServer;
let currentPort;

async function loadUpnp(port, validate) {
  let upnpSetup = false;

  const upnpVerified = await upnpService.verifyUPNPsupport(port);
  if (upnpVerified) {
    upnpSetup = await upnpService.setupUPNP(port);
  }

  if (!validate) return;

  if (!upnpVerified) {
    log.error(`Flux port ${port} specified but UPnP failed to verify support. Shutting down.`);
    process.exit();
  }
  if (!upnpSetup) {
    log.error(`Flux port ${port} specified but UPnP failed to map to api or home port. Shutting down.`);
    process.exit();
  }
}

async function runServer(port, options = {}) {
  if (options.https) {
    const appRoot = path.join(__dirname, '../../../');
    const keyPath = path.join(appRoot, 'certs/v1.key');

    await fs.stat(keyPath).catch(async () => {
      const scriptDir = path.join(appRoot, 'helpers');
      const scriptPath = path.join(scriptDir, 'createSSLcert.sh');
      await serviceHelper.runCommand(scriptPath, { cwd: scriptDir });
    })

    const key = await fs.readFile(path.join(appRoot, 'certs/v1.key'), 'utf8');
    const cert = await fs.readFile(path.join(appRoot, 'certs/v1.crt'), 'utf8');
    const credentials = { key, cert };
    tlsServer = https.createServer(credentials, app);
    tlsServer.listen(port, () => {
      log.info(`Flux HTTPS server listening on port: ${port}`);
    });
    tlsServer.on('error', async (err) => {
      log.error(err);
      await tlsServer.close();
      // retry
    })
    return;
  }

  httpServer = app.listen(port, () => {
    log.info(`Flux HTTP server listening on port: ${port}`);
    currentPort = port;
    socket.initIO(httpServer);
    serviceManager.startFluxFunctions();
  });

  httpServer.on('error', async (err) => {
    log.error(err);
    await httpServer.close();
    // retry
  })
}

async function reload(port, options = {}) {
  if (port === currentPort && !options.force) return;

  if (httpServer) await httpServer.close();
  if (tlsServer) await tlsServer.close();

  await runServer(port);
  await runServer(port + 1, { https: true })
}

/**
 *
 * @returns {Promise<String>}
 */
async function initiate(apiPort, options = {}) {
  const testUpnp = options.testUpnp || false;
  const validateUpnp = options.validateUpnp || false;
  const reload = options.reload || false;

  if (httpServer && !options.reload) return;

  // figure out if the api servers need to e reloaded?!?

  if (testUpnp) await loadUpnp(apiPort, validateUpnp);

  if (reload) {
    reload(apiPort);
  } else {
    await runServer(apiPort);
    await runServer(apiPort + 1, { https: true })
  }
}

module.exports = {
  initiate,
  reload,
};

// testing
if (!module.parent) initiate(16187, { testUpnp: true });
