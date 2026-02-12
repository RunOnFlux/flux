// Peer Notification Service - Manages broadcasting of running apps to network peers
const os = require('os');
const config = require('config');
const dbHelper = require('../dbHelper');
const dockerService = require('../dockerService');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const benchmarkService = require('../benchmarkService');
const geolocationService = require('../geolocationService');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const messageStore = require('./messageStore');
const registryManager = require('../appDatabase/registryManager');
const appInspector = require('../appManagement/appInspector');
const appUninstaller = require('../appLifecycle/appUninstaller');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
const globalState = require('../utils/globalState');

// Database collections
const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

// Module-level state variable
let checkAndNotifyPeersOfRunningAppsFirstRun = true;

/**
 * Check and notify peers of running applications
 * This function is called periodically to broadcast the status of running apps to the network
 * @param {function} installedApps - Function to get installed apps
 * @param {function} listRunningApps - Function to get running apps
 * @param {object} appsMonitored - Object tracking monitored apps
 * @param {boolean} removalInProgress - Whether app removal is in progress
 * @param {boolean} installationInProgress - Whether app installation is in progress
 * @param {boolean} softRedeployInProgress - Whether soft redeploy is in progress
 * @param {boolean} hardRedeployInProgress - Whether hard redeploy is in progress
 * @param {boolean} reinstallationOfOldAppsInProgress - Whether reinstallation is in progress
 * @param {function} getGlobalState - Function to get global state
 * @param {object} cacheManager - Cache manager instance with stoppedAppsCache
 */
async function checkAndNotifyPeersOfRunningApps(
  installedApps,
  listRunningApps,
  appsMonitored,
  removalInProgress,
  installationInProgress,
  softRedeployInProgress,
  hardRedeployInProgress,
  reinstallationOfOldAppsInProgress,
  getGlobalState,
  cacheManager,
) {
  try {
    // Sync global state before checking
    getGlobalState();
    let isNodeConfirmed = false;
    isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('checkAndNotifyPeersOfRunningApps - FluxNode is not Confirmed');
      return;
    }

    // get my external IP and check that it is longer than 5 in length.
    const benchmarkResponse = await benchmarkService.getBenchmarks();
    let myIP = null;
    if (benchmarkResponse.status === 'success') {
      const benchmarkResponseData = benchmarkResponse.data;
      if (benchmarkResponseData.ipaddress) {
        log.info(`Gathered IP ${benchmarkResponseData.ipaddress}`);
        myIP = benchmarkResponseData.ipaddress.length > 5 ? benchmarkResponseData.ipaddress : null;
      }
    }
    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }
    // get list of locally installed apps. Store them in database as running and send info to our peers.
    // check if they are running?
    const installedAppsRes = await installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const runningAppsRes = await listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    let appsInstalled = installedAppsRes.data;
    appsInstalled = await decryptEnterpriseApps(appsInstalled);
    const runningApps = runningAppsRes.data;
    const installedAppComponentNames = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        app.compose.forEach((appComponent) => {
          installedAppComponentNames.push(`${appComponent.name}_${app.name}`);
        });
      } else {
        installedAppComponentNames.push(app.name);
      }
    });
    // kadena and folding is old naming scheme having /zel.  all global application start with /flux
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });
    // installed always is bigger array than running
    const runningSet = new Set(runningAppsNames);
    const stoppedApps = installedAppComponentNames.filter((installedApp) => !runningSet.has(installedApp));
    const masterSlaveAppsInstalled = [];

    // Get necessary references from global state
    const globalState = getGlobalState();
    const backupInProgress = globalState.backupInProgress || [];
    const restoreInProgress = globalState.restoreInProgress || [];
    const appsStopedCache = cacheManager.stoppedAppsCache;

    // check if stoppedApp is a global application present in specifics. If so, try to start it.
    if (!removalInProgress && !installationInProgress && !softRedeployInProgress && !hardRedeployInProgress && !reinstallationOfOldAppsInProgress) {
      // eslint-disable-next-line no-restricted-syntax
      for (const stoppedApp of stoppedApps) { // will uninstall app if some component is missing
        try {
          // proceed ONLY if it's a global App
          const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
          // eslint-disable-next-line no-await-in-loop
          const appDetails = await registryManager.getApplicationGlobalSpecifications(mainAppName);
          const appInstalledMasterSlave = appsInstalled.find((app) => app.name === mainAppName);
          const appInstalledSyncthing = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:'));
          const appInstalledMasterSlaveCheck = appInstalledMasterSlave.compose.find((comp) => comp.containerData.includes('g:'));
          if (appInstalledSyncthing) {
            masterSlaveAppsInstalled.push(appInstalledMasterSlave);
          }
          if (appDetails && !appInstalledMasterSlaveCheck) {
            if (appInstalledSyncthing) {
              const db = dbHelper.databaseConnection();
              const database = db.db(config.database.appsglobal.database);
              const queryFind = { name: mainAppName, ip: myIP };
              const projection = { _id: 0, runningSince: 1 };
              // we already have the exact same data
              // eslint-disable-next-line no-await-in-loop
              const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
              if (!result || !result.runningSince || Date.parse(result.runningSince) + 30 * 60 * 1000 > Date.now()) {
                log.info(`Application ${stoppedApp} uses r syncthing and haven't started yet because was installed less than 30m ago.`);
                // eslint-disable-next-line no-continue
                continue;
              }
            }
            log.warn(`${stoppedApp} is stopped but should be running. Starting...`);
            // it is a stopped global app. Try to run it.
            // check if some removal is in progress and if it is don't start it!
            const backupSkip = backupInProgress.some((backupItem) => stoppedApp === backupItem);
            const restoreSkip = restoreInProgress.some((backupItem) => stoppedApp === backupItem);
            if (backupSkip || restoreSkip) {
              log.warn(`Application ${stoppedApp} backup/restore is in progress...`);
            }
            if (!removalInProgress && !installationInProgress && !softRedeployInProgress && !hardRedeployInProgress && !reinstallationOfOldAppsInProgress && !restoreSkip && !backupSkip) {
              log.warn(`${stoppedApp} is stopped, starting`);
              if (!appsStopedCache.has(stoppedApp)) {
                appsStopedCache.set(stoppedApp, '');
              } else {
                // eslint-disable-next-line no-await-in-loop
                await dockerService.appDockerStart(stoppedApp);
                appInspector.startAppMonitoring(stoppedApp, appsMonitored);
              }
            } else {
              log.warn(`Not starting ${stoppedApp} as application removal or installation or backup/restore is in progress`);
            }
          }
        } catch (err) {
          log.error(err);
          if (!removalInProgress && !installationInProgress && !softRedeployInProgress && !hardRedeployInProgress && !reinstallationOfOldAppsInProgress) {
            const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
            log.warn(`REMOVAL REASON: App start failure - ${mainAppName} failed to start with error: ${err.message} (peerNotification)`);
            // already checked for mongo ok, daemon ok, docker ok.
            // eslint-disable-next-line no-await-in-loop
            await appUninstaller.removeAppLocally(mainAppName, null, false, true, true, () => {
              // Handle response
            }, getGlobalState, (name, deleteData) => appInspector.stopAppMonitoring(name, deleteData, appsMonitored));
          }
        }
      }
    } else {
      log.warn('Stopped application checks not running, some removal or installation is in progress');
    }
    const installedAndRunning = [];
    appsInstalled.forEach((app) => {
      if (app.version >= 4) {
        let appRunningWell = true;
        app.compose.forEach((appComponent) => {
          if (!runningAppsNames.includes(`${appComponent.name}_${app.name}`)) {
            appRunningWell = false;
          }
        });
        if (appRunningWell) {
          installedAndRunning.push(app);
        }
      } else if (runningAppsNames.includes(app.name)) {
        installedAndRunning.push(app);
      }
    });
    installedAndRunning.push(...masterSlaveAppsInstalled);
    const applicationsToBroadcast = [...new Set(installedAndRunning)];
    const apps = [];
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.appsglobal.database);
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const application of applicationsToBroadcast) {
        const queryFind = { name: application.name, ip: myIP };
        const projection = { _id: 0, runningSince: 1 };
        let runningOnMyNodeSince = new Date().toISOString();
        // we already have the exact same data
        // eslint-disable-next-line no-await-in-loop
        const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
        if (result && result.runningSince) {
          runningOnMyNodeSince = result.runningSince;
        }
        log.info(`${application.name} is running/installed properly. Broadcasting status.`);
        // eslint-disable-next-line no-await-in-loop
        // we can distinguish pure local apps from global with hash and height
        const newAppRunningMessage = {
          type: 'fluxapprunning',
          version: 1,
          name: application.name,
          hash: application.hash, // hash of application specifics that are running
          ip: myIP,
          broadcastedAt: Date.now(),
          runningSince: runningOnMyNodeSince,
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        const app = {
          name: application.name,
          hash: application.hash,
          runningSince: runningOnMyNodeSince,
        };
        apps.push(app);
        // store it in local database first
        // eslint-disable-next-line no-await-in-loop
        await messageStore.storeAppRunningMessage(newAppRunningMessage);
        if (installedAndRunning.length === 1) {
          // eslint-disable-next-line no-await-in-loop
          await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessage);
          // eslint-disable-next-line no-await-in-loop
          await serviceHelper.delay(500);
          // eslint-disable-next-line no-await-in-loop
          await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessage);
          // broadcast messages about running apps to all peers
          log.info(`App Running Message broadcasted ${JSON.stringify(newAppRunningMessage)}`);
        }
      }
      if (installedAndRunning.length > 1) {
        // send v2 unique message instead
        const newAppRunningMessageV2 = {
          type: 'fluxapprunning',
          version: 2,
          apps,
          ip: myIP,
          broadcastedAt: Date.now(),
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessageV2);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessageV2);
        // broadcast messages about running apps to all peers
        log.info(`App Running Message broadcasted ${JSON.stringify(newAppRunningMessageV2)}`);
      } else if (installedAndRunning.length === 0 && checkAndNotifyPeersOfRunningAppsFirstRun) {
        checkAndNotifyPeersOfRunningAppsFirstRun = false;
        // we will broadcast a message that we are not running any app
        // if multitoolbox option to reinstall fluxos or fix mongodb is executed all apps are removed from the node, once the node starts and it's confirmed
        // should broadcast to the network what is running or not
        // the nodes who receive the message will only rebroadcast if they had information about a app running on this node
        const newAppRunningMessageV2 = {
          type: 'fluxapprunning',
          version: 2,
          apps,
          ip: myIP,
          broadcastedAt: Date.now(),
          osUptime: os.uptime(),
          staticIp: geolocationService.isStaticIP(),
        };
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(newAppRunningMessageV2);
        // eslint-disable-next-line no-await-in-loop
        await serviceHelper.delay(500);
        // eslint-disable-next-line no-await-in-loop
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(newAppRunningMessageV2);
        // broadcast messages about running apps to all peers
        log.info(`No Apps Running Message broadcasted ${JSON.stringify(newAppRunningMessageV2)}`);
      }
    } catch (err) {
      log.error(err);
      // removeAppLocally(stoppedApp);
    }
    // Update the running apps cache with the current state
    const runningAppsCache = globalState.runningAppsCache;
    runningAppsCache.clear();
    apps.forEach((app) => {
      runningAppsCache.add(app.name);
    });
    log.info(`Running Apps cache updated with ${runningAppsCache.size} apps`);
    log.info('Running Apps broadcasted');
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  checkAndNotifyPeersOfRunningApps,
};
