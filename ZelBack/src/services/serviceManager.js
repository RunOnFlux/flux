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
const crypto = require('crypto');
const util = require('util');
const exec = util.promisify(require('node:child_process').exec);

const INSPECT_OPTIONS = { showHidden: false, depth: null, colors: true }
const { inspect } = require('node:util');

const apiPort = userconfig.initial.apiport || config.server.apiport;
const development = userconfig.initial.development || false;

const intervalTimers = new Map();
const timeoutTimers = new Map();

const delayedActions = new Map(
  [
    [fluxCommunication.startPeerConnectionSentinel, { schedule: '30s', logMsg: 'Flux peer connections initiated' }],
    [geolocationService.setNodeGeolocation, '90s'],
    // wait as of restarts due to ui building
    [explorerService.startBlockProcessor, { schedule: '2m', logMsg: 'Flux Block Processing Service started' }],
    [appsService.checkMyAppsAvailability, '3m'],
    [appsService.syncthingApps, '3m'],
    // stop and starts apps using syncthing g: when a new master is required or was changed.
    [appsService.masterSlaveApps, '3m30s'],
    [appsService.checkStorageSpaceForApps, '20m'],
    // after 125 minutes of running ok and to make sure we are connected for enough time for receiving all apps running on other nodes
    // 125 minutes should give enough time for node receive currently two times the apprunning messages
    [appsService.trySpawningGlobalApplication, '2h5m', { logMsg: 'Starting to spawn applications' }],
  ],
);

const recurringActions = new Map(
  [
    [fluxCommunication.pingAllPeers, { schedule: '15s', logMsg: 'Connections polling prepared' }],
    [daemonServiceMiscRpcs.fluxDaemonBlockchainInfo, { runImmediate: true, schedule: '1m', logMsg: 'Flux Daemon Info Service Started' }],
    // the branch changing stuff happens on config change now - this still needs work
    [fluxService.softUpdateFlux, { schedule: '1m', condition: development === true || development === 'true' || development === 1 || development === '1' }],
    // this waits for updateDeterministicFluxList to finish it's first run (run immediate awaits the first iteration)
    [fluxCommunicationUtils.updateDeterministicFluxList, { runImmediate: true, schedule: '2m' }],
    [appsService.openRequiredPortsToInternet, { schedule: '10m' }],
    [backupRestoreService.cleanLocalBackup, { schedule: '25m' }],
    [appsService.continuousFluxAppHashesCheck, { schedule: '30m', afterDelay: serviceHelper.randomMsBetween('15m', '30m') }],
    // UPnP has already been verified and setup
    [upnpService.adjustFirewallForUPNP, { schedule: '1h', condition: upnpService.isUPNP() }],
    // first broadcast after 4m of starting fluxos (not really, could base off uptime?)
    [appsService.checkAndNotifyPeersOfRunningApps, { schedule: '1h', afterDelay: '4m' }],
    [appsService.checkApplicationsCompliance, { schedule: '1h' }],
    [appsService.forceAppRemovals, { schedule: '1d', afterDelay: '30m' }],
  ],
);

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
  if (!(callable instanceof Function)) return false;

  if (parseInt(interval, 10) === 0) return false;

  const name = callable.name || crypto.randomBytes(8).toString('hex');
  const delay = options.afterDelay ? serviceHelper.parseInterval(options.afterDelay) : 0;

  const ms = serviceHelper.parseInterval(interval);

  // unparseable
  if (!ms) return false;

  // I believe it makes sense to await this
  if (options.runImmediate) await callable();

  const callback = () => {
    if (method.name === 'setTimeout') timer.delete(name);
    callable();
  };

  const run = async () => {
    if (delay) {
      timeoutTimers.delete(name);
      await callable();
    }
    timer.set(name, method(callback, ms));
  };

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
  const filterdOptions = options.logMsg ? { logMsg: options.logMsg } : {};
  return runTimedCallback(interval, callable, setTimeout, timeoutTimers, filterdOptions);
}

/**
 * @param {string | number} interval Human readable interval, i.e. 10s, 30m, 2h, 1d
 * @param {function} callable The function you want to run
 * @param {{runImmediate?: Boolean, runAfterDelay?: number}} options Optional parameters
 * @returns {Promise<Boolean>}
 */
async function runEvery(interval, callable, options = {}) {
  return runTimedCallback(interval, callable, setInterval, intervalTimers, options);
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

    await fluxNetworkHelper.purgeUFW();
    log.info('Firewall purged');

    await fluxNetworkHelper.adjustFirewall();
    log.info('Firewalls checked');

    await pgpService.generateIdentity();
    log.info('PGP service initiated');

    await fluxNetworkHelper.allowNodeToBindPrivilegedPorts();
    log.info('Node allowed to bind privileged ports');

    const fluxNetworkInterfaces = await dockerService.getFluxDockerNetworkPhysicalInterfaceNames();
    await fluxNetworkHelper.removeDockerContainerAccessToNonRoutable(fluxNetworkInterfaces);
    log.info('Docker to host firewall enabled');

    // what is the point of this? if it fails it just keeps going
    await appsService.testAppMount(); // test if our node can mount a volume
    log.info('Test volume mount completed');

    // update this - it's running every 2 hours, control that here
    await appsService.stopAllNonFluxRunningApps();
    log.info('All non Flux apps stopped');

    // // this is usually an empty array
    const unreachableApps = await appsService.openAppsPortsToInternet();
    // this should be interruptable with global abortController
    appsService.forceAppsRemoval(unreachableApps);

    setInterval(() => {
      log.info(`Intervals running: ${inspect(intervalTimers.keys(), INSPECT_OPTIONS)}`);
      log.info(`Timeouts running: ${inspect(timeoutTimers.keys(), INSPECT_OPTIONS)}`);
      const uptime = process.uptime()
      const formattedUptime = (Math.floor(uptime / 86400) + ":" + (new Date(uptime * 1000)).toISOString().slice(11, 19));
      log.info(`Uptime: ${formattedUptime}`)
    }, 60 * 1000);

    // change networkHelper name to service
    fluxNetworkHelper.startNetworkSentinel();
    log.info('Collision detection running');

    syncthingService.startSyncthingSentinel();
    log.info('Syncthing service started');

    appsService.startMonitoringOfApps();
    log.info('App monitoring has begun');


    // eslint - disable - next - line no - restricted - syntax
    for (const [action, options] of delayedActions.entries()) {
      const delay = typeof options === 'string' ? options : options.schedule;
      const { schedule: _, ...filteredOptions } = typeof options === 'string' ? {} : options;
      // eslint-disable-next-line no-await-in-loop
      const running = await runAfter(delay, action, filteredOptions);
      if (!running) log.warn(`Action: ${action} with delay: ${delay} not running`);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const [action, options] of recurringActions.entries()) {
      // eslint-disable-next-line no-continue
      if (options.condition === false) continue;
      const { schedule, ...filteredOptions } = options;
      // eslint-disable-next-line no-await-in-loop
      const running = await runEvery(schedule, action, filteredOptions);
      if (!running) log.warn(`Action: ${action} with delay: ${schedule} not running`);
    }

    // const res = await exec('stty', ['onlcr']).catch(() => log.eror("FUCKED"));
    // console.log(res);


  } catch (e) {
    // ToDo: remove. Should only restart the services that errored
    log.error(e);
    process.exit();
    // setTimeout(() => {
    //   startFluxFunctions();
    // }, 15000);
  }
}

async function stopFluxFunctions() {
  // eslint-disable-next-line no-restricted-syntax
  for (const timer of timeoutTimers.values()) {
    clearTimeout(timer);
  }
  timeoutTimers.clear();

  // eslint-disable-next-line no-restricted-syntax
  for (const timer of intervalTimers.values()) {
    clearInterval(timer);
  }
  intervalTimers.clear();

  await explorerService.stopBlockProcessing();
  await fluxNetworkHelper.stopNetworkSentinel();
  await syncthingService.stopSyncthingSentinel();
  await fluxCommunication.stopPeerConnectionSentinel();
  await appsService.stopMonitoringOfApps();
}

module.exports = {
  startFluxFunctions,
  stopFluxFunctions,
};
