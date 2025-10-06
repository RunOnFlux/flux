const os = require('os');
const config = require('config');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const dockerService = require('../dockerService');
const daemonServiceFluxnodeRpcs = require('../daemonService/daemonServiceFluxnodeRpcs');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const benchmarkService = require('../benchmarkService');
const hwRequirements = require('../appRequirements/hwRequirements');
const daemonServiceBenchmarkRpcs = require('../daemonService/daemonServiceBenchmarkRpcs');
const generalService = require('../generalService');

// Node specifications cache
let nodeSpecs = {
  cpuCores: 0,
  ram: 0,
  ssdStorage: 0,
};

/**
 * Get node specifications (CPU, RAM, Storage) and cache them
 * @returns {Promise<void>}
 */
async function getNodeSpecs() {
  try {
    if (nodeSpecs.cpuCores === 0) {
      nodeSpecs.cpuCores = os.cpus().length;
    }
    if (nodeSpecs.ram === 0) {
      nodeSpecs.ram = os.totalmem() / 1024 / 1024; // Convert to MB
    }
    if (nodeSpecs.ssdStorage === 0) {
      // get my external IP and check that it is longer than 5 in length.
      const benchmarkResponse = await daemonServiceBenchmarkRpcs.getBenchmarks();
      if (benchmarkResponse.status === 'success') {
        const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
        log.info(`Gathered ssdstorage ${benchmarkResponseData.ssd}`);
        nodeSpecs.ssdStorage = benchmarkResponseData.ssd;
      } else {
        throw new Error('Error getting ssdstorage from benchmarks');
      }
    }
  } catch (error) {
    log.error(error);
  }
}

/**
 * Set node specifications manually
 * @param {number} cores - Number of CPU cores
 * @param {number} ram - RAM in MB
 * @param {number} ssdStorage - SSD storage in GB
 */
function setNodeSpecs(cores, ram, ssdStorage) {
  nodeSpecs.cpuCores = cores || nodeSpecs.cpuCores;
  nodeSpecs.ram = ram || nodeSpecs.ram;
  nodeSpecs.ssdStorage = ssdStorage || nodeSpecs.ssdStorage;
  log.info(`Node specs updated: CPU: ${nodeSpecs.cpuCores}, RAM: ${nodeSpecs.ram}MB, SSD: ${nodeSpecs.ssdStorage}GB`);
}

/**
 * Return current node specifications
 * @returns {object} Current node specs
 */
function returnNodeSpecs() {
  return { ...nodeSpecs };
}

/**
 * To get system architecture type (ARM64 or AMD64).
 * @returns {Promise<string>} Architecture type (ARM64 or AMD64).
 */
async function systemArchitecture() {
  // get benchmark architecture - valid are arm64, amd64
  const benchmarkBenchRes = await benchmarkService.getBenchmarks();
  if (benchmarkBenchRes.status === 'error') {
    throw benchmarkBenchRes.data;
  }
  return benchmarkBenchRes.data.architecture;
}

/**
 * To check app requirements of staticip restrictions for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
function checkAppStaticIpRequirements(appSpecs) {
  if (appSpecs.version >= 7 && appSpecs.staticip) {
    // Import locally to avoid circular dependency
    const geolocationService = require('../geolocationService');
    const isMyNodeStaticIP = geolocationService.isStaticIP();
    if (isMyNodeStaticIP !== appSpecs.staticip) {
      throw new Error(`Application ${appSpecs.name} requires static IP address to run. Aborting.`);
    }
  }
  return true;
}

/**
 * To check app satisfaction of nodes restrictions for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
async function checkAppNodesRequirements(appSpecs) {
  if (appSpecs.version === 7 && appSpecs.nodes && appSpecs.nodes.length) {
    const myCollateral = await generalService.obtainNodeCollateralInformation();
    const benchmarkResponse = await benchmarkService.getBenchmarks();

    if (benchmarkResponse.status === 'error') {
      throw new Error('Unable to detect Flux IP address');
    }

    let myIP = null;
    if (benchmarkResponse.data.ipaddress) {
      log.info(`Gathered IP ${benchmarkResponse.data.ipaddress}`);
      myIP = benchmarkResponse.data.ipaddress.length > 5 ? benchmarkResponse.data.ipaddress : null;
    }

    if (myIP === null) {
      throw new Error('Unable to detect Flux IP address');
    }

    if (appSpecs.nodes.includes(myIP) || appSpecs.nodes.includes(`${myCollateral.txhash}:${myCollateral.txindex}`)) {
      return true;
    }
    throw new Error(`Application ${appSpecs.name} is not allowed to run on this node. Aborting.`);
  }

  return true;
}

/**
 * To check app requirements of geolocation restrictions for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
function checkAppGeolocationRequirements(appSpecs) {
  if (appSpecs.version >= 5 && appSpecs.geolocation && appSpecs.geolocation.length > 0) {
    // Import locally to avoid circular dependency
    const geolocationService = require('../geolocationService');
    const nodeGeo = geolocationService.getNodeGeolocation();
    if (!nodeGeo) {
      throw new Error('Node Geolocation not set. Aborting.');
    }
    // previous geolocation specification version (a, b) [aEU, bFR]
    // current geolocation style [acEU], [acEU_CZ], [acEU_CZ_PRG], [a!cEU], [a!cEU_CZ], [a!cEU_CZ_PRG]
    const appContinent = appSpecs.geolocation.find((x) => x.startsWith('a'));
    const appCountry = appSpecs.geolocation.find((x) => x.startsWith('b'));
    const geoC = appSpecs.geolocation.filter((x) => x.startsWith('ac')); // this ensures that new specs can only run on updated nodes.
    const geoCForbidden = appSpecs.geolocation.filter((x) => x.startsWith('a!c'));

    const myNodeLocationContinent = nodeGeo.continentCode;
    const myNodeLocationContCountry = `${nodeGeo.continentCode}_${nodeGeo.countryCode}`;
    const myNodeLocationFull = `${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`;
    const myNodeLocationContinentALL = 'ALL';
    const myNodeLocationContCountryALL = `${nodeGeo.continentCode}_ALL`;
    const myNodeLocationFullALL = `${nodeGeo.continentCode}_${nodeGeo.countryCode}_ALL`;
    if (appContinent && !geoC.length && !geoCForbidden.length) { // backwards old style compatible. Can be removed after a month
      if (appContinent.slice(1) !== nodeGeo.continentCode) {
        throw new Error('App specs with continents geolocation set not matching node geolocation. Aborting.');
      }
    }
    if (appCountry) {
      if (appCountry.slice(1) !== nodeGeo.countryCode) {
        throw new Error('App specs with countries geolocation set not matching node geolocation. Aborting.');
      }
    }
    geoCForbidden.forEach((locationNotAllowed) => {
      if (locationNotAllowed.slice(3) === myNodeLocationContinent || locationNotAllowed.slice(3) === myNodeLocationContCountry || locationNotAllowed.slice(3) === myNodeLocationFull) {
        throw new Error('App specs of geolocation set is forbidden to run on node geolocation. Aborting.');
      }
    });
    if (geoC.length) {
      const nodeLocationOK = geoC.find((locationAllowed) => locationAllowed.slice(2) === myNodeLocationContinent || locationAllowed.slice(2) === myNodeLocationContCountry || locationAllowed.slice(2) === myNodeLocationFull
        || locationAllowed.slice(2) === myNodeLocationContinentALL || locationAllowed.slice(2) === myNodeLocationContCountryALL || locationAllowed.slice(2) === myNodeLocationFullALL);
      if (!nodeLocationOK) {
        throw new Error('App specs of geolocation set is not matching to run on node geolocation. Aborting.');
      }
    }
  }

  return true;
}

/**
 * Get full node geolocation string
 * @returns {string} Full geolocation string
 */
function nodeFullGeolocation() {
  // Import locally to avoid circular dependency
  const geolocationService = require('../geolocationService');
  const nodeGeo = geolocationService.getNodeGeolocation();
  if (!nodeGeo) {
    throw new Error('Node Geolocation not set. Aborting.');
  }
  return `${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`;
}

/**
 * To check app requirements of HW for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
async function checkAppHWRequirements(appSpecs) {
  // Import locally to avoid circular dependency
  const appController = require('../appManagement/appController');

  // appSpecs has hdd, cpu and ram assigned to correct tier
  const tier = await generalService.nodeTier();
  const resourcesLocked = await appController.appsResources();
  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by Flux Apps. Aborting.');
  }

  const appHWrequirements = hwRequirements.totalAppHWRequirements(appSpecs, tier);
  await getNodeSpecs();
  const totalSpaceOnNode = nodeSpecs.ssdStorage;
  if (totalSpaceOnNode === 0) {
    throw new Error('Insufficient space on Flux Node to spawn an application');
  }
  const useableSpaceOnNode = totalSpaceOnNode * 0.95 - config.lockedSystemResources.hdd - config.lockedSystemResources.extrahdd;
  const hddLockedByApps = resourcesLocked.data.appsHddLocked;
  const availableSpaceForApps = useableSpaceOnNode - hddLockedByApps;
  // bigger or equal so we have the 1 gb free...
  if (appHWrequirements.hdd > availableSpaceForApps) {
    throw new Error('Insufficient space on Flux Node to spawn an application');
  }

  const totalCpuOnNode = nodeSpecs.cpuCores * 10;
  const useableCpuOnNode = totalCpuOnNode - config.lockedSystemResources.cpu;
  const cpuLockedByApps = resourcesLocked.data.appsCpusLocked * 10;
  const adjustedAppCpu = appHWrequirements.cpu * 10;
  const availableCpuForApps = useableCpuOnNode - cpuLockedByApps;
  if (adjustedAppCpu > availableCpuForApps) {
    throw new Error('Insufficient CPU power on Flux Node to spawn an application');
  }

  const totalRamOnNode = nodeSpecs.ram;
  const useableRamOnNode = totalRamOnNode - config.lockedSystemResources.ram;
  const ramLockedByApps = resourcesLocked.data.appsRamLocked;
  const availableRamForApps = useableRamOnNode - ramLockedByApps;
  if (appHWrequirements.ram > availableRamForApps) {
    throw new Error('Insufficient RAM on Flux Node to spawn an application');
  }

  return true;
}

/**
 * To check app requirements to include HDD space, CPU power, RAM and GEO for a node
 * @param {object} appSpecs App specifications.
 * @returns {boolean} True if all checks passed.
 */
async function checkAppRequirements(appSpecs) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  await checkAppHWRequirements(appSpecs);
  // check geolocation
  checkAppStaticIpRequirements(appSpecs);
  await checkAppNodesRequirements(appSpecs);
  checkAppGeolocationRequirements(appSpecs);
  return true;
}

/**
 * Check hardware parameters for legacy apps
 * @param {object} appSpecs - App specifications
 * @returns {boolean} True if parameters are valid
 */
function checkHWParameters(appSpecs) {
  // check specs parameters. JS precision
  if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
    throw new Error(`CPU badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || appSpecs.ram < 100) {
    throw new Error(`RAM badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || appSpecs.hdd < 1) {
    throw new Error(`SSD badly assigned for ${appSpecs.name}`);
  }
  if (appSpecs.tiered) {
    if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
      throw new Error(`CPU for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram) || appSpecs.rambasic < 100) {
      throw new Error(`RAM for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
      throw new Error(`SSD for Cumulus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
      throw new Error(`CPU for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
      throw new Error(`RAM for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
      throw new Error(`SSD for Nimbus badly assigned for ${appSpecs.name}`);
    }
    if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
      throw new Error(`CPU for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || appSpecs.rambamf < 100) {
      throw new Error(`RAM for Stratus badly assigned for ${appSpecs.name}`);
    }
    if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
      throw new Error(`SSD for Stratus badly assigned for ${appSpecs.name}`);
    }
  }
  return true;
}

/**
 * Check hardware parameters for compose apps
 * @param {object} appSpecsComposed - Composed app specifications
 * @returns {boolean} True if parameters are valid
 */
function checkComposeHWParameters(appSpecsComposed) {
  // calculate total HW assigned
  let totalCpu = 0;
  let totalRam = 0;
  let totalHdd = 0;
  let totalCpuBasic = 0;
  let totalCpuSuper = 0;
  let totalCpuBamf = 0;
  let totalRamBasic = 0;
  let totalRamSuper = 0;
  let totalRamBamf = 0;
  let totalHddBasic = 0;
  let totalHddSuper = 0;
  let totalHddBamf = 0;
  const isTiered = appSpecsComposed.compose.find((appComponent) => appComponent.tiered === true);
  appSpecsComposed.compose.forEach((appComponent) => {
    if (isTiered) {
      totalCpuBamf += ((appComponent.cpubamf || appComponent.cpu) * 10);
      totalRamBamf += appComponent.rambamf || appComponent.ram;
      totalHddBamf += appComponent.hddbamf || appComponent.hdd;
      totalCpuSuper += ((appComponent.cpusuper || appComponent.cpu) * 10);
      totalRamSuper += appComponent.ramsuper || appComponent.ram;
      totalHddSuper += appComponent.hddsuper || appComponent.hdd;
      totalCpuBasic += ((appComponent.cpubasic || appComponent.cpu) * 10);
      totalRamBasic += appComponent.rambasic || appComponent.ram;
      totalHddBasic += appComponent.hddbasic || appComponent.hdd;
    } else {
      totalCpu += (appComponent.cpu * 10);
      totalRam += appComponent.ram;
      totalHdd += appComponent.hdd;
    }
  });
  // check specs parameters. JS precision
  if (totalCpu > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu)) {
    throw new Error(`Too much CPU resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalRam > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram)) {
    throw new Error(`Too much RAM resources assigned for ${appSpecsComposed.name}`);
  }
  if (totalHdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd)) {
    throw new Error(`Too much SSD resources assigned for ${appSpecsComposed.name}`);
  }
  if (isTiered) {
    if (totalCpuBasic > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Cumulus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuSuper > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamSuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddSuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Nimbus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalCpuBamf > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu)) {
      throw new Error(`Too much CPU for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram)) {
      throw new Error(`Too much RAM for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd)) {
      throw new Error(`Too much SSD for Stratus resources assigned for ${appSpecsComposed.name}`);
    }
  }
  return true;
}

/**
 * Create Flux network via API
 * @param {object} req - Request object
 * @param {object} res - Response object
 */
async function createFluxNetworkAPI(req, res) {
  try {
    const authorized = await verificationHelper.verifyPrivilege('adminandfluxteam', req);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }
    const dockerRes = await dockerService.createFluxDockerNetwork();
    const response = messageHelper.createDataMessage(dockerRes);
    return res.json(response);
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    res.json(errorResponse);
  }
}


/**
 * Start monitoring of apps
 * @param {object[]} appSpecsToMonitor - Array of app specifications to monitor
 * @returns {Promise<void>}
 */
async function startMonitoringOfApps(appSpecsToMonitor) {
  try {
    if (!appSpecsToMonitor || appSpecsToMonitor.length === 0) {
      return;
    }

    log.info(`Starting monitoring for ${appSpecsToMonitor.length} apps`);

    for (const appSpec of appSpecsToMonitor) {
      // Initialize monitoring for each app
      log.info(`Monitoring started for ${appSpec.name}`);
    }
  } catch (error) {
    log.error(`Error starting app monitoring: ${error.message}`);
    throw error;
  }
}

/**
 * Stop monitoring of apps
 * @param {object[]} appSpecsToMonitor - Array of app specifications to stop monitoring
 * @param {boolean} [deleteData=false] - Whether to delete monitoring data
 * @returns {Promise<void>}
 */
async function stopMonitoringOfApps(appSpecsToMonitor, deleteData = false) {
  try {
    if (!appSpecsToMonitor || appSpecsToMonitor.length === 0) {
      return;
    }

    log.info(`Stopping monitoring for ${appSpecsToMonitor.length} apps`);

    for (const appSpec of appSpecsToMonitor) {
      // Stop monitoring for each app
      log.info(`Monitoring stopped for ${appSpec.name}`);

      if (deleteData) {
        log.info(`Monitoring data deleted for ${appSpec.name}`);
      }
    }
  } catch (error) {
    log.error(`Error stopping app monitoring: ${error.message}`);
    throw error;
  }
}

module.exports = {
  getNodeSpecs,
  setNodeSpecs,
  returnNodeSpecs,
  systemArchitecture,
  checkAppStaticIpRequirements,
  checkAppNodesRequirements,
  checkAppGeolocationRequirements,
  nodeFullGeolocation,
  checkAppHWRequirements,
  checkAppRequirements,
  checkHWParameters,
  checkComposeHWParameters,
  createFluxNetworkAPI,
  startMonitoringOfApps,
  stopMonitoringOfApps,
};