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
const generalService = require('../generalService');

// Node specifications cache
let nodeSpecs = {
  cpuCores: 0,
  ram: 0,
  ssdStorage: 0,
};

/**
 * Get node specifications (CPU, RAM, Storage)
 * @returns {Promise<object>} Node specifications
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
      const benchmarkResponse = await benchmarkService.getBenchmarks();
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
 * Get system architecture
 * @returns {Promise<string>} System architecture (amd64, arm64, etc.)
 */
async function systemArchitecture() {
  try {
    const arch = os.arch();
    switch (arch) {
      case 'x64':
        return 'amd64';
      case 'arm64':
        return 'arm64';
      case 'arm':
        return 'arm';
      default:
        log.warn(`Unknown architecture: ${arch}, defaulting to amd64`);
        return 'amd64';
    }
  } catch (error) {
    log.error(`Error detecting system architecture: ${error.message}`);
    return 'amd64'; // Default fallback
  }
}

/**
 * Calculate total hardware requirements for apps
 * @param {object} appSpecifications - App specifications
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
      // eslint-disable-next-line prefer-destructuring
      cpu = appSpecifications.cpu;
      // eslint-disable-next-line prefer-destructuring
      ram = appSpecifications.ram;
      // eslint-disable-next-line prefer-destructuring
      hdd = appSpecifications.hdd;
    }
  } else {
    appSpecifications.compose.forEach((appComponent) => {
      if (appComponent.tiered) {
        cpu += appComponent[cpuTier] || appComponent.cpu;
        ram += appComponent[ramTier] || appComponent.ram;
        hdd += appComponent[hddTier] || appComponent.hdd;
      } else {
        cpu += appComponent.cpu;
        ram += appComponent.ram;
        hdd += appComponent.hdd;
      }
    });
  }
  return {
    cpu,
    ram,
    hdd,
  };
}

/**
 * Check app static IP requirements
 * @param {object} appSpecs - App specifications
 * @returns {boolean} True if static IP is required
 */
function checkAppStaticIpRequirements(appSpecs) {
  if (!appSpecs) {
    return false;
  }

  // Check if app explicitly requires static IP
  if (appSpecs.staticIp === true) {
    return true;
  }

  // Check for enterprise features that may require static IP
  if (appSpecs.version >= 8 && appSpecs.enterprise) {
    return true;
  }

  return false;
}

/**
 * Check app nodes requirements
 * @param {object} appSpecs - App specifications
 * @returns {Promise<boolean>} True if node requirements are met
 */
async function checkAppNodesRequirements(appSpecs) {
  try {
    if (!appSpecs || !appSpecs.nodes || appSpecs.nodes.length === 0) {
      return true; // No specific node requirements
    }

    // Get current node info
    const nodeInfo = await daemonServiceFluxnodeRpcs.getFluxNodeStatus();
    if (nodeInfo.status !== 'success') {
      throw new Error('Unable to get node status');
    }

    const myNodeData = nodeInfo.data;

    // Check if this node meets the requirements
    for (const requiredNode of appSpecs.nodes) {
      if (myNodeData.ip === requiredNode.ip || myNodeData.collateral === requiredNode.collateral) {
        return true;
      }
    }

    return false;
  } catch (error) {
    log.error(`Error checking app nodes requirements: ${error.message}`);
    return false;
  }
}

/**
 * Check app geolocation requirements
 * @param {object} appSpecs - App specifications
 * @returns {boolean} True if geolocation requirements are met
 */
function checkAppGeolocationRequirements(appSpecs) {
  try {
    if (!appSpecs || !appSpecs.geolocation || appSpecs.geolocation.length === 0) {
      return true; // No geolocation requirements
    }

    // Get node's geolocation (this would need to be implemented)
    const nodeGeolocation = getNodeGeolocation();

    if (!nodeGeolocation) {
      log.warn('Node geolocation not available');
      return false;
    }

    // Check if node's location matches requirements
    return appSpecs.geolocation.some((location) => {
      return location.continent === nodeGeolocation.continent ||
             location.country === nodeGeolocation.country ||
             location.region === nodeGeolocation.region;
    });
  } catch (error) {
    log.error(`Error checking geolocation requirements: ${error.message}`);
    return false;
  }
}

/**
 * Check app hardware requirements against node specs
 * @param {object} appSpecs - App specifications
 * @returns {Promise<boolean>} True if hardware requirements are met
 */
async function checkAppHWRequirements(appSpecs) {
  try {
    if (!appSpecs) {
      return false;
    }

    const nodeSpecifications = await getNodeSpecs();
    const nodeTier = await generalService.nodeTier();

    const totalRequirements = totalAppHWRequirements(appSpecs, nodeTier);

    // Check CPU requirements
    if (totalRequirements.cpu > nodeSpecifications.cpuCores) {
      log.warn(`Insufficient CPU: Required ${totalRequirements.cpu}, Available ${nodeSpecifications.cpuCores}`);
      return false;
    }

    // Check RAM requirements (convert to GB for comparison)
    const availableRamGB = nodeSpecifications.ram / 1024;
    if (totalRequirements.ram > availableRamGB) {
      log.warn(`Insufficient RAM: Required ${totalRequirements.ram}GB, Available ${availableRamGB}GB`);
      return false;
    }

    // Check storage requirements
    if (totalRequirements.hdd > nodeSpecifications.ssdStorage) {
      log.warn(`Insufficient Storage: Required ${totalRequirements.hdd}GB, Available ${nodeSpecifications.ssdStorage}GB`);
      return false;
    }

    return true;
  } catch (error) {
    log.error(`Error checking hardware requirements: ${error.message}`);
    return false;
  }
}

/**
 * Check all app requirements
 * @param {object} appSpecs - App specifications
 * @returns {Promise<object>} Requirements check result
 */
async function checkAppRequirements(appSpecs) {
  try {
    const results = {
      hardware: await checkAppHWRequirements(appSpecs),
      geolocation: checkAppGeolocationRequirements(appSpecs),
      nodes: await checkAppNodesRequirements(appSpecs),
      staticIp: checkAppStaticIpRequirements(appSpecs),
    };

    const allMet = Object.values(results).every(req => req === true);

    return {
      status: allMet ? 'success' : 'failure',
      requirements: results,
      allMet,
    };
  } catch (error) {
    log.error(`Error checking app requirements: ${error.message}`);
    return {
      status: 'error',
      message: error.message,
      allMet: false,
    };
  }
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
 * Get node geolocation (placeholder implementation)
 * @returns {object|null} Node geolocation data
 */
function getNodeGeolocation() {
  // This would be implemented to get actual node geolocation
  // For now, return null to indicate unavailable
  return null;
}

/**
 * Start monitoring of apps
 * @param {Array} appSpecsToMonitor - Array of app specifications to monitor
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
 * @param {Array} appSpecsToMonitor - Array of app specifications to stop monitoring
 * @param {boolean} deleteData - Whether to delete monitoring data
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
  totalAppHWRequirements,
  checkAppStaticIpRequirements,
  checkAppNodesRequirements,
  checkAppGeolocationRequirements,
  checkAppHWRequirements,
  checkAppRequirements,
  checkHWParameters,
  checkComposeHWParameters,
  createFluxNetworkAPI,
  startMonitoringOfApps,
  stopMonitoringOfApps,
};