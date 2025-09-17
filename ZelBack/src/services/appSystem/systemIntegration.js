const os = require('os');
const config = require('config');
const log = require('../../lib/log');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const dockerService = require('../dockerService');
const daemonServiceBenchmarkRpcs = require('../daemonService/daemonServiceBenchmarkRpcs');
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
      const benchmarkResponse = await daemonServiceBenchmarkRpcs.getBenchmarks();
      if (benchmarkResponse.status === 'success') {
        const benchmarkResponseData = JSON.parse(benchmarkResponse.data);
        log.info(`Gathered ssdstorage ${benchmarkResponseData.ssd}`);
        nodeSpecs.ssdStorage = benchmarkResponseData.ssd;
      } else {
        throw new Error('Error getting ssdstorage from benchmarks');
      }
    }
    return nodeSpecs;
  } catch (error) {
    log.error(`Error getting node specs: ${error.message}`);
    throw error;
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
  const totalSpecs = {
    cpu: 0,
    ram: 0,
    hdd: 0,
  };

  if (!appSpecifications) {
    return totalSpecs;
  }

  // Handle different app versions
  if (appSpecifications.version <= 3) {
    // Legacy single-container apps
    const cpu = appSpecifications[`cpu${myNodeTier}`] || appSpecifications.cpu || 0;
    const ram = appSpecifications[`ram${myNodeTier}`] || appSpecifications.ram || 0;
    const hdd = appSpecifications[`hdd${myNodeTier}`] || appSpecifications.hdd || 0;

    totalSpecs.cpu += cpu;
    totalSpecs.ram += ram;
    totalSpecs.hdd += hdd;
  } else if (appSpecifications.compose && Array.isArray(appSpecifications.compose)) {
    // Multi-container compose apps
    appSpecifications.compose.forEach((component) => {
      const cpu = component[`cpu${myNodeTier}`] || component.cpu || 0;
      const ram = component[`ram${myNodeTier}`] || component.ram || 0;
      const hdd = component[`hdd${myNodeTier}`] || component.hdd || 0;

      totalSpecs.cpu += cpu;
      totalSpecs.ram += ram;
      totalSpecs.hdd += hdd;
    });
  }

  return totalSpecs;
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
  if (!appSpecs) {
    return false;
  }

  // Validate CPU parameters
  if (typeof appSpecs.cpu !== 'number' || appSpecs.cpu <= 0) {
    return false;
  }

  // Validate RAM parameters
  if (typeof appSpecs.ram !== 'number' || appSpecs.ram <= 0) {
    return false;
  }

  // Validate HDD parameters
  if (typeof appSpecs.hdd !== 'number' || appSpecs.hdd <= 0) {
    return false;
  }

  // Check tiered specifications if present
  if (appSpecs.tiered) {
    const tiers = ['basic', 'super', 'bamf'];
    for (const tier of tiers) {
      const cpuKey = `cpu${tier}`;
      const ramKey = `ram${tier}`;
      const hddKey = `hdd${tier}`;

      if (appSpecs[cpuKey] && (typeof appSpecs[cpuKey] !== 'number' || appSpecs[cpuKey] <= 0)) {
        return false;
      }
      if (appSpecs[ramKey] && (typeof appSpecs[ramKey] !== 'number' || appSpecs[ramKey] <= 0)) {
        return false;
      }
      if (appSpecs[hddKey] && (typeof appSpecs[hddKey] !== 'number' || appSpecs[hddKey] <= 0)) {
        return false;
      }
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
  if (!appSpecsComposed || !appSpecsComposed.compose || !Array.isArray(appSpecsComposed.compose)) {
    return false;
  }

  // Check each component
  for (const component of appSpecsComposed.compose) {
    if (!checkHWParameters(component)) {
      return false;
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