const config = require('config');
const log = require('../../lib/log');
const dbHelper = require('../dbHelper');
const generalService = require('../generalService');
const appInstaller = require('../appLifecycle/appInstaller');
const { decryptEnterpriseApps } = require('../appQuery/appQueryService');
const { localAppsInformation } = require('../utils/appConstants');
const { verifyAppVolumeMount } = require('../utils/volumeService');


/**
 * Recreates the container(s) for an app/component from its local spec.
 *
 * softOnly: refuse the installApplicationHard fallback. A hard install runs
 * createAppVolume, which fallocates and mke2fs's the app's volume file - i.e. it
 * REFORMATS the app's data. That is acceptable when recreating a container whose
 * volume could not be verified and which is gone anyway, but it is catastrophic
 * for a caller that deliberately removed a live container whose data was intact
 * (the network-detach heal): a transient verifyAppVolumeMount failure would wipe
 * the user's data. Such callers pass softOnly and get a throw instead, so they
 * can retry rather than reformat.
 *
 * @param {string} componentIdentifier
 * @param {{softOnly?: boolean}} [options]
 */
async function recreateMissingContainers(componentIdentifier, options = {}) {
  const { softOnly = false } = options;
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

  // A container can only be (re)created onto an existing docker network, but the
  // per-app network (fluxDockerNetwork_<app>) is otherwise created only at install
  // time (registerAppLocally). If it was pruned - docker prune, daemon restart -
  // every recreate below would loop forever on "network not found". Recreate it
  // first; ensureAppDockerNetwork returns early (no create, no firewall work) when
  // the network already exists, so the common intact-network recreate stays cheap.
  await appInstaller.ensureAppDockerNetwork(mainAppName);

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
      if (softOnly) {
        throw new Error(`Cannot recreate ${componentIdentifier} without reformatting its volume: the data volume for ${mainAppName} could not be verified as mounted`);
      }
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
        if (softOnly) {
          throw new Error(`Cannot recreate ${componentIdentifier} without reformatting its volume: the data volume for ${mainAppName} could not be verified as mounted`);
        }
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
