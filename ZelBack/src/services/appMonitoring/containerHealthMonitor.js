const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const generalService = require('../generalService');
const appInstaller = require('../appLifecycle/appInstaller');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const { localAppsInformation } = require('../utils/appConstants');
const { verifyAppVolumeMount } = require('../utils/volumeService');


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
    let volumeMounted = false;
    try {
      volumeMounted = await verifyAppVolumeMount(mainAppName, true, componentName);
    } catch {
      // volume not mounted
    }
    if (volumeMounted) {
      await appInstaller.installApplicationSoft(componentSpec, mainAppName, true, null, appSpec);
    } else {
      await appInstaller.installApplicationHard(componentSpec, mainAppName, true, null, appSpec);
    }
  } else {
    for (const componentSpec of appSpec.compose) {
      const hddTier = `hdd${tier}`;
      const ramTier = `ram${tier}`;
      const cpuTier = `cpu${tier}`;
      componentSpec.cpu = componentSpec[cpuTier] || componentSpec.cpu;
      componentSpec.ram = componentSpec[ramTier] || componentSpec.ram;
      componentSpec.hdd = componentSpec[hddTier] || componentSpec.hdd;
      let volumeMounted = false;
      try {
        // eslint-disable-next-line no-await-in-loop
        volumeMounted = await verifyAppVolumeMount(mainAppName, true, componentSpec.name);
      } catch {
        // volume not mounted
      }
      if (volumeMounted) {
        // eslint-disable-next-line no-await-in-loop
        await appInstaller.installApplicationSoft(componentSpec, mainAppName, true, null, appSpec);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await appInstaller.installApplicationHard(componentSpec, mainAppName, true, null, appSpec);
      }
    }
  }

  log.info(`Successfully recreated missing containers for ${componentIdentifier}`);
}

module.exports = {
  recreateMissingContainers,
};
