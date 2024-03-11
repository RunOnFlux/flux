/**
 * A global function to be used as a no-operation. See app.js
 * @returns {void}
 */
globalThis.noop = () => { };

/**
 * A global awaitable function to wait for actions. See app.js
 * @param {number} ms Amount of time to sleep for
 * @returns {Promise<void>}
 */
globalThis.sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * A global container for user defined configuration. See app.js
 */
globalThis.userconfig = require('./config/userconfig');

process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

const fs = require('fs/promises');
const { parseArgs } = require('node:util');
const path = require('node:path');
const { spawn } = require('node:child_process');

const config = require('config');
const hash = require('object-hash');

const api = require('./ZelBack/src/entrypoints/api');
const gui = require('./ZelBack/src/entrypoints/gui');
const fluxService = require('./ZelBack/src/services/fluxService');
const log = require('./ZelBack/src/lib/log');

let apiPort = +userconfig.initial.apiport || +config.server.apiport;
let development = userconfig.initial.development || false;
let initialHash = '';
let configReloadTimer;

const options = {
  'api-only': {
    type: 'boolean',
    short: 'a',
    default: false
  },
  'gui-only': {
    type: 'boolean',
    short: 'g',
    default: false
  },
  'force-stdout': {
    type: 'boolean',
    short: 'f',
    default: false
  },
};

function requireUncached(module) {
  delete require.cache[require.resolve(module)];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(module);
}

function loadFluxModules(options = {}) {
  // store the module names in a map or something. Figure out what modules have chagned
  // then reload those ones. Hash each module.
  requireUncached('./ZelBack/src/lib/server');
  requireUncached('./ZelBack/src/lib/log');
  requireUncached('./ZelBack/src/lib/socket');
  requireUncached('./ZelBack/src/services/serviceManager');
  requireUncached('./ZelBack/src/services/fluxService');
  requireUncached('./ZelBack/src/services/upnpService');
}

async function loadBranch(branch) {
  const res = await fluxService.getCurrentBranch();
  if (res.status === 'success' && res.data.message !== branch) {
    log.info(`Branch: ${branch} differs from current branch: ${res.data.message}, switching`);
    const success = await fluxService.checkoutBranch(branch, { pull: true });
    // if (success) loadFluxModules({ invalidateCache: true });
    // don't need this anymore... it will get caught by the fs watche (that we make)r?!?
  }
}

async function configReload() {
  // fix this
  try {
    const watcher = fs.watch(path.join(__dirname, '/config'));
    // eslint-disable-next-line
    for await (const event of watcher) {
      if (event.eventType === 'change' && event.filename === 'userconfig.js') {
        const hashCurrent = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));

        if (hashCurrent === initialHash) return;

        initialHash = hashCurrent;
        log.info(`Config file changed, reloading ${event.filename}...`);
        delete require.cache[require.resolve('./config/userconfig')];
        // eslint-disable-next-line
        userconfig = require('./config/userconfig');

        // const branch = development ? userconfig.initial.branch || 'development' : 'master';
        // this needs thought / work
        // await loadBranch(branch);
        api.reload();
        gui.reload();
      }
    }
  } catch (error) {
    log.error(`Error watching files: ${error}`);
  }
}

function restart() {
  // figure out if this makes sense
  spawn(process.argv[1], process.argv.slice(2), {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).unref()
  process.exit();
}

async function initiate() {
  // process.on('SIGINT') stops working after a minute or so?!?
  // whereas this doesn't
  function sigintListener(data) {
    // CTRL+C
    if (data.toString() === '\x03') {
      log.info('SIGINT detected, bailing');
      process.exit();
    }
  }

  process.stdin.on('data', sigintListener);

  // temp debug
  // setInterval(() => log.info('Stdin listeners:', process.stdin.listeners('data')), 10000)

  log.info(String.raw`


    ___________.__               ________    _________
    \_   _____/|  |  __ _____  __\_____  \  /   _____/
     |    __)  |  | |  |  \  \/  //   |   \ \_____  \
     |     \   |  |_|  |  />    </    |    \/        \
     \___  /   |____/____//__/\_ \_______  /_______  /
         \/                     \/       \/        \/


`)

  log.info(`Running as TTY: ${process.stdout.isTTY}`);

  const args = process.argv.slice(2);
  const {
    values: userOptions,
    _, // positional
  } = parseArgs({ args, options, strict: false });

  if (userOptions['gui-only'] && userOptions['api-only']) {
    log.error('Both gui-only and api-only cannot be set.');
    process.exit();
  }

  if (!config.server.allowedPorts.includes(apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }

  // const branch = development ? userconfig.initial.branch || 'development' : 'master';
  // await loadBranch(branch);

  const toHash = await fs.readFile(path.join(__dirname, '/config/userconfig.js'));
  initialHash = hash(toHash);

  let reload = true;
  if (!configReloadTimer) {
    reload = false;
    configReloadTimer = setInterval(configReload, 2 * 1000);
  }

  const testUpnp = Boolean(userconfig.initial.apiport);
  const validateUpnp = Boolean(
    (testUpnp && userconfig.initial.apiport !== config.server.apiport) ||
    userconfig.initial.routerIP
  );

  if (!userOptions['gui-only']) api.initiate(apiPort, { testUpnp, validateUpnp, reload });
  if (!userOptions['api-only']) gui.initiate(apiPort - 1, { reload });
}

initiate();
