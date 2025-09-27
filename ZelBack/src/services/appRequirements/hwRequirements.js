const os = require('os');
const config = require('config');
const generalService = require('../generalService');
const geolocationService = require('../geolocationService');
const daemonServiceBenchmarkRpcs = require('../daemonService/daemonServiceBenchmarkRpcs');
// For compatibility with original, alias as benchmarkService
const benchmarkService = daemonServiceBenchmarkRpcs;
const log = require('../../lib/log');

// Node specifications (shared state)
let nodeSpecs = {
  cpuCores: 0,
  ram: 0,
  ssdStorage: 0,
};

/**
 * Get node specifications
 * @returns {Promise<object>} Node specifications
 */
async function getNodeSpecs() {
  try {
    if (nodeSpecs.cpuCores === 0) {
      nodeSpecs.cpuCores = os.cpus().length;
    }
    if (nodeSpecs.ram === 0) {
      nodeSpecs.ram = os.totalmem() / 1024 / 1024;
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
  return nodeSpecs;
}

/**
 * Set node specifications
 * @param {number} cores - CPU cores
 * @param {number} ram - RAM amount
 * @param {number} ssdStorage - SSD storage amount
 */
function setNodeSpecs(cores, ram, ssdStorage) {
  nodeSpecs.cpuCores = cores;
  nodeSpecs.ram = ram;
  nodeSpecs.ssdStorage = ssdStorage;
}

/**
 * Return current node specifications
 * @returns {object} Node specifications
 */
function returnNodeSpecs() {
  return nodeSpecs;
}

/**
 * Calculate total hardware requirements for an application
 * @param {object} appSpecifications - Application specifications
 * @param {string} myNodeTier - Node tier (basic, super, bamf)
 * @returns {object} Total hardware requirements
 */
function totalAppHWRequirements(appSpecifications, myNodeTier) {
  let cpu = 0;
  let ram = 0;
  let hdd = 0;

  const hddTier = `hdd${myNodeTier}`;
  const ramTier = `ram${myNodeTier}`;
  const cpuTier = `cpu${myNodeTier}`;

  if (appSpecifications.version <= 3) {
    if (appSpecifications.tiered) {
      cpu = appSpecifications[cpuTier] || appSpecifications.cpu;
      ram = appSpecifications[ramTier] || appSpecifications.ram;
      hdd = appSpecifications[hddTier] || appSpecifications.hdd;
    } else {
      cpu = appSpecifications.cpu;
      ram = appSpecifications.ram;
      hdd = appSpecifications.hdd;
    }
  } else if (appSpecifications.version >= 4 && appSpecifications.compose) {
    // For compose applications, sum all components
    appSpecifications.compose.forEach((component) => {
      cpu += component.cpu || 0;
      ram += component.ram || 0;
      hdd += component.hdd || 0;
    });
  } else {
    cpu = appSpecifications.cpu;
    ram = appSpecifications.ram;
    hdd = appSpecifications.hdd;
  }

  return { cpu, ram, hdd };
}

/**
 * Check application hardware requirements against node capabilities
 * @param {object} appSpecs - Application specifications
 * @returns {Promise<boolean>} True if requirements are met
 */
async function checkAppHWRequirements(appSpecs) {
  // appSpecs has hdd, cpu and ram assigned to correct tier
  const tier = await generalService.nodeTier();
  const resourcesLocked = await appsResources();

  if (resourcesLocked.status !== 'success') {
    throw new Error('Unable to obtain locked system resources by Flux Apps. Aborting.');
  }

  const appHWrequirements = totalAppHWRequirements(appSpecs, tier);
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
 * Check application requirements (combined check)
 * @param {object} appSpecs - Application specifications
 * @returns {Promise<boolean>} True if all requirements are met
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
 * Get full node geolocation string
 * @returns {string} Full geolocation string
 */
function nodeFullGeolocation() {
  const nodeGeo = geolocationService.getNodeGeolocation();
  if (!nodeGeo) {
    throw new Error('Node Geolocation not set. Aborting.');
  }
  return `${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`;
}

/**
 * Check application static IP requirements
 * @param {object} appSpecs - Application specifications
 * @returns {boolean} True if requirements are met
 */
function checkAppStaticIpRequirements(appSpecs) {
  if (appSpecs.version >= 7 && appSpecs.staticip) {
    const isMyNodeStaticIP = geolocationService.isStaticIP();
    if (isMyNodeStaticIP !== appSpecs.staticip) {
      throw new Error(`Application ${appSpecs.name} requires static IP address to run. Aborting.`);
    }
  }
  return true;
}

/**
 * Check application geolocation requirements
 * @param {object} appSpecs - Application specifications
 * @returns {boolean} True if requirements are met
 */
function checkAppGeolocationRequirements(appSpecs) {
  if (appSpecs.version >= 5 && appSpecs.geolocation && appSpecs.geolocation.length > 0) {
    const nodeGeo = geolocationService.getNodeGeolocation();
    if (!nodeGeo) {
      throw new Error('Node Geolocation not set. Aborting.');
    }

    const appContinent = appSpecs.geolocation.find((x) => x.startsWith('a'));
    const appCountry = appSpecs.geolocation.find((x) => x.startsWith('b'));
    const geoC = appSpecs.geolocation.filter((x) => x.startsWith('ac'));
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
 * Check application node-specific requirements
 * @param {object} appSpecs - Application specifications
 * @returns {Promise<boolean>} True if requirements are met
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
 * Check if a node's hardware is suitable for running the assigned app
 * @param {object} appSpecs - App specifications
 * @returns {boolean} True if no errors are thrown
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
 * Check if a node's hardware is suitable for running the assigned Docker Compose app
 * @param {object} appSpecsComposed - App specifications composed
 * @returns {boolean} True if no errors are thrown
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
  appSpecsComposed.compose.forEach((appComponent) => {
    if (appComponent.tiered) {
      totalCpuBasic += appComponent.cpubasic;
      totalCpuSuper += appComponent.cpusuper;
      totalCpuBamf += appComponent.cpubamf;
      totalRamBasic += appComponent.rambasic;
      totalRamSuper += appComponent.ramsuper;
      totalRamBamf += appComponent.rambamf;
      totalHddBasic += appComponent.hddbasic;
      totalHddSuper += appComponent.hddsuper;
      totalHddBamf += appComponent.hddbamf;
    } else {
      totalCpu += appComponent.cpu;
      totalRam += appComponent.ram;
      totalHdd += appComponent.hdd;
    }
  });

  // Check total resources
  if (totalCpu > 0) {
    if ((totalCpu * 10) % 1 !== 0 || (totalCpu * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || totalCpu < 0.1) {
      throw new Error(`Total CPU badly assigned for ${appSpecsComposed.name}`);
    }
    if (totalRam % 100 !== 0 || totalRam > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || totalRam < 100) {
      throw new Error(`Total RAM badly assigned for ${appSpecsComposed.name}`);
    }
    if (totalHdd % 1 !== 0 || totalHdd > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || totalHdd < 1) {
      throw new Error(`Total SSD badly assigned for ${appSpecsComposed.name}`);
    }
  }

  // Check tiered resources
  if (totalCpuBasic > 0) {
    if ((totalCpuBasic * 10) % 1 !== 0 || (totalCpuBasic * 10) > (config.fluxSpecifics.cpu.cumulus - config.lockedSystemResources.cpu) || totalCpuBasic < 0.1) {
      throw new Error(`Total CPU for Cumulus badly assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBasic % 100 !== 0 || totalRamBasic > (config.fluxSpecifics.ram.cumulus - config.lockedSystemResources.ram) || totalRamBasic < 100) {
      throw new Error(`Total RAM for Cumulus badly assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBasic % 1 !== 0 || totalHddBasic > (config.fluxSpecifics.hdd.cumulus - config.lockedSystemResources.hdd) || totalHddBasic < 1) {
      throw new Error(`Total SSD for Cumulus badly assigned for ${appSpecsComposed.name}`);
    }
  }

  if (totalCpuSuper > 0) {
    if ((totalCpuSuper * 10) % 1 !== 0 || (totalCpuSuper * 10) > (config.fluxSpecifics.cpu.nimbus - config.lockedSystemResources.cpu) || totalCpuSuper < 0.1) {
      throw new Error(`Total CPU for Nimbus badly assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamSuper % 100 !== 0 || totalRamSuper > (config.fluxSpecifics.ram.nimbus - config.lockedSystemResources.ram) || totalRamSuper < 100) {
      throw new Error(`Total RAM for Nimbus badly assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddSuper % 1 !== 0 || totalHddSuper > (config.fluxSpecifics.hdd.nimbus - config.lockedSystemResources.hdd) || totalHddSuper < 1) {
      throw new Error(`Total SSD for Nimbus badly assigned for ${appSpecsComposed.name}`);
    }
  }

  if (totalCpuBamf > 0) {
    if ((totalCpuBamf * 10) % 1 !== 0 || (totalCpuBamf * 10) > (config.fluxSpecifics.cpu.stratus - config.lockedSystemResources.cpu) || totalCpuBamf < 0.1) {
      throw new Error(`Total CPU for Stratus badly assigned for ${appSpecsComposed.name}`);
    }
    if (totalRamBamf % 100 !== 0 || totalRamBamf > (config.fluxSpecifics.ram.stratus - config.lockedSystemResources.ram) || totalRamBamf < 100) {
      throw new Error(`Total RAM for Stratus badly assigned for ${appSpecsComposed.name}`);
    }
    if (totalHddBamf % 1 !== 0 || totalHddBamf > (config.fluxSpecifics.hdd.stratus - config.lockedSystemResources.hdd) || totalHddBamf < 1) {
      throw new Error(`Total SSD for Stratus badly assigned for ${appSpecsComposed.name}`);
    }
  }

  return true;
}

/**
 * Get apps resource usage - placeholder for original appsResources function
 * @returns {Promise<object>} Resource usage information
 */
async function appsResources() {
  // Import locally to avoid circular dependency
  const appController = require('../appManagement/appController');
  return appController.appsResources();
}

module.exports = {
  getNodeSpecs,
  setNodeSpecs,
  returnNodeSpecs,
  totalAppHWRequirements,
  checkAppHWRequirements,
  checkAppRequirements,
  nodeFullGeolocation,
  checkAppStaticIpRequirements,
  checkAppGeolocationRequirements,
  checkAppNodesRequirements,
  checkHWParameters,
  checkComposeHWParameters,
  appsResources,
};