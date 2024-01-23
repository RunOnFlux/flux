/* global userconfig */
global.userconfig = require('./config/userconfig');

process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux configuration
const config = require('config');
const fs = require('fs');
const https = require('https');
const path = require('path');
const util = require('util');
const nodecmd = require('node-cmd');
const app = require('./ZelBack/src/lib/server');
const log = require('./ZelBack/src/lib/log');
const socket = require('./ZelBack/src/lib/socket');
const serviceManager = require('./ZelBack/src/services/serviceManager');
const upnpService = require('./ZelBack/src/services/upnpService');
const hash = require('object-hash');
const { watch } = require('fs/promises');
const { startGossipServer, getApiPort } = require('./ZelBack/src/services/fluxportControllerService')

const cmdAsync = util.promisify(nodecmd.get);

let initialHash = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));

function validateTags() {
  const tags = userconfig.initial.tags || {};

  if (tags && !(typeof tags === 'object' || tags instanceof Object)) {
    log.error("Error tags must be a mapping with string keys and values as string, number or boolean");
    process.exit();
  }

  for (const [key, value] of Object.entries(tags)) {
    const valuePassed =
      typeof value === 'string' || value instanceof String
      || typeof value === 'number' || value instanceof Number
      || typeof value === 'boolean' || value instanceof Boolean

    if (!key instanceof string && !valuePassed) {
      log.error("Error tags must be a mapping with string keys and values as string, number or boolean");
      process.exit();
    }
  }
  return tags
}

async function SetupPortsUpnpAndComputed() {
  userconfig.computed = {};

  const tags = validateTags();

  const autoUpnp = userconfig.initial.upnp || false;
  const homeDirPath = path.join(__dirname, "../");

  const newBenchmarkPath = path.join(homeDirPath, '.fluxbenchmark');
  const oldBenchmarkPath = path.join(homeDirPath, '.zelbenchmark');
  const isNewBenchPath = fs.existsSync(newBenchmarkPath)

  const benchmarkPath = isNewBenchPath ? newBenchmarkPath : oldBenchmarkPath
  const benchmarkFile = isNewBenchPath ? "fluxbench.conf" : "zelbench.conf"
  const benchmarkConfigFilePath = path.join(benchmarkPath, benchmarkFile);

  userconfig.computed.benchmarkConfigFilePath = benchmarkConfigFilePath;
  userconfig.computed.benchmarkPath = benchmarkPath;
  userconfig.computed.homeDirPath = homeDirPath;
  userconfig.computed.appRootPath = __dirname;
  userconfig.computed.isNewBenchPath = isNewBenchPath;

  userconfig.computed.tags = tags;

  apiPort = await waitForApiPort(autoUpnp);

  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }

  userconfig.computed.homePort = apiPort - 1;
  userconfig.computed.apiPort = apiPort;
  userconfig.computed.apiPortSsl = apiPort + 1;
  userconfig.computed.syncthingPort = apiPort + 2;

  await loadUpnpIfRequired(autoUpnp);
}

async function waitForApiPort(autoUpnp) {
  if (!autoUpnp) {
    // if initial is undefined or empty string, user server.apiport
    return +userconfig.initial.apiport || +config.server.apiport;
  }

  if (await startGossipServer()) {
    return await getApiPort();
  } else {
    log.error("Error starting GossipServer for autoUPnP. Shutting down");
    process.exit();
  }
}

async function loadUpnpIfRequired(autoUpnp) {
  let verifyUpnp = false;
  let setupUpnp = false;
  if (autoUpnp || userconfig.initial.apiport) {
    verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
    if (verifyUpnp) {
      setupUpnp = await upnpService.setupUPNP(apiPort);
    }
  }
  if (autoUpnp || userconfig.initial.routerIP || (userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport)) {
    if (verifyUpnp !== true) {
      log.error(`Flux port ${apiPort} specified but UPnP failed to verify support. Shutting down.`);
      process.exit();
    }
    if (setupUpnp !== true) {
      log.error(`Flux port ${apiPort} specified but UPnP failed to map to api or home port. Shutting down.`);
      process.exit();
    }
  }
}

async function configReload() {
  try {
    const watcher = watch(path.join(__dirname, '/config'));
    // eslint-disable-next-line
    for await (const event of watcher) {
      if (event.eventType === 'change' && event.filename === 'userconfig.js') {
        const hashCurrent = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));
        if (hashCurrent === initialHash) {
          return;
        }
        initialHash = hashCurrent;
        log.info(`Config file changed, reloading ${event.filename}...`);
        delete require.cache[require.resolve('./config/userconfig')];
        // eslint-disable-next-line
        userconfig = require('./config/userconfig');
        await SetupPortsUpnpAndComputed();
      }
    }
  } catch (error) {
    log.error(`Error watching files: ${error}`);
  }
}

/**
 *
 * @returns {Promise<void>}
 */
async function initiate() {
  await SetupPortsUpnpAndComputed();

  setInterval(async () => {
    configReload();
  }, 2 * 1000);

  const server = app.listen(apiPort, () => {
    log.info(`Flux listening on port ${apiPort}!`);
    serviceManager.startFluxFunctions();
  });

  socket.initIO(server);

  try {
    const certExists = fs.existsSync(path.join(__dirname, './certs/v1.key'));
    if (!certExists) {
      const nodedpath = path.join(__dirname, './helpers');
      const exec = `cd ${nodedpath} && bash createSSLcert.sh`;
      await cmdAsync(exec);
    }
    const key = fs.readFileSync(path.join(__dirname, './certs/v1.key'), 'utf8');
    const cert = fs.readFileSync(path.join(__dirname, './certs/v1.crt'), 'utf8');
    const credentials = { key, cert };
    const httpsServer = https.createServer(credentials, app);
    const apiPortSsl = userconfig.computed.apiPortSsl
    httpsServer.listen(apiPortSsl, () => {
      log.info(`Flux https listening on port ${apiPortSsl}!`);
    });
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  initiate,
};
