/**
 * @import { MongoClient, Collection } from "mongodb"
 */

globalThis.userconfig = require('./config/userconfig');

if (typeof AbortController === 'undefined') {
  // polyfill for nodeJS 14.18.1 - without having to use experimental features
  // eslint-disable-next-line global-require
  const abortControler = require('node-abort-controller');
  globalThis.AbortController = abortControler.AbortController;
}

process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { watch } = require('node:fs/promises');

const axios = require('axios').default;
const config = require('config');
const hash = require('object-hash');

const fluxServer = require('./ZelBack/src/lib/fluxServer');

const log = require('./ZelBack/src/lib/log');

const dbHelper = require('./ZelBack/src/services/dbHelper');
const serviceManager = require('./ZelBack/src/services/serviceManager');
const serviceHelper = require('./ZelBack/src/services/serviceHelper');
const upnpService = require('./ZelBack/src/services/upnpService');
const requestHistoryStore = require('./ZelBack/src/services/utils/requestHistory');
const fluxRepository = require('./ZelBack/src/services/utils/fluxRepository');

const apiPort = userconfig.initial.apiport || config.server.apiport;
const apiPortHttps = +apiPort + 1;
let initialHash = hash(fs.readFileSync(path.join(__dirname, '/config/userconfig.js')));

let requestHistory = null;
let axiosDefaultsSet = false;

/**
 * The Cacheable. So we only instantiate it once (and for testing)
 */
let cacheable = null;

/**
 * A fairly random way of determining if a node is on the preprod branch or master
 * @returns {boolean}
 */
function isPreProdNode() {
  const chance = Math.random();
  return chance <= config.preProd.probability;
}

/**
 * Throws the dice to see if this node is a preprod node, and stores it in the
 * local mongo state database
 * @param {Collection} col
 * @returns {Promise<boolean>}
 */
async function setPreProdNode(col) {
  const preprodNode = isPreProdNode();

  await col.updateOne(
    { key: 'isPreProd' },
    { $set: { key: 'isPreProd', value: preprodNode } },
    { upsert: true },
  );

  return preprodNode;
}

/**
 * Checks the local mongo state database to see if this node has thrown the dice
 * to see if it is a preprod node within the last daysToNextEval time period.
 * @param {Collection} col
 * @returns {Promise<boolean>}
 */
async function getPreProdNode(col) {
  const result = await col.findOne(
    { key: 'isPreProd' },
    { projection: { value: 1 } },
  );

  if (!result) return null;

  const { value: isPreprod, _id: id } = result;

  const timestamp = new Date(id.getTimestamp());

  timestamp.setDate(timestamp.getDate() + config.preProd.daysToNextEval);

  if (timestamp < new Date()) return null;

  return isPreprod;
}

/**
 * Determines if this is a preprod node or production node.
 * @param {MongoClient} client
 * @returns {Promise<boolean>}
 */
async function getPreProdState(client) {
  const db = client.db('zelfluxlocal');
  const col = db.collection('state');
  col.createIndex({ key: 1 }, { unique: true });

  const preprodNode = await getPreProdNode(col) ?? await setPreProdNode(col);

  return preprodNode;
}

/**
 * Determines if this is a preprod node or production node.
 * @param {MongoClient} client
 * @returns {Promise<boolean>}
 */
async function getPreProdState(client) {
  const db = client.db('zelfluxlocal');
  const col = db.collection('state');
  col.createIndex({ key: 1 }, { unique: true });

  const preprodNode = await getPreProdNode(col) ?? await setPreProdNode(col);

  return preprodNode;
}

/**
 * Chooses either preprod or production branches. Except if the node is on deveop,
 * then nothing happens. If the branch is changed, fluxOS is restarted by Nodemon,
 * if it is running.
 * @param {MongoClient} client
 * @param {string} repoDir
 * @returns {Promise<void>}
 */
async function setProductionBranch(client, repoDir) {
  const { initial: { development, disablePreProd } } = userconfig;
  // Develop nodes take priority over preProd nodes.
  if (development || disablePreProd) return;

  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

  const preprodNode = await getPreProdState(client);

  const logText = preprodNode ? 'pre-production' : 'production';
  log.info(`Fluxnode running in ${logText} mode`);

  const { preProd: { branch, remote } } = config;

  const targetBranch = preprodNode ? branch : 'master';

  const repo = new fluxRepository.FluxRepository({ repoDir });
  const remotes = await repo.remotes();
  const currentBranch = await repo.currentBranch();

  log.info(`Fluxnode on branch: ${currentBranch}`);

  const origin = remotes.find(
    (r) => r.refs.fetch === remote,
  );

  // if we don't find the origin, something is fishy. Maybe git:// scheme, maybe a
  // different origin. Either way, we let it go and continue on whatever branch is set.
  if (!origin) {
    log.warn(`Unable to find remote ref: ${remote} in remotes... skipping preprod setup`);
    return;
  }

  if (currentBranch === targetBranch) return;

  log.info(`Switching from branch: ${currentBranch} to: ${targetBranch}`);

  await repo.switchBranch(targetBranch, {
    remote: origin.name,
    forceClean: true,
    reset: true,
  });

  // nodemon should kill this process within 5 seconds as we've changed files.

  await sleep(10_000);

  // We're still here. Maybe no backend files changed with the branch switch.
  // Lets trigger a restart. We're just updating the file access / modified
  // times - which nodemon sees as files changed.

  const time = new Date();
  const testFile = path.join(repoDir, 'ZelBack/config/default.js');
  await fs.utimes(testFile, time, time).catch(() => { });

  await sleep(10_000);

  // Without knowing for sure what the supervisor is, forking the current process
  // just feels too risky. We just let it go, and continue running on our current branch.

  // We're still here. Doesn't seem like nodemon is running. Lets just fork
  // ourselves then.

  // fork(process.argv[1], { detached: true }).unref();
  // process.exit();
}

function getrequestHistory() {
  return requestHistory;
}

/**
 * Gets the cacheable CacheableLookup() for testing
 */
function getCacheable() {
  return cacheable;
}

/**
 * Gets the cacheable CacheableLookup() for testing
 */
function resetCacheable() {
  cacheable = null;
}

/**
 * Adds extra servers to DNS, if they are not being used already. This is just
 * within the NodeJS process, not systemwide.
 *
 * Sets these globally for both http and https (axios) It will use the OS servers
 * by default, and if they fail, move on to our added servers, if a server fails, requests
 * go to an active server immediately, for a period.
 * @param {Map?} userCache An optional cache, we use this as a reference for testing
 * @returns {Promise<void>}
 */
async function createDnsCache(userCache) {
  try {
    if (cacheable) return;

    const cache = userCache || new Map();

    // we have to dynamic import here as cacheable-lookup only supports ESM.
    const { default: CacheableLookup } = await import('cacheable-lookup');
    cacheable = new CacheableLookup({ maxTtl: 360, cache });

    cacheable.install(http.globalAgent);
    cacheable.install(https.globalAgent);

    const cloudflareDns = '1.1.1.1';
    const googleDns = '8.8.8.8';
    const quad9Dns = '9.9.9.9';

    const backupServers = [cloudflareDns, googleDns, quad9Dns];

    const existingServers = cacheable.servers;

    // it dedupes any servers
    cacheable.servers = [...existingServers, ...backupServers];
  } catch (error) {
    log.error(error);
  }
}

function setAxiosDefaults(socketIoServers) {
  if (axiosDefaultsSet) return;

  axiosDefaultsSet = true;

  log.info('setting axios defaults');
  axios.defaults.timeout = 20_000;

  if (!globalThis.userconfig.initial.debug) return;

  log.info('User defined debug set, setting up socket.io for debug.');
  requestHistory = new requestHistoryStore.RequestHistory({ maxAge: 60_000 * 60 });

  const rooms = [];
  const requestRoom = 'outboundHttp';

  socketIoServers.forEach((server) => {
    const debugRoom = server.getRoom(requestRoom, { namespace: 'debug' });
    rooms.push(debugRoom);

    const debugAdapter = server.getAdapter('debug');
    debugAdapter.on('join-room', (room, id) => {
      if (room !== requestRoom) return;

      const socket = server.getSocketById('debug', id);
      socket.emit('addHistory', requestHistory.allHistory);
    });
  });

  requestHistory.on('requestAdded', (request) => {
    rooms.forEach((room) => room.emit('addRequest', request));
  });

  requestHistory.on('requestRemoved', (request) => {
    rooms.forEach((room) => room.emit('removeRequest', request));
  });

  axios.interceptors.request.use(
    (conf) => {
      const {
        baseURL, url, method, timeout,
      } = conf;

      const fullUrl = baseURL ? `${baseURL}${url}` : url;

      const requestData = {
        url: fullUrl, verb: method.toUpperCase(), timeout, timestamp: Date.now(),
      };
      requestHistory.storeRequest(requestData);

      return conf;
    },
    (error) => Promise.reject(error),
  );
}

async function loadUpnpIfRequired() {
  try {
    let verifyUpnp = false;
    let setupUpnp = false;
    if (userconfig.initial.apiport) {
      verifyUpnp = await upnpService.verifyUPNPsupport(apiPort);
      if (verifyUpnp) {
        setupUpnp = await upnpService.setupUPNP(apiPort);
      }
    }
    if ((userconfig.initial.apiport && userconfig.initial.apiport !== config.server.apiport) || userconfig.initial.routerIP) {
      if (verifyUpnp !== true) {
        log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to verify support. Shutting down.`);
        process.exit();
      }
      if (setupUpnp !== true) {
        log.error(`Flux port ${userconfig.initial.apiport} specified but UPnP failed to map to api or home port. Shutting down.`);
        process.exit();
      }
    }
  } catch (error) {
    log.error(error);
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
        if (userconfig?.initial?.apiport) {
          await loadUpnpIfRequired();
        }
      }
    }
  } catch (error) {
    log.error(`Error watching files: ${error}`);
  }
}

/**
 * Main entrypoint
 *
 * @returns {Promise<String>}
 */

async function initiate() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }

  process.on('uncaughtException', (err) => {
    // the express server port in use is uncatchable for some reason
    // remove this in future
    if (err.code === 'EADDRINUSE') {
      log.error('Flux api server port in use, shutting down.');
      // if shutting down clean, nodemon won't restart
      process.exit();
    }

    log.error(err);
    process.exit(1);
  });

  const appRoot = process.cwd();

  const dbClient = await dbHelper.initiateDB().catch(() => null);

  if (dbClient) await setProductionBranch(dbClient, appRoot);

  await createDnsCache();

  await loadUpnpIfRequired();

  setInterval(async () => {
    configReload();
  }, 2 * 1000);

  // ToDo: move this to async
  const certExists = fs.existsSync(path.join(appRoot, 'certs/v1.key'));

  if (!certExists) {
    const cwd = path.join(appRoot, 'helpers');
    const scriptPath = path.join(cwd, 'createSSLcert.sh');
    await serviceHelper.runCommand(scriptPath, { cwd });
  }

  // ToDo: move these to async
  const key = fs.readFileSync(path.join(appRoot, 'certs/v1.key'), 'utf8');
  const cert = fs.readFileSync(path.join(appRoot, 'certs/v1.crt'), 'utf8');

  const httpServer = new fluxServer.FluxServer();
  const httpsServer = new fluxServer.FluxServer({
    mode: 'https', key, cert, expressApp: httpServer.app,
  });

  await httpServer.listen(apiPort);
  log.info(`Flux listening on port ${apiPort}!`);

  await httpsServer.listen(apiPortHttps);
  log.info(`Flux https listening on port ${apiPortHttps}!`);

  setAxiosDefaults([httpServer.socketIo, httpsServer.socketIo]);

  serviceManager.startFluxFunctions();

  return apiPort;
}

if (require.main === module) {
  initiate();
}

module.exports = {
  createDnsCache,
  getCacheable,
  getrequestHistory,
  initiate,
  resetCacheable,
};
