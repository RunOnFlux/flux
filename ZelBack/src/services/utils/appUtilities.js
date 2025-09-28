const path = require('path');
const util = require('util');
const nodecmd = require('node-cmd');
const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const geolocationService = require('../geolocationService');

const cmdAsync = util.promisify(nodecmd.run);
const fluxDirPath = path.join(__dirname, '../../../../');


/**
 * Calculate app price per month
 * @param {object} dataForAppRegistration - App registration data
 * @param {number} height - Block height
 * @param {Array} suppliedPrices - Optional price data
 * @returns {Promise<number>} Monthly price
 */
async function appPricePerMonth(dataForAppRegistration, height, suppliedPrices) {
  if (!dataForAppRegistration) {
    return new Error('Application specification not provided');
  }
  const fluxNetworkHelper = require('../fluxNetworkHelper');
  const chainUtilities = require('./chainUtilities');
  const appPrices = suppliedPrices || await chainUtilities.getChainParamsPriceUpdates();
  const intervals = appPrices.filter((i) => i.height < height);
  const priceSpecifications = intervals[intervals.length - 1]; // filter does not change order
  let instancesAdditional = 0;
  if (dataForAppRegistration.instances) {
    // spec of version >= 3
    // specification version 3 is saying. 3 instances are standard, every 3 additional is double the price.
    instancesAdditional = dataForAppRegistration.instances - 3; // has to always be >=0 as of checks before.
  }
  if (dataForAppRegistration.version <= 3) {
    if (dataForAppRegistration.tiered) {
      const cpuTotalCount = dataForAppRegistration.cpubasic + dataForAppRegistration.cpusuper + dataForAppRegistration.cpubamf;
      const cpuPrice = cpuTotalCount * priceSpecifications.cpu * 10;
      const cpuTotal = cpuPrice / 3;
      const ramTotalCount = dataForAppRegistration.rambasic + dataForAppRegistration.ramsuper + dataForAppRegistration.rambamf;
      const ramPrice = (ramTotalCount * priceSpecifications.ram) / 100;
      const ramTotal = ramPrice / 3;
      const hddTotalCount = dataForAppRegistration.hddbasic + dataForAppRegistration.hddsuper + dataForAppRegistration.hddbamf;
      const hddPrice = hddTotalCount * priceSpecifications.hdd;
      const hddTotal = hddPrice / 3;
      let totalPrice = cpuTotal + ramTotal + hddTotal;
      if (dataForAppRegistration.port) {
        if (fluxNetworkHelper.isPortEnterprise(dataForAppRegistration.port)) {
          totalPrice += priceSpecifications.port;
        }
      } else if (dataForAppRegistration.ports) {
        const enterprisePorts = [];
        dataForAppRegistration.ports.forEach((port) => {
          if (fluxNetworkHelper.isPortEnterprise(port)) {
            enterprisePorts.push(port);
          }
        });
        totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
      }
      if (priceSpecifications.minUSDPrice && height >= config.fluxapps.applyMinimumPriceOn3Instances && totalPrice < priceSpecifications.minUSDPrice) {
        totalPrice = Number(priceSpecifications.minUSDPrice).toFixed(2);
      }
      let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
      if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
        if (appPrice < 1.50) {
          appPrice += (instancesAdditional * 0.50);
        } else {
          const additionalPrice = (appPrice * instancesAdditional) / 3;
          appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
        }
      }
      if (appPrice < priceSpecifications.minPrice) {
        appPrice = priceSpecifications.minPrice;
      }
      return appPrice;
    }
    const cpuTotal = dataForAppRegistration.cpu * priceSpecifications.cpu * 10;
    const ramTotal = (dataForAppRegistration.ram * priceSpecifications.ram) / 100;
    const hddTotal = dataForAppRegistration.hdd * priceSpecifications.hdd;
    let totalPrice = cpuTotal + ramTotal + hddTotal;
    if (dataForAppRegistration.port) {
      if (fluxNetworkHelper.isPortEnterprise(dataForAppRegistration.port)) {
        totalPrice += priceSpecifications.port;
      }
    } else if (dataForAppRegistration.ports) {
      const enterprisePorts = [];
      dataForAppRegistration.ports.forEach((port) => {
        if (fluxNetworkHelper.isPortEnterprise(port)) {
          enterprisePorts.push(port);
        }
      });
      totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
    }
    let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
    if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
      if (appPrice < 1.50) {
        appPrice += (instancesAdditional * 0.50);
      } else {
        const additionalPrice = (appPrice * instancesAdditional) / 3;
        appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
      }
    }
    if (appPrice < priceSpecifications.minPrice) {
      appPrice = priceSpecifications.minPrice;
    }
    return appPrice;
  }
  // v4+ compose
  let cpuTotalCount = 0;
  let ramTotalCount = 0;
  let hddTotalCount = 0;
  const enterprisePorts = [];
  dataForAppRegistration.compose.forEach((appComponent) => {
    if (appComponent.tiered) {
      cpuTotalCount += ((appComponent.cpubasic + appComponent.cpusuper + appComponent.cpubamf) / 3);
      ramTotalCount += ((appComponent.rambasic + appComponent.ramsuper + appComponent.rambamf) / 3);
      hddTotalCount += ((appComponent.hddbasic + appComponent.hddsuper + appComponent.hddbamf) / 3);
    } else {
      cpuTotalCount += appComponent.cpu;
      ramTotalCount += appComponent.ram;
      hddTotalCount += appComponent.hdd;
    }
    appComponent.ports.forEach((port) => {
      if (fluxNetworkHelper.isPortEnterprise(port)) {
        enterprisePorts.push(port);
      }
    });
  });
  const cpuPrice = cpuTotalCount * priceSpecifications.cpu * 10;
  const ramPrice = (ramTotalCount * priceSpecifications.ram) / 100;
  const hddPrice = hddTotalCount * priceSpecifications.hdd;
  let totalPrice = cpuPrice + ramPrice + hddPrice;
  if ((dataForAppRegistration.nodes && dataForAppRegistration.nodes.length) || dataForAppRegistration.enterprise) { // v7+ enterprise apps
    totalPrice += priceSpecifications.scope;
  }
  if (dataForAppRegistration.staticip) { // v7+ staticip option
    totalPrice += priceSpecifications.staticip;
  }
  totalPrice += enterprisePorts.length * priceSpecifications.port; // enterprise ports
  if (priceSpecifications.minUSDPrice && height >= config.fluxapps.applyMinimumPriceOn3Instances && totalPrice < priceSpecifications.minUSDPrice) {
    totalPrice = Number(priceSpecifications.minUSDPrice).toFixed(2);
  }
  let appPrice = Number(Math.ceil(totalPrice * 100) / 100);
  if (instancesAdditional > 0 && height >= config.fluxapps.applyMinimumForExtraInstances) {
    if (appPrice < 1.50) {
      appPrice += (instancesAdditional * 0.50);
    } else {
      const additionalPrice = (appPrice * instancesAdditional) / 3;
      appPrice = (Math.ceil(additionalPrice * 100) + Math.ceil(appPrice * 100)) / 100;
    }
  }

  if (appPrice < priceSpecifications.minPrice) {
    appPrice = priceSpecifications.minPrice;
  }
  return appPrice;
}

/**
 * Get node full geolocation
 * @returns {string} Full geolocation string
 */
function nodeFullGeolocation() {
  const nodeGeo = geolocationService.getNodeGeolocation();
  if (!nodeGeo) {
    throw new Error('Node Geolocation not set. Aborting.');
  }
  const myNodeLocationFull = `${nodeGeo.continentCode}_${nodeGeo.countryCode}_${nodeGeo.regionName}`;
  return myNodeLocationFull;
}

/**
 * Get app folder size
 * @param {string} appName - Application name
 * @returns {Promise<number>} Folder size in bytes
 */
async function getAppFolderSize(appName) {
  try {
    const appsDirPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
    const directoryPath = path.join(appsDirPath, appName);
    const exec = `sudo du -s --block-size=1 ${directoryPath}`;
    const cmdres = await cmdAsync(exec);
    const size = serviceHelper.ensureString(cmdres).split('\t')[0] || 0;
    return Number(size);
  } catch (error) {
    log.error(`Error getting app folder size: ${error.message}`);
    return 0;
  }
}

/**
 * Get container storage usage
 * @param {string} appName - Application name
 * @returns {Promise<object>} Storage usage information
 */
async function getContainerStorage(appName) {
  try {
    const containerInfo = await dockerService.dockerContainerInspect(appName, { size: true });
    let bindMountsSize = 0;
    let volumeMountsSize = 0;
    const containerRootFsSize = serviceHelper.ensureNumber(containerInfo.SizeRootFs) || 0;

    if (containerInfo?.Mounts?.length) {
      await Promise.all(containerInfo.Mounts.map(async (mount) => {
        let source = mount?.Source;
        const mountType = mount?.Type;
        if (source) {
          if (mountType === 'bind') {
            source = source.replace('/appdata', '');
            const exec = `sudo du -sb ${source}`;
            try {
              const mountInfo = await cmdAsync(exec);
              if (mountInfo) {
                const size = Number(serviceHelper.ensureString(mountInfo).split('\t')[0] || 0);
                bindMountsSize += size;
              }
            } catch (error) {
              log.warn(`Unable to get bind mount size for ${source}: ${error.message}`);
            }
          } else if (mountType === 'volume') {
            const volumeName = mount?.Name;
            if (volumeName) {
              try {
                const volumeInfo = await dockerService.dockerVolumeInspect(volumeName);
                if (volumeInfo?.Mountpoint) {
                  const exec = `sudo du -sb ${volumeInfo.Mountpoint}`;
                  const mountInfo = await cmdAsync(exec);
                  if (mountInfo) {
                    const size = Number(serviceHelper.ensureString(mountInfo).split('\t')[0] || 0);
                    volumeMountsSize += size;
                  }
                }
              } catch (error) {
                log.warn(`Unable to get volume mount size for ${volumeName}: ${error.message}`);
              }
            }
          }
        }
      }));
    }

    return {
      containerRootFsSize,
      bindMountsSize,
      volumeMountsSize,
      totalSize: containerRootFsSize + bindMountsSize + volumeMountsSize,
    };
  } catch (error) {
    log.error(`Error getting container storage: ${error.message}`);
    return {
      containerRootFsSize: 0,
      bindMountsSize: 0,
      volumeMountsSize: 0,
      totalSize: 0,
    };
  }
}

/**
 * Get app ports from specifications
 * @param {object} appSpecs - Application specifications
 * @returns {Array<number>} Array of port numbers
 */
function getAppPorts(appSpecs) {
  const appPorts = [];
  // eslint-disable-next-line no-restricted-syntax
  if (appSpecs.version === 1) {
    appPorts.push(+appSpecs.port);
  } else if (appSpecs.version <= 3) {
    appSpecs.ports.forEach((port) => {
      appPorts.push(+port);
    });
  } else {
    appSpecs.compose.forEach((component) => {
      component.ports.forEach((port) => {
        appPorts.push(+port);
      });
    });
  }
  return appPorts;
}

/**
 * Format app specifications to standard format
 * @param {object} appSpecification - Raw app specifications
 * @returns {object} Formatted app specifications
 */
function specificationFormatter(appSpecification) {
  let {
    version,
    name,
    description,
    owner,
    port, // version 1 deprecated
    containerPort, // version 1 deprecated
    compose,
    repotag,
    ports,
    containerPorts,
    domains,
    environmentParameters,
    commands,
    containerData,
    cpu,
    ram,
    hdd,
    tiered,
    cpubasic,
    rambasic,
    hddbasic,
    cpusuper,
    ramsuper,
    hddsuper,
    cpubamf,
    rambamf,
    hddbamf,
    hash,
    height,
    // version 3 and higher
    instances,
    // version 4 and higher
    repoauth,
    // version 5 and higher
    contacts,
    geolocation,
    // version 6 and higher
    expire,
    // version 7 and higher
    nodes,
    secrets,
    staticip,
    // version 8 and higher
    enterprise,
    // additional properties that may be present
    ...otherProperties
  } = appSpecification || {};

  // Ensure basic properties
  version = serviceHelper.ensureNumber(version) || 1;
  name = serviceHelper.ensureString(name);
  description = serviceHelper.ensureString(description);
  owner = serviceHelper.ensureString(owner);

  // Handle version-specific formatting
  if (version === 1) {
    port = serviceHelper.ensureNumber(port);
    containerPort = serviceHelper.ensureNumber(containerPort);
  }

  if (version <= 3) {
    repotag = serviceHelper.ensureString(repotag);
    if (version >= 2) {
      ports = serviceHelper.ensureArray(ports).map(p => serviceHelper.ensureNumber(p));
      containerPorts = serviceHelper.ensureArray(containerPorts).map(p => serviceHelper.ensureNumber(p));
      domains = serviceHelper.ensureArray(domains);
      environmentParameters = serviceHelper.ensureArray(environmentParameters);
      commands = serviceHelper.ensureArray(commands);
      containerData = serviceHelper.ensureString(containerData);
      cpu = serviceHelper.ensureNumber(cpu);
      ram = serviceHelper.ensureNumber(ram);
      hdd = serviceHelper.ensureNumber(hdd);

      if (tiered) {
        cpubasic = serviceHelper.ensureNumber(cpubasic);
        rambasic = serviceHelper.ensureNumber(rambasic);
        hddbasic = serviceHelper.ensureNumber(hddbasic);
        cpusuper = serviceHelper.ensureNumber(cpusuper);
        ramsuper = serviceHelper.ensureNumber(ramsuper);
        hddsuper = serviceHelper.ensureNumber(hddsuper);
        cpubamf = serviceHelper.ensureNumber(cpubamf);
        rambamf = serviceHelper.ensureNumber(rambamf);
        hddbamf = serviceHelper.ensureNumber(hddbamf);
      }
    }

    if (version >= 3) {
      instances = serviceHelper.ensureNumber(instances);
    }
  }

  if (version >= 4) {
    compose = serviceHelper.ensureArray(compose);
  }

  if (version >= 5) {
    contacts = serviceHelper.ensureArray(contacts);
    geolocation = serviceHelper.ensureArray(geolocation);
  }

  if (version >= 6) {
    expire = serviceHelper.ensureNumber(expire);
  }

  if (version >= 7) {
    nodes = serviceHelper.ensureArray(nodes);
    secrets = serviceHelper.ensureString(secrets);
    staticip = serviceHelper.ensureBoolean(staticip);
  }

  if (version >= 8) {
    enterprise = serviceHelper.ensureBoolean(enterprise);
  }

  // Build formatted object
  const formatted = {
    version,
    name,
    description,
    owner,
    ...otherProperties,
  };

  // Add version-specific properties
  if (version === 1) {
    formatted.port = port;
    formatted.containerPort = containerPort;
  }

  if (version <= 3) {
    formatted.repotag = repotag;
    if (version >= 2) {
      formatted.ports = ports;
      formatted.containerPorts = containerPorts;
      formatted.domains = domains;
      formatted.environmentParameters = environmentParameters;
      formatted.commands = commands;
      formatted.containerData = containerData;
      formatted.cpu = cpu;
      formatted.ram = ram;
      formatted.hdd = hdd;
      formatted.tiered = tiered;

      if (tiered) {
        formatted.cpubasic = cpubasic;
        formatted.rambasic = rambasic;
        formatted.hddbasic = hddbasic;
        formatted.cpusuper = cpusuper;
        formatted.ramsuper = ramsuper;
        formatted.hddsuper = hddsuper;
        formatted.cpubamf = cpubamf;
        formatted.rambamf = rambamf;
        formatted.hddbamf = hddbamf;
      }
    }

    if (version >= 3) {
      formatted.instances = instances;
    }
  }

  if (version >= 4) {
    // Process components and add version-specific component properties
    const correctCompose = [];
    if (Array.isArray(compose)) {
      compose.forEach((appComponent) => {
        const appComponentCorrect = { ...appComponent };

        // Add component-level repoauth and secrets for v7+ only if they exist
        if (version >= 7) {
          if (appComponent.repoauth !== undefined) {
            appComponentCorrect.repoauth = serviceHelper.ensureString(appComponent.repoauth);
          }
          if (version === 7 && appComponent.secrets !== undefined) {
            appComponentCorrect.secrets = serviceHelper.ensureString(appComponent.secrets);
          }
        }

        correctCompose.push(appComponentCorrect);
      });
    }
    formatted.compose = correctCompose;
  }

  if (version >= 5) {
    formatted.contacts = contacts;
    formatted.geolocation = geolocation;
  }

  if (version >= 6) {
    formatted.expire = expire;
  }

  if (version >= 7) {
    formatted.nodes = nodes;
    formatted.secrets = secrets;
    formatted.staticip = staticip;
  }

  if (version >= 8) {
    formatted.enterprise = enterprise;
  }

  // Always include hash and height if present
  if (hash) formatted.hash = hash;
  if (height) formatted.height = height;

  return formatted;
}

/**
 * Parse app specification from string or object
 * @param {string|object} specData - Specification data
 * @returns {object} Parsed specification
 */
function parseAppSpecification(specData) {
  try {
    if (typeof specData === 'string') {
      return JSON.parse(specData);
    }
    if (typeof specData === 'object' && specData !== null) {
      return specData;
    }
    throw new Error('Invalid specification data type');
  } catch (error) {
    log.error(`Error parsing app specification: ${error.message}`);
    throw new Error('Invalid app specification format');
  }
}

/**
 * Validate app name format
 * @param {string} name - App name to validate
 * @returns {boolean} True if valid
 */
function validateAppName(name) {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // App name constraints
  const minLength = 1;
  const maxLength = 32;
  const validPattern = /^[a-zA-Z0-9]+$/; // Only alphanumeric characters

  return name.length >= minLength &&
         name.length <= maxLength &&
         validPattern.test(name);
}

/**
 * Sanitize app input data
 * @param {object} data - Input data to sanitize
 * @returns {object} Sanitized data
 */
function sanitizeAppInput(data) {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const sanitized = {};

  // Sanitize string fields
  Object.keys(data).forEach(key => {
    const value = data[key];
    if (typeof value === 'string') {
      sanitized[key] = value.trim().substring(0, 1000); // Limit string length
    } else if (typeof value === 'number') {
      sanitized[key] = Number.isFinite(value) ? value : 0;
    } else if (typeof value === 'boolean') {
      sanitized[key] = Boolean(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.slice(0, 100); // Limit array length
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeAppInput(value); // Recursive sanitization
    }
  });

  return sanitized;
}

/**
 * Generate app hash from specifications
 * @param {object} appSpec - App specifications
 * @returns {string} Generated hash
 */
function generateAppHash(appSpec) {
  try {
    const crypto = require('crypto');
    const specString = JSON.stringify(appSpec);
    return crypto.createHash('sha256').update(specString).digest('hex');
  } catch (error) {
    log.error(`Error generating app hash: ${error.message}`);
    throw error;
  }
}

/**
 * Extract app metadata from specifications
 * @param {object} appSpec - App specifications
 * @returns {object} Extracted metadata
 */
function extractAppMetadata(appSpec) {
  if (!appSpec) {
    return {};
  }

  return {
    name: appSpec.name,
    version: appSpec.version,
    owner: appSpec.owner,
    description: appSpec.description,
    totalCpu: calculateTotalCpu(appSpec),
    totalRam: calculateTotalRam(appSpec),
    totalHdd: calculateTotalHdd(appSpec),
    ports: getAppPorts(appSpec),
    isCompose: appSpec.version >= 4 && appSpec.compose && appSpec.compose.length > 0,
    isEnterprise: appSpec.version >= 8 && appSpec.enterprise,
  };
}

/**
 * Calculate total CPU requirements
 * @param {object} appSpec - App specifications
 * @returns {number} Total CPU
 */
function calculateTotalCpu(appSpec) {
  if (!appSpec) return 0;

  if (appSpec.version <= 3) {
    return appSpec.cpu || 0;
  } else if (appSpec.compose) {
    return appSpec.compose.reduce((total, component) => total + (component.cpu || 0), 0);
  }

  return 0;
}

/**
 * Calculate total RAM requirements
 * @param {object} appSpec - App specifications
 * @returns {number} Total RAM
 */
function calculateTotalRam(appSpec) {
  if (!appSpec) return 0;

  if (appSpec.version <= 3) {
    return appSpec.ram || 0;
  } else if (appSpec.compose) {
    return appSpec.compose.reduce((total, component) => total + (component.ram || 0), 0);
  }

  return 0;
}

/**
 * Calculate total HDD requirements
 * @param {object} appSpec - App specifications
 * @returns {number} Total HDD
 */
function calculateTotalHdd(appSpec) {
  if (!appSpec) return 0;

  if (appSpec.version <= 3) {
    return appSpec.hdd || 0;
  } else if (appSpec.compose) {
    return appSpec.compose.reduce((total, component) => total + (component.hdd || 0), 0);
  }

  return 0;
}

module.exports = {
  appPricePerMonth,
  nodeFullGeolocation,
  getAppFolderSize,
  getContainerStorage,
  getAppPorts,
  specificationFormatter,
  parseAppSpecification,
  validateAppName,
  sanitizeAppInput,
  generateAppHash,
  extractAppMetadata,
  calculateTotalCpu,
  calculateTotalRam,
  calculateTotalHdd,
};