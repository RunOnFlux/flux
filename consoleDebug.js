process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

/**
 * A global function to be used as a no-operation. See apiServer.js
 * @returns {void}
 */
globalThis.noop = () => { }

/**
 * A global awaitable function to wait for actions. See apiServer.js
 * @param {number} ms Amount of time to sleep for
 * @returns {Promise<void>}
 */
globalThis.sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * A global container for user defined configuration. See apiServer.js
 */
globalThis.userconfig = require('./config/userconfig');

const config = require('config');
const fs = require('fs');
const https = require('https');
const path = require('path');
const hash = require('object-hash');
const { watch } = require('fs/promises');

// Flux requires
let app;
let log;
let socket;
let serviceManager;
let fluxService;
let upnpService;

function requireUncached(module) {
  delete require.cache[require.resolve(module)];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(module);
}

function loadFluxModules(options = {}) {
  const loader = options.invalidateCache ? requireUncached : require;

  app = loader('./ZelBack/src/lib/server');
  log = loader('./ZelBack/src/lib/log');
  socket = loader('./ZelBack/src/lib/socket');
  serviceManager = loader('./ZelBack/src/services/serviceManager');
  fluxService = loader('./ZelBack/src/services/fluxService');
  upnpService = loader('./ZelBack/src/services/upnpService');
}

loadFluxModules();

const apiPort = userconfig.initial.apiport || config.server.apiport;
const apiPortHttps = +apiPort + 1;
const development = userconfig.initial.development || false;
let initialHash = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));

async function loadBranch(branch) {
  const res = await fluxService.getCurrentBranch();
  // if (res.status === 'success' && res.data.message !== branch) {
  //   log.info(`Branch: ${branch} differs from current branch: ${res.data.message}, switching`);
  //   const success = await fluxService.checkoutBranch(branch, { pull: true });
  //   if (success) loadFluxModules({ invalidateCache: true });
  // }
}

// async function loadUpnpIfRequired() {
//   let verifyUpnp = false;
//   let setupUpnp = false;
//   if (userconfig.initial.apiport) {
//     verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
//     if (verifyUpnp) {
//       setupUpnp = await upnpService.setupUPNP(apiPort);
//     }
//   }
//   if ((userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) || userconfig.initial.routerIP) {
//     if (verifyUpnp !== true) {
//       log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to verify support. Shutting down.`);
//       process.exit();
//     }
//     if (setupUpnp !== true) {
//       log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to map to api or home port. Shutting down.`);
//       process.exit();
//     }
//   }
// }

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
        if (userconfig.initial?.apiport) {
          await loadUpnpIfRequired();
        }
        const branch = development ? userconfig.initial.branch || 'development' : 'master';
        await loadBranch(branch);
      }
    }
  } catch (error) {
    log.error(`Error watching files: ${error}`);
  }
}

/**
 *
 * @returns {Promise<string>}
 */
async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }
  const { spawn } = require('node:child_process')


  // const syncthingProcess = spawn(
  //   '/bin/bash',
  //   [],
  //   {
  //     detached: true,
  //     stdio: 'ignore'
  //   }
  // );

  // syncthingProcess.unref();

  log.info(String.raw`


    ___________.__               ________    _________
    \_   _____/|  |  __ _____  __\_____  \  /   _____/
     |    __)  |  | |  |  \  \/  //   |   \ \_____  \
     |     \   |  |_|  |  />    </    |    \/        \
     \___  /   |____/____//__/\_ \_______  /_______  /
         \/                     \/       \/        \/


`);

  console.log("BEAVER")

  log.info(`Running as TTY: ${process.stdout.isTTY}`);
  const branch = development ? userconfig.initial.branch || 'development' : 'master';
  await loadBranch(branch);

  // await loadUpnpIfRequired();

  // store timer
  setInterval(configReload, 2 * 1000);

  const server = app.listen(apiPort, async () => {
    log.info(`Flux listening on port ${apiPort}!`);
    // serviceManager.startFluxFunctions();
    const iteration = 0
    while (true) {
      await sleep(0);
      log.info(`Iteration: ${iteration}`);
    }
  });

  socket.initIO(server);

  try {
    const certExists = fs.existsSync(path.join(__dirname, './certs/v1.key'));
    if (!certExists) {
      const scriptDir = path.join(__dirname, './helpers');
      const scriptPath = path.join(scriptDir, 'createSSLcert.sh');
      await serviceHelper.runCommand(scriptPath, { cwd: scriptDir });
      // const exec = `cd ${nodedpath} && bash createSSLcert.sh`;
      // await cmdAsync(exec);
    }
    const key = fs.readFileSync(path.join(__dirname, './certs/v1.key'), 'utf8');
    const cert = fs.readFileSync(path.join(__dirname, './certs/v1.crt'), 'utf8');
    const credentials = { key, cert };
    const httpsServer = https.createServer(credentials, app);
    httpsServer.listen(apiPortHttps, () => {
      log.info(`Flux https listening on port ${apiPortHttps}!`);
    });
  } catch (error) {
    log.error(error);
  }
  return apiPort;
}

module.exports = {
  initiate,
};

initiate();
