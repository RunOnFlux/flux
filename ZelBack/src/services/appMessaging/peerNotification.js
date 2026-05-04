const os = require('os');
const config = require('config');
const dbHelper = require('../dbHelper');
const generalService = require('../generalService');
const benchmarkService = require('../benchmarkService');
const geolocationService = require('../geolocationService');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const messageStore = require('./messageStore');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const log = require('../../lib/log');
const globalState = require('../utils/globalState');
const appQueryService = require('../appQuery/appQueryService');
const stoppedAppsRecovery = require('../appLifecycle/stoppedAppsRecovery');

const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

let checkAndNotifyPeersOfRunningAppsFirstRun = true;
let broadcastInterval = null;

function resetBroadcastInterval() {
  if (broadcastInterval) clearInterval(broadcastInterval);
  broadcastInterval = setInterval(() => {
    checkAndNotifyPeersOfRunningApps();
  }, 60 * 60 * 1000);
}

function stopBroadcastInterval() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
  }
}

async function checkAndNotifyPeersOfRunningApps() {
  try {
    const isNodeConfirmed = await generalService.isNodeStatusConfirmed().catch(() => null);
    if (!isNodeConfirmed) {
      log.info('checkAndNotifyPeersOfRunningApps - FluxNode is not Confirmed');
      return;
    }

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

    const installedAppsRes = await appQueryService.installedApps();
    if (installedAppsRes.status !== 'success') {
      throw new Error('Failed to get installed Apps');
    }
    const runningAppsRes = await appQueryService.listRunningApps();
    if (runningAppsRes.status !== 'success') {
      throw new Error('Unable to check running Apps');
    }
    let appsInstalled = installedAppsRes.data;
    appsInstalled = await decryptEnterpriseApps(appsInstalled, { formatSpecs: false });
    const runningApps = runningAppsRes.data;
    const runningAppsNames = runningApps.map((app) => {
      if (app.Names[0].startsWith('/zel')) {
        return app.Names[0].slice(4);
      }
      return app.Names[0].slice(5);
    });

    const masterSlaveAppsInstalled = await stoppedAppsRecovery.checkStoppedApps(myIP, appsInstalled, runningAppsNames);

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
        // eslint-disable-next-line no-await-in-loop
        const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
        let runningOnMyNodeSince = new Date().toISOString();
        if (result && result.runningSince) {
          runningOnMyNodeSince = result.runningSince;
        }
        log.info(`${application.name} is running/installed properly. Broadcasting status.`);
        apps.push({
          name: application.name,
          hash: application.hash,
          runningSince: runningOnMyNodeSince,
        });
      }
      if (apps.length === 0 && !checkAndNotifyPeersOfRunningAppsFirstRun) {
        return;
      }
      checkAndNotifyPeersOfRunningAppsFirstRun = false;
      const appRunningMessage = {
        type: 'fluxapprunning',
        version: 2,
        apps,
        ip: myIP,
        broadcastedAt: Date.now(),
        osUptime: os.uptime(),
        staticIp: geolocationService.isStaticIP(),
      };
      await messageStore.storeAppRunningMessage(appRunningMessage);
      const signed = await fluxCommunicationMessagesSender.broadcastMessageToAll(appRunningMessage);
      await messageStore.storeAppStateEvent(messageStore.APP_STATE_EVENT_TYPES.APPRUNNING, { signedBroadcast: signed });
      log.info(`App Running Message broadcasted: ${apps.length} apps`);
    } catch (err) {
      log.error(err);
    }
    const runningAppsCache = globalState.runningAppsCache;
    runningAppsCache.clear();
    apps.forEach((app) => {
      runningAppsCache.add(app.name);
    });
    log.info(`Running Apps cache updated with ${runningAppsCache.size} apps`);
    log.info('Running Apps broadcasted');
  } catch (error) {
    log.error(error);
  } finally {
    resetBroadcastInterval();
  }
}

module.exports = {
  checkAndNotifyPeersOfRunningApps,
  stopBroadcastInterval,
};
