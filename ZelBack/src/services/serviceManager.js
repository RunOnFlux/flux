/* global userconfig */
const config = require('config');
const log = require('../lib/log');

const dbHelper = require('./dbHelper');
const explorerService = require('./explorerService');
const fluxCommunication = require('./fluxCommunication');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const appsService = require('./appsService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const fluxService = require('./fluxService');
const geolocationService = require('./geolocationService');
const upnpService = require('./upnpService');
const syncthingService = require('./syncthingService');
const pgpService = require('./pgpService');
const dockerService = require('./dockerService');
const backupRestoreService = require('./backupRestoreService');
const serviceHelper = require('./serviceHelper');
var crypto = require("crypto");

const apiPort = userconfig.initial.apiport || config.server.apiport;
const development = userconfig.initial.development || false;

const intervalTimers = new Map();
const timeoutTimers = new Map();

const delayedActions = new Map(
  [
    [geolocationService.setNodeGeolocation, "90s"],
    // wait as of restarts due to ui building
    [explorerService.initiateBlockProcessor, { schedule: "2m", logMsg: 'Flux Block Processing Service started' }],
    [appsService.checkMyAppsAvailability, "3m"],
    [appsService.syncthingApps, "3m"],
    // stop and starts apps using syncthing g: when a new master is required or was changed.
    [appsService.masterSlaveApps, "3m30s"],
    [appsService.checkStorageSpaceForApps, "20m"],
    // after 125 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
    // 125 minutes should give enough time for node receive currently two times the apprunning messages
    [appsService.trySpawningGlobalApplication, "2h5m", { logMsg: 'Starting to spawn applications' }],
  ],
);

const recurringActions = new Map(
  [
    [fluxCommunication.pingAllPeers, { schedule: "15s", logMsg: 'Connections polling prepared' }],
    [daemonServiceMiscRpcs.fluxDaemonBlockchainInfo, { runImmediate: true, schedule: "1m", logMsg: 'Flux Daemon Info Service Started' }],
    // the branch changing stuff happens on config change now - this still needs work
    [fluxService.softUpdateFlux, { schedule: "1m", condition: development === true || development === 'true' || development === 1 || development === '1' }],
    // this waits for updateDeterministicFluxList to finish it's first run (run immediate awaits the first iteration)
    [fluxCommunicationUtils.updateDeterministicFluxList, { runImmediate: true, schedule: "2m", }],
    [appsService.restorePortsSupport, { schedule: "10m" }],
    [backupRestoreService.cleanLocalBackup, { schedule: "25m" }],
    [appsService.continuousFluxAppHashesCheck, { schedule: "30m", afterDelay: randomMsBetween("15m", "30m") }],
    // UPnP has already been verified and setup
    [upnpService.adjustFirewallForUPNP, { schedule: "1h", condition: upnpService.isUPNP() }],
    // first broadcast after 4m of starting fluxos (not really, could base off uptime?)
    [appsService.checkAndNotifyPeersOfRunningApps, { schedule: "1g", afterDelay: "4m" }],
    [appsService.checkApplicationsCompliance, { schedule: "1h" }],
    [appsService.forceAppRemovals, { schedule: "1d", afterDelay: "30m" }],
  ]
)

/**
 *  Parse a human readable time string into milliseconds, for timers
 * @param {number|string} userInterval the time period to parse. In the format
 * ```<amount of time>[<unit of time>]+``` For example:
 * ```
 *   200  = 200 milliseconds
 *   15s  = 15 seconds
 *   2m   = 2 minutes
 *   4h   = 4 hours
 *   1d   = 1 day
 *
 *   3m30s   = 3 minutes 30 seconds
 *   1h30m    = 1 hour 30 minutes
 *   1d8h30m5s  = 1 day 8 hours 30 minutes 5 seconds
 * ```
 * @returns number milliseconds
 */
function parseInterval(userInterval) {
  // if only numbers are provided, we assume they are ms
  if (/^\d+$/.test(userInterval)) return userInterval;

  // allows unlimited numbers followed by zero or one of of sSmMhHdD, then allows unlimited repeating of the
  // previous match, except that if a number is provided, it must be followed with one of sSmMhHdD.
  if (!/^[0-9]+[s|S|m|M|h|H|d|D]?(?:[0-9]+[s|S|m|M|h|H|d|D]+)*$/.test(userInterval)) return 0;

  const intervalAsArray = userInterval.match(/[0-9]+|[a-zA-Z]+/g);
  // this should always be true because of the middle regex
  if (intervalAsArray.length % 2 !== 0) return 0;

  let ms = 0;
  // iterate of the array objects as pairs
  for (let i = 0; i < intervalAsArray.length; i += 2) {
    const measure = intervalAsArray[i];
    const unit = intervalAsArray[i + 1];

    switch (unit.toLowerCase()) {
      case "s":
        ms += measure * 1000;
        break;
      case "m":
        ms += measure * 1000 * 60;
        break;
      case "h":
        ms += measure * 1000 * 3600;
        break
      case "d":
        ms += measure * 1000 * 86400;
    }
  }
  return ms;
}

/**
 * Generates a random amount of milliseconds between two human
 * readable strings.
 *
 * I.e. 15m and 30m Would return an amount of ms somewhere between
 * 15 minutes and 30 minutes.
 * @param {string|number} minInterval Human readable time string
 * @param {string|number} maxInterval Human readable time string
 * @returns number milliseconds
 */
async function randomMsBetween(minInterval, maxInterval) {
  if (minInterval > maxInterval) [minInterval, maxInterval] = [maxInterval, minInterval];

  const min = parseInterval(minInterval);
  const max = parseInterval(maxInterval);
  const interval = (Math.floor(Math.random() * (max - min + 1)) + min);
  return interval;
}

/**
 *
 * @param {string|number} interval
 * @param {Function} callable
 * @param {SetInterval|SetTimeout} method
 * @param {Map<string, NodeJS.timer>} timer
 * @param {{runImmediate?: Boolean, afterDelay?: number, logMsg?: string}} options
 * @returns {Promise<Boolean>} If the callback will run
 */
async function runTimedCallback(interval, callable, method, timer, options = {}) {
  if (!(callable instanceof Function)) return false

  const name = callable.name || crypto.randomBytes(8).toString('hex');
  const delay = options.afterDelay ? parseInterval(options.afterDelay) : 0;

  const ms = parseInterval(interval);

  // unparseable
  if (!ms) return false;

  // I believe it makes sense to await this
  if (options.runImmediate) await callable();

  const callback = () => {
    timer.delete(name);
    // only runEvery has delay option
    if (delay) timeoutTimers.delete(name)
    callable();
  }

  const run = async () => {
    if (delay) await callable();
    timer.set(name, method(callback, ms));
  }
  // only runEvery gets option to delay
  if (delay) {
    timeoutTimers.set(name, setTimeout(run, delay));
  } else {
    run();
  }

  if (options.logMsg) log.info(options.logMsg);

  return true;
}

async function runAfter(interval, callable, options = {}) {
  const filterdOptions = options.logMsg ? { logMsg: options.logMsg } : {}
  return await runTimedCallback(interval, callable, setTimeout, timeoutTimers, filterdOptions);
}

/**
 * @param {string | number} interval Human readable interval, i.e. 10s, 30m, 2h, 1d
 * @param {function} callable The function you want to run
 * @param {{runImmediate?: Boolean, runAfterDelay?: number}} options Optional parameters
 * @returns {Promise<Boolean>}
 */
async function runEvery(interval, callable, options = {}) {
  return await runTimedCallback(interval, callable, setInterval, intervalTimers, options);
}

async function cleanDatabases() {
  log.info('Initiating MongoDB connection');
  await dbHelper.initiateDB(); // either true or throws error
  log.info('DB connected');
  log.info('Preparing local database...');
  const db = dbHelper.databaseConnection();
  const database = db.db(config.database.local.database);
  await dbHelper.dropCollection(database, config.database.local.collections.loggedUsers).catch((error) => { // drop currently logged users
    if (error.message !== 'ns not found') {
      log.error(error);
    }
  });
  await dbHelper.dropCollection(database, config.database.local.collections.activeLoginPhrases).catch((error) => {
    if (error.message !== 'ns not found') {
      log.error(error);
    }
  });
  await dbHelper.dropCollection(database, config.database.local.collections.activeSignatures).catch((error) => {
    if (error.message !== 'ns not found') {
      log.error(error);
    }
  });
  await database.collection(config.database.local.collections.loggedUsers).createIndex({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 }); // 2days
  await database.collection(config.database.local.collections.activeLoginPhrases).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
  await database.collection(config.database.local.collections.activeSignatures).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
  log.info('Local database prepared');
  log.info('Preparing temporary database...');
  // no need to drop temporary messages
  const databaseTemp = db.db(config.database.appsglobal.database);
  await databaseTemp.collection(config.database.appsglobal.collections.appsTemporaryMessages).createIndex({ receivedAt: 1 }, { expireAfterSeconds: 3600 }); // todo longer time? dropIndexes()
  log.info('Temporary database prepared');
  log.info('Preparing Flux Apps locations');
  await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).dropIndex({ broadcastedAt: 1 }).catch(() => { console.log('Welcome to FluxOS'); }); // drop old index or display message for new installations
  // more than 2 hours and 5m. Meaning we have not received status message for a long time. So that node is no longer on a network or app is down.
  await databaseTemp.collection(config.database.appsglobal.collections.appsLocations).createIndex({ broadcastedAt: 1 }, { expireAfterSeconds: 7500 });
  log.info('Flux Apps locations prepared');
}

/**
 * To start FluxOS. A series of checks are performed on port and UPnP (Universal Plug and Play) support and mapping. Database connections are established. The other relevant functions required to start FluxOS services are called.
 */
async function startFluxFunctions() {
  if (!config.server.allowedPorts.includes(+apiPort)) {
    log.error(`Flux port ${apiPort} is not supported. Shutting down.`);
    process.exit();
  }

  try {
    await cleanDatabases();

    // this does not check apt-cache but will log error if not exist
    await serviceHelper.installAptPackage('netcat-openbsd');

    log.info('Checking docker log for corruption...');
    await dockerService.dockerLogsFix();

    // move this from script to use Dockerode
    await fluxService.installFluxWatchTower();

    await fluxNetworkHelper.adjustFirewall();
    log.info('Firewalls checked');

    await fluxNetworkHelper.allowNodeToBindPrivilegedPorts();
    log.info('Node allowed to bind privileged ports');

    // check what is going on here, this needs refactored, no need to be recursive
    await fluxNetworkHelper.checkDeterministicNodesCollisions();
    log.info('Flux checks operational');

    // this is broken. needs refactoring
    syncthingService.startSyncthing();
    log.info('Syncthing service started');

    await pgpService.generateIdentity();
    log.info('PGP service initiated');

    await fluxNetworkHelper.purgeUFW();
    log.info('Firewall purged');

    await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable();
    log.info('Docker to host firewall enabled');

    // what is the point of this? if it fails it just keeps going
    await appsService.testAppMount(); // test if our node can mount a volume
    log.info("Test volume mount completed")

    await appsService.stopAllNonFluxRunningApps();
    log.info("All non Flux apps stopped");

    await appsService.startMonitoringOfApps();
    log.info("App monitoring has begun");

    // can't wait on this right now - if a port fails it waits 3 minutes
    // figure out better solution
    appsService.restoreAppsPortsSupport();

    // don't await this... needs to be refactored completely
    fluxCommunication.connectToPeers();
    log.info('Flux peer connections initiated');

    for (const [action, options] of delayedActions.entries()) {
      const delay = typeof options === 'string' ? options : options.schedule;
      const { schedule: _, ...filteredOptions } = typeof options === 'string' ? {} : options;
      await runAfter(delay, action, filteredOptions);
    }

    for (const [action, options] of recurringActions.entries()) {
      if (options.condition === false) continue;
      const { schedule, ...filteredOptions } = options;
      await runEvery(schedule, action, filteredOptions);
    }
  } catch (e) {
    log.error(e);
    setTimeout(() => {
      startFluxFunctions();
    }, 15000);
  }
}

// this doesn't stop the recursive functions. Work in progress.
// Need to change them to while loop, and set a trigger / signal
async function stopFluxFunctions() {
  for (const timer of timeoutTimers.values()) {
    clearTimeout(timer);
  }
  timeoutTimers.clear();

  for (const timer of intervalTimers.values()) {
    clearInterval(timer)
  }
  intervalTimers.clear();

  await explorerService.stopBlockProcessing();
}

module.exports = {
  startFluxFunctions,
  stopFluxFunctions,
};
