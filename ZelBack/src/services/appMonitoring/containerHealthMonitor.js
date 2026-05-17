const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const dockerService = require('../dockerService');
const generalService = require('../generalService');
const registryManager = require('../appDatabase/registryManager');
const appInstaller = require('../appLifecycle/appInstaller');
const appUninstaller = require('../appLifecycle/appUninstaller');
const appInspector = require('../appManagement/appInspector');
const appTamperingDetectionService = require('../appTamperingDetectionService');
const globalState = require('../utils/globalState');
const cacheManager = require('../utils/cacheManager').default;
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const { localAppsInformation } = require('../utils/appConstants');

const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

async function recreateMissingContainers(componentIdentifier) {
  const mainAppName = componentIdentifier.split('_')[1] || componentIdentifier;
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appslocal.database);

  const appsQuery = { name: mainAppName };
  const appsProjection = { projection: { _id: 0 } };
  let appSpec = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);

  if (!appSpec) {
    throw new Error(`App ${mainAppName} not found in local database`);
  }

  appSpec = await decryptEnterpriseApps([appSpec], { formatSpecs: false });
  // eslint-disable-next-line prefer-destructuring
  appSpec = appSpec[0];

  if (!appSpec.compose || appSpec.compose.length === 0) {
    throw new Error(`App ${mainAppName} has no components to install`);
  }

  const tier = await generalService.nodeTier();
  const isComponent = componentIdentifier.includes('_');

  if (isComponent) {
    const componentName = componentIdentifier.split('_')[0];
    const componentSpec = appSpec.compose.find((c) => c.name === componentName);
    if (!componentSpec) {
      throw new Error(`Component ${componentName} not found in app ${mainAppName}`);
    }
    const hddTier = `hdd${tier}`;
    const ramTier = `ram${tier}`;
    const cpuTier = `cpu${tier}`;
    componentSpec.cpu = componentSpec[cpuTier] || componentSpec.cpu;
    componentSpec.ram = componentSpec[ramTier] || componentSpec.ram;
    componentSpec.hdd = componentSpec[hddTier] || componentSpec.hdd;
    await appInstaller.installApplicationHard(componentSpec, mainAppName, true, null, appSpec);
  } else {
    for (const componentSpec of appSpec.compose) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      componentSpec.cpu = componentSpec[cpuTier] || componentSpec.cpu;
      componentSpec.ram = componentSpec[ramTier] || componentSpec.ram;
      componentSpec.hdd = componentSpec[hddTier] || componentSpec.hdd;
      // eslint-disable-next-line no-await-in-loop
      await appInstaller.installApplicationHard(componentSpec, mainAppName, true, null, appSpec);
    }
  }

  log.info(`Successfully recreated missing containers for ${componentIdentifier}`);
}

async function handleMissingMasterSlaveContainer(stoppedApp, mainAppName) {
  const containerExists = await dockerService.getDockerContainerOnly(stoppedApp);
  if (containerExists) return;

  log.warn(`Container for master/slave app ${stoppedApp} doesn't exist, recreating...`);
  try {
    await recreateMissingContainers(stoppedApp);
    log.info(`Successfully recreated master/slave app container ${stoppedApp}`);
    appInspector.startAppMonitoring(stoppedApp, globalState.appsMonitored);
  } catch (recreateErr) {
    const containerExistsNow = await dockerService.getDockerContainerOnly(stoppedApp);
    if (containerExistsNow) {
      log.info(`Container for ${stoppedApp} was created by another process, skipping removal`);
      return;
    }
    log.error(`Failed to recreate master/slave app ${stoppedApp}: ${recreateErr.message}`);
    log.warn(`REMOVAL REASON: Master/slave container recreation failure - ${mainAppName} (containerHealthMonitor)`);
    await appTamperingDetectionService.recordEvent(mainAppName, 'recreation_failed', `Master/slave container recreation failure: ${recreateErr.message}`);
    if (appTamperingDetectionService.isNetworkMissingError(recreateErr.message)) {
      await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Docker network missing during recreation: ${recreateErr.message}`);
    }
    await appUninstaller.removeAppLocally(mainAppName, null, false, true, true);
  }
}

async function monitorAndRecoverApps(myIP, appsInstalled, runningAppsNames) {
  await globalState.waitForBootContainerStateSettled();
  const masterSlaveAppsInstalled = [];
  const startedApps = [];
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
  const runningSet = new Set(runningAppsNames);
  const stoppedApps = installedAppComponentNames.filter((installedApp) => !runningSet.has(installedApp));

  const backupInProgress = globalState.backupInProgress || [];
  const restoreInProgress = globalState.restoreInProgress || [];
  const appsStoppedCache = cacheManager.stoppedAppsCache;

  if (globalState.isOperationInProgress()) {
    log.warn('Stopped application checks not running, some removal or installation is in progress');
    return { masterSlaveAppsInstalled, startedApps };
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const stoppedApp of stoppedApps) {
    try {
      const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
      // eslint-disable-next-line no-await-in-loop
      const appDetails = await registryManager.getApplicationGlobalSpecifications(mainAppName);
      const appInstalledMasterSlave = appsInstalled.find((app) => app.name === mainAppName);
      const composeSpecs = appInstalledMasterSlave?.compose;
      const appInstalledSyncthing = composeSpecs?.find((comp) => comp.containerData.includes('g:') || comp.containerData.includes('r:'));
      const appInstalledMasterSlaveCheck = composeSpecs?.find((comp) => comp.containerData.includes('g:'));
      if (appInstalledSyncthing) {
        masterSlaveAppsInstalled.push(appInstalledMasterSlave);
      }
      if (appInstalledMasterSlaveCheck && appDetails) {
        const backupSkip = backupInProgress.some((backupItem) => stoppedApp === backupItem);
        const restoreSkip = restoreInProgress.some((backupItem) => stoppedApp === backupItem);
        if (!backupSkip && !restoreSkip) {
          // eslint-disable-next-line no-await-in-loop
          await handleMissingMasterSlaveContainer(stoppedApp, mainAppName);
        }
      } else if (appDetails) {
        log.warn(`${stoppedApp} is stopped but should be running. Starting...`);
        const backupSkip = backupInProgress.some((backupItem) => stoppedApp === backupItem);
        const restoreSkip = restoreInProgress.some((backupItem) => stoppedApp === backupItem);
        if (backupSkip || restoreSkip) {
          log.warn(`Application ${stoppedApp} backup/restore is in progress...`);
        }
        if (!globalState.isOperationInProgress() && !restoreSkip && !backupSkip) {
          // eslint-disable-next-line no-await-in-loop
          const containerExists = await dockerService.getDockerContainerOnly(stoppedApp);

          if (containerExists && appInstalledSyncthing) {
            const db = dbHelper.databaseConnection();
            const database = db.db(config.database.appsglobal.database);
            const queryFind = { name: mainAppName, ip: myIP };
            const projection = { _id: 0, runningSince: 1 };
            // eslint-disable-next-line no-await-in-loop
            const result = await dbHelper.findOneInDatabase(database, globalAppsLocations, queryFind, projection);
            if (!result || !result.runningSince || Date.parse(result.runningSince) + 30 * 60 * 1000 > Date.now()) {
              log.info(`Application ${stoppedApp} uses r syncthing and container exists but is stopped. Haven't started yet because was installed less than 30m ago.`);
              // eslint-disable-next-line no-continue
              continue;
            }
          }

          if (!containerExists) {
            log.warn(`Container for ${stoppedApp} doesn't exist, recreating immediately...`);
            // eslint-disable-next-line no-await-in-loop
            await appTamperingDetectionService.recordEvent(mainAppName, 'container_vanished', `Container ${stoppedApp} missing, not found in Docker`);
            try {
              // eslint-disable-next-line no-await-in-loop
              await recreateMissingContainers(stoppedApp);
              log.info(`Successfully recreated ${stoppedApp}`);
              appInspector.startAppMonitoring(stoppedApp, globalState.appsMonitored);
              startedApps.push(stoppedApp);
            } catch (recreateErr) {
              log.error(`Failed to recreate containers for ${stoppedApp}: ${recreateErr.message}`);
              log.warn(`REMOVAL REASON: Container recreation failure - ${mainAppName} failed to recreate with error: ${recreateErr.message} (containerHealthMonitor)`);
              // eslint-disable-next-line no-await-in-loop
              await appTamperingDetectionService.recordEvent(mainAppName, 'recreation_failed', `Container recreation failure: ${recreateErr.message}`);
              if (appTamperingDetectionService.isNetworkMissingError(recreateErr.message)) {
                // eslint-disable-next-line no-await-in-loop
                await appTamperingDetectionService.recordEvent(mainAppName, 'network_pruned', `Docker network missing during recreation: ${recreateErr.message}`);
              }
              // eslint-disable-next-line no-await-in-loop
              await appUninstaller.removeAppLocally(mainAppName, null, false, true, true);
            }
          } else {
            log.warn(`${stoppedApp} is stopped, starting`);
            if (!appsStoppedCache.has(stoppedApp)) {
              appsStoppedCache.set(stoppedApp, '');
            } else {
              // eslint-disable-next-line no-await-in-loop
              await dockerService.appDockerStart(stoppedApp);
              appInspector.startAppMonitoring(stoppedApp, globalState.appsMonitored);
              startedApps.push(stoppedApp);
            }
          }
        } else {
          log.warn(`Not starting ${stoppedApp} as application removal or installation or backup/restore is in progress`);
        }
      }
    } catch (err) {
      log.error(err);
      const mainAppName = stoppedApp.split('_')[1] || stoppedApp;
      if (!globalState.isOperationInProgress()) {
        log.warn(`REMOVAL REASON: App start failure - ${mainAppName} failed to start with error: ${err.message} (containerHealthMonitor)`);
        // eslint-disable-next-line no-await-in-loop
        await appUninstaller.removeAppLocally(mainAppName, null, false, true, true);
      }
    }
  }
  return { masterSlaveAppsInstalled, startedApps };
}

module.exports = {
  monitorAndRecoverApps,
  recreateMissingContainers,
  handleMissingMasterSlaveContainer,
};
